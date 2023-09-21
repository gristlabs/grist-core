import mapValues = require('lodash/mapValues');
import { assert, driver, Key } from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import { server, setupTestSuite } from 'test/nbrowser/testUtils';

describe("SelectBy", function() {
  this.timeout(20000);
  setupTestSuite();
  let doc: any;

  function formatOption(main: string, srcColumn?: string, tgtColumn?: string) {
    let ret = main;
    ret += srcColumn ? ' \u2022 ' + srcColumn : '';
    ret += tgtColumn ? ' \u2192 ' + tgtColumn : '';
    return ret;
  }

  it("should offer correct options", async () => {
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", "nasa");
    doc = await gu.importFixturesDoc('chimpy', 'nasa', 'Horizon', 'selectBy.grist', false);

    // check tables
    const api = gu.createHomeApi('Chimpy', 'nasa');
    assert.deepInclude(await api.getTable(doc.id, '_grist_Tables'), {
      id: [1, 2, 3, 4],
      tableId: ['Table1', 'Table2', 'Table3', 'Table3_summary_A'],
      summarySourceTable: [0, 0, 0, 3],
    });

    // check visible columns (no manualSort columns)
    const allColumns = await api.getTable(doc.id, '_grist_Tables_column');
    const visibleColumns = mapValues(allColumns, (vals) => vals.filter((v, i) => allColumns.colId[i] !== 'manualSort'));
    assert.deepInclude(visibleColumns, {
      id: [2, 3, 6, 10, 12, 13, 14, 15, 16],
      colId: ['table2_ref', 'table3_ref', 'table3_ref', 'A', 'A', 'table3_ref_2', 'A', 'group', 'count'],
      parentId: [1, 1, 2, 3, 1, 1, 4, 4, 4],
      type: ['Ref:Table2', 'Ref:Table3', 'Ref:Table3', 'Numeric', 'Text', 'Ref:Table3', 'Numeric',
             'RefList:Table3', 'Int'],
      label: ['table2_ref', 'table3_ref', 'table3_ref', 'A', 'A', 'table3_ref_2', 'A', 'group', 'count'],
    });

    // open document
    await driver.get(`${server.getHost()}/o/nasa/doc/${doc.id}`);

    // create a new page with table1 and table2 as 2 tables
    await gu.addNewPage(/Table/, /Table1/);
    await gu.addNewSection(/Table/, /Table2/);

    // beginning adding a new widget to page
    await driver.findWait('.test-dp-add-new', 2000).doClick();
    await driver.findWait('.test-dp-add-widget-to-page', 2000).doClick();

    // select /Table/ /Table1/ and check options of `SELECT BY` drop down
    await driver.findContent('.test-wselect-table', /Table1/).doClick();
    await driver.findContent('.test-wselect-type', /Table/).doClick();
    await driver.find('.test-wselect-selectby').doClick();
    assert.deepEqual(
      // let's ignore the first option which is an internal added by grainjs
      await driver.findAll('.test-wselect-selectby option:not(:first-of-type)', (e) => e.getText()), [
        // note: this is a very contrived example to test various possible links. Real world use
        // cases are expected to be simpler, resulting in simpler list of options that are easier to
        // navigate for the user than this one (in particular the `->` separator might rarely show
        // up).
        formatOption('Select Widget'),
        formatOption("TABLE1"),
        formatOption("TABLE1", 'table2_ref'),
        formatOption('TABLE1', 'table3_ref', 'table3_ref'),
        formatOption('TABLE1', 'table3_ref', 'table3_ref_2'),
        formatOption('TABLE1', 'table3_ref_2', 'table3_ref'),
        formatOption('TABLE1', 'table3_ref_2', 'table3_ref_2'),
        formatOption('TABLE2'),
        formatOption('TABLE2', 'table3_ref', 'table3_ref'),
        formatOption('TABLE2', 'table3_ref', 'table3_ref_2'),
      ]
    );

    // select Table2 and check options of `SELECT BY` drop down
    await driver.findContent('.test-wselect-table', /Table2/).doClick();
    await driver.find('.test-wselect-selectby').doClick();
    assert.deepEqual(
      await driver.findAll('.test-wselect-selectby option:not(:first-of-type)', (e) => e.getText()), [
        formatOption('Select Widget'),
        formatOption('TABLE1', 'table2_ref'),
        formatOption('TABLE1', 'table3_ref'),
        formatOption('TABLE1', 'table3_ref_2'),
        formatOption('TABLE2'),
        formatOption('TABLE2', 'table3_ref')
      ]
    );

    // Selecting "New Table" should show no options.
    await driver.findContent('.test-wselect-table', /New Table/).doClick();
    assert.equal(await driver.find('.test-wselect-selectby').isPresent(), false);
    assert.lengthOf(await driver.findAll('.test-wselect-selectby option'), 0);
    // Selecting a regular table should show options again.
    await driver.findContent('.test-wselect-table', /Table2/).doClick();
    assert.equal(await driver.find('.test-wselect-selectby').isPresent(), true);
    assert.lengthOf(await driver.findAll('.test-wselect-selectby option'), 7);


    // Create a page with with charts and custom widget and then check that no linking is offered
    await gu.addNewPage(/Chart/, /Table1/);
    await gu.addNewSection(/Custom/, /Table2/);

    // open add widget to page
    await driver.findWait('.test-dp-add-new', 2000).doClick();
    await driver.findWait('.test-dp-add-widget-to-page', 2000).doClick();

    // select /Table/ /Table1/ and check no options are available
    await driver.findContent('.test-wselect-table', /Table1/).doClick();
    await driver.findContent('.test-wselect-type', /Table/).doClick();
    assert.equal(await driver.find('.test-wselect-selectby').isPresent(), false);

    // select Table2 and check no options are available
    await driver.findContent('.test-wselect-table', /Table2/).doClick();
    assert.equal(await driver.find('.test-wselect-selectby').isPresent(), false);
  });

  it('should handle summary table correctly', async () => {

    // Notice that table of view 4 is a summary of Table3
    const api = gu.createHomeApi('Chimpy', 'nasa');
    assert.deepInclude((await api.getTable(doc.id, '_grist_Tables')), {
      id: [1, 2, 3, 4],
      tableId: ['Table1', 'Table2', 'Table3', 'Table3_summary_A'],
      summarySourceTable: [0, 0, 0, 3],
    });

    // open Summary page
    await driver.get(`${server.getHost()}/o/nasa/doc/${doc.id}/p/4`);

    // add new widget to page
    await driver.findWait('.test-dp-add-new', 2000).doClick();
    await driver.findWait('.test-dp-add-widget-to-page', 2000).doClick();

    // select Table3 and summarize
    await driver.findContent('.test-wselect-table', /Table3/).find('.test-wselect-pivot').doClick();

    // check selectBy options
    assert.deepEqual(
      await driver.findAll('.test-wselect-selectby option:not(:first-of-type)', (e) => e.getText()),
      [],
    );
    await driver.sendKeys(Key.ESCAPE);
  });

  it('should show nav buttons for card view linked to its summary', async function() {
    // Still on the page with summary of Table3, add a new Card widget linked to the summary
    await gu.addNewSection(/Card$/, /Table3/, {selectBy: /TABLE3.*by A/});

    // Check that we have a card view.
    await gu.getCell({section: 'TABLE3 [by A]', rowNum: 1, col: 'A'}).click();
    const section = await gu.getSection('TABLE3 Card');
    assert.equal(await gu.getDetailCell({section, rowNum: 1, col: 'A'}).getText(), '1');

    // Check there are nav buttons in the card view.
    assert.equal(await section.find('.detail-button.detail-left').isPresent(), true);
    assert.equal(await section.find('.detail-button.detail-right').isPresent(), true);
    assert.equal(await section.find('.grist-single-record__menu__count').getText(), '1 OF 1');

    // Now add a record to the source table using the card view.
    await section.find('.detail-button.detail-add-btn').click();
    assert.equal(await gu.getDetailCell({section, rowNum: 1, col: 'A'}).getText(), '');
    await gu.getDetailCell({section, rowNum: 1, col: 'A'}).click();
    await gu.sendKeys('1', Key.ENTER);
    await gu.waitForServer();

    // Check that this group now has 2 records.
    assert.equal(await section.find('.grist-single-record__menu__count').getText(), '2 OF 2');

    // There is another group that still has one record.
    await gu.getCell({section: 'TABLE3 [by A]', rowNum: 2, col: 'A'}).click();
    assert.equal(await section.find('.grist-single-record__menu__count').getText(), '1 OF 1');
  });

  it('should save link correctly', async () => {

    // create new page with table2 as a table
    await gu.addNewPage(/Table/, /Table2/);

    // begin adding table1 as a table to page
    await driver.findWait('.test-dp-add-new', 2000).doClick();
    await driver.findWait('.test-dp-add-widget-to-page', 2000).doClick();
    await driver.findContent('.test-wselect-table', /Table1/).doClick();

    // select link
    await driver.find('.test-wselect-selectby').doClick();
    await driver.findContent('.test-wselect-selectby option', /Table2/i).doClick();

    // click `add to page` btn
    await driver.find('.test-wselect-addBtn').doClick();
    await gu.waitForServer();

    // check new section added and check content
    assert.deepEqual(await gu.getVisibleGridCells(1, [1, 2]), ['a', 'b']);

    // select other row in selector section
    await gu.getSection('Table2').doClick();
    await gu.getCell({col: 0, rowNum: 2}).doClick();

    // check that linked section was filterd
    await gu.getSection('Table1').doClick();
    assert.deepEqual(await gu.getVisibleGridCells(1, [1, 2]), ['c', 'd']);

    // check that an single undo remove the section
    await gu.undo();
    assert.equal(await gu.getSection('Table1').isPresent(), false);

    // check that a single redo add and link the section
    await gu.redo();
    await gu.getSection('Table1').doClick();
    assert.deepEqual(await gu.getVisibleGridCells(1, [1, 2]), ['a', 'b']);
  });

});
