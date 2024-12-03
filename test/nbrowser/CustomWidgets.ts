import {AccessLevel, ICustomWidget} from 'app/common/CustomWidget';
import {AccessTokenResult} from 'app/plugin/GristAPI';
import {TableOperations} from 'app/plugin/TableOperations';
import {getAppRoot} from 'app/server/lib/places';
import * as fse from 'fs-extra';
import {assert, driver, Key} from 'mocha-webdriver';
import fetch from 'node-fetch';
import * as path from 'path';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';
import {serveSomething} from 'test/server/customUtil';
import {createTmpDir} from 'test/server/docTools';
import {EnvironmentSnapshot} from 'test/server/testUtils';

// Valid manifest url.
const manifestEndpoint = '/manifest.json';
// Valid widget url.
const widgetEndpoint = '/widget';
// Custom URL label in selectbox.
const CUSTOM_URL = 'Custom URL';

// Create some widgets:
const widget1: ICustomWidget = {
  widgetId: '1',
  name: 'W1',
  url: widgetEndpoint + '?name=W1',
  description: 'Widget 1 description',
  authors: [
    {
      name: 'Developer 1',
    },
    {
      name: 'Developer 2',
    },
  ],
  isGristLabsMaintained: true,
  lastUpdatedAt: '2024-07-30T00:13:31-04:00',
};
const widget2: ICustomWidget = {
  widgetId: '2',
  name: 'W2',
  url: widgetEndpoint + '?name=W2',
};
const widgetWithTheme: ICustomWidget = {
  widgetId: '3',
  name: 'WithTheme',
  url: widgetEndpoint + '?name=WithTheme',
  isGristLabsMaintained: true,
};
const widgetNoPluginApi: ICustomWidget = {
  widgetId: '4',
  name: 'NoPluginApi',
  url: widgetEndpoint + '?name=NoPluginApi',
  isGristLabsMaintained: true,
};
const fromAccess = (level: AccessLevel): ICustomWidget => ({
  widgetId: level,
  name: level,
  url: widgetEndpoint,
  accessLevel: level,
  isGristLabsMaintained: true,
});
const widgetNone = fromAccess(AccessLevel.none);
const widgetRead = fromAccess(AccessLevel.read_table);
const widgetFull = fromAccess(AccessLevel.full);

// Holds widgets manifest content.
let widgets: ICustomWidget[] = [];

// Helper function to get iframe with custom widget.
function getCustomWidgetFrame() {
  return driver.findWait('iframe', 500);
}

