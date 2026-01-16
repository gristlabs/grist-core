import * as gu from "test/nbrowser/gristUtils";

import { driver, WebElement } from "mocha-webdriver";

export function itemElement(itemId: string) {
  return driver.findWait(`.test-admin-panel-item-${itemId}`, 1000);
}

export async function toggleItem(itemId: string) {
  const header = itemElement(itemId).find(`.test-admin-panel-item-name-${itemId}`);
  await header.click();
  await driver.sleep(500);    // Time to expand or collapse.
  return header;
}

export function itemValue(itemId: string) {
  return driver.findWait(`.test-admin-panel-item-value-${itemId}`, 100).getText();
}

/**
 * Returns an object to get the text and status of a section value.
 */
export function sectionValue(sectionId: string) {
  return {
    text: () => itemValue(sectionId),
    status: async () => {
      const item = await driver.findWait(`.test-admin-panel-item-value-${sectionId}`, 100);
      if (await item.find(".test-admin-panel-value-label-success").isPresent()) {
        return "success";
      } else if (await item.find(".test-admin-panel-value-label-danger").isPresent()) {
        return "danger";
      } else if (await item.find(".test-admin-panel-value-label-error").isPresent()) {
        return "error";
      } else {
        return null;
      }
    },
  };
}

export async function withExpandedItem(itemId: string, callback: () => Promise<void>) {
  const header = await toggleItem(itemId);
  await callback();
  await header.click();
  await driver.sleep(500);    // Time to collapse.
}

export async function clickSwitch(name: string) {
  const toggle = driver.find(`.test-admin-panel-item-value-${name} .test-toggle-switch`);
  await toggle.click();
  await gu.waitForServer();
}

export async function isEnabled(switchElem: WebElement | string) {
  if (typeof switchElem === "string") {
    switchElem = driver.find(`.test-admin-panel-item-value-${switchElem} .test-toggle-switch`);
  }
  return (await switchElem.find("input").getAttribute("checked")) === null ? false : true;
}

export async function currentVersion() {
  const currentVersionText = await driver.find(".test-admin-panel-item-value-version").getText();
  const currentVersion = currentVersionText.match(/Version (.+)/)![1];
  return currentVersion;
}
