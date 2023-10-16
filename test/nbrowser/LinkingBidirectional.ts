import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';
import {assert, driver, Key} from 'mocha-webdriver';

describe('LinkingBidirectional', function() {
  this.timeout('60s');

  const cleanup = setupTestSuite({team: true});
  let session: gu.Session;

  afterEach(() => gu.checkForErrors());

  before(async function() {
    session = await gu.session().login();
    await session.tempDoc(cleanup, 'Class Enrollment.grist');
  });

  it('should update cursor when sections cursor-linked together', async function() {
    // Setup new page with "Classes1"
    await gu.addNewPage('Table', 'Classes', {});
    await gu.renameActiveSection('Classes1');

    // Set its cursor to row 2
    await gu.getCell('Semester', 2, 'Classes1').click();

    // Add Classes2 & 3
    await gu.addNewSection('Table', 'Classes', { selectBy: 'Classes1' });
    await gu.renameActiveSection('Classes2');
    await gu.addNewSection('Table', 'Classes', { selectBy: 'Classes2' });
    await gu.renameActiveSection('Classes3');

    // Make sure that linking put them all on row 2
    assert.deepEqual(await getCursorAndArrow('Classes1'), {arrow: null, cursor: {rowNum: 2, col: 0}});
    assert.deepEqual(await getCursorAndArrow('Classes2'), {arrow: 2,    cursor: {rowNum: 2, col: 0}});
    assert.deepEqual(await getCursorAndArrow('Classes3'), {arrow: 2,    cursor: {rowNum: 2, col: 0}});
  });

  it('should propagate cursor-links downstream', async function() {
    // Cursor link from upstream should drive a given section, but we can still move the downstream cursor
    // To other positions. The downstream linking should use whichever of its ancestors was most recently clicked

    // Set cursors: Sec1 on row 1, Sec2 on row 2
    await gu.getCell('Semester', 1, 'Classes1').click();
    await gu.getCell('Semester', 2, 'Classes2').click();

    // Sec1 should be on row 1. Sec2 should be on 2 even though link is telling it to be on 1. Sec3 should be on 2
    assert.deepEqual(await getCursorAndArrow('Classes1'), {arrow: null, cursor: {rowNum: 1, col: 0}});
    assert.deepEqual(await getCursorAndArrow('Classes2'), {arrow: 1,    cursor: {rowNum: 2, col: 0}});
    assert.deepEqual(await getCursorAndArrow('Classes3'), {arrow: 2,    cursor: {rowNum: 2, col: 0}});

    // click on Sec3 row 3
    await gu.getCell('Semester', 3, 'Classes3').click();

    // Cursors should be on 1, 2, 3, with arrows lagging 1 step behind
    assert.deepEqual(await getCursorAndArrow('Classes1'), {arrow: null, cursor: {rowNum: 1, col: 0}});
    assert.deepEqual(await getCursorAndArrow('Classes2'), {arrow: 1,    cursor: {rowNum: 2, col: 0}});
    assert.deepEqual(await getCursorAndArrow('Classes3'), {arrow: 2,    cursor: {rowNum: 3, col: 0}});

    // When clicking on oldest ancestor, it should now take priority over all downstream cursors again
    // Click on S1 row 4
    await gu.getCell('Semester', 4, 'Classes1').click();
    // assert that all are on 4
    assert.deepEqual(await getCursorAndArrow('Classes1'), {arrow: null, cursor: {rowNum: 4, col: 0}});
    assert.deepEqual(await getCursorAndArrow('Classes2'), {arrow: 4,    cursor: {rowNum: 4, col: 0}});
    assert.deepEqual(await getCursorAndArrow('Classes3'), {arrow: 4,    cursor: {rowNum: 4, col: 0}});
  });

  it('should work correctly when linked into a cycle', async function() {
    // Link them all into a cycle.
    await gu.selectBy('Classes3');

    // Now, any section should drive all the other sections

    // Click on row 1 in Sec1
    await gu.getCell('Semester', 1, 'Classes1').click();
    assert.deepEqual(await getCursorAndArrow('Classes1'), {arrow: 1,   cursor: {rowNum: 1, col: 0}});
    assert.deepEqual(await getCursorAndArrow('Classes2'), {arrow: 1,   cursor: {rowNum: 1, col: 0}});
    assert.deepEqual(await getCursorAndArrow('Classes3'), {arrow: 1,   cursor: {rowNum: 1, col: 0}});

    // Click on row 2 in Sec2
    await gu.getCell('Semester', 2, 'Classes2').click();
    assert.deepEqual(await getCursorAndArrow('Classes1'), {arrow: 2,   cursor: {rowNum: 2, col: 0}});
    assert.deepEqual(await getCursorAndArrow('Classes2'), {arrow: 2,   cursor: {rowNum: 2, col: 0}});
    assert.deepEqual(await getCursorAndArrow('Classes3'), {arrow: 2,   cursor: {rowNum: 2, col: 0}});

    // Click on row 3 in Sec3
    await gu.getCell('Semester', 3, 'Classes3').click();
    assert.deepEqual(await getCursorAndArrow('Classes1'), {arrow: 3,   cursor: {rowNum: 3, col: 0}});
    assert.deepEqual(await getCursorAndArrow('Classes2'), {arrow: 3,   cursor: {rowNum: 3, col: 0}});
    assert.deepEqual(await getCursorAndArrow('Classes3'), {arrow: 3,   cursor: {rowNum: 3, col: 0}});
  });

  it('should keep position after refresh', async function() {
    // Nothing should change after a refresh
    await gu.reloadDoc();

    assert.deepEqual(await getCursorAndArrow('Classes1'), {arrow: 3,    cursor: {rowNum: 3, col: 0}});
    assert.deepEqual(await getCursorAndArrow('Classes2'), {arrow: 3,    cursor: {rowNum: 3, col: 0}});
    assert.deepEqual(await getCursorAndArrow('Classes3'), {arrow: 3,    cursor: {rowNum: 3, col: 0}});
  });

  it('should update linking when filters change', async function() {
    // Let's filter out the current row ("Spring 2019") from Classes2
    await gu.selectSectionByTitle('Classes2');
    await gu.sortAndFilter()
      .then(x => x.addColumn())
      .then(x => x.clickColumn('Semester'))
      .then(x => x.close())
      .then(x => x.click());

    // Open the pinned filter, and filter out the date.
    await gu.openPinnedFilter('Semester')
      .then(x => x.toggleValue('Spring 2019'))
      .then(x => x.close());

    // Classes2 got its cursor moved when we filtered out its current row, so all sections should now
    // have moved to row 1
    assert.deepEqual(await getCursorAndArrow('Classes1'), {arrow: 1,   cursor: {rowNum: 1, col: 0}});
    assert.deepEqual(await getCursorAndArrow('Classes2'), {arrow: 1,   cursor: {rowNum: 1, col: 0}});
    assert.deepEqual(await getCursorAndArrow('Classes3'), {arrow: 1,   cursor: {rowNum: 1, col: 0}});
  });

  it('should propagate cursor linking even through a filtered-out section', async function() {
    // Row 3 (from Classes1 and Classes3) is no longer present in Classes2
    // Make sure it can still get the value through the link from Classes1 -> 2 -> 3

    // Click on row 3 in Sec1
    await gu.getCell('Semester', 3, 'Classes1').click();

    // Classes1 and 3 should be on row3
    // Classes2 should still be on row 1 (from the last test case), and should have no arrow (since it's desynced)
    assert.deepEqual(await getCursorAndArrow('Classes1'), {arrow: 3,    cursor: {rowNum: 3, col: 0}});
    assert.deepEqual(await getCursorAndArrow('Classes2'), {arrow: null, cursor: {rowNum: 1, col: 0}});
    assert.deepEqual(await getCursorAndArrow('Classes3'), {arrow: 3,    cursor: {rowNum: 3, col: 0}});
  });

  it('should keep position after refresh when section is filtered out', async function() {
    // Save the filter in Classes2
    await gu.selectSectionByTitle('Classes2');
    await gu.sortAndFilter()
      .then(x => x.save());

    // Go to Classes1, and refresh (its curser will be restored).
    await gu.selectSectionByTitle('Classes1');
    await gu.reloadDoc();

    // Nothing should change after a refresh
    assert.deepEqual(await getCursorAndArrow('Classes1'), {arrow: 3,    cursor: {rowNum: 3, col: 0}});
    assert.deepEqual(await getCursorAndArrow('Classes2'), {arrow: null, cursor: {rowNum: 1, col: 0}});
    assert.deepEqual(await getCursorAndArrow('Classes3'), {arrow: 3,    cursor: {rowNum: 3, col: 0}});
  });

  it('should navigate to correct cells and sections', async function() {
    await gu.getCell('Semester', 3, 'Classes1').click();
    const anchor = await gu.getAnchor();
    await gu.wipeToasts();

    await gu.onNewTab(async () => {
      await driver.get(anchor);
      await gu.waitForDocToLoad();

      assert.deepEqual(await getCursorAndArrow('Classes1'), {arrow: 3,    cursor: {rowNum: 3, col: 0}});
      assert.deepEqual(await getCursorAndArrow('Classes2'), {arrow: null, cursor: {rowNum: 1, col: 0}});
      assert.deepEqual(await getCursorAndArrow('Classes3'), {arrow: 3,    cursor: {rowNum: 3, col: 0}});
    });

    await gu.getCell('Semester', 3, 'Classes3').click();
    const anchor2 = await gu.getAnchor();
    await gu.wipeToasts();

    await gu.onNewTab(async () => {
      await driver.get(anchor2);
      await gu.waitForDocToLoad();

      assert.deepEqual(await getCursorAndArrow('Classes1'), {arrow: 3,    cursor: {rowNum: 3, col: 0}});
      assert.deepEqual(await getCursorAndArrow('Classes2'), {arrow: null, cursor: {rowNum: 1, col: 0}});
      assert.deepEqual(await getCursorAndArrow('Classes3'), {arrow: 3,    cursor: {rowNum: 3, col: 0}});
    });
  });

  it("should update cursor-linking when clicking on a cell, even if the position doesn't change", async function() {
    // Classes2 should still be on row 1, but the other 2 sections have their cursors on row 3
    // If we click on Classes2, even if the cursor position doesn't change, we should still record
    // Classes2 as now being the most recently-clicked section and have it drive the linking of the other 2 sections
    // (i.e. they should change to match it)

    // Click on row 1 in Classes2 (it's got filtered-out-rows, and so is desynced from the other 2)
    await gu.getCell('Semester', 1, 'Classes2').click();

    // All sections should now jump to join it
    assert.deepEqual(await getCursorAndArrow('Classes1'), {arrow: 1,   cursor: {rowNum: 1, col: 0}});
    assert.deepEqual(await getCursorAndArrow('Classes2'), {arrow: 1,   cursor: {rowNum: 1, col: 0}});
    assert.deepEqual(await getCursorAndArrow('Classes3'), {arrow: 1,   cursor: {rowNum: 1, col: 0}});
  });

  it('should update cursor linking correctly when the selected row is deleted', async function() {
    // When deleting a row, the current section moves down 1 row (preserving the cursorpos), but other
    // sections with the same table jump to row 1

    // If we're cursor-linked, make sure that doesn't cause a desync.

    // Click on row 2 in Classes1 and delete it
    await gu.getCell('Semester', 2, 'Classes1').click();
    await gu.removeRow(2);

    // Classes1 and Classes3 should both have moved to the next row (previously rowNum3, but now is rowNum 2)
    // Classes2 has this row filtered out, so it should have jumped to row1 instead (desynced from the others)
    assert.deepEqual(await getCursorAndArrow('Classes1'), {arrow: 2,    cursor: {rowNum: 2, col: 0}});
    assert.deepEqual(await getCursorAndArrow('Classes2'), {arrow: null, cursor: {rowNum: 1, col: 0}});
    assert.deepEqual(await getCursorAndArrow('Classes3'), {arrow: 2,    cursor: {rowNum: 2, col: 0}});

    // Undo the row-deletion
    await gu.undo();

    // The first 2 sections will still be on row2, but verify that Classes2 also joins them
    assert.deepEqual(await getCursorAndArrow('Classes1'), {arrow: 2,   cursor: {rowNum: 2, col: 0}});
    assert.deepEqual(await getCursorAndArrow('Classes2'), {arrow: 2,   cursor: {rowNum: 2, col: 0}});
    assert.deepEqual(await getCursorAndArrow('Classes3'), {arrow: 2,   cursor: {rowNum: 2, col: 0}});
  });

  it('should support custom filters', async function() {
    // Add a new custom section with a widget.
    await gu.addNewPage('Table', 'Classes', {});

    // Rename this section as Data.
    await gu.renameActiveSection('Data');

    // Add new custom section with a widget.
    await gu.addNewSection('Custom', 'Classes', { selectBy: 'Data' });

    // Rename this section as Custom.
    await gu.renameActiveSection('Custom');

    // Make sure it can be used as a filter.
    await gu.changeWidgetAccess('read table');
    // Tell grist that we can be linked to.
    await gu.customCode(grist => grist.sectionApi.configure({allowSelectBy: true}));

    // Now link them together.
    await gu.selectSectionByTitle('Data');
    await gu.selectBy('Custom');

    // And now lets filter some rows in the Data by using custom widget API.
    await gu.selectSectionByTitle('Custom');
    await gu.customCode(grist => grist.setSelectedRows([1, 2, 3, 4]).catch(() => {}));

    // Check for the error. It was easy to create an infinite loop with the call above, and checking
    // for errors here was catching it.
    await gu.checkForErrors();

    // This link was not valid, so custom section wasn't filtered, but it managed to filter Data.
    // But in the process, the configuration was cleared.

    // Switch section, so that UI is refreshed.
    await gu.selectSectionByTitle('Data');
    await gu.selectSectionByTitle('Custom');

    // Make sure we can't select Data by Custom anymore.
    await gu.openSelectByForSection('Custom');

    // Make sure it is empty.
    assert.deepEqual(await driver.findAll('.test-select-menu .test-select-row', e => e.getText()), ['Select Widget']);
    await gu.sendKeys(Key.ESCAPE);
  });
});

interface CursorArrowInfo {
  arrow: null | number;
  cursor: {rowNum: number, col: number};
}

// NOTE: this differs from getCursorSelectorInfo in LinkingSelector.ts
// That function only gives the cursorPos if that section is actively selected (false otherwise), whereas this
// function returns it always
async function getCursorAndArrow(sectionName: string): Promise<CursorArrowInfo> {
  return {
    arrow: await gu.getArrowPosition(sectionName),
    cursor: await gu.getCursorPosition(sectionName),
  };
}
