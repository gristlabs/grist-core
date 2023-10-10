import {assert, WebElement} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('LinkingSelector', function() {
  this.timeout(20000);

  const cleanup = setupTestSuite({team: true});
  let session: gu.Session;
  let docId: string;

  afterEach(() => gu.checkForErrors());

  before(async function() {
    session = await gu.session().login();
    docId = (await session.tempDoc(cleanup, 'Class Enrollment.grist')).id;
  });

  it('should update linked grid view on filter change', async function() {
    // Add new page with summarized classes by Start_Date.
    await gu.addNewPage('Table', 'Classes', {
      summarize: ['Start_Date'],
    });

    // Add a new linked widget that shows classes by this date.
    await gu.addNewSection('Table', 'Classes', {
      selectBy: 'CLASSES [by Start_Date]'
    });

    // Click on the first date.
    await gu.getCell('Start_Date', 1, 'CLASSES [by Start_Date]').click();
    // Make sure we know which row is selected.
    assert.equal(await gu.getCell('Start_Date', 1).getText(), '2018-09-13');

    // Show only Start_Date in the linked section.
    await gu.selectSectionByTitle('CLASSES');
    await gu.openWidgetPanel();
    await gu.selectAllVisibleColumns();
    await gu.toggleVisibleColumn('Start_Date');
    await gu.hideVisibleColumns();

    // Make sure we see the same date.
    await gu.getCell('Start_Date', 1, 'CLASSES').click();
    assert.equal(await gu.getCell('Start_Date', 1).getText(), '2018-09-13');

    // Now filter the summary table to not show the selected date.
    await gu.selectSectionByTitle('CLASSES [by Start_Date]');
    await gu.filterBy('Start_Date', false, ['2018-09-14']);
    // Make sure this is filtered out.
    assert.equal(await gu.getCell('Start_Date', 1, 'CLASSES [by Start_Date]').getText(), '2018-09-14');
    // Make sure the linked section is updated.
    assert.equal(await gu.getCell('Start_Date', 1, 'CLASSES').getText(), '2018-09-14');
  });

  it('should update linked card on filter change with same record linking', async function() {
    // Test the same for the card view and same record linking (it uses different code).
    // Add a list and a card view of the same table and link them together.
    await gu.addNewPage('Table', 'Classes');

    // Hide all columns in the list view.
    await gu.openWidgetPanel();
    await gu.selectAllVisibleColumns();
    await gu.toggleVisibleColumn('Start_Date');
    await gu.hideVisibleColumns();

    // Rename it to list.
    await gu.renameActiveSection('List');

    // Now add a card view.
    await gu.addNewSection('Card', 'Classes', {
      'selectBy': 'List'
    });
    await gu.renameActiveSection('Card');
    await gu.selectAllVisibleColumns();
    await gu.toggleVisibleColumn('Start_Date');
    await gu.hideVisibleColumns();

    // Select the second row.
    await gu.selectSectionByTitle('List');
    await gu.getCell('Start_Date', 2).click();
    // Make sure we know the second row is selected.
    assert.equal(await gu.getCell('Start_Date', 2).getText(), '2018-09-14');
    assert.equal((await gu.getCursorPosition()).rowNum, 2);

    // Make sure it was also updated in the card view.
    await gu.selectSectionByTitle('Card');
    assert.equal(await gu.getDetailCell('Start_Date', 1).getText(), '2018-09-14');

    // Now filter it out, using pinned filters (to not alter the cursor position).
    await gu.selectSectionByTitle('List');
    // Pin the filter to the panel by just adding it (it is pinned by default).
    await gu.sortAndFilter()
      .then(x => x.addColumn())
      .then(x => x.clickColumn('Start_Date'))
      .then(x => x.close())
      .then(x => x.click());

    // Open the pinned filter, and filter out the date.
    await gu.openPinnedFilter('Start_Date')
      .then(x => x.toggleValue('2018-09-14'))
      .then(x => x.close());

    // Make sure we see it as the first row
    assert.equal(await gu.getCell('Start_Date', 1).getText(), '2018-09-13');
    assert.equal(await gu.getCell('Start_Date', 2).getText(), '2019-01-27');
    // And cursor was moved to the first row.
    assert.equal((await gu.getCursorPosition()).rowNum, 1);
    // Make sure the card view is updated.
    await gu.selectSectionByTitle('Card');
    assert.equal(await gu.getDetailCell('Start_Date', 1).getText(), '2018-09-13');
  });

  it('should update linked section for the first row', async function() {
    // There was a bug here. First row wasn't somehow triggering the linked section to update itself,
    // when it was filtered out, for self-linking.
    await gu.selectSectionByTitle('List');
    await gu.removeFilters();

    // Select first row.
    await gu.getCell('Start_Date', 1).click();
    // Make sure we know what we selected.
    assert.equal(await gu.getCell('Start_Date', 1, 'List').getText(), '2018-09-13');
    // Make sure that card reflects it.
    assert.equal(await gu.getDetailCell('Start_Date', 1, 'Card').getText(), '2018-09-13');
    // Now unfilter it.
    await gu.openColumnFilter('Start_Date')
      .then(x => x.toggleValue('2018-09-13'))
      .then(x => x.close());
    // Make sure that List is updated in the first row.
    assert.equal(await gu.getCell('Start_Date', 1, 'List').getText(), '2018-09-14');
    // Make sure that Card is updated accordingly.
    assert.equal(await gu.getDetailCell('Start_Date', 1, 'Card').getText(), '2018-09-14');
  });

  it('should mark selected row used for linking', async function() {
    await session.loadDoc(`/doc/${docId}/p/7`);

    const families = gu.getSection('FAMILIES');
    const students = gu.getSection('STUDENTS');
    const enrollments = gu.getSection('ENROLLMENTS');

    // Initially FAMILIES first row should be selected and marked as selector.
    assert.deepEqual(await getCursorSelectorInfo(families), {linkSelector: 1, cursor: {rowNum: 1, col: 0}});
    assert.deepEqual(await gu.getActiveCell().getText(), 'Fin');

    // STUDENTS shows appropriate records.
    assert.deepEqual(await gu.getVisibleGridCells({section: students, col: 'First_Name', rowNums: [1, 2, 3, 4]}),
      ['Brockie', 'Care', 'Alfonso', '']);

    // STUDENTS also has a selector row, but no active cursor.
    assert.deepEqual(await getCursorSelectorInfo(students), {linkSelector: 1, cursor: false});
    assert.deepEqual(await getCursorSelectorInfo(enrollments), {linkSelector: false, cursor: false});

    // Select a different Family
    await gu.getCell({section: families, rowNum: 3, col: 'First_Name'}).click();
    assert.deepEqual(await gu.getActiveCell().getText(), 'Pat');
    assert.deepEqual(await getCursorSelectorInfo(families), {linkSelector: 3, cursor: {rowNum: 3, col: 0}});

    // STUDENTS shows new values, has a new selector row
    assert.deepEqual(await gu.getVisibleGridCells({section: students, col: 'First_Name', rowNums: [1, 2, 3]}),
      ['Mordy', 'Noam', '']);
    assert.deepEqual(await getCursorSelectorInfo(students), {linkSelector: 1, cursor: false});

    // STUDENTS Card shows appropriate value
    assert.deepEqual(await gu.getVisibleDetailCells(
        {section: 'STUDENTS Card', cols: ['First_Name', 'Policy_Number'], rowNums: [1]}),
      ['Mordy', '468617']);

    // Select another student
    await gu.getCell({section: students, rowNum: 2, col: 'Last_Name'}).click();
    assert.deepEqual(await getCursorSelectorInfo(students), {linkSelector: 2, cursor: {rowNum: 2, col: 1}});
    assert.deepEqual(await gu.getVisibleDetailCells(
        {section: 'STUDENTS Card', cols: ['First_Name', 'Policy_Number'], rowNums: [1]}),
      ['Noam', '663208']);

    // There is no longer a cursor in FAMILIES, but still a link-selector.
    assert.deepEqual(await getCursorSelectorInfo(families), {linkSelector: 3, cursor: false});

    // Enrollments is linked to the selected student, but still shows no cursor or selector.
    assert.deepEqual(await getCursorSelectorInfo(enrollments), {linkSelector: false, cursor: false});
    assert.deepEqual(await gu.getVisibleGridCells({section: enrollments, col: 'Class', rowNums: [1, 2, 3]}),
      ['2019F-Yoga', '2019S-Yoga', '']);

    // Click into an enrollment; it will become the only section with a cursor.
    await gu.getCell({section: enrollments, rowNum: 2, col: 'Status'}).click();
    assert.deepEqual(await getCursorSelectorInfo(enrollments), {linkSelector: false, cursor: {rowNum: 2, col: 2}});
    assert.deepEqual(await getCursorSelectorInfo(students), {linkSelector: 2, cursor: false});
    assert.deepEqual(await getCursorSelectorInfo(families), {linkSelector: 3, cursor: false});
  });

  it('should show correct state on reload after cursors are positioned', async function() {
    await gu.reloadDoc();
    const families = gu.getSection('FAMILIES');
    const students = gu.getSection('STUDENTS');
    const enrollments = gu.getSection('ENROLLMENTS');
    assert.deepEqual(await getCursorSelectorInfo(enrollments), {linkSelector: false, cursor: {rowNum: 2, col: 2}});
    assert.deepEqual(await getCursorSelectorInfo(students), {linkSelector: 2, cursor: false});
    assert.deepEqual(await getCursorSelectorInfo(families), {linkSelector: 3, cursor: false});
  });
});


interface CursorSelectorInfo {
  linkSelector: false | number;
  cursor: false | {rowNum: number, col: number};
}

async function getCursorSelectorInfo(section: WebElement): Promise<CursorSelectorInfo> {
  const hasCursor = await section.find('.active_cursor').isPresent();
  return {
    linkSelector: await gu.getSelectorPosition(section).then(r => r ?? false),
    cursor: hasCursor && await gu.getCursorPosition(section),
  };
}
