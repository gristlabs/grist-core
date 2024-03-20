/**
 * Replicates functionality of test/nbrowser/gristUtils.ts for new-style tests.
 *
 * The helpers are themselves tested in TestGristUtils.ts.
 */
import * as fse from 'fs-extra';
import escapeRegExp = require('lodash/escapeRegExp');
import noop = require('lodash/noop');
import startCase = require('lodash/startCase');
import { assert, By, driver as driverOrig, error, Key, WebElement, WebElementPromise } from 'mocha-webdriver';
import { stackWrapFunc, stackWrapOwnMethods, WebDriver } from 'mocha-webdriver';
import * as path from 'path';
import * as PluginApi from 'app/plugin/grist-plugin-api';

import {CommandName} from 'app/client/components/commandList';
import {csvDecodeRow} from 'app/common/csvFormat';
import { AccessLevel } from 'app/common/CustomWidget';
import { decodeUrl } from 'app/common/gristUrls';
import { FullUser, UserProfile } from 'app/common/LoginSessionAPI';
import { resetOrg } from 'app/common/resetOrg';
import { UserAction } from 'app/common/DocActions';
import { TestState } from 'app/common/TestState';
import { Organization as APIOrganization, DocStateComparison,
         UserAPI, UserAPIImpl, Workspace } from 'app/common/UserAPI';
import { Organization } from 'app/gen-server/entity/Organization';
import { Product } from 'app/gen-server/entity/Product';
import { create } from 'app/server/lib/create';
import { getAppRoot } from 'app/server/lib/places';

import { GristWebDriverUtils, PageWidgetPickerOptions,
         WindowDimensions as WindowDimensionsBase } from 'test/nbrowser/gristWebDriverUtils';
import { HomeUtil } from 'test/nbrowser/homeUtil';
import { server } from 'test/nbrowser/testServer';
import type { Cleanup } from 'test/nbrowser/testUtils';
import { fetchScreenshotAndLogs } from 'test/nbrowser/webdriverUtils';
import * as testUtils from 'test/server/testUtils';
import type { AssertionError } from 'assert';
import axios from 'axios';
import { lock } from 'proper-lockfile';

