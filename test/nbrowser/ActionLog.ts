import {assert, driver, WebElement, WebElementPromise} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';


describe('ActionLog', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  afterEach(() => gu.checkForErrors());

  async function getActionUndoState(limit: number): Promise<string[]> {
    const state = await driver.findAll('.action_log .action_log_item', (el) => el.getAttribute('class'));
    return state.slice(0, limit).map((s) => s.replace(/action_log_item/, '').trim());
  }

  function getActionLogItems(): Promise<WebElement[]> {
    // Use a fancy negation of style selector to exclude hidden log entries.
    return driver.findAll(".action_log .action_log_item:not([style*='display: none'])");
  }

  function getActionLogItem(index: number): WebElementPromise {
    return new WebElementPromise(driver, getActionLogItems().then((elems) => elems[index]));
  }

  before(async function() {
    const session = await gu.session().user('user1').login();
    await session.tempDoc(cleanup, 'Hello.grist');
    await gu.dismissWelcomeTourIfNeeded();
  });

  after(async function() {
    // If were are debugging the browser won't be reloaded, so we need to close the right panel.
    if (process.env.NO_CLEANUP) {
      await driver.find(".test-right-tool-close").click();
    }
  });

  it("should cross out undone actions", async function() {
    // Open the action-log tab.
    await driver.findWait('.test-tools-log', 1000).click();
    await gu.waitToPass(() =>   // Click might not work while panel is sliding out to open.
      driver.findContentWait('.test-doc-history-tabs .test-select-button', 'Activity', 500).click());

    // Perform some actions and check that they all appear as default.
    await gu.enterGridRows({rowNum: 1, col: 0}, [['a'], ['b'], ['c'], ['d']]);

    assert.deepEqual(await getActionUndoState(4), ['default', 'default', 'default', 'default']);

    // Undo and check that the most recent action is crossed out.
    await gu.undo();
    assert.deepEqual(await getActionUndoState(4), ['undone', 'default', 'default', 'default']);

    await gu.undo(2);
    assert.deepEqual(await getActionUndoState(4), ['undone', 'undone', 'undone', 'default']);
    await gu.redo(2);
    assert.deepEqual(await getActionUndoState(4), ['undone', 'default', 'default', 'default']);
  });

  it("should indicate that actions that cannot be redone are buried", async function() {
    // Add an item after the undo actions and check that they get buried.
    await gu.getCell({rowNum: 1, col: 0}).click();
    await gu.enterCell('e');
    assert.deepEqual(await getActionUndoState(4), ['default', 'buried', 'default', 'default']);

    // Check that undos skip the buried actions.
    await gu.undo(2);
    assert.deepEqual(await getActionUndoState(4), ['undone', 'buried', 'undone', 'default']);

    // Check that burying around already buried actions works.
    await gu.enterCell('f');
    await gu.waitForServer();
    assert.deepEqual(await getActionUndoState(5), ['default', 'buried', 'buried', 'buried', 'default']);
  });

  it("should properly rebuild the action log on refresh", async function() {
    // Undo past buried actions to add complexity to the current state of the log
    // and refresh.
    await gu.undo(2);
    await driver.navigate().refresh();
    await gu.waitForDocToLoad();
    // Dismiss forms announcement popup, if present.
    await gu.dismissBehavioralPrompts();
    // refreshing browser will restore position on last cell
    // switch active cell to the first cell in the first row
    await gu.getCell(0, 1).click();
    await driver.findWait('.test-tools-log', 1000).click();
    await driver.findContentWait('.test-doc-history-tabs .test-select-button', 'Activity', 500).click();
    await gu.waitForServer();
    assert.deepEqual(await getActionUndoState(6), ['undone', 'buried', 'buried', 'buried', 'undone', 'default']);
  });

  it("should indicate to the user when they cannot undo or redo", async function() {
    assert.equal(await driver.find('.test-undo').matches('[class*=-disabled]'), false);
    assert.equal(await driver.find('.test-redo').matches('[class*=-disabled]'), false);

    // Undo and check that undo button gets disabled.
    await gu.undo();
    assert.equal(await driver.find('.test-undo').matches('[class*=-disabled]'), true);
    assert.equal(await driver.find('.test-redo').matches('[class*=-disabled]'), false);

    // Redo to the top of the log and check that redo button gets disabled.
    await gu.redo(3);
    assert.equal(await driver.find('.test-undo').matches('[class*=-disabled]'), false);
    assert.equal(await driver.find('.test-redo').matches('[class*=-disabled]'), true);
  });

  it("should show clickable tabular diffs", async function() {
    const item0 = await getActionLogItem(0);
    assert.equal(await item0.find('table caption').getText(), 'Table1');
    assert.equal(await item0.find('table th:nth-child(2)').getText(), 'A');
    assert.equal(await item0.find('table td:nth-child(2)').getText(), 'f');
    assert.equal(await gu.getActiveCell().getText(), 'a');
    await item0.find('table td:nth-child(2)').click();
    assert.equal(await gu.getActiveCell().getText(), 'f');
  });

  it("clickable tabular diffs should work across renames", async function() {
    // Add another table just to mix things up a bit.
    await gu.addNewTable();
    // Rename our old table.
    await gu.renameTable('Table1', 'Table1Renamed');
    await gu.getPageItem('Table1Renamed').click();
    await gu.renameColumn({col: 'A'}, 'ARenamed');

    // Check that it's still usable. (It doesn't reflect the new names in the content of prior
    // actions though -- e.g. the action below still mentions 'A' for column name -- and it's
    // unclear if it should.)
    const item2 = await getActionLogItem(2);
    assert.equal(await item2.find('table caption').getText(), 'Table1');
    assert.equal(await item2.find('table td:nth-child(2)').getText(), 'f');
    await gu.getCell({rowNum: 1, col: 0}).click();
    assert.notEqual(await gu.getActiveCell().getText(), 'f');
    await item2.find('table td:nth-child(2)').click();
    assert.equal(await gu.getActiveCell().getText(), 'f');

    // Delete Table1Renamed.
    await gu.removeTable('Table1Renamed', {dismissTips: true});
    await driver.findContent('.action_log label', /All tables/).find('input').click();

    const item4 = await getActionLogItem(4);
    await gu.scrollIntoView(item4);
    await item4.find('table td:nth-child(2)').click();
    assert.include(await driver.findWait('.test-notifier-toast-wrapper', 1000).getText(),
      'Table1Renamed was subsequently removed');
    await driver.find('.test-notifier-toast-wrapper .test-notifier-toast-close').click();
    await driver.findContent('.action_log label', /All tables/).find('input').click();
  });

  it("should filter cell changes and renames by table", async function() {
    // Have Table2, now add some more
    // We are at Raw Data view now (since we deleted a table).
    assert.match(await driver.getCurrentUrl(), /p\/data$/);
    await gu.getPageItem('Table2').click();
    await gu.enterGridRows({rowNum: 1, col: 0}, [['2']]);
    await gu.addNewTable();  // Table1
    await gu.enterGridRows({rowNum: 1, col: 0}, [['1']]);
    await gu.addNewTable();  // Table3
    await gu.enterGridRows({rowNum: 1, col: 0}, [['3']]);
    await gu.getPageItem('Table1').click();

    assert.lengthOf(await getActionLogItems(), 2);

    assert.equal(await getActionLogItem(0).find("table:not([style*='display: none']) caption").getText(), 'Table1');
    assert.equal(await getActionLogItem(1).find('.action_log_rename').getText(), 'Add Table1');
    await gu.renameTable('Table1', 'Table1Renamed');
    assert.equal(await getActionLogItem(0).find('.action_log_rename').getText(),
      'Rename Table1 to Table1Renamed');

    await gu.renameColumn({col: 'A'}, 'ARenamed');
    assert.equal(await getActionLogItem(0).find('.action_log_rename').getText(),
      'Rename Table1Renamed.A to ARenamed');
    await gu.getPageItem('Table2').click();
    assert.equal(await getActionLogItem(0).find("table:not([style*='display: none']) caption").getText(), 'Table2');
    await gu.getPageItem('Table3').click();
    assert.equal(await getActionLogItem(0).find("table:not([style*='display: none']) caption").getText(), 'Table3');

      // Now show all tables and make sure the result is a longer (visible) log.
    const filteredCount = (await getActionLogItems()).length;
    await driver.findContent('.action_log label', /All tables/).find('input').click();
    const fullCount = (await getActionLogItems()).length;
    assert.isAbove(fullCount, filteredCount);
  });
});
