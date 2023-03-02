import { UserAPIImpl } from 'app/common/UserAPI';
import { assert, driver, Key } from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import { setupTestSuite } from 'test/nbrowser/testUtils';

async function addColumnDescription(api: UserAPIImpl, docId: string, columnName: string) {
  await api.applyUserActions(docId, [
    [ 'ModifyColumn', 'Table1', columnName, {
      description: 'This is the column description\nIt is in two lines'
    } ],
  ]);
}

function getRightPanelDescriptionInput() {
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
    assert.equal(await getRightPanelDescriptionInput().value(), 'This is the column description\nIt is in two lines');

    await gu.getCell({ rowNum: 1, col: 'A' }).click();
    assert.equal(await getRightPanelDescriptionInput().value(), '');

    // Remove the description
    await api.applyUserActions(docId, [
      [ 'ModifyColumn', 'Table1', 'B', {
        description: ''
      } ],
    ]);

    await gu.getCell({ rowNum: 1, col: 'B' }).click();
    assert.equal(await getRightPanelDescriptionInput().value(), '');
  });

  it('should show info tooltip in grid view only if there is a description', async () => {
    const mainSession = await gu.session().teamSite.login();
    const api = mainSession.createHomeApi();
    const doc = await mainSession.tempDoc(cleanup, "CardView.grist", { load: true });
    const docId = doc.id;

    await addColumnDescription(api, docId, 'B');

    const undescribedColumn = await gu.getColumnHeader({ col: 'A' });
    assert.isFalse(
      await undescribedColumn
        .find(".test-column-info-tooltip")
        .isPresent()
    );

    const describedColumn = await gu.getColumnHeader({ col: 'B' });
    const toggle = await describedColumn.find(".test-column-info-tooltip");
    // The toggle to show the description is present if there is a description
    assert.isTrue(await toggle.isPresent());

    // Open the tooltip
    await toggle.click();
    assert.isTrue(await driver.findWait('.test-column-info-tooltip-popup', 1000).isDisplayed());

    // Check the content of the tooltip
    const descriptionTooltip = await driver
      .find('.test-column-info-tooltip-popup .test-column-info-tooltip-popup-body');
    assert.equal(await descriptionTooltip.getText(), 'This is the column description\nIt is in two lines');

    // Close the tooltip
    await toggle.click();
    assert.lengthOf(await driver.findAll('.test-column-info-tooltip-popup'), 0);
  });

  it('should support basic edition inside gridview popup', async () => {
    const mainSession = await gu.session().teamSite.login();
    mainSession.createHomeApi();
    await mainSession.tempDoc(cleanup, "CardView.grist", { load: true });

    const columnHeader = await gu.getColumnHeader({ col: 'A' });

    // Click on the title and open the edition popup
    await columnHeader.find(".g_column_label .test-column-title-text").click();
    const columnEditPopup = await driver.findWait('.test-column-title-popup', 1000);
    const columnDescInput = await columnEditPopup.find('.test-column-title-field-description');

    // Check initial content of popup
    assert.equal(await columnEditPopup.find('.test-column-title-column-label-input').value(), 'A');
    assert.equal(await columnDescInput.value(), '');

    // Edit the description of the column inside the popup
    await columnDescInput.click();
    await columnDescInput.sendKeys("New description", Key.ENTER);
    await gu.waitForServer();

    // Check the new description value inside the column tooltip
    await columnHeader.find(".test-column-info-tooltip").click();
    const descriptionTooltip = await driver
      .findWait('.test-column-info-tooltip-popup .test-column-info-tooltip-popup-body', 1000);
    assert.equal(await descriptionTooltip.getText(), 'New description');
  });

  it('should show info tooltip in card view only if there is a description', async () => {
    const mainSession = await gu.session().teamSite.login();
    const api = mainSession.createHomeApi();
    const doc = await mainSession.tempDoc(cleanup, "CardView.grist", { load: true });
    const docId = doc.id;

    await addColumnDescription(api, docId, 'B');

    await gu.changeWidget('Card');

    const detailUndescribedColumnFirstRow = await gu.getDetailCell('A', 1);
    assert.isFalse(
      await detailUndescribedColumnFirstRow
        .findClosest(".g_record_detail_el")
        .find(".test-column-info-tooltip")
        .isPresent()
    );

    const detailDescribedColumnFirstRow = await gu.getDetailCell('B', 1);
    const toggle = await detailDescribedColumnFirstRow
      .findClosest(".g_record_detail_el")
      .find(".test-column-info-tooltip");
    // The toggle to show the description is present if there is a description
    assert.isTrue(await toggle.isPresent());

    // Open the tooltip
    await toggle.click();
    assert.isTrue(await driver.findWait('.test-column-info-tooltip-popup', 1000).isDisplayed());

    // Check the content of the tooltip
    const descriptionTooltip = await driver
      .find('.test-column-info-tooltip-popup .test-column-info-tooltip-popup-body');
    assert.equal(await descriptionTooltip.getText(), 'This is the column description\nIt is in two lines');

    // Close the tooltip
    await toggle.click();
    assert.lengthOf(await driver.findAll('.test-column-info-tooltip-popup'), 0);
  });
});
