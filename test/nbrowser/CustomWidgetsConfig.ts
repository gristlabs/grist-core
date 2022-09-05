import {assert, driver, Key} from 'mocha-webdriver';
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

// Gets or sets access level
async function givenAccess(level?: AccessLevel) {
  const text = {
    [AccessLevel.none]: 'No document access',
    [AccessLevel.read_table]: 'Read selected table',
    [AccessLevel.full]: 'Full document access',
  };
  if (!level) {
    const currentAccess = await driver.find('.test-config-widget-access .test-select-open').getText();
    return Object.entries(text).find(e => e[1] === currentAccess)![0];
  } else {
    await driver.find('.test-config-widget-access .test-select-open').click();
    await driver.findContent('.test-select-menu li', text[level]).click();
    await gu.waitForServer();
  }
}

// Checks if access prompt is visible.
const hasPrompt = () => driver.find('.test-config-widget-access-accept').isPresent();
// Accepts new access level.
const accept = () => driver.find('.test-config-widget-access-accept').click();
// When refreshing, we need to make sure widget repository is enabled once again.
async function refresh() {
  await driver.navigate().refresh();
  await gu.waitForDocToLoad();
  // Switch section and enable config
  await gu.selectSectionByTitle('Table');
  await driver.executeScript('window.gristConfig.enableWidgetRepository = true;');
  await gu.selectSectionByTitle('Widget');
}

