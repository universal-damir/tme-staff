import { test, expect } from '@playwright/test';
import { seedSubmission } from './fixtures/seed';

/**
 * Sanity: seed helper works, the onboard page resolves, and cleanup runs.
 * If this fails, something is wrong with Supabase connection or the
 * /onboard/[id] route. All other E2E specs are meaningless until this passes.
 */
test('seed + onboard page loads (no AI mock needed)', async ({ page }) => {
  const sub = await seedSubmission({ step: 'employer' });
  try {
    await page.goto(sub.url);
    // The page should not 404 — at minimum, something should render.
    await expect(page).not.toHaveTitle(/404|Not Found/i);
    // Wait for React to hydrate, then check the URL stuck
    expect(page.url()).toContain(sub.id);
  } finally {
    await sub.cleanup();
  }
});
