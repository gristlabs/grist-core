import { assert, driver, Key } from 'mocha-webdriver';
import { setupTestSuite } from 'test/nbrowser/testUtils';
import * as gu from 'test/nbrowser/gristUtils';

describe('DuplicatePage', async function() {
  this.timeout('30s');
  const cleanup = setupTestSuite();
  let session: gu.Session;

  before(async () => {
    session = await gu.session().teamSite.login();
  });

  it('bug: should fix broken layout before duplicating a page', async function() {
    await session.tempNewDoc(cleanup);

    await gu.renameActiveSection("Tab1");

    // Add 2 sections, one table and second card.
    await gu.addNewSection('Table', 'Table1');
    await gu.renameActiveSection("Tab2");
    await gu.addNewSection('Card', 'Table1');
    await gu.renameActiveSection("Card1");

    // Now move this card section somewhere else (it will trigger layout save).
    const handle = await gu.detachFromLayout();
    await handle.moveTo('Tab1', { x: 200, y: 40 });
    await driver.findWait(".layout_editor_drop_targeter", 100);
    await handle.release();
    await handle.waitForSave();

    // And after layout was saved, remove it. Grist should be able to restore the layout properly.
    await gu.deleteWidget(await gu.getActiveSectionTitle());
    await gu.waitForServer();

    // And now duplicate this page.
    await gu.duplicatePage(await gu.getCurrentPageName());

    // We should see 2 sections. There was a bug here, and Tab1 was seen twice.
    assert.deepEqual(await gu.getSectionTitles(), ["Tab1", "Tab2"]);
  });

  it('should allow duplicating a page', async function() {
    await session.tempDoc(cleanup, 'World.grist');

    // check pages and content
    assert.deepEqual(await gu.getPageNames(), ['City', 'Country', 'CountryLanguage']);
    assert.deepEqual(
      await driver.findAll('.test-treeview-itemHeader.selected .test-docpage-label', e => e.getText()),
      ['City'],
    );

    // duplicate 'Country'
    await gu.openPageMenu('Country');
    await driver.find('.test-docpage-duplicate').click();
    await driver.find('.test-modal-confirm').click();
    await driver.findContentWait('.test-docpage-label', /copy/, 2000);
    await gu.waitForServer();

    // check pages
    assert.deepEqual(await gu.getPageNames(), ['City', 'Country', 'CountryLanguage', 'Country (copy)']);

    // check copy has focus
    assert.deepEqual(
      await driver.findAll('.test-treeview-itemHeader.selected .test-docpage-label', e => e.getText()),
      ['Country (copy)'],
    );

    // check layout is correct
    assert.deepEqual(
      await driver.find('.layout_hbox').findAll('.test-viewsection-title', e => e.getText()),
      ['COUNTRY'],
    );
    assert.deepEqual(
      await driver.find('.layout_hbox:nth-child(2)').findAll('.test-viewsection-title', e => e.getText()),
      ['COUNTRY Card List', 'CITY', 'COUNTRYLANGUAGE'],
    );

    // check country language view fields are correct
    await gu.selectSectionByTitle('COUNTRYLANGUAGE');
    await gu.toggleSidePanel('right', 'open');
    assert.deepEqual(
      await driver.findAll('.test-vfc-visible-fields .kf_draggable', e => e.getText()),
      ['Language', 'IsOfficial', 'Percentage']);
    assert.deepEqual(
      await driver.findAll('.test-vfc-hidden-fields .kf_draggable', e => e.getText()),
      ['Country']);
    await gu.toggleSidePanel('right', 'close');

    // check detail view is linked
    await gu.selectSectionByTitle("COUNTRY");
    await gu.getCell(0, 1).click();
    assert.deepEqual(await gu.getDetailCell('Name', 1, 'COUNTRY Card List').getText(), 'Aruba');
    await gu.getCell(0, 2).click();
    assert.deepEqual(await gu.getDetailCell('Name', 1, 'COUNTRY Card List').getText(), 'Afghanistan');

    // check undo works has expected
    await gu.undo();
    assert.deepEqual(await gu.getPageNames(), ['City', 'Country', 'CountryLanguage']);
    assert.deepEqual(
      await driver.findAll('.test-treeview-itemHeader.selected .test-docpage-label', e => e.getText()),
      ['City'],
    );

    // sort CITY
    await gu.openColumnMenu({ col: 'Country', section: 'CITY' });
    await driver.find('.grist-floating-menu').find('.test-sort-asc').click();
    await gu.openSectionMenu('sortAndFilter');
    await driver.find('.grist-floating-menu .test-section-menu-btn-save').click();
    await gu.waitForServer();
    assert.deepEqual(await gu.getVisibleGridCells('Country', [1, 5, 6]), ['Afghanistan', 'Albania', 'Algeria']);

    // duplicate CITY
    await gu.openPageMenu('City');
    await driver.find('.test-docpage-duplicate').click();
    await driver.find('.test-modal-confirm').click();
    await driver.findContentWait('.test-docpage-label', /copy/, 1000);
    await gu.waitForServer();

    // check sort is has expected
    assert.deepEqual(await gu.getVisibleGridCells('Country', [1, 5, 6]), ['Afghanistan', 'Albania', 'Algeria']);

    // check layout Card List is correct
    assert.deepEqual(
      await driver.find('.g_record_detail')
        .findAll('.layout_hbox', hbox => hbox
          .findAll('.g_record_detail_label', e => e.getText())),
      [['Name', 'Country', 'Pop. \'000'], ['District', 'Population']],
    );
  });

  it("should copy filters", async () => {
    const clickPlus = () => driver.find('.active_section .test-add-filter-btn').click();
    const openFilter = (name: string) => driver.findContent(".active_section .test-filter-field", name).click();
    const selectedFilters = async () =>
      (
        await driver.findAll(".test-filter-menu-list label",
          async e => (await e.find("input").matches(":checked"))
            ? (await e.find(".test-filter-menu-value").getText())
            : "")
      ).filter(x => x);
    const selectColumn = (name: string) => driver.findContent('.grist-floating-menu li', name).click();
    const clickNone = () => driver.findContent('.test-filter-menu-bulk-action', /None/).click();
    const clickFilterValue = (name: string) => driver.findContent('.test-filter-menu-list label', name).click();
    const othersSelected = () =>
      driver
        .findContent(".test-filter-menu-summary label", /Others/)
        .find("input")
        .matches(":checked");
    const futureSelected = () =>
      driver
        .findContent(".test-filter-menu-summary label", /Future values/)
        .find("input")
        .matches(":checked");
    const apply = () => driver.find(".test-filter-menu-apply-btn").click();
    const save = async () => {
      await driver.find(".active_section .test-section-menu-small-btn-save").click();
      await gu.waitForServer();
    };
    const filters = () => driver.findAll('.active_section .test-filter-bar .test-filter-field', e => e.getText());

    // Filter Country Section.
    await gu.getPageItem("Country").click();
    await gu.selectSectionByTitle("COUNTRY");
    await gu.openColumnMenu('Continent', 'Filter');
    await clickNone();
    await clickFilterValue("South America");
    await apply();
    await save();

    await clickPlus();
    await selectColumn("Code");
    await clickNone();
    await clickFilterValue("ARG");
    await clickFilterValue("BRA");
    await clickFilterValue("BOL");
    await apply();
    await save();

    // Add filter, but don't apply, should not be copied.
    await openFilter("Code");
    await clickFilterValue("COL");
    await apply();

    // Select third row (BRA) - to filter COUNTRYLANGUAGE
    await gu.getCell(0, 3).click();

    // Filter COUNTRYLANGUAGE, by Language, no future
    await gu.selectSectionByTitle('COUNTRYLANGUAGE');
    await gu.openColumnMenu('Language', 'Filter');
    await clickNone();
    await clickFilterValue("German");
    await clickFilterValue("Italian");
    await apply();
    await save();

    // duplicate 'Country'
    await gu.openPageMenu('Country');
    await driver.find('.test-docpage-duplicate').click();
    // Input will select text on focus, which can alter the text we enter,
    // so make sure we type correct value.
    await gu.waitToPass(async () => {
      const input = driver.find('.test-modal-dialog input');
      await input.click();
      await gu.selectAll();
      await driver.sendKeys("Filtered");
      assert.equal(await input.value(), "Filtered");
    });
    await driver.find('.test-modal-confirm').click();
    await driver.findContentWait('.test-docpage-label', /Filtered/, 2000);
    await gu.waitForServer();
    await gu.getPageItem("Filtered").click(); // click to make sure it was duplicated
    await gu.checkForErrors();

    // Check Code and Continent are pinned to the filter bar
    await gu.selectSectionByTitle('COUNTRY');
    assert.deepEqual(await filters(), ['Code', 'Continent']);
    await openFilter("Code");
    assert.deepEqual(await selectedFilters(), ["ARG", "BOL", "BRA"]);
    assert.isFalse(await othersSelected());
    await driver.sendKeys(Key.ESCAPE);

    await openFilter("Continent");
    assert.deepEqual(await selectedFilters(), ["South America"]);
    assert.isFalse(await othersSelected());
    await driver.sendKeys(Key.ESCAPE);

    // Select third row
    await gu.getCell(0, 3).click();

    await gu.selectSectionByTitle('COUNTRYLANGUAGE');
    assert.deepEqual(await filters(), ['Language']);
    await openFilter("Language");
    assert.deepEqual(await selectedFilters(), ["German", "Italian"]);
    assert.isFalse(await futureSelected());
    await driver.sendKeys(Key.ESCAPE);

    await gu.selectSectionByTitle('CITY');
    assert.deepEqual(await selectedFilters(), []);

    await gu.undo();
    assert.deepEqual(await gu.getPageNames(), ['City', 'Country', 'CountryLanguage', 'City (copy)']);
    await gu.checkForErrors();
  });
});
