import {UserAPI} from 'app/common/UserAPI';
import {assert, driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';

describe('RawData', function () {
  this.timeout(30000);
  let api: UserAPI;
  let doc: string;
  // We will stress undo here and will try to undo all tests that were using RAW DATA views.
  // At the time of writing this test, undo was basically not possible and was throwing all sort
  // of exceptions (related to summary tables).
  let revertAll: () => Promise<void>;
  setupTestSuite();
  gu.bigScreen();
  afterEach(() => gu.checkForErrors());
  before(async function () {
    await server.simulateLogin('Chimpy', 'chimpy@getgrist.com', 'nasa');
    const docInfo = await gu.importFixturesDoc('chimpy', 'nasa', 'Horizon', 'World.grist');
    doc = docInfo.id;
    api = gu.createHomeApi('Chimpy', 'nasa');
    await openRawData();
    revertAll = await gu.begin();
  });

  it('shows all tables', async function () {
    const uiTables = await getRawTableIds();
    const data = await api.getTable(doc, '_grist_Tables');
    const tables: string[] = data.tableId as string[];
    tables.sort();
    uiTables.sort();
    assert.deepEqual(uiTables, tables);
  });

  it('shows blank creator panel', async function () {
    await gu.toggleSidePanel('right', 'open');
    assert.isEmpty(await driver.find('.test-right-panel').getText());
    await gu.toggleSidePanel('right', 'close');
  });

  it('shows row counts of all tables', async function () {
    assert.deepEqual(await getRawTableRows(), [
      '4,079',
      '239',
      '984',
      '4',
    ]);
  });

  it('shows new table name', async function () {
    await gu.renameTable('City', 'Town');
    const uiTables = await getRawTableIds();
    const data = await api.getTable(doc, '_grist_Tables');
    const tables: string[] = data.tableId as string[];
    tables.sort();
    uiTables.sort();
    assert.deepEqual(uiTables, tables);
  });

  it('shows table preview', async function () {
    // Open modal with grid
    await driver.findContent('.test-raw-data-table-title', 'Country').click();
    await gu.waitForServer();
    // Test that overlay is showed.
    assert.isTrue(await driver.findWait('.test-raw-data-overlay', 100).isDisplayed());
    // Test proper table is selected.
    assert.equal(await gu.getSectionTitle(), 'Country');
    // Test we have some data.
    assert.deepEqual(await gu.getVisibleGridCells('Code', [1, 2], 'Country'), ['ABW', 'AFG']);
    // Test we can close by button.
    await gu.closeRawTable();
    assert.isFalse(await driver.find('.test-raw-data-overlay').isPresent());

    // Test we can close by pressing escape.
    await driver.findContent('.test-raw-data-table-title', 'Country').click();
    assert.isTrue(await driver.find('.test-raw-data-overlay').isDisplayed());
    await driver.sendKeys(Key.ESCAPE);
    assert.isFalse(await driver.find('.test-raw-data-overlay').isPresent());

    // Test we can't close by pressing escape when there is a selection,
    await driver.findContent('.test-raw-data-table-title', 'Country').click();
    assert.isTrue(await driver.find('.test-raw-data-overlay').isDisplayed());
    await driver.find('.gridview_data_corner_overlay').doClick();
    await driver.sendKeys(Key.ESCAPE);
    assert.isTrue(await driver.find('.test-raw-data-overlay').isDisplayed());
    // Press ESCAPE one more time to close.
    await driver.sendKeys(Key.ESCAPE);
    assert.isFalse(await driver.find('.test-raw-data-overlay').isPresent());

    // Test we can close by clicking on overlay.
    await driver.findContent('.test-raw-data-table-title', 'Country').click();
    assert.isTrue(await driver.find('.test-raw-data-overlay').isDisplayed());
    await driver.find('.test-raw-data-close-button').mouseMove();
    await driver.mouseMoveBy({y: 100}); // move 100px below (not negative value)
    await driver.withActions(a => a.click());
    assert.isFalse(await driver.find('.test-raw-data-overlay').isPresent());
  });

  it('should rename table from modal window', async function () {
    // Open Country table.
    await driver.findContent('.test-raw-data-table-title', 'Country').click();
    await gu.waitForServer();
    // Rename section to Empire
    await gu.renameActiveTable('Empire');
    // Close and test that it was renamed
    await gu.closeRawTable();
    const tables = await getRawTableIds();
    const titles = await driver.findAll('.test-raw-data-table-title', e => e.getText());
    tables.sort();
    titles.sort();
    // Title should also be renamed for now. In follow-up diff those
    // two will be separate.
    assert.deepEqual(titles, ['Town', 'Empire', 'CountryLanguage', 'Table1'].sort());
    assert.deepEqual(tables, ['Town', 'Empire', 'CountryLanguage', 'Table1'].sort());
  });

  it('should show table description', async function () {
    // Give Empire table a description.
    await gu.renameRawTable('Empire', undefined, 'My raw data table description.');

    // Check that a description icon tooltip is shown next to the title.
    await driver.findContent('.test-raw-data-table-title', 'Empire')
      .find('.test-widget-info-tooltip')
      .click();
    await gu.waitToPass(async () => {
      assert.isTrue(await driver.find('.test-widget-info-tooltip-popup').isDisplayed());
    });
    assert.equal(
      await driver.find('.test-widget-info-tooltip-popup').getText(),
      'My raw data table description.'
    );

    // Open Empire table and check that the tooltip is shown there as well.
    await driver.findContent('.test-raw-data-table-title', 'Empire').click();
    await gu.waitForServer();
    await driver.find('.test-viewsection-title .test-widget-info-tooltip').click();
    await gu.waitToPass(async () => {
      assert.isTrue(await driver.find('.test-widget-info-tooltip-popup').isDisplayed());
    });
    assert.equal(
      await driver.find('.test-widget-info-tooltip-popup').getText(),
      'My raw data table description.'
    );
    await gu.closeRawTable();
  });

  it('should remove table', async function () {
    // Open menu for Town
    await openMenu('Town');
    // Click delete.
    await clickRemove();
    // Confirm.
    await clickConfirm();
    await gu.waitForServer();
    const tables = await getRawTableIds();
    const titles = await driver.findAll('.test-raw-data-table-title', e => e.getText());
    tables.sort();
    titles.sort();
    // Title should also be renamed for now. In a follow-up diff those
    // two will be separate.
    assert.deepEqual(titles, ['Empire', 'CountryLanguage', 'Table1'].sort());
    assert.deepEqual(tables, ['Empire', 'CountryLanguage', 'Table1'].sort());
  });

  it('should duplicate table', async function () {
    await openMenu('Empire');
    await clickDuplicateTable();
    await driver.find('.test-duplicate-table-name').click();
    await gu.sendKeys('Empire Copy');

    // Before clicking the Copy All Data checkbox, check that no warning about ACLs is shown.
    assert.isFalse(await driver.find('.test-duplicate-table-acl-warning').isPresent());

    // Now click the Copy All Data checkbox, and check that the warning is shown.
    await driver.find('.test-duplicate-table-copy-all-data').click();
    assert.isTrue(await driver.find('.test-duplicate-table-acl-warning').isPresent());

    await clickConfirm();
    await gu.waitForServer();
    assert.isTrue(await driver.findWait('.test-raw-data-overlay', 100).isDisplayed());
    assert.equal(await gu.getSectionTitle(), 'Empire Copy');
    assert.deepEqual(await gu.getVisibleGridCells('Code', [1, 2], 'Empire Copy'), ['ABW', 'AFG']);

    await driver.sendKeys(Key.ESCAPE);
    const tables = await getRawTableIds();
    const titles = await driver.findAll('.test-raw-data-table-title', e => e.getText());
    tables.sort();
    titles.sort();
    assert.deepEqual(titles, ['Empire', 'Empire Copy', 'CountryLanguage', 'Table1'].sort());
    assert.deepEqual(tables, ['Empire', 'Empire_Copy', 'CountryLanguage', 'Table1'].sort());
  });

  it('should restore position when browser is refreshed', async function () {
    await driver.findContent('.test-raw-data-table-title', 'Empire').click();
    await gu.waitForServer();
    await gu.getCell(3, 2).click();
    await driver.navigate().refresh();
    await gu.waitForDocToLoad();
    assert.isTrue(await driver.findWait('.test-raw-data-overlay', 100).isDisplayed());
    assert.deepEqual(await gu.getCursorPosition(), {col: 3, rowNum: 2});
    // Close overlay.
    await driver.sendKeys(Key.ESCAPE);
  });

  it('should restore last edit position when browser is refreshed', async function () {
    await driver.findContent('.test-raw-data-table-title', 'Empire').click();
    await gu.waitForServer();
    await gu.getCell(2, 9).click();
    await driver.sendKeys('123456789');
    await gu.refreshDismiss();
    await gu.waitForDocToLoad();
    assert.isTrue(await driver.findWait('.test-raw-data-overlay', 100).isDisplayed());
    await gu.checkTextEditor(gu.exactMatch('123456789'));
    // Close editor.
    await driver.sendKeys(Key.ESCAPE);
    assert.deepEqual(await gu.getCursorPosition(), {col: 2, rowNum: 9});
    // Close overlay.
    await driver.sendKeys(Key.ESCAPE);
  });

  it('should copy anchor link and restore', async function () {
    await driver.findContent('.test-raw-data-table-title', 'Empire').click();
    await gu.waitForServer();
    await (await gu.openRowMenu(10)).findContent('li', /Copy anchor link/).click();
    await driver.findContentWait('.test-notifier-toast-message', /Link copied to clipboard/, 2000);
    await driver.find('.test-notifier-toast-close').click();
    const anchor = (await gu.getTestState()).clipboard!;
    await gu.getCell(3, 2).click();
    await gu.onNewTab(async () => {
      await driver.get(anchor);
      await gu.waitForAnchor();
      assert.isTrue(await driver.findWait('.test-raw-data-overlay', 100).isDisplayed());
      assert.deepEqual(await gu.getCursorPosition(), {col: 0, rowNum: 10});
    });
    // Close overlay.
    await driver.sendKeys(Key.ESCAPE);
  });

  it('should copy table name', async function () {
    await driver.findContentWait('.test-raw-data-table-id', 'Empire', 1000).click();
    await gu.waitToPass(async () => {
      assert.equal((await gu.getTestState()).clipboard, 'Empire');
    }, 500);
    // Currently tooltip is not dismissible, so let's refresh the page.
    await driver.navigate().refresh();
    await waitForRawData();
  });

  it('shows summary tables under Raw Data Tables', async function () {
    // Add a few summary tables: 1 with no group-by columns, and 2 that
    // share the same group-by columns.
    for (let i = 0; i <= 2; i++) {
      await gu.addNewPage(/Table/, /CountryLanguage/, {
        summarize: i === 0 ? [] : ['Country']
      });
    }

    // Check that the added summary tables are listed at the end.
    await openRawData();
    assert.deepEqual(await getRawTableTitles(), [
      'CountryLanguage',
      'Empire',
      'Empire Copy',
      'Table1',
      'CountryLanguage [Totals]',
      'CountryLanguage [by Country]',
    ]);
    assert.deepEqual(await getRawTableIds(), [
      'CountryLanguage',
      'Empire',
      'Empire_Copy',
      'Table1',
      'CountryLanguage_summary',
      'CountryLanguage_summary_Country',
    ]);
  });

  it('shows Record Card button for all non-summary tables', async function () {
    const displayed = await getRawTableRecordCardButtonsIsDisplayed();
    assert.deepEqual(displayed, [
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
    const enabled = await getRawTableRecordCardButtonsIsEnabled();
    assert.deepEqual(enabled, [
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it('shows preview of summary table when clicked', async function () {
    // Open a summary table.
    await driver.findContent('.test-raw-data-table-title', 'CountryLanguage [by Country]').click();
    await gu.waitForServer();

    // Check that an overlay is shown.
    assert.isTrue(await driver.findWait('.test-raw-data-overlay', 100).isDisplayed());

    // Check that the right section title is shown.
    assert.equal(await gu.getSectionTitle(), 'COUNTRYLANGUAGE [by Country]');

    // Make sure the data looks correct.
    assert.deepEqual(
      await gu.getVisibleGridCells('Country', [1, 2, 3, 4, 5], 'CountryLanguage [by Country]'),
      ['ABW', 'AFG', 'AGO', 'AIA', 'ALB'],
    );

    // Close the overlay.
    await gu.closeRawTable();
    assert.isFalse(await driver.find('.test-raw-data-overlay').isPresent());
  });

  it('removes summary table when all sections referencing it are removed', async function () {
    // CountryLanguage [Totals] and CountryLanguage [by Country] respectively.
    await gu.removePage('New page');
    await gu.removePage('New page');

    // Check that the table summarizing by country wasn't removed, since there is still
    // one more view for it.
    assert.deepEqual(await getRawTableTitles(), [
      'CountryLanguage',
      'Empire',
      'Empire Copy',
      'Table1',
      'CountryLanguage [by Country]',
    ]);
  });

  it('removes summary table when source table is removed', async function () {
    await removeRawTable('CountryLanguage');
    assert.deepEqual(await getRawTableTitles(), [
      'Empire',
      'Empire Copy',
      'Table1',
    ]);
    await gu.undo();
    assert.deepEqual(await getRawTableTitles(), [
      'CountryLanguage',
      'Empire',
      'Empire Copy',
      'Table1',
      'CountryLanguage [by Country]',
    ]);
  });

  it('removes summary table when "Remove" menu item is clicked', async function () {
    const tableIds = await getRawTableIds();
    await removeRawTable(tableIds[tableIds.length - 1]);

    const titles = await getRawTableTitles();
    assert.deepEqual(titles, [
      'CountryLanguage',
      'Empire',
      'Empire Copy',
      'Table1',
    ]);
  });

  it('should stay on a page when undoing summary table', async function () {
    // Undoing after converting a table to a summary table doesn't know
    // where to navigate, as section is removed and recreated during navigation
    // and it is not connected to any view for a brief moment - which makes that
    // section look like a Raw Data View (section without a view).

    // This tests that the section is properly identified and Grist will not navigate
    // to the Raw Data view.
    await gu.addNewTable();
    const url = await driver.getCurrentUrl();
    assert.isTrue(url.endsWith('p/8'));
    await convertToSummary();
    assert.equal(url, await driver.getCurrentUrl());
    await gu.undo();
    assert.equal(url, await driver.getCurrentUrl());
    await gu.redo();
    // Reverting actually went to a bare document url (without a page id)
    // This was old buggy behavior that is now fixed.

    assert.equal(url, await driver.getCurrentUrl());
    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 1, col: 0});

    // Switching pages was producing error after undoing summary table.
    await gu.openPage('Empire');
    await gu.checkForErrors();
    await gu.openPage('Table2');
    await gu.checkForErrors();
  });

  it('should remove all tables except one (including referenced summary table)', async function () {
    // First we will add a new summary table for CountryLanguage table.
    // This table has a reference to the Country table, and Grist had a bug that
    // didn't allow to delete those tables - so here we will test if this is fixed.
    await gu.addNewPage('Table', 'CountryLanguage', {
      summarize: ['Country'],
    });

    await openRawData();

    const allTables = await getRawTableIds();

    // Now we are ready to test deletion.
    const beforeDeleteCheckpoint = await gu.begin();

    // First remove that table without a raw section, to see if that works.
    await removeRawTable('Table1');
    await gu.checkForErrors();
    assert.isFalse((await getRawTableIds()).includes('Table1'));

    // Now try to remove Country (now Empire) table - here we had a bug
    await removeRawTable('Empire');
    await gu.checkForErrors();
    assert.isFalse((await getRawTableIds()).includes('Empire'));

    // Now revert and remove all until remove is disabled
    await beforeDeleteCheckpoint();
    await openRawData();

    while (allTables.length > 1) {
      await removeRawTable(allTables.pop()!);
    }

    // We should have only one table
    assert.deepEqual(await getRawTableIds(), allTables);

    // The last table should have disabled remove button.
    await openMenu(allTables[0]);
    assert.isTrue(await driver.find('.test-raw-data-menu-remove-table.disabled').isDisplayed());
    await gu.sendKeys(Key.ESCAPE);
  });

  it('should allow removing GristHidden* pages', async () => {
    // Add a table named GristHidden_test, to test when such tables are left over after an incomplete import.

    // Prepare two tables to test
    await gu.addNewTable();
    // Remove last old table we have
    await openRawData();
    await removeRawTable('CountryLanguage');

    await gu.addNewTable();
    assert.deepEqual(await gu.getPageNames(), ['Table1', 'Table2']);

    // Rename Table2 page to GristHidden_test, it should be still visible, as the table
    // id is diffrent (not hidden).
    await gu.renamePage('Table1', 'GristHidden_test');
    assert.deepEqual(await gu.getPageNames(), ['GristHidden_test', 'Table2']);
    // Make sure all pages can be removed
    for (const page of await gu.getPageNames()) {
      assert.isTrue(await gu.canRemovePage(page));
    }
    await gu.removePage('Table2');
    assert.deepEqual(await gu.getPageNames(), ['GristHidden_test']);
    assert.isFalse(await gu.canRemovePage('GristHidden_test'));
    await gu.undo();

    await gu.removePage('GristHidden_test');
    assert.deepEqual(await gu.getPageNames(), ['Table2']);
    assert.isFalse(await gu.canRemovePage('Table2'));
    await gu.undo();
    assert.deepEqual(await gu.getPageNames(), ['GristHidden_test', 'Table2']);
  });

  it('should allow removing hidden tables', async () => {
    // Rename Table1 table to a simulate hidden table
    await openRawData();
    await gu.renameRawTable("Table2", "GristHidden_import");
    assert.deepEqual(await getRawTableIds(), ['GristHidden_import', 'Table1']);
    // Page should be hidden now
    assert.deepEqual(await gu.getPageNames(), ['GristHidden_test']);
    assert.isFalse(await gu.canRemovePage('GristHidden_test'));
    // We should be able to remove hidden table, but not user table (as this can be last table that will
    // be auto-removed).
    assert.isTrue(await isRemovable('GristHidden_import'));
    assert.isFalse(await isRemovable('Table1'));

    // Rename back
    await gu.renameRawTable("GristHidden_import", "Table2");
    // Page should be visible again
    assert.deepEqual(await gu.getPageNames(), ['GristHidden_test', 'Table2']);
    for (const page of await gu.getPageNames()) {
      assert.isTrue(await gu.canRemovePage(page));
    }
    assert.isTrue(await isRemovable('Table2'));
    assert.isTrue(await isRemovable('Table1'));

    // Rename once again and test if it can be actually removed.
    await gu.renameRawTable("Table2", "GristHidden_import");
    assert.isTrue(await isRemovable('GristHidden_import'));
    await removeRawTable("GristHidden_import");
    await gu.checkForErrors();
    assert.deepEqual(await getRawTableIds(), ['Table1']);
    assert.isFalse(await isRemovable('Table1'));
  });

  it('should revert all without errors', async function () {
    // Revert internally checks errors.
    await revertAll();
  });

  it('should open raw data as a popup', async () => {
    // We are at City table, in first row/first cell.
    // Send some keys, to make sure we have focus on active section.
    // RawData popup is manipulating what section has focus, so we need to make sure that
    // focus is properly restored.
    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 1, col: 0});
    await gu.getCell(0, 2).click();
    await gu.sendKeys("abc");
    await gu.checkTextEditor("abc");
    await gu.sendKeys(Key.ESCAPE);
    await gu.showRawData();
    assert.equal(await gu.getActiveSectionTitle(), 'City');
    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 20, col: 0}); // raw popup is not sorted
    await gu.sendKeys("abc");
    await gu.checkTextEditor("abc");
    await gu.sendKeys(Key.ESCAPE);
    // Click on another cell, check page hasn't changed (there was a bug about that)
    await gu.getCell({rowNum: 21, col: 1}).click();
    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 21, col: 1});
    assert.equal(await gu.getCurrentPageName(), 'City');

    // Close by hitting escape.
    await gu.sendKeys(Key.ESCAPE);
    await assertNoPopup();
    // Make sure we see CITY, and everything is where it should be.
    assert.equal(await gu.getActiveSectionTitle(), 'CITY');
    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 2, col: 0});
    await gu.sendKeys("abc");
    await gu.checkTextEditor("abc");
    await gu.sendKeys(Key.ESCAPE);

    // Now open popup again, but close it by clicking on the close button.
    await gu.showRawData();
    await gu.closeRawTable();
    await assertNoPopup();
    assert.equal(await gu.getActiveSectionTitle(), 'CITY');
    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 2, col: 0});
    await gu.sendKeys("abc");
    await gu.checkTextEditor("abc");
    await gu.sendKeys(Key.ESCAPE);

    // Now do the same, but close by clicking on a diffrent page
    await gu.showRawData();
    await gu.getPageItem('Country').click();
    await assertNoPopup();
    assert.equal(await gu.getActiveSectionTitle(), 'COUNTRY');
    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 1, col: 0});
    await gu.sendKeys("abc");
    await gu.checkTextEditor("abc");
    await gu.sendKeys(Key.ESCAPE);

    // Now make sure that raw data is available for card view.
    await gu.selectSectionByTitle("COUNTRY Card List");
    assert.equal(await gu.getActiveSectionTitle(), 'COUNTRY Card List');
    await gu.showRawData();
    assert.equal(await gu.getActiveSectionTitle(), 'Country');
    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 1, col: 1});
    await gu.sendKeys("abc");
    await gu.checkTextEditor("abc");
    await gu.sendKeys(Key.ESCAPE);
    // Make sure we see a grid
    assert.isTrue(await driver.find(".grid_view_data").isDisplayed());
    await gu.sendKeys(Key.ESCAPE);
  });

  // This is not documented feature at this moment, and tailored for raw data
  // view, but it should work for any kind of section.
  it('should open detail section as a popup', async () => {
    // We are at the Country page
    await gu.getDetailCell('Code', 1).click();
    let anchorLink = replaceAnchor(await gu.getAnchor(), { a: '2' });
    const testResult = async () => {
      await waitForAnchorPopup(anchorLink);
      assert.equal(await gu.getActiveSectionTitle(), 'COUNTRY Card List');
      assert.deepEqual(await gu.getCursorPosition(), {rowNum: 1, col: 'Code'});
      await gu.sendKeys("abc");
      await gu.checkTextEditor("abc");
      await gu.sendKeys(Key.ESCAPE);
      // Close by hitting escape.
      await gu.sendKeys(Key.ESCAPE);
      // Make sure we are on correct page
      assert.equal(await gu.getCurrentPageName(), "City");
    };
    // Switch page and use only hash, otherwise it will just maximize the section on the current page.
    await gu.getPageItem('City').click();
    anchorLink = (await driver.getCurrentUrl()) + '#' + anchorLink.split('#')[1];
    await testResult();
  });

  it('should open chart section as a popup', gu.revertChanges(async () => {
    // We are at the Country page
    await gu.getPageItem('Country').click();
    await gu.selectSectionByTitle("COUNTRY Card List");
    await gu.getDetailCell('Code', 1).click();
    await gu.addNewSection(/Chart/, /CountryLanguage/);
    // s22 is the new section id, we also strip row/column.
    let chartLink = replaceAnchor(await gu.getAnchor(), {s: '22', a: '2'});
    await gu.getPageItem('City').click();
    chartLink = (await driver.getCurrentUrl()) + '#' + chartLink.split('#')[1];
    await waitForAnchorPopup(chartLink);
    assert.isTrue(await driver.find(".test-raw-data-overlay .test-chart-container").isDisplayed());
    await gu.sendKeys(Key.ESCAPE);
  }));

  it('should handle edge cases when table/section is removed', async () => {
    await gu.getPageItem('Country').click();
    await gu.selectSectionByTitle("COUNTRY Card List");
    await gu.getDetailCell('Code', 1).click();
    let anchorLink = replaceAnchor(await gu.getAnchor(), { a: '2' });
    await gu.getPageItem('City').click();
    anchorLink = (await driver.getCurrentUrl()) + '#' + anchorLink.split('#')[1];
    await waitForAnchorPopup(anchorLink);

    assert.equal(await gu.getActiveSectionTitle(), 'COUNTRY Card List');
    // Now remove the section using api, popup should be closed.
    const sectionId = parseInt(getAnchorParams(anchorLink).s);
    await api.applyUserActions(doc, [[
      'RemoveRecord', '_grist_Views_section', sectionId
    ]]);
    await gu.waitForServer();
    await gu.checkForErrors();
    await assertNoPopup();
    // Now open plain raw data for City table.
    await gu.selectSectionByTitle("CITY");
    assert.equal(await gu.getActiveSectionTitle(), 'CITY'); // CITY is viewSection title
    await gu.showRawData();
    assert.equal(await gu.getActiveSectionTitle(), 'City'); // City is now a table title
    // Now remove the table.
    await api.applyUserActions(doc, [[
      'RemoveTable', 'City'
    ]]);
    await gu.waitForServer();
    await gu.checkForErrors();
    await assertNoPopup();
  });

  it("can edit a table's Record Card", async () => {
    // Open the Record Card for the Country table.
    await openRawData();
    await editRecordCard('Country');

    // Check that the Record Card is shown.
    assert.isTrue(await driver.findWait('.test-raw-data-overlay', 100).isDisplayed());

    // Check that layout editing is toggled by default.
    assert.isTrue(await driver.find('.test-edit-layout-controls').isDisplayed());

    // Check that the title is correct. Note that it's initially obscured by the layout
    // editing buttons; it becomes visible after the layout is saved.
    assert.equal(await gu.getSectionTitle(), 'COUNTRY Card');

    // Modify the layout and theme.
    await gu.openWidgetPanel('widget');
    assert.isTrue(
      await driver.findContent('.active_section .g_record_detail_inner .g_record_detail_label',
      gu.exactMatch('Continent')).isPresent()
    );
    await gu.moveToHidden('Continent');
    assert.isFalse(
      await driver.findContent('.active_section .g_record_detail_inner .g_record_detail_label',
      gu.exactMatch('Continent')).isPresent()
    );
    await driver.findContent('.test-edit-layout-controls button', 'Save').click();
    await gu.waitForServer();
    await driver.find('.test-vconfigtab-detail-theme').click();
    await driver.findContent('.test-select-row', /Blocks/).click();
    await gu.waitForServer();
    await gu.checkForErrors();

    // Close the overlay.
    await gu.sendKeys(Key.ESCAPE);

    // Re-open the Record Card and check that the new layout and theme persisted.
    await editRecordCard('Country');
    assert.isFalse(
      await driver.findContent('.active_section .g_record_detail_inner .g_record_detail_label',
      gu.exactMatch('Continent')).isPresent()
    );
    assert.equal(
      await driver.find('.test-vconfigtab-detail-theme').getText(),
      'Blocks'
    );
    await gu.sendKeys(Key.ESCAPE, Key.ESCAPE);

    // Open the Record Card from outside the Raw Data page and check that the
    // new layout and theme is used.
    await gu.openPage('Country');
    await (await gu.openRowMenu(1)).findContent('li', /View as card/).click();
    assert.isTrue(await driver.findWait('.test-record-card-popup-overlay', 100).isDisplayed());
    assert.isFalse(
      await driver.findContent('.active_section .g_record_detail_inner .g_record_detail_label',
      gu.exactMatch('Continent')).isPresent()
    );
    assert.equal(
      await driver.find('.test-vconfigtab-detail-theme').getText(),
      'Blocks'
    );
    await gu.sendKeys(Key.ESCAPE);
  });

  it("can disable a table's Record Card", async () => {
    // Disable the Record Card for the Country table.
    await openRawData();
    await disableRecordCard('Country');

    // Check that the button to edit the Record Card is disabled.
    assert.isFalse(await isRecordCardEnabled('Country'));
    await editRecordCard('Country');
    assert.isFalse(await driver.find('.test-raw-data-overlay').isPresent());

    // Check that the Edit Record Card menu item still works though.
    await openMenu('Country');
    await driver.find('.test-raw-data-menu-edit-record-card').click();
    assert.isTrue(await driver.findWait('.test-raw-data-overlay', 100).isDisplayed());
    assert.equal(await gu.getSectionTitle(), 'COUNTRY Card');

    // Stop editing the layout and close the overlay.
    await gu.sendKeys(Key.ESCAPE, Key.ESCAPE);

    // Check that it's no longer possible to open a Record Card from outside
    // the Raw Data page, even with the keyboard shortcut.
    await gu.openPage('Country');
    await (await gu.openRowMenu(1)).findContent('li.disabled', /View as card/);
    await gu.sendKeys(Key.ESCAPE, Key.SPACE);
    assert.isFalse(await driver.find('.test-record-card-popup-overlay').isPresent());

    // Check that clicking the icon in Reference and Reference List columns also
    // doesn't open a Record Card.
    await gu.openPage('CountryLanguage');
    await gu.getCell(0, 1).find('.test-ref-link-icon').click();
    assert.isFalse(await driver.find('.test-record-card-popup-overlay').isPresent());
    await gu.wipeToasts();  // notification build-up can cover setType button.
    await gu.setType('Reference List', {apply: true});
    await gu.getCell(0, 1).find('.test-ref-list-link-icon').click();
    assert.isFalse(await driver.find('.test-record-card-popup-overlay').isPresent());
  });

  it("can enable a table's Record Card", async () => {
    // Enable the Record Card for the Country table.
    await openRawData();
    await enableRecordCard('Country');

    // Check that the button to edit the Record Card is enabled again.
    assert.isTrue(await isRecordCardEnabled('Country'));
    await editRecordCard('Country');
    assert.isTrue(await driver.findWait('.test-raw-data-overlay', 100).isDisplayed());
    assert.equal(await gu.getSectionTitle(), 'COUNTRY Card');

    // Check that it's possible again to open the Record Card from outside
    // the Raw Data page.
    await gu.openPage('Country');
    await (await gu.openRowMenu(1)).findContent('li', /View as card/).click();
    assert.isTrue(await driver.findWait('.test-record-card-popup-overlay', 100).isDisplayed());
    await gu.sendKeys(Key.ESCAPE);
    assert.isFalse(await driver.find('.test-record-card-popup-overlay').isPresent());
    await gu.sendKeys(Key.SPACE);
    assert.isTrue(await driver.findWait('.test-record-card-popup-overlay', 100).isDisplayed());

    // Check that clicking the icon in Reference and Reference List columns opens a
    // Record Card again.
    await gu.openPage('CountryLanguage');
    await gu.getCell(0, 1).find('.test-ref-list-link-icon').click();
    assert.isTrue(await driver.findWait('.test-record-card-popup-overlay', 100).isDisplayed());
    await gu.sendKeys(Key.ESCAPE);
    assert.isFalse(await driver.find('.test-record-card-popup-overlay').isPresent());
    await gu.setType('Reference', {apply: true});
    await gu.getCell(0, 1).find('.test-ref-link-icon').click();
    assert.isTrue(await driver.findWait('.test-record-card-popup-overlay', 100).isDisplayed());
  });
});

