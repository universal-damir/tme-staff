import { test, expect } from '@playwright/test';
import { seedSubmission } from './fixtures/seed';
import { mockAllAi } from './fixtures/mock-ai';

test.describe('EmployerForm — conditional rendering', () => {
  test('DMCC authority shows Job Offer Letter upload slot', async ({ page }) => {
    const sub = await seedSubmission({ step: 'employer', dmcc: true });
    try {
      await mockAllAi(page);
      await page.goto(sub.url);
      await expect(page.getByText('Job Offer Letter (DMCC Requirement)')).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByText('Signed Job Offer Letter')).toBeVisible();
    } finally {
      await sub.cleanup();
    }
  });

  test('non-DMCC authority hides Job Offer Letter slot', async ({ page }) => {
    const sub = await seedSubmission({ step: 'employer', dmcc: false });
    try {
      await mockAllAi(page);
      await page.goto(sub.url);
      // Wait for form to mount
      await expect(page.getByText('UAE Visa Status')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText('Job Offer Letter (DMCC Requirement)')).not.toBeVisible();
    } finally {
      await sub.cleanup();
    }
  });

  test('UAE Visa Status section is present on all employer forms', async ({ page }) => {
    const sub = await seedSubmission({ step: 'employer' });
    try {
      await mockAllAi(page);
      await page.goto(sub.url);
      await expect(page.getByText('UAE Visa Status')).toBeVisible({ timeout: 10_000 });
    } finally {
      await sub.cleanup();
    }
  });
});
