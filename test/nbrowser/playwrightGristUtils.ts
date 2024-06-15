import { expect, Page } from '@playwright/test';

export async function checkForErrors(page: Page) {
  const errors = await page.evaluate(() => (window as any).getAppErrors());
  expect(errors).toEqual([]);
}
