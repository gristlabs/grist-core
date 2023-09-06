import {assert, driver} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';
import {DocCreationInfo} from "app/common/DocListAPI";

describe('GridView', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();
  let session: gu.Session, doc: DocCreationInfo, api;

  it('should show tables with no columns without errors', async function() {
    session = await gu.session().login();
    doc = await session.tempDoc(cleanup, 'Hello.grist');
    api = session.createHomeApi();

    // Create and open a new table with no columns
    await api.applyUserActions(doc.id, [
      ['AddTable', 'Empty', []],
    ]);
    await gu.getPageItem(/Empty/).click();

    // The only 'column' should be the button to add a column
    const columnNames = await driver.findAll('.column_name', e => e.getText());
    assert.deepEqual(columnNames, ['+']);

    // There should be no errors
    assert.lengthOf(await driver.findAll('.test-notifier-toast-wrapper'), 0);
  });

  // When a grid is scrolled, and then data is changed (due to click in a linked section), some
  // records are not rendered or the position of the scroll container is corrupted.
  it('should render list with wrapped choices correctly', async function() {
    await session.tempDoc(cleanup, 'Teams.grist');
    await gu.selectSectionByTitle("PROJECTS");
    await gu.getCell(0, 1).click();
    await gu.selectSectionByTitle("TODO");
    await gu.scrollActiveView(0, 300);
    await gu.selectSectionByTitle("PROJECTS");
    await gu.getCell(0, 2).click();
    await gu.selectSectionByTitle("TODO");
    // This throws an error, as the cell is not rendered.
    assert.equal(await gu.getCell(0, 2).getText(), "2021-09-27 Mo\n2021-10-04 Mo");
  });
});
