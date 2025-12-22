import {driver, Key} from "mocha-webdriver";
import {assert} from "chai";
import * as gu from "test/nbrowser/gristUtils";

export const STANDARD_WAITING_TIME = 1000;

export async function clickAddColumn() {
  const isMenuPresent = await driver.find(".test-new-columns-menu").isPresent();
  if (!isMenuPresent) {
    await driver.findWait(".mod-add-column", STANDARD_WAITING_TIME).click();
  }
  await driver.findWait(".test-new-columns-menu", STANDARD_WAITING_TIME);
}

export async function isMenuPresent() {
  return await driver.find(".test-new-columns-menu").isPresent();
}

export async function closeAddColumnMenu() {
  await driver.sendKeys(Key.ESCAPE);
  await gu.waitToPass(async () => assert.isFalse(await isMenuPresent(), 'menu is still present'));
}

export async function hasAddNewColumMenu() {
  await isDisplayed('.test-new-columns-menu-add-new', 'add new column menu is not present');
}

export async function isDisplayed(selector: string, message: string) {
  assert.isTrue(await driver.findWait(selector, STANDARD_WAITING_TIME, message).isDisplayed(), message);
}

export async function hasShortcuts() {
  await isDisplayed('.test-new-columns-menu-shortcuts', 'shortcuts section is not present');
  await isDisplayed('.test-new-columns-menu-shortcuts-timestamp', 'timestamp shortcuts section is not present');
  await isDisplayed('.test-new-columns-menu-shortcuts-author', 'authorship shortcuts section is not present');
}

export async function hasLookupMenu(colId: string) {
  await isDisplayed('.test-new-columns-menu-lookup', 'lookup section is not present');
  await isDisplayed(`.test-new-columns-menu-lookup-${colId}`, `lookup section for ${colId} is not present`);
}

export async function collapsedHiddenColumns() {
  return await driver.findAll('.test-new-columns-menu-hidden-column-collapsed', el => el.getText());
}

export function revertEach() {
  let revert: () => Promise<void>;
  beforeEach(async function () {
    revert = await gu.begin();
  });

  gu.afterEachCleanup(async function () {
    if (await isMenuPresent()) {
      await closeAddColumnMenu();
    }
    await revert();
  });
}


export function revertThis() {
  let revert: () => Promise<void>;
  before(async function () {
    revert = await gu.begin();
  });

  gu.afterCleanup(async function () {
    if (await isMenuPresent()) {
      await closeAddColumnMenu();
    }
    await revert();
  });
}

export async function addRefListLookup(refListId: string, colId: string, func: string) {
  await clickAddColumn();
  await driver.findWait(`.test-new-columns-menu-lookup-${refListId}`, STANDARD_WAITING_TIME).click();
  await driver.findWait(`.test-new-columns-menu-lookup-submenu-${colId}`, STANDARD_WAITING_TIME).mouseMove();
  await driver.findWait(`.test-new-columns-menu-lookup-submenu-function-${func}`, STANDARD_WAITING_TIME).click();
  await gu.waitForServer();
}

export async function checkTypeAndFormula(type: string, formula: string) {
  assert.equal(await gu.getType(), type);
  await driver.find('.formula_field_sidepane').click();
  const actual = await gu.getFormulaText(false).then(s => s.trim());
  if (!actual) {
    throw new Error('Formula field is empty');
  }
  assert.equal(actual, formula);
  await gu.sendKeys(Key.ESCAPE);
}

export const PERCENT = (ref: string, col: string) => `ref = ${ref}\nAVERAGE(map(int, ref.${col})) if ref else None`;
export const AVERAGE = (ref: string, col: string) => `ref = ${ref}\nAVERAGE(ref.${col}) if ref else None`;
export const MIN = (ref: string, col: string) => `ref = ${ref}\nMIN(ref.${col}) if ref else None`;
export const MAX = (ref: string, col: string) => `ref = ${ref}\nMAX(ref.${col}) if ref else None`;
