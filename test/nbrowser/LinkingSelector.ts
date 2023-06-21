import {assert, WebElement} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('LinkingSelector', function() {
  this.timeout(20000);

  const cleanup = setupTestSuite({team: true});
  let session: gu.Session;

  afterEach(() => gu.checkForErrors());

  before(async function() {
    session = await gu.session().login();
    const doc = await session.tempDoc(cleanup, 'Class Enrollment.grist', {load: false});
    await session.loadDoc(`/doc/${doc.id}/p/7`);
  });

  interface CursorSelectorInfo {
    linkSelector: false | number;
    cursor: false | {rowNum: number, col: number};
  }

  async function getCursorSelectorInfo(section: WebElement): Promise<CursorSelectorInfo> {
    const hasCursor = await section.find('.active_cursor').isPresent();
    const hasSelector = await section.find('.link_selector_row').isPresent();
    return {
      linkSelector: hasSelector && Number(await section.find('.link_selector_row .gridview_data_row_num').getText()),
      cursor: hasCursor && await gu.getCursorPosition(section),
    };
  }

  it('should mark selected row used for linking', async function() {
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
