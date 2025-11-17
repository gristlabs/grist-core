/**
 * Utilities that simplify writing browser tests against Grist, which
 * have only mocha-webdriver as a code dependency. Separated out to
 * make easier to borrow for grist-widget repo.
 *
 * If you are seeing this code outside the grist-core repo, please don't
 * edit it, it is just a copy and local changes will prevent updating it
 * easily.
 */

import escapeRegExp = require('lodash/escapeRegExp');
import { CommandName } from 'app/client/components/commandList';
import { DocAction, UserAction } from 'app/common/DocActions';
import { WebDriver, WebElement, WebElementPromise } from 'mocha-webdriver';

type SectionTypes = 'Table'|'Card'|'Card List'|'Chart'|'Custom'|'Form';

// it is sometimes useful in debugging to turn off automatic cleanup of docs and workspaces.
export const noCleanup = Boolean(process.env.NO_CLEANUP);

export class GristWebDriverUtils {
  public constructor(public driver: WebDriver) {
  }

  public isSidePanelOpen(which: 'right'|'left'): Promise<boolean> {
    return this.driver.find(`.test-${which}-panel`).matches('[class*=-open]');
  }

  /**
   * Waits for all pending comm requests from the client to the doc worker to complete. This taps into
   * Grist's communication object in the browser to get the count of pending requests.
   *
   * Simply call this after some request has been made, and when it resolves, you know that request
   * has been processed.
   * @param optTimeout: Timeout in ms, defaults to 5000.
   */
  public async waitForServer(optTimeout: number = 5000) {
    await this.driver.wait(() => this.driver.executeScript(
      "return window.gristApp && (!window.gristApp.comm || !window.gristApp.comm.hasActiveRequests())"
        + " && window.gristApp.testNumPendingApiRequests() === 0"
      )
      // The catch is in case executeScript() fails. This is rare but happens occasionally when
      // browser is busy (e.g. sorting) and doesn't respond quickly enough. The timeout selenium
      // allows for a response is short (and I see no place to configure it); by catching, we'll
      // let the call fail until our intended timeout expires.
      .catch((e) => { console.log("Ignoring executeScript error", String(e)); }),
      optTimeout,
      "Timed out waiting for server requests to complete"
    );
  }

  public async waitForSidePanel() {
    // 0.4 is the duration of the transition setup in app/client/ui/PagePanels.ts for opening the
  // side panes
    const transitionDuration = 0.4;

    // let's add an extra delay of 0.1 for even more robustness
    const delta = 0.1;
    await this.driver.sleep((transitionDuration + delta) * 1000);
  }

  /*
   * Toggles (opens or closes) the right or left panel and wait for the transition to complete. An optional
   * argument can specify the desired state.
   */
  public async toggleSidePanel(which: 'right'|'left', goal: 'open'|'close'|'toggle' = 'toggle') {
    if ((goal === 'open' && await this.isSidePanelOpen(which)) ||
      (goal === 'close' && !await this.isSidePanelOpen(which))) {
      return;
    }

    // Adds '-ns' when narrow screen
    const suffix = (await this.getWindowDimensions()).width < 768 ? '-ns' : '';

    // click the opener and wait for the duration of the transition
    await this.driver.find(`.test-${which}-opener${suffix}`).doClick();
    await this.waitForSidePanel();
  }

  /**
   * Gets browser window dimensions.
   */
  public async getWindowDimensions(): Promise<WindowDimensions> {
    const {width, height} = await this.driver.manage().window().getRect();
    return {width, height};
  }

  /**
   * Sets browser window dimensions.
   */
  public setWindowDimensions(width: number, height: number) {
    return this.driver.manage().window().setRect({ width, height });
  }

  // Add a new widget to the current page using the 'Add New' menu.
  public async addNewSection(
    typeRe: RegExp|SectionTypes, tableRe: RegExp|string, options?: PageWidgetPickerOptions
  ) {
    // Click the 'Add widget to page' entry in the 'Add New' menu
    await this.driver.findWait('.test-dp-add-new', 2000).doClick();
    await this.driver.findWait('.test-dp-add-widget-to-page', 500).doClick();

    // add widget
    await this.selectWidget(typeRe, tableRe, options);
  }

