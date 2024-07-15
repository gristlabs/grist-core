import { expect, Page } from '@playwright/test';
import { HomeUtil } from "./playwrightHomeUtil";
import * as testUtils from "../server/testUtils";
import { server } from "./testServer";

export const homeUtil = new HomeUtil(testUtils.fixturesRoot, server);

export async function checkForErrors(page: Page) {
  const errors = await page.evaluate(() => (window as any).getAppErrors());
  expect(errors).toEqual([]);
}
