import { AccessLevel } from "app/common/CustomWidget";
import { serveCustomViews, Serving } from "test/nbrowser/customUtil";
import * as gu from "test/nbrowser/gristUtils";
import { server, setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver } from "mocha-webdriver";

/**
 * Tests that a custom widget receives linking state (asTarget, asSource) via
 * the InteractionOptions.linking field of the ready/onOptions message.
 *
 * Uses the config fixture at test/fixtures/sites/config/, which renders the
 * second argument of grist.onOptions into the #onOptionsSettings DOM element
 * as JSON. The test reads that element inside the iframe.
 */
describe("CustomWidgetLinking", function() {
  this.timeout("30s");

  const cleanup = setupTestSuite();
  let serving: Serving;
  let session: gu.Session;

  before(async function() {
    if (server.isExternalServer()) {
      this.skip();
    }
    serving = await serveCustomViews();
    session = await gu.session().teamSite.login();
    await session.tempNewDoc(cleanup);
  });

  after(async function() {
    if (serving && !gu.noCleanup) {
      await serving.shutdown();
    }
  });

  afterEach(() => gu.checkForErrors());

  async function readWidgetSettings(): Promise<any> {
    const iframe = await driver.findWait(".active_section iframe", 4000);
    await driver.switchTo().frame(iframe);
    try {
      const text = await driver.find("#onOptionsSettings").getText();
      return text ? JSON.parse(text) : undefined;
    } finally {
      await driver.switchTo().defaultContent();
    }
  }

  it("reports asTarget=Cursor:Same-Table when linked by a same-table source", async function() {
    // Page with TABLE1 grid.
    await gu.addNewTable("Data");
    await gu.sendActions([
      ["AddRecord", "Data", null, { A: "one" }],
      ["AddRecord", "Data", null, { A: "two" }],
    ]);

    // Add a custom widget on the same table. addNewSection leaves the widget gallery open
    // when no customWidget is specified, so setCustomWidgetUrl can run with openGallery: false.
    await gu.openWidgetPanel("widget");
    await gu.addNewSection("Custom", "Data");
    await gu.setCustomWidgetUrl(`${serving.url}/config`, { openGallery: false });
    await gu.widgetAccess(AccessLevel.read_table);

    // Link the custom widget to the grid so the widget becomes a target.
    await gu.selectBy("DATA");

    await gu.waitToPass(async () => {
      const settings = await readWidgetSettings();
      assert.isObject(settings, "widget should receive a settings object");
      assert.deepEqual(settings.linking, { asTarget: "Cursor:Same-Table", asSource: false });
    }, 100);
  });
});