  // Select type and table that matches respectively typeRe and tableRe and save. The widget picker
  // must be already opened when calling this function.
  public async selectWidget(
    typeRe: RegExp|string,
    tableRe: RegExp|string = '',
    options: PageWidgetPickerOptions = {}
  ) {
    const {customWidget, dismissTips, dontAdd, selectBy, summarize, tableName} = options;
    const driver = this.driver;
    if (dismissTips) { await this.dismissBehavioralPrompts(); }

    // select right type
    await driver.findContentWait('.test-wselect-type', typeRe, 500).doClick();

    if (dismissTips) { await this.dismissBehavioralPrompts(); }

    if (tableRe) {
      const tableEl = driver.findContentWait('.test-wselect-table', tableRe, 100);

      // unselect all selected columns
      for (const col of (await driver.findAll('.test-wselect-column[class*=-selected]'))) {
        await col.click();
      }

      // let's select table
      await tableEl.click();

      if (dismissTips) { await this.dismissBehavioralPrompts(); }

      const pivotEl = tableEl.find('.test-wselect-pivot');
      if (await pivotEl.isPresent()) {
        await this.toggleSelectable(pivotEl, Boolean(summarize));
      }

      if (summarize) {
        for (const columnEl of await driver.findAll('.test-wselect-column')) {
          const label = await columnEl.getText();
          // TODO: Matching cols with regexp calls for trouble and adds no value. I think function should be
          // rewritten using string matching only.
          const goal = Boolean(summarize.find(r => label.match(r)));
          await this.toggleSelectable(columnEl, goal);
        }
      }

      if (selectBy) {
        // select link
        await driver.findWait('.test-wselect-selectby', 100).doClick();
        await driver.findContentWait('.test-wselect-selectby option', selectBy, 100).doClick();
      }
    }


    if (dontAdd) { return; }

    // add the widget
    await driver.find('.test-wselect-addBtn').doClick();

    // if we selected a new table, there will be a popup for a name
    const prompts = await driver.findAll(".test-modal-prompt");
    const prompt = prompts[0];
    if (prompt) {
      if (tableName) {
        await prompt.doClear();
        await prompt.click();
        await driver.sendKeys(tableName);
      }
      await driver.find(".test-modal-confirm").click();
    }

    if (customWidget) {
      await this.waitForServer();
      await driver.findContent('.test-custom-widget-gallery-widget-name', customWidget).click();
      await driver.find('.test-custom-widget-gallery-save').click();
    }

    await this.waitForServer();
  }

  /**
   * Dismisses all behavioral prompts that are present.
   */
  public async dismissBehavioralPrompts() {
    let i = 0;
    const max = 10;

    // Keep dismissing prompts until there are no more, up to a maximum of 10 times.
    while (i < max && await this.driver.find('.test-behavioral-prompt').isPresent()) {
      try {
        await this.driver.findWait('.test-behavioral-prompt-dismiss', 100).click();
      } catch (e) {
        if (await this.driver.find('.test-behavioral-prompt').isPresent()) {
          throw e;
        }
        break;
      }
      await this.waitForServer();
      i += 1;
    }
  }

  /**
   * Toggle elem if not selected. Expects elem to be clickable and to have a class ending with
   * -selected when selected.
   */
  public async toggleSelectable(elem: WebElement, goal: boolean) {
    const isSelected = await elem.matches('[class*=-selected]');
    if (goal !== isSelected) {
      await elem.click();
    }
  }

  public async waitToPass(check: () => Promise<void>, timeMs: number = 4000) {
    try {
      let delay: number = 10;
      await this.driver.wait(async () => {
        try {
          await check();
        } catch (e) {
          // Throttle operations a little bit.
          await this.driver.sleep(delay);
          if (delay < 50) { delay += 10; }
          return false;
        }
        return true;
      }, timeMs);
    } catch (e) {
      await check();
    }
  }

  /**
   * Refresh browser and dismiss alert that is shown (for refreshing during edits).
   */
  public async refreshDismiss() {
    await this.driver.navigate().refresh();
    await this.acceptAlert();
    await this.waitForDocToLoad();
  }

  /**
   * Accepts an alert.
   */
  public async acceptAlert({ignore} = {ignore: false}) {
    try {
      await (await this.driver.switchTo().alert()).accept();
    } catch (e) {
      if (!ignore) {
        throw new Error(`Failed to accept alert: ${String(e)}`);
      }
      // If we are ignoring the alert, just log the error.
      console.warn(`Ignoring alert accept error: ${String(e)}`);
    }
  }

