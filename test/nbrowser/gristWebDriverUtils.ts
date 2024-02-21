/**
 * Utilities that simplify writing browser tests against Grist, which
 * have only mocha-webdriver as a code dependency. Separated out to
 * make easier to borrow for grist-widget repo.
 *
 * If you are seeing this code outside the grist-core repo, please don't
 * edit it, it is just a copy and local changes will prevent updating it
 * easily.
 */

import { WebDriver, WebElement } from 'mocha-webdriver';

type SectionTypes = 'Table'|'Card'|'Card List'|'Chart'|'Custom'|'Form';

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
    const driver = this.driver;
    if (options.dismissTips) { await this.dismissBehavioralPrompts(); }

    // select right type
    await driver.findContent('.test-wselect-type', typeRe).doClick();

    if (options.dismissTips) { await this.dismissBehavioralPrompts(); }

    if (tableRe) {
      const tableEl = driver.findContent('.test-wselect-table', tableRe);

      // unselect all selected columns
      for (const col of (await driver.findAll('.test-wselect-column[class*=-selected]'))) {
        await col.click();
      }

      // let's select table
      await tableEl.click();

      if (options.dismissTips) { await this.dismissBehavioralPrompts(); }

      const pivotEl = tableEl.find('.test-wselect-pivot');
      if (await pivotEl.isPresent()) {
        await this.toggleSelectable(pivotEl, Boolean(options.summarize));
      }

      if (options.summarize) {
        for (const columnEl of await driver.findAll('.test-wselect-column')) {
          const label = await columnEl.getText();
          // TODO: Matching cols with regexp calls for trouble and adds no value. I think function should be
          // rewritten using string matching only.
          const goal = Boolean(options.summarize.find(r => label.match(r)));
          await this.toggleSelectable(columnEl, goal);
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
      await this.driver.find('.test-behavioral-prompt-dismiss').click();
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
  public async acceptAlert() {
    await (await this.driver.switchTo().alert()).accept();
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
}
