import * as _ from 'lodash';
import { assert, driver, Key, stackWrapFunc, WebElement,
         WebElementPromise } from 'mocha-webdriver';
import { driverCompanion, findOldTimey, waitImpl,
         webdriverjqWrapper } from 'test/nbrowser/webdriverjq-nbrowser';
import * as guBase from 'test/nbrowser/gristUtils';
import { setupTestSuite } from 'test/nbrowser/testUtils';
import { server } from 'test/nbrowser/testServer';

// Simulate the old "$" object.

const _webdriverjqFactory = webdriverjqWrapper(driver);
function $(key) {
  if (typeof key !== 'string') {
    return key;
  }
  return _webdriverjqFactory(key);
}

// The "$" object needs some setup done asynchronously.
// We do that later, during test initialization.
async function applyPatchesToJquerylikeObject($) {
  $.MOD = await guBase.modKey();
  $.SELECT_ALL = await guBase.selectAllKey();
  $.getPage = async (url) => {
    return driver.get(url);
  };
  $.wait = (timeoutMs, conditionFunc) => {
    return waitImpl(timeoutMs, conditionFunc);
  }
  for (const key of Object.keys(Key)) {
    $[key] = Key[key];
  }
  // We need to tweak driver object a bit too (really?)
  driverCompanion.$ = $;
  // driver.testHost = server.getHost();
  // driver.waitImpl = waitImpl;
}

// Adapt common old setup.
const test = {
  setupTestSuite(self, ...args) {
    self.timeout(40000);
    return setupTestSuite(...args);
  },
};

// Add some methods to the grist utils that are used by old tests.
// This could be cleaned up further, but translating to newer ways
// of doing things or, if the method is really useful, adding the
// method to the new grist utils.

const waitForServer = guBase.waitForServer;
let patchesApplied = false;
let session;

