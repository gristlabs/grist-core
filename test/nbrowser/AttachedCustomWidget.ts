import {ICustomWidget} from "app/common/CustomWidget";
import {getAppRoot} from "app/server/lib/places";
import {assert, By, driver} from "mocha-webdriver";
import path from "path";
import * as gu from "test/nbrowser/gristUtils";
import {server, setupTestSuite} from "test/nbrowser/testUtils";
import {serveSomething} from "test/server/customUtil";
import {EnvironmentSnapshot} from "test/server/testUtils";

describe('AttachedCustomWidget', function () {
  this.timeout(20000);
  const cleanup = setupTestSuite();
  let oldEnv: EnvironmentSnapshot;
  // Valid manifest url.
  const manifestEndpoint = '/manifest.json';
  // Valid widget url.
  const widgetEndpoint = '/widget';
  // Create some widgets:
  const widget1: ICustomWidget = {
    widgetId: '@gristlabs/widget-calendar',
    name: 'Calendar',
    url: widgetEndpoint + '?name=Calendar',
  };
  let widgetServerUrl = '';
  // Holds widgets manifest content.
  let widgets: ICustomWidget[] = [];
  // Switches widget manifest url
  async function useManifest(url: string) {
    await server.testingHooks.setWidgetRepositoryUrl(url ? `${widgetServerUrl}${url}` : '');
    await driver.executeAsyncScript(
      (done: any) => (window as any).gristApp?.topAppModel.testReloadWidgets().then(done).catch(done) || done()
    );
  }

  async function buildWidgetServer(){
    // Create simple widget server that serves manifest.json file, some widgets and some error pages.
    const widgetServer = await serveSomething(app => {
      app.get(widgetEndpoint, (req, res) =>
        res
          .header('Content-Type', 'text/html')
          .send('<html><head><script src="/grist-plugin-api.js"></script></head><body>\n' +
            (req.query.name || req.query.access) + // send back widget name from query string or access level
            '</body>' +
            "<script>grist.ready({requiredAccess: 'full', columns: [{name: 'Content', type: 'Text', optional: true}]," +
            " onEditOptions(){}})</script>" +
            '</html>\n')
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

    widgets = [widget1];
  }

  before(async function () {
    await buildWidgetServer();
    oldEnv = new EnvironmentSnapshot();
    process.env.PERMITTED_CUSTOM_WIDGETS = "calendar";
    await server.restart();
    await useManifest(manifestEndpoint);
    const session = await gu.session().login();
    await session.tempDoc(cleanup, 'Hello.grist');

  });

  after(async function () {
    oldEnv.restore();
    await server.restart();
  });

  it('should be able to attach Calendar Widget', async () => {
    await gu.openAddWidgetToPage();
    const calendarElement = await driver.findContent('.test-wselect-type', /Calendar/);
    assert.exists(calendarElement, 'Calendar widget is not found in the list of widgets');
  });

  it('should not ask for permission', async () => {
    await gu.addNewSection(/Calendar/, /Table1/, {selectBy: /TABLE1/});
    await gu.getSection('TABLE1 Calendar').click();
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-right-tab-pagewidget').click();

    await gu.waitForServer();

    // Check if widget config panel is here
    await driver.findWait('.test-config-container', 2000);

    const widgetOptions = await driver.findWait('.test-config-widget-open-configuration', 2000);
    const widgetMapping = await driver.find('.test-config-widget-mapping-for-Content');
    const widgetSelection = await driver.findElements(By.css('.test-config-widget-select'));
    const widgetPermission = await driver.findElements(By.css('.test-wselect-permission'));

    assert.isEmpty(widgetSelection, 'Widget selection is not expected to be present');
    assert.isEmpty(widgetPermission, 'Widget permission is not expected to be present');
    assert.exists(widgetOptions, 'Widget options is expected to be present');
    assert.exists(widgetMapping, 'Widget mapping is expected to be present');
  });

  it('should display the content of the widget', async () => {
    await gu.getSection('TABLE1 Calendar').click();
    try {
      await driver.switchTo().frame(await driver.findWait('.custom_view', 1000));
      const editor = await driver.findContentWait('body', "Calendar", 1000);
      assert.exists(editor);
    } finally {
      await driver.switchTo().defaultContent();
    }
  });
});