describe('CustomWidgets', function () {
  this.timeout(20000);
  gu.bigScreen();
  const cleanup = setupTestSuite();

  let oldEnv: EnvironmentSnapshot;

  // Holds url for sample widget server.
  let widgetServerUrl = '';

  // Switches widget manifest url
  async function useManifest(url: string) {
    await server.testingHooks.setWidgetRepositoryUrl(url ? `${widgetServerUrl}${url}` : '');
  }

  async function reloadWidgets() {
    await driver.executeAsyncScript(
      (done: any) => (window as any).gristApp?.topAppModel.testReloadWidgets().then(done).catch(done) || done()
    );
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
          .send('<html><head>' +
            (req.query.name === 'NoPluginApi' ? '' : '<script src="/grist-plugin-api.js"></script>') +
            (req.query.name === 'WithTheme' ? '<script>grist.ready();</script>' : '') +
            '</head><body>\n' +
            (req.query.name === 'WithTheme' ? '<span style="color: var(--grist-theme-text);">' : '') +
            (req.query.name || req.query.access) + // send back widget name from query string or access level
            (req.query.name === 'WithTheme' ? '</span>' : '') +
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

    oldEnv = new EnvironmentSnapshot();
    process.env.GRIST_WIDGET_LIST_URL = `${widgetServerUrl}${manifestEndpoint}`;
    await server.restart();

    // Start with 2 widgets.
    widgets = [widget1, widget2];

    const session = await gu.session().login();
    await session.tempDoc(cleanup, 'Hello.grist');

    // Add custom section.
    await gu.addNewSection(/Custom/, /Table1/, {customWidget: /Custom URL/, selectBy: /TABLE1/});
  });

  after(async function() {
    await server.testingHooks.setWidgetRepositoryUrl('');
    oldEnv.restore();
    await server.restart();
  });

  afterEach(() => gu.checkForErrors());

  // Get available widgets from widget gallery (must be first opened).
  const galleryWidgets = () => driver.findAll('.test-custom-widget-gallery-widget-name', e => e.getText());

  // Get rendered content from custom section.
  const content = async () => {
      return gu.doInIframe(await getCustomWidgetFrame(), async ()=>{
        const text = await driver.find('body').getText();
        return text;
      });
  };

  async function execute(
    op: (table: TableOperations) => Promise<any>,
    tableSelector: (grist: any) => TableOperations = (grist) => grist.selectedTable
  ) {
    return gu.doInIframe(await getCustomWidgetFrame(), async ()=> {
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
    });
  }
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

  async function enableWidgetsAndShowPanel() {
    // We need to be sure that widget configuration panel is open all the time.
    await gu.toggleSidePanel('right', 'open');
    await recreatePanel();
    await driver.findWait('.test-right-tab-pagewidget', 100).click();
  }

  describe('RightWidgetMenu', () => {
    beforeEach(enableWidgetsAndShowPanel);

    afterEach(() => gu.checkForErrors());

    it('should show button to open gallery', async () => {
      const button = await driver.find('.test-config-widget-open-custom-widget-gallery');
      assert.equal(await button.getText(), 'Custom URL');
      await button.click();
      assert.isTrue(await driver.find('.test-custom-widget-gallery-container').isDisplayed());
      await gu.sendKeys(Key.ESCAPE, Key.ESCAPE);
      assert.isFalse(await driver.find('.test-custom-widget-gallery-container').isPresent());
    });

    it('should switch between widgets', async () => {
      // Test Custom URL.
      assert.equal(await gu.getCustomWidgetName(), CUSTOM_URL);
      assert.isTrue((await content()).startsWith('Custom widget'));
      await gu.setCustomWidgetUrl(`${widgetServerUrl}/200`);
      assert.equal(await gu.getCustomWidgetName(), CUSTOM_URL);
      assert.equal(await content(), 'OK');

      // Test first widget.
      await gu.setCustomWidget(widget1.name);
      assert.equal(await gu.getCustomWidgetName(), widget1.name);
      assert.equal(await gu.getCustomWidgetInfo('description'), widget1.description);
      assert.equal(await gu.getCustomWidgetInfo('developer'), widget1.authors?.[0].name);
      assert.equal(await gu.getCustomWidgetInfo('last-updated'), 'July 30, 2024');
      assert.equal(await content(), widget1.name);

      // Test second widget.
      await gu.setCustomWidget(widget2.name);
      assert.equal(await gu.getCustomWidgetName(), widget2.name);
      assert.equal(await gu.getCustomWidgetInfo('description'), '');
      assert.equal(await gu.getCustomWidgetInfo('developer'), '');
      assert.equal(await gu.getCustomWidgetInfo('last-updated'), '');
      assert.equal(await content(), widget2.name);

      // Go back to Custom URL.
      await gu.setCustomWidget(CUSTOM_URL);
      assert.equal(await gu.getCustomWidgetName(), CUSTOM_URL);
      assert.isTrue((await content()).startsWith('Custom widget'));
      await gu.setCustomWidgetUrl(`${widgetServerUrl}/200`);
      assert.equal(await gu.getCustomWidgetName(), CUSTOM_URL);
      assert.equal(await content(), 'OK');

      // Clear url and test if message page is shown.
      await gu.setCustomWidgetUrl('');
      assert.equal(await gu.getCustomWidgetName(), CUSTOM_URL);
      assert.isTrue((await content()).startsWith('Custom widget'));

      await recreatePanel();
      assert.equal(await gu.getCustomWidgetName(), CUSTOM_URL);
      await gu.undo(6);
    });

    it('should support theme variables', async () => {
      widgets = [widgetWithTheme];
      await reloadWidgets();
      await recreatePanel();
      await gu.setCustomWidget(widgetWithTheme.name);
      assert.equal(await gu.getCustomWidgetName(), widgetWithTheme.name);
      assert.equal(await content(), widgetWithTheme.name);

      const getWidgetColor = async () => {
        const iframe = driver.find('iframe');
        await driver.switchTo().frame(iframe);
        const color = await driver.find('span').getCssValue('color');
        await driver.switchTo().defaultContent();
        return color;
      };

      // Check that the widget is using the text color from the GristLight theme.
      assert.equal(await getWidgetColor(), 'rgba(38, 38, 51, 1)');

      // Switch the theme to GristDark.
      await gu.setGristTheme({appearance: 'dark', syncWithOS: false});
      await driver.navigate().back();
      await gu.waitForDocToLoad();

      // Check that the span is using the text color from the GristDark theme.
      assert.equal(await getWidgetColor(), 'rgba(239, 239, 239, 1)');

      // Switch back to GristLight.
      await gu.setGristTheme({appearance: 'light', syncWithOS: true});
      await driver.navigate().back();
      await gu.waitForDocToLoad();

      // Check that the widget is back to using the GristLight text color.
      assert.equal(await getWidgetColor(), 'rgba(38, 38, 51, 1)');
    });

    it("should support widgets that don't use the plugin api", async () => {
      widgets = [widgetNoPluginApi];
      await reloadWidgets();
      await recreatePanel();
      await gu.setCustomWidget(widgetNoPluginApi.name);
      assert.equal(await gu.getCustomWidgetName(), widgetNoPluginApi.name);

      // Check that the widget loaded and its iframe is visible.
      assert.equal(await content(), widgetNoPluginApi.name);
      assert.isTrue(await driver.find('iframe').isDisplayed());

      // Revert to original configuration.
      widgets = [widget1, widget2];
      await reloadWidgets();
      await recreatePanel();
    });

    it('should show error message for invalid widget url list', async () => {
      const testError = async (url: string, error: string) => {
        // Switch section to rebuild the creator panel.
        await useManifest(url);
        await reloadWidgets();
        await recreatePanel();
        assert.include(await getErrorMessage(), error);
        await gu.wipeToasts();
        // Gallery should only contain the Custom URL widget.
        await gu.openCustomWidgetGallery();
        assert.deepEqual(await galleryWidgets(), [CUSTOM_URL]);
        await gu.wipeToasts();
        await gu.sendKeys(Key.ESCAPE);
      };

      await testError('/404', "Remote widget list not found");
      await testError('/500', "Remote server returned an error");
      await testError('/401', "Remote server returned an error");
      await testError('/403', "Remote server returned an error");
      // Invalid content in a response.
      await testError('/200', "Error reading widget list");

      // Reset to valid manifest.
      await useManifest(manifestEndpoint);
      await reloadWidgets();
      await recreatePanel();
    });

    /**
     * Need to think about whether this is desirable?
     * The document could be on a different Grist installation to the
     * one where it was created.
     */
    it.skip('should show widget when it was removed from list', async () => {
      // Select widget1 and then remove it from the list.
      await gu.setCustomWidget(widget1.name);
      widgets = [widget2];
      // Invalidate cache.
      await reloadWidgets();
      // Toggle sections to reset creator panel and fetch list of available widgets.
      await recreatePanel();
      // But still should be selected with a correct url.
      assert.equal(await gu.getCustomWidgetName(), widget1.name);
      assert.equal(await content(), widget1.name);
      await gu.undo(1);
    });

    it('should switch access level to none on new widget', async () => {
      widgets = [widget1, widget2];
      await recreatePanel();
      await gu.setCustomWidget(widget1.name);
      assert.equal(await access(), AccessLevel.none);
      await access(AccessLevel.full);
      assert.equal(await access(), AccessLevel.full);

      await gu.setCustomWidget(widget2.name);
      assert.equal(await access(), AccessLevel.none);
      await access(AccessLevel.full);
      assert.equal(await access(), AccessLevel.full);

      await gu.setCustomWidget(CUSTOM_URL);
      assert.equal(await access(), AccessLevel.none);
      await access(AccessLevel.full);
      assert.equal(await access(), AccessLevel.full);

      await gu.setCustomWidget(widget2.name);
      assert.equal(await access(), AccessLevel.none);
      await access(AccessLevel.full);
      assert.equal(await access(), AccessLevel.full);

      await gu.undo(8);
    });

    it('should prompt for access change', async () => {
      widgets = [widget1, widget2, widgetFull, widgetNone, widgetRead];
      await reloadWidgets();
      await recreatePanel();

      const test = async (w: ICustomWidget) => {
        // Select widget without desired access level
        await gu.setCustomWidget(widget1.name);
        assert.isFalse(await hasPrompt());
        assert.equal(await access(), AccessLevel.none);

        // Select one with desired access level
        await gu.setCustomWidget(w.name);

        // Access level should be still none (test by content which will display access level from query string)
        assert.equal(await content(), AccessLevel.none);
        assert.equal(await access(), AccessLevel.none);
        assert.isTrue(await hasPrompt());

        // Accept, and test if prompt is hidden, and level stays
        await accept();
        assert.isFalse(await hasPrompt());
        assert.equal(await access(), w.accessLevel);

        // Do the same, but this time reject
        await gu.setCustomWidget(widget1.name);
        assert.isFalse(await hasPrompt());
        assert.equal(await access(), AccessLevel.none);

        await gu.setCustomWidget(w.name);
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
      await gu.setCustomWidget(widget1.name);
      assert.isFalse(await hasPrompt());
      assert.equal(await access(), AccessLevel.none);

      // Switch to one with none access level
      await gu.setCustomWidget(widgetNone.name);
      assert.isFalse(await hasPrompt());
      assert.equal(await access(), AccessLevel.none);
      assert.equal(await content(), AccessLevel.none);
    });

    it('should show prompt when user switches sections', async () => {
      // Select widget without access level
      await gu.setCustomWidget(widget1.name);
      assert.isFalse(await hasPrompt());
      assert.equal(await access(), AccessLevel.none);

      // Switch to one with full access level
      await gu.setCustomWidget(widgetFull.name);
      assert.isTrue(await hasPrompt());

      // Switch section, and test if prompt is hidden
      await recreatePanel();
      assert.isTrue(await hasPrompt());
      assert.equal(await access(), AccessLevel.none);
      assert.equal(await content(), AccessLevel.none);
    });

    it('should hide prompt when user switches widget', async () => {
      // Select widget without access level
      await gu.setCustomWidget(widget1.name);
      assert.isFalse(await hasPrompt());
      assert.equal(await access(), AccessLevel.none);

      // Switch to one with full access level
      await gu.setCustomWidget(widgetFull.name);
      assert.isTrue(await hasPrompt());

      // Switch to another level.
      await gu.setCustomWidget(widget1.name);
      assert.isFalse(await hasPrompt());
      assert.equal(await access(), AccessLevel.none);
    });

    it('should hide prompt when manually changes access level', async () => {
      // Select widget with no access level
      const selectNone = async () => {
        await gu.setCustomWidget(widgetNone.name);
        assert.isFalse(await hasPrompt());
        assert.equal(await access(), AccessLevel.none);
        assert.equal(await content(), AccessLevel.none);
      };

      // Selects widget with full access level
      const selectFull = async () => {
        await gu.setCustomWidget(widgetFull.name);
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
  });

  describe('gallery', () => {
    afterEach(() => gu.checkForErrors());

    it('should show available widgets', async () => {
      await gu.openCustomWidgetGallery();
      assert.deepEqual(
        await driver.findAll('.test-custom-widget-gallery-widget-name', (el) => el.getText()),
        ['Custom URL', 'full', 'none', 'read table', 'W1', 'W2']
      );
    });

    it('should show available metadata', async () => {
      assert.deepEqual(
        await driver.findAll('.test-custom-widget-gallery-widget', (el) =>
          el.matches('.test-custom-widget-gallery-widget-custom')),
        [true, false, false, false, false, false]
      );
      assert.deepEqual(
        await driver.findAll('.test-custom-widget-gallery-widget', (el) =>
          el.matches('.test-custom-widget-gallery-widget-grist')),
        [false, true, true, true, true, false]
      );
      assert.deepEqual(
        await driver.findAll('.test-custom-widget-gallery-widget', (el) =>
          el.matches('.test-custom-widget-gallery-widget-community')),
        [false, false, false, false, false, true]
      );
      assert.deepEqual(
        await driver.findAll('.test-custom-widget-gallery-widget-description', (el) => el.getText()),
        [
          'Add a widget from outside this gallery.',
          '(Missing info)',
          '(Missing info)',
          '(Missing info)',
          'Widget 1 description',
          '(Missing info)',
        ]
      );
      assert.deepEqual(
        await driver.findAll('.test-custom-widget-gallery-widget-developer', (el) => el.getText()),
        [
          '(Missing info)',
          '(Missing info)',
        ]
      );
      assert.deepEqual(
        await driver.findAll('.test-custom-widget-gallery-widget-last-updated', (el) => el.getText()),
        [
          '(Missing info)',
          '(Missing info)',
          '(Missing info)',
          'July 30, 2024',
          '(Missing info)',
        ]
      );
    });

    it('should filter widgets on search', async () => {
      await driver.find('.test-custom-widget-gallery-search').click();
      await gu.sendKeys('Custom');
      await gu.waitToPass(async () => {
        assert.deepEqual(
          await driver.findAll('.test-custom-widget-gallery-widget-name', (el) => el.getText()),
          ['Custom URL']
        );
      }, 200);
      await gu.sendKeys(await gu.selectAllKey(), Key.DELETE);
      await gu.waitToPass(async () => {
        assert.deepEqual(
          await driver.findAll('.test-custom-widget-gallery-widget-name', (el) => el.getText()),
          ['Custom URL', 'full', 'none', 'read table', 'W1', 'W2']
        );
      }, 200);
      await gu.sendKeys('W');
      await gu.waitToPass(async () => {
        assert.deepEqual(
          await driver.findAll('.test-custom-widget-gallery-widget-name', (el) => el.getText()),
          ['Custom URL', 'W1', 'W2']
        );
      }, 200);
      await gu.sendKeys(await gu.selectAllKey(), Key.DELETE, 'tab');
      await gu.waitToPass(async () => {
        assert.deepEqual(
          await driver.findAll('.test-custom-widget-gallery-widget-name', (el) => el.getText()),
          ['read table']
        );
      }, 200);
      await gu.sendKeys(await gu.selectAllKey(), Key.DELETE, 'Markdown');
      await gu.waitToPass(async () => {
        assert.deepEqual(
          await driver.findAll('.test-custom-widget-gallery-widget-name', (el) => el.getText()),
          []
        );
      }, 200);
      await gu.sendKeys(await gu.selectAllKey(), Key.DELETE, 'Developer 1');
      await gu.waitToPass(async () => {
        assert.deepEqual(
          await driver.findAll('.test-custom-widget-gallery-widget-name', (el) => el.getText()),
          ['W1']
        );
      }, 200);
    });

    it('should only show Custom URL widget when repository is disabled', async () => {
      await gu.sendKeys(Key.ESCAPE);
      await driver.executeScript('window.gristConfig.enableWidgetRepository = false;');
      await driver.executeAsyncScript(
        (done: any) => (window as any).gristApp?.topAppModel.testReloadWidgets().then(done).catch(done) || done()
      );
      await gu.openCustomWidgetGallery();
      assert.deepEqual(
        await driver.findAll('.test-custom-widget-gallery-widget-name', (el) => el.getText()),
        ['Custom URL']
      );
      await gu.sendKeys(Key.ESCAPE);
      await driver.executeScript('window.gristConfig.enableWidgetRepository = true;');
      await driver.executeAsyncScript(
        (done: any) => (window as any).gristApp?.topAppModel.testReloadWidgets().then(done).catch(done) || done()
      );
    });

    it("allows picking the same widget", async () => {
      await gu.setCustomWidget(/W1/);
      assert.equal(await gu.getCustomWidgetName(), "W1");
      await gu.setCustomWidget(/W1/);
      assert.equal(await gu.getCustomWidgetName(), "W1");
    });
  });

  describe('gristApiSupport', async ()=>{
    beforeEach(async function () {
      // We need to be sure that widget configuration panel is open all the time.
      await gu.toggleSidePanel('right', 'open');
      await recreatePanel();
      await driver.findWait('.test-right-tab-pagewidget', 100).click();
    });

    afterEach(() => gu.checkForErrors());

    it('should set language in widget url', async () => {
      function languageMenu() {
        return gu.currentDriver().find('.test-account-page-language .test-select-open');
      }
      async function language() {
        return await gu.doInIframe(await getCustomWidgetFrame(), async ()=>{
          const urlText = await driver.executeScript<string>('return document.location.href');
          const url = new URL(urlText);
          return url.searchParams.get('language');
        });
      }

      async function switchLanguage(lang: string) {
        await gu.openProfileSettingsPage();
        await gu.waitForServer();
        await languageMenu().click();
        await driver.findContentWait('.test-select-menu li', lang, 100).click();
        await gu.waitForServer();
        await driver.navigate().back();
        await gu.waitForServer();
      }

      widgets = [widget1];
      await reloadWidgets();
      await gu.openWidgetPanel();
      await gu.setCustomWidget(widget1.name);
      //Switch language to Polish
      await switchLanguage('Polski');
      //Check if widgets have "pl" in url
      assert.equal(await language(), 'pl');
      //Switch back to English
      await switchLanguage('English');
      //Check if widgets have "en" in url
      assert.equal(await language(), 'en');
    });

    it("should support grist.selectedTable", async () => {
      // Open a custom widget with full access.
      await gu.toggleSidePanel('right', 'open');
      await driver.find('.test-config-widget').click();
      await gu.waitForServer();
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
      return await gu.doInIframe(await getCustomWidgetFrame(), async ()=>{
        const tokenResult: AccessTokenResult = await driver.executeAsyncScript(
          (done: any) => (window as any).grist.getAccessToken().then(done)
        );
        assert.sameMembers(Object.keys(tokenResult), ['ttlMsecs', 'token', 'baseUrl']);
        const result = await fetch(tokenResult.baseUrl + `/tables/Table1/records?auth=${tokenResult.token}`);
        assert.sameMembers(Object.keys(await result.json()), ['records']);
      });
    });
  });

  describe('Bundling', function () {
    let oldEnv: EnvironmentSnapshot;

    before(async function () {
      oldEnv = new EnvironmentSnapshot();
    });

    afterEach(async function() {
      await gu.checkForErrors();
      oldEnv.restore();
      await server.restart();
      await gu.reloadDoc();
    });

    for (const variant of ['flat', 'nested'] as const) {
      it(`can add widgets via plugins (${variant} layout)`, async function () {
        // Double-check that using one external widget, we see
        // just that widget listed.
        widgets = [widget1];
        await reloadWidgets();
        await enableWidgetsAndShowPanel();
        await gu.openCustomWidgetGallery();
        assert.deepEqual(await galleryWidgets(), [
          CUSTOM_URL, widget1.name,
        ]);

        // Get a temporary directory that will be cleaned up,
        // and populated it as follows ('flat' variant)
        //   plugins/
        //     my-widgets/
        //       manifest.yml   # a plugin manifest, listing widgets.json
        //       widgets.json   # a widget set manifest, grist-widget style
        //       p1.html        # one of the widgets in widgets.json
        //       p2.html        # another of the widgets in widgets.json
        //       grist-plugin-api.js   # a dummy api file, to check it is overridden
        // In 'nested' variant, widgets.json and the files it refers to are in
        // a subdirectory.
        const dir = await createTmpDir();
        const pluginDir = path.join(dir, 'plugins', 'my-widgets');
        const widgetDir = variant === 'nested' ? path.join(pluginDir, 'nested') : pluginDir;
        await fse.mkdirp(pluginDir);
        await fse.mkdirp(widgetDir);

        // A plugin, with some widgets in it.
        await fse.writeFile(
          path.join(pluginDir, 'manifest.yml'),
          `name: My Widgets\n` +
          `components:\n` +
          `  widgets: ${variant === 'nested' ? 'nested/' : ''}widgets.json\n`
        );

        // A list of a pair of custom widgets, with the widget
        // source in the same directory.
        await fse.writeFile(
          path.join(widgetDir, 'widgets.json'),
          JSON.stringify([
            {
              widgetId: 'p1',
              name: 'P1',
              url: './p1.html',
            },
            {
              widgetId: 'p2',
              name: 'P2',
              url: './p2.html',
            },
            {
              widgetId: 'p3',
              name: 'P3',
              url: './p3.html',
              published: false,
            },
          ]),
        );

        // The first widget - just contains the text P1.
        await fse.writeFile(
          path.join(widgetDir, 'p1.html'),
          '<html><body>P1</body></html>',
        );

        // The second widget. This contains the text P2
        // if grist is defined after loading grist-plugin-api.js
        // (but the js bundled with the widget just throws an
        // alert).
        await fse.writeFile(
          path.join(widgetDir, 'p2.html'),
          `
          <html>
          <head><script src="./grist-plugin-api.js"></script></head>
          <body>
          <div id="readout"></div>
          <script>
            if (typeof grist !== 'undefined') {
              document.getElementById('readout').innerText = 'P2';
            }
          </script>
          </body>
          </html>
          `
        );

        // The third widget - just contains the text P3.
        await fse.writeFile(
          path.join(widgetDir, 'p3.html'),
          '<html><body>P3</body></html>',
        );

        // A dummy grist-plugin-api.js - hopefully the actual
        // js for the current version of Grist will be served in
        // its place.
        await fse.writeFile(
          path.join(widgetDir, 'grist-plugin-api.js'),
          'alert("Error: built in api version used");',
        );

        // Restart server and reload doc now plugins are in place.
        process.env.GRIST_USER_ROOT = dir;
        await server.restart();
        await gu.reloadDoc();

        // Continue using one external widget.
        await reloadWidgets();
        await enableWidgetsAndShowPanel();

        // Check we see one external widget and two bundled ones.
        await gu.openCustomWidgetGallery();
        assert.deepEqual(await galleryWidgets(), [
          CUSTOM_URL, 'P1 (My Widgets)', 'P2 (My Widgets)', widget1.name,
        ]);

        // Prepare to check content of widgets.
        async function getWidgetText(): Promise<string> {
          return gu.doInIframe(await getCustomWidgetFrame(), () => {
            return driver.executeScript(
              () => document.body.innerText
            );
          });
        }

        // Check built-in P1 works as expected.
        await gu.setCustomWidget(/P1/, {openGallery: false});
        assert.equal(await gu.getCustomWidgetName(), 'P1 (My Widgets)');
        await gu.waitToPass(async () => {
          assert.equal(await getWidgetText(), 'P1');
        });

        // Check external W1 works as expected.
        await gu.setCustomWidget(/W1/);
        assert.equal(await gu.getCustomWidgetName(), 'W1');
        await gu.waitToPass(async () => {
          assert.equal(await getWidgetText(), 'W1');
        });

        // Check build-in P2 works as expected.
        await gu.setCustomWidget(/P2/);
        assert.equal(await gu.getCustomWidgetName(), 'P2 (My Widgets)');
        await gu.waitToPass(async () => {
          assert.equal(await getWidgetText(), 'P2');
        });

        // Make sure widget setting is sticky.
        await gu.reloadDoc();
        await gu.waitToPass(async () => {
          assert.equal(await getWidgetText(), 'P2');
        });
      });
    }
  });
});