  /**
   * Returns whether an alert is shown.
   */
  public async isAlertShown() {
    try {
      await this.driver.switchTo().alert();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Wait for the doc to be loaded, to the point of finishing fetch for the data on the current
   * page. If you navigate from a doc page, use e.g. waitForUrl() before waitForDocToLoad() to
   * ensure you are checking the new page and not the old.
   */
  public async waitForDocToLoad(timeoutMs: number = 10000): Promise<void> {
    await this.driver.findWait('.viewsection_title', timeoutMs);
    await this.waitForServer();
  }

  public async reloadDoc() {
    await this.driver.navigate().refresh();
    await this.waitForDocToLoad();
  }

  /**
   * Sends UserActions using client api from the browser.
   */
  public async sendActions(actions: (DocAction | UserAction)[], optTimeout: number = 5000) {
    await this.driver.manage().setTimeouts({
      script: optTimeout, /* milliseconds */
    });

    // Make quick test that we have a list of actions not just a single action, by checking
    // if the first element is an array.
    if (actions.length && !Array.isArray(actions[0])) {
      throw new Error('actions argument should be a list of actions, not a single action');
    }

    const result = await this.driver.executeAsyncScript(`
    const done = arguments[arguments.length - 1];
    const prom = gristDocPageModel.gristDoc.get().docModel.docData.sendActions(${JSON.stringify(actions)});
    prom.then(() => done(null));
    prom.catch((err) => done(String(err?.message || err)));
  `);
    if (result) {
      throw new Error(result as string);
    }
    await this.waitForServer();
  }

  /**
   * Runs a Grist command in the browser window.
   */
  public async sendCommand(name: CommandName, argument: any = null) {
    await this.driver.executeAsyncScript((name: any, argument: any, done: any) => {
      const result = (window as any).gristApp.allCommands[name].run(argument);
      if (result?.finally) {
        result.finally(done);
      } else {
        done();
      }
    }, name, argument);
    await this.waitForServer();
  }

  public async openAccountMenu() {
    await this.driver.findWait('.test-dm-account', 2000).click();
    // Since the AccountWidget loads orgs and the user data asynchronously, the menu
    // can expand itself causing the click to land on a wrong button.
    await this.waitForServer();
    await this.driver.findWait('.test-site-switcher-org', 2000);
    await this.driver.sleep(250);  // There's still some jitter (scroll-bar? other user accounts?)
  }

  public async openProfileSettingsPage(): Promise<ProfileSettingsPage> {
    await this.openAccountMenu();
    await this.driver.find('.grist-floating-menu .test-dm-account-settings').click();
    //close alert if it is shown
    if (await this.isAlertShown()) {
      await this.acceptAlert();
    }
    await this.driver.findWait('.test-account-page-login-method', 5000);
    await this.waitForServer();
    return new ProfileSettingsPage(this);
  }

  /**
   * Click the Undo button and wait for server. If optCount is given, click Undo that many times.
   */
  public async undo(optCount: number = 1, optTimeout?: number) {
    await this.waitForServer(optTimeout);
    for (let i = 0; i < optCount; ++i) {
      await this.driver.find('.test-undo').doClick();
      await this.waitForServer(optTimeout);
    }
  }

  /**
   * Changes browser window dimensions for the duration of a test suite.
   */
  public resizeWindowForSuite(width: number, height: number) {
    let oldDimensions: WindowDimensions;
    before(async () => {
      oldDimensions = await this.getWindowDimensions();
      await this.setWindowDimensions(width, height);
    });
    after(async () => {
      await this.setWindowDimensions(oldDimensions.width, oldDimensions.height);
    });
  }

  /**
   * Changes browser window dimensions to FullHd for a test suite.
   */
  public bigScreen(size: 'big'|'medium' = 'medium') {
    // Note that the default (small) is 1024x640.
    if (size === 'medium') {
      this.resizeWindowForSuite(1440, 900);
    } else {
      this.resizeWindowForSuite(1920, 1080);
    }
  }

  /**
   * Shrinks browser window dimensions to trigger mobile mode for a test suite.
   */
  public narrowScreen() {
    this.resizeWindowForSuite(400, 750);
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
  public async getVisibleGridCells(col: number | string, rows: number[], section?: string): Promise<string[]>;
  public async getVisibleGridCells<T = string>(options: IColSelect<T> | IColsSelect<T>): Promise<T[]>;
  public async getVisibleGridCells<T>(
    colOrOptions: number | string | IColSelect<T> | IColsSelect<T>, _rowNums?: number[], _section?: string
  ): Promise<T[]> {

    if (typeof colOrOptions === 'object' && 'cols' in colOrOptions) {
      const { rowNums, section, mapper } = colOrOptions;    // tslint:disable-line:no-shadowed-variable
      const columns = await Promise.all(colOrOptions.cols.map((oneCol) =>
        this.getVisibleGridCells({ col: oneCol, rowNums, section, mapper })));
      // This zips column-wise data into a flat row-wise array of values.
      return ([] as T[]).concat(...rowNums.map((_r, i) => columns.map((c) => c[i])));
    }

    const { col, rowNums, section, mapper = el => el.getText() }: IColSelect<any> = (
      typeof colOrOptions === 'object' ? colOrOptions :
        { col: colOrOptions, rowNums: _rowNums!, section: _section }
    );

    if (rowNums.includes(0)) {
      // Row-numbers should be what the users sees: 0 is a mistake, so fail with a helpful message.
      throw new Error('rowNum must not be 0');
    }

    const sectionElem = section ? await this.getSection(section) : await this.driver.findWait('.active_section', 4000);
    const colIndex = (typeof col === 'number' ? col :
      await sectionElem.findContent('.column_name', this.exactMatch(col)).index());

    const visibleRowNums: number[] = await sectionElem.findAll('.gridview_data_row_num',
      async (el) => parseInt(await el.getText(), 10));

    const selector = `.gridview_data_scroll .record:not(.column_names) .field:nth-child(${colIndex + 1})`;
    const fields = mapper ? await sectionElem.findAll(selector, mapper) : await sectionElem.findAll(selector);
    return rowNums.map((n) => fields[visibleRowNums.indexOf(n)]);
  }

  /**
   * Returns a visible GridView cell. Options may be given as arguments directly, or as an object.
   * - col: column name, or 0-based column index
   * - rowNum: 1-based row numbers, as visible in the row headers on the left of the grid.
   * - section: optional name of the section to use; will use active section if omitted.
   */
  public getCell(col: number | string, rowNum: number, section?: string): WebElementPromise;
  public getCell(options: ICellSelect): WebElementPromise;
  public getCell(colOrOptions: number | string | ICellSelect, rowNum?: number, section?: string): WebElementPromise {
    const mapper = async (el: WebElement) => el;
    const options: IColSelect<WebElement> = (typeof colOrOptions === 'object' ?
      { col: colOrOptions.col, rowNums: [colOrOptions.rowNum], section: colOrOptions.section, mapper } :
      { col: colOrOptions, rowNums: [rowNum!], section, mapper });
    return new WebElementPromise(this.driver, this.getVisibleGridCells(options).then((elems) => elems[0]));
  }

  /**
   * Returns a WebElementPromise for the .viewsection_content element for the section which contains
   * the given text (case insensitive) content.
   */
  public getSection(sectionOrTitle: string | WebElement): WebElement | WebElementPromise {
    if (typeof sectionOrTitle !== 'string') { return sectionOrTitle; }
    return this.driver.findContent(`.test-viewsection-title`, new RegExp("^" + escapeRegExp(sectionOrTitle) + "$", 'i'))
      .findClosest('.viewsection_content');
  }

  /**
   * Helper for exact string matches using interfaces that expect a RegExp. E.g.
   *    driver.findContent('.selector', exactMatch("Foo"))
   *
   * TODO It would be nice if mocha-webdriver allowed exact string match in findContent() (it now
   * supports a substring match, but we still need a helper for an exact match).
   */
  public exactMatch(value: string, flags?: string): RegExp {
    return new RegExp(`^${escapeRegExp(value)}$`, flags);
  }

  /**
   * Click into a section without disrupting cursor positions.
   */
  public async selectSectionByTitle(title: string | RegExp) {
    try {
      if (typeof title === 'string') {
        title = new RegExp("^" + escapeRegExp(title) + "$", 'i');
      }
      // .test-viewsection is a special 1px width element added for tests only.
      await this.driver.findContent(`.test-viewsection-title`, title).find(".test-viewsection-blank").click();
    } catch (e) {
      // We might be in mobile view.
      await this.driver.findContent(`.test-viewsection-title`, title).findClosest(".view_leaf").click();
    }
  }

  /**
   * Click into a section without disrupting cursor positions.
   */
  public async selectSectionByIndex(index: number) {
    const sections = await this.driver.findAll('.test-viewsection-title');
    const section = sections.at(-1);
    if (section === undefined) {
      throw new Error(`No view section at index ${index}`);
    }
    try {
      // .test-viewsection is a special 1px width element added for tests only.
      await section.find(".test-viewsection-blank").click();
    } catch (e) {
      // We might be in mobile view.
      await section.findClosest(".view_leaf").click();
    }
  }
}

export interface WindowDimensions {
  width: number;
  height: number;
}

export interface PageWidgetPickerOptions {
  tableName?: string;
  /** Optional pattern of SELECT BY option to pick. */
  selectBy?: RegExp|string;
  /** Optional list of patterns to match Group By columns. */
  summarize?: (RegExp|string)[];
  /** If true, configure the widget selection without actually adding to the page. */
  dontAdd?: boolean;
  /** If true, dismiss any tooltips that are shown. */
  dismissTips?: boolean;
  /** Optional pattern of custom widget name to select in the gallery. */
  customWidget?: RegExp|string;
}

export class ProfileSettingsPage {
  private _driver: WebDriver;
  private _gu: GristWebDriverUtils;

  constructor(gu: GristWebDriverUtils) {
    this._gu = gu;
    this._driver = gu.driver;
  }

  public async setLanguage(language: string) {
    await this._driver.findWait('.test-account-page-language .test-select-open', 100).click();
    await this._driver.findContentWait('.test-select-menu li', language, 100).click();
    await this._gu.waitForServer();
  }
}

export interface IColsSelect<T = WebElement> {
  cols: Array<number|string>;
  rowNums: number[];
  section?: string|WebElement;
  mapper?: (e: WebElement) => Promise<T>;
}

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