const anchorRegex = /#a(\d+)\.s(\d+)\.r(\d+)\.c(\d+)/gm;

function getAnchorParams(link: string) {
  const match = anchorRegex.exec(link);
  if (!match) { throw new Error("Invalid link"); }
  const [, a, s, r, c] = match;
  return { a, s, r, c };
}

function replaceAnchor(link: string, values: {
  a?: string,
  s?: string,
  r?: string,
  c?: string,
}) {
  const { a, s, r, c } = getAnchorParams(link);
  return link.replace(anchorRegex, `#a${values.a || a}.s${values.s || s}.r${values.r || r}.c${values.c || c}`);
}

async function openRawData() {
  await driver.find('.test-tools-raw').click();
  await waitForRawData();
}

async function clickConfirm() {
  await driver.find('.test-modal-confirm').click();
}

async function clickDuplicateTable() {
  await driver.find('.test-raw-data-menu-duplicate-table').click();
}

async function clickRemove() {
  await driver.find('.test-raw-data-menu-remove-table').click();
}

async function removeRawTable(tableId: string) {
  await openMenu(tableId);
  await clickRemove();
  await clickConfirm();
  await gu.waitForServer();
}

async function convertToSummary(...groupByColumns: string[]) {
  // Convert table to a summary table
  await gu.toggleSidePanel('right', 'open');
  // Creator Panel > Table
  await driver.find('.test-right-tab-pagewidget').click();
  // Tab [Data]
  await driver.find('.test-config-data').click();
  // Edit Data Selection
  await driver.find('.test-pwc-editDataSelection').click();
  // Σ
  await driver.find('.test-wselect-pivot').click();
  // Select Group-By Columns
  for (const c of groupByColumns) {
    await driver.findContent('.test-wselect-column', c).click();
  }
  // Save
  await driver.find('.test-wselect-addBtn').click();
  await gu.waitForServer();
}

