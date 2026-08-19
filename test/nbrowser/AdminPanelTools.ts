import * as gu from "test/nbrowser/gristUtils";

import { driver, WebElement } from "mocha-webdriver";

// Items are filled in by probes and config reads that land after the panel is on screen.
const ITEM_TIMEOUT = 4000;

export function itemElement(itemId: string) {
  return driver.findWait(`.test-admin-panel-item-${itemId}`, ITEM_TIMEOUT);
}

/**
 * Height of an item's collapsible content, or null if it has none. SectionItem only builds the
 * animated wrapper for items with expandedContent that are not disabled.
 */
async function itemContentHeight(itemId: string): Promise<number | null> {
  return await driver.executeScript<number | null>((sel: string) => {
    const el = document.querySelector(sel);
    return el ? el.getBoundingClientRect().height : null;
  }, `.test-admin-panel-item-content-${itemId}`);
}

/**
 * Waits for an expand or collapse to finish. The content is always in the DOM; what changes is
 * the wrapper's max-height, animated over 0.3s. So wait for the height to settle.
 */
async function waitForItemTransition(itemId: string, expanded: boolean) {
  const deadline = Date.now() + ITEM_TIMEOUT;
  let previous: number | null = null;
  while (true) {
    const height = await itemContentHeight(itemId);
    if (height === null) { return; }    // Nothing collapsible here, nothing to wait for.
    // Require non-zero when expanding, so readings taken before the transition starts do not
    // look settled. Covers a not-yet-started collapse too, where the height is still full.
    if (height === previous && (expanded ? height > 0 : height === 0)) { return; }
    previous = height;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for item ${itemId} to ${expanded ? "expand" : "collapse"}`);
    }
    // Sample well over one animation frame: back-to-back reads inside a frame would make a
    // mid-transition height look settled.
    await driver.sleep(50);
  }
}

async function isItemExpanded(itemId: string) {
  return (await itemContentHeight(itemId) ?? 0) > 0;
}

function itemHeader(itemId: string) {
  return itemElement(itemId).find(`.test-admin-panel-item-name-${itemId}`);
}

export async function toggleItem(itemId: string) {
  // Read state before clicking to know which way we are going.
  const wasExpanded = await isItemExpanded(itemId);
  await itemHeader(itemId).click();
  await waitForItemTransition(itemId, !wasExpanded);
}

/**
 * Idempotent counterpart to toggleItem. Tests in a file share a page, so an item may already be
 * in the requested state.
 */
async function setItemExpanded(itemId: string, expanded: boolean) {
  if (await isItemExpanded(itemId) !== expanded) {
    await itemHeader(itemId).click();
    await waitForItemTransition(itemId, expanded);
  }
}

export function itemValue(itemId: string) {
  return driver.findWait(`.test-admin-panel-item-value-${itemId}`, ITEM_TIMEOUT).getText();
}

/**
 * Returns an object to get the text and status of a section value.
 */
export function sectionValue(sectionId: string) {
  return {
    text: () => itemValue(sectionId),
    status: async () => {
      const item = await driver.findWait(`.test-admin-panel-item-value-${sectionId}`, ITEM_TIMEOUT);
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
  await setItemExpanded(itemId, true);
  await callback();
  await setItemExpanded(itemId, false);
}

/**
 * Finds an item's toggle switch. Pass `visible: true` before clicking: HidableToggle keeps the
 * switch hidden until its value arrives, and clicking a hidden element throws
 * ElementNotInteractableError. Re-finds on each poll, since the panel re-renders as values land.
 */
export async function switchElement(name: string, options: { visible?: boolean } = {}) {
  const selector = `.test-admin-panel-item-value-${name} .test-toggle-switch`;
  await driver.wait(async () => {
    try {
      const [elem] = await driver.findAll(selector);
      if (!elem) { return false; }
      return options.visible ? await elem.isDisplayed() : true;
    } catch (e) {
      return false;   // Replaced mid-poll.
    }
  }, ITEM_TIMEOUT, `Timed out waiting for toggle switch ${JSON.stringify(selector)}`);
  return driver.find(selector);
}

export async function clickSwitch(name: string) {
  const toggle = await switchElement(name, { visible: true });
  await toggle.click();
  await gu.waitForServer();
}

export async function isEnabled(switchElem: WebElement | string) {
  if (typeof switchElem === "string") {
    switchElem = await switchElement(switchElem);
  }
  return (await switchElem.find("input").getAttribute("checked")) === null ? false : true;
}

/**
 * If the authentication provider list is collapsed, click the header to expand it.
 */
export async function expandProviderList() {
  // Wait for the provider list header to appear. It may be non-collapsible
  // (no aria-expanded) or collapsible (aria-expanded="false" when collapsed).
  const header = await driver.findWait(".test-admin-auth-provider-list-header", 2000);
  if (await header.getAttribute("aria-expanded") === "false") {
    await header.click();
    // Wait for the provider rows to render after expanding.
    await driver.findWait(".test-admin-auth-provider-row", 2000);
  }
}

export async function currentVersion() {
  const currentVersionText = await driver.find(".test-admin-panel-item-value-version").getText();
  const currentVersion = currentVersionText.match(/Version (.+)/)![1];
  return currentVersion;
}
