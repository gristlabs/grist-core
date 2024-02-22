import {addToRepl, assert, driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';
import {addStatic, serveSomething} from 'test/server/customUtil';
import {AccessLevel} from 'app/common/CustomWidget';

// Valid manifest url.
const manifestEndpoint = '/manifest.json';

let docId = '';

// Tester widget name.
const TESTER_WIDGET = 'Tester';
const NORMAL_WIDGET = 'Normal';
const READ_WIDGET = 'Read';
const FULL_WIDGET = 'Full';
const COLUMN_WIDGET = 'COLUMN_WIDGET';
const REQUIRED_WIDGET = 'REQUIRED_WIDGET';
// Custom URL label in selectbox.
const CUSTOM_URL = 'Custom URL';
// Holds url for sample widget server.
let widgetServerUrl = '';

// Creates url for Config Widget passing ready arguments in URL. This is not builtin method, Config Widget understands
// this parameter and is using it as an argument for the ready method.
function createConfigUrl(ready?: any) {
  return ready ? `${widgetServerUrl}/config?ready=` + encodeURI(JSON.stringify(ready)) : `${widgetServerUrl}/config`;
}

// Open or close widget menu.
const click = (selector: string) => driver.find(`${selector}`).click();
const toggleDrop = (selector: string) => click(`${selector} .test-select-open`);
const toggleWidgetMenu = () => toggleDrop('.test-config-widget-select');
const getOptions = () => driver.findAll('.test-select-menu li', el => el.getText());
// Get current value from widget menu.
const currentWidget = () => driver.find('.test-config-widget-select .test-select-open').getText();
// Select widget from the menu.
const clickOption = async (text: string | RegExp) => {
  await driver.findContent('.test-select-menu li', text).click();
  await gu.waitForServer();
};
// Persists custom options.
const persistOptions = () => click('.test-section-menu-small-btn-save');

// Helpers to create test ids for column pickers
const pickerLabel = (name: string) => `.test-config-widget-label-for-${name}`;
const pickerDrop = (name: string) => `.test-config-widget-mapping-for-${name}`;
const pickerAdd = (name: string) => `.test-config-widget-add-column-for-${name}`;

// Helpers to work with menus
async function clickMenuItem(name: string) {
  await driver.findContent('.grist-floating-menu li', name).click();
  await gu.waitForServer();
}
const getMenuOptions = () => driver.findAll('.grist-floating-menu li', el => el.getText());
async function getListItems(col: string) {
  return await driver
    .findAll(`.test-config-widget-map-list-for-${col} .test-config-widget-ref-select-label`, el => el.getText());
}

// When refreshing, we need to make sure widget repository is enabled once again.
async function refresh() {
  await driver.navigate().refresh();
  await gu.waitForDocToLoad();
  // Switch section and enable config
  await gu.selectSectionByTitle('Table');
  await driver.executeScript('window.gristConfig.enableWidgetRepository = true;');
  await gu.selectSectionByTitle('Widget');
}

// Checks if active section has option in the menu to open configuration
async function hasSectionOption() {
  const menu = await gu.openSectionMenu('viewLayout');
  const has = 1 === (await menu.findAll('.test-section-open-configuration')).length;
  await driver.sendKeys(Key.ESCAPE);
  return has;
}

async function saveMenu() {
  await driver.findWait('.active_section .test-section-menu-small-btn-save', 100).click();
  await gu.waitForServer();
}

async function revertMenu() {
  await driver.findWait('.active_section .test-section-menu-small-btn-revert', 100).click();
}

async function clearOptions() {
  await gu.openSectionMenu('sortAndFilter');
  await driver.findWait('.test-section-menu-btn-remove-options', 100).click();
  await driver.sendKeys(Key.ESCAPE);
}

// Check if the Sort menu is in correct state
async function checkSortMenu(state: 'empty' | 'modified' | 'customized' | 'emptyNotSaved') {
  // for modified and emptyNotSaved menu should be greyed and buttons should be hidden
  if (state === 'modified' || state === 'emptyNotSaved') {
    assert.isTrue(await driver.find('.active_section .test-section-menu-wrapper').matches('[class*=-unsaved]'));
  } else {
    assert.isFalse(await driver.find('.active_section .test-section-menu-wrapper').matches('[class*=-unsaved]'));
  }
  // open menu
  await gu.openSectionMenu('sortAndFilter');
  // for modified state, there should be buttons save and revert
  if (state === 'modified' || state === 'emptyNotSaved') {
    assert.isTrue(await driver.find('.test-section-menu-btn-save').isPresent());
  } else {
    assert.isFalse(await driver.find('.test-section-menu-btn-save').isPresent());
  }
  const text = await driver.find('.test-section-menu-custom-options').getText();
  if (state === 'empty' || state === 'emptyNotSaved') {
    assert.equal(text, '(empty)');
  } else if (state === 'modified') {
    assert.equal(text, '(modified)');
  } else if (state === 'customized') {
    assert.equal(text, '(customized)');
  }
  // there should be option to delete custom options
  if (state === 'empty' || state === 'emptyNotSaved') {
    assert.isFalse(await driver.find('.test-section-menu-btn-remove-options').isPresent());
  } else {
    assert.isTrue(await driver.find('.test-section-menu-btn-remove-options').isPresent());
  }
  await driver.sendKeys(Key.ESCAPE);
}

describe('CustomWidgetsConfig', function () {
  this.timeout('60s');
  const cleanup = setupTestSuite();
  let mainSession: gu.Session;
  gu.bigScreen();


  addToRepl('getOptions', getOptions);

  before(async function () {
    if (server.isExternalServer()) {
      this.skip();
    }
    // Create simple widget server that serves manifest.json file, some widgets and some error pages.
    const widgetServer = await serveSomething(app => {
      app.get('/manifest.json', (_, res) => {
        res.json([
          {
            // Main Custom Widget with onEditOptions handler.
            name: TESTER_WIDGET,
            url: createConfigUrl({onEditOptions: true}),
            widgetId: 'tester1',
          },
          {
            // Widget without ready options.
            name: NORMAL_WIDGET,
            url: createConfigUrl(),
            widgetId: 'tester2',
          },
          {
            // Widget requesting read access.
            name: READ_WIDGET,
            url: createConfigUrl({requiredAccess: AccessLevel.read_table}),
            widgetId: 'tester3',
          },
          {
            // Widget requesting full access.
            name: FULL_WIDGET,
            url: createConfigUrl({requiredAccess: AccessLevel.full}),
            widgetId: 'tester4',
          },
          {
            // Widget with column mapping
            name: COLUMN_WIDGET,
            url: createConfigUrl({requiredAccess: AccessLevel.read_table, columns: [{name:'Column', optional: true}]}),
            widgetId: 'tester5',
          },
          {
            // Widget with required column mapping
            name: REQUIRED_WIDGET,
            url: createConfigUrl({requiredAccess: AccessLevel.read_table, columns: [{name:'Column', optional: false}]}),
            widgetId: 'tester6',
          },
        ]);
      });
      addStatic(app);
    });
    cleanup.addAfterAll(widgetServer.shutdown);
    widgetServerUrl = widgetServer.url;
    await server.testingHooks.setWidgetRepositoryUrl(`${widgetServerUrl}${manifestEndpoint}`);

    mainSession = await gu.session().login();
    const doc = await mainSession.tempDoc(cleanup, 'CustomWidget.grist');
    docId = doc.id;
    // Make sure widgets are enabled.
    await driver.executeScript('window.gristConfig.enableWidgetRepository = true;');
    await gu.toggleSidePanel('right', 'open');
    await gu.selectSectionByTitle('Widget');
  });

  after(async function() {
    await server.testingHooks.setWidgetRepositoryUrl('');
  });

  beforeEach(async () => {
    // Before each test, we will switch to Custom Url (to cleanup the widget)
    // and then back to the Tester widget.
    if ((await currentWidget()) !== CUSTOM_URL) {
      await toggleWidgetMenu();
      await clickOption(CUSTOM_URL);
    }
    await toggleWidgetMenu();
    await clickOption(TESTER_WIDGET);
    await widget.waitForFrame();
  });

  it('should hide widget when some columns are not mapped', async () => {
    // Reset the widget to the one that has a column mapping requirements.
    await widget.resetWidget();

    // Since the widget was reset, we don't have .test-custom-widget-ready element.
    assert.isFalse(await driver.find('.test-custom-widget-ready').isPresent());

    // Now select the widget that requires a column.
    await toggleWidgetMenu();
    await clickOption(REQUIRED_WIDGET);
    await gu.acceptAccessRequest();

    // The widget iframe should be covered with a text explaining that the widget is not configured.
    assert.isTrue(await driver.findWait('.test-custom-widget-not-mapped', 1000).isDisplayed());

    // The content should at least have those words:
    assert.include(await driver.find('.test-custom-widget-not-mapped').getText(),
      "Some required columns aren't mapped");

    // Make sure that the iframe is not displayed.
    assert.isFalse(await driver.find('.test-custom-widget-ready').isPresent());

    // Now map the column.
    await toggleDrop(pickerDrop('Column'));

    // Map it to A.
    await clickOption('A');

    // Make sure that the text is gone.
    await gu.waitToPass(async () => {
      assert.isFalse(await driver.find('.test-config-widget-not-mapped').isPresent());
    });

    // Make sure the widget is now visible.
    assert.isTrue(await driver.find('.test-custom-widget-ready').isDisplayed());

    // And we see widget with info about mapped columns, Column to A.
    assert.deepEqual(await widget.onRecordsMappings(), {Column: 'A'});
  });

  it('should hide mappings when there is no good column', async () => {
    if ((await currentWidget()) !== CUSTOM_URL) {
      await toggleWidgetMenu();
      await clickOption(CUSTOM_URL);
    }
    await gu.setWidgetUrl(
      createConfigUrl({
        columns: [{name: 'M2', type: 'Date', optional: true}],
        requiredAccess: 'read table',
      })
    );

    await widget.waitForFrame();
    await gu.acceptAccessRequest();
    await widget.waitForPendingRequests();

    // Get the drop for M2 mappings.
    const mappingsForM2 = () => driver.find(pickerDrop('M2'));

    // Make sure it is disabled.
    assert.isTrue(await mappingsForM2().matches('.test-config-widget-disabled'));
    // And the text is:
    assert.equal(await mappingsForM2().getText(), 'No date columns in table.');

    // Now add Date column.
    await gu.sendActions([['AddVisibleColumn', 'Table1', 'NewCol', {type: 'Date'}]]);

    // Now drop should be enabled.
    assert.isFalse(await mappingsForM2().matches('.test-config-widget-disabled'));
    assert.isTrue(await mappingsForM2().matches('.test-config-widget-enabled'));

    // And the text is:
    assert.equal(await mappingsForM2().getText(), 'Pick a date column');

    // Expand it and make sure we have NewCol there.
    await toggleDrop(pickerDrop('M2'));
    assert.deepEqual(await getOptions(), ['NewCol']);

    // Select that column.
    await clickOption('NewCol');

    // Now expand the drop again and make sure we can't clear it.
    await toggleDrop(pickerDrop('M2'));
    assert.deepEqual(await getOptions(), ['NewCol', 'Clear selection']);

    // Now remove the column, and make sure that the drop is disabled again.
    await driver.sendKeys(Key.ESCAPE);
    await gu.sendActions([['RemoveColumn', 'Table1', 'NewCol']]);

    // Make sure it is disabled.
    assert.isTrue(await mappingsForM2().matches('.test-config-widget-disabled'));
    assert.isFalse(await mappingsForM2().matches('.test-config-widget-enabled'));
    assert.equal(await mappingsForM2().getText(), 'No date columns in table.');
  });

  it('should clear optional mapping', async () => {
    const revert = await gu.begin();
    if ((await currentWidget()) !== CUSTOM_URL) {
      await toggleWidgetMenu();
      await clickOption(CUSTOM_URL);
    }
    await gu.setWidgetUrl(
      createConfigUrl({
        columns: [{name: 'M2', type: 'Date', optional: true}],
        requiredAccess: 'read table',
      })
    );

    await widget.waitForFrame();
    await gu.acceptAccessRequest();
    await widget.waitForPendingRequests();

    // Get the drop for M2 mappings.
    const mappingsForM2 = () => driver.find(pickerDrop('M2'));

    // Make sure it is disabled.
    assert.isTrue(await mappingsForM2().matches('.test-config-widget-disabled'));
    // Now add Date column.
    await gu.sendActions([['AddVisibleColumn', 'Table1', 'NewCol', {type: 'Date'}]]);

    // Expand it and make sure we have NewCol there.
    await toggleDrop(pickerDrop('M2'));
    assert.deepEqual(await getOptions(), ['NewCol']);

    // Select that column.
    await clickOption('NewCol');

    // Make sure widget sees the mapping.
    assert.deepEqual(await widget.onRecordsMappings(), {M2: 'NewCol'});

    // Now expand the drop again and make sure we can clear it.
    await toggleDrop(pickerDrop('M2'));
    assert.deepEqual(await getOptions(), ['NewCol', 'Clear selection']);

    // Now clear the mapping.
    await clickOption('Clear selection');
    assert.equal(await mappingsForM2().getText(), 'Pick a date column');

    // Make sure widget sees the mapping.
    assert.deepEqual(await widget.onRecordsMappings(), {M2: null});
    await revert();
  });

  it('should render columns mapping', async () => {
    const revert = await gu.begin();
    assert.isTrue(await driver.find('.test-vfc-visible-fields-select-all').isPresent());
    await toggleWidgetMenu();
    // Select widget that has single column configuration.
    await clickOption(COLUMN_WIDGET);
    await widget.waitForFrame();
    await gu.acceptAccessRequest();
    await widget.waitForPendingRequests();
    // Visible columns section should be hidden.
    assert.isFalse(await driver.find('.test-vfc-visible-fields-select-all').isPresent());
    // Record event should be fired.
    assert.deepEqual(await widget.onRecords(), [
      {id: 1, A: 'A' },
      {id: 2, A: 'B' },
      {id: 3, A: 'C' },
    ]);
    // Mappings should null at first.
    assert.isNull(await widget.onRecordsMappings());
    // We should see a single Column picker.
    assert.isTrue(await driver.find('.test-config-widget-label-for-Column').isPresent());
    // With single column to map.
    await toggleDrop(pickerDrop('Column'));
    assert.deepEqual(await getOptions(), ['A']);
    await clickOption('A');
    await widget.waitForPendingRequests();
    // Widget should receive mappings
    assert.deepEqual(await widget.onRecordsMappings(), {Column: 'A'});
    await revert();
  });

  it('should render multiple mappings', async () => {
    const revert = await gu.begin();
    await toggleWidgetMenu();
    await clickOption(CUSTOM_URL);
    // This is not standard way of creating widgets. The widgets in this test is reading this parameter
    // and is using it to invoke the ready method.
    await gu.setWidgetUrl(
      createConfigUrl({
        columns: ['M1', {name: 'M2', optional: true}, {name: 'M3', title: 'T3'}, {name: 'M4', type: 'Text'}],
        requiredAccess: 'read table',
      })
    );
    await gu.acceptAccessRequest();
    await widget.waitForPlaceholder();
    // We should see 4 pickers
    assert.isTrue(await driver.find(pickerLabel('M1')).isPresent());
    assert.isTrue(await driver.find(pickerLabel('M2')).isPresent());
    assert.isTrue(await driver.find(pickerLabel('M3')).isPresent());
    assert.isTrue(await driver.find(pickerLabel('M4')).isPresent());
    assert.equal(await driver.find(pickerLabel('M1')).getText(), 'M1');
    assert.equal(await driver.find(pickerLabel('M2')).getText(), 'M2 (optional)');
    // Label for picker M3 should have alternative text;
    assert.equal(await driver.find(pickerLabel('M3')).getText(), 'T3');
    assert.equal(await driver.find(pickerLabel('M4')).getText(), 'M4');
    // All picker should show "Pick a column" except M4, which should say "Pick a text column"
    assert.equal(await driver.find(pickerDrop('M1')).getText(), 'Pick a column');
    assert.equal(await driver.find(pickerDrop('M2')).getText(), 'Pick a column');
    assert.equal(await driver.find(pickerDrop('M3')).getText(), 'Pick a column');
    assert.equal(await driver.find(pickerDrop('M4')).getText(), 'Pick a text column');
    // Should be able to select column A for all options
    await toggleDrop(pickerDrop('M1'));
    await clickOption('A');
    await toggleDrop(pickerDrop('M2'));
    await clickOption('A');
    await toggleDrop(pickerDrop('M3'));
    await clickOption('A');
    await toggleDrop(pickerDrop('M4'));
    await clickOption('A');
    await widget.waitForFrame();
    await widget.waitForPendingRequests();
    assert.deepEqual(await widget.onRecordsMappings(), {M1: 'A', M2: 'A', M3: 'A', M4: 'A'});
    // Single record should also receive update.
    assert.deepEqual(await widget.onRecordMappings(), {M1: 'A', M2: 'A', M3: 'A', M4: 'A'});
    // Undo should revert mappings - there should be only 3 operations to revert to first mapping.
    await gu.undo(3);
    await widget.waitForPlaceholder();
    // Add another columns, numeric B and any C.
    await gu.selectSectionByTitle('Table');
    await gu.addColumn('B');
    await gu.getCell('B', 1).click();
    await gu.enterCell('99');
    await gu.addColumn('C');
    await gu.selectSectionByTitle('Widget');
    // Column M1 should be mappable to all 3, column M4 only to A and C
    await toggleDrop(pickerDrop('M1'));
    assert.deepEqual(await getOptions(), ['A', 'B', 'C']);
    await toggleDrop(pickerDrop('M4'));
    assert.deepEqual(await getOptions(), ['A', 'C']);
    await revert();
  });

  it('should clear mappings on widget switch', async () => {
    const revert = await gu.begin();

    await toggleWidgetMenu();
    await clickOption(COLUMN_WIDGET);
    await widget.waitForFrame();
    await gu.acceptAccessRequest();
    await widget.waitForPendingRequests();

    // Make sure columns are there to pick.

    // Visible column section is hidden.
    assert.isFalse(await driver.find('.test-vfc-visible-fields-select-all').isPresent());
    // We should see a single Column picker.
    assert.isTrue(await driver.find('.test-config-widget-label-for-Column').isPresent());

    // Pick first column
    await toggleDrop(pickerDrop('Column'));
    await clickOption('A');

    // Now change to a widget without columns
    await toggleWidgetMenu();
    await clickOption(NORMAL_WIDGET);

    // Picker should disappear and column mappings should be visible
    assert.isTrue(await driver.find('.test-vfc-visible-fields-select-all').isPresent());
    assert.isFalse(await driver.find('.test-config-widget-label-for-Column').isPresent());

    await gu.changeWidgetAccess(AccessLevel.read_table);
    // Widget should receive full records.
    assert.deepEqual(await widget.onRecords(), [
      {id: 1, A: 'A'},
      {id: 2, A: 'B'},
      {id: 3, A: 'C'},
    ]);
    // Now go back to the widget with mappings.
    await toggleWidgetMenu();
    await clickOption(COLUMN_WIDGET);
    await widget.waitForFrame();
    await gu.acceptAccessRequest();
    await widget.waitForPendingRequests();
    assert.equal(await driver.find(pickerDrop('Column')).getText(), 'Pick a column');
    assert.isFalse(await driver.find('.test-vfc-visible-fields-select-all').isPresent());
    assert.isTrue(await driver.find('.test-config-widget-label-for-Column').isPresent());
    await revert();
  });

  it('should render multiple options', async () => {
    const revert = await gu.begin();
    await toggleWidgetMenu();
    await clickOption(CUSTOM_URL);
    await gu.setWidgetUrl(
      createConfigUrl({
        columns: [
          {name: 'M1', allowMultiple: true, optional: true},
          {name: 'M2', type: 'Text', allowMultiple: true, optional: true},
        ],
        requiredAccess: 'read table',
      })
    );
    await widget.waitForFrame();
    await gu.acceptAccessRequest();
    // Add some columns, numeric B and any C.
    await gu.selectSectionByTitle('Table');
    await gu.addColumn('B');
    await gu.getCell('B', 1).click();
    await gu.enterCell('99');
    await gu.addColumn('C');
    await gu.selectSectionByTitle('Widget');
    await widget.waitForPendingRequests();
    // Make sure we have no mappings
    assert.deepEqual(await widget.onRecordsMappings(), null);
    // Map all columns to M1
    await click(pickerAdd('M1'));
    assert.deepEqual(await getMenuOptions(), ['A', 'B', 'C']);
    await clickMenuItem('A');
    await click(pickerAdd('M1'));
    await clickMenuItem('B');
    await click(pickerAdd('M1'));
    await clickMenuItem('C');
    await widget.waitForPendingRequests();
    const empty = {M1: [], M2: []};
    assert.deepEqual(await widget.onRecordsMappings(), {...empty, M1: ['A', 'B', 'C']});
    // Map A and C to M2
    await click(pickerAdd('M2'));
    assert.deepEqual(await getMenuOptions(), ['A', 'C']);
    // There should be information that column B is hidden (as it is not text)
    assert.equal(await driver.find('.test-config-widget-map-message-M2').getText(), '1 non-text column is not shown');
    await clickMenuItem('A');
    await click(pickerAdd('M2'));
    await clickMenuItem('C');
    await widget.waitForPendingRequests();
    assert.deepEqual(await widget.onRecordsMappings(), {M1: ['A', 'B', 'C'], M2: ['A', 'C']});
    function dragItem(column: string, item: string) {
      return driver.findContent(`.test-config-widget-map-list-for-${column} .kf_draggable`, item);
    }
    // Should support reordering, reorder - move A after C
    await driver.withActions(actions =>
      actions
        .move({origin: dragItem('M1', 'A')})
        .move({origin: dragItem('M1', 'A').find('.test-dragger')})
        .press()
        .move({origin: dragItem('M1', 'C'), y: 1})
        .release()
    );
    await gu.waitForServer();
    await widget.waitForPendingRequests();
    assert.deepEqual(await widget.onRecordsMappings(), {M1: ['B', 'C', 'A'], M2: ['A', 'C']});
    // Should support removing
    const removeButton = (column: string, item: string) => {
      return dragItem(column, item).mouseMove().find('.test-config-widget-ref-select-remove');
    };
    await removeButton('M1', 'B').click();
    await gu.waitForServer();
    await widget.waitForPendingRequests();
    assert.deepEqual(await widget.onRecordsMappings(), {M1: ['C', 'A'], M2: ['A', 'C']});
    // Should undo removing
    await gu.undo();
    await widget.waitForPendingRequests();
    assert.deepEqual(await widget.onRecordsMappings(), {M1: ['B', 'C', 'A'], M2: ['A', 'C']});
    await removeButton('M1', 'B').click();
    await gu.waitForServer();
    await removeButton('M1', 'C').click();
    await gu.waitForServer();
    await removeButton('M2', 'C').click();
    await gu.waitForServer();
    await widget.waitForPendingRequests();
    assert.deepEqual(await widget.onRecordsMappings(), {M1: ['A'], M2: ['A']});
    await revert();
  });

  it('should support multiple types in mappings', async () => {
    const revert = await gu.begin();
    await toggleWidgetMenu();
    await clickOption(CUSTOM_URL);
    await gu.setWidgetUrl(
      createConfigUrl({
        columns: [
          {name: 'M1', type: 'Date,DateTime', optional: true},
          {name: 'M2', type: 'Date, DateTime ', allowMultiple: true, optional: true},
        ],
        requiredAccess: 'read table',
      })
    );
    await widget.waitForFrame();
    await gu.acceptAccessRequest();
    // Add B=Date, C=DateTime, D=Numeric
    await gu.sendActions([
      ['AddVisibleColumn', 'Table1', 'B', {type: 'Any'}],
      ['AddVisibleColumn', 'Table1', 'C', {type: 'Date'}],
      ['AddVisibleColumn', 'Table1', 'D', {type: 'DateTime'}],
      ['AddVisibleColumn', 'Table1', 'E', {type: 'Numeric'}],
      // Add sample record.
      ['UpdateRecord', 'Table1', 1, {C: '2019-01-01', D: '2019-01-01 12:00', E: 1}]
    ]);

    await gu.selectSectionByTitle('Widget');
    await widget.waitForPendingRequests();
    // Make sure we have no mappings
    assert.deepEqual(await widget.onRecordsMappings(), null);
    // Now see what we are offered for M1.
    await toggleDrop(pickerDrop('M1'));
    assert.deepEqual(await getOptions(), ['B', 'C', 'D']);
    // Make sure they work. First select C.
    await clickOption('B');
    // Make sure onRecord and onRecordMappings looks legit.
    assert.deepEqual(await widget.onRecord(), {id:1, B: null});
    assert.deepEqual(await widget.onRecordMappings(), {M1: 'B', M2: []});
    // Now select C.
    await toggleDrop(pickerDrop('M1'));
    await clickOption('C');
    assert.deepEqual(await widget.onRecord(), {id:1, C: '2019-01-01T00:00:00.000Z'});
    assert.deepEqual(await widget.onRecordMappings(), {M1: 'C', M2: []});
    // Now select D.
    await toggleDrop(pickerDrop('M1'));
    await clickOption('D');
    assert.deepEqual(await widget.onRecord(), {id:1, D: '2019-01-01T17:00:00.000Z'});
    assert.deepEqual(await widget.onRecordMappings(), {M1: 'D', M2: []});

    // Make sure we can select multiple columns for M2 with Date and DateTime.
    await click(pickerAdd('M2'));
    assert.deepEqual(await getMenuOptions(), ['B', 'C', 'D']);
    await clickMenuItem('B');

    assert.deepEqual(await widget.onRecordMappings(), {M1: 'D', M2: ['B']});
    await click(pickerAdd('M2'));
    await clickMenuItem('C');
    assert.deepEqual(await widget.onRecordMappings(), {M1: 'D', M2: ['B', 'C']});

    await revert();
  });

  it('should support strictType setting', async () => {
    const revert = await gu.begin();
    await toggleWidgetMenu();
    await clickOption(CUSTOM_URL);
    await gu.setWidgetUrl(
      createConfigUrl({
        columns: [
          {name: 'Any', type: 'Any', strictType: true, optional: true},
          {name: 'Date_Numeric', type: 'Date, Numeric', strictType: true, optional: true},
          {name: 'Date_Any', type: 'Date, Any', strictType: true, optional: true},
          {name: 'Date', type: 'Date', strictType: true, optional: true},
        ],
        requiredAccess: 'read table',
      })
    );
    await widget.waitForFrame();
    await gu.acceptAccessRequest();
    await gu.sendActions([
      ['AddVisibleColumn', 'Table1', 'Any', {type: 'Any'}],
      ['AddVisibleColumn', 'Table1', 'Date', {type: 'Date'}],
      ['AddVisibleColumn', 'Table1', 'Numeric', {type: 'Numeric'}],
    ]);

    await gu.selectSectionByTitle('Widget');
    await widget.waitForPendingRequests();

    // Make sure we have no mappings
    assert.deepEqual(await widget.onRecordsMappings(), null);

    await toggleDrop(pickerDrop('Date'));
    assert.deepEqual(await getOptions(), ['Date']);

    await toggleDrop(pickerDrop('Date_Any'));
    assert.deepEqual(await getOptions(), ['Any', 'Date']);

    await toggleDrop(pickerDrop('Date_Numeric'));
    assert.deepEqual(await getOptions(), ['Date', 'Numeric']);

    await toggleDrop(pickerDrop('Any'));
    assert.deepEqual(await getOptions(), ['Any']);

    await revert();
  });

  it('should react to widget options change', async () => {
    const revert = await gu.begin();
    await toggleWidgetMenu();
    await clickOption(CUSTOM_URL);
    await gu.setWidgetUrl(
      createConfigUrl({
        columns: [
          {name: 'Choice', type: 'Choice', strictType: true, optional: true},
        ],
        requiredAccess: 'read table',
      })
    );

    await widget.waitForFrame();
    await gu.acceptAccessRequest();

    const widgetOptions = {
      choices: ['A'],
      choiceOptions: {A: {textColor: 'red'}}
    };
    await gu.sendActions([
      ['AddVisibleColumn', 'Table1', 'Choice', {type: 'Choice', widgetOptions: JSON.stringify(widgetOptions)}]
    ]);
    await gu.selectSectionByTitle('Widget');
    await widget.waitForPendingRequests();

    await toggleDrop(pickerDrop('Choice'));
    await clickOption('Choice');
    await widget.waitForPendingRequests();

    // Clear logs
    await widget.clearLog();
    assert.isEmpty(await widget.log());

    // Now update options in that one column;
    widgetOptions.choiceOptions.A.textColor = 'blue';
    await gu.sendActions([
      ['ModifyColumn', 'Table1', 'Choice', {widgetOptions: JSON.stringify(widgetOptions)}]
    ]);

    await gu.waitToPass(async () => {
      // Make sure widget sees that mapping are changed.
      assert.equal(await widget.log(), '{"tableId":"Table1","rowId":1,"dataChange":true,"mappingsChange":true}');
    });

    await revert();
  });

  it('should remove mapping when column is deleted', async () => {
    const revert = await gu.begin();
    await toggleWidgetMenu();
    // Prepare mappings for single and multiple columns
    await clickOption(CUSTOM_URL);
    await gu.setWidgetUrl(
      createConfigUrl({
        columns: [{name: 'M1', optional: true}, {name: 'M2', allowMultiple: true, optional: true}],
        requiredAccess: 'read table',
      })
    );
    await widget.waitForFrame();
    await gu.acceptAccessRequest();
    // Add some columns, to remove later
    await gu.selectSectionByTitle('Table');
    await gu.addColumn('B');
    await gu.addColumn('C');
    await gu.selectSectionByTitle('Widget');
    await widget.waitForPendingRequests();
    // Make sure we have no mappings
    assert.deepEqual(await widget.onRecordsMappings(), null);
    // Map B to M1
    await toggleDrop(pickerDrop('M1'));
    await clickOption('B');
    await widget.waitForPendingRequests();
    // Map all columns to M2
    for (const col of ['A', 'B', 'C']) {
      await click(pickerAdd('M2'));
      await clickMenuItem(col);
      await widget.waitForPendingRequests();
    }
    assert.deepEqual(await widget.onRecordsMappings(), {M1: 'B', M2: ['A', 'B', 'C']});
    assert.deepEqual(await widget.onRecords(), [
      {id: 1, B: null, A: 'A', C: null},
      {id: 2, B: null, A: 'B', C: null},
      {id: 3, B: null, A: 'C', C: null},
    ]);
    const removeColumn = async (col: string) => {
      await gu.selectSectionByTitle('Table');
      await gu.openColumnMenu(col, 'Delete column');
      await gu.waitForServer();
      await widget.waitForPendingRequests();
      await gu.selectSectionByTitle('Widget');
    };
    // Remove B column
    await removeColumn('B');
    await widget.waitForPendingRequests();
    // Mappings should be updated
    assert.deepEqual(await widget.onRecordsMappings(), {M1: null, M2: ['A', 'C']});
    // Records should not have B column
    assert.deepEqual(await widget.onRecords(), [
      {id: 1, A: 'A', C: null},
      {id: 2, A: 'B', C: null},
      {id: 3, A: 'C', C: null},
    ]);
    // Should be able to add B once more

    // Add B as a new column
    await gu.selectSectionByTitle('Table');
    await gu.addColumn('B');
    await gu.selectSectionByTitle('Widget');
    await widget.waitForPendingRequests();
    // Adding the same column should not add it to mappings or records (as this is a new Id)
    assert.deepEqual(await widget.onRecordsMappings(), {M1: null, M2: ['A', 'C']});
    assert.deepEqual(await widget.onRecords(), [
      {id: 1, A: 'A', C: null},
      {id: 2, A: 'B', C: null},
      {id: 3, A: 'C', C: null},
    ]);

    // Add B column as a new one.
    await toggleDrop(pickerDrop('M1'));
    // Make sure it is there to select.
    assert.deepEqual(await getOptions(), ['A', 'C', 'B', 'Clear selection']);
    await clickOption('B');
    await widget.waitForPendingRequests();
    await click(pickerAdd('M2'));
    assert.deepEqual(await getMenuOptions(), ['B']); // multiple selection will only show not selected columns
    await clickMenuItem('B');
    await widget.waitForPendingRequests();
    assert.deepEqual(await widget.onRecordsMappings(), {M1: 'B', M2: ['A', 'C', 'B']});
    assert.deepEqual(await widget.onRecords(), [
      {id: 1, B: null, A: 'A', C: null},
      {id: 2, B: null, A: 'B', C: null},
      {id: 3, B: null, A: 'C', C: null},
    ]);
    await revert();
  });

  it('should remove mapping when column type is changed', async () => {
    const revert = await gu.begin();
    await toggleWidgetMenu();
    // Prepare mappings for single and multiple columns
    await clickOption(CUSTOM_URL);
    await gu.setWidgetUrl(
      createConfigUrl({
        columns: [
          {name: 'M1', type: 'Text', optional: true},
          {name: 'M2', type: 'Text', allowMultiple: true, optional: true}
        ],
        requiredAccess: 'read table',
      })
    );
    await widget.waitForFrame();
    await gu.acceptAccessRequest();
    await widget.waitForPendingRequests();
    assert.deepEqual(await widget.onRecordsMappings(), null);
    assert.deepEqual(await widget.onRecords(), [
      {id: 1, A: 'A'},
      {id: 2, A: 'B'},
      {id: 3, A: 'C'},
    ]);
    await toggleDrop(pickerDrop("M1"));
    await clickOption("A");
    await click(pickerAdd("M2"));
    await clickMenuItem("A");
    assert.equal(await driver.find(pickerDrop("M1")).getText(), "A");
    assert.deepEqual(await getListItems("M2"), ["A"]);
    assert.deepEqual(await widget.onRecordsMappings(), {M1: 'A', M2: ["A"]});
    assert.deepEqual(await widget.onRecords(), [
      {id: 1, A: 'A'},
      {id: 2, A: 'B'},
      {id: 3, A: 'C'},
    ]);
    // Change column type to numeric
    await gu.selectSectionByTitle('Table');
    await gu.getCell("A", 1).click();
    await gu.setType(/Numeric/);
    await gu.selectSectionByTitle('Widget');
    await driver.find(".test-right-tab-pagewidget").click();
    await widget.waitForPendingRequests();
    // Drop should be empty,
    await driver.wait(async () =>
      await driver.find(pickerDrop("M1")).getText() == "No text columns in table.", 1000);
    assert.isEmpty(await getListItems("M2"));
    // And drop is disabled.
    assert.isTrue(await driver.find(pickerDrop("M1")).matches(".test-config-widget-disabled"));
    // The same for M2
    assert.isTrue(await driver.find(pickerAdd("M2")).matches(".test-config-widget-disabled"));
    assert.isEmpty(await getMenuOptions());
    assert.deepEqual(await widget.onRecordsMappings(), {M1: null, M2: []});
    assert.deepEqual(await widget.onRecords(), [
      {id: 1},
      {id: 2},
      {id: 3},
    ]);
    await revert();
  });

  it('should not display options on grid, card, card list, chart', async () => {
    // Add Empty Grid
    await gu.addNewSection(/Table/, /Table1/);
    assert.isFalse(await hasSectionOption());
    await gu.undo();

    // Add Card view
    await gu.addNewSection(/Card/, /Table1/);
    assert.isFalse(await hasSectionOption());
    await gu.undo();

    // Add Card List view
    await gu.addNewSection(/Card List/, /Table1/);
    assert.isFalse(await hasSectionOption());
    await gu.undo();

    // Add Card List view
    await gu.addNewSection(/Chart/, /Table1/);
    assert.isFalse(await hasSectionOption());
    await gu.undo();

    // Add Custom - no section option by default
    await gu.addNewSection(/Custom/, /Table1/);
    assert.isFalse(await hasSectionOption());
    await toggleWidgetMenu();
    await clickOption(TESTER_WIDGET);
    assert.isTrue(await hasSectionOption());
    await gu.undo(2);
  });

  it('should indicate current state', async () => {
    // Save button is available under Filter/Sort menu.
    // For this custom widget it has four states:
    // - Empty: no options are saved
    // - Modified: options were set but are not saved yet
    // - Customized: options are saved
    // - Empty not saved: options are cleared but not saved
    // This test test all the available transitions between those four states

    const options = {test: 1} as const;
    const options2 = {test: 2} as const;
    // From the start we should be in empty state
    await checkSortMenu('empty');
    // Make modification
    await widget.setOptions(options);
    // State should be modified
    await checkSortMenu('modified');
    assert.deepEqual(await widget.onOptions(), options);
    // Revert, should end up with empty state.
    await revertMenu();
    await checkSortMenu('empty');
    assert.equal(await widget.onOptions(), null);

    // Update once again and save.
    await widget.setOptions(options);
    await saveMenu();
    await checkSortMenu('customized');
    // Now test if undo works.
    await gu.undo();
    await checkSortMenu('empty');
    assert.equal(await widget.onOptions(), null);

    // Update once again and save.
    await widget.setOptions(options);
    await saveMenu();
    // Modify and check the state - should be modified
    await widget.setOptions(options2);
    await checkSortMenu('modified');
    assert.deepEqual(await widget.onOptions(), options2);
    await saveMenu();

    // Now clear options.
    await clearOptions();
    await checkSortMenu('emptyNotSaved');
    assert.equal(await widget.onOptions(), null);
    // And revert
    await revertMenu();
    await checkSortMenu('customized');
    assert.deepEqual(await widget.onOptions(), options2);
    // Clear once again and save.
    await clearOptions();
    await saveMenu();
    assert.equal(await widget.onOptions(), null);
    await checkSortMenu('empty');
    // And check if undo goes to customized
    await gu.undo();
    await checkSortMenu('customized');
    assert.deepEqual(await widget.onOptions(), options2);
  });

  for (const access of ['none', 'read table', 'full'] as const) {
    describe(`with ${access} access`, function () {
      before(function () {
        if (server.isExternalServer()) {
          this.skip();
        }
      });
      it(`should get null options`, async () => {
        await gu.changeWidgetAccess(access);
        await widget.waitForFrame();
        assert.equal(await widget.onOptions(), null);
        assert.equal(await widget.access(), access);
        assert.isFalse(await widget.readonly());
      });

      it(`should save config options and inform about it the main widget`, async () => {
        await gu.changeWidgetAccess(access);
        await widget.waitForFrame();
        // Save config and check if normal widget received new configuration
        const config = {key: 1} as const;
        // save options through config,
        await widget.setOptions(config);
        // make sure custom widget got options,
        assert.deepEqual(await widget.onOptions(), config);
        await persistOptions();
        // and make sure it will get it once again,
        await refresh();
        assert.deepEqual(await widget.onOptions(), config);
        // and can read it on demand
        assert.deepEqual(await widget.getOptions(), config);
      });

      it(`should save and read options`, async () => {
        await gu.changeWidgetAccess(access);
        await widget.waitForFrame();
        // Make sure get options returns null.
        assert.equal(await widget.getOptions(), null);
        // Invoke setOptions, should return undefined (no error).
        assert.equal(await widget.setOptions({key: 'any'}), null);
        // Once again get options, and see if it was saved.
        assert.deepEqual(await widget.getOptions(), {key: 'any'});
        await widget.clearOptions();
      });

      it(`should save and read options by keys`, async () => {
        await gu.changeWidgetAccess(access);
        await widget.waitForFrame();
        // Should support key operations
        const set = async (key: string, value: any) => {
          assert.equal(await widget.setOption(key, value), undefined);
          assert.deepEqual(await widget.getOption(key), value);
        };
        await set('one', 1);
        await set('two', 2);
        assert.deepEqual(await widget.getOptions(), {one: 1, two: 2});
        const json = {n: null, json: {value: [1, {val: 'a', bool: true}]}};
        await set('json', json);
        assert.equal(await widget.clearOptions(), undefined);
        assert.equal(await widget.getOptions(), null);
        await set('one', 1);
        assert.equal(await widget.setOptions({key: 'any'}), undefined);
        assert.deepEqual(await widget.getOptions(), {key: 'any'});
        await widget.clearOptions();
      });

      it(`should call configure method`, async () => {
        await gu.changeWidgetAccess(access);
        await widget.waitForFrame();
        // Make sure configure wasn't called yet.
        assert.isFalse(await widget.wasConfigureCalled());
        // Open configuration through the creator panel
        await driver.find('.test-config-widget-open-configuration').click();
        assert.isTrue(await widget.wasConfigureCalled());

        // Refresh, and call through the menu.
        await refresh();
        await gu.waitForDocToLoad();
        await widget.waitForFrame();
        // Make sure configure wasn't called yet.
        assert.isFalse(await widget.wasConfigureCalled());
        // Click through the menu.
        const menu = await gu.openSectionMenu('viewLayout', 'Widget');
        await menu.find('.test-section-open-configuration').click();
        assert.isTrue(await widget.wasConfigureCalled());
      });
    });
  }

  it('should show options action button', async () => {
    // Select widget without options
    await toggleWidgetMenu();
    await clickOption(NORMAL_WIDGET);
    assert.isFalse(await hasSectionOption());
    // Select widget with options
    await toggleWidgetMenu();
    await clickOption(TESTER_WIDGET);
    assert.isTrue(await hasSectionOption());
    // Select widget without options
    await toggleWidgetMenu();
    await clickOption(NORMAL_WIDGET);
    assert.isFalse(await hasSectionOption());
  });

  it('should prompt user for correct access level', async () => {
    // Select widget without request
    await toggleWidgetMenu();
    await clickOption(NORMAL_WIDGET);
    await widget.waitForFrame();
    assert.isFalse(await gu.hasAccessPrompt());
    assert.equal(await gu.widgetAccess(), AccessLevel.none);
    assert.equal(await widget.access(), AccessLevel.none);
    // Select widget that requests read access.
    await toggleWidgetMenu();
    await clickOption(READ_WIDGET);
    await widget.waitForFrame();
    assert.isTrue(await gu.hasAccessPrompt());
    assert.equal(await gu.widgetAccess(), AccessLevel.none);
    assert.equal(await widget.access(), AccessLevel.none);
    await gu.acceptAccessRequest();
    await widget.waitForPendingRequests();
    assert.equal(await gu.widgetAccess(), AccessLevel.read_table);
    assert.equal(await widget.access(), AccessLevel.read_table);
    // Select widget that requests full access.
    await toggleWidgetMenu();
    await clickOption(FULL_WIDGET);
    await widget.waitForFrame();
    assert.isTrue(await gu.hasAccessPrompt());
    assert.equal(await gu.widgetAccess(), AccessLevel.none);
    assert.equal(await widget.access(), AccessLevel.none);
    await gu.acceptAccessRequest();
    await widget.waitForPendingRequests();
    assert.equal(await gu.widgetAccess(), AccessLevel.full);
    assert.equal(await widget.access(), AccessLevel.full);
    await gu.undo(5);
  });

  it('should pass readonly mode to custom widget', async () => {
    const api = mainSession.createHomeApi();
    await api.updateDocPermissions(docId, {users: {'support@getgrist.com': 'viewers'}});

    const viewer = await gu.session().user('support').login();
    await viewer.loadDoc(`/doc/${docId}`);

    // Make sure that widget knows about readonly mode.
    assert.isTrue(await widget.readonly());

    // Log back
    await mainSession.login();
    await mainSession.loadDoc(`/doc/${docId}`);
    await refresh();
  });
});

// Poor man widget rpc. Class that invokes various parts in the tester widget.
const widget = {
  async waitForPlaceholder() {
    assert.isTrue(await driver.findWait('.test-custom-widget-not-mapped', 1000).isDisplayed());
  },
  // Wait for a frame.
  async waitForFrame() {
    await driver.findWait(`iframe.test-custom-widget-ready`, 1000);
    await driver.wait(async () => await driver.find('iframe').isDisplayed(), 1000);
    await widget.waitForPendingRequests();
  },
  async waitForPendingRequests() {
    await this._inWidgetIframe(async () => {
      await driver.executeScript('grist.testWaitForPendingRequests();');
    });
  },
  async content() {
    return await this._read('body');
  },
  async readonly() {
    const text = await this._read('#readonly');
    return text === 'true';
  },
  async access() {
    const text = await this._read('#access');
    return text as AccessLevel;
  },
  async onRecordMappings() {
    const text = await this._read('#onRecordMappings');
    return JSON.parse(text || 'null');
  },
  async onRecords() {
    const text = await this._read('#onRecords');
    return JSON.parse(text || 'null');
  },
  async onRecord() {
    const text = await this._read('#onRecord');
    return JSON.parse(text || 'null');
  },
  /**
   * Reads last mapping parameter received by the widget as part of onRecords call.
   */
  async onRecordsMappings() {
    const text = await this._read('#onRecordsMappings');
    return JSON.parse(text || 'null');
  },
  async log() {
    const text = await this._read('#log');
    return text || '';
  },
  // Wait for frame to close.
  async waitForClose() {
    await driver.wait(async () => !(await driver.find('iframe').isPresent()), 3000);
  },
  // Wait for the onOptions event, and return its value.
  async onOptions() {
    const text = await this._inWidgetIframe(async () => {
      // Wait for options to get filled, initially this div is empty,
      // as first message it should get at least null as an options.
      await driver.wait(async () => await driver.find('#onOptions').getText(), 3000);
      return await driver.find('#onOptions').getText();
    });
    return JSON.parse(text);
  },
  async wasConfigureCalled() {
    const text = await this._read('#configure');
    return text === 'called';
  },
  async setOptions(options: any) {
    return await this.invokeOnWidget('setOptions', [options]);
  },
  async setOption(key: string, value: any) {
    return await this.invokeOnWidget('setOption', [key, value]);
  },
  async getOption(key: string) {
    return await this.invokeOnWidget('getOption', [key]);
  },
  async clearOptions() {
    return await this.invokeOnWidget('clearOptions');
  },
  async getOptions() {
    return await this.invokeOnWidget('getOptions');
  },
  async mappings() {
    return await this.invokeOnWidget('mappings');
  },
  async clearLog() {
    return await this.invokeOnWidget('clearLog');
  },
  // Invoke method on a Custom Widget.
  // Each method is available as a button with content that is equal to the method name.
  // It accepts single argument, that we pass by serializing it to #input textbox. Widget invokes
  // the method and serializes its return value to #output div. When there is an error, it is also
  // serialized to the #output div.
  async invokeOnWidget(name: string, input?: any[]) {
    // Switch to frame.
    const iframe = driver.find('iframe');
    await driver.switchTo().frame(iframe);
    // Clear input box that holds arguments.
    await driver.find('#input').click();
    await gu.clearInput();
    // Serialize argument to the textbox (or leave empty).
    if (input !== undefined) {
      await driver.sendKeys(JSON.stringify(input));
    }
    // Find button that is responsible for invoking method.
    await driver.findContent('button', gu.exactMatch(name)).click();
    // Wait for the #output div to be filled with a result. Custom Widget will set it to
    // "waiting..." before invoking the method.
    await driver.wait(async () => (await driver.find('#output').value()) !== 'waiting...');
    // Read the result.
    const text = await driver.find('#output').getText();
    // Switch back to main window.
    await driver.switchTo().defaultContent();
    // If the method was a void method, the output will be "undefined".
    if (text === 'undefined') {
      return; // Simulate void method.
    }
    // Result will always be parsed json.
    const parsed = JSON.parse(text);
    // All exceptions will be serialized to { error : <<Error.message>> }
    if (parsed?.error) {
      // Rethrow the error.
      throw new Error(parsed.error);
    } else {
      // Or return result.
      return parsed;
    }
  },
  async _read(selector: string) {
    return this._inWidgetIframe(() => driver.find(selector).getText());
  },
  async _inWidgetIframe<T>(callback: () => Promise<T>) {
    const iframe = driver.find('iframe');
    await driver.switchTo().frame(iframe);
    const retVal = await callback();
    await driver.switchTo().defaultContent();
    return retVal;
  },
  /**
   * Resets the widget by first selecting Custom URL option from the menu, which clearOptions
   * any existing widget state (even if the Custom URL was already selected).
   */
  async resetWidget() {
    await toggleWidgetMenu();
    await clickOption(CUSTOM_URL);
  }
};
