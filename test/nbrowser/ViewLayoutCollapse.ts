import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';
import {getCollapsedSection, openCollapsedSectionMenu} from 'test/nbrowser/ViewLayoutUtils';
import {assert, driver, Key, WebElement, WebElementPromise} from 'mocha-webdriver';
import {arrayRepeat} from 'app/plugin/gutil';
import {addStatic, serveSomething} from 'test/server/customUtil';
import {AccessLevel} from 'app/common/CustomWidget';

const GAP = 16;     // Distance between buttons representing collapsed widgets.

describe("ViewLayoutCollapse", function() {
  this.timeout('50s');
  const cleanup = setupTestSuite();
  gu.bigScreen();
  let session: gu.Session;

  before(async () => {
    session = await gu.session().login();
    await session.tempDoc(cleanup, 'Investment Research.grist');
    await gu.openPage("Overview");
  });

  it('fix: custom widget should restart when added back after collapsing', async function() {
    const revert = await gu.begin();

    // Add custom section.
    await gu.addNewPage('Table', 'Companies');
    await gu.addNewSection('Custom', 'Companies', { selectBy: 'COMPANIES'});

    // Serve custom widget.
    const widgetServer = await serveSomething(app => {
      addStatic(app);
    });
    cleanup.addAfterAll(widgetServer.shutdown);
    await gu.openWidgetPanel();
    await gu.setWidgetUrl(widgetServer.url + '/probe/index.html');
    await gu.widgetAccess(AccessLevel.full);

    // Collapse it.
    await collapseByMenu('COMPANIES Custom');

    // Now restore its position.
    await addToMainByMenu('COMPANIES Custom');

    // Collapsed widget used to lost connection with Grist as it was disposed to early.
    // Make sure that this widget can call the API.
    await gu.doInIframe(async () => {
      await gu.waitToPass(async () => {
        assert.equal(await driver.find('#output').getText(),
          `["Companies","Investments","Companies_summary_category_code","Investments_summary_funded_year",` +
          `"Investments_summary_Company_category_code_funded_year","Investments_summary_Company_category_code"]`
        );
      });
    });


    // Make sure we don't have an error.
    await gu.checkForErrors();
    await revert();
  });

  it('fix: custom widget should not throw errors when collapsed', async function() {
    const revert = await gu.begin();

    // Add custom section.
    await gu.addNewPage('Table', 'Companies');
    await gu.addNewSection('Custom', 'Companies', { selectBy: 'COMPANIES'});

    // Serve custom widget.
    const widgetServer = await serveSomething(app => {
      addStatic(app);
    });
    cleanup.addAfterAll(widgetServer.shutdown);
    await gu.openWidgetPanel();
    await gu.setWidgetUrl(widgetServer.url + '/probe/index.html');
    await gu.widgetAccess(AccessLevel.full);

    // Collapse it.
    await collapseByMenu('COMPANIES Custom');

    // Change cursor position in the active section.
    await gu.getCell(2, 4).click();

    // Put custom section in popup.
    await openCollapsedSection('COMPANIES Custom');

    // Close it by pressing escape.
    await gu.sendKeys(Key.ESCAPE);

    // Change cursor once again.
    await gu.getCell(2, 5).click();

    // Make sure we don't have an error (there was a bug here).
    await gu.checkForErrors();

    await revert();
  });

  it('fix: should resize other sections correctly when maximized and linked', async function() {
    const revert = await gu.begin();
    // If there are two sections linked, but one is collapsed, and user is changing the row
    // in the popup of the maximized section, the other section should resize correctly.

    // Add two linked tables.
    await gu.addNewTable('Table1');
    await gu.addNewSection('Table', 'New Table');

    await gu.toggleSidePanel('right', 'open');

    // Set A in Table2 to be linked in Table1, by ref column
    await gu.openColumnMenu('A', 'Column Options');

    // Change it to the Ref column of TABLE1
    await gu.setType('Reference');
    await gu.setRefTable('Table1');
    await gu.setRefShowColumn('A');

    // Select it by Table1.
    await gu.selectBy('TABLE1');

    // Now add 2 records with 'White' and 'Black' in Table1
    await gu.sendActions([
      ['BulkAddRecord', 'Table1', arrayRepeat(2, null), { A: ['White', 'Black'] }],
      // And 30 records in Table2 that are connected to White.
      ['BulkAddRecord', 'Table2', arrayRepeat(30, null), { A: arrayRepeat(30, 1) }],
      // And 30 records in Table2 that are connected to Black.
      ['BulkAddRecord', 'Table2', arrayRepeat(30, null), { A: arrayRepeat(30, 2) }],
    ]);

    // Now select White in Table1.
    await gu.getCell('A', 1, 'Table1').click();

    // Now expand Table1.
    await gu.expandSection();

    // Change to black.
    await gu.getCell('A', 2, 'Table1').click();

    // Close popup by sending ESCAPE
    await gu.sendKeys(Key.ESCAPE);

    // Make sure we see 30 records in Table2.
    const count = await driver.executeScript(`
      const section = Array.from(document.querySelectorAll('.test-widget-title-text'))
                           .find(e => e.textContent === 'TABLE2')
                           .closest('.viewsection_content');
      return Array.from(section.querySelectorAll('.gridview_data_row_num')).length;
    `);

    assert.equal(count, 30 + 1);

    await revert();
  });


  it('fix: should support searching', async function() {
    // Collapse Companies section (a first one).
    await collapseByMenu(COMPANIES);

    // Clear any saved position state.
    await driver.executeScript('window.sessionStorage.clear(); window.localStorage.clear();');

    // Refresh.
    await driver.navigate().refresh();
    await gu.waitForDocToLoad();

    // Here we had a bug that the hidden section was active, and the search was not working as it was
    // starting with the hidden section.

    // Now search (for something in the INVESTMENTS section)
    await gu.search('2006');
    await gu.closeSearch();

    // Make sure we don't have an error.
    await gu.checkForErrors();

    assert.equal(await gu.getActiveSectionTitle(), INVESTMENTS);
    // Make sure we are in 1column 9th row.
    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 9, col: 0});

    // Hide companies chart, and search for mobile (should show no results).
    await collapseByMenu(COMPANIES_CHART);
    await gu.search('mobile');
    await gu.hasNoResult();
    await gu.closeSearch();

    // Open companies in the popup.
    await openCollapsedSection(COMPANIES);
    // Search for 2006, there will be no results.
    await gu.search('2006');
    await gu.hasNoResult();
    // Now search for web.
    await gu.closeSearch();
    await gu.search('web');
    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 5, col: 0});

    // Recreate document (can't undo).
    await session.tempDoc(cleanup, 'Investment Research.grist');
  });


  it('fix: should not dispose the instance when drag is cancelled', async function() {
    const revert = await gu.begin();

    // Collapse a section.
    await collapseByMenu(INVESTMENTS);

    // Drag it and then cancel.
    await dragCollapsed(INVESTMENTS);
    const logo = driver.find('.test-dm-logo');
    await move(logo, {y:  0});
    await move(logo, {y:  -1});
    // Drop it here.
    await driver.withActions(actions => actions.release());

    // Now open it in the full view.
    await openCollapsedSection(INVESTMENTS);

    // And make sure we can move cursor.
    await gu.getCell(1, 1).click();
    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 1, col: 1});
    await gu.getCell(1, 2).click();
    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 2, col: 1});

    // Change its type, and check that it works.
    await gu.changeWidget('Card List');
    // Undo it.
    await gu.undo();
    await gu.getCell(1, 3).click();
    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 3, col: 1});

    await gu.sendKeys(Key.ESCAPE);

    // Move it back
    await dragCollapsed(INVESTMENTS);

    // Move back and drop.
    await gu.getSection(COMPANIES_CHART).getRect();
    await move(getDragElement(COMPANIES_CHART));
    await driver.sleep(100);
    await move(getDragElement(COMPANIES_CHART), {x : 200});
    await driver.sleep(300);
    assert.lengthOf(await driver.findAll(".layout_editor_drop_target.layout_hover"), 1);

    await driver.withActions(actions => actions.release());
    await driver.sleep(600);

    // And make sure we can move cursor.
    await gu.getCell(1, 1).click();
    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 1, col: 1});
    await gu.getCell(1, 2).click();
    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 2, col: 1});

    await waitForSave();
    await revert();
  });


  it('fix: should work when the page is refreshed', async function() {
    const revert = await gu.begin();

    await gu.openPage("Companies");
    await gu.selectSectionByTitle("Companies");
    // Go to second row.
    await gu.getCell(0, 2).click();

    // Make sure we see correct company card.
    assert.equal(await gu.getCardCell('name', 'COMPANIES Card').getText(), '#NAME?');

    // Hide first section.
    await collapseByMenu("Companies");
    await waitForSave();

    // Refresh the page.
    await driver.navigate().refresh();
    await gu.waitForDocToLoad();

    // Make sure card is still at the correct row.
    await gu.waitToPass(async () => {
      assert.equal(await gu.getCardCell('name', 'COMPANIES Card').getText(), '#NAME?');
    });

    await addToMainByMenu("Companies");
    await revert();
  });

  it('fix: should support anchor links', async function() {
    const revert = await gu.begin();

    // Open 42Floors in Companies section.
    assert.equal(await gu.getActiveSectionTitle(), "COMPANIES");
    await gu.getCell('Link', 11).click();
    assert.equal(await gu.getActiveCell().getText(), '42Floors');

    // Open 12 row (Alex Bresler, angel).
    await gu.getCell('funding_round_type', 12, 'Investments').click();
    assert.equal(await gu.getActiveCell().getText(), 'angel');

    // Copy anchor link.
    const link = await gu.getAnchor();

    // Collapse first section.
    await collapseByMenu("COMPANIES");

    // Clear any saved position state.
    await driver.executeScript('window.sessionStorage.clear(); window.localStorage.clear();');

    // Navigate to the home screen.
    await gu.loadDocMenu('/o/docs');

    // Now go to the anchor.
    await driver.get(link);
    await gu.waitForAnchor();

    const cursor = await gu.getCursorPosition();
    assert.equal(cursor.rowNum, 12);
    assert.equal(cursor.col, 1);
    assert.equal(await gu.getActiveCell().getText(), 'angel');
    assert.equal(await gu.getActiveSectionTitle(), 'INVESTMENTS');
    assert.match(await driver.getCurrentUrl(), /\/o\/docs\/[^/]+\/Investment-Research\/p\/1$/);
    await revert();
  });

  it("should not autoexpand the tray on a page with a single widget", async () => {
    await gu.openPage("Investments");
    assert.equal((await driver.findAll(".viewsection_content")).length, 1);

    // Start drag the main section.
    await dragMain("INVESTMENTS");

    // Move it over the logo, so that the tray thinks that it should expand.
    const logo = driver.find('.test-dm-logo');
    await move(logo, {y:  0});
    await move(logo, {y:  -1});
    await driver.sleep(100);

    // Make sure the tray was not tricked into expanding itself.
    assert.isFalse(await layoutTray().isDisplayed());
    assert.lengthOf(await layoutTray().findAll(".test-layoutTray-empty-box"), 0); // No empty box

    // Drop it on the button, it should go back to where it was.
    await driver.withActions(actions => actions.release());
  });

  it("should autoexpand the tray", async () => {
    await gu.openPage("Overview");

    // Get one of the sections and start dragging it.
    await dragMain(COMPANIES_CHART);

    // The tray should not be expanded.
    assert.isFalse(await layoutTray().isDisplayed());

    const logo = driver.find('.test-dm-logo');
    // Now move it to the top, so that tray should be expanded.
    await move(logo, {y:  0});
    await driver.sleep(100);

    // Now the tray is visible
    assert.isTrue(await layoutTray().isDisplayed());
    assert.lengthOf(await layoutTray().findAll(".test-layoutTray-empty-box"), 1); // One empty box
    assert.isTrue(await layoutEditor().matches('[class*=-is-active]')); // Is active
    assert.isFalse(await layoutEditor().matches('[class*=-is-target]')); // Is not a target

    // Drop it on the button, it should go back to where it was.
    await driver.withActions(actions => actions.release());

    // The tray should not be expanded.
    assert.isFalse(await layoutTray().isDisplayed());

    await gu.checkForErrors();
  });

  it("should drag onto main area", async () => {
    const revert = await gu.begin();
    await collapseByMenu(COMPANIES);
    await collapseByMenu(INVESTMENTS);

    await dragCollapsed(COMPANIES);
    const chartCords = await gu.getSection(COMPANIES_CHART).getRect();
    await move(getDragElement(COMPANIES_CHART));
    await driver.sleep(100);
    await move(getDragElement(COMPANIES_CHART), {x : 10});
    await driver.sleep(300);

    // We should have a drop target.
    const dropTarget = await driver.find(".layout_editor_drop_target.layout_hover");
    const dCords = await dropTarget.getRect();
    // It should be more or less on the left of the chart.
    assertDistance(dCords.x, chartCords.x, 20);
    assertDistance(dCords.y, chartCords.y, 20);

    // Move away from the drop target.
    const addButton = driver.find('.test-dp-add-new');
    await move(addButton);
    await driver.sleep(300);

    // Drop target should be gone.
    assert.lengthOf(await driver.findAll(".layout_editor_drop_target.layout_hover"), 0);

    // Move back and drop.
    await move(getDragElement(COMPANIES_CHART));
    await driver.sleep(100);
    // Split the movement into two parts, to make sure layout sees the mouse move.
    await move(getDragElement(COMPANIES_CHART), {x : 10});
    await driver.sleep(200);
    assert.lengthOf(await driver.findAll(".layout_editor_drop_target.layout_hover"), 1);
    await driver.withActions(actions => actions.release());
    await driver.sleep(600); // This animation can be longer.

    // Make sure it was dropped.
    assert.lengthOf(await layoutTray().findAll(".test-layoutTray-leaf-box"), 1); // Only one collapsed box.
    assert.lengthOf(await layoutTray().findAll(".test-layoutTray-empty-box"), 0); // No empty box.
    assert.lengthOf(await layoutTray().findAll(".test-layoutTray-target-box"), 0); // No target box.
    assert.deepEqual(await collapsedSectionTitles(), [INVESTMENTS]); // Only investments is collapsed.
    assert.deepEqual(await mainSectionTitles(), [COMPANIES, COMPANIES_CHART, INVESTMENTS_CHART]);
    // Check that it was dropped on the left top side.
    const companiesCords = await gu.getSection(COMPANIES).getRect();
    assertDistance(companiesCords.x, chartCords.x, 20);
    assertDistance(companiesCords.y, chartCords.y, 20);
    // It should be half as tall as the main layout.
    const root = await driver.find(".layout_root").getRect();
    assertDistance(companiesCords.height, root.height / 2, 30);
    // And almost half as wide.
    assertDistance(companiesCords.width, root.width / 2, 30);

    // Now move it back to the tray. But first collapse another section (so we can test inbetween target).
    await collapseByMenu(COMPANIES_CHART);
    await dragMain(COMPANIES);

    // Try to move it as the first element.
    const firstLeafSize = await firstLeaf().getRect();
    await move(firstLeaf(), { x: -firstLeafSize.width / 2 });
    await driver.sleep(300);
    assert.lengthOf(await layoutTray().findAll(".test-layoutTray-target-box"), 1);
    // Make sure that the target is in right place.
    let target = await layoutTray().find(".test-layoutTray-target-box").getRect();
    assertDistance(target.x, firstLeafSize.x, 10);

    // Now as the second element.
    await move(firstLeaf(), { x: firstLeafSize.width / 2 + GAP });
    await driver.sleep(300);
    assert.lengthOf(await layoutTray().findAll(".test-layoutTray-target-box"), 1);
    target = await layoutTray().find(".test-layoutTray-target-box").getRect();
    assertDistance(target.x, firstLeafSize.x + firstLeafSize.width + GAP, 10);

    // Move away to make sure the target is gone.
    await move(addButton);
    await driver.sleep(300);
    assert.lengthOf(await layoutTray().findAll(".test-layoutTray-target-box"), 0);

    // Move back and drop.
    await move(firstLeaf(), { x: firstLeafSize.width / 2 + GAP });
    await driver.sleep(300);
    await driver.withActions(actions => actions.release());
    await driver.sleep(600);

    // Make sure it was dropped.
    assert.lengthOf(await layoutTray().findAll(".test-layoutTray-leaf-box"), 3);
    assert.lengthOf(await layoutTray().findAll(".test-layoutTray-empty-box"), 0);
    assert.lengthOf(await layoutTray().findAll(".test-layoutTray-target-box"), 0);

    assert.deepEqual(await collapsedSectionTitles(), [INVESTMENTS, COMPANIES, COMPANIES_CHART]);
    assert.deepEqual(await mainSectionTitles(), [INVESTMENTS_CHART]);

    await waitForSave(); // Layout save is debounced 1s.

    // Test couple of undo steps.
    await gu.undo();
    assert.deepEqual(await collapsedSectionTitles(), [INVESTMENTS, COMPANIES_CHART]);
    assert.deepEqual(await mainSectionTitles(), [COMPANIES, INVESTMENTS_CHART]);

    await gu.undo();
    assert.deepEqual(await collapsedSectionTitles(), [INVESTMENTS]);
    assert.deepEqual(await mainSectionTitles(), [COMPANIES, COMPANIES_CHART, INVESTMENTS_CHART]);

    await gu.undo();
    assert.deepEqual(await collapsedSectionTitles(), [COMPANIES, INVESTMENTS]);
    assert.deepEqual(await mainSectionTitles(), [COMPANIES_CHART, INVESTMENTS_CHART]);

    await gu.undo();
    assert.deepEqual(await collapsedSectionTitles(), [COMPANIES]);
    assert.deepEqual(await mainSectionTitles(), [COMPANIES_CHART, INVESTMENTS_CHART, INVESTMENTS]);

    await gu.redo();
    assert.deepEqual(await collapsedSectionTitles(), [COMPANIES, INVESTMENTS]);
    assert.deepEqual(await mainSectionTitles(), [COMPANIES_CHART, INVESTMENTS_CHART]);

    await revert();
    assert.deepEqual(await collapsedSectionTitles(), []);
    assert.deepEqual(await mainSectionTitles(), [COMPANIES_CHART, COMPANIES, INVESTMENTS_CHART, INVESTMENTS]);
    await gu.checkForErrors();
  });

  it("should reorder collapsed sections", async () => {
    const revert = await gu.begin();
    await collapseByMenu(COMPANIES);
    await collapseByMenu(INVESTMENTS);
    await collapseByMenu(COMPANIES_CHART);

    await dragCollapsed(COMPANIES);

    // We should see the empty box in the layout.
    assert.lengthOf(await layoutTray().findAll(".test-layoutTray-empty-box"), 1);
    // The section is actually removed from the layout tray.
    assert.lengthOf(await layoutTray().findAll(".test-layoutTray-leaf-box"), 2);
    assert.deepEqual(await collapsedSectionTitles(), [INVESTMENTS, COMPANIES_CHART]);

    // Layout should be active and accepting.
    assert.isTrue(await layoutEditor().matches('[class*=-is-active]'));
    assert.isTrue(await layoutEditor().matches('[class*=-is-target]'));

    // Move mouse somewhere else, layout should not by highlighted.
    const addButton = driver.find('.test-dp-add-new');
    await move(addButton);
    assert.isTrue(await layoutEditor().matches('[class*=-is-active]'));
    assert.isFalse(await layoutEditor().matches('[class*=-is-target]'));

    // Move to the first leaf, and wait for the target to show up.
    const first = await firstLeaf().getRect();
    await move(firstLeaf(), {x : -first.width / 2});
    await driver.sleep(300);
    assert.lengthOf(await layoutTray().findAll(".test-layoutTray-target-box"), 1);
    // Make sure that the target is in right place.
    let target = await layoutTray().find(".test-layoutTray-target-box").getRect();
    assert.isBelow(Math.abs(target.x - first.x), 10);
    assert.isBelow(Math.abs(target.y - first.y), 10);
    assert.isBelow(Math.abs(target.height - first.height), 10);

    // Move away and make sure the target is gone.
    await move(addButton);
    await driver.sleep(300);
    assert.lengthOf(await layoutTray().findAll(".test-layoutTray-target-box"), 0);

    // Move between first and second leaf.
    await move(firstLeaf(), {x : first.width / 2 + GAP});
    await driver.sleep(300);
    assert.lengthOf(await layoutTray().findAll(".test-layoutTray-target-box"), 1);
    target = await layoutTray().find(".test-layoutTray-target-box").getRect();
    assert.isBelow(Math.abs(target.height - first.height), 2);
    assert.isBelow(Math.abs(target.y - first.y), 2);
    // Should be between first and second leaf.
    assert.isBelow(Math.abs(target.x - (first.x + first.width + GAP)), 10);

    // Drop here.
    await driver.withActions(actions => actions.release());
    await waitForSave(); // Wait for layout to be saved.
    // Target is gone.
    assert.lengthOf(await layoutTray().findAll(".test-layoutTray-empty-box"), 0);
    // And we have 3 sections in the layout.
    assert.lengthOf(await layoutTray().findAll(".test-layoutTray-leaf-box"), 3);
    assert.deepEqual(await collapsedSectionTitles(), [INVESTMENTS, COMPANIES, COMPANIES_CHART]);

    // Undo.
    await gu.undo();
    // Order should be restored.
    assert.deepEqual(await collapsedSectionTitles(), [COMPANIES, INVESTMENTS, COMPANIES_CHART]);

    await revert();
    await gu.checkForErrors();
  });

  it("should collapse sections and expand using menu", async () => {
    await collapseByMenu(COMPANIES_CHART);
    await gu.checkForErrors();

    assert.deepEqual(await collapsedSectionTitles(), [COMPANIES_CHART]);
    // Make sure that other sections are not collapsed.
    assert.deepEqual(await mainSectionTitles(), [COMPANIES, INVESTMENTS_CHART, INVESTMENTS]);

    await collapseByMenu(INVESTMENTS_CHART);
    assert.deepEqual(await collapsedSectionTitles(), [COMPANIES_CHART, INVESTMENTS_CHART]);
    assert.deepEqual(await mainSectionTitles(), [COMPANIES, INVESTMENTS]);

    await collapseByMenu(COMPANIES);
    assert.deepEqual(await collapsedSectionTitles(), [COMPANIES_CHART, INVESTMENTS_CHART, COMPANIES]);
    assert.deepEqual(await mainSectionTitles(), [INVESTMENTS]);

    // The last section is INVESTMENTS, which can't be collapsed.
    await gu.openSectionMenu('viewLayout', INVESTMENTS);
    assert.equal(await driver.find('.test-section-collapse').matches('[class*=disabled]'), true);
    await driver.sendKeys(Key.ESCAPE);

    // Now expand them one by one and test.
    await addToMainByMenu(COMPANIES_CHART);
    await gu.checkForErrors();

    assert.deepEqual(await collapsedSectionTitles(), [INVESTMENTS_CHART, COMPANIES]);
    assert.deepEqual(await mainSectionTitles(), [INVESTMENTS, COMPANIES_CHART]);

    await addToMainByMenu(INVESTMENTS_CHART);
    assert.deepEqual(await collapsedSectionTitles(), [COMPANIES]);
    assert.deepEqual(await mainSectionTitles(), [INVESTMENTS, COMPANIES_CHART, INVESTMENTS_CHART]);
    await gu.checkForErrors();

    await addToMainByMenu(COMPANIES);
    assert.deepEqual(await collapsedSectionTitles(), []);
    assert.deepEqual(await mainSectionTitles(), [INVESTMENTS, COMPANIES_CHART, INVESTMENTS_CHART, COMPANIES]);
    await gu.checkForErrors();

    // Now revert everything using undo but test each step.
    await gu.undo();
    assert.deepEqual(await collapsedSectionTitles(), [COMPANIES]);
    assert.deepEqual(await mainSectionTitles(), [INVESTMENTS, COMPANIES_CHART, INVESTMENTS_CHART]);
    await gu.checkForErrors();

    await gu.undo();
    assert.deepEqual(await collapsedSectionTitles(), [INVESTMENTS_CHART, COMPANIES]);
    assert.deepEqual(await mainSectionTitles(), [INVESTMENTS, COMPANIES_CHART]);
    await gu.checkForErrors();

    await gu.undo();
    assert.deepEqual(await collapsedSectionTitles(), [COMPANIES_CHART, INVESTMENTS_CHART, COMPANIES]);
    assert.deepEqual(await mainSectionTitles(), [INVESTMENTS]);
    await gu.checkForErrors();

    await gu.undo();
    assert.deepEqual(await collapsedSectionTitles(), [COMPANIES_CHART, INVESTMENTS_CHART]);
    assert.deepEqual(await mainSectionTitles(), [COMPANIES, INVESTMENTS]);
    await gu.checkForErrors();

    await gu.undo();
    assert.deepEqual(await collapsedSectionTitles(), [COMPANIES_CHART]);
    assert.deepEqual(await mainSectionTitles(), [COMPANIES, INVESTMENTS_CHART, INVESTMENTS]);
    await gu.checkForErrors();

    await gu.undo();
    assert.deepEqual(await collapsedSectionTitles(), []);
    assert.deepEqual(await mainSectionTitles(), [COMPANIES_CHART, COMPANIES, INVESTMENTS_CHART, INVESTMENTS]);
    await gu.checkForErrors();
  });

  it("should remove sections from collapsed tray", async () => {
    const revert = await gu.begin();
    // Collapse everything we can.
    await collapseByMenu(COMPANIES_CHART);
    await collapseByMenu(INVESTMENTS_CHART);
    await collapseByMenu(COMPANIES);
    assert.deepEqual(await mainSectionTitles(), [INVESTMENTS]);

    // Now remove them using menu.
    await removeMiniSection(COMPANIES_CHART);
    await gu.checkForErrors();

    // Check that the section is removed from the collapsed tray.
    assert.deepEqual(await collapsedSectionTitles(), [INVESTMENTS_CHART, COMPANIES]);
    // Make sure it is stays removed when we move to the other page.
    await gu.openPage("Investments");
    // Go back.
    await gu.openPage("Overview");
    await gu.checkForErrors();

    // Test if we see everything as it was.
    assert.deepEqual(await collapsedSectionTitles(), [INVESTMENTS_CHART, COMPANIES]);
    // Make sure that visible sections are not affected.
    assert.deepEqual(await mainSectionTitles(), [INVESTMENTS]);

    // Remove the other sections.
    await removeMiniSection(INVESTMENTS_CHART);
    await removeMiniSection(COMPANIES);
    assert.deepEqual(await collapsedSectionTitles(), []);
    assert.deepEqual(await mainSectionTitles(), [INVESTMENTS]);

    // Now revert everything using undo but test each step.
    await gu.undo();
    assert.deepEqual(await collapsedSectionTitles(), [COMPANIES]);
    assert.deepEqual(await mainSectionTitles(), [INVESTMENTS]);

    await gu.undo();
    assert.deepEqual(await collapsedSectionTitles(), [INVESTMENTS_CHART, COMPANIES]);
    assert.deepEqual(await mainSectionTitles(), [INVESTMENTS]);

    await gu.undo();
    assert.deepEqual(await collapsedSectionTitles(), [COMPANIES_CHART, INVESTMENTS_CHART, COMPANIES]);
    assert.deepEqual(await mainSectionTitles(), [INVESTMENTS]);

    await gu.undo();
    assert.deepEqual(await collapsedSectionTitles(), [COMPANIES_CHART, INVESTMENTS_CHART]);
    assert.deepEqual(await mainSectionTitles(), [COMPANIES, INVESTMENTS]);

    // Ok, we are good, revert back to the original state.
    await revert();
    await gu.checkForErrors();
  });

  it("should switch active section when collapsed", async () => {
    const revert = await gu.begin();
    await gu.selectSectionByTitle(gu.exactMatch(COMPANIES));
    // Make sure we are active.
    assert.equal(await gu.getActiveSectionTitle(), COMPANIES);
    // Collapse it.
    await collapseByMenu(COMPANIES);
    // Make sure it is collapsed.
    assert.deepEqual(await collapsedSectionTitles(), [COMPANIES]);
    // Make sure that now COMPANIES_CHART is active. (first one).
    assert.equal(await gu.getActiveSectionTitle(), COMPANIES_CHART);
    // Expand COMPANIES.
    await addToMainByMenu(COMPANIES);
    // Make sure that now it is active.
    assert.equal(await gu.getActiveSectionTitle(), COMPANIES);
    await revert();
    await gu.checkForErrors();
  });

  it("should show section on popup when clicked", async () => {
    const revert = await gu.begin();
    await collapseByMenu(COMPANIES);
    await openCollapsedSection(COMPANIES);
    // Make sure it is expanded.
    assert.isTrue(await driver.find(".test-viewLayout-overlay").matches("[class*=-active]"));
    assert.equal(await gu.getActiveSectionTitle(), COMPANIES);
    // Make sure that the panel shows it.
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-config-widget').click();
    assert.equal(await driver.find('.test-right-widget-title').value(), COMPANIES);
    // Make sure we see proper items in the menu.
    await gu.openSectionMenu('viewLayout', COMPANIES);
    // Collapse widget menu item is disabled.
    assert.equal(await driver.find('.test-section-collapse').matches('[class*=disabled]'), true);
    // Delete widget is enabled.
    assert.equal(await driver.find('.test-section-delete').matches('[class*=disabled]'), false);
    await driver.sendKeys(Key.ESCAPE);
    // Expand button is not visible
    assert.lengthOf(await driver.findAll(".active_section .test-section-menu-expandSection"), 0);
    // We can rename a section using the popup.
    await gu.renameActiveSection("New name");
    assert.equal(await gu.getActiveSectionTitle(), "New name");
    // Make sure the name is reflected in the collapsed tray.
    await gu.sendKeys(Key.ESCAPE);
    assert.deepEqual(await collapsedSectionTitles(), ["New name"]);
    // Open it back.
    await openCollapsedSection("New name");
    // Rename it back using undo.
    await gu.undo();
    assert.equal(await gu.getActiveSectionTitle(), COMPANIES);
    // Now remove it.
    await gu.openSectionMenu('viewLayout', COMPANIES);
    await driver.find('.test-section-delete').click();
    await gu.waitForServer();
    // Make sure it is closed.
    assert.isFalse(await driver.find(".test-viewLayout-overlay").matches("[class*=-active]"));
    // Make sure it is removed.
    assert.deepEqual(await collapsedSectionTitles(), []);
    // Make sure it didn't reappear on the main area.
    assert.deepEqual(await mainSectionTitles(), [COMPANIES_CHART, INVESTMENTS_CHART, INVESTMENTS]);

    await revert();
    await gu.checkForErrors();
  });

  it("should collapse and expand charts without an error", async () => {
    const revert = await gu.begin();
    await collapseByMenu(INVESTMENTS);
    await dragMain(COMPANIES_CHART);
    const firstRect = await firstLeaf().getRect();
    await move(firstLeaf(), { x: firstRect.width / 2 + GAP });
    await driver.sleep(300);
    await driver.withActions(actions => actions.release());
    await waitForSave(); // Resize is delayed.
    await gu.checkForErrors();
    await revert();
  });

  it("should drop on the empty space", async () => {
    const revert = await gu.begin();
    // Get one of the sections and start dragging it.
    await dragMain(COMPANIES_CHART);
    // Move it over the logo to show the tray.
    const logo = driver.find('.test-dm-logo');
    await move(logo, {y:  0});
    await move(logo, {y:  -20});
    await driver.sleep(100);
    // Now the tray is visible
    assert.isTrue(await layoutTray().isDisplayed());
    // Move it on the empty space just after the empty box
    const emptyBox = await layoutTray().find(".test-layoutTray-empty-box");
    const emptyBoxCords = await emptyBox.getRect();
    await move(emptyBox, {x: emptyBoxCords.width + 100 });
    // Make sure that the empty box is not active.
    assert.isFalse(await emptyBox.matches('[class*=-is-active]'));
    // Drop it here
    await driver.withActions(actions => actions.release());
    await driver.sleep(600); // Wait for animation to finish.
    await waitForSave();
    // The tray should stay expanded.
    assert.isTrue(await layoutTray().isDisplayed());

    // Check that the section was collapsed.
    assert.deepEqual(await collapsedSectionTitles(), [COMPANIES_CHART]);
    // And other sections are still there.
    assert.deepEqual(await mainSectionTitles(), [COMPANIES, INVESTMENTS_CHART, INVESTMENTS]);
    await gu.checkForErrors();
    await revert();
    await gu.checkForErrors();
  });

  it("should clear layout when dropped section is removed", async () => {
    await session.tempNewDoc(cleanup, 'CollapsedBug.grist');
    // Add a new section based on current table.
    await gu.addNewSection('Table', 'Table1');
    // It will have id 3 (1 is raw, 2 is visible).
    // Collapse it.
    await gu.renameActiveSection('ToDelete');
    await collapseByMenu('ToDelete');
    // Remove it from the tray.
    await openCollapsedSectionMenu('ToDelete');
    await driver.find('.test-section-delete').click();
    await gu.waitForServer();
    await waitForSave();
    // Now add another one, it will have the same id (3) and it used to be collapsed when added
    // as the layout was not cleared.
    await gu.addNewSection('Table', 'Table1');
    // Make sure it is expanded.
    assert.deepEqual(await mainSectionTitles(), ['TABLE1', 'TABLE1']);
    assert.deepEqual(await collapsedSectionTitles(), []);
  });
});

