import {assert, driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';
import {serveSomething} from 'test/server/customUtil';
import {AccessLevel, ICustomWidget} from 'app/common/CustomWidget';
import {AccessTokenResult} from 'app/plugin/GristAPI';
import {TableOperations} from 'app/plugin/TableOperations';
import {getAppRoot} from 'app/server/lib/places';
import fetch from 'node-fetch';
import * as path from 'path';

// Valid manifest url.
const manifestEndpoint = '/manifest.json';
// Valid widget url.
const widgetEndpoint = '/widget';
// Custom URL label in selectbox.
const CUSTOM_URL = 'Custom URL';

// Create some widgets:
const widget1: ICustomWidget = {widgetId: '1', name: 'W1', url: widgetEndpoint + '?name=W1'};
const widget2: ICustomWidget = {widgetId: '2', name: 'W2', url: widgetEndpoint + '?name=W2'};
const fromAccess = (level: AccessLevel) =>
  ({widgetId: level, name: level, url: widgetEndpoint, accessLevel: level}) as ICustomWidget;
const widgetNone = fromAccess(AccessLevel.none);
const widgetRead = fromAccess(AccessLevel.read_table);
const widgetFull = fromAccess(AccessLevel.full);

// Holds widgets manifest content.
let widgets: ICustomWidget[] = [];

describe('CustomWidgets', function () {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  // Holds url for sample widget server.
  let widgetServerUrl = '';

  // Switches widget manifest url
  function useManifest(url: string) {
    return server.testingHooks.setWidgetRepositoryUrl(url ? `${widgetServerUrl}${url}` : '');
  }

  before(async function () {
    if (server.isExternalServer()) {
      this.skip();
    }
    // Create simple widget server that serves manifest.json file, some widgets and some error pages.
    const widgetServer = await serveSomething(app => {
      app.get('/404', (_, res) => res.sendStatus(404).end()); // not found
      app.get('/500', (_, res) => res.sendStatus(500).end()); // internal error
      app.get('/200', (_, res) => res.sendStatus(200).end()); // valid response with OK
      app.get('/401', (_, res) => res.sendStatus(401).end()); // unauthorized
      app.get('/403', (_, res) => res.sendStatus(403).end()); // forbidden
      app.get(widgetEndpoint, (req, res) =>
        res
          .header('Content-Type', 'text/html')
          .send('<html><head><script src="/grist-plugin-api.js"></script></head><body>\n' +
            (req.query.name || req.query.access) + // send back widget name from query string or access level
            '</body></html>\n')
          .end()
      );
      app.get(manifestEndpoint, (_, res) =>
        res
          .header('Content-Type', 'application/json')
          // prefix widget endpoint with server address
          .json(widgets.map(widget => ({...widget, url: `${widgetServerUrl}${widget.url}`})))
          .end()
      );
      app.get('/grist-plugin-api.js', (_, res) =>
        res.sendFile(
          'grist-plugin-api.js', {
            root: path.resolve(getAppRoot(), "static")
          }));
    });

    cleanup.addAfterAll(widgetServer.shutdown);
    widgetServerUrl = widgetServer.url;

    // Start with valid endpoint and 2 widgets.
    widgets = [widget1, widget2];
    await useManifest(manifestEndpoint);

    const session = await gu.session().login();
    await session.tempDoc(cleanup, 'Hello.grist');
    // Add custom section.
    await gu.addNewSection(/Custom/, /Table1/, {selectBy: /TABLE1/});

    // Override gristConfig to enable widget list.
    await driver.executeScript('window.gristConfig.enableWidgetRepository = true;');
  });

  // Open or close widget menu.
  const toggle = () => driver.find('.test-config-widget-select .test-select-open').click();
  // Get current value from widget menu.
  const current = () => driver.find('.test-config-widget-select .test-select-open').getText();
  // Get options from widget menu (must be first opened).
  const options = () => driver.findAll('.test-select-menu li', e => e.getText());
  // Select widget from the menu.
  const select = async (text: string | RegExp) => {
    await driver.findContent('.test-select-menu li', text).click();
    await gu.waitForServer();
  };
  // Get rendered content from custom section.
  const content = async () => {
    const iframe = driver.find('iframe');
    await driver.switchTo().frame(iframe);
    const text = await driver.find('body').getText();
    await driver.switchTo().defaultContent();
    return text;
  };
  async function execute(
    op: (table: TableOperations) => Promise<any>,
    tableSelector: (grist: any) => TableOperations = (grist) => grist.selectedTable
  ) {
    const iframe = await driver.find('iframe');
    await driver.switchTo().frame(iframe);
    try {
      const harness = async (done: any) => {
        const grist = (window as any).grist;
        grist.ready();
        const table = tableSelector(grist);
        try {
          let result = await op(table);
          if (result === undefined) {
            result = "__undefined__";
          }
          done(result);
        } catch (e) {
          done(String(e.message || e));
        }
      };
      const cmd =
        'const done = arguments[arguments.length - 1];\n' +
        'const op = ' + op.toString() + ';\n' +
        'const tableSelector = ' + tableSelector.toString() + ';\n' +
        'const harness = ' + harness.toString() + ';\n' +
        'harness(done);\n';
      const result = await driver.executeAsyncScript(cmd);
      // done callback will return null instead of undefined
      return result === "__undefined__" ? undefined : result;
    } finally {
      await driver.switchTo().defaultContent();
    }
  }
  // Replace url for the Custom URL widget.
  const setUrl = async (url: string) => {
    await driver.find('.test-config-widget-url').click();
    // First clear textbox.
    await gu.clearInput();
    if (url) {
      await gu.sendKeys(`${widgetServerUrl}${url}`, Key.ENTER);
    } else {
      await gu.sendKeys(Key.ENTER);
    }
  };
  // Get an URL from the URL textbox.
  const getUrl = () => driver.find('.test-config-widget-url').value();
  // Get first error message from error toasts.
  const getErrorMessage = async () => (await gu.getToasts())[0];
  // Changes active section to recreate creator panel.
  async function recreatePanel() {
    await gu.getSection('TABLE1').click();
    await gu.getSection('TABLE1 Custom').click();
    await gu.waitForServer();
  }
  // Gets or sets access level
  async function access(level?: AccessLevel) {
    const text = {
      [AccessLevel.none] : "No document access",
      [AccessLevel.read_table]: "Read selected table",
      [AccessLevel.full]: "Full document access"
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
  const hasPrompt = () => driver.find(".test-config-widget-access-accept").isPresent();
  // Accepts new access level.
  const accept = () => driver.find(".test-config-widget-access-accept").click();
  // Rejects new access level.
  const reject = () => driver.find(".test-config-widget-access-reject").click();

  it('should show widgets in dropdown', async () => {
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-right-tab-pagewidget').click();
    await gu.waitForServer();
    await driver.find('.test-config-widget').click();
    await gu.waitForServer(); // Wait for widgets to load.

    // Selectbox should have select label.
    assert.equal(await current(), CUSTOM_URL);

    // There should be 3 options (together with Custom URL)
    await toggle();
    assert.deepEqual(await options(), [CUSTOM_URL, widget1.name, widget2.name]);
    await toggle();
  });

  it('should switch between widgets', async () => {
    // Test custom URL.
    await toggle();
    await select(CUSTOM_URL);
    assert.equal(await current(), CUSTOM_URL);
    assert.equal(await getUrl(), '');
    await setUrl('/200');
    assert.equal(await content(), 'OK');

    // Test first widget.
    await toggle();
    await select(widget1.name);
    assert.equal(await current(), widget1.name);
    assert.equal(await content(), widget1.name);

    // Test second widget.
    await toggle();
    await select(widget2.name);
    assert.equal(await current(), widget2.name);
    assert.equal(await content(), widget2.name);

    // Go back to Custom URL.
    await toggle();
    await select(CUSTOM_URL);
    assert.equal(await getUrl(), '');
    assert.equal(await current(), CUSTOM_URL);
    await setUrl('/200');
    assert.equal(await content(), 'OK');

    // Clear url and test if message page is shown.
    await setUrl('');
    assert.equal(await current(), CUSTOM_URL);
    assert.isTrue((await content()).startsWith('Custom widget')); // start page

    await recreatePanel();
    assert.equal(await current(), CUSTOM_URL);
    await gu.undo(7);
  });

  it('should show error message for invalid widget url list', async () => {
    const testError = async (url: string, error: string) => {
      // Switch section to rebuild the creator panel.
      await useManifest(url);
      await recreatePanel();
      assert.include(await getErrorMessage(), error);
      await gu.wipeToasts();
      // List should contain only a Custom URL.
      await toggle();
      assert.deepEqual(await options(), [CUSTOM_URL]);
      await toggle();
    };

    await testError('/404', "Remote widget list not found");
    await testError('/500', "Remote server returned an error");
    await testError('/401', "Remote server returned an error");
    await testError('/403', "Remote server returned an error");
    // Invalid content in a response.
    await testError('/200', "Error reading widget list");

    // Reset to valid manifest.
    await useManifest(manifestEndpoint);
    await recreatePanel();
  });

  it('should show widget when it was removed from list', async () => {
    // Select widget1 and then remove it from the list.
    await toggle();
    await select(widget1.name);
    widgets = [widget2];
    // Invalidate cache.
    await useManifest(manifestEndpoint);
    // Toggle sections to reset creator panel and fetch list of available widgets.
    await recreatePanel();
    // But still should be selected with a correct url.
    assert.equal(await current(), widget1.name);
    assert.equal(await content(), widget1.name);
    await gu.undo(1);
  });

  it('should switch access level to none on new widget', async () => {
    widgets = [widget1, widget2];
    await useManifest(manifestEndpoint);
    await recreatePanel();

    await toggle();
    await select(widget1.name);
    assert.equal(await access(), AccessLevel.none);
    await access(AccessLevel.full);
    assert.equal(await access(), AccessLevel.full);

    await toggle();
    await select(widget2.name);
    assert.equal(await access(), AccessLevel.none);
    await access(AccessLevel.full);
    assert.equal(await access(), AccessLevel.full);

    await toggle();
    await select(CUSTOM_URL);
    assert.equal(await access(), AccessLevel.none);
    await access(AccessLevel.full);
    assert.equal(await access(), AccessLevel.full);

    await toggle();
    await select(widget2.name);
    assert.equal(await access(), AccessLevel.none);
    await access(AccessLevel.full);
    assert.equal(await access(), AccessLevel.full);

    await gu.undo(8);
  });

  it('should prompt for access change', async () => {
    widgets = [widget1, widget2, widgetFull, widgetNone, widgetRead];
    await useManifest(manifestEndpoint);
    await recreatePanel();

    const test = async (w: ICustomWidget) => {
      // Select widget without desired access level
      await toggle();
      await select(widget1.name);
      assert.isFalse(await hasPrompt());
      assert.equal(await access(), AccessLevel.none);

      // Select one with desired access level
      await toggle();
      await select(w.name);
      // Access level should be still none (test by content which will display access level from query string)
      assert.equal(await content(), AccessLevel.none);
      assert.equal(await access(), AccessLevel.none);
      assert.isTrue(await hasPrompt());

      // Accept, and test if prompt is hidden, and level stays
      await accept();
      assert.isFalse(await hasPrompt());
      assert.equal(await access(), w.accessLevel);

      // Do the same, but this time reject
      await toggle();
      await select(widget1.name);
      assert.isFalse(await hasPrompt());
      assert.equal(await access(), AccessLevel.none);

      await toggle();
      await select(w.name);
      assert.isTrue(await hasPrompt());
      assert.equal(await content(), AccessLevel.none);

      await reject();
      assert.isFalse(await hasPrompt());
      assert.equal(await access(), AccessLevel.none);
      assert.equal(await content(), AccessLevel.none);
    };

    await test(widgetFull);
    await test(widgetRead);
  });

  it('should auto accept none access level', async () => {
    // Select widget without access level
    await toggle();
    await select(widget1.name);
    assert.isFalse(await hasPrompt());
    assert.equal(await access(), AccessLevel.none);

    // Switch to one with none access level
    await toggle();
    await select(widgetNone.name);
    assert.isFalse(await hasPrompt());
    assert.equal(await access(), AccessLevel.none);
    assert.equal(await content(), AccessLevel.none);
  });

  it('should show prompt when user switches sections', async () => {
    // Select widget without access level
    await toggle();
    await select(widget1.name);
    assert.isFalse(await hasPrompt());
    assert.equal(await access(), AccessLevel.none);

    // Switch to one with full access level
    await toggle();
    await select(widgetFull.name);
    assert.isTrue(await hasPrompt());

    // Switch section, and test if prompt is hidden
    await recreatePanel();
    assert.isTrue(await hasPrompt());
    assert.equal(await access(), AccessLevel.none);
    assert.equal(await content(), AccessLevel.none);
  });

  it('should hide prompt when user switches widget', async () => {
    // Select widget without access level
    await toggle();
    await select(widget1.name);
    assert.isFalse(await hasPrompt());
    assert.equal(await access(), AccessLevel.none);

    // Switch to one with full access level
    await toggle();
    await select(widgetFull.name);
    assert.isTrue(await hasPrompt());

    // Switch to another level.
    await toggle();
    await select(widget1.name);
    assert.isFalse(await hasPrompt());
    assert.equal(await access(), AccessLevel.none);
  });

  it('should hide prompt when manually changes access level', async () => {
    // Select widget with no access level
    const selectNone = async () => {
      await toggle();
      await select(widgetNone.name);
      assert.isFalse(await hasPrompt());
      assert.equal(await access(), AccessLevel.none);
      assert.equal(await content(), AccessLevel.none);
    };

    // Selects widget with full access level
    const selectFull = async () => {
      await toggle();
      await select(widgetFull.name);
      assert.isTrue(await hasPrompt());
      assert.equal(await content(), AccessLevel.none);
      assert.equal(await content(), AccessLevel.none);
    };

    await selectNone();
    await selectFull();

    // Select the same level.
    await access(AccessLevel.full);
    assert.isFalse(await hasPrompt());
    assert.equal(await access(), AccessLevel.full);
    assert.equal(await content(), AccessLevel.full);

    await selectNone();
    await selectFull();

    // Select the normal level, prompt should be still there, as widget needs a higher permission.
    await access(AccessLevel.read_table);
    assert.isTrue(await hasPrompt());
    assert.equal(await access(), AccessLevel.read_table);
    assert.equal(await content(), AccessLevel.read_table);

    await selectNone();
    await selectFull();

    // Select the none level.
    await access(AccessLevel.none);
    assert.isTrue(await hasPrompt());
    assert.equal(await access(), AccessLevel.none);
    assert.equal(await content(), AccessLevel.none);
  });

  it("should support grist.selectedTable", async () => {
    // Open a custom widget with full access.
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-config-widget').click();
    await gu.waitForServer();
    await toggle();
    await select(widget1.name);
    await access(AccessLevel.full);

    // Check an upsert works.
    await execute(async (table) => {
      await table.upsert({
        require: {A: 'hello'},
        fields: {A: 'goodbye'}
      });
    });
    await gu.waitToPass(async () => {
      assert.equal(await gu.getCell({section: 'TABLE1', rowNum: 1, col: 0}).getText(), 'goodbye');
    });

    // Check an update works.
    await execute(async table => {
      return table.update({
        id: 2,
        fields: {A: 'farewell'}
      });
    });
    await gu.waitToPass(async () => {
      assert.equal(await gu.getCell({section: 'TABLE1', rowNum: 2, col: 0}).getText(), 'farewell');
    });

    // Check options are passed along.
    await execute(async table => {
      return table.upsert({
        require: {},
        fields: {A: 'goodbyes'}
      }, {onMany: 'all', allowEmptyRequire: true});
    });
    await gu.waitToPass(async () => {
      assert.equal(await gu.getCell({section: 'TABLE1', rowNum: 1, col: 0}).getText(), 'goodbyes');
      assert.equal(await gu.getCell({section: 'TABLE1', rowNum: 2, col: 0}).getText(), 'goodbyes');
    });

    // Check a create works.
    const {id} = await execute(async table => {
      return table.create({
        fields: {A: 'partA', B: 'partB'}
      });
    }) as {id: number};
    assert.equal(id, 5);
    await gu.waitToPass(async () => {
      assert.equal(await gu.getCell({section: 'TABLE1', rowNum: id, col: 0}).getText(), 'partA');
      assert.equal(await gu.getCell({section: 'TABLE1', rowNum: id, col: 1}).getText(), 'partB');
    });

    // Check a destroy works.
    let result = await execute(async table => {
      await table.destroy(1);
    });
    assert.isUndefined(result);
    await gu.waitToPass(async () => {
      assert.equal(await gu.getCell({section: 'TABLE1', rowNum: id - 1, col: 0}).getText(), 'partA');
    });
    result = await execute(async table => {
      await table.destroy([2]);
    });
    assert.isUndefined(result);
    await gu.waitToPass(async () => {
      assert.equal(await gu.getCell({section: 'TABLE1', rowNum: id - 2, col: 0}).getText(), 'partA');
    });

    // Check errors are friendly.
    const errMessage = await execute(async table => {
      await table.create({fields: {ziggy: 1}});
    });
    assert.equal(errMessage, 'Invalid column "ziggy"');
  });

  it("should support grist.getTable", async () => {
    // Check an update on an existing table works.
    await execute(async table => {
      return table.update({
        id: 3,
        fields: {A: 'back again'}
      });
    }, (grist) => grist.getTable('Table1'));
    await gu.waitToPass(async () => {
      assert.equal(await gu.getCell({section: 'TABLE1', rowNum: 1, col: 0}).getText(), 'back again');
    });

    // Check an update on a nonexistent table fails.
    assert.match(String(await execute(async table => {
      return table.update({
        id: 3,
        fields: {A: 'back again'}
      });
    }, (grist) => grist.getTable('Table2'))), /Table not found/);
  });

  it("should support grist.getAccessTokens", async () => {
    const iframe = await driver.find('iframe');
    await driver.switchTo().frame(iframe);
    try {
      const tokenResult: AccessTokenResult = await driver.executeAsyncScript(
        (done: any) => (window as any).grist.getAccessToken().then(done)
      );
      assert.sameMembers(Object.keys(tokenResult), ['ttlMsecs', 'token', 'baseUrl']);
      const result = await fetch(tokenResult.baseUrl + `/tables/Table1/records?auth=${tokenResult.token}`);
      assert.sameMembers(Object.keys(await result.json()), ['records']);
    } finally {
      await driver.switchTo().defaultContent();
    }
  });

  it('should offer only custom url when disabled', async () => {
    await toggle();
    await select(CUSTOM_URL);
    await driver.executeScript('window.gristConfig.enableWidgetRepository = false;');
    await recreatePanel();
    assert.isTrue(await driver.find('.test-config-widget-url').isDisplayed());
    assert.isFalse(await driver.find('.test-config-widget-select').isPresent());
  });
});