// tslint:disable:no-namespace
// Wrap in a namespace so that we can apply stackWrapOwnMethods to all the exports together.
namespace gristUtils {

// Allow overriding the global 'driver' to use in gristUtil.
let _driver: WebDriver|undefined;
const driver: WebDriver = new Proxy({} as any, {
  get(_, prop) {
    if (!_driver) {
      return (driverOrig as any)[prop];
    }
    return (_driver as any)[prop];  // eslint-disable-line @typescript-eslint/no-unnecessary-type-assertion
  }
});

export function currentDriver() { return driver; }

// Substitute a custom driver to use with gristUtils functions. Omit argument to restore to default.
export function setDriver(customDriver?: WebDriver) { _driver = customDriver; }

const homeUtil = new HomeUtil(testUtils.fixturesRoot, server);
const webdriverUtils = new GristWebDriverUtils(driver);

export const createNewDoc = homeUtil.createNewDoc.bind(homeUtil);
// importFixturesDoc has a custom implementation that supports 'load' flag.
export const uploadFixtureDoc = homeUtil.uploadFixtureDoc.bind(homeUtil);
export const getWorkspaceId = homeUtil.getWorkspaceId.bind(homeUtil);
export const listDocs = homeUtil.listDocs.bind(homeUtil);
export const createHomeApi = homeUtil.createHomeApi.bind(homeUtil);
export const getApiKey = homeUtil.getApiKey.bind(homeUtil);
export const simulateLogin = homeUtil.simulateLogin.bind(homeUtil);
export const removeLogin = homeUtil.removeLogin.bind(homeUtil);
export const enableTips = homeUtil.enableTips.bind(homeUtil);
export const disableTips = homeUtil.disableTips.bind(homeUtil);
export const setValue = homeUtil.setValue.bind(homeUtil);
export const isOnLoginPage = homeUtil.isOnLoginPage.bind(homeUtil);
export const isOnGristLoginPage = homeUtil.isOnLoginPage.bind(homeUtil);
export const checkLoginPage = homeUtil.checkLoginPage.bind(homeUtil);
export const checkGristLoginPage = homeUtil.checkGristLoginPage.bind(homeUtil);
export const copyDoc = homeUtil.copyDoc.bind(homeUtil);

export const isSidePanelOpen = webdriverUtils.isSidePanelOpen.bind(webdriverUtils);
export const waitForServer = webdriverUtils.waitForServer.bind(webdriverUtils);
export const waitForSidePanel = webdriverUtils.waitForSidePanel.bind(webdriverUtils);
export const toggleSidePanel = webdriverUtils.toggleSidePanel.bind(webdriverUtils);
export const getWindowDimensions = webdriverUtils.getWindowDimensions.bind(webdriverUtils);
export const addNewSection = webdriverUtils.addNewSection.bind(webdriverUtils);
export const selectWidget = webdriverUtils.selectWidget.bind(webdriverUtils);
export const dismissBehavioralPrompts = webdriverUtils.dismissBehavioralPrompts.bind(webdriverUtils);
export const toggleSelectable = webdriverUtils.toggleSelectable.bind(webdriverUtils);
export const waitToPass = webdriverUtils.waitToPass.bind(webdriverUtils);
export const refreshDismiss = webdriverUtils.refreshDismiss.bind(webdriverUtils);
export const acceptAlert = webdriverUtils.acceptAlert.bind(webdriverUtils);
export const isAlertShown = webdriverUtils.isAlertShown.bind(webdriverUtils);
export const waitForDocToLoad = webdriverUtils.waitForDocToLoad.bind(webdriverUtils);
export const reloadDoc = webdriverUtils.reloadDoc.bind(webdriverUtils);

export const fixturesRoot: string = testUtils.fixturesRoot;

// it is sometimes useful in debugging to turn off automatic cleanup of docs and workspaces.
export const noCleanup = Boolean(process.env.NO_CLEANUP);

export type WindowDimensions = WindowDimensionsBase;

// Most test code uses simulateLogin through the server reference. Keep them to reduce unnecessary
// code changes.
server.simulateLogin = simulateLogin;
server.removeLogin = removeLogin;

export interface IColSelect<T = WebElement> {
  col: number|string;
  rowNums: number[];
  section?: string|WebElement;
  mapper?: (e: WebElement) => Promise<T>;
}

export interface ICellSelect {
  col: number|string;
  rowNum: number;
  section?: string|WebElement;
}

export interface IColHeader {
  col: number|string;
  section?: string|WebElement;
}

export interface IColsSelect<T = WebElement> {
  cols: Array<number|string>;
  rowNums: number[];
  section?: string|WebElement;
  mapper?: (e: WebElement) => Promise<T>;
}

/**
 * Helper for exact string matches using interfaces that expect a RegExp. E.g.
 *    driver.findContent('.selector', exactMatch("Foo"))
 *
 * TODO It would be nice if mocha-webdriver allowed exact string match in findContent() (it now
 * supports a substring match, but we still need a helper for an exact match).
 */
export function exactMatch(value: string, flags?: string): RegExp {
  return new RegExp(`^${escapeRegExp(value)}$`, flags);
}

/**
 * Helper function that creates a regular expression to match the beginning of the string.
 */
export function startsWith(value: string): RegExp {
  return new RegExp(`^${escapeRegExp(value)}`);
}


/**
 * Helper function that creates a regular expression to match the anywhere in of the string.
 */
 export function contains(value: string): RegExp {
  return new RegExp(`${escapeRegExp(value)}`);
}

/**
 * Helper to scroll an element into view. Returns the passed-in element.
 */
export function scrollIntoView(elem: WebElement): WebElementPromise {
  return new WebElementPromise(driver,
    driver.executeScript((el: any) => el.scrollIntoView({behavior: 'auto'}), elem)
    .then(() => elem));
}

/**
 * Returns the current user of gristApp in the currently-loaded page.
 */
export async function getUser(waitMs: number = 1000): Promise<FullUser> {
  const user = await driver.wait(() => driver.executeScript(`
    const appObs = window.gristApp && window.gristApp.topAppModel.appObs.get();
    return appObs && appObs.currentUser;
  `), waitMs) as FullUser;
  if (!user) { throw new Error('could not find user'); }
  return user;
}

/**
 * Returns the current org of gristApp in the currently-loaded page.
 */
export async function getOrg(waitMs: number = 1000): Promise<APIOrganization> {
  const org = await driver.wait(() => driver.executeScript(`
    const appObs = window.gristApp && window.gristApp.topAppModel.appObs.get();
    return appObs && appObs.currentOrg;
  `), waitMs) as APIOrganization;
  if (!org) { throw new Error('could not find org'); }
  return org;
}

/**
 * Returns the email of the current user of gristApp in the currently-loaded page.
 */
export async function getEmail(waitMs: number = 1000): Promise<string> {
  return (await getUser(waitMs)).email;
}

/**
 * Returns the name of the current user of gristApp in the currently-loaded page.
 */
export async function getName(waitMs: number = 1000): Promise<string> {
  return (await getUser(waitMs)).name;
}

/**
 * Returns any comparison information in the currently-loaded page.
 */
export async function getComparison(waitMs: number = 1000): Promise<DocStateComparison|null> {
  const result = await driver.wait(() => driver.executeScript(`
    return window.gristDocPageModel?.gristDoc?.get()?.comparison;
  `), waitMs) as DocStateComparison;
  return result || null;
}

export async function testCurrentUrl(pattern: RegExp|string) {
  const url = await driver.getCurrentUrl();
  return (typeof pattern === 'string') ? url.includes(pattern) : pattern.test(url);
}

export async function getDocWorkerUrls(): Promise<string[]> {
  const result = await driver.wait(() => driver.executeScript(`
    return Array.from(window.gristApp.comm.listConnections().values());
  `), 1000) as string[];
  return result;
}

export async function getDocWorkerUrl(): Promise<string> {
  const urls = await getDocWorkerUrls();
  if (urls.length > 1) {
    throw new Error(`Expected a single docWorker URL, received ${urls}`);
  }
  return urls[0] || '';
}

export async function waitForUrl(pattern: RegExp|string, waitMs: number = 2000) {
  await driver.wait(() => testCurrentUrl(pattern), waitMs);
}


export async function dismissWelcomeTourIfNeeded() {
  const elem = driver.find('.test-onboarding-close');
  if (await elem.isPresent()) {
    await elem.click();
  }
  await waitForServer();
}

// Selects all text when a text element is currently active.
export async function selectAll() {
  await driver.executeScript('document.activeElement.select()');
}

/**
 * Returns a WebElementPromise for the .viewsection_content element for the section which contains
 * the given text (case insensitive) content.
 */
export function getSection(sectionOrTitle: string|WebElement): WebElement|WebElementPromise {
  if (typeof sectionOrTitle !== 'string') { return sectionOrTitle; }
  return driver.findContent(`.test-viewsection-title`, new RegExp("^" + escapeRegExp(sectionOrTitle) + "$", 'i'))
    .findClosest('.viewsection_content');
}

/**
 * Click into a section without disrupting cursor positions.
 */
export async function selectSectionByTitle(title: string|RegExp) {
  try {
    if (typeof title === 'string') {
      title = new RegExp("^" + escapeRegExp(title) + "$", 'i');
    }
    // .test-viewsection is a special 1px width element added for tests only.
    await driver.findContent(`.test-viewsection-title`, title).find(".test-viewsection-blank").click();
  } catch (e) {
    // We might be in mobile view.
    await driver.findContent(`.test-viewsection-title`, title).findClosest(".view_leaf").click();
  }
}

export async function expandSection(title?: string) {
  const select = title
    ? driver.findContent(`.test-viewsection-title`, exactMatch(title)).findClosest(".viewsection_title")
    : driver.find(".active_section");
  await select.find(".test-section-menu-expandSection").click();
  await driver.findWait('.test-viewLayout-overlay .test-close-button', 500);
}

export async function getSectionId() {
  const classList = await driver.find(".active_section").getAttribute("class");
  const match = classList.match(/test-viewlayout-section-(\d+)/);
  if (!match) { throw new Error("Could not find section id"); }
  return parseInt(match[1]);
}

/**
 * Returns visible cells of the GridView from a single column and one or more rows. Options may be
 * given as arguments directly, or as an object.
 * - col: column name, or 0-based column index
 * - rowNums: array of 1-based row numbers, as visible in the row headers on the left of the grid.
 * - section: optional name of the section to use; will use active section if omitted.
 *
 * If given by an object, then an array of columns is also supported. In this case, the return
 * value is still a single array, listing all values from the first row, then the second, etc.
 *
 * Returns cell text by default. Mapper may be `identity` to return the cell objects.
 */
export async function getVisibleGridCells(col: number|string, rows: number[], section?: string): Promise<string[]>;
export async function getVisibleGridCells<T = string>(options: IColSelect<T>|IColsSelect<T>): Promise<T[]>;
export async function getVisibleGridCells<T>(
  colOrOptions: number|string|IColSelect<T>|IColsSelect<T>, _rowNums?: number[], _section?: string
): Promise<T[]> {

  if (typeof colOrOptions === 'object' && 'cols' in colOrOptions) {
    const {rowNums, section, mapper} = colOrOptions;    // tslint:disable-line:no-shadowed-variable
    const columns = await Promise.all(colOrOptions.cols.map((oneCol) =>
      getVisibleGridCells({col: oneCol, rowNums, section, mapper})));
    // This zips column-wise data into a flat row-wise array of values.
    return ([] as T[]).concat(...rowNums.map((r, i) => columns.map((c) => c[i])));
  }

  const {col, rowNums, section, mapper = el => el.getText()}: IColSelect<any> = (
    typeof colOrOptions === 'object' ? colOrOptions :
    { col: colOrOptions, rowNums: _rowNums!, section: _section}
  );

  if (rowNums.includes(0)) {
    // Row-numbers should be what the users sees: 0 is a mistake, so fail with a helpful message.
    throw new Error('rowNum must not be 0');
  }

  const sectionElem = section ? await getSection(section) : await driver.findWait('.active_section', 4000);
  const colIndex = (typeof col === 'number' ? col :
    await sectionElem.findContent('.column_name', exactMatch(col)).index());

  const visibleRowNums: number[] = await sectionElem.findAll('.gridview_data_row_num',
    async (el) => parseInt(await el.getText(), 10));

  const selector = `.gridview_data_scroll .record:not(.column_names) .field:nth-child(${colIndex + 1})`;
  const fields = mapper ? await sectionElem.findAll(selector, mapper) : await sectionElem.findAll(selector);
  return rowNums.map((n) => fields[visibleRowNums.indexOf(n)]);
}

/**
 * Experimental fast version of getVisibleGridCells that reads data directly from browser by
 * invoking javascript code.
 */
export async function getVisibleGridCellsFast(col: string, rowNums: number[]): Promise<string[]>
export async function getVisibleGridCellsFast(options: {cols: string[], rowNums: number[]}): Promise<string[]>
export async function getVisibleGridCellsFast(colOrOptions: any, rowNums?: number[]): Promise<string[]>{
  if (rowNums) {
    return getVisibleGridCellsFast({cols: [colOrOptions], rowNums});
  }
  // Make sure we have active section.
  await driver.findWait('.active_section', 4000);
  const cols = colOrOptions.cols;
  const rows = colOrOptions.rowNums;
  const result = await driver.executeScript(`
  const cols = arguments[0];
  const rowNums = arguments[1];
  // Read all columns and create object { ['ColName'] : index }
  const columns = Object.fromEntries([...document.querySelectorAll(".g-column-label")]
                      .map((col, index) => [col.innerText, index]))
  const result = [];
  // Read all rows and create object { [rowIndex] : RowNumberElement }
  const rowNumElements = Object.fromEntries([...document.querySelectorAll(".gridview_data_row_num")]
                            .map((row) => [Number(row.innerText), row]))
  for(const r of rowNums) {
    // If this is addRow, insert undefined x cols.length.
    if (rowNumElements[r].parentElement.querySelector('.record-add')) {
      result.push(...new Array(cols.length));
      continue;
    }
    // Read all values from a row, and create an object { [cellIndex] : 'cell value' }
    const values = Object.fromEntries([...rowNumElements[String(r)].parentElement.querySelectorAll('.field_clip')]
                    .map((f, i) => [i, f.innerText]));
    result.push(...cols.map(c => values[columns[c]]))
  }
  return result; `, cols, rows);
  return result as string[];
}


/**
 * Returns the visible cells of the DetailView in the given field (using column name) at the
 * given row numbers (1-indexed). For example:
 *
 *    gu.getVisibleDetailCells({col: "Name", rowNums: [1, 2, 3]});
 *
 * Returns cell text by default. Mapper may be `identity` to return the cell objects.
 *
 * If rowNums are not shown (for single-card view), use rowNum of 1.
 */
export async function getVisibleDetailCells(col: number|string, rows: number[], section?: string): Promise<string[]>;
export async function getVisibleDetailCells<T = string>(options: IColSelect<T>|IColsSelect<T>): Promise<T[]>;
export async function getVisibleDetailCells<T>(
  colOrOptions: number|string|IColSelect<T>|IColsSelect<T>, _rowNums?: number[], _section?: string
): Promise<T[]> {

  if (typeof colOrOptions === 'object' && 'cols' in colOrOptions) {
    const {rowNums, section, mapper} = colOrOptions;    // tslint:disable-line:no-shadowed-variable
    const columns = await Promise.all(colOrOptions.cols.map((oneCol) =>
      getVisibleDetailCells({col: oneCol, rowNums, section, mapper})));
    // This zips column-wise data into a flat row-wise array of values.
    return ([] as T[]).concat(...rowNums.map((r, i) => columns.map((c) => c[i])));
  }

  const {col, rowNums, section, mapper = el => el.getText()}: IColSelect<any> = (
    typeof colOrOptions === 'object' ? colOrOptions :
    { col: colOrOptions, rowNums: _rowNums!, section: _section}
  );

  const sectionElem = section ? await getSection(section) : await driver.findWait('.active_section', 4000);
  const visibleRowNums: number[] = await sectionElem.findAll('.detail_row_num',
    async (el) => parseInt((await el.getText()).replace(/^#/, ''), 10) || 1);

  const colName = (typeof col === 'string') ? col :
    await (await sectionElem.find(".g_record_detail_inner").findAll('.g_record_detail_label'))[col].getText();

  const records = await sectionElem.findAll(".g_record_detail_inner");
  const selected = rowNums.map((n) => records[visibleRowNums.indexOf(n)]);
  return Promise.all(selected.map((el) => mapper(
    el.findContent('.g_record_detail_label', exactMatch(colName))
    .findClosest('.g_record_detail_el').find('.g_record_detail_value')
  )));
}


/**
 * Returns a visible GridView cell. Options may be given as arguments directly, or as an object.
 * - col: column name, or 0-based column index
 * - rowNum: 1-based row numbers, as visible in the row headers on the left of the grid.
 * - section: optional name of the section to use; will use active section if omitted.
 */
export function getCell(col: number|string, rowNum: number, section?: string): WebElementPromise;
export function getCell(options: ICellSelect): WebElementPromise;
export function getCell(colOrOptions: number|string|ICellSelect, rowNum?: number, section?: string): WebElementPromise {
  const mapper = async (el: WebElement) => el;
  const options: IColSelect<WebElement> = (typeof colOrOptions === 'object' ?
    {col: colOrOptions.col, rowNums: [colOrOptions.rowNum], section: colOrOptions.section, mapper} :
    {col: colOrOptions, rowNums: [rowNum!], section, mapper});
  return new WebElementPromise(driver, getVisibleGridCells(options).then((elems) => elems[0]));
}


/**
 * Returns a visible DetailView cell, for the given record and field.
 */
export function getDetailCell(col: string, rowNum: number, section?: string): WebElementPromise;
export function getDetailCell(options: ICellSelect): WebElementPromise;
export function getDetailCell(colOrOptions: string|ICellSelect, rowNum?: number, section?: string): WebElementPromise {
  const mapper = async (el: WebElement) => el;
  const options: IColSelect<WebElement> = (typeof colOrOptions === 'object' ?
    {col: colOrOptions.col, rowNums: [colOrOptions.rowNum], section: colOrOptions.section, mapper} :
    {col: colOrOptions, rowNums: [rowNum!], section, mapper});
  return new WebElementPromise(driver, getVisibleDetailCells(options).then((elems) => elems[0]));
}

/**
 * Gets a cell on a single card page.
 */
export function getCardCell(col: string, section?: string) {
  return getDetailCell({col, rowNum: 1, section});
}


/**
 * Returns the cell containing the cursor in the active section, works for both Grid and Detail.
 */
export function getActiveCell(): WebElementPromise {
  return driver.find('.active_section .selected_cursor').findClosest('.g_record_detail_value,.field');
}


/**
 * Returns a visible GridView row from the active section.
 */
export function getRow(rowNum: number): WebElementPromise {
  return driver.findContent('.active_section .gridview_data_row_num', String(rowNum));
}

/**
 * Get the numeric value from the row header of the first selected row. This would correspond to
 * the row with the cursor when a single rows is selected.
 */
export async function getSelectedRowNum(section?: string): Promise<number> {
  const sectionElem = section ? await getSection(section) : await driver.find('.active_section');
  const rowNum = await sectionElem.find('.gridview_data_row_num.selected').getText();
  return parseInt(rowNum, 10);
}

/**
 * Returns the total row count in the grid that is the active section by scrolling to the bottom
 * and examining the last row number. The count includes the special "Add Row".
 */
export async function getGridRowCount(): Promise<number> {
  await sendKeys(Key.chord(await modKey(), Key.DOWN));
  const rowNum = await driver.find('.active_cursor')
      .findClosest('.gridview_row').find('.gridview_data_row_num').getText();
  return parseInt(rowNum, 10);
}

/**
 * Returns the total row count in the card list that is the active section by scrolling to the bottom
 * and examining the last row number. The count includes the special "Add Row".
 */
export async function getCardListCount(): Promise<number> {
  await sendKeys(Key.chord(await modKey(), Key.DOWN));
  const rowNum = await driver.find('.active.detailview_record_detail .detail_row_num').getText();
  return parseInt(rowNum, 10);
}

/**
 * Returns the total row count in the card widget that is the active section by looking
 * at the displayed count in the section header. The count includes the special "Add Row".
 */
export async function getCardCount(): Promise<number> {
  const section = await driver.findWait('.active_section', 4000);
  const counter = await section.findAll(".grist-single-record__menu__count");
  if (counter.length) {
    const cardRow = (await counter[0].getText()).split(' OF ')[1];
    return  parseInt(cardRow) + 1;
  }
  return 1;
}

/**
 * Return the .column-name element for the specified column, which may be specified by full name
 * or index, and may include a section (or will use the active section by default).
 */
export function getColumnHeader(colOrColOptions: string|IColHeader): WebElementPromise {
  const colOptions = typeof colOrColOptions === 'string' ? {col: colOrColOptions} : colOrColOptions;
  const {col, section} = colOptions;
  const sectionElem = section ? getSection(section) : driver.findWait('.active_section', 4000);
  return new WebElementPromise(driver, typeof col === 'number' ?
    sectionElem.find(`.column_name:nth-child(${col + 1})`) :
    sectionElem.findContent('.column_name .kf_elabel_text', exactMatch(col)).findClosest('.column_name'));
}

export async function getColumnNames() {
  return (await driver.findAll('.column_name', el => el.getText()))
    .filter(name => name !== '+');
}

export async function getCardFieldLabels() {
  const section = await driver.findWait('.active_section', 4000);
  const firstCard = await section.find(".g_record_detail");
  const labels = await firstCard.findAll(".g_record_detail_label", el => el.getText());
  return labels;
}

/**
 * Resize the given grid column by a given number of pixels.
 */
export async function resizeColumn(colOptions: IColHeader, deltaPx: number) {
  await getColumnHeader(colOptions).find('.ui-resizable-handle').mouseMove();
  await driver.mouseDown();
  await driver.mouseMoveBy({x: deltaPx});
  await driver.mouseUp();
  await waitForServer();
}

/**
 * Performs dbClick
 * @param cell Element to click
 */
export async function dbClick(cell: WebElement) {
  await driver.withActions(a => a.doubleClick(cell));
}

export async function rightClick(cell: WebElement) {
  await driver.withActions((actions) => actions.contextClick(cell));
}

/**
 * Clicks a Reference List cell, taking care not to click the icon (which can
 * cause an unexpected Record Card popup to appear).
 */
export async function clickReferenceListCell(cell: WebElement) {
  const tokens = await cell.findAll('.test-ref-list-cell-token-label');
  if (tokens.length > 0) {
    await tokens[0].click();
  } else {
    await cell.click();
  }
}

/**
 * Gets the selector position in the Grid view section (or null if not present).
 * Selector is the black box around the row number.
 */
export async function getSelectorPosition(section?: WebElement|string) {
  if (typeof section === 'string') { section = await getSection(section); }
  section = section ?? await driver.findWait('.active_section', 4000);
  const hasSelector = await section.find('.link_selector_row').isPresent();
  return hasSelector && Number(await section.find('.link_selector_row .gridview_data_row_num').getText());
}

/**
 * Gets the arrow position in the Grid view section (or null if no arrow is present).
 */
export async function getArrowPosition(section?: WebElement|string) {
  if (typeof section === 'string') { section = await getSection(section); }
  section = section ?? await driver.findWait('.active_section', 4000);
  const arrow = section.find('.gridview_data_row_info.linked_dst');
  const hasArrow = await arrow.isPresent();
  return hasArrow ? Number(
      await arrow.findElement(By.xpath("./..")) //Get its parent
                 .getText()
    ) : null;
}

/**
 * Returns {rowNum, col} object representing the position of the cursor in the active view
 * section. RowNum is a 1-based number as in the row headers, and col is a 0-based index for
 * grid view or field name for detail view.
 */
export async function getCursorPosition(section?: WebElement|string) {
  return await retryOnStale(async () => {
    if (typeof section === 'string') { section = await getSection(section); }
    section = section ?? await driver.findWait('.active_section', 4000);
    const cursor = await section.findWait('.selected_cursor', 1000);
    // Query assuming the cursor is in a GridView and a DetailView, then use whichever query data
    // works out.
    const [colIndex, rowIndex, rowNum, colName] = await Promise.all([
      catchNoSuchElem(() => cursor.findClosest('.field').index()),
      catchNoSuchElem(() => cursor.findClosest('.gridview_row').index()),
      catchNoSuchElem(() => cursor.findClosest('.g_record_detail').find('.detail_row_num').getText()),
      catchNoSuchElem(() => cursor.findClosest('.g_record_detail_el')
        .find('.g_record_detail_label').getText())
    ]);
    if (rowNum && colName) {
      // This must be a detail view, and we just got the info we need.
      return {rowNum: parseInt(rowNum, 10), col: colName};
    } else {
      // We might be on a single card record
      const counter = await section.findAll(".grist-single-record__menu__count");
      if (counter.length) {
        const cardRow = (await counter[0].getText()).split(' OF ')[0];
        return { rowNum : parseInt(cardRow), col: colName };
      }
      // Otherwise, it's a grid view, and we need to use indices to look up the info.
      const gridRows = await section.findAll('.gridview_data_row_num');
      const gridRowNum = await gridRows[rowIndex].getText();
      return { rowNum: parseInt(gridRowNum, 10), col: colIndex };
    }
  });
}

/**
 * Catches any NoSuchElementError in a query callback and returns null as the result instead.
 */
async function catchNoSuchElem(query: () => any) {
  try {
    return await query();
  } catch (err) {
    if (err instanceof error.NoSuchElementError) { return null; }
    throw err;
  }
}

async function retryOnStale<T>(query: () => Promise<T>): Promise<T> {
  try {
    return await query();
  } catch (err) {
    if (err instanceof error.StaleElementReferenceError) { return await query(); }
    throw err;
  }
}


/**
 * Type keys in the currently active cell, then hit Enter to save, and wait for the server.
 * If the last key is TAB, DELETE, or ENTER, we assume the cell is already taken out of editing
 * mode, and don't send another ENTER.
 */
export async function enterCell(...keys: string[]) {
  const lastKey = keys[keys.length - 1];
  if (![Key.ENTER, Key.TAB, Key.DELETE].includes(lastKey)) {
    keys.push(Key.ENTER);
  }
  await driver.sendKeys(...keys);
  await waitForServer();    // Wait for the value to be saved
  await waitAppFocus();     // Wait for the cell editor to be closed (maybe unnecessary)
}

/**
 * Enter a formula into the currently selected cell.
 *
 * You can insert newlines by embedding `${Key.chord(Key.SHIFT, Key.ENTER)}` into the formula
 * text. Note that ACE editor adds some indentation automatically.
 */
export async function enterFormula(formula: string) {
  await driver.sendKeys('=');
  await waitAppFocus(false);
  if (await driver.find('.test-editor-tooltip-convert').isPresent()) {
    await driver.find('.test-editor-tooltip-convert').click();
  }
  await sendKeys(formula, Key.ENTER);
  await waitForServer();
}

/**
 * Check that formula editor is shown and returns its value.
 * By default returns only text that is visible to the user, pass false to get all text.
 */
export async function getFormulaText(onlyVisible = true): Promise<string> {
  assert.equal(await driver.findWait('.test-formula-editor', 500).isDisplayed(), true);
  if (onlyVisible) {
    return await driver.find('.code_editor_container').getText();
  } else {
    return await driver.executeScript(
      () => (document as any).querySelector(".code_editor_container").innerText
    );
  }
}

/**
 * Check that formula editor is shown and its value matches the given regexp.
 */
export async function checkFormulaEditor(value: RegExp|string) {
  const valueRe = typeof value === 'string' ? exactMatch(value) : value;
  assert.match(await getFormulaText(), valueRe);
}

/**
 * Check that plain text editor is shown and its value matches the given regexp.
 */
export async function checkTextEditor(value: RegExp|string) {
  assert.equal(await driver.findWait('.test-widget-text-editor', 500).isDisplayed(), true);
  const valueRe = typeof value === 'string' ? exactMatch(value) : value;
  assert.match(await driver.find('.celleditor_text_editor').value(), valueRe);
}

/**
 * Checks that token editor in a cell has a correct value. Converts all tokens to text including the input field
 * and joins them with newlines.
 */
export async function checkTokenEditor(value: RegExp|string) {
  assert.equal(await driver.findWait('.test-widget-text-editor', 500).isDisplayed(), true);
  const valueRe = typeof value === 'string' ? exactMatch(value) : value;
  const allTokens = await driver.findAll(
    '.test-widget-text-editor .test-tokenfield .test-tokenfield-token', e => e.getText());
  const inputToken = await driver.find('.test-widget-text-editor .test-tokenfield .test-tokenfield-input').value();
  const combined = [...allTokens, inputToken].join('\n').trim();
  assert.match(combined, valueRe);
}

/**
 * Enter rows of values into a GridView, starting at the given cell. Values are specified as a
 * list of rows, for examples `[['foo'], ['bar']]` will enter two rows, with one value in each.
 */
export async function enterGridRows(cell: ICellSelect, rowsOfValues: string[][]) {
  for (let i = 0; i < rowsOfValues.length; i++) {
    // Click the first cell in the row
    await getCell({...cell, rowNum: cell.rowNum + i}).click();
    // Enter all values, advancing with a TAB
    for (const value of rowsOfValues[i]) {
      await enterCell(value || Key.DELETE, Key.TAB);
    }
  }
}

/**
 * Set api key for user.  User should exist before this is called.
 */
export async function setApiKey(username: string, apiKey?: string) {
  apiKey = apiKey || `api_key_for_${username.toLowerCase()}`;
  const dbManager = await server.getDatabase();
  await dbManager.connection.query(`update users set api_key = $1 where name = $2`,
                                   [apiKey, username]);
  if (!await dbManager.getUserByKey(apiKey)) {
    throw new Error(`setApiKey failed: user ${username} may not yet be in the database`);
  }
}

/**
 * Reach into the DB to set the given org to use the given billing plan product.
 */
export async function updateOrgPlan(orgName: string, productName: string = 'team') {
  const dbManager = await server.getDatabase();
  const db = dbManager.connection.manager;
  const dbOrg = await db.findOne(Organization, {where: {name: orgName},
    relations: ['billingAccount', 'billingAccount.product']});
  if (!dbOrg) { throw new Error(`cannot find org ${orgName}`); }
  const product = await db.findOne(Product, {where: {name: productName}});
  if (!product) { throw new Error('cannot find product'); }
  dbOrg.billingAccount.product = product;
  await dbOrg.billingAccount.save();
}

export interface ImportOpts {
  load?: boolean;     // Defaults to true.
  newName?: string;   // Import under an alternative name.
  email?: string;      // Use api key associated with this email.
}

/**
 * Import a fixture doc into a workspace. Loads the document afterward unless `load` is false.
 *
 * Usage:
 *  > await importFixturesDoc('chimpy', 'nasa', 'Horizon', 'Hello.grist');
 */
// TODO New code should use {load: false} to prevent loading. The 'newui' value is now equivalent
// to the default ({load: true}), and should no longer be used in new code.
export async function importFixturesDoc(username: string, org: string, workspace: string,
                                        filename: string, options: ImportOpts|false|'newui' = {load: true}) {
  if (typeof options !== 'object') {
    options = {load: Boolean(options)};   // false becomes {load: false}, 'newui' becomes {load: true}
  }
  const doc = await homeUtil.importFixturesDoc(username, org, workspace, filename, options);
  if (options.load !== false) {
    await driver.get(server.getUrl(org, `/doc/${doc.id}`));
    await waitForDocToLoad();
  }
  return doc;
}

/**
 * Load a doc at the given URL relative to server.getHost(), e.g. "/o/ORG/doc/DOC_ID", and wait
 * for the doc to load (unless wait set to false).
 */
export async function loadDoc(relPath: string, wait: boolean = true): Promise<void> {
  await driver.get(`${server.getHost()}${relPath}`);
  if (wait) { await waitForDocToLoad(); }
}

export async function loadDocMenu(relPath: string, wait: boolean = true): Promise<void> {
  await driver.get(`${server.getHost()}${relPath}`);
  if (wait) { await waitForDocMenuToLoad(); }
}

/**
 * Wait for the doc list to show, to know that workspaces are fetched, and imports enabled.
 */
export async function waitForDocMenuToLoad(): Promise<void> {
  await driver.findWait('.test-dm-doclist', 2000);
  await driver.wait(() => driver.find('.test-dm-doclist').isDisplayed(), 2000);
}

// Checks if we are configured to store docs in s3, and returns access to s3 if so.
// For this to be useful in tests against deployments, s3-related env variables should
// be set to match the deployment.
export function getStorage()  {
  return create.ExternalStorage('doc', '') || null;
}

/**
 * Add a handler on the browser to prevent default action on the next click of an element
 * matching the given selector (it doesn't have to exist at the time of the call).
 * This handler is removed after one call. Used by fileDialogUpload().
 */
async function preventDefaultClickAction(selector: string) {
  function script(_selector: string) {
    function handler(ev: any) {
      if (ev.target.matches(_selector)) {
        document.body.removeEventListener("click", handler);
        ev.preventDefault();
      }
    }
    document.body.addEventListener("click", handler);
  }
  await driver.executeScript(script, selector);
}

/**
 * Upload the given file after running the triggerDialogFunc() which should open the file dialog.
 * Relies on #file_dialog_input <input type=file> element being used to open the dialog.
 */
export async function fileDialogUpload(filePath: string, triggerDialogFunc: () => Promise<void>) {
  // This is a bit of a hack to prevent the file dialog from opening (since the webdriver
  // seems unable to ever close it).
  await preventDefaultClickAction('#file_dialog_input');
  await triggerDialogFunc();

  // Hack to upload multiple files, paths should be separated with '\n'.
  // It only seems to work with Chrome
  const paths = filePath.split(',').map(f => path.resolve(fixturesRoot, f)).join("\n");
  await driver.find('#file_dialog_input').sendKeys(paths);
}

/**
 * From a document page, start import from a file, and wait for the import dialog to open.
 */
export async function importFileDialog(filePath: string): Promise<void> {
  await fileDialogUpload(filePath, async () => {
    await driver.wait(() => driver.find('.test-dp-add-new').isDisplayed(), 3000);
    await driver.findWait('.test-dp-add-new', 1000).doClick();
    await driver.findContent('.test-dp-import-option', /Import from file/i).doClick();
  });
  await driver.findWait('.test-importer-dialog', 5000);
  await waitForServer(10_000);
}

/**
 * From a document page, start an import from a URL.
 */
export async function importUrlDialog(url: string): Promise<void> {
  await driver.wait(() => driver.find('.test-dp-add-new').isDisplayed(), 3000);
  await driver.findWait('.test-dp-add-new', 1000).doClick();
  await driver.findContent('.test-dp-import-option', /Import from URL/i).doClick();
  await driver.findWait('.test-importer-dialog', 5000);
  await waitForServer();
  const iframe = driver.find('.test-importer-dialog').find('iframe');
  await driver.switchTo().frame(iframe);
  await setValue(await driver.findWait('#url', 5000), url);
  await driver.find('#ok').doClick();
  await driver.switchTo().defaultContent();
}

/**
 * Executed passed function in the context of given iframe, and then switching back to original context
 *
 */
export async function doInIframe<T>(func: () => Promise<T>): Promise<T>
export async function doInIframe<T>(iframe: WebElement, func: () => Promise<T>): Promise<T>
export async function doInIframe<T>(frameOrFunc: WebElement|(() => Promise<T>), func?: () => Promise<T>): Promise<T> {
  try {
    let iframe: WebElement;
    if (!func) {
      func = frameOrFunc as () => Promise<T>;
      iframe = await driver.findWait('iframe', 5000);
    } else {
      iframe = frameOrFunc as WebElement;
    }
    await driver.switchTo().frame(iframe);
    return await func();
  } finally {
    await driver.switchTo().defaultContent();
  }
}

/**
 * Starts or resets the collections of UserActions. This should be followed some time later by
 * a call to userActionsVerify() to check which UserActions were sent to the server. If the
 * argument is false, then stops the collection.
 */
export function userActionsCollect(yesNo: boolean = true) {
  return driver.executeScript("window.gristApp.comm.userActionsCollect(arguments[0])", yesNo);
}

/**
 * Verifies the list of UserActions collected since the last call to userActionsCollect() or
 * userActionsVerify(). ExpectedUserActions should be a list of actions, with each action in the
 * format of ["AddRecord", args...].
 */
export async function userActionsVerify(expectedUserActions: unknown[]): Promise<void> {
  try {
    assert.deepEqual(
      await driver.executeScript("return window.gristApp.comm.userActionsFetchAndReset()"),
      expectedUserActions);
  } catch (err) {
    const assertError = err as AssertionError;
    if (!Array.isArray(assertError.actual)) {
      throw new Error('userActionsVerify: no user actions, run userActionsCollect() first');
    }
    if (!Array.isArray(assertError.expected)) {
      throw new Error('userActionsVerify: no expected user actions');
    }

    assertError.actual = assertError.actual.map((a: any) => JSON.stringify(a) + ",").join("\n");
    assertError.expected = assertError.expected.map((a: any) => JSON.stringify(a) + ",").join("\n");
    assert.deepEqual(assertError.actual, assertError.expected);
    throw err;
  }
}

/**
 * Helper to get the cells of the importer Preview section. The cell text is returned from the
 * requested rows and columns in row-wise order.
 */
export async function getPreviewContents<T = string>(cols: number[], rowNums: number[],
                                                     mapper?: (e: WebElement) => Promise<T>): Promise<T[]> {
  await driver.findWait('.test-importer-preview .gridview_row', 1000);
  const section = await driver.find('.test-importer-preview');
  return getVisibleGridCells({cols, rowNums, section, mapper});
}

/**
 * Helper to get a cell from the importer Preview section.
 */
 export async function getPreviewCell(col: string|number, rowNum: number): Promise<WebElementPromise> {
  await driver.findWait('.test-importer-preview .gridview_row', 1000);
  const section = await driver.find('.test-importer-preview');
  return getCell({col, rowNum, section});
}

/**
 * Upload a file with the given path via the 'Add-New > Import' menu.
 */
export async function docMenuImport(filePath: string) {
  await fileDialogUpload(filePath, async () => {
    await driver.findWait('.test-dm-add-new', 1000).doClick();
    await driver.find('.test-dm-import').doClick();
  });
}


/**
 * Wait for the focus to return to the main application, i.e. the special .copypaste element that
 * normally has it (as opposed to an open cell editor, or a focus in some input or menu). Specify
 * `false` to wait for the focus to leave the main application.
 */
export async function waitAppFocus(yesNo: boolean = true): Promise<void> {
  await driver.wait(async () => (await driver.find('.copypaste').hasFocus()) === yesNo, 5000);
}

export async function waitForLabelInput(): Promise<void> {
  await driver.wait(async () => (await driver.findWait('.test-column-title-label', 100).hasFocus()), 300);
}

/**
 * Sends UserActions using client api from the browser.
 */
export async function sendActions(actions: UserAction[]) {
  await driver.manage().setTimeouts({
    script: 1000 * 2, /* 2 seconds, default is 0.5s */
  });

  // Make quick test that we have a list of actions not just a single action, by checking
  // if the first element is an array.
  if (actions.length && !Array.isArray(actions[0])) {
    throw new Error('actions argument should be a list of actions, not a single action');
  }

  const result = await driver.executeAsyncScript(`
    const done = arguments[arguments.length - 1];
    const prom = gristDocPageModel.gristDoc.get().docModel.docData.sendActions(${JSON.stringify(actions)});
    prom.then(() => done(null));
    prom.catch((err) => done(String(err?.message || err)));
  `);
  if (result) {
    throw new Error(result as string);
  }
  await waitForServer();
}

export async function getDocId() {
  const docId = await driver.wait(() => driver.executeScript(`
    return window.gristDocPageModel.currentDocId.get()
  `)) as string;
  if (!docId) { throw new Error('could not find doc'); }
  return docId;
}

/**
 * Confirms dialog for removing rows. In the future, can be used for other dialogs.
 */
export async function confirm(save = true, remember = false) {
  if (await driver.find(".test-confirm-save").isPresent()) {
    if (remember) {
      await driver.find(".test-confirm-remember").click();
    }
    if (save) {
      await driver.find(".test-confirm-save").click();
    } else {
      await driver.find(".test-confirm-cancel").click();
    }
  }
}

/** Hides all top banners by injecting css style */
export async function hideBanners() {
  const style = `.test-banner-element { display: none !important; }`;
  await driver.executeScript(`const style = document.createElement('style');
    style.innerHTML = ${JSON.stringify(style)};
    document.head.appendChild(style);`);
}

export async function assertBannerText(text: string | null) {
  if (text === null) {
    assert.isFalse(await driver.find('.test-banner').isPresent());
  } else {
    assert.equal(await driver.findWait('.test-doc-usage-banner-text', 2000).getText(), text);
  }
}

/**
 * Returns the left-panel item for the given page, given by a full string name, or a RegExp.
 * You may simply click it to switch to that page.
 */
export function getPageItem(pageName: string|RegExp): WebElementPromise {
  // If pageName is a string, search for an exact match.
  const matchName: RegExp = typeof pageName === 'string' ? exactMatch(pageName) : pageName;
  return driver.findContent('.test-docpage-label', matchName)
    .findClosest('.test-treeview-itemHeaderWrapper');
}

export async function openPage(name: string|RegExp) {
  await driver.findContentWait('.test-treeview-itemHeader', name, 500).find(".test-docpage-initial").doClick();
  await waitForServer(); // wait for table load
}

/**
 * Open the page menu for the specified page (by clicking the dots icon visible on hover).
 */
export async function openPageMenu(pageName: RegExp|string) {
  await getPageItem(pageName).mouseMove()
    .find('.test-docpage-dots').click();
}

/**
 * Returns a promise that resolves with the list of all page names.
 */
export function getPageNames(): Promise<string[]> {
  return driver.findAll('.test-docpage-label', (e) => e.getText());
}

export interface PageTree {
  label: string;
  children?: PageTree[];
}
/**
 * Returns a current page tree as a JSON object.
 */
export async function getPageTree(): Promise<PageTree[]> {
  const allPages = await driver.findAll('.test-docpage-label');
  const root: PageTree = {label: 'root', children: []};
  const stack: PageTree[] = [root];
  let current = 0;
  for(const page of allPages) {
    const label = await page.getText();
    const offset = await page.findClosest('.test-treeview-itemHeader').find('.test-treeview-offset');
    const level = parseInt((await offset.getCssValue('width')).replace("px", "")) / 10;
    if (level === current) {
      const parent = stack.pop()!;
      parent.children ??= [];
      parent.children.push({label});
      stack.push(parent);
    } else if (level > current) {
      current = level;
      const child = {label};
      const grandFather = stack.pop()!;
      grandFather.children ??= [];
      const father = grandFather.children[grandFather.children.length - 1];
      father.children ??= [];
      father.children.push(child);
      stack.push(grandFather);
      stack.push(father);
    } else {
      while (level < current) {
        stack.pop();
        current--;
      }
      const parent = stack.pop()!;
      parent.children ??= [];
      parent.children.push({label});
      stack.push(parent);
    }
  }
  return root.children!;
}

/**
 * Adds a new empty table using the 'Add New' menu.
 */
export async function addNewTable(name?: string) {
  await driver.findWait('.test-dp-add-new', 2000).click();
  await driver.find('.test-dp-empty-table').click();
  if (name) {
    const prompt = await driver.find(".test-modal-prompt");
    await prompt.doClear();
    await prompt.click();
    await driver.sendKeys(name);
  }
  await driver.find(".test-modal-confirm").click();
  await waitForServer();
}

// Add a new page using the 'Add New' menu and wait for the new page to be shown.
export async function addNewPage(
  typeRe: RegExp|'Table'|'Card'|'Card List'|'Chart'|'Custom'|'Form',
  tableRe: RegExp|string,
  options?: PageWidgetPickerOptions) {
  const url = await driver.getCurrentUrl();

  // Click the 'Page' entry in the 'Add New' menu
  await driver.findWait('.test-dp-add-new', 2000).doClick();
  await driver.find('.test-dp-add-new-page').doClick();

  // add widget
  await selectWidget(typeRe, tableRe, options);

  // wait new page to be selected
  await driver.wait(async () => (await driver.getCurrentUrl()) !== url, 2000);
}

export async function openAddWidgetToPage() {
  await driver.findWait('.test-dp-add-new', 2000).doClick();
  await driver.findWait('.test-dp-add-widget-to-page', 2000).doClick();
}

export type WidgetType = 'Table' | 'Card' | 'Card List' | 'Chart' | 'Custom';


export async function changeWidget(type: WidgetType) {
  await openWidgetPanel();
  await driver.findContent('.test-right-panel button', /Change Widget/).click();
  await selectWidget(type);
  await waitForServer();
}

/**
 * Rename the given page to a new name. The oldName can be a full string name or a RegExp.
 */
export async function renamePage(oldName: string|RegExp, newName?: string) {
  if (!newName && typeof oldName === 'string') {
    newName = oldName;
    oldName = await getCurrentPageName();
  }
  if (newName === undefined) { throw new Error('newName must be specified'); }
  await openPageMenu(oldName);
  await driver.find('.test-docpage-rename').click();
  await driver.find('.test-docpage-editor').sendKeys(newName, Key.ENTER);
  await waitForServer();
}

/**
 * Removes a page from the page menu, checks if the page is actually removable.
 * By default it will remove only page (handling prompt if necessary).
 */
export async function removePage(name: string|RegExp, options: {
  expectPrompt?: boolean, // default undefined
  withData?: boolean // default only page,
  tables?: string[],
  cancel?: boolean,
} = { }) {
  await openPageMenu(name);
  assert.equal(await driver.find('.test-docpage-remove').matches('.disabled'), false);
  await driver.find('.test-docpage-remove').click();
  const popups = await driver.findAll(".test-removepage-popup");
  if (options.expectPrompt === true) {
    assert.lengthOf(popups, 1);
  } else if (options.expectPrompt === false) {
    assert.lengthOf(popups, 0);
  }
  if (popups.length) {
    const popup = popups.shift()!;
    if (options.tables) {
      const popupTables = await driver.findAll(".test-removepage-table", e => e.getText());
      assert.deepEqual(popupTables.sort(), options.tables.sort());
    }
    await popup.find(`.test-option-${options.withData ? 'data': 'page'}`).click();
    if (options.cancel) {
      await driver.find(".test-modal-cancel").click();
    } else {
      await driver.find(".test-modal-confirm").click();
    }
  }
  await waitForServer();
}

/**
 * Checks if a page can be removed.
 */
 export async function canRemovePage(name: string|RegExp) {
  await openPageMenu(name);
  const isDisabled = await driver.find('.test-docpage-remove').matches('.disabled');
  await driver.sendKeys(Key.ESCAPE);
  return !isDisabled;
}

/**
 * Renames a table using exposed method from gristDoc. Use renameActiveTable to use the UI.
 */
export async function renameTable(tableId: string, newName: string) {
  await driver.executeScript(`
    return window.gristDocPageModel.gristDoc.get().renameTable(arguments[0], arguments[1]);
  `, tableId, newName);
  await waitForServer();
}

/**
 * Rename the given column.
 */
export async function renameColumn(col: IColHeader|string, newName: string) {
  const header = await getColumnHeader(col);
  await header.click();
  await header.click();   // Second click opens the label for editing.
  await driver.findWait('.test-column-title-label', 100).sendKeys(newName, Key.ENTER);
  await waitForServer();
}

/**
 * Removes a table using RAW data view.
 */
export async function removeTable(tableId: string, options: {dismissTips?: boolean} = {}) {
  await driver.find(".test-tools-raw").click();
  if (options.dismissTips) { await dismissBehavioralPrompts(); }
  const tableIdList = await driver.findAll('.test-raw-data-table-id', e => e.getText());
  const tableIndex = tableIdList.indexOf(tableId);
  assert.isTrue(tableIndex >= 0, `No raw table with id ${tableId}`);
  const menus = await driver.findAll(".test-raw-data-table .test-raw-data-table-menu");
  assert.equal(menus.length, tableIdList.length);
  await menus[tableIndex].click();
  await driver.find(".test-raw-data-menu-remove-table").click();
  await driver.find(".test-modal-confirm").click();
  await waitForServer();
}

/**
 * Click the Undo button and wait for server. If optCount is given, click Undo that many times.
 */
export async function undo(optCount: number = 1, optTimeout?: number) {
  for (let i = 0; i < optCount; ++i) {
    await driver.find('.test-undo').doClick();
  }
  await waitForServer(optTimeout);
}


/**
 * Returns a function to undo all user actions from a particular point in time.
 * Optionally accepts a function which should return the same result before and after the test.
 */
export async function begin(invariant: () => any = () => true) {
  const undoStackPointer = () => driver.executeScript<number>(`
    return window.gristDocPageModel.gristDoc.get()._undoStack._pointer;
  `);
  const start = await undoStackPointer();
  const previous = await invariant();
  return async () => {
    // We will be careful here and await every time for the server and check js errors.
    const count = await undoStackPointer() - start;
    for (let i = 0; i < count; ++i) {
      await undo();
      await checkForErrors();
    }
    assert.deepEqual(await invariant(), previous);
  };
}

/**
 * A hook that can be used to clear a state after suite is finished and current test passed.
 * If under debugging session and NO_CLEANUP env variable is set it will skip this cleanup and allow you
 * to examine the state of the database or browser.
 */
export function afterCleanup(test: () => void | Promise<void>) {
  after(function() {
    if (process.env.NO_CLEANUP) {
      function anyTestFailed(suite: Mocha.Suite): boolean {
        return suite.tests.some(t => t.state === 'failed') || suite.suites.some(anyTestFailed);
      }

      if (this.currentTest?.parent && anyTestFailed(this.currentTest?.parent)) {
        return;
      }
    }
    return test();
  });
}

/**
 * A hook that can be used to clear state after each test that has passed.
 * If under debugging session and NO_CLEANUP env variable is set it will skip this cleanup and allow you
 * to examine the state of the database or browser.
 */
export function afterEachCleanup(test: () => void | Promise<void>) {
  afterEach(function() {
    if (this.currentTest?.state !== 'passed' && !this.currentTest?.pending && process.env.NO_CLEANUP) {
      return;
    }
    return test();
  });
}

/**
 * Simulates a transaction on the GristDoc. Use with cautions, as there is no guarantee it will undo correctly
 * in a case of failure.
 * Optionally accepts a function which should return the same result before and after the test.
 * Example:
 *
 * it('should ...', revertChanges(async function() {
 * ...
 * }));
 */
export function revertChanges(test: () => Promise<void>, invariant: () => any = () => false) {
  return async function() {
    const revert = await begin(invariant);
    let wasError = false;
    try {
      await test();
    } catch(e) {
      wasError = true;
      throw e;
    } finally {
      if (!(noCleanup && wasError)) {
        await revert();
      }
    }
  };
}

/**
 * Click the Redo button and wait for server. If optCount is given, click Redo that many times.
 */
export async function redo(optCount: number = 1, optTimeout?: number) {
  for (let i = 0; i < optCount; ++i) {
    await driver.find('.test-redo').doClick();
  }
  await waitForServer(optTimeout);
}

/**
 * Asserts the absence of javascript errors.
 */
export async function checkForErrors() {
  const errors = await driver.executeScript<string[]>(() => (window as any).getAppErrors());
  assert.deepEqual(errors, []);
}

/**
 * Opens a Creator Panel on Widget/Table settings tab.
 */
export async function openWidgetPanel(tab: 'widget'|'sortAndFilter'|'data' = 'widget') {
  await toggleSidePanel('right', 'open');
  await driver.find('.test-right-tab-pagewidget').click();
  await driver.find(`.test-config-${tab}`).click();
}

/**
 * Opens a Creator Panel on Widget/Table settings tab.
 */
 export async function openColumnPanel() {
  await toggleSidePanel('right', 'open');
  await driver.find('.test-right-tab-field').click();
}

/**
 * Moves a column from a hidden to visible section.
 * Needs a visible Creator panel.
 */
export async function moveToVisible(col: string) {
  const row = await driver.findContent(".test-vfc-hidden-fields .kf_draggable_content", exactMatch(col));
  await row.mouseMove();
  await row.find('.test-vfc-hide').click();
  await waitForServer();
}

/**
 * Moves a column from a visible to hidden section.
 * Needs a visible Creator panel.
 */
export async function moveToHidden(col: string) {
  const row = await driver.findContent(".test-vfc-visible-fields .kf_draggable_content", exactMatch(col));
  await row.mouseMove();
  await row.find('.test-vfc-hide').click();
  await waitForServer();
}

/**
 * Clicks `Select All` in visible columns section.
 */
export async function selectAllVisibleColumns() {
  await driver.find('.test-vfc-visible-fields-select-all').click();
}

/**
 * Toggle checkbox for a column in visible columns section.
 */
export async function toggleVisibleColumn(col: string) {
  const row = await driver.findContent(".test-vfc-visible-fields .kf_draggable_content", exactMatch(col));
  await row.find('input').click();
}

/**
 * Clicks `Hide Columns` button in visible columns section.
 */
export async function hideVisibleColumns() {
  await driver.find('.test-vfc-visible-hide').click();
  await waitForServer();
}

export async function search(what: string) {
  await driver.find('.test-tb-search-icon').click();
  await driver.sleep(500);
  await driver.find('.test-tb-search-input input').click();
  await selectAll();
  await driver.sendKeys(what);
  // Sleep for search debounce time
  await driver.sleep(120);
}

export async function toggleSearchAll() {
  await closeTooltip();
  await driver.find('.test-tb-search-option-all-pages').click();
}

export async function closeSearch() {
  await driver.sendKeys(Key.ESCAPE);
  await driver.sleep(500);
}

export async function closeTooltip() {
  if (!await driver.find('.test-tooltip').isPresent()) { return; }

  await driver.find('.test-tooltip').mouseMove();
  await driver.mouseMoveBy({x : 100, y: 100});
  await waitToPass(async () => {
    assert.equal(await driver.find('.test-tooltip').isPresent(), false);
  });
}

export async function searchNext() {
  await closeTooltip();
  await driver.find('.test-tb-search-next').click();
}

export async function searchPrev() {
  await closeTooltip();
  await driver.find('.test-tb-search-prev').click();
}

export function getCurrentPageName() {
  return driver.find('.test-treeview-itemHeader.selected').find('.test-docpage-label').getText();
}

export async function getActiveRawTableName() {
  return await driver.findWait('.test-raw-data-overlay .test-viewsection-title', 100).getText();
}

export function getSearchInput() {
  return driver.find('.test-tb-search-input');
}

export async function hasNoResult() {
  await waitToPass(async () => {
    assert.match(await driver.find('.test-tb-search-input').getText(), /No results/);
  });
}

export async function hasSomeResult() {
  await waitToPass(async () => {
    assert.notMatch(await driver.find('.test-tb-search-input').getText(), /No results/);
  });
}

export async function searchIsOpened() {
  await waitToPass(async () => {
    assert.isAbove((await getSearchInput().rect()).width, 50);
  }, 500);
}

export async function searchIsClosed() {
  await waitToPass(async () => {
    assert.equal((await getSearchInput().rect()).width, 0);
  }, 500);
}

export async function openRawTable(tableId: string) {
  await driver.find(`.test-raw-data-table .test-raw-data-table-id-${tableId}`).click();
}

export async function renameRawTable(tableId: string, newName?: string, newDescription?: string) {
  await driver.find(`.test-raw-data-table .test-raw-data-table-id-${tableId}`)
    .findClosest('.test-raw-data-table')
    .find('.test-raw-data-table-menu')
    .click();
  await driver.find('.test-raw-data-menu-rename-table').click();
  if (newName !== undefined) {
    const input = await driver.find(".test-widget-title-table-name-input");
    await input.doClear();
    await input.click();
    await driver.sendKeys(newName);
  }
  if (newDescription !== undefined) {
    const input = await driver.find(".test-widget-title-section-description-input");
    await input.doClear();
    await input.click();
    await driver.sendKeys(newDescription);
  }
  await driver.find(".test-widget-title-save").click();
  await waitForServer();
}

export async function isRawTableOpened() {
  return await driver.find('.test-raw-data-close-button').isPresent();
}

export async function closeRawTable() {
  await driver.find('.test-raw-data-close-button').click();
}

/**
 * Opens the section menu for a section, or the active section if no section is given.
 */
export async function openSectionMenu(which: 'sortAndFilter'|'viewLayout', section?: string|WebElement) {
  const sectionElem = section ? await getSection(section) : await driver.findWait('.active_section', 4000);
  await sectionElem.find(`.test-section-menu-${which}`).click();
  return await driver.findWait('.grist-floating-menu', 100);
}

/**
 * Opens Raw data view for current section.
 */
export async function showRawData(section?: string|WebElement) {
  await openSectionMenu('viewLayout', section);
  await driver.find('.test-show-raw-data').click();
  assert.isTrue(await driver.findWait('.test-raw-data-overlay', 100).isDisplayed());
}

// Mapping from column menu option name to dom element selector to wait for, or null if no need to wait.
const ColumnMenuOption: { [id: string]: string; } = {
  Filter: '.test-filter-menu-wrapper'
};

async function openColumnMenuHelper(col: IColHeader|string, option?: string): Promise<WebElement> {
  await getColumnHeader(typeof col === 'string' ? {col} : col).mouseMove().find('.g-column-main-menu').click();
  const menu = await driver.findWait('.grist-floating-menu', 100);
  if (option) {
    await menu.findContent('li', option).click();
    const waitForElem = ColumnMenuOption[option];
    if (waitForElem) {
      return await driver.findWait(ColumnMenuOption[option], 100);
    }
  }
  return menu;
}

type SortOptions = 'sort-asc'|'sort-dsc'|'add-to-sort-asc'|'add-to-sort-dsc';

/**
 * Open the given column's dropdown menu. If `option` is provided, finds and clicks it.
 * If `option` is present in ColumnMenuOption, also waits for the specified element.
 */
export function openColumnMenu(col: IColHeader|string, option?: 'Filter'): WebElementPromise;
export function openColumnMenu(col: IColHeader|string, option: SortOptions|string): Promise<void>;
export function openColumnMenu(col: IColHeader|string, option?: string): WebElementPromise|Promise<void> {
  if (['sort-asc', 'sort-dsc', 'add-to-sort-asc', 'add-to-sort-dsc'].includes(option || '')) {
    return openColumnMenuHelper(col).then<void>(async (menu) => {
      await menu.find(`.test-${option}`).click();
      await waitForServer();
    });
  }
  return new WebElementPromise(driver, openColumnMenuHelper(col, option));
}

export async function deleteColumn(col: IColHeader|string) {
  await openColumnMenu(col, 'Delete column');
  await waitForServer();
  await wipeToasts();
}

export type ColumnType =
  'Any' | 'Text' | 'Numeric' | 'Integer' | 'Toggle' | 'Date' | 'DateTime' |
  'Choice' | 'Choice List' | 'Reference' | 'Reference List' | 'Attachment';

/**
 * Sets the type of the currently selected field to value.
 */
export async function setType(
  type: RegExp|ColumnType,
  options: {skipWait?: boolean, apply?: boolean} = {}
) {
  const {skipWait, apply} = options;
  await toggleSidePanel('right', 'open');
  await driver.find('.test-right-tab-field').click();
  await driver.find('.test-fbuilder-type-select').click();
  type = typeof type === 'string' ? exactMatch(type) : type;
  await driver.findContentWait('.test-select-menu .test-select-row', type, 500).click();
  if (!skipWait || apply) { await waitForServer(); }
  if (apply) {
    await driver.findWait('.test-type-transform-apply', 1000).click();
    await waitForServer();
  }
}

/**
 * Gets the type of the currently selected field.
 */
export async function getType() {
  return await driver.find('.test-fbuilder-type-select').getText();
}

/**
 * Get the field's widget type (e.g. "CheckBox" for a Toggle column) in the creator panel.
 */
export async function getFieldWidgetType(): Promise<string> {
  return await driver.find(".test-fbuilder-widget-select").getText();
}

/**
 * Set the field's widget type (e.g. "CheckBox" for a Toggle column) in the creator panel.
 */
export async function setFieldWidgetType(type: string) {
  await driver.find(".test-fbuilder-widget-select").click();
  await driver.findContent('.test-select-menu li', exactMatch(type)).click();
  await waitForServer();
}

export async function applyTypeTransform() {
  await driver.findContent('.type_transform_prompt button', /Apply/).click();
}

export async function isMac(): Promise<boolean> {
  const platform = (await driver.getCapabilities()).getPlatform() ?? '';
  return /Darwin|Mac|mac os x|iPod|iPhone|iPad/i.test(platform);
}

export async function modKey() {
  return await isMac() ? Key.COMMAND : Key.CONTROL;
}

export async function selectAllKey() {
  return await isMac() ? Key.chord(Key.COMMAND, 'a') : Key.chord(Key.CONTROL, 'a');
}

/**
 * Send keys, with support for Key.chord(), similar to driver.sendKeys(). Note that while
 * elem.sendKeys() supports Key.chord(...), driver.sendKeys() does not. This is a replacement.
 */
export async function sendKeys(...keys: string[]) {
  // tslint:disable-next-line:max-line-length
  // Implementation follows the description of WebElement.sendKeys functionality at https://github.com/SeleniumHQ/selenium/blob/2f7727c314f943582f9f1b2a7e4d77ebdd64bdd3/javascript/node/selenium-webdriver/lib/webdriver.js#L2146
  await driver.withActions((a) => {
    const toRelease: string[] =  [];
    for (const part of keys) {
      for (const key of part) {
        if ([Key.ALT, Key.CONTROL, Key.SHIFT, Key.COMMAND, Key.META].includes(key)) {
          a.keyDown(key);
          toRelease.push(key);
        } else if (key === Key.NULL) {
          toRelease.splice(0).reverse().forEach(k => a.keyUp(k));
        } else {
          a.sendKeys(key);
        }
      }
    }
  });
}

/**
 * Clears active input/textarea.
 */
export async function clearInput() {
  return sendKeys(await selectAllKey(), Key.DELETE);
}

/**
 * Open ⋮ dropdown menu for named workspace.
 */
export async function openWsDropdown(wsName: string): Promise<void> {
  const wsTab = await driver.findContentWait('.test-dm-workspace', wsName, 3000);
  await wsTab.mouseMove();
  await wsTab.find('.test-dm-workspace-options').mouseMove().click();
}

export async function openWorkspace(wsName: string): Promise<void> {
  const wsTab = await driver.findContentWait('.test-dm-workspace', wsName, 3000);
  await wsTab.click();
  await waitForDocMenuToLoad();
}

/**
 * Open ⋮ dropdown menu for named document.
 */
export async function openDocDropdown(docNameOrRow: string|WebElement): Promise<void> {
  // "Pinned" docs also get .test-dm-doc testId.
  const docRow = (typeof docNameOrRow === 'string') ?
    await driver.findContentWait('.test-dm-doc', docNameOrRow, 3000) :
    docNameOrRow;
  await docRow.mouseMove();
  await docRow.find('.test-dm-doc-options,.test-dm-pinned-doc-options').mouseMove().click();
}

 /**
  * Open ⋮ dropdown menu for doc access rules.
  */
export async function openAccessRulesDropdown(): Promise<void> {
  await driver.find('.test-tools-access-rules').mouseMove();
  await driver.find('.test-tools-access-rules-trigger').mouseMove().click();
  await driver.findWait('.grist-floating-menu', 1000);
}

/**
 * Open "Select By" area in creator panel.
 */
export async function openSelectByForSection(section: string) {
  await toggleSidePanel('right', 'open');
  await driver.find('.test-config-data').click();
  await getSection(section).click();
  await driver.find('.test-right-select-by').click();
}

export async function editOrgAcls(): Promise<void> {
  // To prevent a common flakiness problem, wait for a potentially open modal dialog
  // to close before attempting to open the account menu.
  await driver.wait(async () => !(await driver.find('.test-modal-dialog').isPresent()), 3000);
  await driver.findWait('.test-user-icon', 3000).click();
  await driver.findWait('.test-dm-org-access', 3000).click();
  await driver.findWait('.test-um-members', 3000);
}

/**
 * Click confirm on a user manager dialog. If clickRemove is set, then
 * any extra modal that pops up will be accepted. Returns true unless
 * clickRemove was set and no modal popped up.
 */
export async function saveAcls(clickRemove: boolean = false): Promise<boolean> {
  await driver.findWait('.test-um-confirm', 3000).click();
  let clickedRemove: boolean = false;
  await driver.wait(async () => {
    if (clickRemove && !clickedRemove && await driver.find('.test-modal-confirm').isPresent()) {
      await driver.find('.test-modal-confirm').click();
      clickedRemove = true;
    }
    return !(await driver.find('.test-um-members').isPresent());
  }, 3000);
  return clickedRemove || !clickRemove;
}

/**
 * Opens the row menu for the row with the given row number (1-based, as in row headers).
 */
export function openRowMenu(rowNum: number) {
  const row = driver.findContent('.active_section .gridview_data_row_num', String(rowNum));
  return driver.withActions((actions) => actions.contextClick(row))
    .then(() => driver.findWait('.grist-floating-menu', 1000));
}

export async function removeRow(rowNum: number) {
  await (await openRowMenu(rowNum)).findContent('li', /Delete/).click();
  await waitForServer();
}

export async function openCardMenu(rowNum: number) {
  const section = await driver.find('.active_section');
  const firstRow = await section.findContent('.detail_row_num', String(rowNum));
  await firstRow.find('.test-card-menu-trigger').click();
  return await driver.findWait('.grist-floating-menu', 1000);
}

/**
 * A helper to complete saving a copy of the document. Namely it is useful to call after clicking
 * either the `Copy As Template` or `Save Copy` (when on a forked document) button. Accept optional
 * `destName` and `destWorkspace` to change the default destination.
 */
export async function completeCopy(options: {destName?: string, destWorkspace?: string, destOrg?: string} = {}) {
  await driver.findWait('.test-modal-dialog', 1000);
  if (options.destName !== undefined) {
    const nameElem = await driver.find('.test-copy-dest-name').doClick();
    await setValue(nameElem, '');
    await nameElem.sendKeys(options.destName);
  }
  if (options.destOrg !== undefined) {
    await driver.find('.test-copy-dest-org .test-select-open').click();
    await driver.findContent('.test-select-menu li', options.destOrg).click();
  }
  if (options.destWorkspace !== undefined) {
    await driver.findWait('.test-copy-dest-workspace .test-select-open', 1000).click();
    await driver.findContent('.test-select-menu li', options.destWorkspace).click();
  }

  await waitForServer();

  // save the urlId
  const urlId = await getCurrentUrlId();

  await driver.wait(async () => (
    await driver.find('.test-modal-confirm').getAttribute('disabled') == null));

  // click the `Copy` button
  await driver.find('.test-modal-confirm').click();

  // wait for the doc id to change
  await driver.wait(async () => (await getCurrentUrlId()) !== urlId);

  await waitForDocToLoad();
}

/**
 * Removes document by name from the home page.
 */
export async function removeDoc(docName: string) {
  await openDocDropdown(docName);
  await driver.find('.test-dm-delete-doc').click();
  await driver.find('.test-modal-confirm').click();
  await driver.wait(async () => !(await driver.find('.test-modal-dialog').isPresent()), 3000);
}

/**
 * Helper to get the urlId of the current document. Resolves to undefined if called while not
 * on a document page.
 */
export async function getCurrentUrlId() {
  return decodeUrl({}, new URL(await driver.getCurrentUrl())).doc;
}

export function getToasts(): Promise<string[]> {
  return driver.findAll('.test-notifier-toast-wrapper', (el) => el.getText());
}

export async function wipeToasts(): Promise<void> {
  await driver.executeScript('window.gristApp.topAppModel.notifier.clearAppErrors()');
  return driver.executeScript(
    "for (const e of document.getElementsByClassName('test-notifier-toast-wrapper')) { e.remove(); }");
}

/**
 * Call this at suite level, to share the "Examples & Templates" workspace in before() and restore
 * it in after().
 *
 * TODO: Should remove once support workspaces are removed from backend.
 */
export function shareSupportWorkspaceForSuite() {
  let api: UserAPIImpl|undefined;
  let wss: Workspace[]|undefined;

  before(async function() {
    // test/gen-server/seed.ts creates a support user with a personal org and an "Examples &
    // Templates" workspace, but doesn't share it (to avoid impacting the many existing tests).
    // Share that workspace with @everyone and @anon, and clean up after this suite.
    await addSupportUserIfPossible();
    api = createHomeApi('Support', 'docs');  // this uses an api key, so no need to log in.
    wss = await api.getOrgWorkspaces('current');
    await api.updateWorkspacePermissions(wss[0].id, {users: {
      'everyone@getgrist.com': 'viewers',
      'anon@getgrist.com': 'viewers',
    }});
  });

  after(async function() {
    if (api && wss) {
      await api.updateWorkspacePermissions(wss[0].id, {users: {
        'everyone@getgrist.com': null,
        'anon@getgrist.com': null,
      }});
    }
  });
}

export async function clearTestState() {
  await driver.executeScript("window.testGrist = {}");
}

export async function getTestState(): Promise<TestState> {
  const state: TestState|undefined = await driver.executeScript("return window.testGrist");
  return state || {};
}

// Get the full text from an element containing an Ace editor.
export async function getAceText(el: WebElement): Promise<string> {
  return driver.executeScript('return ace.edit(arguments[0]).getValue()',
                              el.find('.ace_editor'));
}

// All users ('user1', etc.) that can be logged in using Session.user().
export enum TestUserEnum {
  user1 = 'chimpy',
  user2 = 'charon',
  user3 = 'kiwi',
  user4 = 'ham',
  userz = 'userz',    // a user for old tests, that doesn't overlap with others.
  owner = 'chimpy',
  anon = 'anon',
  support = 'support',
}
export type TestUser = keyof typeof TestUserEnum;     // 'user1' | 'user2' | ...

// Get name and email for the given test user.
export function translateUser(userName: TestUser): {email: string, name: string} {
  if (userName === 'anon') {
    return {email: 'anon@getgrist.com', name: 'Anonymous'};
  }
  if (userName === 'support') {
    return {email: 'support@getgrist.com', name: 'Support'};
  }
  const translatedUser = TestUserEnum[userName];
  const email = `gristoid+${translatedUser}@gmail.com`;
  const name = startCase(translatedUser);
  return {email, name};
}

/**
 * A class representing a user on a particular site, with a default
 * workspaces.  Tests written using this class can be more
 * conveniently adapted to run locally, or against deployed versions
 * of grist.
 */
export class Session {
  // private constructor - access sessions via session() or Session.default
  private constructor(public settings: { email: string, orgDomain: string,
                                         orgName: string, name: string,
                                         workspace: string }) {
  }

  // Get a session configured for the personal site of a default user.
  public static get default() {
    // Start with an empty session, then fill in the personal site (typically docs, or docs-s
    // in staging), and then fill in a default user (currently gristoid+chimpy@gmail.com).
    return new Session({name: '', email: '', orgDomain: '', orgName: '', workspace: 'Home'}).personalSite.user();
  }

  // Return a session configured for the personal site of the current session's user.
  public get personalSite() {
    const orgName = this.settings.name ? `@${this.settings.name}` : '';
    return this.customTeamSite('docs', orgName);
  }

  // Return a session configured for a default team site and the current session's user.
  public get teamSite() {
    return this.customTeamSite('test-grist', 'Test Grist');
  }

  // Return a session configured for an alternative team site and the current session's user.
  public get teamSite2() {
    return this.customTeamSite('test2-grist', 'Test2 Grist');
  }

  // Return a session configured for a particular team site and the current session's user.
  public customTeamSite(orgDomain: string = 'test-grist', orgName = 'Test Grist') {
    const deployment = process.env.GRIST_ID_PREFIX;
    if (deployment) {
      orgDomain = `${orgDomain}-${deployment}`;
    }
    return new Session({...this.settings, orgDomain, orgName});
  }

  // Return a session configured to create and import docs in the given workspace.
  public forWorkspace(workspace: string) {
    return new Session({...this.settings, workspace});
  }

  // Wipe the current site.  The current user ends up being its only owner and manager.
  public async resetSite() {
    return resetOrg(this.createHomeApi(), this.settings.orgDomain);
  }

  // Return a session configured for the current session's site but a different user.
  public user(userName: TestUser = 'user1') {
    return new Session({...this.settings, ...translateUser(userName)});
  }

  // Return a session configured for the current session's site and anonymous access.
  public get anon() {
    return this.user('anon');
  }

  public async addLogin() {
    return this.login({retainExistingLogin: true});
  }

  // Make sure we are logged in to the current session's site as the current session's user.
  public async login(options?: {loginMethod?: UserProfile['loginMethod'],
                                freshAccount?: boolean,
                                isFirstLogin?: boolean,
                                showTips?: boolean,
                                skipTutorial?: boolean, // By default true
                                userName?: string,
                                email?: string,
                                retainExistingLogin?: boolean}) {
    if (options?.userName) {
      this.settings.name = options.userName;
      this.settings.email = options.email || '';
    }
    // Optimize testing a little bit, so if we are already logged in as the expected
    // user on the expected org, and there are no options set, we can just continue.
    if (!options && await this.isLoggedInCorrectly()) { return this; }
    if (!options?.retainExistingLogin) {
      await removeLogin();
      if (this.settings.email === 'anon@getgrist.com') {
        if (options?.showTips) {
          await enableTips(this.settings.email);
        } else {
          await disableTips(this.settings.email);
        }
        return this;
      }
    }
    await server.simulateLogin(this.settings.name, this.settings.email, this.settings.orgDomain,
                               {isFirstLogin: false, cacheCredentials: true, ...options});

    if (options?.skipTutorial ?? true) {
      await dismissTutorialCard();
    }

    return this;
  }

  // Check whether we are logged in to the current session's site as the current session's user.
  public async isLoggedInCorrectly() {
    let currentUser: FullUser|undefined;
    let currentOrg: APIOrganization|undefined;
    try {
      currentOrg = await getOrg();
    } catch (err) {
      // ok, we may not be in a page associated with an org.
    }
    try {
      currentUser = await getUser();
    } catch (err) {
      // ok, we may not be in a page associated with a user.
    }
    return currentUser && currentUser.email === this.settings.email &&
      currentOrg && (currentOrg.name === this.settings.orgName ||
                     // This is an imprecise check for personal sites, but adequate for tests.
                     (currentOrg.owner && (this.settings.orgDomain.startsWith('docs'))));
  }

  // Load a document on a site.
  public async loadDoc(
    relPath: string,
    options: {
      wait?: boolean,
      skipAlert?: boolean,
    } = {}
  ) {
    const {wait = true, skipAlert = false} = options;
    await this.loadRelPath(relPath);
    if (skipAlert && await isAlertShown()) { await acceptAlert(); }
    if (wait) { await waitForDocToLoad(); }
  }

  // Load a DocMenu on a site.
  // If loading for a potentially first-time user, you may give 'skipWelcomeQuestions' for second
  // argument to dismiss the popup with welcome questions, if it gets shown.
  public async loadDocMenu(relPath: string, wait: boolean|'skipWelcomeQuestions' = true) {
    await this.loadRelPath(relPath);
    if (wait) { await waitForDocMenuToLoad(); }

    if (wait === 'skipWelcomeQuestions') {
      // When waitForDocMenuToLoad() returns, welcome questions should also render, so that we
      // don't need to wait extra for them.
      await skipWelcomeQuestions();
    }
  }

  public async loadRelPath(relPath: string) {
    const part = relPath.match(/^\/o\/([^/]*)(\/.*)/);
    if (part) {
      if (part[1] !== this.settings.orgDomain) {
        throw new Error(`org mismatch: ${this.settings.orgDomain} vs ${part[1]}`);
      }
      relPath = part[2];
    }
    await driver.get(server.getUrl(this.settings.orgDomain, relPath));
  }

  // Import a file into the current site + workspace.
  public async importFixturesDoc(fileName: string, options: ImportOpts = {load: true}) {
    return importFixturesDoc(this.settings.name, this.settings.orgDomain, this.settings.workspace, fileName,
                             {email: this.settings.email, ...options});
  }

  // As for importFixturesDoc, but delete the document at the end of testing.
  public async tempDoc(cleanup: Cleanup, fileName: string, options: ImportOpts = {load: true}) {
    const doc = await this.importFixturesDoc(fileName, options);
    const api = this.createHomeApi();
    if (!noCleanup) {
      cleanup.addAfterAll(async () => {
        await api.deleteDoc(doc.id).catch(noop);
        doc.id = '';
      });
    }
    return doc;
  }

  // As for importFixturesDoc, but delete the document at the end of each test.
  public async tempShortDoc(cleanup: Cleanup, fileName: string, options: ImportOpts = {load: true}) {
    const doc = await this.importFixturesDoc(fileName, options);
    const api = this.createHomeApi();
    if (!noCleanup) {
      cleanup.addAfterEach(async () => {
        if (doc.id) {
          await api.deleteDoc(doc.id).catch(noop);
        }
        doc.id = '';
      });
    }
    return doc;
  }

  public async tempNewDoc(cleanup: Cleanup, docName: string = '', {load} = {load: true}) {
    docName ||= `Test${Date.now()}`;
    const docId = await createNewDoc(this.settings.name, this.settings.orgDomain, this.settings.workspace,
                                     docName, {email: this.settings.email});
    if (load) {
      await this.loadDoc(`/doc/${docId}`);
    }
    const api = this.createHomeApi();
    if (!noCleanup) {
      cleanup.addAfterAll(() => api.deleteDoc(docId).catch(noop));
    }
    return docId;
  }

  // Create a workspace that will be deleted at the end of testing.
  public async tempWorkspace(cleanup: Cleanup, workspaceName: string) {
    const api = this.createHomeApi();
    const workspaceId = await api.newWorkspace({name: workspaceName}, 'current');
    if (!noCleanup) {
      cleanup.addAfterAll(async () => {
        await api.deleteWorkspace(workspaceId).catch(noop);
      });
    }
    return workspaceId;
  }

  // Get an appropriate home api object.
  public createHomeApi() {
    if (this.settings.email === 'anon@getgrist.com') {
      return createHomeApi(null, this.settings.orgDomain);
    }
    return createHomeApi(this.settings.name, this.settings.orgDomain, this.settings.email);
  }

  public getApiKey(): string|null {
    if (this.settings.email === 'anon@getgrist.com') {
      return getApiKey(null);
    }
    return getApiKey(this.settings.name, this.settings.email);
  }

  // Get the id of this user.
  public async getUserId(): Promise<number> {
    await this.login();
    await this.loadDocMenu('/');
    const user = await getUser();
    return user.id;
  }

  public get email() { return this.settings.email; }
  public get name()  { return this.settings.name;  }
  public get orgDomain()   { return this.settings.orgDomain; }
  public get orgName()   { return this.settings.orgName; }
  public get workspace()   { return this.settings.workspace; }

  public async downloadDoc(fname: string, urlId?: string) {
    urlId = urlId || await getCurrentUrlId();
    const api = this.createHomeApi();
    const doc = await api.getDoc(urlId!);
    const workerApi = await api.getWorkerAPI(doc.id);
    const response = await workerApi.downloadDoc(doc.id);
    await fse.writeFile(fname, Buffer.from(await response.arrayBuffer()));
  }
}

// Wrap the async methods of Session to include the stack of the caller in stack traces.
function stackWrapSession(sessionProto: any) {
  for (const name of [
    'resetSite', 'login', 'isLoggedInCorrectly', 'loadDoc', 'loadDocMenu', 'loadRelPath',
    'importFixturesDoc', 'tempDoc', 'tempNewDoc', 'tempWorkspace', 'getUserId',
  ]) {
    sessionProto[name] = stackWrapFunc(sessionProto[name]);
  }
}
stackWrapSession(Session.prototype);

// Configure a session, for the personal site of a default user.
export function session(): Session {
  return Session.default;
}

/**
 * Sets font style in opened color picker.
 */
export async function setFont(type: 'bold'|'underline'|'italic'|'strikethrough', onOff: boolean|number) {
  const optionToClass = {
    bold: '.test-font-option-FontBold',
    italic: '.test-font-option-FontItalic',
    underline: '.test-font-option-FontUnderline',
    strikethrough: '.test-font-option-FontStrikethrough',
  };
  async function clickFontOption() {
    await driver.find(optionToClass[type]).click();
  }
  async function isFontOption() {
    return (await driver.findAll(`${optionToClass[type]}[class*=-selected]`)).length === 1;
  }
  const current = await isFontOption();
  if (onOff && !current || !onOff && current) {
    await clickFontOption();
  }
}

/**
 * Returns the rgb/hex representation of `color` if it's a name (e.g. red, blue, green, white, black, addRow, or
 * transparent), or `color` unchanged if it's not a name.
 */
export function nameToHex(color: string) {
  switch(color) {
    case 'red': color = '#FF0000'; break;
    case 'blue': color = '#0000FF'; break;
    case 'green': color = '#00FF00'; break;
    case 'white': color = '#FFFFFF'; break;
    case 'black': color = '#000000'; break;
    case 'transparent': color = 'rgba(0, 0, 0, 0)'; break;
    case 'addRow': color = 'rgba(246, 246, 255, 1)'; break;
  }
  return color;
}

//  Set the value of an `<input type="color">` element to `color` and trigger the `change`
//  event. Accepts `color` to be of following forms `rgb(120, 10, 3)` or '#780a03' or some predefined
//  values (red, green, blue, white, black, transparent)
export async function setColor(colorInputEl: WebElement, color: string) {
  color = nameToHex(color);
  if (color.startsWith('rgb(')) {
    // the `value` of an `<input type='color'>` element must be a rgb color in hexadecimal
    // notation.
    color = rgbToHex(color);
  }
  await driver.executeScript(() => {
    const el = arguments[0];
    el.value = arguments[1];
    const evt = document.createEvent("HTMLEvents");
    evt.initEvent("input", false, true);
    el.dispatchEvent(evt);
  }, colorInputEl, color);
}

export function setTextColor(color: string) {
  return setColor(driver.find('.test-text-input'), color);
}

export function setFillColor(color: string) {
  return setColor(driver.find('.test-fill-input'), color);
}

export async function styleRulesCount() {
  const rules = await driver.findAll('.test-widget-style-conditional-rule');
  return rules.length;
}

export async function addInitialStyleRule() {
  await driver.find('.test-widget-style-add-conditional-style').click();
  await waitForServer();
}

export async function removeStyleRuleAt(nr: number) {
  await driver.find(`.test-widget-style-remove-rule-${nr}`).click();
  await waitForServer();
}

export async function addAnotherStyleRule() {
  await driver.find('.test-widget-style-add-another-rule').click();
  await waitForServer();
}

export async function openStyleRuleFormula(nr: number) {
  await driver
    .findWait(`.test-widget-style-conditional-rule-${nr} .formula_field_sidepane`, 1000)
    .click();
  await waitAppFocus(false);
}

export async function clickAway() {
  await driver.find(".test-notifier-menu-btn").click();
  await driver.sendKeys(Key.ESCAPE);
}

/**
 * Opens the header color picker.
 */
export function openHeaderColorPicker() {
  return driver.find('.test-header-color-select .test-color-select').click();
}

export async function assertHeaderTextColor(col: string, color: string) {
  await assertTextColor(await getColumnHeader(col), color);
}

export async function assertHeaderFillColor(col: string, color: string) {
  await assertFillColor(await getColumnHeader(col), color);
}

/**
 * Opens a cell color picker, either the default one or the one for a specific style rule.
 */
export function openCellColorPicker(nr?: number) {
  if (nr !== undefined) {
    return driver
      .find(`.test-widget-style-conditional-rule-${nr} .test-color-select`)
      .click();
  }
  return driver.find('.test-cell-color-select .test-color-select').click();
}

export async function assertCellTextColor(col: string, row: number, color: string) {
  await assertTextColor(await getCell(col, row).find('.field_clip'), color);
}

export async function assertCellFillColor(col: string, row: number, color: string) {
  await assertFillColor(await getCell(col, row), color);
}

export async function assertTextColor(cell: WebElement, color: string) {
  color = nameToHex(color);
  color = color.startsWith('#') ? hexToRgb(color) : color;
  const test = async () => {
    const actual = await cell.getCssValue('color');
    assert.equal(actual, color);
  };
  await waitToPass(test, 500);
}

export async function assertFillColor(cell: WebElement, color: string) {
  color = nameToHex(color);
  color = color.startsWith('#') ? hexToRgb(color) : color;
  const test = async () => {
    const actual = await cell.getCssValue('background-color');
    assert.equal(actual, color);
  };
  await waitToPass(test, 500);
}

// the rgbToHex function is from this conversation: https://stackoverflow.com/a/5624139/8728791
export function rgbToHex(color: string) {
  // Next line extracts the 3 rgb components from a 'rgb(r, g, b)' string.
  const [r, g, b] = color.split(/[,()rgba]/).filter(c => c).map(parseFloat);
  // tslint:disable-next-line:no-bitwise
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// Returns the `rgba( ... )` representation of a color given its hex representation `'#...'` . For
// instance `hexToRgb('#FFFFFF')` returns `'rgba( 255, 255, 255, 1)'`.
export function hexToRgb(hex: string) {
  if (hex.length !== 7) { throw new Error('not an hex color #...'); }
  const aRgbHex = [ hex[1] + hex[2], hex[3] + hex[4], hex[5] + hex[6]];
  const [r, g, b] = [
    parseInt(aRgbHex[0], 16),
    parseInt(aRgbHex[1], 16),
    parseInt(aRgbHex[2], 16)
  ];
  return `rgba(${r}, ${g}, ${b}, 1)`;
}

/**
 * Adds new column to the table.
 * @param name Name of the column
 */
export async function addColumn(name: string, type?: string) {
  await scrollIntoView(await driver.find('.active_section .mod-add-column'));
  await driver.find('.active_section .mod-add-column').click();
  await driver.findWait('.test-new-columns-menu-add-new', 100).click();
  // If we are on a summary table, we could be see a menu helper
  const menu = (await driver.findAll('.grist-floating-menu'))[0];
  if (menu) {
    await menu.findContent("li", "Add Column").click();
  }
  await waitForServer();
  await waitAppFocus(false);
  await driver.sendKeys(name);
  await driver.sendKeys(Key.ENTER);
  await waitForServer();
  if (type) {
    await setType(exactMatch(type));
  }
}

export async function showColumn(name: string) {
  await scrollIntoView(await driver.find('.active_section .mod-add-column'));
  await driver.find('.active_section .mod-add-column').click();
  if (await driver.findContent('.test-new-columns-menu-hidden-column-inlined', `${name}`).isPresent()) {
    await driver.findContent('.test-new-columns-menu-hidden-column-inlined', `${name}`).click();
  } else {
    await driver.findContent('.test-new-columns-menu-hidden-column-collapsed', `${name}`).click();
  }
  await waitForServer();
}

// Select a range of columns, clicking on col1 and dragging to col2.
export async function selectColumnRange(col1: string, col2: string) {
  await getColumnHeader({col: col1}).mouseMove();
  await driver.mouseDown();
  await getColumnHeader({col: col2}).mouseMove();
  await driver.mouseUp();
}

export async function selectGrid() {
  await driver.find(".gridview_data_corner_overlay").click();
}

export async function selectColumn(col: string) {
  await getColumnHeader({col}).click();
}

/**
 * Sets browser window dimensions.
 */
export function setWindowDimensions(width: number, height: number) {
  return driver.manage().window().setRect({width, height});
}

/**
 * Changes browser window dimensions for the duration of a test suite.
 */
export function resizeWindowForSuite(width: number, height: number) {
  let oldDimensions: WindowDimensions;
  before(async function () {
    oldDimensions = await getWindowDimensions();
    await setWindowDimensions(width, height);
  });
  after(async function () {
    await setWindowDimensions(oldDimensions.width, oldDimensions.height);
  });
}

/**
 * Changes browser window dimensions to FullHd for a test suite.
 */
export function bigScreen() {
  resizeWindowForSuite(1920, 1080);
}

/**
 * Shrinks browser window dimensions to trigger mobile mode for a test suite.
 */
export function narrowScreen() {
  resizeWindowForSuite(400, 750);
}

export async function addSupportUserIfPossible() {
  if (!server.isExternalServer() && process.env.TEST_SUPPORT_API_KEY) {
    // Make sure we have a test support user.
    const dbManager = await server.getDatabase();
    const profile = {email: 'support@getgrist.com', name: 'Support'};
    const user = await dbManager.getUserByLoginWithRetry('support@getgrist.com', {profile});
    if (!user) {
      throw new Error('Failed to create test support user');
    }
    if (!user.apiKey) {
      user.apiKey = process.env.TEST_SUPPORT_API_KEY;
      await user.save();
    }
  }
}

/**
 * Adds samples to the Examples & Templates page.
 */
async function addSamples() {
  await addSupportUserIfPossible();
  const homeApi = createHomeApi('support', 'docs');

  // Create the Grist Templates org.
  await homeApi.newOrg({name: 'Grist Templates', domain: 'templates'});

  // Add 2 template workspaces.
  const templatesApi = createHomeApi('support', 'templates');
  await templatesApi.newWorkspace({name: 'CRM'}, 'current');
  await templatesApi.newWorkspace({name: 'Other'}, 'current');

  // Add a featured template to the CRM workspace.
  const exampleDocId = (await importFixturesDoc('support', 'templates', 'CRM',
    'video/Lightweight CRM.grist', {load: false, newName: 'Lightweight CRM.grist'})).id;
  await templatesApi.updateDoc(
    exampleDocId,
    {
      type: 'template',
      isPinned: true,
      options: {
        description: 'CRM template and example for linking data, and creating productive layouts.',
        icon: 'https://grist-static.com/icons/lightweight-crm.png',
        openMode: 'fork'
      },
      urlId: 'lightweight-crm'
    }
  );

  // Add additional templates to the Other workspace.
  const investmentDocId = (await importFixturesDoc('support', 'templates', 'Other',
  'Investment Research.grist', {load: false, newName: 'Investment Research.grist'})).id;
  await templatesApi.updateDoc(
    investmentDocId,
    {
      type: 'template',
      isPinned: true,
      options: {
        description: 'Example for analyzing and visualizing with summary tables and linked charts.',
        icon: 'https://grist-static.com/icons/data-visualization.png',
        openMode: 'fork'
      },
      urlId: 'investment-research'
    },
  );
  const afterschoolDocId = (await importFixturesDoc('support', 'templates', 'Other',
  'video/Afterschool Program.grist', {load: false, newName: 'Afterschool Program.grist'})).id;
  await templatesApi.updateDoc(
    afterschoolDocId,
    {
      type: 'template',
      isPinned: true,
      options: {
        description: 'Example for how to model business data, use formulas, and manage complexity.',
        icon: 'https://grist-static.com/icons/business-management.png',
        openMode: 'fork'
      },
      urlId: 'afterschool-program'
    },
  );

  for (const id of [exampleDocId, investmentDocId, afterschoolDocId]) {
    await homeApi.updateDocPermissions(id, {users: {
      'everyone@getgrist.com': 'viewers',
      'anon@getgrist.com': 'viewers',
    }});
  }
}

/**
 * Removes the Grist Templates org.
 */
function removeTemplatesOrg() {
  const homeApi = createHomeApi('support', 'docs');
  return homeApi.deleteOrg('templates');
}

/**
 * Call this at suite level to add sample documents to the
 * "Examples & Templates" page in before(), and remove added samples
 * in after().
 */
export function addSamplesForSuite() {
  before(async function() {
    await addSamples();
  });

  after(async function() {
    await removeTemplatesOrg();
  });
}

export async function openAccountMenu() {
  await driver.findWait('.test-dm-account', 1000).click();
  // Since the AccountWidget loads orgs and the user data asynchronously, the menu
  // can expand itself causing the click to land on a wrong button.
  await waitForServer();
  await driver.findWait('.test-site-switcher-org', 1000);
  await driver.sleep(250);  // There's still some jitter (scroll-bar? other user accounts?)
}

export async function openProfileSettingsPage() {
  await openAccountMenu();
  await driver.find('.grist-floating-menu .test-dm-account-settings').click();
  await driver.findWait('.test-account-page-login-method', 5000);
}

export async function openDocumentSettings() {
  await openAccountMenu();
  await driver.findContent('.grist-floating-menu a', 'Document Settings').click();
  await waitForUrl(/settings/, 5000);
}

/**
 * Returns date format for date and datetime editor
 */
export async function getDateFormat(): Promise<string> {
  const result = await driver.find('[data-test-id=Widget_dateFormat] .test-select-row').getText();
  if (result === "Custom") {
    return driver.find('[data-test-id=Widget_dateCustomFormat] input').value();
  }
  return result;
}

/**
 * Changes date format for date and datetime editor
 */
export async function setDateFormat(format: string|RegExp) {
  await driver.find('[data-test-id=Widget_dateFormat]').click();
  await driver.findContentWait('.test-select-menu .test-select-row',
    typeof format === 'string' ? exactMatch(format) : format, 200).click();
  await waitForServer();
}

export async function setCustomDateFormat(format: string) {
  await setDateFormat("Custom");
  await driver.find('[data-test-id=Widget_dateCustomFormat]').click();
  await selectAll();
  await driver.sendKeys(format, Key.ENTER);
  await waitForServer();
}

/**
 * Returns time format for datetime editor
 */
export async function getTimeFormat(): Promise<string> {
  return driver.find('[data-test-id=Widget_timeFormat] .test-select-row').getText();
}

/**
 * Changes time format for datetime editor
 */
export async function setTimeFormat(format: string) {
  await driver.find('[data-test-id=Widget_timeFormat]').click();
  await driver.findContent('.test-select-menu .test-select-row', format).click();
  await waitForServer();
}

/**
 * Returns "Show column" setting value of a reference column.
 */
export async function getRefShowColumn(): Promise<string> {
  return driver.find('.test-fbuilder-ref-col-select').getText();
}

/**
 * Changes "Show column" setting value of a reference column.
 */
export async function setRefShowColumn(col: string) {
  await driver.find('.test-fbuilder-ref-col-select').click();
  await driver.findContent('.test-select-menu .test-select-row', col).click();
  await waitForServer();
}



/**
 * Returns "Data from table" setting value of a reference column.
 */
export async function getRefTable(): Promise<string> {
  return driver.find('.test-fbuilder-ref-table-select').getText();
}

/**
 * Changes "Data from table" setting value of a reference column.
 */
export async function setRefTable(table: string) {
  await driver.find('.test-fbuilder-ref-table-select').click();
  await driver.findContent('.test-select-menu .test-select-row', table).click();
  await waitForServer();
}

/**
 * Changes "Select by" of the current section.
 */
export async function selectBy(table: string|RegExp) {
  await toggleSidePanel('right', 'open');
  await driver.find('.test-right-tab-pagewidget').click();
  await driver.find('.test-config-data').click();
  await driver.find('.test-right-select-by').click();
  table = typeof table === 'string' ? exactMatch(table) : table;
  await driver.findContentWait('.test-select-menu li', table, 200).click();
  await waitForServer();
}

/**
 * Returns "Select by" of the current section.
 */
export async function selectedBy() {
  await toggleSidePanel('right', 'open');
  await driver.find('.test-right-tab-pagewidget').click();
  await driver.find('.test-config-data').click();
  return await driver.find('.test-right-select-by').getText();
}

// Add column to sort.
export async function addColumnToSort(colName: RegExp|string) {
  await driver.find(".test-sort-config-add").click();
  await driver.findContent(".test-sd-searchable-list-item", colName).click();
  await driver.findContentWait(".test-sort-config-row", colName, 100);
}

// Remove column from sort.
export async function removeColumnFromSort(colName: RegExp|string) {
  await findSortRow(colName).find(".test-sort-config-remove").click();
}

// Toggle column sort order from ascending to descending, or vice-versa.
export async function toggleSortOrder(colName: RegExp|string) {
  await findSortRow(colName).find(".test-sort-config-order").click();
}

// Reset the sort to the last saved sort.
export async function revertSortConfig() {
  await driver.find(".test-sort-filter-config-revert").click();
}

// Save the sort.
export async function saveSortConfig() {
  await driver.find(".test-sort-filter-config-save").click();
  await waitForServer();
}

// Update the data positions to the given sort.
export async function updateRowsBySort() {
  await driver.find(".test-sort-config-update").click();
  await waitForServer(10000);
}

// Returns a WebElementPromise for the sort row of the given col name.
export function findSortRow(colName: RegExp|string) {
  return driver.findContent(".test-sort-config-row", colName);
}

// Opens more sort options menu
export async function openMoreSortOptions(colName: RegExp|string) {
  const row = await findSortRow(colName);
  return row.find(".test-sort-config-options-icon").click();
}

// Selects one of the options in the more options menu.
export async function toggleSortOption(option: SortOption) {
  const label = await driver.find(`.test-sort-config-option-${option} label`);
  await label.click();
  await waitForServer();
}

// Closes more sort options menu.
export async function closeMoreSortOptionsMenu() {
  await driver.sendKeys(Key.ESCAPE);
}

export type SortOption = "naturalSort" | "emptyLast" | "orderByChoice";
export const SortOptions: ReadonlyArray<SortOption> = ["orderByChoice", "emptyLast", "naturalSort"];

// Returns checked sort options for current column. Assumes the menu is opened.
export async function getSortOptions(): Promise<SortOption[]> {
  const options: SortOption[] = [];
  for(const option of SortOptions) {
    const list = await driver.findAll(`.test-sort-config-option-${option} input:checked`);
    if (list.length) {
      options.push(option);
    }
  }
  options.sort();
  return options;
}

// Returns enabled entries in sort menu. Assumes the menu is opened.
export async function getEnabledOptions(): Promise<SortOption[]> {
  const options: SortOption[] = [];
  for(const option of SortOptions) {
    const list = await driver.findAll(`.test-sort-config-option-${option}:not(.disabled)`);
    if (list.length) {
      options.push(option);
    }
  }
  options.sort();
  return options;
}

/**
 * Runs action in a separate tab, closing the tab after.
 * In case of an error tab is not closed, consider using cleanupExtraWindows
 * on whole test suite if needed.
 *
 * If {test: this.test} is given in options, we will additionally record a screenshot and driver
 * logs, named using the test name, before opening the new tab, and before and after closing it.
 */
export async function onNewTab(action: () => Promise<void>, options?: {test?: Mocha.Runnable}) {
  const currentTab = await driver.getWindowHandle();
  await driver.executeScript("window.open('about:blank', '_blank')");
  const tabs = await driver.getAllWindowHandles();
  const newTab = tabs[tabs.length - 1];
  const test = options?.test;
  if (test) { await fetchScreenshotAndLogs(test); }
  await driver.switchTo().window(newTab);
  try {
    await action();
  } catch (e) {
    console.warn("onNewTab cleaning up tab after error", e);
    throw e;
  } finally {
    if (test) { await fetchScreenshotAndLogs(test); }
    const newCurrentTab = await driver.getWindowHandle();
    if (newCurrentTab === newTab) {
      await driver.close();
      await driver.switchTo().window(currentTab);
      console.log("onNewTab returned to original tab");
    } else {
      console.log("onNewTab not cleaning up because is not on expected tab");
    }
    if (test) { await fetchScreenshotAndLogs(test); }
  }
}

/**
 * Returns a controller for the current tab.
 */
export async function myTab() {
  const tabs = await driver.getAllWindowHandles();
  const myTab = tabs[tabs.length - 1];
  return {
    open() {
      return driver.switchTo().window(myTab);
    }
  };
}

/**
 * Duplicate current tab and return a controller for it. Assumes the current tab shows document.
 */
export async function duplicateTab() {
  const url = await driver.getCurrentUrl();
  await driver.executeScript("window.open('about:blank', '_blank')");
  const tabs = await driver.getAllWindowHandles();
  const myTab = tabs[tabs.length - 1];
  await driver.switchTo().window(myTab);
  await driver.get(url);
  await waitForDocToLoad();
  return {
    close() {
      return driver.close();
    },
    open() {
      return driver.switchTo().window(myTab);
    }
  };
}

/**
 * Scrolls active Grid or Card list view.
 */
export async function scrollActiveView(x: number, y: number) {
  await driver.executeScript(function(x1: number, y1: number) {
    const view = document.querySelector(".active_section .grid_view_data") ||
                 document.querySelector(".active_section .detailview_scroll_pane") ||
                 document.querySelector(".active_section .test-forms-editor");
    view!.scrollBy(x1, y1);
  }, x, y);
  await driver.sleep(10); // wait a bit for the scroll to happen (this is async operation in Grist).
}

export async function scrollActiveViewTop() {
  await driver.executeScript(function() {
    const view = document.querySelector(".active_section .grid_view_data") ||
                 document.querySelector(".active_section .detailview_scroll_pane") ||
                 document.querySelector(".active_section .test-forms-editor");
    view!.scrollTop = 0;
  });
  await driver.sleep(10); // wait a bit for the scroll to happen (this is async operation in Grist).
}

/**
 * Filters a column in a Grid using the filter menu.
 */
export async function filterBy(col: IColHeader|string, save: boolean, values: (string|RegExp)[]) {
  const filter = await openColumnFilter(col);
  await filter.none();
  for (const value of values) {
    await filter.toggleValue(value);
  }
  await filter.close();
  if (save) {
    await filter.save();
  }
}

/**
 * Opens a filter menu for a column and returns a controller for it.
 */
export async function openColumnFilter(col: IColHeader|string) {
  await openColumnMenu(col, 'Filter');
  return filterController;
}

/**
 * Opens a filter menu for a column and returns a controller for it.
 */
export async function openPinnedFilter(col: string) {
  const filterBar = driver.find('.active_section .test-filter-bar');
  const pinnedFilter = filterBar.findContent('.test-filter-field', col);
  await pinnedFilter.click();
  return filterController;
}

const filterController = {
  async toggleValue(value: string|RegExp) {
    await driver.findContent('.test-filter-menu-list label', value).click();
    return this;
  },
  async none() {
    await driver.findContent('.test-filter-menu-bulk-action', /None/).click();
    return this;
  },
  async all() {
    await driver.findContent('.test-filter-menu-bulk-action', /All/).click();
    return this;
  },
  async close() {
    await driver.find('.test-filter-menu-apply-btn').click();
    return this;
  },
  async cancel() {
    await driver.find('.test-filter-menu-cancel-btn').click();
    return this;
  },
  async save() {
    await driver.find('.test-section-menu-small-btn-save').click();
    await waitForServer();
    return this;
  }
};

/**
 * Opens the filter menu in the current section, and removes all filters. Optionally saves it.
 */
export async function removeFilters(save = false) {
  const sectionFilter = await sortAndFilter();
  for(const filter of await sectionFilter.filters()) {
    await filter.remove();
  }
  if (save) {
    await sectionFilter.save();
  } else {
    await sectionFilter.click();
  }
}

/**
 * Clicks on the filter icon in the current section, and returns a controller for it for interactions.
 */
export async function sortAndFilter() {
  const ctrl = {
    async addColumn() {
      await driver.find('.test-filter-config-add-filter-btn').click();
      return this;
    },
    async clickColumn(col: string) {
      await driver.findContent(".test-sd-searchable-list-item", col).click();
      return this;
    },
    async close() {
      await driver.find('.test-filter-menu-apply-btn').click();
      return this;
    },
    async save() {
      await driver.find('.test-section-menu-btn-save').click();
      await waitForServer();
      return this;
    },
    /**
     * Clicks the filter icon in the current section (can be used to close the filter menu or open it)
     */
    async click() {
      await driver.find('.active_section .test-section-menu-filter-icon').click();
      return this;
    },
    async filters() {
      const items = await driver.findAll('.test-filter-config-filter');
      return items.map(item => ({
        async remove() {
          await item.find('.test-filter-config-remove-filter').click();
          return this;
        },
        async togglePin() {
          await item.find('.test-filter-config-pin-filter').click();
          return this;
        }
      }));
    }
  };
  await ctrl.click();
  return ctrl;
}

export interface PinnedFilter {
  name: string;
  hasUnsavedChanges: boolean;
}

/**
 * Returns a list of all pinned filters in the active section.
 */
export async function getPinnedFilters(): Promise<PinnedFilter[]> {
  const filterBar = await driver.find('.active_section .test-filter-bar');
  const allFilters = await filterBar.findAll('.test-filter-field', async (el) => {
    const button = await el.find('.test-btn');
    const buttonClass = await button.getAttribute('class');
    return {
      name: await el.getText(),
      isPinned: await el.getCssValue('display') !== 'none',
      hasUnsavedChanges: !/\b\w+-grayed\b/.test(buttonClass),
    };
  });
  const pinnedFilters = allFilters.filter(({isPinned}) => isPinned);
  return pinnedFilters.map(({name, hasUnsavedChanges}) => ({name, hasUnsavedChanges}));
}

export interface FilterMenuValue {
  checked: boolean;
  value: string;
  count: number;
}

/**
 * Returns a list of all values in the filter menu and their associated state.
 */
export async function getFilterMenuState(): Promise<FilterMenuValue[]> {
  const items = await driver.findAll('.test-filter-menu-list > *');
  return await Promise.all(items.map(async item => {
    const checked = (await item.find('input').getAttribute('checked')) === null ? false : true;
    const value = await item.find('label').getText();
    const count = parseInt(await item.find('label + div').getText(), 10);
    return {checked, value, count};
  }));
}

/**
 * Dismisses any tutorial card that might be active.
 */
export async function dismissTutorialCard() {
  // If there is something in our way, we can't do it.
  if (await driver.find('.test-welcome-questions').isPresent()) {
    return;
  }
  if (await driver.find('.test-tutorial-card-close').isPresent()) {
    if (await driver.find('.test-tutorial-card-close').isDisplayed()) {
      await driver.find('.test-tutorial-card-close').click();
    }
  }
}

/**
 * Dismisses coaching call if needed.
 */
export async function dismissCoachingCall() {
  const selector = '.test-coaching-call .test-popup-close-button';
  if ((await driver.findAll(selector)).length) {
    await driver.find(selector).click();
  }
}

/**
 * Dismisses all card popups that are present.
 */
export async function dismissCardPopups(waitForServerTimeoutMs: number | null = 2000) {
  let i = 0;
  const max = 10;

  // Keep dismissing popups until there are no more, up to a maximum of 10 times.
  while (i < max && await driver.find('.test-popup-card').isPresent()) {
    await driver.find('.test-popup-close-button').click();
    if (waitForServerTimeoutMs) { await waitForServer(waitForServerTimeoutMs); }
    i += 1;
  }
}


/**
 * Confirms that anchor link was used for navigation.
 */
export async function waitForAnchor() {
  await waitForDocToLoad();
  await driver.wait(async () => (await getTestState()).anchorApplied, 2000);
}

export async function getAnchor() {
  await driver.find('body').sendKeys(Key.chord(Key.SHIFT, await modKey(), 'a'));
  return (await getTestState()).clipboard || '';
}

export async function getActiveSectionTitle(timeout?: number) {
  return await driver.findWait('.active_section .test-viewsection-title', timeout ?? 0).getText();
}

export async function getSectionTitle(timeout?: number) {
  return await driver.findWait('.test-viewsection-title', timeout ?? 0).getText();
}

export async function getSectionTitles() {
  return await driver.findAll('.test-viewsection-title', el => el.getText());
}

export async function renameSection(sectionTitle: string, name: string) {
  const renameWidget = driver.findContent(`.test-viewsection-title`, sectionTitle);
  await renameWidget.find(".test-widget-title-text").click();
  await driver.find(".test-widget-title-section-name-input").click();
  await selectAll();
  await driver.sendKeys(name || Key.DELETE, Key.ENTER);
  await waitForServer();
}

export async function renameActiveSection(name: string) {
  await driver.find(".active_section .test-viewsection-title .test-widget-title-text").click();
  await driver.find(".test-widget-title-section-name-input").click();
  await selectAll();
  await driver.sendKeys(name || Key.DELETE, Key.ENTER);
  await waitForServer();
}

/**
 * Renames active data table using widget title popup (from active section).
 */
export async function renameActiveTable(name: string) {
  await driver.find(".active_section .test-viewsection-title .test-widget-title-text").click();
  await driver.find(".test-widget-title-table-name-input").click();
  await selectAll();
  await driver.sendKeys(name, Key.ENTER);
  await waitForServer();
}

export async function setWidgetUrl(url: string) {
  await driver.find('.test-config-widget-url').click();
  // First clear textbox.
  await clearInput();
  if (url) {
    await sendKeys(url);
  }
  await sendKeys(Key.ENTER);
  await waitForServer();
}

type BehaviorActions = 'Clear and reset' | 'Convert column to data' | 'Clear and make into formula' |
                       'Convert columns to data';
/**
 * Opens a behavior menu and clicks one of the option.
 */
export async function changeBehavior(option: BehaviorActions|RegExp) {
  await openColumnPanel();
  await driver.find('.test-field-behaviour').click();
  await driver.findContent('.grist-floating-menu li', option).click();
  await waitForServer();
}

export async function columnBehavior() {
  return (await driver.find(".test-field-behaviour").getText());
}

/**
 * Gets all available options in the behavior menu.
 */
export async function availableBehaviorOptions() {
  await driver.find('.test-field-behaviour').click();
  const list = await driver.findAll('.grist-floating-menu li', el => el.getText());
  await driver.sendKeys(Key.ESCAPE);
  return list;
}

/**
 * Restarts the server ensuring that it is run with the given environment variables.
 * If variables are already set, the server is not restarted.
 *
 * Useful for local testing of features that depend on environment variables, as it avoids the need
 * to restart the server when those variables are already set.
 */
export function withEnvironmentSnapshot(vars: Record<string, any>) {
  let oldEnv: testUtils.EnvironmentSnapshot|null = null;
  before(async () => {
    // Test if the vars are already set, and if so, skip.
    if (Object.keys(vars).every(k => process.env[k] === vars[k])) { return; }
    oldEnv = new testUtils.EnvironmentSnapshot();
    for(const key of Object.keys(vars)) {
      if (vars[key] === undefined || vars[key] === null) {
        delete process.env[key];
      } else {
        process.env[key] = vars[key];
      }
    }
    await server.restart();
  });
  after(async () => {
    if (!oldEnv) { return; }
    oldEnv.restore();
    await server.restart();
  });
}

/**
 * Helper to scroll creator panel top or bottom. By default bottom.
 */
export function scrollPanel(top = false): WebElementPromise {
  return new WebElementPromise(driver,
    driver.executeScript((top: number) => {
      document.getElementsByClassName('test-config-container')[0].scrollTop = top ? 0 : 10000;
    }, top)
  );
}

/**
 * Helper to revert ACL changes. It first saves the current ACL data, and
 * then removes everything and adds it back.
 */
export async function beginAclTran(api: UserAPI, docId: string) {
  const oldRes = await api.getTable(docId, '_grist_ACLResources');
  const oldRules = await api.getTable(docId, '_grist_ACLRules');

  return async () => {
    const newRes = await api.getTable(docId, '_grist_ACLResources');
    const newRules = await api.getTable(docId, '_grist_ACLRules');
    const restoreRes = {tableId: oldRes.tableId, colIds: oldRes.colIds};
    const restoreRules = {
      resource: oldRules.resource,
      aclFormula: oldRules.aclFormula,
      permissionsText: oldRules.permissionsText
    };
    await api.applyUserActions(docId, [
      ['BulkRemoveRecord', '_grist_ACLRules', newRules.id],
      ['BulkRemoveRecord', '_grist_ACLResources', newRes.id],
      ['BulkAddRecord', '_grist_ACLResources', oldRes.id, restoreRes],
      ['BulkAddRecord', '_grist_ACLRules', oldRules.id, restoreRules],
    ]);
  };
}

/**
 * Helper to set the value of a column range filter bound. Helper also support picking relative date
 * from options for Date columns, simply pass {relative: '2 days ago'} as value.
 */
export async function setRangeFilterBound(minMax: 'min'|'max', value: string|{relative: string}|null) {
  await driver.find(`.test-filter-menu-${minMax}`).click();
  if (typeof value === 'string' || value === null) {
    await selectAll();
    await driver.sendKeys(value === null ? Key.DELETE : value);
    // send TAB to trigger blur event, that will force call on the debounced callback
    await driver.sendKeys(Key.TAB);
  } else {
    await waitToPass(async () => {
      // makes sure the relative options is opened
      if (!await driver.find('.grist-floatin-menu').isPresent()) {
        await driver.find(`.test-filter-menu-${minMax}`).click();
      }
      await driver.findContent('.grist-floating-menu li', value.relative).click();
    });
  }
}

export async function skipWelcomeQuestions() {
  if (await driver.find('.test-welcome-questions').isPresent()) {
    await driver.sendKeys(Key.ESCAPE);
    assert.equal(await driver.find('.test-welcome-questions').isPresent(), false);
  }
}

/**
 * Asserts whether a video of Never Gonna Give You Up is playing in the background.
 */
export async function assertIsRickRowing(expected: boolean) {
  assert.equal(await driver.find('.test-gristdoc-stop-rick-rowing').isPresent(), expected);
  assert.equal(await driver.find('.test-gristdoc-background-video').isPresent(), expected);
  assert.equal(await driver.find('iframe#youtube-player-dQw4w9WgXcQ').isPresent(), expected);
}


export function produceUncaughtError(message: string) {
  // Simply throwing an error from driver.executeScript() may produce a sanitized "Script error",
  // depending on browser/webdriver version. This is a trick to ensure the uncaught error is
  // considered same-origin by the main window.
  return driver.executeScript((msg: string) => {
    const script = document.createElement("script");
    script.type = "text/javascript";
    script.innerText = 'setTimeout(() => { throw new Error(' + JSON.stringify(msg) + '); }, 0)';
    document.head.appendChild(script);
  }, message);
}

export async function downloadSectionCsv(
  section: string, headers: any = {Authorization: 'Bearer api_key_for_chimpy'}
) {
  await openSectionMenu("viewLayout", section);
  const href = await driver.findWait('.test-download-section', 1000).getAttribute('href');
  await driver.sendKeys(Key.ESCAPE);  // Close section menu
  const resp = await axios.get(href, { responseType: 'text', headers });
  return resp.data as string;
}

export async function downloadSectionCsvGridCells(
  section: string, headers: any = {Authorization: 'Bearer api_key_for_chimpy'}
): Promise<string[]> {
  const csvString = await downloadSectionCsv(section, headers);
  const csvRows = csvString.split('\n').slice(1).map(csvDecodeRow);
  return ([] as string[]).concat(...csvRows);
}

export async function setGristTheme(options: {
  appearance: 'light' | 'dark',
  syncWithOS: boolean,
  skipOpenSettingsPage?: boolean,
}) {
  const {appearance, syncWithOS, skipOpenSettingsPage} = options;
  if (!skipOpenSettingsPage) {
    await openProfileSettingsPage();
  }

  await scrollIntoView(driver.find('.test-theme-config-sync-with-os'));
  const isSyncWithOSChecked = await driver.find('.test-theme-config-sync-with-os').getAttribute('checked') === 'true';
  if (syncWithOS !== isSyncWithOSChecked) {
    await driver.find('.test-theme-config-sync-with-os').click();
    await waitForServer();
  }

  if (!syncWithOS) {
    await scrollIntoView(driver.find('.test-theme-config-appearance .test-select-open'));
    await driver.find('.test-theme-config-appearance .test-select-open').click();
    await driver.findContent('.test-select-menu li', appearance === 'light' ? 'Light' : 'Dark')
      .click();
    await waitForServer();
  }
}

/**
 * Executes custom code inside active custom widget.
 */
export async function customCode(fn: (grist: typeof PluginApi) => void) {
  const section = await driver.findWait('.active_section iframe', 4000);
  return await doInIframe(section, async () => {
    return await driver.executeScript(`(${fn})(grist)`);
  });
}

/**
 * Gets or sets widget access level (doesn't deal with prompts).
 */
export async function widgetAccess(level?: AccessLevel) {
  const text = {
    [AccessLevel.none]: 'No document access',
    [AccessLevel.read_table]: 'Read selected table',
    [AccessLevel.full]: 'Full document access',
  };
  if (!level) {
    const currentAccess = await driver.find('.test-config-widget-access .test-select-open').getText();
    return Object.entries(text).find(e => e[1] === currentAccess)![0];
  } else {
    await driver.find('.test-config-widget-access .test-select-open').click();
    await driver.findContent('.test-select-menu li', text[level]).click();
    await waitForServer();
  }
}

/**
 * Checks if access prompt is visible.
 */
export async function hasAccessPrompt() {
  return await driver.find('.test-config-widget-access-accept').isPresent();
}

/**
 * Accepts new access level.
 */
export async function acceptAccessRequest() {
  await driver.findWait('.test-config-widget-access-accept', 1000).click();
}

/**
 * Rejects new access level.
 */
export async function rejectAccessRequest() {
  await driver.find('.test-config-widget-access-reject').click();
}

/**
 * Sets widget access level (deals with requests).
 */
export async function changeWidgetAccess(access: 'read table'|'full'|'none') {
  await openWidgetPanel();

  // if the current access is ok do nothing
  if ((await widgetAccess()) === access) {
    // unless we need to confirm it
    if (await hasAccessPrompt()) {
      await acceptAccessRequest();
    }
  } else {
    // else switch access level
    await widgetAccess(access as AccessLevel);
  }
}


/**
 * Recently, driver.switchTo().window() has become a little flakey,
 * methods may fail if called immediately after switching to a
 * window. This method works around the problem by waiting for
 * driver.getCurrentUrl to succeed.
 *  https://github.com/SeleniumHQ/selenium/issues/12277
 */
export async function switchToWindow(target: string) {
  await driver.switchTo().window(target);
  for (let i = 0; i < 10; i++) {
    try {
      await driver.getCurrentUrl();
      break;
    } catch (e) {
      console.log("switchToWindow retry after error:", e);
      await driver.sleep(250);
    }
  }
}

/**
 * Creates a temporary textarea to the document for pasting the contents of
 * the clipboard.
 */
export async function createClipboardTextArea() {
  function createTextArea() {
    const textArea = window.document.createElement('textarea');
    textArea.style.position = 'absolute';
    textArea.style.top = '0';
    textArea.style.height = '2rem';
    textArea.style.width = '16rem';
    textArea.id = 'clipboardText';
    window.document.body.appendChild(textArea);
  }

  await driver.executeScript(createTextArea);
}

/**
 * Removes the temporary textarea added by `createClipboardTextArea`.
 */
export async function removeClipboardTextArea() {
  function removeTextArea() {
    const textArea = window.document.getElementById('clipboardText');
    if (textArea) {
      window.document.body.removeChild(textArea);
    }
  }

  await driver.executeScript(removeTextArea);
}

/**
 * Sets up a temporary textarea for pasting the contents of the clipboard,
 * removing it after all tests have run.
 */
export function withClipboardTextArea() {
  before(async function() {
    await createClipboardTextArea();
  });

  after(async function() {
    await removeClipboardTextArea();
  });
}

/*
 * Returns an instance of `LockableClipboard`, making sure to unlock it after
 * each test.
 *
 * Recommended for use in contexts where the system clipboard may be accessed by
 * multiple parallel processes, such as Mocha tests.
 */
export function getLockableClipboard() {
  const cb = new LockableClipboard();

  afterEach(async () => {
    await cb.unlock();
  });

  return cb;
}

export interface ILockableClipboard {
  lockAndPerform(callback: (clipboard: IClipboard) => Promise<void>): Promise<void>;
  unlock(): Promise<void>;
}

class LockableClipboard implements ILockableClipboard {
  private _unlock: (() => Promise<void>) | null = null;

  constructor() {

  }

  public async lockAndPerform(callback: (clipboard: IClipboard) => Promise<void>) {
    this._unlock = await lock(path.resolve(getAppRoot(), 'test'), {
      lockfilePath: path.join(path.resolve(getAppRoot(), 'test'), '.clipboard.lock'),
      retries: {
        /* The clipboard generally isn't locked for long, so retry frequently. */
        minTimeout: 200,
        maxTimeout: 200,
        retries: 100,
      },
    });
    try {
      await callback(new Clipboard());
    } finally {
      await this.unlock();
    }
  }

  public async unlock() {
    await this._unlock?.();
    this._unlock = null;
  }
}

export type ClipboardAction = 'copy' | 'cut' | 'paste';

export interface ClipboardActionOptions {
  method?: 'keyboard' | 'menu';
}

export interface IClipboard {
  copy(options?: ClipboardActionOptions): Promise<void>;
  cut(options?: ClipboardActionOptions): Promise<void>;
  paste(options?: ClipboardActionOptions): Promise<void>;
}

class Clipboard implements IClipboard {
  constructor() {

  }

  public async copy(options: ClipboardActionOptions = {}) {
    await this._performAction('copy', options);
  }

  public async cut(options: ClipboardActionOptions = {}) {
    await this._performAction('cut', options);
  }

  public async paste(options: ClipboardActionOptions = {}) {
    await this._performAction('paste', options);
  }

  private async _performAction(action: ClipboardAction, options: ClipboardActionOptions) {
    const {method = 'keyboard'} = options;
    switch (method) {
      case 'keyboard': {
        await this._performActionWithKeyboard(action);
        break;
      }
      case 'menu': {
        await this._performActionWithMenu(action);
        break;
      }
    }
  }

  private async _performActionWithKeyboard(action: ClipboardAction) {
    switch (action) {
      case 'copy': {
        await sendKeys(Key.chord(await isMac() ? Key.COMMAND : Key.CONTROL, 'c'));
        break;
      }
      case 'cut': {
        await sendKeys(Key.chord(await isMac() ? Key.COMMAND : Key.CONTROL, 'x'));
        break;
      }
      case 'paste': {
        await sendKeys(Key.chord(await isMac() ? Key.COMMAND : Key.CONTROL, 'v'));
        break;
      }
    }
  }

  private async _performActionWithMenu(action: ClipboardAction) {
    const field = await driver.find('.active_section .field_clip.has_cursor');
    await driver.withActions(actions => { actions.contextClick(field); });
    await driver.findWait('.grist-floating-menu', 1000);
    const menuItemName = action.charAt(0).toUpperCase() + action.slice(1);
    await driver.findContent('.grist-floating-menu li', menuItemName).click();
  }
}

/**
 * Runs a Grist command in the browser window.
 */
export async function sendCommand(name: CommandName, argument: any = null) {
  await driver.executeAsyncScript((name: any, argument: any, done: any) => {
    const result = (window as any).gristApp.allCommands[name].run(argument);
    if (result?.finally) {
      result.finally(done);
    } else {
      done();
    }
  }, name, argument);
  await waitForServer();
}

/**
 * Helper controller for choices list editor.
 */
export const choicesEditor = {
  async hasReset() {
    return (await driver.find(".test-choice-list-entry-edit").getText()) === "Reset";
  },
  async reset() {
    await driver.findWait(".test-choice-list-entry-edit", 100).click();
  },
  async label() {
    return await driver.find(".test-choice-list-entry-row").getText();
  },
  async add(label: string) {
    await driver.find(".test-tokenfield-input").click();
    await driver.find(".test-tokenfield-input").clear();
    await sendKeys(label, Key.ENTER);
  },
  async rename(label: string, label2: string) {
    const entry = await driver.findWait(`.test-choice-list-entry .test-token-label[value='${label}']`, 100);
    await entry.click();
    await sendKeys(label2);
    await sendKeys(Key.ENTER);
  },
  async color(token: string, color: string) {
    const label = await driver.findWait(`.test-choice-list-entry .test-token-label[value='${token}']`, 100);
    await label.findClosest(".test-tokenfield-token").find(".test-color-button").click();
    await setFillColor(color);
    await sendKeys(Key.ENTER);
  },
  async read() {
    return await driver.findAll(".test-choice-list-entry-label", e => e.getText());
  },
  async edit() {
    await this.reset();
  },
  async save() {
    await driver.find(".test-choice-list-entry-save").click();
    await waitForServer();
  },
  async cancel() {
    await driver.find(".test-choice-list-entry-cancel").click();
  }
};

export function findValue(selector: string, value: string|RegExp) {
  const inner = async () => {
    const all = await driver.findAll(selector);
    const tested: string[] = [];
    for(const el of all) {
      const elValue = await el.value();
      tested.push(elValue);
      const found = typeof value === 'string' ? elValue === value : value.test(elValue);
      if (found) { return el; }
    }
    throw new Error(`No element found matching ${selector}, tested ${tested.join(', ')}`);
  };
  return new WebElementPromise(driver, inner());
}

} // end of namespace gristUtils

stackWrapOwnMethods(gristUtils);
export = gristUtils;