async function getRawTableTitles() {
  return await driver.findAll('.test-raw-data-table-title', e => e.getText());
}

async function getRawTableIds() {
  return await driver.findAll('.test-raw-data-table-id', e => e.getText());
}

async function getRawTableRows() {
  return await driver.findAll('.test-raw-data-table-rows', e => e.getText());
}

async function getRawTableRecordCardButtonsIsDisplayed() {
  return await driver.findAll('.test-raw-data-table-record-card', e => e.isDisplayed());
}

async function getRawTableRecordCardButtonsIsEnabled() {
  return await driver.findAll('.test-raw-data-table-record-card', async e => {
    const isDisplayed = await e.isDisplayed();
    const className = await e.getAttribute('class');
    return isDisplayed && !className.includes('-disabled');
  });
}

async function openMenu(tableId: string) {
  const allTables = await getRawTableIds();
  const tableIndex = allTables.indexOf(tableId);
  assert.isTrue(tableIndex >= 0, `No raw table with id ${tableId}`);
  const menus = await driver.findAll('.test-raw-data-table .test-raw-data-table-menu');
  assert.equal(menus.length, allTables.length);
  await menus[tableIndex].click();
}

async function waitForRawData() {
  await driver.findWait('.test-raw-data-list', 2000);
  await gu.waitForServer();
}

