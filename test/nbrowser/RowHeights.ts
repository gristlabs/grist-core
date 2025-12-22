import {assert, driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('RowHeights', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  afterEach(() => gu.checkForErrors());

  it('should allow configuring row heights in grid views', async function() {
    const session = await gu.session().teamSite.user('user1').login();
    const docId = (await session.tempNewDoc(cleanup, 'RowHeights1', {load: false}));
    const api = session.createHomeApi();

    // Create a fixture with a bunch of long cells.
    await api.applyUserActions(docId, [
      ['AddTable', 'TestTable', [
        {id: 'Num', type: 'Numeric'},
        {id: 'State', type: 'Choice'},
        {id: 'SignupDate', type: 'Date'},
        {id: 'Address', type: 'Text'},
        {id: 'Notes', type: 'Text'},
      ]],
      ['BulkAddRecord', 'TestTable', [null, null, null, null], {
        Num: [10, 20, 30, 40],
        State: ['ZZ', 'YY', '', 'AQ'],
        SignupDate: ["2023-04-01", "2022-11-17", "2024-01-05", "2021-06-21"],
        Address: [
          "123 Fictional Rd\nNowhere, ZZ 00000",
          "Apt. 9¾\n221B Bagel St\nSnaxville, YY",
          "Space",
          "PO Box 8675309\nSomewhere Cold\nAntarctica, AQ 00001",
        ],
        Notes: [
          "Jeff once microwaved a fork. He now teaches Kitchen Do's and Don'ts",
          "No soup for you!",
          "",
          ("Note: Writing a self-help book:\n\"How to Fix Things with Tape & Optimism\".\n" +
            "Currently stuck in Chapter 1: \"Find Tape\"."),
        ],
      }],
    ]);

    await session.loadDoc(`/doc/${docId}/p/2`);

    // Set Notes column to wrap.
    await gu.openColumnPanel("Notes");
    await driver.findWait('.test-tb-wrap-text', 500).click();

    // Check what it shows for "Row heights".
    assert.equal(await driver.find('.test-row-height-label').getText(), "auto");

    // A different column should show the same thing.
    await gu.getCell({col: 'State', rowNum: 1}).click();
    assert.equal(await driver.find('.test-row-height-label').getText(), "auto");

    // Click the "change" link. This should take us to the table config.
    await driver.find('.test-row-height-change-link').click();
    assert.equal(await driver.find('.test-right-tab-pagewidget').matches('[aria-selected="true"]'), true);

    // Check what we see in the row-config spinner.
    assert.equal(await driver.find('.test-row-height-max input').value(), '');
    assert.equal(await driver.find('.test-row-height-max input').getAttribute('placeholder'), 'auto');
    await checkHeights([5, 3, 1, 9]);

    // Change it using the spinner.
    await driver.find('.test-numeric-spinner-increment').click();
    assert.equal(await driver.find('.test-row-height-max input').value(), '1');
    await checkHeights([1, 1, 1, 1]);

    // Revert to 'auto' using the spinner.
    await driver.find('.test-numeric-spinner-decrement').click();
    assert.equal(await driver.find('.test-row-height-max input').value(), '');
    await checkHeights([5, 3, 1, 9]);

    // Change it by typing a value in.
    await driver.find('.test-row-height-max input').click();
    await gu.sendKeys('5', Key.ENTER);
    assert.equal(await driver.find('.test-row-height-max input').value(), '5');
    await checkHeights([5, 3, 1, 5]);

    // Try the "Expand rows" option.
    assert.equal(await driver.find('.test-row-height-expand').getAttribute('checked'), null);
    await driver.find('.test-row-height-expand').click();
    assert.equal(await driver.find('.test-row-height-expand').getAttribute('checked'), 'true');
    await checkHeights([5, 5, 5, 5]);

    // Test that a reload keeps these values, i.e. they've been saved
    await gu.reloadDoc();
    assert.equal(await driver.find('.test-row-height-max input').value(), '5');
    assert.equal(await driver.find('.test-row-height-expand').getAttribute('checked'), 'true');
    await checkHeights([5, 5, 5, 5]);

    // Try spinner again.
    await driver.find('.test-numeric-spinner-decrement').click();
    await driver.find('.test-numeric-spinner-decrement').click();
    assert.equal(await driver.find('.test-row-height-max input').value(), '3');
    await checkHeights([3, 3, 3, 3]);

    // Uncheck the "expand" button.
    await driver.find('.test-row-height-expand').click();
    assert.equal(await driver.find('.test-row-height-expand').getAttribute('checked'), null);
    await checkHeights([3, 3, 1, 3]);

    // Check what's shown in the column options.
    await gu.openColumnPanel("Notes");
    assert.equal(await driver.find('.test-row-height-label').getText(), "3");

    // Reset back to auto.
    await gu.openWidgetPanel();
    await driver.find('.test-row-height-max input').click();
    await gu.sendKeys(Key.DELETE);
    await gu.getCell({col: 'State', rowNum: 1}).click();    // Click away.
    assert.equal(await driver.find('.test-row-height-max input').value(), '');
    await checkHeights([5, 3, 1, 9]);
  });

  async function checkHeights(expectedRowHeights: number[]) {
    const heights = await gu.getVisibleGridCells({col: 'Num', rowNums: [1, 2, 3, 4],
      mapper: async el => (await el.getRect()).height,
    });
    // Each line is 18px, and we get rid of remainder by rounding down.
    const heightsInLines = heights.map(h => Math.floor(h / 18));
    assert.deepEqual(heightsInLines, expectedRowHeights);
  }


  it('should not offer row height option in other views', async function() {
    // While it could be useful for cards, it would need an adjusted design, and isn't currently
    // supported.

    // Add card widget.
    await gu.addNewSection('Card', 'TestTable');
    await gu.getDetailCell({col: 'Notes', rowNum: 1}).click();

    // Check that there are no row-height options in column or table levels.
    await gu.openColumnPanel();
    await driver.sleep(500);
    assert.equal(await driver.find('.test-row-height-label').isPresent(), false);
    await gu.openWidgetPanel();
    await driver.sleep(500);
    assert.equal(await driver.find('.test-row-height-max').isPresent(), false);
    assert.equal(await driver.find('.test-row-height-expand').isPresent(), false);
  });
});
