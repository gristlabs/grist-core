import { addToRepl, driver, WebElementPromise } from "mocha-webdriver";
import * as gu from "test/nbrowser/gristUtils";

export async function openRelativeOptionsMenu(minMax: 'min'|'max') {
  if (!await driver.find('.grist-floatin-menu').isPresent()) {
    await driver.find(`.test-filter-menu-${minMax}`).click();
  }
}

export async function findCalendarDates(selector: string): Promise<string[]> {
  let res: string[] = [];
  await gu.waitToPass(async () => {
    res = await driver.findAll(`.datepicker-inline td.day${selector}`, e => e.getText());
  });
  return res;
}

export function isOptionsVisible() {
  return driver.find('.test-filter-menu-wrapper .grist-floating-menu').isPresent();
}

export async function isBoundSelected(minMax: 'min'|'max') {
  return driver.find(`.test-filter-menu-${minMax}.selected`).isPresent();
}

export async function getSelected(): Promise<'min'|'max'|undefined> {
  if (await isBoundSelected('min')) { return 'min'; }
  if (await isBoundSelected('max')) { return 'max'; }
}

export function pickDateInCurrentMonth(date: string) {
  return driver.findContent('.datepicker-inline td.day', date).click();
}

export async function getViewType() {
  return await driver.findContent('.test-calendar-links button', 'List view').isPresent() ? 'Calendar' : 'Default';
}

export async function switchToDefaultView() {
  await driver.findContent('.test-calendar-links button', 'List view').click();
}

export function getSelectedOption() {
  return driver.findAll('.grist-floating-menu li[class*=-sel]', e => e.getText());
}


export function findBound(minMax: 'min'|'max') {
  return new WebElementPromise(driver, driver.find(`.test-filter-menu-${minMax}`));
}

export async function setBound(minMax: 'min'|'max', value: string|{relative: string}|null) {
  return gu.setRangeFilterBound(minMax, value);
}

export async function getBoundText(minMax: 'min'|'max') {
  const bound = findBound(minMax);
  return (await bound.getText())
    || (await bound.find('input').value())
    || (await bound.find('input').getAttribute('placeholder')).trim();
}

export function addFilterUtilsToRepl() {
  addToRepl('gu', gu);
  addToRepl('findBound', findBound);
  addToRepl('getBountText', getBoundText);
  addToRepl('findCalendarDates', findCalendarDates);
  addToRepl('setBound', setBound);
  addToRepl('getSelected', getSelected);
  addToRepl('isOptionsVisible', isOptionsVisible);
  addToRepl('pickDateInCurrentMonth', pickDateInCurrentMonth);
  addToRepl('getViewType', getViewType);
  addToRepl('getSelectedOption', getSelectedOption);
}