async function isRemovable(tableId: string){
  await openMenu(tableId);
  const disabledItems = await driver.findAll('.test-raw-data-menu-remove-table.disabled');
  await gu.sendKeys(Key.ESCAPE);
  return disabledItems.length === 0;
}

async function editRecordCard(tableId: string, wait = true) {
  await driver.findContent('.test-raw-data-table-title', tableId)
    .findClosest('.test-raw-data-table')
    .find('.test-raw-data-table-record-card')
    .click();
  if (wait) {
    await gu.waitForServer();
  }
}

async function disableRecordCard(tableId: string) {
  await openMenu(tableId);
  await driver.find('.test-raw-data-menu-disable-record-card').click();
  await gu.waitForServer();
}

async function enableRecordCard(tableId: string) {
  await openMenu(tableId);
  await driver.find('.test-raw-data-menu-enable-record-card').click();
  await gu.waitForServer();
}

async function isRecordCardEnabled(tableId: string) {
  const recordCard = await driver.findContent('.test-raw-data-table-title', tableId)
    .findClosest('.test-raw-data-table')
    .find('.test-raw-data-table-record-card');
  const isDisplayed = await recordCard.isDisplayed();
  const className = await recordCard.getAttribute('class');
  return isDisplayed && !className.includes('-disabled');
}

async function waitForPopup() {
  assert.isTrue(await driver.findWait('.test-raw-data-overlay', 100).isDisplayed());
}

async function assertNoPopup() {
  assert.isFalse(await driver.find('.test-raw-data-overlay').isPresent());
}

async function waitForAnchorPopup(link: string) {
  await driver.get(link);
  await gu.waitForAnchor();
  await waitForPopup();
}
