import { UserAPIImpl } from 'app/common/UserAPI';
import { assert, driver } from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import { setupTestSuite } from 'test/nbrowser/testUtils';

async function addColumnDescription(api: UserAPIImpl, docId: string, columnName: string) {
  await api.applyUserActions(docId, [
    [ 'ModifyColumn', 'Table1', columnName, {
      description: 'This is the column description'
    } ],
  ]);
}

function getDescriptionInput() {
  return driver.find('.test-right-panel .test-column-description');
}

describe('DescriptionColumn', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  it('should support basic edition', async () => {
    const mainSession = await gu.session().teamSite.login();
    const api = mainSession.createHomeApi();
    const doc = await mainSession.tempDoc(cleanup, "CardView.grist", { load: true });
    const docId = doc.id;

    await addColumnDescription(api, docId, 'B');

    // Column description editable in right panel
    await driver.find('.test-right-opener').click();

    await gu.getCell({ rowNum: 1, col: 'B' }).click();
    await driver.find('.test-right-tab-field').click();
    assert.equal(await getDescriptionInput().value(), 'This is the column description');

    await gu.getCell({ rowNum: 1, col: 'A' }).click();
    assert.equal(await getDescriptionInput().value(), '');

    // Remove the description
    await api.applyUserActions(docId, [
      [ 'ModifyColumn', 'Table1', 'B', {
        description: ''
      } ],
    ]);

    await gu.getCell({ rowNum: 1, col: 'B' }).click();
    assert.equal(await getDescriptionInput().value(), '');
  });

  it('should show info tooltip only if there is a description', async () => {
    const mainSession = await gu.session().teamSite.login();
    const api = mainSession.createHomeApi();
    const doc = await mainSession.tempDoc(cleanup, "CardView.grist", { load: true });
    const docId = doc.id;

    await addColumnDescription(api, docId, 'B');

    await gu.changeWidget('Card');

    const detailUndescribedColumnFirstRow = await gu.getDetailCell('A', 1);
    assert.isFalse(await detailUndescribedColumnFirstRow.findClosest(".g_record_detail_el").find(".test-column-info-tooltip").isPresent());

    const detailDescribedColumnFirstRow = await gu.getDetailCell('B', 1);
    const toggle = await detailDescribedColumnFirstRow.findClosest(".g_record_detail_el").find(".test-column-info-tooltip");
    // The toggle to show the description is present if there is a description
    assert.isTrue(await toggle.isPresent());

    // Open the tooltip
    await toggle.click();
    assert.isTrue(await driver.findWait('.test-column-info-tooltip-popup', 1000).isDisplayed());

    // Check the content of the tooltip
    const descriptionTooltip = await driver.find('.test-column-info-tooltip-popup .test-column-info-tooltip-popup-body');
    assert.equal(await descriptionTooltip.getText(), 'This is the column description');

    // Close the tooltip
    await toggle.click();
    assert.lengthOf(await driver.findAll('.test-column-info-tooltip-popup'), 0);
  })
});
