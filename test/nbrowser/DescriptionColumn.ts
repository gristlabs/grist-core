import {UserAPIImpl} from 'app/common/UserAPI';
import {assert, driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('DescriptionColumn', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();
  let session: gu.Session;

  before(async () => {
    session = await gu.session().teamSite.login();
  });

  it('should switch between close and save', async () => {
    await session.tempNewDoc(cleanup);
    // Add new column.
    await addColumn();

    // We should have popup at column D.
    await popupIsAt('D');

    // Close button should be visible.
    assert.isTrue(await closeVisible());
    assert.isFalse(await saveVisible());
    assert.isFalse(await cancelVisible());

    // Change something in the name.
    await gu.sendKeys('DD');
    // Save button should be visible.
    assert.isFalse(await closeVisible());
    assert.isTrue(await saveVisible());
    assert.isFalse(await saveDisabled());
    assert.isTrue(await cancelVisible());

    // Restore name.
    await gu.sendKeys(Key.BACK_SPACE);
    // Close button should be visible.
    assert.isTrue(await closeVisible());
    assert.isFalse(await saveVisible());
    assert.isFalse(await cancelVisible());

    // Add description.
    await clickAddDescription();
    await waitForFocus('description');

    // Still close button should be visible.
    assert.isTrue(await closeVisible());
    assert.isFalse(await saveVisible());
    assert.isFalse(await cancelVisible());

    // Type something.
    await gu.sendKeys('D');
    // Save button should be visible.
    assert.isFalse(await closeVisible());
    assert.isTrue(await saveVisible());
    assert.isFalse(await saveDisabled());
    assert.isTrue(await cancelVisible());

    // Clear and move to label.
    await gu.sendKeys(Key.BACK_SPACE);
    await gu.sendKeys(Key.ARROW_UP);
    await waitForFocus('label');
    assert.isTrue(await closeVisible());
    assert.isFalse(await saveVisible());
    assert.isFalse(await cancelVisible());

    // Clear label completely, we have change, but we can't save.
    await gu.sendKeys(Key.BACK_SPACE);
    assert.isEmpty(await getLabel());
    assert.isFalse(await closeVisible());
    assert.isTrue(await saveVisible());
    // But save button is disabled.
    assert.isTrue(await saveDisabled());
    assert.isTrue(await cancelVisible());

    // Add description.
    await gu.sendKeys(Key.ARROW_DOWN);
    await waitForFocus('description');
    await gu.sendKeys('D');

    // Still can't save.
    assert.isFalse(await closeVisible());
    assert.isTrue(await saveVisible());
    assert.isTrue(await saveDisabled());
    assert.isTrue(await cancelVisible());

    // Clear description completely, restore label and press close.
    await gu.sendKeys(Key.BACK_SPACE);
    await gu.sendKeys(Key.ARROW_UP);
    await waitForFocus('label');
    await gu.sendKeys('D');
    await pressClose();

    // Make sure popup is gone.
    assert.isFalse(await popupVisible());
    // Make sure column D exists.
    assert.isTrue(await gu.getColumnHeader({col: 'D'}).isDisplayed());
    await gu.undo();
    assert.isFalse(await gu.getColumnHeader({col: 'D'}).isPresent());
  });


  it('shows links in the column description', async () => {
    const revert = await gu.begin();

    // Add a column and add a description with a link.
    await addColumn();
    await clickAddDescription();
    await gu.sendKeys('First line');
    await gu.sendKeys(Key.SHIFT, Key.ENTER, Key.NULL);
    await gu.sendKeys('Second line https://example.com');
    await gu.sendKeys(Key.SHIFT, Key.ENTER, Key.NULL);
    await gu.sendKeys('Third line');
    await pressSave();

    const header = await gu.getColumnHeader({col: 'D'});
    // Make sure it has a tooltip.
    assert.isTrue(await header.find(".test-column-info-tooltip").isDisplayed());
    // Click the tooltip.
    await header.find(".test-column-info-tooltip").click();

    // Make sure we have a link there.
    const testTooltip = async () => {
      const tooltip = driver.find(".test-tooltip");
      assert.equal(await tooltip.find(".test-text-link a").getAttribute('href'), "https://example.com/");
      assert.equal(await tooltip.find(".test-text-link").getText(), "https://example.com");
      assert.equal(await tooltip.getText(), "First line\nSecond line \nhttps://example.com\nThird line");
    };
    await testTooltip();

    // Convert it to a card view.
    await gu.changeWidget('Card');
    await openCardColumnTooltip('D');
    await testTooltip();

    await revert();
  });

  it('should close popup by enter and escape', async () => {
    // Add another column, make sure that enter and escape work.
    await addColumn();
    await popupIsAt('D');
    await gu.sendKeys(Key.ESCAPE);
    assert.isFalse(await popupVisible());
    // Column D is still there.
    assert.isTrue(await gu.getColumnHeader({col: 'D'}).isDisplayed());
    await gu.undo();
    assert.isFalse(await gu.getColumnHeader({col: 'D'}).isPresent());

    await addColumn();
    await popupIsAt('D');
    await gu.sendKeys(Key.ENTER);
    assert.isFalse(await popupVisible());
    assert.isTrue(await gu.getColumnHeader({col: 'D'}).isDisplayed());
    await gu.undo();
  });

  it('should show info tooltip in a Grid View', async () => {
    await session.tempDoc(cleanup, 'Hello.grist');
    await gu.dismissWelcomeTourIfNeeded();

    // Start renaming col A.
    await doubleClickHeader('A');
    await gu.sendKeys('ColumnA');
    // Check that description is not visible.
    await descriptionIsVisible(false);
    await addDescriptionIsVisible(true);
    // Press add description.
    await clickAddDescription();
    // Check that description is visible.
    await descriptionIsVisible(true);
    await addDescriptionIsVisible(false);
    // Wait for focus in the description input
    await waitForFocus('description');

    // Measure the height of the description input
    const rBefore = await driver.find(`.test-column-title-description`).getRect();

    // Send some multiline text (with more than three lines to test if it auto grows).
    await gu.sendKeys('Line1');
    await gu.sendKeys(Key.SHIFT, Key.ENTER, Key.NULL);
    await gu.sendKeys('Line2');
    await gu.sendKeys(Key.SHIFT, Key.ENTER, Key.NULL);
    await gu.sendKeys('Line3');
    await gu.sendKeys(Key.SHIFT, Key.ENTER, Key.NULL);
    await gu.sendKeys('Line4');
    await gu.sendKeys(Key.SHIFT, Key.ENTER, Key.NULL);

    // Measure the height of the description input again
    const rAfter = await driver.find(`.test-column-title-description`).getRect();
    // Make sure it is at least 13 pixel taller (default font height).
    assert.isTrue(rAfter.height >= rBefore.height + 13);

    // Press save
    await pressSave();

    // Make sure column is renamed.
    let header = await gu.getColumnHeader({col: 'ColumnA'});

    // Make sure it has a tooltip.
    assert.isTrue(await header.find(".test-column-info-tooltip").isDisplayed());

    // Click the tooltip.
    await header.find(".test-column-info-tooltip").click();

    // Make sure we see the popup.
    await waitForTooltip();

    // With a proper text.
    assert.equal(await driver.find(".test-column-info-tooltip-popup").getText(), 'Line1\nLine2\nLine3\nLine4');

    // Undo one (those renames should be bundled).
    await gu.undo();

    // Make sure column is renamed back.
    header = await gu.getColumnHeader({col: 'A'});

    // And there is no tooltip.
    assert.isFalse(await header.find(".test-column-info-tooltip").isPresent());
  });

  const saveTest = async (save: () => Promise<void>) => {
    const revert = await gu.begin();
    // Start renaming col A.
    await doubleClickHeader('B');
    await gu.sendKeys('ColumnB');
    // Press enter.
    await save();
    await gu.waitForServer();
    // Make sure it is renamed.
    await gu.getColumnHeader({col: 'ColumnB'});

    // Change description by clicking save.
    await doubleClickHeader('ColumnB');
    await clickAddDescription();
    await waitForFocus('description');

    await gu.sendKeys('ColumnB description');
    await save();
    await gu.waitForServer();
    // Make sure tooltip is shown.
    await clickTooltip('ColumnB');
    await gu.waitToPass(async () => {
      assert.equal(await driver.findWait(".test-column-info-tooltip-popup", 300).getText(), 'ColumnB description');
    });
    await gu.sendKeys(Key.ESCAPE);
    await revert();
  };

  it('should support saving by clicking save', async () => {
    await saveTest(pressSave);
  });

  it('should support saving by clicking away', async () => {
    await saveTest(() => gu.getCell('E', 5).click());
  });

  it('should support saving by clicking Ctrl+Enter', async () => {
    await saveTest(async () => await gu.sendKeys(Key.chord(await gu.modKey(), Key.ENTER)));
  });

  it('should support saving by enter', async () => {
    const revert = await gu.begin();
    // Start renaming col A.
    await doubleClickHeader('B');
    await gu.sendKeys('ColumnB');

    // Make description.
    await clickAddDescription();
    await gu.sendKeys('ColumnB description');

    // Go to label.
    await gu.sendKeys(Key.ARROW_UP);
    await gu.sendKeys(Key.ARROW_UP);
    await waitForFocus('label');

    // Save by pressing enter.
    await gu.sendKeys(Key.ENTER);
    await gu.waitForServer();
    // Make sure tooltip is shown.
    await clickTooltip('ColumnB');
    await gu.waitToPass(async () => {
      assert.equal(await driver.findWait(".test-column-info-tooltip-popup", 300).getText(), 'ColumnB description');
    });
    await gu.sendKeys(Key.ESCAPE);
    await revert();
  });

  it('should support saving by tab', async () => {
    await saveTest(() => gu.sendKeys(Key.TAB));
    await saveTest(() => gu.sendKeys(Key.SHIFT, Key.TAB, Key.NULL));
  });

  const cancelTest = async (makeCancel: () => Promise<void>) => {
    // Rename column A.
    await doubleClickHeader('A');
    await gu.sendKeys('ColumnA');
    await makeCancel();
    await gu.waitForServer();
    // Make sure we see column A.
    await gu.getColumnHeader({col: 'A'});

    // Check the same for description.
    await doubleClickHeader('A');
    await clickAddDescription();
    await gu.sendKeys('ColumnA description');
    await makeCancel();
    await gu.waitForServer();
    // Make sure that there is no tooltip.
    assert.isFalse(await gu.getColumnHeader({col: 'A'}).find(".test-column-info-tooltip").isPresent());
  };

  it('should support canceling by cancel', async () => {
    await cancelTest(pressCancel);
  });

  it('should support canceling by Escape', async () => {
    await cancelTest(() => gu.sendKeys(Key.ESCAPE));
  });

  it('should add description by pressing arrow down', async () => {
    await doubleClickHeader('A');
    await addDescriptionIsVisible(true);
    await descriptionIsVisible(false);
    await gu.sendKeys(Key.ARROW_DOWN);
    await waitForFocus('description');
    await addDescriptionIsVisible(false);
    await descriptionIsVisible(true);
    // Type something.
    await gu.sendKeys('ColumnA description', Key.ENTER);
    await gu.sendKeys('ColumnA description');
    // Now press 2 times the up key.
    await gu.sendKeys(Key.ARROW_UP);
    await gu.sendKeys(Key.ARROW_UP);
    // We should still be in the description field.
    await waitForFocus('description');
    // Now press down key and test if that works.
    await gu.sendKeys(Key.ARROW_DOWN);
    await driver.wait(() => driver.executeScript(() => ((document as any).activeElement.selectionEnd === 39)), 500);

    // Now press it 3 times, we should be back in the label field.
    await gu.sendKeys(Key.ARROW_UP);
    await gu.sendKeys(Key.ARROW_UP);
    await gu.sendKeys(Key.ARROW_UP);

    // We should be focused back in the label field.
    await waitForFocus('label');
    await pressCancel();
  });

  it('should tab to other columns and save', async () => {
    const revert = await gu.begin();
    // Start renaming col A.
    await doubleClickHeader('B');
    await gu.sendKeys('ColumnB');
    // Press tab.
    await gu.sendKeys(Key.TAB);
    await gu.waitForServer();

    // Make sure it is renamed.
    await gu.getColumnHeader({col: 'ColumnB'});
    // Make sure we are now at column C.
    await popupIsAt('C');

    // Rename column C.
    await gu.sendKeys('ColumnC');

    // Add description.
    await driver.find(".test-column-title-add-description").click();
    await waitForFocus('description');

    // Rename description.
    await gu.sendKeys('ColumnC description');

    // Go back to column B from description by pressing shift tab
    await gu.sendKeys(Key.SHIFT, Key.TAB, Key.NULL);
    await gu.waitForServer();
    // Make sure we are now at column B.
    await popupIsAt('ColumnB');
    // Make sure the label has focus.
    await waitForFocus('label');
    // Go to column C and from the label.
    await gu.sendKeys(Key.TAB);
    // Make sure we are now at column C.
    await popupIsAt('ColumnC');
    // Just quick test that shift tab will work.
    await gu.sendKeys(Key.SHIFT, Key.TAB, Key.NULL);
    // Make sure we are now at column B.
    await popupIsAt('ColumnB');
    // Go to column C and test if the description was saved.
    await gu.sendKeys(Key.TAB);
    // Make sure we are now at column C.
    await popupIsAt('ColumnC');
    // And it has proper description.
    assert.equal(await driver.find(".test-column-title-description").getAttribute('value'), 'ColumnC description');
    // Close by pressing escape.
    await gu.sendKeys(Key.ESCAPE);
    await gu.waitForServer();

    await revert();
  });

  it('should reopen editor when adding new column', async () => {
    // This partially worked before - there was a bug where if you pressed tab on
    // the last column, and then clicked Add Column, the editor wasn't shown, and the
    // auto-generated column name was used.
    const revert = await gu.begin();
    await doubleClickHeader('E');
    await gu.sendKeys(Key.TAB);
    assert.isFalse(await popupVisible());

    await addColumn();
    assert.isTrue(await popupVisible());

    await gu.sendKeys(Key.ESCAPE);
    await gu.waitForServer();
    await revert();
  });

  it('should support basic edition on CardList', async () => {
    const mainSession = await gu.session().teamSite.login();
    const api = mainSession.createHomeApi();
    const doc = await mainSession.tempDoc(cleanup, "CardView.grist", { load: true });
    const docId = doc.id;

    // Make more room for switching between columns.
    await gu.toggleSidePanel('left', 'close');
    await gu.openColumnPanel();

    await addColumnDescription(api, docId, 'B');

    // Column description editable in right panel
    await gu.getCell({ rowNum: 1, col: 'B' }).click();
    assert.equal(await getDescriptionInput().value(), 'This is the column description\nIt is in two lines');

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
    await gu.toggleSidePanel('left', 'open');
  });

  it('should show info tooltip only if there is a description', async () => {
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

    await openCardColumnTooltip('B');

    // Check the content of the tooltip
    const descriptionTooltip = await driver
      .find('.test-column-info-tooltip-popup');
    assert.equal(await descriptionTooltip.getText(), 'This is the column description\nIt is in two lines');
  });

});

