/**
 * Replicates functionality of test/browser/gristUtils.ts for new-style tests.
 *
 * The helpers are themselves tested in TestGristUtils.ts.
 */
import * as fse from 'fs-extra';
import escapeRegExp = require('lodash/escapeRegExp');
import noop = require('lodash/noop');
import startCase = require('lodash/startCase');
import { assert, driver, error, Key, WebElement, WebElementPromise } from 'mocha-webdriver';
import { stackWrapFunc, stackWrapOwnMethods } from 'mocha-webdriver';
import * as path from 'path';

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

import { HomeUtil } from 'test/nbrowser/homeUtil';
import { server } from 'test/nbrowser/testServer';
import { Cleanup } from 'test/nbrowser/testUtils';
import * as testUtils from 'test/server/testUtils';
import type { AssertionError } from 'assert';

// tslint:disable:no-namespace
// Wrap in a namespace so that we can apply stackWrapOwnMethods to all the exports together.
namespace gristUtils {

const homeUtil = new HomeUtil(testUtils.fixturesRoot, server);

export const createNewDoc = homeUtil.createNewDoc.bind(homeUtil);
// importFixturesDoc has a custom implementation that supports 'load' flag.
export const uploadFixtureDoc = homeUtil.uploadFixtureDoc.bind(homeUtil);
export const getWorkspaceId = homeUtil.getWorkspaceId.bind(homeUtil);
export const listDocs = homeUtil.listDocs.bind(homeUtil);
export const createHomeApi = homeUtil.createHomeApi.bind(homeUtil);
export const simulateLogin = homeUtil.simulateLogin.bind(homeUtil);
export const removeLogin = homeUtil.removeLogin.bind(homeUtil);
export const setValue = homeUtil.setValue.bind(homeUtil);
export const isOnLoginPage = homeUtil.isOnLoginPage.bind(homeUtil);
export const isOnGristLoginPage = homeUtil.isOnLoginPage.bind(homeUtil);
export const checkLoginPage = homeUtil.checkLoginPage.bind(homeUtil);
export const checkGristLoginPage = homeUtil.checkGristLoginPage.bind(homeUtil);

export const fixturesRoot: string = testUtils.fixturesRoot;

// it is sometimes useful in debugging to turn off automatic cleanup of docs and workspaces.
export const noCleanup = Boolean(process.env.NO_CLEANUP);

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
export function exactMatch(value: string): RegExp {
  return new RegExp(`^${escapeRegExp(value)}$`);
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
 * Helper to scroll an element into view.
 */
export function scrollIntoView(elem: WebElement): Promise<void> {
  return driver.executeScript((el: any) => el.scrollIntoView({behavior: 'auto'}), elem);
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
export async function selectSectionByTitle(title: string) {
  // .test-viewsection is a special 1px width element added for tests only.
  await driver.findContent(`.test-viewsection-title`, title).find(".test-viewsection-blank").click();
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
export async function getVisibleDetailCells<T = string>(options: IColSelect<T>): Promise<T[]>;
export async function getVisibleDetailCells<T>(
  colOrOptions: number|string|IColSelect<T>, _rowNums?: number[], _section?: string
): Promise<T[]> {
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
export function getColumnHeader(colOptions: IColHeader): WebElementPromise {
  const {col, section} = colOptions;
  const sectionElem = section ? getSection(section) : driver.findWait('.active_section', 4000);
  return new WebElementPromise(driver, typeof col === 'number' ?
    sectionElem.find(`.column_name:nth-child(${col + 1})`) :
    sectionElem.findContent('.column_name', exactMatch(col)));
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
 * Returns {rowNum, col} object representing the position of the cursor in the active view
 * section. RowNum is a 1-based number as in the row headers, and col is a 0-based index for
 * grid view or field name for detail view.
 */
export async function getCursorPosition() {
  return await retryOnStale(async () => {
    const section = await driver.findWait('.active_section', 4000);
    const cursor = await section.findWait('.active_cursor', 1000);
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
 */
export async function enterFormula(formula: string) {
  await driver.sendKeys('=');
  await waitAppFocus(false);
  if (await driver.find('.test-editor-tooltip-convert').isPresent()) {
    await driver.find('.test-editor-tooltip-convert').click();
  }
  await driver.sendKeys(formula, Key.ENTER);
  await waitForServer();
}

/**
 * Check that formula editor is shown and its value matches the given regexp.
 */
export async function getFormulaText() {
  assert.equal(await driver.findWait('.test-formula-editor', 500).isDisplayed(), true);
  return await driver.find('.code_editor_container').getText();
}

/**
 * Check that formula editor is shown and its value matches the given regexp.
 */
export async function checkFormulaEditor(value: RegExp|string) {
  assert.equal(await driver.findWait('.test-formula-editor', 500).isDisplayed(), true);
  const valueRe = typeof value === 'string' ? exactMatch(value) : value;
  assert.match(await driver.find('.code_editor_container').getText(), valueRe);
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
 * Wait for the doc to be loaded, to the point of finishing fetch for the data on the current
 * page. If you navigate from a doc page, use e.g. waitForUrl() before waitForDocToLoad() to
 * ensure you are checking the new page and not the old.
 */
export async function waitForDocToLoad(timeoutMs: number = 10000): Promise<void> {
  await driver.findWait('.viewsection_title', timeoutMs);
  await waitForServer();
}

export async function reloadDoc() {
  await driver.navigate().refresh();
  await waitForDocToLoad();
}

/**
 * Wait for the doc list to show, to know that workspaces are fetched, and imports enabled.
 */
export async function waitForDocMenuToLoad(): Promise<void> {
  await driver.findWait('.test-dm-doclist', 1000);
  await driver.wait(() => driver.find('.test-dm-doclist').isDisplayed(), 2000);
}

export async function waitToPass(check: () => Promise<void>, timeMs: number = 4000) {
  try {
    await driver.wait(async () => {
      try {
        await check();
      } catch (e) {
        return false;
      }
      return true;
    }, timeMs);
  } catch (e) {
    await check();
  }
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
  await waitForServer();
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
  await driver.wait(async () => (await driver.findWait('.kf_elabel_input', 100).hasFocus()), 300);
}

/**
 * Waits for all pending comm requests from the client to the doc worker to complete. This taps into
 * Grist's communication object in the browser to get the count of pending requests.
 *
 * Simply call this after some request has been made, and when it resolves, you know that request
 * has been processed.
 * @param optTimeout: Timeout in ms, defaults to 2000.
 */
export async function waitForServer(optTimeout: number = 2000) {
  await driver.wait(() => driver.executeScript(
    "return window.gristApp && (!window.gristApp.comm || !window.gristApp.comm.hasActiveRequests())"
    + " && window.gristApp.testNumPendingApiRequests() === 0",
    optTimeout,
    "Timed out waiting for server requests to complete"
  ));
}

/**
 * Sends UserActions using client api from the browser.
 */
export async function sendActions(actions: UserAction[]) {
  await driver.executeScript(`
    gristDocPageModel.gristDoc.get().docModel.docData.sendActions(${JSON.stringify(actions)});
  `);
  await waitForServer();
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

export interface PageWidgetPickerOptions {
  tableName?: string;
  selectBy?: RegExp|string;      // Optional pattern of SELECT BY option to pick.
  summarize?: (RegExp|string)[];   // Optional list of patterns to match Group By columns.
  dontAdd?: boolean;  // If true, configure the widget selection without actually adding to the page
}

// Add a new page using the 'Add New' menu and wait for the new page to be shown.
export async function addNewPage(
  typeRe: RegExp|'Table'|'Card'|'Card List'|'Chart'|'Custom',
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

// Add a new widget to the current page using the 'Add New' menu.
export async function addNewSection(typeRe: RegExp|string, tableRe: RegExp|string, options?: PageWidgetPickerOptions) {
  // Click the 'Add widget to page' entry in the 'Add New' menu
  await driver.findWait('.test-dp-add-new', 2000).doClick();
  await driver.findWait('.test-dp-add-widget-to-page', 500).doClick();

  // add widget
  await selectWidget(typeRe, tableRe, options);
}

export async function openAddWidgetToPage() {
  await driver.findWait('.test-dp-add-new', 2000).doClick();
  await driver.findWait('.test-dp-add-widget-to-page', 2000).doClick();
}

// Select type and table that matches respectively typeRe and tableRe and save. The widget picker
// must be already opened when calling this function.
export async function selectWidget(
  typeRe: RegExp|string,
  tableRe: RegExp|string = '',
  options: PageWidgetPickerOptions = {}) {

  // select right type
  await driver.findContent('.test-wselect-type', typeRe).doClick();

  if (tableRe) {
    const tableEl = driver.findContent('.test-wselect-table', tableRe);

    // unselect all selected columns
    for (const col of (await driver.findAll('.test-wselect-column[class*=-selected]'))) {
      await col.click();
    }

    // let's select table
    await tableEl.click();

    const pivotEl = tableEl.find('.test-wselect-pivot');
    if (await pivotEl.isPresent()) {
      await toggleSelectable(pivotEl, Boolean(options.summarize));
    }

    if (options.summarize) {
      for (const columnEl of await driver.findAll('.test-wselect-column')) {
        const label = await columnEl.getText();
        // TODO: Matching cols with regexp calls for trouble and adds no value. I think function should be
        // rewritten using string matching only.
        const goal = Boolean(options.summarize.find(r => label.match(r)));
        await toggleSelectable(columnEl, goal);
      }
    }

    if (options.selectBy) {
      // select link
      await driver.find('.test-wselect-selectby').doClick();
      await driver.findContent('.test-wselect-selectby option', options.selectBy).doClick();
    }
  }


  if (options.dontAdd) {
    return;
  }

  // add the widget
  await driver.find('.test-wselect-addBtn').doClick();

  // if we selected a new table, there will be a popup for a name
  const prompts = await driver.findAll(".test-modal-prompt");
  const prompt = prompts[0];
  if (prompt) {
    if (options.tableName) {
      await prompt.doClear();
      await prompt.click();
      await driver.sendKeys(options.tableName);
    }
    await driver.find(".test-modal-confirm").click();
  }

  await waitForServer();
}

export async function changeWidget(type: string) {
  await openWidgetPanel();
  await driver.findContent('.test-right-panel button', /Change Widget/).click();
  await selectWidget(type);
  await waitForServer();
}

/**
 * Toggle elem if not selected. Expects elem to be clickable and to have a class ending with
 * -selected when selected.
 */
async function toggleSelectable(elem: WebElement, goal: boolean) {
  const isSelected = await elem.matches('[class*=-selected]');
  if (goal !== isSelected) {
    await elem.click();
  }
}

/**
 * Rename the given page to a new name. The oldName can be a full string name or a RegExp.
 */
export async function renamePage(oldName: string|RegExp, newName: string) {
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
    await popup.find(`.test-removepage-option-${options.withData ? 'data': 'page'}`).click();
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
export async function renameColumn(col: IColHeader, newName: string) {
  const header = await getColumnHeader(col);
  await header.click();
  await header.click();   // Second click opens the label for editing.
  await header.find('.kf_elabel_input').sendKeys(newName, Key.ENTER);
  await waitForServer();
}

/**
 * Removes a table using RAW data view. Returns a current url.
 */
export async function removeTable(tableId: string, goBack: boolean = false) {
  const back = await driver.getCurrentUrl();
  await driver.find(".test-tools-raw").click();
  const tableIdList = await driver.findAll('.test-raw-data-table-id', e => e.getText());
  const tableIndex = tableIdList.indexOf(tableId);
  assert.isTrue(tableIndex >= 0, `No raw table with id ${tableId}`);
  const menus = await driver.findAll(".test-raw-data-table .test-raw-data-table-menu");
  assert.equal(menus.length, tableIdList.length);
  await menus[tableIndex].click();
  await driver.find(".test-raw-data-menu-remove").click();
  await driver.find(".test-modal-confirm").click();
  await waitForServer();
  if (goBack) {
    await driver.get(back);
    await waitAppFocus();
  }
  return back;
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

export function isSidePanelOpen(which: 'right'|'left'): Promise<boolean> {
  return driver.find(`.test-${which}-panel`).matches('[class*=-open]');
}

/*
 * Toggles (opens or closes) the right or left panel and wait for the transition to complete. An optional
 * argument can specify the desired state.
 */
export async function toggleSidePanel(which: 'right'|'left', goal: 'open'|'close'|'toggle' = 'toggle') {
  if ((goal === 'open' && await isSidePanelOpen(which)) ||
      (goal === 'close' && !await isSidePanelOpen(which))) {
    return;
  }

  // Adds '-ns' when narrow screen
  const suffix = (await getWindowDimensions()).width < 768 ? '-ns' : '';

  // click the opener and wait for the duration of the transition
  await driver.find(`.test-${which}-opener${suffix}`).doClick();
  await waitForSidePanel();
}

export async function waitForSidePanel() {
  // 0.4 is the duration of the transition setup in app/client/ui/PagePanels.ts for opening the
  // side panes
  const transitionDuration = 0.4;

  // let's add an extra delay of 0.1 for even more robustness
  const delta = 0.1;
  await driver.sleep((transitionDuration + delta) * 1000);
}

/**
 * Opens a Creator Panel on Widget/Table settings tab.
 */
export async function openWidgetPanel() {
  await toggleSidePanel('right', 'open');
  await driver.find('.test-right-tab-pagewidget').click();
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

export async function renameRawTable(tableId: string, newName: string) {
  await driver.find(`.test-raw-data-table .test-raw-data-table-id-${tableId}`)
    .findClosest('.test-raw-data-table')
    .find('.test-widget-title-text')
    .click();
  const input = await driver.find(".test-widget-title-table-name-input");
  await input.doClear();
  await input.click();
  await driver.sendKeys(newName, Key.ENTER);
  await waitForServer();
}

export async function isRawTableOpened() {
  return await driver.find('.test-raw-data-close-button').isPresent();
}

export async function closeRawTable() {
  await driver.find('.test-raw-data-close-button').click();
}

/**
 * Toggles (opens or closes) the filter bar for a section.
 */
export async function toggleFilterBar(goal: 'open'|'close'|'toggle' = 'toggle',
                                      options: {section?: string|WebElement, save?: boolean} = {}) {
  const isOpen = await driver.find('.test-filter-bar').isPresent();
  if ((goal === 'close') && !isOpen ||
      (goal === 'open') && isOpen ) {
    return;
  }
  const menu = await openSectionMenu('sortAndFilter', options.section);
  await menu.findContent('.grist-floating-menu > div', /Toggle Filter Bar/).find('.test-section-menu-btn').click();
  if (options.save) {
    await menu.findContent('.grist-floating-menu button', /Save/).click();
    await waitForServer();
  }
  await menu.sendKeys(Key.ESCAPE);
}

/**
 * Opens the section menu for a section, or the active section if no section is given.
 */
export async function openSectionMenu(which: 'sortAndFilter'|'viewLayout', section?: string|WebElement) {
  const sectionElem = section ? await getSection(section) : await driver.findWait('.active_section', 4000);
  await sectionElem.find(`.test-section-menu-${which}`).click();
  return await driver.findWait('.grist-floating-menu', 100);
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
}

/**
 * Sets the type of the currently selected field to value.
 */
export async function setType(type: RegExp|string, options: {skipWait?: boolean, apply?: boolean} = {}) {
  await toggleSidePanel('right', 'open');
  await driver.find('.test-right-tab-field').click();
  await driver.find('.test-fbuilder-type-select').click();
  type = typeof type === 'string' ? exactMatch(type) : type;
  await driver.findContentWait('.test-select-menu .test-select-row', type, 500).click();
  if (!options.skipWait || options.apply) { await waitForServer(); }
  if (options.apply) {
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
  return /Darwin|Mac|iPod|iPhone|iPad/i.test((await driver.getCapabilities()).get('platform'));
}

export async function modKey() {
  return await isMac() ? Key.COMMAND : Key.CONTROL;
}

// For copy-pasting, use different key combinations for Chrome on Mac.
// See http://stackoverflow.com/a/41046276/328565
export async function copyKey() {
  return await isMac() ? Key.chord(Key.CONTROL, Key.INSERT) : Key.chord(Key.CONTROL, 'c');
}

export async function cutKey() {
  return await isMac() ? Key.chord(Key.CONTROL, Key.DELETE) : Key.chord(Key.CONTROL, 'x');
}

export async function pasteKey() {
  return await isMac() ? Key.chord(Key.SHIFT, Key.INSERT) : Key.chord(Key.CONTROL, 'v');
}

export async function selectAllKey() {
  return await isMac() ? Key.chord(Key.HOME, Key.SHIFT, Key.END) : Key.chord(Key.CONTROL, 'a');
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
        if ([Key.SHIFT, Key.CONTROL, Key.ALT, Key.META].includes(key)) {
          a.keyDown(key);
          toRelease.push(key);
        } else if (key === Key.NULL) {
          toRelease.splice(0).reverse().forEach(k => a.keyUp(k));
        } else {
          a.keyDown(key);
          a.keyUp(key);
        }
      }
    }
  });
}

/**
 * Clears active input by sending HOME + SHIFT END + DELETE.
 */
export async function clearInput() {
  return sendKeys(Key.HOME, Key.chord(Key.SHIFT, Key.END), Key.DELETE);
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
                                retainExistingLogin?: boolean}) {
    // Optimize testing a little bit, so if we are already logged in as the expected
    // user on the expected org, and there are no options set, we can just continue.
    if (!options && await this.isLoggedInCorrectly()) { return this; }
    if (!options?.retainExistingLogin) {
      await removeLogin();
      if (this.settings.email === 'anon@getgrist.com') { return this; }
    }
    await server.simulateLogin(this.settings.name, this.settings.email, this.settings.orgDomain,
                               {isFirstLogin: false, cacheCredentials: true, ...options});
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
  public async loadDoc(relPath: string, wait: boolean = true) {
    await this.loadRelPath(relPath);
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
      if (await driver.find('.test-welcome-questions').isPresent()) {
        await driver.sendKeys(Key.ESCAPE);
        assert.equal(await driver.find('.test-welcome-questions').isPresent(), false);
      }
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

export async function clickAway() {
  await driver.find(".test-notifier-menu-btn").click();
  await driver.sendKeys(Key.ESCAPE);
}

export function openColorPicker() {
  return driver.find('.test-color-select').click();
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
  await driver.findContent('.grist-floating-menu li', `Show column ${name}`).click();
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

export interface WindowDimensions {
  width: number;
  height: number;
}

/**
 * Gets browser window dimensions.
 */
 export async function getWindowDimensions(): Promise<WindowDimensions> {
  const {width, height} = await driver.manage().window().getRect();
  return {width, height};
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
  await driver.findContent('.grist-floating-menu a', 'Profile Settings').click();
  await driver.findWait('.test-account-page-login-method', 5000);
}

export async function openDocumentSettings() {
  await openAccountMenu();
  await driver.findContent('.grist-floating-menu li', 'Document Settings').click();
  await driver.findWait('.test-modal-title', 5000);
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

// Add column to sort.
export async function addColumnToSort(colName: RegExp|string) {
  await driver.find(".test-vconfigtab-sort-add").click();
  await driver.findContent(".test-vconfigtab-sort-add-menu-row", colName).click();
  await driver.findContentWait(".test-vconfigtab-sort-row", colName, 100);
}

// Remove column from sort.
export async function removeColumnFromSort(colName: RegExp|string) {
  await findSortRow(colName).find(".test-vconfigtab-sort-remove").click();
}

// Toggle column sort order from ascending to descending, or vice-versa.
export async function toggleSortOrder(colName: RegExp|string) {
  await findSortRow(colName).find(".test-vconfigtab-sort-order").click();
}

// Change the column at the given sort position.
export async function changeSortDropdown(colName: RegExp|string, newColName: RegExp|string) {
  await findSortRow(colName).find(".test-select-row").click();
  await driver.findContent("li .test-select-row", newColName).click();
}

// Reset the sort to the last saved sort.
export async function revertSortConfig() {
  await driver.find(".test-vconfigtab-sort-reset").click();
}

// Save the sort.
export async function saveSortConfig() {
  await driver.find(".test-vconfigtab-sort-save").click();
  await waitForServer();
}

// Update the data positions to the given sort.
export async function updateRowsBySort() {
  await driver.find(".test-vconfigtab-sort-update").click();
  await waitForServer(10000);
}

// Returns a WebElementPromise for the sort row of the given col name.
export function findSortRow(colName: RegExp|string) {
  return driver.findContent(".test-vconfigtab-sort-row", colName);
}

// Opens more sort options menu
export async function openMoreSortOptions(colName: RegExp|string) {
  const row = await findSortRow(colName);
  return row.find(".test-vconfigtab-sort-options-icon").click();
}

// Selects one of the options in the more options menu.
export async function toggleSortOption(option: SortOption) {
  const label = await driver.find(`.test-vconfigtab-sort-option-${option} label`);
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
    const list = await driver.findAll(`.test-vconfigtab-sort-option-${option} input:checked`);
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
    const list = await driver.findAll(`.test-vconfigtab-sort-option-${option}:not(.disabled)`);
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
 * on whole test suit if needed.
 */
export async function onNewTab(action: () => Promise<void>) {
  await driver.executeScript("return window.open('about:blank', '_blank')");
  const tabs = await driver.getAllWindowHandles();
  await driver.switchTo().window(tabs[tabs.length - 1]);
  await action();
  await driver.close();
  await driver.switchTo().window(tabs[tabs.length - 2]);
}

/**
 * Scrolls active Grid or Card list view.
 */
export async function scrollActiveView(x: number, y: number) {
  await driver.executeScript(function(x1: number, y1: number) {
    const view = document.querySelector(".active_section .grid_view_data") ||
                 document.querySelector(".active_section .detailview_scroll_pane");
    view!.scrollBy(x1, y1);
  }, x, y);
  await driver.sleep(10); // wait a bit for the scroll to happen (this is async operation in Grist).
}

export async function scrollActiveViewTop() {
  await driver.executeScript(function() {
    const view = document.querySelector(".active_section .grid_view_data") ||
                 document.querySelector(".active_section .detailview_scroll_pane");
    view!.scrollTop = 0;
  });
  await driver.sleep(10); // wait a bit for the scroll to happen (this is async operation in Grist).
}

/**
 * Filters a column in a Grid using the filter menu.
 */
export async function filterBy(col: IColHeader|string, save: boolean, values: (string|RegExp)[]) {
  await openColumnMenu(col, 'Filter');
  // Select none at start
  await driver.findContent('.test-filter-menu-bulk-action', /None/).click();
  for(const value of values) {
    await driver.findContent('.test-filter-menu-list label', value).click();
  }
  // Save filters
  await driver.find('.test-filter-menu-apply-btn').click();
  if (save) {
    await driver.find('.test-section-menu-small-btn-save').click();
  }
  await waitForServer();
}

/**
 * Refresh browser and dismiss alert that is shown (for refreshing during edits).
 */
export async function refreshDismiss() {
  await driver.navigate().refresh();
  await (await driver.switchTo().alert()).accept();
  await waitForDocToLoad();
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

/**
 * Opens a behavior menu and clicks one of the option.
 */
export async function changeBehavior(option: string|RegExp) {
  await driver.find('.test-field-behaviour').click();
  await driver.findContent('.grist-floating-menu li', option).click();
  await waitForServer();
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

export function withComments() {
  let oldEnv: testUtils.EnvironmentSnapshot;
  before(async () => {
    if (process.env.COMMENTS !== 'true') {
      oldEnv = new testUtils.EnvironmentSnapshot();
      process.env.COMMENTS = 'true';
      await server.restart();
    }
  });
  after(async () => {
    if (oldEnv) {
      oldEnv.restore();
      await server.restart();
    }
  });
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

} // end of namespace gristUtils

stackWrapOwnMethods(gristUtils);
export = gristUtils;