async function addToMainByMenu(section: string) {
  await openCollapsedSectionMenu(section);
  await driver.find('.test-section-expand').click();
  await gu.waitForServer();
  await gu.checkForErrors();
}

async function dragCollapsed(section: string) {
  const handle = getCollapsedSection(section).find('.draggable-handle');
  await driver.withActions((actions) => actions
    .move({origin: handle})
    .press());
  await move(handle, {x : 10, y: 10});
  return handle;
}

async function dragMain(section: string) {
  const handle = gu.getSection(section).find('.viewsection_drag_indicator');
  await driver.withActions((actions) => actions
    .move({origin: handle}));
  await driver.withActions((actions) => actions
    .move({origin: handle, x : 1}) // This is needed to show the drag element.
    .press());
  await move(handle, {x : 10, y: 10});
  return handle;
}

async function openCollapsedSection(section: string) {
  await getCollapsedSection(section).find('.draggable-handle').click();
}

async function removeMiniSection(section: string) {
  await openCollapsedSectionMenu(section);
  await driver.find('.test-section-delete').click();
  await gu.waitForServer();
  await gu.checkForErrors();
}

async function collapseByMenu(section: string) {
  await gu.openSectionMenu('viewLayout', section);
  await driver.find('.test-section-collapse').click();
  await gu.waitForServer();
  await gu.checkForErrors();
}

