import {assert, driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';

describe('RightPanel', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  afterEach(() => gu.checkForErrors());

  it('should focus on the creator panel when chart/custom section is added', async () => {
    const mainSession = await gu.session().teamSite.login();
    await mainSession.tempNewDoc(cleanup);

    // Reset prefs.
    await driver.executeScript('resetDismissedPopups();');
    await gu.waitForServer();

    // Refresh for a clean start.
    await gu.reloadDoc();

    // Close panel and make sure it stays closed.
    await gu.toggleSidePanel('right', 'close');

    // Add a chart section.
    await gu.addNewSection('Chart', 'Table1', { dismissTips: true});
    assert.isFalse(await gu.isSidePanelOpen('right'));
    await gu.undo();

    // Add a chart page.
    await gu.addNewPage('Chart', 'Table1');
    assert.isFalse(await gu.isSidePanelOpen('right'));
    await gu.undo();

    // Add a custom section.
    await gu.addNewSection('Custom', 'Table1');
    assert.isFalse(await gu.isSidePanelOpen('right'));
    await gu.undo();

    // Add a custom page.
    await gu.addNewPage('Custom', 'Table1');
    assert.isFalse(await gu.isSidePanelOpen('right'));
    await gu.undo();

    // Now open the panel on the column tab.
    const columnTab = async () => {
      await gu.toggleSidePanel('right', 'open');
      await driver.find('.test-right-tab-field').click();
    };

    await columnTab();

    // Add a chart section.
    await gu.addNewSection('Chart', 'Table1');
    assert.isTrue(await gu.isSidePanelOpen('right'));
    assert.isTrue(await driver.find('.test-right-widget-title').isDisplayed());
    await gu.undo();

    await columnTab();

    // Add a chart page.
    await gu.addNewPage('Chart', 'Table1');
    assert.isTrue(await gu.isSidePanelOpen('right'));
    assert.isTrue(await driver.find('.test-right-widget-title').isDisplayed());
    await gu.undo();

    await columnTab();

    // Add a custom section.
    await gu.addNewSection('Custom', 'Table1');
    assert.isTrue(await gu.isSidePanelOpen('right'));
    assert.isTrue(await driver.find('.test-right-widget-title').isDisplayed());
    await gu.undo();

    await columnTab();

    // Add a custom page.
    await gu.addNewPage('Custom', 'Table1');
    assert.isTrue(await gu.isSidePanelOpen('right'));
    assert.isTrue(await driver.find('.test-right-widget-title').isDisplayed());
    await gu.undo();
  });

  it('should open/close panel, and reflect the current section', async function() {
    // Open a document with multiple views and multiple sections.
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", 'nasa');
    const doc = await gu.importFixturesDoc('chimpy', 'nasa', 'Horizon', 'World.grist', false);
    await driver.get(`${server.getHost()}/o/nasa/doc/${doc.id}`);

    // Check current view and section name.
    assert.equal(await gu.getActiveSectionTitle(6000), 'CITY');
    assert.equal(await driver.find('.test-bc-page').getAttribute('value'), 'City');

    // Open side pane, and check it shows the right section.
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-config-widget').click();
    assert.equal(await gu.isSidePanelOpen('right'), true);

    assert.equal(await driver.find('.test-right-widget-title').value(), 'CITY');

    // Check that the tab's name reflects suitable text
    assert.equal(await driver.find('.test-right-tab-pagewidget').getText(), 'Table');
    assert.equal(await driver.find('.test-right-tab-field').getText(), 'Column');

    // Switch to Field tab, check that it shows the right field.
    await driver.find('.test-right-tab-field').click();
    assert.equal(await driver.find('.test-field-label').value(), "Name");

    // Check to a different field, check a different field is shown.
    await driver.sendKeys(Key.RIGHT);
    assert.equal(await driver.find('.test-field-label').value(), "Country");

    // Click to a different section, check a different field is shown.
    await gu.getSection('CITY Card List').find('.detail_row_num').click();
    assert.equal(await driver.find('.test-field-label').value(), "Name");

    // Check that the tab's name reflects suitable text
    assert.equal(await driver.find('.test-right-tab-pagewidget').getText(), 'Card List');
    assert.equal(await driver.find('.test-right-tab-field').getText(), 'Field');

    // Close panel, check it's hidden.
    await gu.toggleSidePanel('right');
    assert.equal(await gu.isSidePanelOpen('right'), false);
    assert.equal(await driver.find('.config_item').isPresent(), false);

    // Reopen panel, check it's still right.
    await gu.toggleSidePanel('right');
    assert.equal(await driver.find('.test-field-label').value(), "Name");

    // Switch to the section tab, check the new section is reflected.
    await driver.find('.test-right-tab-pagewidget').click();
    assert.equal(await driver.find('.test-right-widget-title').value(), 'CITY Card List');

    // Switch to a different view, check the new section is reflected.
    await driver.findContent('.test-treeview-itemHeader', /Country/).click();
    assert.equal(await driver.find('.test-right-widget-title').value(), 'COUNTRY');

    // Switch to field tab; check the new field is reflected.
    await driver.find('.test-right-tab-field').click();
    assert.equal(await driver.find('.test-field-label').value(), "Code");
  });

  it('should not cause errors when switching pages with Field tab open', async () => {
    // There was an error ("this.calcSize is not a function") switching between pages when the
    // active section changes type and Field tab is open, triggered by an unnecessary rebuilding
    // of FieldConfigTab.

    // Check that the active field tab is called "Column" (since the active section is "Table")
    // and is open to column "Code".
    assert.equal(await driver.find('.test-right-tab-field').getText(), 'Column');
    assert.equal(await driver.find('.test-field-label').value(), "Code");

    // Switch to the "City" page. Check that the tab is now called "Field" (since the active section is of
    // type "CardList"), and open to the field "Name".
    await driver.findContent('.test-treeview-itemHeader', /City/).click();
    assert.equal(await driver.find('.test-right-tab-field').getText(), 'Field');
    assert.equal(await driver.find('.test-field-label').value(), "Name");

    // Check that this did not cause client-side errors.
    await gu.checkForErrors();

    // Now switch back, and check for errors again.
    await driver.findContent('.test-treeview-itemHeader', /Country/).click();
    await gu.checkForErrors();
  });

  it('should show tools when requested', async function() {
    // Select specific view/section/field. Close side-pane.
    await gu.getCell({col: "Name", rowNum: 3}).click();
    assert.equal(await driver.find('.test-field-label').value(), "Name");
    await gu.toggleSidePanel('right');
    assert.equal(await gu.isSidePanelOpen('right'), false);

    // Click Activity Log.
    assert.equal(await driver.find('.action_log').isPresent(), false);
    await driver.find('.test-tools-log').click();
    await gu.waitToPass(() =>   // Click might not work while panel is sliding out to open.
      driver.findContentWait('.test-doc-history-tabs .test-select-button', 'Activity', 500).click());

    // Check that panel is shown, and correct.
    assert.equal(await gu.isSidePanelOpen('right'), true);
    assert.equal(await driver.find('.test-right-tab-field').isPresent(), false);
    assert.equal(await driver.find('.action_log').isDisplayed(), true);

    // Click "x", Check expected section config shown.
    await driver.find('.test-right-tool-close').click();
    assert.equal(await driver.find('.test-right-tab-field').getText(), 'Column');
    assert.equal(await driver.find('.test-field-label').value(), "Name");

    // TODO: polish data validation and then uncomment
    /*
    // Click Validations. Check it's shown and correct.
    await driver.find('.test-tools-validate').click();
    assert.equal(await driver.findContent('.config_item', /Validations/).isDisplayed(), true);

    // Close panel. Switch to another view.
    await gu.toggleSidePanel('right');
    assert.equal(await gu.isSidePanelOpen('right'), false);
    assert.equal(await driver.findContent('.config_item', /Validations/).isPresent(), false);
    await driver.findContent('.test-treeview-itemHeader', /Country/).click();

    // Open panel. Check Validations are still shown.
    await gu.toggleSidePanel('right');
    assert.equal(await driver.findContent('.config_item', /Validations/).isDisplayed(), true);
    await driver.find('.test-right-tool-close').click();
    */
  });

  it('should keep panel state on reload', async function() {
    // Check the panel is currently open and showing Field options.
    assert.equal(await gu.isSidePanelOpen('right'), true);
    assert.equal(await driver.find('.test-field-label').value(), "Name");

    // Reload the page, and click the same cell as before.
    await driver.navigate().refresh();
    assert.equal(await gu.getActiveSectionTitle(3000), 'COUNTRY');
    await gu.waitForServer();
    await gu.getCell({col: "Name", rowNum: 3}).click();

    // Check the panel is still open and showing the same Field options.
    assert.equal(await gu.isSidePanelOpen('right'), true);
    assert.equal(await driver.find('.test-field-label').value(), "Name");
  });

  it('\'SELECTOR FOR\' should work correctly', async function() {
    // open the Data tab
    await driver.find('.test-right-tab-pagewidget').click();
    await driver.find('.test-config-data').click();

    // open a page that has linked section
    await driver.findContent('.test-treeview-itemHeader', /Country/).click();

    // wait for data to load
    assert(await gu.getActiveSectionTitle(3000));
    await gu.waitForServer();

    // select a view section that does not select other section
    await gu.getSection('COUNTRY Card List').click();

    // check that selector-for is not present
    assert.equal(await driver.find('.test-selector-for').isPresent(), false);

    // select a view section that does select other section
    await gu.getSection('COUNTRY').click();

    // check that selector-of is present and that all selected section are listed
    assert.equal(await driver.find('.test-selector-for').isPresent(), true);
    assert.deepEqual(await driver.findAll('.test-selector-for-entry', (e) => e.getText().then(s => s.split('\n')[0])), [
      "CITY",
      "COUNTRYLANGUAGE",
      "COUNTRY Card List",
    ]);
  });

  it('\'Edit Data Selection\' should allow to change link', async () => {
    // select COUNTRY DETAIL
    await gu.getSection('CITY').click();

    // open page widget picker
    await driver.find('.test-pwc-editDataSelection').click();

    // remove link
    await driver.find('.test-wselect-selectby').doClick();
    await driver.findContent('.test-wselect-selectby option', /Select Widget/).doClick();

    // click save
    await driver.find('.test-wselect-addBtn').doClick();
    await gu.waitForServer();

    // Go to the first record.
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.UP));

    // Check that link was removed, by going to Aruba.
    await gu.getSection('COUNTRY').click();
    await gu.getCell(0, 1).click();
    // City section should stay where it was
    assert.equal(await gu.getCell(0, 1, 'CITY').getText(), 'Kabul');

    // re-set the link
    await gu.getSection('CITY').click();
    await driver.find('.test-pwc-editDataSelection').click();
    await driver.find('.test-wselect-selectby').click();
    await driver.findContent('.test-wselect-selectby option', /Country$/).click();
    await driver.find('.test-wselect-addBtn').doClick();
    await gu.waitForServer();

    // check link is set
    await gu.getSection('COUNTRY').click();
    await gu.getCell(0, 1).click();
    assert.equal(await gu.getCell(0, 1, 'CITY').getText(), 'Oranjestad');
  });

  it('should not cause errors when switching pages with Table tab open', async () => {
    // There were an error doing eigher one of 1) switching to `Code View`, or 2) removing the
    // active page, when the Table tab was open, because: both caused the activeView to be set to an
    // empty model causes some computed property of the ViewSectionRec to fail. This is what this
    // test is aiming at catching.

    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-config-widget').click();

    assert.deepEqual(await gu.getPageNames(), ['City', 'Country', 'CountryLanguage']);

    // adds a new page
    await gu.addNewPage(/Table/, /City/);

    assert.deepEqual(await gu.getPageNames(), ['City', 'Country', 'CountryLanguage', 'New page']);

    // remove that page
    await gu.openPageMenu(/New page/);
    await driver.find('.grist-floating-menu .test-docpage-remove').click();
    await gu.waitForServer();

    // check pages were removed and nothing break
    assert.deepEqual(await gu.getPageNames(), ['City', 'Country', 'CountryLanguage']);
    await gu.checkForErrors();

    // now switch to `Code View`
    await driver.find('.test-tools-code').click();
    assert.equal(await driver.findWait('.g-code-viewer', 1000).isPresent(), true);

    // check nothing broke
    await gu.checkForErrors();

    // switch back to City
    await gu.getPageItem(/City/).click();
  });

  it('should not cause errors when editing summary table with `Change Widget` button', async () => {
    // Changing the grouped by columns using the `Change Widget` used to throw `TypeError: Cannot
    // read property `toUpperCase` of undefined`. The goal of this test is to prevent future
    // regression.

    // Create a summary table of City groupbed by country
    await gu.addNewPage(/Table/, /City/, {summarize: [/Country/]});

    // open right panel Widget
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-right-tab-pagewidget').click();
    await driver.find('.test-config-widget').click();

    // click `Change Widget`
    await driver.findContent('.test-right-panel button', /Change Widget/).click();

    // remove column `Country` and save
    await gu.selectWidget(/Table/, /City/, {summarize: []});

    // check there were no error
    await gu.checkForErrors();
  });

  it('should not raise errors when opening with table\'s `Widget Options`', async function() {
    // Open right panel and select 'Column'
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-right-tab-field').click();

    // Close the right panel
    await gu.toggleSidePanel('right', 'close');

    // Open the right panel using the table's `Widget option`
    await gu.openSectionMenu('viewLayout');
    await driver.find('.test-widget-options').click();

    await gu.checkForErrors();
  });


});
