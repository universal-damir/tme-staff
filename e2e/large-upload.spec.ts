import { test, expect, type Page, type Request } from '@playwright/test';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { seedSubmission } from './fixtures/seed';
import { mockAllAi } from './fixtures/mock-ai';

// A large passport PDF (an iPhone scan is often 3-6 MB) must reach the AI
// check and storage. Before the fix, Netlify refused the 6.7 MB request and
// the form said "try again in a moment" forever (07.10.26).
//
// Set LARGE_PDF to a real large passport scan to run this; skipped otherwise
// (no personal documents live in the repo).
const LARGE_PDF = process.env.LARGE_PDF;

/** Remove every file a test stored for this submission. */
async function removeStoredFiles(rowId: string) {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
    auth: { persistSession: false },
  });
  for (const folder of ['photo', 'passport/cover', 'passport/insidePages']) {
    const { data } = await supabase.storage.from('staff-documents').list(`${rowId}/${folder}`);
    const paths = (data ?? []).map((f) => `${rowId}/${folder}/${f.name}`);
    if (paths.length) await supabase.storage.from('staff-documents').remove(paths);
  }
}

/** Click a visible upload box and hand the file to its file chooser. */
async function pickFile(page: Page, box: RegExp, file: string) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: box }).first().click();
  await (await chooser).setFiles(file);
}

test.describe('large passport PDF', () => {
  test.skip(!LARGE_PDF, 'set LARGE_PDF=/path/to/large-passport.pdf');

  test('inside pages: the AI gets a small copy, storage gets the original', async ({ page }) => {
    test.setTimeout(120_000);
    const original = fs.statSync(LARGE_PDF!).size;
    expect(original).toBeGreaterThan(4 * 1024 * 1024);

    const sub = await seedSubmission({ step: 'employee' });
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!,
      { auth: { persistSession: false } }
    );
    try {
      await mockAllAi(page);

      // Record what the passport check receives.
      const checkBodies: string[] = [];
      page.on('request', (req: Request) => {
        if (req.url().includes('/api/validate-passport-page')) checkBodies.push(req.postData() ?? '');
      });
      const uploadSteps: string[] = [];
      page.on('request', (req: Request) => {
        if (req.url().includes('/api/storage/upload')) {
          const ct = req.headers()['content-type'] ?? '';
          uploadSteps.push(ct.startsWith('application/json') ? JSON.parse(req.postData() ?? '{}').step : 'multipart');
        }
        if (req.url().includes('/object/upload/sign/')) uploadSteps.push('direct-put');
      });

      await page.goto(sub.url);

      // Step 1: photo.
      await page.locator('input[type="file"]').first().setInputFiles('e2e/fixtures/files/tiny.png');
      await page.getByRole('button', { name: /continue/i }).last().click();

      // Step 2: passport cover.
      await expect(page.getByText(/Passport.*Cover/i).first()).toBeVisible({ timeout: 15_000 });
      await pickFile(page, /Spread open: front \+ back cover/i, 'e2e/fixtures/files/tiny.pdf');
      await expect(page.getByText(/^Valid$/).first()).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: /continue/i }).last().click();

      // Step 3: passport inside pages, the large PDF.
      await expect(page.getByText(/Passport Data \(INSIDE\)/i).first()).toBeVisible({ timeout: 15_000 });
      checkBodies.length = 0;
      uploadSteps.length = 0;
      await pickFile(page, /Spread open: data page/i, LARGE_PDF!);

      await expect(page.getByText(/^Valid$/).first()).toBeVisible({ timeout: 90_000 });
      await expect(page.getByText(/could not check this file/i)).toHaveCount(0);

      // The AI check got a PDF small enough for Netlify.
      expect(checkBodies.length).toBeGreaterThan(0);
      const body = JSON.parse(checkBodies[0]);
      if (process.env.DUMP_AI_PAYLOAD) fs.writeFileSync(process.env.DUMP_AI_PAYLOAD, body.image);
      expect(body.image.startsWith('data:application/pdf;base64,')).toBe(true);
      expect(checkBodies[0].length).toBeLessThan(4_000_000);

      // Storage got the original by direct upload.
      expect(uploadSteps).toEqual(['start', 'direct-put', 'finish']);
      const { data: files } = await supabase.storage
        .from('staff-documents')
        .list(`${sub.id}/passport/insidePages`);
      expect(files?.length).toBe(1);
      expect(files?.[0].metadata?.size).toBe(original);
    } finally {
      await removeStoredFiles(sub.id);
      await sub.cleanup();
    }
  });
});

test.describe('check that cannot run', () => {
  test('names the problem and offers a hand check after two tries', async ({ page }) => {
    test.setTimeout(90_000);
    const sub = await seedSubmission({ step: 'employee' });
    try {
      await mockAllAi(page);
      // Netlify's own error page: not JSON (what Jesper's form got).
      await page.route('**/api/validate-passport-page', (route) =>
        route.fulfill({ status: 502, contentType: 'text/html', body: '<html>Bad Gateway</html>' })
      );
      await page.goto(sub.url);
      await page.locator('input[type="file"]').first().setInputFiles('e2e/fixtures/files/tiny.png');
      await page.getByRole('button', { name: /continue/i }).last().click();
      await expect(page.getByText(/Passport.*Cover/i).first()).toBeVisible({ timeout: 15_000 });

      await pickFile(page, /Spread open: front \+ back cover/i, 'e2e/fixtures/files/tiny.pdf');
      await expect(page.getByText(/Our automatic check is not working right now/i).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByRole('button', { name: /Submit for manual review/i })).toHaveCount(0);

      // Second failed try: the hand-check option appears, nobody is stuck.
      await page.getByRole('button', { name: /replace/i }).first().click().catch(() => {});
      await pickFile(page, /Spread open: front \+ back cover|replace/i, 'e2e/fixtures/files/tiny.pdf');
      await expect(page.getByRole('button', { name: /Submit for manual review/i })).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await removeStoredFiles(sub.id);
      await sub.cleanup();
    }
  });
});
