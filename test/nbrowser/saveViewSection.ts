import { assert, driver, Key } from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import { setupTestSuite } from 'test/nbrowser/testUtils';

describe("saveViewSection", function() {
  this.timeout(20000);
  setupTestSuite();
  gu.bigScreen();

  const cleanup = setupTestSuite();

  before(async function() {
    const session = await gu.session().teamSite.login();
    await session.tempNewDoc(cleanup, 'test-updateViewSection');
  });

  it("should work correctly when turning a table to 'summary'", async () => {
    // add new section
    await gu.addNewSection(/Table/, /Table1/);

    // change name and edit data of the 1st section (first found - both have the same name)
    await gu.renameSection('TABLE1', 'Foo');

    // open right panel
    await gu.toggleSidePanel('right');
    await driver.find('.test-config-data').click();

    // check there is no groupedBy
    assert.equal(await driver.find('.test-pwc-groupedBy').isDisplayed(), false);

    // click edit table data
    await driver.find('.test-pwc-editDataSelection').doClick();

    // summarize table by 'A' and save
    await driver.findContent('.test-wselect-table', /Table1/).find('.test-wselect-pivot').doClick();
    await driver.findContent('.test-wselect-column', /A/).doClick();
    await driver.find('.test-wselect-addBtn').doClick();

    // wait for server
    await gu.waitForServer();

    // check that new table is summarized
    assert.equal(await driver.findWait('.test-pwc-table', 2000).getText(), 'Table1');
    assert.deepEqual(await driver.findAll('.test-pwc-groupedBy-col', (e) => e.getText()), ['A']);

    // check sections name did not change
    assert.deepEqual(await gu.getSectionTitles(), ['Foo', 'TABLE1']);

    // check 1st section is active
    assert(await driver.find('.viewsection_content').matches('.active_section'));
  });

  it('should work correctly when changing table', async () => {
    // click edit table data
    await driver.find('.test-pwc-editDataSelection').doClick();

    // create a new table
    await driver.findContent('.test-wselect-table', /New Table/).doClick();
    await driver.find('.test-wselect-addBtn').doClick();

    // wait for server
    await gu.waitForServer();

    // check that first section shows table2 with no grouped by cols
    assert.equal(await driver.findWait('.test-pwc-table', 2000).getText(), 'Table2');
    assert.equal(await driver.find('.test-pwc-groupedBy').isDisplayed(), false);

    // check sections name did not change
    assert.deepEqual(await gu.getSectionTitles(), ['Foo', 'TABLE1']);

    // check 1st section is active
    assert(await driver.find('.viewsection_content').matches('.active_section'));

    // revert to what it was
    await gu.undo();
  });

  it("should work correctly when changing type", async () => {

    async function switchTypeAndAssert(t: string) {
      // open page widget picker
      await driver.find('.test-pwc-editDataSelection').doClick();

      // select type t and save
      await driver.findContent('.test-wselect-type', gu.exactMatch(t)).doClick();
      await driver.find('.test-wselect-addBtn').doClick();
      await gu.waitForServer();

      // check section's type
      await driver.find('.test-pwc-editDataSelection').doClick();
      assert.equal(await driver.find('.test-wselect-type[class*=-selected]').getText(), t);

      // close page widget picker
      await driver.sendKeys(Key.ESCAPE);
      await gu.checkForErrors();
    }

    // TODO: check what's shown by asserting data for each type
    await switchTypeAndAssert('Card');
    await switchTypeAndAssert('Table');
    await switchTypeAndAssert('Chart');

  });

  it("should work correctly when changing grouped by column", async () => {

    // open page widget picker
    await driver.find('.test-pwc-editDataSelection').doClick();

    // Select column B
    await driver.findContent('.test-wselect-column', /B/).doClick();
    await driver.find('.test-wselect-addBtn').doClick();
    await gu.waitForServer();

    // check grouped by is now A, B
    assert.deepEqual(await driver.findAll('.test-pwc-groupedBy-col', (e) => e.getText()), ['A', 'B']);

    await gu.undo();
  });

  it("should not hide any columns when changing to a summary table", async () => {
    // Previously, a bug when changing data selection would sometimes cause columns to be hidden.
    // This test replicates a scenario that was used to reproduce the bug, and checks that it no
    // longer occurs.

    async function assertActiveSectionColumns(...expected: string[]) {
      const activeSection = await driver.find('.active_section');
      const actual = (await activeSection.findAll('.column_name', el => el.getText()))
        .filter(name => name !== '+');
      assert.deepEqual(actual, expected);
    }

    // Create a Places table with a single Place column.
    await gu.addNewTable('Places');
    await gu.renameColumn({col: 0}, 'Place');
    await gu.sendKeys(Key.ARROW_RIGHT);
    await gu.sendKeys(Key.chord(Key.ALT, '-'));
    await gu.waitForServer();
    await gu.sendKeys(Key.chord(Key.ALT, '-'));
    await gu.waitForServer();

    // Create an Orders table, and rename the last column to Test.
    await gu.addNewTable('Orders');
    await gu.renameColumn({col: 2}, 'Test');

    // Duplicate the Places page.
    await gu.openPageMenu('Places');
    await driver.find('.test-docpage-duplicate').click();
    await driver.find('.test-modal-confirm').click();
    await driver.findContentWait('.test-docpage-label', /copy/, 1000);
    await gu.waitForServer();

    // Change the duplicated page's data to summarize Orders, grouping by column Test.
    await driver.find('.test-pwc-editDataSelection').doClick();
    await driver.findContent('.test-wselect-table', /Orders/).find('.test-wselect-pivot').doClick();
    await driver.findContent('.test-wselect-column', /Test/).doClick();
    await driver.find('.test-wselect-addBtn').doClick();
    await gu.waitForServer();

    // Check all columns are visible.
    await assertActiveSectionColumns('Test', 'count');
  });
});