const gu = {
  ...guBase,

  // Apply all needed patches, async initialization, and log in.
  async supportOldTimeyTestCode() {
    if (!patchesApplied) {
      applyPatchesToWebElements();
      applyPatchesToAssert();
      applyPatchesToJquerylikeObject($);
    }
    patchesApplied = true;
    // Login as someone so old code doesn't have to be upgraded to do it.
    session = await gu.session().user('userz');
    const dbManager = await server.getDatabase();
    const profile = {email: session.email, name: session.name};
    await dbManager.getUserByLogin(session.email, {profile});
    await gu.setApiKey(session.name);
    await session.login();
  },

  // getCell with old-timey arguments.
  getCellRC(r, c) {
    return gu.getCell(c, r + 1);
  },

  // clickCell with old-timey arguments.
  async clickCellRC(r, c) {
    const cell = gu.getCell(c, r + 1);
    await cell.click();
    return cell;
  },

  // sendKeys variant that accepts arrays in place of Key.chord.
  sendKeys(...args) {
    return guBase.sendKeys(...args.map(
      a => Array.isArray(a) ? Key.chord(...a) : a
    ));
  },

  /**
   * When doing type conversion in the side pane, this clicks the 'Apply' button and waits for the
   * conversion to complete.
   */
  async applyTypeConversion() {
    await $('.test-type-transform-apply').wait().scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    }).click();
    await $('.test-type-transform-apply').waitDrop(assert.isPresent, false);
    return gu.waitForServer();
  },

  async clickColumnMenuItem(colName, itemText, optRightClick) {
    await gu.openColumnMenu(colName);
    return gu.actions.selectFloatingOption(itemText);
  },

  getOpenEditingLabel(parentElem) {
    return driver.find('.test-column-title-label');
  },

  enterGridValues(startRowIndex, startColIndex, dataMatrix) {
    const transpose = dataMatrix[0].map(
      (_, colIndex) => dataMatrix.map(row => row[colIndex])
    );
    return gu.enterGridRows({col: startColIndex,
                             rowNum: startRowIndex + 1}, transpose);
  },

  async openSidePane(tabName) {
    if (['log', 'validate', 'repl', 'code'].includes(tabName)) {
      await guBase.toggleSidePanel('right', 'open');
      return $(`.test-tools-${tabName}`).wait().click();
    } else if (tabName === 'field') {
      await guBase.toggleSidePanel('right', 'open');
      return $('.test-right-tab-field').click();
    } else if (tabName === 'view') {
      await guBase.toggleSidePanel('right', 'open');
      return $('.test-right-tab-pagewidget').wait().click();
    }
  },

  getGridValues(...options) {
    return gu.getVisibleGridCells(...options);
  },

  /**
   * Returns the text in the row header of the last row in a Grid section, scrolling to the
   * bottom, but not moving the cursor.
   * @param {String} options.section: Optional section name to use instead of the active section.
   */
  async getGridLastRowText(options) {
    if (options?.section) {
      await gu.actions.viewSection(options.section).selectSection();
    }
    return String(await gu.getGridRowCount());
  },

  getAddRowNumber() {
    return gu.getGridRowCount();
  },

  async getGridLabels(sectionName) {
    return gu.getSection(sectionName).findAll('[data-test-id="GridView_columnLabel"] .kf_elabel_text',
                                              label => label.getText());
  },

  /**
   * Given a cell in grist GridView, returns whether it contains the cursor. You may use it as
   * hasCursor(getCell(...)) or getCell(...).waitFor(hasCursor, optTimeout).
   */
  hasCursor(cellElem) {
    return cellElem.find('.selected_cursor').isDisplayed();
  },

  async useFixtureDoc(cleanup, fname, flag) {
    return session.tempDoc(cleanup, fname);
  },

  async copyDoc(docId, flag) {
    const result = await guBase.copyDoc(session.name, 'docs', 'Home', docId);
    await session.loadDoc(`/doc/${result.id}`);
    return result;
  },

  async clickCell(rowIndexOrPosOrCell, colIndex) {
    if (typeof rowIndexOrPosOrCell === 'object' && 'driver_' in rowIndexOrPosOrCell) {
      return rowIndexOrPosOrCell.click();
    }
    // Best just to force a rewrite of clickCell, e.g. to clickCellRC,
    // since newer gristUtils interprets arguments entirely differently.
    if (typeof rowIndexOrPosOrCell === 'number') {
      throw new Error("ambiguous row/col");
    }
    const cell = guBase.getCell(rowIndexOrPosOrCell, colIndex);
    await cell.click();
  },

  /**
   * Sets the visibleCol of the currently selected field to value.
   */
  async setVisibleCol(value) {
    await gu.openSidePane('field');
    await $('.test-fbuilder-ref-col-select').click();
    await $(`.test-select-menu .test-select-row:contains(${value})`).wait().click();
    return waitForServer();
  },

  /**
   * Asserts the type of the currently selected field.
   */
  async assertType(value) {
    await gu.openSidePane('field');
    assert.equal(await $('.test-fbuilder-type-select .test-select-row').getText(), value);
  },

  closeSidePane() {
    return gu.toggleSidePanel('right', 'close');
  },

  clickVisibleDetailCells(column, rowNums, section) {
    return gu.getDetailCell(column, rowNums[0], section).click();
  },

  async clickRowMenuItem(rowNum, item) {
    await (await gu.openRowMenu(rowNum)).findContent('li', item).click();
  },

  /**
   * Selects rows starting from rowStart and ending at rowEnd (1-based) by clicking and dragging or
   * shift clicking (Defaults to dragging)
   * @param {int} rowStart: 1-based row number
   * @param {int} rowEnd: 1-based row number.
   * @param {String} optMethod: if 'shift' then shift clicking is used to select rows otherwise it
   * defaults to drag to select.
   */
  async selectRows(rowStart, rowEnd, optMethod) {
    let start = await driver.findContent('.active_section .gridview_data_row_num', gu.exactMatch(rowStart.toString()));
    let end = await driver.findContent('.active_section .gridview_data_row_num', gu.exactMatch(rowEnd.toString()));
    if (optMethod === 'shift') {
      await driver.withActions(a => a.click(start).keyDown($.SHIFT).click(end).keyUp($.SHIFT));
    } else {
      await driver.withActions(a => a.move({origin: start}).press().move({origin: end}).release());
    }
  },

  async _fieldSettingsClickOption(isCommonToSeparate, optionSubstring) {
    assert.include(await $('.fieldbuilder_settings_button').text(), isCommonToSeparate ? 'Common' : 'Separate');
    await $('.fieldbuilder_settings_button').click();
    await gu.actions.selectFloatingOption(optionSubstring);
    await waitForServer();
    assert.include(await $('.fieldbuilder_settings_button').text(), isCommonToSeparate ? 'Separate' : 'Common');
  },
  fieldSettingsUseSeparate: () => gu._fieldSettingsClickOption(true, 'Use separate'),
  fieldSettingsSaveAsCommon: () => gu._fieldSettingsClickOption(false, 'Save as common'),
  fieldSettingsRevertToCommon: () => gu._fieldSettingsClickOption(false, 'Revert to common'),

  /**
   * Changes date format for date and datetime editor or returns current format
   * @param {string} value Date format
   */
  async dateFormat(value) {
    if (!value) {
      return $('$Widget_dateFormat .test-select-row').text();
    }
    await $('$Widget_dateFormat').wait().click();
    await $(`.test-select-menu .test-select-row:contains(${value})`).wait().click();
  },

  /**
   * Changes time format for datetime editor or returns current format
   * @param {string} value Time format
   */
  async timeFormat(value) {
    if (!value) {
      return $('$Widget_timeFormat .test-select-row').getText();
    }
    await $('$Widget_timeFormat').wait().click();
    await $(`.test-select-menu .test-select-row:contains(${value})`).wait().click();
  },

  async getDetailValues(...options) {
    return gu.getVisibleDetailCells(...options);
  },

  /**
  * Selects all cells in a GridView between and including startCell and endCell
  * @param {Array} startCell:
  *                         startCell[0]: 1-based row index.
  *                         startCell[1]: 0-based column index.
  * @param {Array} endCell:
  *                         endCell[0]: 1-based row index.
  *                         endCell[1]: 0-based column index.
  **/
  async selectGridArea(startCell, endCell) {
    const [startRowNum, startCol] = startCell;
    const [endRowNum, endCol] = endCell;
    if (startRowNum === endRowNum && startCol === endCol) {
      await gu.getCell({rowNum: endRowNum, col: endCol}).click();
    } else {
      const start = await gu.getCell({rowNum: startRowNum, col: startCol});
      const end = await gu.getCell({rowNum: endRowNum, col: endCol});
      await driver.withActions(a => a.click(start).keyDown($.SHIFT).click(end).keyUp($.SHIFT));
    }
  },

  /**
   * Returns text of the cells for the given rows and columns of a viewSection.
   * @param {String} option.section: Optional section name instead of active.
   * @param {Array<Number>} option.rowNums: Array of row numbers (1-based)
   * @param {Array<Number>} option.cols: Array of column indices (0-based) or labels.
   * @param [Number: Function] option.cellFunc: a function that returns cells given an array of
   *      columns, rows and optionally a viewsection (defaults to the currently active section)
   * @param [Number: Function] option.valueFunc: Optional function, or an object mapping column
   *      index or label (as in options.cols) to function, with the function mapping a cell to
   *      its value (by default, cell => cell.text()).
   * @returns {Promise<Array>} Returns array of values for each requested cell, as all values from
   *      the first row, followed by values from the second, etc.
   */
  async getSectionValues(options) {
    var opts = { section: options.section };
    var defaultValueFunc = (cell => cell.text());
    var valueFunc;
    if (options.valueFunc && !_.isFunction(options.valueFunc)) {
      valueFunc = (col => options.valueFunc[col] || defaultValueFunc);
    } else {
      valueFunc = _.constant(options.valueFunc || defaultValueFunc);
    }
    const colValues = [];
    for (const col of options.cols) {
      const colValue = await valueFunc(col)(options.cellFunc(col, options.rowNums, opts).array());
      colValues.push(colValue);
    }
    return _.flatten(_.zip.apply(_, colValues), true);
  },

  /**
   * Asserts the widget of the currently selected field.
   */
  async assertWidget(value) {
    await gu.openSidePane('field');
    assert.equal(await $('.test-fbuilder-widget-select .test-select-row').getText(), value);
  },

  /**
   * Sets the widget of the currently selected field to value.
   */
  async setWidget(value) {
    await gu.openSidePane('field');
    const selector = $('.test-fbuilder-widget-select');
    const btnChildren = await selector.elem().findAll('.test-select-button');
    if (btnChildren.length > 0) {
      // This is a button select.
      await selector.findOldTimey(`.test-select-button:contains(${value})`).click();
    } else {
      // This is a dropdown select.
      await selector.click();
      await $(`.test-select-menu .test-select-row:contains(${value})`).click();
    }
    await gu.waitForServer();
  },

  /**
   * Adds a new record to the grid. Takes an array of values that matches column positions.
   */
  async addRecord(values) {
    await gu.sendKeys([$.MOD, $.UP]);
    await gu.sendKeys([$.MOD, $.DOWN]);
    await gu.sendKeys([$.LEFT]);
    await gu.sendKeys([$.LEFT]);
    await gu.sendKeys([$.LEFT]);
    await gu.sendKeys([$.LEFT]);
    await gu.sendKeys([$.LEFT]);
    await driver.sleep(1000);
    // For each value, type it, followed by Tab.
    for (const [i, value] of values.entries()) {
      await gu.waitAppFocus(true);
      await gu.sendKeys(value, $.TAB);
      await gu.waitForServer();
      if (i === 0) {
        // The very first value triggers add-record, but the creation of the new row isn't
        // immediate, so give it a moment.
        await driver.sleep(250);
      }
    }
    // Return a promise that can be awaited; it will wait for all the previously queued ones.
    return driver.sleep(0);
  },

  actions: {
    createNewDoc: async (optDocName) => {
      await gu.simulateLogin("Chimpy", "chimpy@getgrist.com", "nasa");
      const docId = await gu.createNewDoc('chimpy', 'nasa', 'Horizon', optDocName || 'Untitled');
      await gu.loadDoc(`/o/nasa/doc/${docId}`);
    },
    getDocTitle: () => {
      return $('.test-bc-doc').val();
    },
    getActiveTab: () => {
      return $('.test-treeview-itemHeader.selected .test-docpage-label').wait();
    },
    getTabs: () => {
      return $('.test-docpage-label');
    },
    renameDoc: (newName) => {
      $('.test-bc-doc').click();
      $.driver.sendKeys(newName, $.ENTER);
      return $.wait(1000, () => $.driver.getTitle().startsWith(newName + ' - '));
    },
    selectTabView: async (viewTitle) => {
      const isOpen = await gu.isSidePanelOpen('left');
      if (!isOpen) {
        await gu.toggleSidePanel('left', 'open');
      }
      await gu.openPage(viewTitle);
      if (!isOpen) {
        await gu.toggleSidePanel('left', 'close');
      }
    },
    addNewTable: async () => {
      await $('.test-dp-add-new').wait().click();
      await $('.test-dp-empty-table').click();
      // if we selected a new table, there will be a popup for a name
      const prompts = await $(".test-modal-prompt");
      const prompt = prompts[0];
      if (prompt) {
        await await $(".test-modal-confirm").click();
      }
      return gu.waitForServer();
    },
    addNewSection: (tableId, sectionType) => {
      return gu.addNewSection(sectionType, tableId);
    },
    addNewSummarySection: async (tableId, groupByArr, sectionType, sectionName) => {
      await gu.addNewSection(sectionType, tableId, {summarize: groupByArr});
      await gu.waitForServer();
      await gu.renameActiveSection(sectionName);
      await gu.waitForServer();
    },
    addNewView: (tableId, sectionType) => {
      return gu.addNewPage(sectionType, tableId);
    },
    selectFloatingOption: async (optionName) => {
      // Sometimes the element is there but "not interactable". Work around that.
      await gu.waitToPass(async () => {
        await $(`.grist-floating-menu li:contains(${optionName})`).click();
      });
    },
    /**
     * Actions related to view section. To use, pass in the section name.
     * @param {string} sectionName - Title of the view section
     * @return Object<string, function>} Collection of methods for the view section.
     *
     * @example
     * gu.actions.viewSection('Table1 record').selectMenuOption('Insert section');
     */
    viewSection: (sectionName) => {
      let section = gu.getSection(sectionName);
      return {
        /**
         * Clicks inside to make the current section active.
         */
        selectSection: function () {
          return gu.selectSectionByTitle(sectionName);
        },
        /**
         * Opens the view section drop-down menu.
         * @param {string} which - Which menu to open, coud be: 'sortAndFilter' or 'viewLayout'
         */
        openMenu: async function (which) {
          await driver.withActions(a => a.move({origin: section.find('.viewsection_title')})); // to display menu buttons on hover
          const item = section.find(`.test-section-menu-${which}`);
          await gu.waitToPass(() => item.click());
        },
        /**
         * Opens the section drop-down menu and select option matching param.
         * @param {string} which - Which menu to open, coud be: 'sortAndFilter' or 'viewLayout'
         * @param {string} optionName
         */
        selectMenuOption: function (which, optionName) {
          this.openMenu(which);
          return gu.actions.selectFloatingOption(optionName);
        }
      };
    },
    tableView: (tableName, viewName) => {
      return {
        select: () => {
          return gu.getPageItem(tableName).click();
        },
        selectOption: async optionName => {
          await gu.openPageMenu(tableName);
          return gu.actions.selectFloatingOption(optionName);
        }
      };
    }
  }
};