async function selectAccess(access: string) {
  // if the current access is ok do nothing
  if ((await givenAccess()) === access) {
    // unless we need to confirm it
    if (await hasPrompt()) {
      await accept();
    }
  } else {
    // else switch access level
    await givenAccess(access as AccessLevel);
  }
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
  this.timeout(30000); // almost 20 second on dev machine.
  const cleanup = setupTestSuite();
  let mainSession: gu.Session;
  gu.bigScreen();

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
            url: createConfigUrl({requiredAccess: AccessLevel.read_table, columns: ['Column']}),
            widgetId: 'tester5',
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

  // Poor man widget rpc. Class that invokes various parts in the tester widget.
  class Widget {
    constructor(public frameSelector = 'iframe') {}
    // Wait for a frame.
    public async waitForFrame() {
      await driver.wait(() => driver.find(this.frameSelector).isPresent(), 1000);
      const iframe = driver.find(this.frameSelector);
      await driver.switchTo().frame(iframe);
      await driver.wait(async () => (await driver.find('#ready').getText()) === 'ready', 1000);
      await driver.switchTo().defaultContent();
    }
    public async content() {
      return await this._read('body');
    }
    public async readonly() {
      const text = await this._read('#readonly');
      return text === 'true';
    }
    public async access() {
      const text = await this._read('#access');
      return text as AccessLevel;
    }
    public async onRecordMappings() {
      const text = await this._read('#onRecordMappings');
      return JSON.parse(text || 'null');
    }
    public async onRecords() {
      const text = await this._read('#onRecords');
      return JSON.parse(text || 'null');
    }
    public async onRecordsMappings() {
      const text = await this._read('#onRecordsMappings');
      return JSON.parse(text || 'null');
    }
    // Wait for frame to close.
    public async waitForClose() {
      await driver.wait(async () => !(await driver.find(this.frameSelector).isPresent()), 1000);
    }
    // Wait for the onOptions event, and return its value.
    public async onOptions() {
      const iframe = driver.find(this.frameSelector);
      await driver.switchTo().frame(iframe);
      // Wait for options to get filled, initially this div is empty,
      // as first message it should get at least null as an options.
      await driver.wait(async () => await driver.find('#onOptions').getText(), 1000);
      const text = await driver.find('#onOptions').getText();
      await driver.switchTo().defaultContent();
      return JSON.parse(text);
    }
    public async wasConfigureCalled() {
      const text = await this._read('#configure');
      return text === 'called';
    }
    public async setOptions(options: any) {
      return await this.invokeOnWidget('setOptions', [options]);
    }
    public async setOption(key: string, value: any) {
      return await this.invokeOnWidget('setOption', [key, value]);
    }
    public async getOption(key: string) {
      return await this.invokeOnWidget('getOption', [key]);
    }
    public async clearOptions() {
      return await this.invokeOnWidget('clearOptions');
    }
    public async getOptions() {
      return await this.invokeOnWidget('getOptions');
    }
    public async mappings() {
      return await this.invokeOnWidget('mappings');
    }
    // Invoke method on a Custom Widget.
    // Each method is available as a button with content that is equal to the method name.
    // It accepts single argument, that we pass by serializing it to #input textbox. Widget invokes
    // the method and serializes its return value to #output div. When there is an error, it is also
    // serialized to the #output div.
    public async invokeOnWidget(name: string, input?: any[]) {
      // Switch to frame.
      const iframe = driver.find(this.frameSelector);
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
    }

    private async _read(selector: string) {
      const iframe = driver.find(this.frameSelector);
      await driver.switchTo().frame(iframe);
      const text = await driver.find(selector).getText();
      await driver.switchTo().defaultContent();
      return text;
    }
  }
  // Rpc for main widget (Custom Widget).
  const widget = new Widget();

  beforeEach(async () => {
    // Before each test, we will switch to Custom Url (to cleanup the widget)
    // and then back to the Tester widget.
    if ((await currentWidget()) !== CUSTOM_URL) {
      await toggleWidgetMenu();
      await clickOption(CUSTOM_URL);
    }
    await toggleWidgetMenu();
    await clickOption(TESTER_WIDGET);
  });

  it('should render columns mapping', async () => {
    const revert = await gu.begin();
    assert.isTrue(await driver.find('.test-vfc-visible-fields-select-all').isPresent());
    await toggleWidgetMenu();
    // Select widget that has single column configuration.
    await clickOption(COLUMN_WIDGET);
    await widget.waitForFrame();
    await accept();
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
    await gu.waitForServer();
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
    await accept();
    const empty = {M1: null, M2: null, M3: null, M4: null};
    await widget.waitForFrame();
    assert.isNull(await widget.onRecordsMappings());
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
    // Mappings should be empty
    assert.isNull(await widget.onRecordsMappings());
    // Should be able to select column A for all options
    await toggleDrop(pickerDrop('M1'));
    await clickOption('A');
    await gu.waitForServer();
    assert.deepEqual(await widget.onRecordsMappings(), {... empty, M1: 'A'});
    await toggleDrop(pickerDrop('M2'));
    await clickOption('A');
    await gu.waitForServer();
    assert.deepEqual(await widget.onRecordsMappings(), {... empty, M1: 'A', M2: 'A'});
    await toggleDrop(pickerDrop('M3'));
    await clickOption('A');
    await gu.waitForServer();
    assert.deepEqual(await widget.onRecordsMappings(), {... empty, M1: 'A', M2: 'A', M3: 'A'});
    await toggleDrop(pickerDrop('M4'));
    await clickOption('A');
    await gu.waitForServer();
    assert.deepEqual(await widget.onRecordsMappings(), {M1: 'A', M2: 'A', M3: 'A', M4: 'A'});
    // Single record should also receive update.
    assert.deepEqual(await widget.onRecordMappings(), {M1: 'A', M2: 'A', M3: 'A', M4: 'A'});
    // Undo should revert mappings - there should be only 3 operations to revert to first mapping.
    await gu.undo(3);
    assert.deepEqual(await widget.onRecordsMappings(), {... empty, M1: 'A'});
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
    await toggleDrop(pickerDrop('M1'));
    await clickOption('B');
    assert.deepEqual(await widget.onRecordsMappings(), {...empty, M1: 'B'});
    await revert();
  });

  it('should clear mappings on widget switch', async () => {
    const revert = await gu.begin();

    await toggleWidgetMenu();
    await clickOption(COLUMN_WIDGET);
    await accept();

    // Make sure columns are there to pick.

    // Visible column section is hidden.
    assert.isFalse(await driver.find('.test-vfc-visible-fields-select-all').isPresent());
    // We should see a single Column picker.
    assert.isTrue(await driver.find('.test-config-widget-label-for-Column').isPresent());

    // Pick first column
    await toggleDrop(pickerDrop('Column'));
    await clickOption('A');
    await gu.waitForServer();

    // Now change to a widget without columns
    await toggleWidgetMenu();
    await clickOption(NORMAL_WIDGET);

    // Picker should disappear and column mappings should be visible
    assert.isTrue(await driver.find('.test-vfc-visible-fields-select-all').isPresent());
    assert.isFalse(await driver.find('.test-config-widget-label-for-Column').isPresent());

    await selectAccess(AccessLevel.read_table);
    // Widget should receive full records.
    assert.deepEqual(await widget.onRecords(), [
      {id: 1, A: 'A'},
      {id: 2, A: 'B'},
      {id: 3, A: 'C'},
    ]);
    // Now go back to the widget with mappings.
    await toggleWidgetMenu();
    await clickOption(COLUMN_WIDGET);
    await accept();
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
          {name: 'M1', allowMultiple: true},
          {name: 'M2', type: 'Text', allowMultiple: true},
        ],
        requiredAccess: 'read table',
      })
    );
    await accept();
    const empty = {M1: [], M2: []};
    await widget.waitForFrame();
    // Add some columns, numeric B and any C.
    await gu.selectSectionByTitle('Table');
    await gu.addColumn('B');
    await gu.getCell('B', 1).click();
    await gu.enterCell('99');
    await gu.addColumn('C');
    await gu.selectSectionByTitle('Widget');
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
    assert.deepEqual(await widget.onRecordsMappings(), {...empty, M1: ['A', 'B', 'C']});
    // Map A and C to M2
    await click(pickerAdd('M2'));
    assert.deepEqual(await getMenuOptions(), ['A', 'C']);
    // There should be information that column B is hidden (as it is not text)
    assert.equal(await driver.find('.test-config-widget-map-message-M2').getText(), '1 non-text column is not shown');
    await clickMenuItem('A');
    await click(pickerAdd('M2'));
    await clickMenuItem('C');
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
    assert.deepEqual(await widget.onRecordsMappings(), {M1: ['B', 'C', 'A'], M2: ['A', 'C']});
    // Should support removing
    const removeButton = (column: string, item: string) => {
      return dragItem(column, item).mouseMove().find('.test-config-widget-ref-select-remove');
    };
    await removeButton('M1', 'B').click();
    await gu.waitForServer();
    assert.deepEqual(await widget.onRecordsMappings(), {M1: ['C', 'A'], M2: ['A', 'C']});
    // Should undo removing
    await gu.undo();
    assert.deepEqual(await widget.onRecordsMappings(), {M1: ['B', 'C', 'A'], M2: ['A', 'C']});
    await removeButton('M1', 'B').click();
    await gu.waitForServer();
    await removeButton('M1', 'C').click();
    await gu.waitForServer();
    await removeButton('M2', 'C').click();
    await gu.waitForServer();
    assert.deepEqual(await widget.onRecordsMappings(), {M1: ['A'], M2: ['A']});
    await revert();
  });

  it('should remove mapping when column is deleted', async () => {
    const revert = await gu.begin();
    await toggleWidgetMenu();
    // Prepare mappings for single and multiple columns
    await clickOption(CUSTOM_URL);
    await gu.setWidgetUrl(
      createConfigUrl({
        columns: [{name: 'M1'}, {name: 'M2', allowMultiple: true}],
        requiredAccess: 'read table',
      })
    );
    await accept();
    await widget.waitForFrame();
    // Add some columns, to remove later
    await gu.selectSectionByTitle('Table');
    await gu.addColumn('B');
    await gu.addColumn('C');
    await gu.selectSectionByTitle('Widget');
    // Make sure we have no mappings
    assert.deepEqual(await widget.onRecordsMappings(), null);
    // Map B to M1
    await toggleDrop(pickerDrop('M1'));
    await clickOption('B');
    // Map all columns to M2
    for (const col of ['A', 'B', 'C']) {
      await click(pickerAdd('M2'));
      await clickMenuItem(col);
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
      await gu.selectSectionByTitle('Widget');
    };
    // Remove B column
    await removeColumn('B');
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
    assert.deepEqual(await getOptions(), ['A', 'C', 'B']);
    await clickOption('B');
    await click(pickerAdd('M2'));
    assert.deepEqual(await getMenuOptions(), ['B']); // multiple selection will only show not selected columns
    await clickMenuItem('B');
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
        columns: [{name: 'M1', type: 'Text'}, {name: 'M2', type: 'Text', allowMultiple: true}],
        requiredAccess: 'read table',
      })
    );
    await accept();
    await widget.waitForFrame();
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
    // Drop should be empty,
    assert.equal(await driver.find(pickerDrop("M1")).getText(), "Pick a text column");
    assert.isEmpty(await getListItems("M2"));
    // with no options
    await toggleDrop(pickerDrop("M1"));
    assert.isEmpty(await getOptions());
    await gu.sendKeys(Key.ESCAPE);
    // The same for M2
    await click(pickerAdd("M2"));
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
        await selectAccess(access);
        await widget.waitForFrame();
        assert.equal(await widget.onOptions(), null);
        assert.equal(await widget.access(), access);
        assert.isFalse(await widget.readonly());
      });

      it(`should save config options and inform about it the main widget`, async () => {
        await selectAccess(access);
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
        await selectAccess(access);
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
        await selectAccess(access);
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
        await selectAccess(access);
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
    assert.isFalse(await hasPrompt());
    assert.equal(await givenAccess(), AccessLevel.none);
    assert.equal(await widget.access(), AccessLevel.none);
    // Select widget that requests read access.
    await toggleWidgetMenu();
    await clickOption(READ_WIDGET);
    assert.isTrue(await hasPrompt());
    assert.equal(await givenAccess(), AccessLevel.none);
    assert.equal(await widget.access(), AccessLevel.none);
    await accept();
    assert.equal(await givenAccess(), AccessLevel.read_table);
    assert.equal(await widget.access(), AccessLevel.read_table);
    // Select widget that requests full access.
    await toggleWidgetMenu();
    await clickOption(FULL_WIDGET);
    assert.isTrue(await hasPrompt());
    assert.equal(await givenAccess(), AccessLevel.none);
    assert.equal(await widget.access(), AccessLevel.none);
    await accept();
    assert.equal(await givenAccess(), AccessLevel.full);
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
