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
import { TestState } from 'app/common/TestState';
import { Organization as APIOrganization, DocStateComparison, UserAPIImpl, Workspace } from 'app/common/UserAPI';
import { Organization } from 'app/gen-server/entity/Organization';
import { Product } from 'app/gen-server/entity/Product';
import { create } from 'app/server/lib/create';

import { HomeUtil } from 'test/nbrowser/homeUtil';
import { server } from 'test/nbrowser/testServer';
import { Cleanup } from 'test/nbrowser/testUtils';
import * as testUtils from 'test/server/testUtils';

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
export const checkLoginPage = homeUtil.checkLoginPage.bind(homeUtil);

export const fixturesRoot: string = testUtils.fixturesRoot;

// it is sometimes useful in debugging to turn off automatic cleanup of docs and workspaces.
const noCleanup = Boolean(process.env.NO_CLEANUP);

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
 * Helper to scroll an element into view.
 */
export function scrollIntoView(elem: WebElement): Promise<void> {
  return driver.executeScript((el: any) => el.scrollIntoView(), elem);
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
 * the given RegExp content.
 */
export function getSection(sectionOrTitle: string|WebElement): WebElement|WebElementPromise {
  if (typeof sectionOrTitle !== 'string') { return sectionOrTitle; }
  return driver.find(`.test-viewsection-title[value="${sectionOrTitle}" i]`)
    .findClosest('.viewsection_content');
}

/**
 * Click into a section without disrupting cursor positions.
 */
export async function selectSectionByTitle(title: string) {
  await driver.find(`.test-viewsection-title[value="${title}" i]`)
    .findClosest('.viewsection_titletext_container').click();
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
 * Get the numeric value from the row header of the first selected row. This would correspond to
 * the row with the cursor when a single rows is selected.
 */
export async function getSelectedRowNum(): Promise<number> {
  const rowNum = await driver.find('.active_section .gridview_data_row_num.selected').getText();
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
  const labels = await section.findAll(".g_record_detail_label", el => el.getText());
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

/**
 * Returns {rowNum, col} object representing the position of the cursor in the active view
 * section. RowNum is a 1-based number as in the row headers, and col is a 0-based index for
 * grid view or field name for detail view.
 */
export async function getCursorPosition() {
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
export async function checkFormulaEditor(valueRe: RegExp) {
  assert.equal(await driver.findWait('.test-formula-editor', 500).isDisplayed(), true);
  assert.match(await driver.find('.code_editor_container').getText(), valueRe);
}

/**
 * Check that plain text editor is shown and its value matches the given regexp.
 */
export async function checkTextEditor(valueRe: RegExp) {
  assert.equal(await driver.findWait('.test-widget-text-editor', 500).isDisplayed(), true);
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
export async function updateOrgPlan(orgName: string, productName: string = 'professional') {
  const dbManager = await server.getDatabase();
  const db = dbManager.connection.manager;
  const dbOrg = await db.findOne(Organization, {where: {name: orgName},
    relations: ['billingAccount', 'billingAccount.product']});
  if (!dbOrg) { throw new Error(`cannot find org ${orgName}`); }
  const product = await db.findOne(Product, {name: productName});
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
 * argumet is false, then stops the collection.
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
    if (!Array.isArray(err.actual)) {
      throw new Error('userActionsVerify: no user actions, run userActionsCollect() first');
    }
    err.actual = err.actual.map((a: any) => JSON.stringify(a) + ",").join("\n");
    err.expected = err.expected.map((a: any) => JSON.stringify(a) + ",").join("\n");
    assert.deepEqual(err.actual, err.expected);
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


/**
 * Waits for all pending comm requests from the client to the doc worker to complete. This taps into
 * Grist's communication object in the browser to get the count of pending requests.
 *
 * Simply call this after some request has been made, and when it resolves, you know that request
 * has been processed.
 * @param optTimeout: Timeout in ms, defaults to 2000.
 */
 // TODO: waits also for api requests (both to home server or doc worker) to be resolved (maybe
 // requires to track requests in app/common/UserAPI)
export async function waitForServer(optTimeout: number = 2000) {
  await driver.wait(() => driver.executeScript(
    "return !window.gristApp.comm.hasActiveRequests() && window.gristApp.testNumPendingApiRequests() === 0",
    optTimeout,
    "Timed out waiting for server requests to complete"
  ));
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

/**
 * Adds a new empty table using the 'Add New' menu.
 */
export async function addNewTable() {
  await driver.findWait('.test-dp-add-new', 2000).click();
  await driver.find('.test-dp-empty-table').click();
  await waitForServer();
}

export interface PageWidgetPickerOptions {
  summarize?: RegExp[];   // Optional list of patterns to match Group By columns.
  selectBy?: RegExp;      // Optional pattern of SELECT BY option to pick.
}

// Add a new page using the 'Add New' menu and wait for the new page to be shown.
export async function addNewPage(typeRe: RegExp, tableRe: RegExp, options?: PageWidgetPickerOptions) {
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
export async function addNewSection(typeRe: RegExp, tableRe: RegExp, options?: PageWidgetPickerOptions) {
  // Click the 'Add widget to page' entry in the 'Add New' menu
  await driver.findWait('.test-dp-add-new', 2000).doClick();
  await driver.findWait('.test-dp-add-widget-to-page', 500).doClick();

  // add widget
  await selectWidget(typeRe, tableRe, options);
}

// Select type and table that matches respectivelly typeRe and tableRe and save. The widget picker
// must be already opened when calling this function.
export async function selectWidget(typeRe: RegExp, tableRe: RegExp, options: PageWidgetPickerOptions = {}) {

  const tableEl = driver.findContent('.test-wselect-table', tableRe);

  // unselect all selected columns
  for (const col of (await driver.findAll('.test-wselect-column[class*=-selected]'))) {
    await col.click();
  }

  // let's select table
  await tableEl.click();


  if (options.summarize) {
    // if summarize is requested, let's select the corresponding pivot icon
    await tableEl.find('.test-wselect-pivot').click();

    // and all the columns
    for (const colRef of options.summarize) {
      await driver.findContent('.test-wselect-column', colRef).click();
    }
  }

  if (options.selectBy) {
    // select link
    await driver.find('.test-wselect-selectby').doClick();
    await driver.findContent('.test-wselect-selectby option', options.selectBy).doClick();
  }

  // let's select right type and save
  await driver.findContent('.test-wselect-type', typeRe).doClick();
  await driver.find('.test-wselect-addBtn').doClick();
  await waitForServer();
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
 * Rename a table. TODO at the moment it's done by renaming the "primary" page for this table.
 * Once "raw data views" are supported, they will be used to rename tables.
 */
export async function renameTable(oldName: RegExp|string, newName: string) {
  return renamePage(oldName, newName);
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
 * Click the Undo button and wait for server. If optCount is given, click Undo that many times.
 */
export async function undo(optCount: number = 1, optTimeout?: number) {
  for (let i = 0; i < optCount; ++i) {
    await driver.find('.test-undo').doClick();
  }
  await waitForServer(optTimeout);
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
 * Toggles (opens or closes) the right panel and wait for the transition to complete. An optional
 * argument can specify the desired state.
 */
export async function toggleSidePanel(which: 'right'|'left', goal: 'open'|'close'|'toggle' = 'toggle') {
  if ((goal === 'open' && await isSidePanelOpen(which)) ||
      (goal === 'close' && !await isSidePanelOpen(which))) {
    return;
  }

  // 0.4 is the duration of the transition setup in app/client/ui/PagePanels.ts for opening the
  // side panes
  const transitionDuration = 0.4;

  // let's add an extra delay of 0.1 for even more robustness
  const delta = 0.1;

  // Adds '-ns' when narrow screen
  const suffix = (await getWindowDimensions()).width < 768 ? '-ns' : '';

  // click the opener and wait for the duration of the transition
  await driver.find(`.test-${which}-opener${suffix}`).doClick();
  await driver.sleep((transitionDuration + delta) * 1000);
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

/**
 * Sets the type of the currently selected field to value.
 */
export async function setType(type: RegExp, options: {skipWait?: boolean} = {}) {
  await toggleSidePanel('right', 'open');
  await driver.find('.test-right-tab-field').click();
  await driver.find('.test-fbuilder-type-select').click();
  await driver.findContent('.test-select-menu .test-select-row', type).click();
  if (!options.skipWait) { await waitForServer(); }
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
 * Open ⋮ dropdown menu for named workspace.
 */
export async function openWsDropdown(wsName: string): Promise<void> {
  const wsTab = await driver.findContentWait('.test-dm-workspace', wsName, 3000);
  await wsTab.mouseMove();
  await wsTab.find('.test-dm-workspace-options').mouseMove().click();
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

export async function saveAcls(): Promise<void> {
  await driver.findWait('.test-um-confirm', 3000).click();
  await driver.wait(async () => !(await driver.find('.test-um-members').isPresent()), 3000);
}

/**
 * Opens the row menu for the row with the given row number (1-based, as in row headers).
 */
export function openRowMenu(rowNum: number) {
  const row = driver.findContent('.active_section .gridview_data_row_num', String(rowNum));
  return driver.withActions((actions) => actions.contextClick(row))
    .then(() => driver.findWait('.grist-floating-menu', 1000));
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
 * Helper to get the urlId of the current document. Resolves to undefined if called while not
 * on a document page.
 */
export async function getCurrentUrlId() {
  return decodeUrl({}, new URL(await driver.getCurrentUrl())).doc;
}

export async function getActiveSectionTitle() {
  return driver.find('.active_section .test-viewsection-title').value();
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
    await server.simulateLogin("Support", "support@getgrist.com", "docs");
    api = createHomeApi('Support', 'docs');
    wss = await api.getOrgWorkspaces('current');
    await api.updateWorkspacePermissions(wss[0].id, {users: {
      'everyone@getgrist.com': 'viewers',
      'anon@getgrist.com': 'viewers',
    }});
    await server.removeLogin();
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
  public async loadDocMenu(relPath: string, wait: boolean = true) {
    await this.loadRelPath(relPath);
    if (wait) { await waitForDocMenuToLoad(); }
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

  public async tempNewDoc(cleanup: Cleanup, docName: string, {load} = {load: true}) {
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

//  Set the value of an `<input type="color">` element to `color` and trigger the `change`
//  event. Accepts `color` to be of following forms `rgb(120, 10, 3)` or '#780a03'.
export async function setColor(colorInputEl: WebElement, color: string) {
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
export async function addColumn(name: string) {
  await scrollIntoView(await driver.find('.active_section .mod-add-column'));
  await driver.find('.active_section .mod-add-column').click();
  await waitForServer();
  await waitAppFocus(false);
  await driver.sendKeys(name);
  await driver.sendKeys(Key.ENTER);
  await waitForServer();
}

// Select a range of columns, clicking on col1 and dragging to col2.
export async function selectColumnRange(col1: string, col2: string) {
  await getColumnHeader({col: col1}).mouseMove();
  await driver.mouseDown();
  await getColumnHeader({col: col2}).mouseMove();
  await driver.mouseUp();
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

/**
 * Adds samples to the Examples & Templates page.
 */
async function addSamples() {
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

async function openAccountMenu() {
  await driver.findWait('.test-dm-account', 1000).click();
  // Since the AccountWidget loads orgs and the user data asynchronously, the menu
  // can expand itself causing the click to land on a wrong button.
  await waitForServer();
  await driver.findWait('.test-usermenu-org', 1000);
  await driver.sleep(250);  // There's still some jitter (scroll-bar? other user accounts?)
}

export async function openUserProfile() {
  await openAccountMenu();
  await driver.findContent('.grist-floating-menu li', 'Profile Settings').click();
  await driver.findWait('.test-login-method', 5000);
}

export async function openDocumentSettings() {
  await openAccountMenu();
  await driver.findContent('.grist-floating-menu li', 'Document Settings').click();
  await driver.findWait('.test-modal-title', 5000);
}

} // end of namespace gristUtils

stackWrapOwnMethods(gristUtils);
export = gristUtils;