// Returns the titles of all collapsed sections.
async function collapsedSectionTitles() {
  return await layoutTray().findAll('.test-layoutTray-leaf-box .test-collapsed-section-title', e => e.getText());
}

// Returns titles of all sections in the view layout.
async function mainSectionTitles() {
  return await driver.findAll('.layout_root .test-viewsection-title', e => e.getText());
}

async function move(element: WebElementPromise|WebElement, offset: {x?: number, y?: number} = {x: 0, y: 0}) {
  // With current version of webdriver, a fractional values will get ignored, so round to nearest.
  if (offset.x) { offset.x = Math.round(offset.x); }
  if (offset.y) { offset.y = Math.round(offset.y); }
  await driver.withActions(actions => actions.move({origin: element, ...offset}));
}


function getDragElement(section: string) {
  return gu.getSection(section).find('.viewsection_drag_indicator');
}

function layoutTray() {
  return driver.find(".test-layoutTray-layout");
}

function firstLeaf() {
  return layoutTray().find(".test-layoutTray-leaf-box");
}

function layoutEditor() {
  return driver.find(".test-layoutTray-editor");
}

const COMPANIES_CHART = 'COMPANIES [by category_code] Chart';
const INVESTMENTS_CHART = 'INVESTMENTS [by funded_year] Chart';
const COMPANIES = 'COMPANIES [by category_code]';
const INVESTMENTS = 'INVESTMENTS [by funded_year]';

function assertDistance(left: number, right: number, max: number) {
  return assert.isBelow(Math.abs(left - right), max);
}

async function waitForSave() {
  await gu.waitToPass(async () => {
    const pending = await driver.findAll(".test-viewLayout-save-pending");
    assert.isTrue(pending.length === 0);
    await gu.waitForServer();
  }, 3000);
}