async function clickTooltip(col: string) {
  await gu.getColumnHeader({col}).find(".test-column-info-tooltip").click();
}

async function addDescriptionIsVisible(visible = true) {
  if (visible) {
    assert.isTrue(await driver.find(".test-column-title-add-description").isDisplayed());
  } else {
    assert.isFalse(await driver.find(".test-column-title-add-description").isPresent());
  }
}

async function descriptionIsVisible(visible = true) {
  if (visible) {
    assert.isTrue(await driver.find(".test-column-title-description").isDisplayed());
  } else {
    assert.isFalse(await driver.find(".test-column-title-description").isPresent());
  }
}

async function addColumnDescription(api: UserAPIImpl, docId: string, columnName: string) {
  await api.applyUserActions(docId, [
    [ 'ModifyColumn', 'Table1', columnName, {
      description: 'This is the column description\nIt is in two lines'
    } ],
  ]);
}

function getDescriptionInput() {
  return driver.find('.test-right-panel .test-column-description');
}

function getLabel() {
  return driver.findWait(".test-column-title-label", 1000).getAttribute('value');
}

async function popupVisible() {
  if (await driver.find(".test-column-title-popup").isPresent()) {
    return await driver.find(".test-column-title-popup").isDisplayed();
  } else {
    return false;
  }
}

