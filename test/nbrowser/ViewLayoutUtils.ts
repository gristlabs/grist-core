import {assert, driver} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';

export async function closeExpandedSection() {
  await driver.find(".test-viewLayout-overlay .test-close-button").click();
  await gu.waitToPass(async () => {
    assert.isFalse(await driver.find(".test-viewLayout-overlay").matches("[class*=-active]"));
  });
}

export async function sectionIsExpanded() {
  // Check that we see the overlay
  assert.isTrue(await driver.find(".test-viewLayout-overlay").matches("[class*=-active]"));

  // Visually check that the section is expanded.
  assert.isTrue(await driver.find(".active_section").isDisplayed());
  const section = await driver.find(".active_section").getRect();
  const doc = await driver.find(".test-gristdoc").getRect();
  assert.isTrue(Math.abs(section.height + 48 - doc.height) < 4);
  assert.isTrue(Math.abs(section.width + 112 - doc.width) < 4);

  // Get all other sections on the page and make sure they are hidden.
  const otherSections = await driver.findAll(".view_leaf:not(.active_section)");
  for (const otherSection of otherSections) {
    assert.isFalse(await otherSection.isDisplayed());
  }

  // Make sure we see the close button.
  assert.isTrue(await driver.find(".test-viewLayout-overlay .test-close-button").isDisplayed());
}

/**
 * Opens the section menu for a collapsed section.
 */
export async function openCollapsedSectionMenu(section: string|RegExp) {
  await getCollapsedSection(section).find(`.test-section-menu-viewLayout`).click();
  await driver.findWait('.grist-floating-menu', 100);
}

export function getCollapsedSection(section: string|RegExp) {
  if (typeof section === 'string') {
    section = gu.exactMatch(section, 'i');
  }
  return driver.findContentWait('.test-collapsed-section .test-collapsed-section-title', section, 100)
               .findClosest('.test-collapsed-section');
}
