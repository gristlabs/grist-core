import { addToRepl, assert, driver} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';

describe('RightPanelSelectBy', function() {
  this.timeout(20000);
  setupTestSuite();
  addToRepl('gu2', gu);

  async function setup() {
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", 'nasa');
    const doc = await gu.importFixturesDoc('chimpy', 'nasa', 'Horizon', 'Favorite_Films_With_Linked_Ref.grist', false);
    await driver.get(`${server.getHost()}/o/nasa/doc/${doc.id}`);
    await gu.waitForDocToLoad();
  }

  it('should allow linking section with same table', async function() {
    await setup();

    // open page `All`
    await driver.findContentWait('.test-treeview-itemHeader', /All/, 2000).click();
    await gu.waitForDocToLoad();

    await gu.openSelectByForSection('PERFORMANCES DETAIL');

    // the dollar in /...record$/ makes sure we match against the table main node and not a ref
    // columns such as '...record.Film'
    assert.equal(await driver.findContent('.test-select-row', /Performances record$/).isPresent(), true);
  });

  it('should not allow linking same section', async function() {
    assert.equal(await driver.findContent('.test-select-row', /Performances detail/i).isPresent(), false);
  });

  it('should allow linking to/from a ref column', async function() {
    // Performance record.Film links both from a ref column and to a ref column
    assert.equal(await driver.findContent('.test-select-row', /Performances record.*Film/i).isPresent(), true);
  });

  it('should successfully link on select', async function() {
    // select a link
    await driver.findContent('.test-select-row', /Performances record$/).click();
    await gu.waitForServer();

    // Check that selections in 1st section are mirrored by the 2nd section.
    await gu.getSection('PERFORMANCES RECORD').click();
    await gu.getCell(0, 3).click();
    assert.equal(await driver.find('.g_record_detail_value').getText(), 'Don Rickles');
  });

  it('should allow to remove link', async function() {
    await gu.openSelectByForSection('PERFORMANCES DETAIL');
    await driver.findContent('.test-select-row', /Select Widget/).click();
    await gu.waitForServer();

    // Check that selections in 1st section are NOT mirrored by the 2nd section.
    await gu.getSection('PERFORMANCES RECORD').click();
    await gu.getCell(0, 1).click();
    assert.equal(await driver.find('.g_record_detail_value').getText(), 'Don Rickles');

    // undo, link is expected to be set for next test
    await gu.undo();
  });


  it('should disallow creating cycles if not cursor-linked', async function() {

    //Link "films record" by "performances record"
    await gu.openSelectByForSection('FILMS RECORD');
    await driver.findContent('.test-select-row', /Performances record.*Film/i).click();
    await gu.waitForServer();

    // this link should no longer be present, since it would create a cycle with a filter link in it
    await gu.openSelectByForSection('PERFORMANCES RECORD');
    assert.equal(await driver.findContent('.test-select-row', /Performances record.*Film/i).isPresent(), false);
  });

  it('should allow creating cursor-linked-cycles', async function() {
    assert.equal(await driver.findContent('.test-select-row', /Performances detail/).isPresent(), true);

    // undo, the operation from the previous test; link is expected to be unset for next test
    await gu.undo();
  });


  it('should not allow selecting from a chart or custom sections', async function() {
    // open the 'Films' page
    await driver.findContent('.test-treeview-itemHeader', /Films/).click();
    await gu.waitForDocToLoad();

    // Adds a chart widget
    await gu.addNewSection(/Chart/, /Films/);

    // open `SELECT BY`
    await gu.openSelectByForSection('FILMS');

    // check that there is a chart and we cannot link from it
    assert.equal(await gu.getSection('FILMS CHART').isPresent(), true);
    assert.equal(await driver.findContent('.test-select-row', /Films chart/).isPresent(), false);

    // undo
    await gu.undo();
  });

  it('should update filter-linking tied to reference when value changes', async function() {
    // Add a filter-linked section (of Performances) tied to a Ref column (FRIENDS.Favorite_Film).
    await gu.getPageItem('Friends').click();
    await gu.waitForServer();
    await gu.addNewSection(/Table/, /Performances/);
    await gu.openSelectByForSection('Performances');
    assert.equal(await driver.findContent('.test-select-row', /FRIENDS.*Favorite Film/).isPresent(), true);
    await driver.findContent('.test-select-row', /FRIENDS.*Favorite Film/).click();
    await gu.waitForServer();

    // Select a row in FRIENDS.
    const cell = await gu.getCell({section: 'Friends', col: 'Favorite Film', rowNum: 6});
    assert.equal(await cell.getText(), 'Alien');
    await cell.click();

    // Check that the linked table reflects the selected row.
    assert.deepEqual(await gu.getVisibleGridCells(
      {section: 'Performances', cols: ['Actor', 'Film'], rowNums: [1, 2]}), [
        'Sigourney Weaver', 'Alien',
        '', '',
      ]);

    // Change a value in FRIENDS.Favorite_Film column.
    await gu.sendKeys('Toy');
    await driver.findContent('.test-ref-editor-item', /Toy Story/).click();
    await gu.waitForServer();

    // Check that the linked table of Performances got updated.
    assert.deepEqual(await gu.getVisibleGridCells(
      {section: 'Performances', cols: ['Actor', 'Film'], rowNums: [1, 2, 3, 4]}), [
        'Tom Hanks', 'Toy Story',
        'Tim Allen', 'Toy Story',
        'Don Rickles', 'Toy Story',
        '', ''
      ]);

    await gu.undo(2);
  });

  it('should update cursor-linking tied to reference when value changes', async function() {
    // Add a cursor-linked card widget (of Films) tied to a Ref column (FRIENDS.Favorite_Film).
    await gu.getPageItem('Friends').click();
    await gu.waitForServer();
    await gu.addNewSection(/Card/, /Films/);
    await gu.openSelectByForSection('Films Card');
    assert.equal(await driver.findContent('.test-select-row', /FRIENDS.*Favorite Film/).isPresent(), true);
    await driver.findContent('.test-select-row', /FRIENDS.*Favorite Film/).click();
    await gu.waitForServer();

    // Select a row in FRIENDS.
    const cell = await gu.getCell({section: 'Friends', col: 'Favorite Film', rowNum: 6});
    assert.equal(await cell.getText(), 'Alien');
    await cell.click();

    // Check that the linked card reflects the selected row.
    assert.equal(await driver.find('.g_record_detail_value').getText(), 'Alien');
    assert.equal(await driver.findContent('.g_record_detail_value', /19/).getText(), 'May 25th, 1979');

    // Change the value in FRIENDS.Favorite_Film column.
    await gu.sendKeys('Toy');
    await driver.findContent('.test-ref-editor-item', /Toy Story/).click();
    await gu.waitForServer();

    // Check that the linked card of Films got updated.
    assert.equal(await driver.find('.g_record_detail_value').getText(), 'Toy Story');
    assert.equal(await driver.findContent('.g_record_detail_value', /19/).getText(), 'November 22nd, 1995');

    // Select the 'new' row in FRIENDS.
    const newCell = await gu.getCell({section: 'Friends', col: 'Favorite Film', rowNum: 7});
    assert.equal(await newCell.getText(), '');
    await newCell.click();

    // Card should have also moved to the 'new' record
    const cardFields = await driver.findAll('.g_record_detail_value');
    for (const cardField of cardFields) {
      assert.equal(await cardField.getText(), '');
    }

    await gu.undo(2);
  });


  it('should have linked card for friends', async () => {
    // Open the All page.
    await driver.findContentWait('.test-treeview-itemHeader', /Linked Friends/, 2000).click();
    await gu.waitForDocToLoad();

    await driver.findContentWait('.field_clip', /Mary/, 2000).click();
    await gu.waitForServer();
    await driver.findContentWait('.g_record_detail_label', /Title/, 2000).click();
    assert.equal(await gu.getActiveCell().getText(), 'Alien');

    await driver.findContentWait('.field_clip', /Jarek/, 2000).click();
    await gu.waitForServer();
    await driver.findContentWait('.g_record_detail_label', /Title/, 2000).click();
    assert.equal(await gu.getActiveCell().getText(), '');
  });

  xit('should list options following the order of the section in the view layout', async function() {
    // TODO
  });

});