async function popupIsAt(col: string) {
  // Make sure we are now at column.
  assert.equal(await getLabel(), col);
  // Make sure that popup is near the column.
  const headerCRect = await gu.getColumnHeader({col}).getRect();
  const popup = await driver.find(".test-column-title-popup").getRect();
  assert.isAtLeast(popup.x, headerCRect.x - 2);
  assert.isBelow(popup.x, headerCRect.x + 2);
  assert.isAtLeast(popup.y, headerCRect.y + headerCRect.height - 2);
  assert.isBelow(popup.y, headerCRect.y + headerCRect.height + 2);
}

async function doubleClickHeader(col: string) {
  const header = await gu.getColumnHeader({col});
  await header.click();
  await header.click();
  await waitForFocus('label');
}

async function waitForFocus(field: 'label'|'description') {
  await gu.waitToPass(async () => assert.isTrue(await driver.find(`.test-column-title-${field}`).hasFocus()), 200);
}

async function waitForTooltip() {
  await gu.waitToPass(async () => {
    assert.isTrue(await driver.find(".test-column-info-tooltip-popup").isDisplayed());
  });
}

async function pressSave() {
  await driver.find(".test-column-title-save").click();
  await gu.waitForServer();
}

async function pressClose() {
  await driver.find(".test-column-title-close").click();
  await gu.waitForServer();
}

async function saveDisabled() {
  const value = await driver.find(".test-column-title-save").getAttribute('disabled');
  return value === 'true';
}

async function pressCancel() {
  await driver.find(".test-column-title-cancel").click();
  await gu.waitForServer();
}

async function clickAddDescription() {
  await driver.find(".test-column-title-add-description").click();
  await waitForFocus('description');
}

async function addColumn() {
  await driver.find(".mod-add-column").click();
  await driver.find('.test-new-columns-menu-add-new').click();
  await gu.waitForServer();
}

async function closeVisible() {
  return await driver.find(".test-column-title-close").isDisplayed();
}

async function saveVisible() {
  return await driver.find(".test-column-title-save").isDisplayed();
}

async function cancelVisible() {
  return await driver.find(".test-column-title-cancel").isDisplayed();
}

async function openCardColumnTooltip(col: string) {
  const detailDescribedColumnFirstRow = await gu.getDetailCell(col, 1);
  const toggle = await detailDescribedColumnFirstRow
    .findClosest(".g_record_detail_el")
    .find(".test-column-info-tooltip");
  // The toggle to show the description is present if there is a description
  assert.isTrue(await toggle.isPresent());
  // Open the tooltip
  await toggle.click();
  await waitForTooltip();
}
