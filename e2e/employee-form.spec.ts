import { test, expect } from '@playwright/test';
import { seedSubmission } from './fixtures/seed';
import { mockAllAi } from './fixtures/mock-ai';

test.describe('EmployeeForm — structure and conditional rendering', () => {
  test('new-hire employee form starts on ID Photo step', async ({ page }) => {
    const sub = await seedSubmission({ step: 'employee' });
    try {
      await mockAllAi(page);
      await page.goto(sub.url);
      // Step 1 title should be "ID Photo"
      await expect(page.getByText('ID Photo', { exact: true }).first()).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      await sub.cleanup();
    }
  });

  test('employee form has 8 steps (Step 1 of 8 indicator)', async ({ page }) => {
    const sub = await seedSubmission({ step: 'employee' });
    try {
      await mockAllAi(page);
      await page.goto(sub.url);
      // Look for "of 8" text that typically appears in the step counter
      await expect(page.getByText(/of\s*8/).first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await sub.cleanup();
    }
  });

  test('renewal form opens at employee step without crashing', async ({ page }) => {
    // Renewals share the same 8-step structure; this test guards against
    // renewal-specific regressions (e.g. the onboarding_type branch).
    const sub = await seedSubmission({ step: 'employee', renewal: true });
    try {
      await mockAllAi(page);
      await page.goto(sub.url);
      await expect(page.getByText(/of\s*8/).first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await sub.cleanup();
    }
  });
});
