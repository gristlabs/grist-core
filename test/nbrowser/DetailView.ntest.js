import { By, assert, driver } from 'mocha-webdriver';
import { $, gu, test } from 'test/nbrowser/gristUtil-nbrowser';

describe("DetailView.ntest", function () {
  const cleanup = test.setupTestSuite(this);
  const clipboard = gu.getLockableClipboard();
  gu.bigScreen();

  before(async function() {
    await gu.supportOldTimeyTestCode();
    await gu.useFixtureDoc(cleanup, "Favorite_Films.grist", true);

    // Open the view tab.
    await gu.openSidePane('view');

    // Open the 'All' view
    await gu.actions.selectTabView('All');

    // close the side pane
    await gu.toggleSidePanel('left', 'close');
  });

  afterEach(function() {
    return gu.checkForErrors();
  });

  describe("DetailView.selection", function () {

    before(async function() {
      // Open the 'Performances' view
      await gu.actions.viewSection('Performances detail').selectSection();
      await $('.test-right-panel button:contains(Change Widget)').click();
      await $('.test-wselect-type:contains(Card List)').click();
      await $('.test-wselect-addBtn').click();
      await gu.waitForServer();
      await gu.openSelectByForSection('Performances detail');
      await driver.findContent('.test-select-row', /Performances record$/).click();
    });

    it('should mark detail-view row as selected when its out of focus', async function() {
      // Focus on Performances record, second row
      await gu.actions.viewSection('Performances record').selectSection();
      await gu.getCell({col: 'Film', rowNum: 2}).click();

      //Check if only the second card in detail view is having selection class
      const elements = await driver.findElements(By.css(".detailview_record_detail"));
      const secondElement = await elements[1].getAttribute('class');
      assert.isTrue(secondElement.includes('selected'));

      const firstElement = await elements[0].getAttribute('class');
      assert.isFalse(firstElement.includes('selected'));
    });
  });

  it('should allow switching between card and detail view', async function() {
    await gu.actions.viewSection('Performances detail').selectSection();

    // Check that the detail cells have the correct values.
    assert.deepEqual(await gu.getVisibleDetailCells('Actor', [1]), ['Tom Hanks']);
    await $('.grist-single-record__menu .detail-right').click();
    // rowNum is always 1 for detail cells now.
    assert.deepEqual(await gu.getVisibleDetailCells('Actor', [1]), ['Tim Allen']);

    // Swap to Card List view, check values.
    await $('.test-right-panel button:contains(Change Widget)').click();
    await $('.test-wselect-type:contains(Card List)').click();
    await $('.test-wselect-addBtn').click();
    await gu.waitForServer();
    assert.deepEqual(await gu.getVisibleDetailCells('Actor', [1, 2]),
      ['Tom Hanks', 'Tim Allen']);

    // Swap back to Card view, re-check values.
    await $('.test-right-panel button:contains(Change Widget)').click();
    await $('.test-wselect-type:contains(Card)').click();
    await $('.test-wselect-addBtn').click();
    await gu.waitForServer();
    assert.deepEqual(await gu.getVisibleDetailCells('Actor', [1]), ['Tim Allen']);
    await $('.grist-single-record__menu .detail-left').click();
    assert.deepEqual(await gu.getVisibleDetailCells('Actor', [1]), ['Tom Hanks']);
  });

  it('should allow editing cells', async function() {
    // Updates should be reflected in the detail floating rowModel cell.
    await gu.sendKeys('Roger Federer', $.ENTER);
    await gu.waitForServer();
    assert.deepEqual(await gu.getVisibleDetailCells('Actor', [1]), ['Roger Federer']);

    // Undo updates should be reflected as well.
    await gu.sendKeys([$.MOD, 'z']);
    await gu.waitForServer();
    assert.deepEqual(await gu.getVisibleDetailCells('Actor', [1]), ['Tom Hanks']);
  });

  // Note: This is a test of a specific bug related to the detail rowModel being resized after
  // being unset.
  it('should allow row resize operations after switching section type', async function() {
    // Switch to Card List view and enter a formula. This should cause the scrolly to resize all rows.
    // If the detail view rowModel is wrongly resized, the action will fail.
    await $('.test-right-panel button:contains(Change Widget)').click();
    await $('.test-wselect-type:contains(Card List)').click();
    await $('.test-wselect-addBtn').click();
    await gu.waitForServer();
    await gu.sendKeys('=');
    await $('.test-editor-tooltip-convert').click();      // Convert to a formula
    await gu.sendKeys('100', $.ENTER);
    await gu.waitForServer();
    assert.deepEqual(await gu.getVisibleDetailCells('Actor', [1, 2, 3, 4]),
      ['100', '100', '100', '100']);
  });

  //FIXME: This test is constanly failing on phab build pipeline. need to be fixed
  it.skip('should include an add record row', async function() {
    // Should include an add record row which works in card view and detail view.
    // Check that adding 'Jurassic Park' to the card view add record row adds it as a row.
    await $('.g_record_detail:nth-child(14) .field_clip').eq(1).wait().click();
    await gu.sendKeys('Jurassic Park', $.ENTER);
    await gu.waitForServer();
    assert.deepEqual(await gu.getVisibleDetailCells('Film', [14]), ['Jurassic Park']);
    // Check that adding 'Star Wars' to the detail view add record row adds it as a row.
    await $('.test-right-panel button:contains(Change Widget)').click();
    await $('.test-wselect-type:contains(Card)').click();
    await $('.test-wselect-addBtn').click();
    await gu.waitForServer();
    await $('.detail-add-btn').wait().click();
    // Card view, so rowNum is now 1
    await gu.getDetailCell('Film', 1).click();
    await gu.sendKeys('Star Wars', $.ENTER);
    await gu.waitForServer();
    assert.deepEqual(await gu.getVisibleDetailCells('Film', [1]), ['Star Wars']);

    // Should allow pasting into the add record row.
    await gu.getDetailCell('Actor', 1).click();
    await clipboard.lockAndPerform(async (cb) => {
      await cb.copy();
      await $('.detail-add-btn').click();
      await gu.waitForServer();
      // Paste '100' into the last field of the row and check that it is added as its own row.
      await gu.getDetailCell('Character', 1).click();
      await cb.paste();
    });
    await gu.waitForServer();
    assert.deepEqual(await gu.getDetailCell('Character', 1).text(), '100');

    // Should not throw errors when deleting the add record row.
    await $('.detail-add-btn').click();
    await gu.sendKeys([$.MOD, $.DELETE]);
    // Errors will be detected in afterEach.
  });
});
