import {assert} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {Session} from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('AttachmentsLinking', function() {
  this.timeout(20000);

  const cleanup = setupTestSuite({team: true});
  let session: Session;
  let docId: string;

  before(async function() {
    session = await gu.session().login();
    docId = await session.tempNewDoc(cleanup, 'AttachmentColumns', {load: false});

    // Set up a table Src, and table Items which links to Src and has an Attachments column.
    const api = session.createHomeApi();
    await api.applyUserActions(docId, [
      ['AddTable', 'Src', [{id: 'A', type: 'Text'}]],
      ['BulkAddRecord', 'Src', [null, null, null], {A: ['a', 'b', 'c']}],
      ['AddTable', 'Items', [
        {id: 'A', type: 'Ref:Src'},
        {id: 'Att', type: 'Attachments'},
      ]],
      ['BulkAddRecord', 'Items', [null, null, null], {A: [1, 1, 3]}],
    ]);

    await session.loadDoc(`/doc/${docId}`);

    // Set up a page with linked widgets.
    await gu.addNewPage('Table', 'Src');
    await gu.addNewSection('Table', 'Items', {selectBy: /Src/i});
  });

  it('should fill in values determined by linking when uploading to the add row', async function() {
    // TODO Another good test case would be that dragging a file into a cell works, especially
    // when that cell isn't in the selected widget. But this doesn't seem supported by webdriver.

    // Selecting a cell in Src should show only linked values in Items.
    await gu.getCell({section: 'Src', col: 'A', rowNum: 1}).click();
    assert.deepEqual(await gu.getVisibleGridCells({section: 'Items', cols: ['A', 'Att'], rowNums: [1, 2, 3]}), [
      'Src[1]', '',
      'Src[1]', '',
      '', '',
    ]);

    // Upload into an Attachments cell in the "Add Row" of Items.
    assert.equal(await gu.getCell({section: 'Items', col: 0, rowNum: 4}).isPresent(), false);

    let cell = await gu.getCell({section: 'Items', col: 'Att', rowNum: 3});
    await gu.fileDialogUpload('uploads/file1.mov', () => cell.find('.test-attachment-icon').click());
    await gu.waitToPass(async () =>
      assert.lengthOf(await gu.getCell({section: 'Items', col: 'Att', rowNum: 3}).findAll('.test-pw-thumbnail'), 1));

    assert.deepEqual(await gu.getVisibleGridCells({section: 'Items', cols: ['A', 'Att'], rowNums: [1, 2, 3, 4]}), [
      'Src[1]', '',
      'Src[1]', '',
      'Src[1]', 'MOV',
      '', '',
    ]);

    // Switch to another Src row; should see no attachments.
    await gu.getCell({section: 'Src', col: 'A', rowNum: 2}).click();
    assert.deepEqual(await gu.getVisibleGridCells({section: 'Items', cols: ['A', 'Att'], rowNums: [1]}), [
      '', '',
    ]);

    cell = await gu.getCell({section: 'Items', col: 'Att', rowNum: 1});
    await gu.fileDialogUpload('uploads/htmlfile.html,uploads/file1.mov',
      () => cell.find('.test-attachment-icon').click());
    await gu.waitToPass(async () =>
      assert.lengthOf(await gu.getCell({section: 'Items', col: 'Att', rowNum: 1}).findAll('.test-pw-thumbnail'), 2));

    assert.deepEqual(await gu.getVisibleGridCells({section: 'Items', cols: ['A', 'Att'], rowNums: [1, 2]}), [
      'Src[2]', 'HTML\nMOV',
      '', '',
    ]);
  });
});