/**
 * This monkey-patches the WebElement class to make it look enough like
 * jquery that a lot of old test code can be used without modification.
 */
function applyPatchesToWebElements() {

  WebElement.prototype.wait = function(fn, ...args) {
    if (fn) {
      return gu.waitToPass(async () => {
        return fn.apply(null, [this, ...args]);
      }).then(() => true);
    } else {
      return new WebElementPromise(
        driver,
        gu.waitToPass(async () => {
          if (!(await this.isPresent())) {
            throw new Error('not present');
          }
        }).then(() => this));
    }
  }

  WebElement.prototype.selected = function(val) {
    return driver.executeScript((elem, val) => {
      elem.selected = val;
    }, this, val);
  }

  WebElement.prototype.attr = function(key, val) {
    if (val !== undefined) {
      return driver.executeScript((elem, key, val) => {
        elem.setAttribute(key, val);
      }, this, key, val);
    }
    return this.getAttribute(key);
  }

  WebElement.prototype.classList = async function() {
    return (await this.getAttribute('className')).split(' ');
  }

  // Lists of WebElements work differently - if we did a find() we
  // already have just the first match.
  WebElement.prototype.first = function() {
    return this;
  }

  WebElement.prototype.text = function() {
    return this.getText();
  }

  WebElement.prototype.val = function(newVal) {
    if (newVal === undefined) {
      return this.getAttribute('value');
    }
    return gu.setValue(this, newVal);
  }

  WebElement.prototype.css = function(key, val) {
    if (val === undefined) {
      return this.getCssValue(key);
    }
    return new WebElementPromise(
      driver,
      driver.executeScript(elem => {
        elem.style[key] = val;
      }, this)
    );
  }

  WebElement.prototype.is = function(selector) {
    return this.matches(selector);
  }

  WebElement.prototype.hasClass = async function(className) {
    return (await this.classList()).includes(className);
  }

  WebElement.prototype.scrollIntoView = function(opts) {
    opts = opts || {behavior: 'auto'};
    return new WebElementPromise(
      driver,
      driver.executeScript((elem, opts) => elem.scrollIntoView(opts),
                           this, opts).then(() => this));
  }

  WebElement.prototype.parent = function() {
    return new WebElementPromise(
      driver,
      driver.executeScript(elem => {
        return elem.parentNode.closest('*');
      }, this)
    );
  }

  WebElement.prototype.closest = function(key) {
    return this.findClosest(key);
  }

  WebElement.prototype.children = async function(mapper) {
    // Collect children.
    let result = await driver.executeScript(elem => {
      return [...elem.children].map(c => c.closest('*'));
    }, this);
    // Fix up type.
    result = result.map(v => new WebElementPromise(
      driver,
      Promise.resolve(v),
    ));
    // Apply mapper if available.
    if (mapper) {
      result = result.map(mapper);
    }
    // Result is a single promise.
    return Promise.all(result);
  }

  WebElement.prototype.trimmedText = async function() {
    const text = await this.getText();
    return text.trim();
  }

  // A version of find() that supports some old timey syntax.
  WebElement.prototype.findOldTimey = function(key) {
    return findOldTimey(this, key);
  }

  WebElement.prototype.findAllOldTimey = function(key, mapper) {
    return findOldTimey(this, key, true, mapper);
  }
}

/**
 * This monkey-patches assert to add some methods that are very
 * commonly used.
 */
function applyPatchesToAssert() {

  assert.hasClass = stackWrapFunc(async function(elem, className, present) {
    if (present === undefined) {
      present = true;
    }
    const c = await elem.getAttribute('class');
    if (present) {
      await assert.include(c.split(' '), className);
    } else {
      await assert.notInclude(c.split(' '), className);
    }
  });

  assert.isPresent = stackWrapFunc(async function(elem, present) {
    if (present === undefined) {
      present = true;
    }
    let current = false;
    try {
      current = await elem.isPresent();
    } catch (e) {
      // $ object may fail if elem is non-existent.
    }
    await assert.equal(current, present);
    return true;
  });

  assert.isDisplayed = stackWrapFunc(async function(elem, displayed) {
    if (displayed === undefined) {
      displayed = true;
    }
    await assert.equal(await elem.isDisplayed(), displayed);
    return true;
  });
}

exports.$ = $;
exports.gu = gu;
exports.server = server;
exports.test = test;
