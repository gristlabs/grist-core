import { AccessLevel } from "app/common/CustomWidget";
import { serveCustomViews, Serving } from "test/nbrowser/customUtil";
import * as gu from "test/nbrowser/gristUtils";
import { server, setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver } from "mocha-webdriver";
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
    await serving.shutdown();
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
    await gu.addNewTable("Data");
    await gu.sendActions([
      ["AddRecord", "Data", null, { A: "one" }],
      ["AddRecord", "Data", null, { A: "two" }],
    ]);

    // Add a custom widget on the same table.
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
    }, 2000);
  });

  it("always includes linking in settings even without a link", async function() {
    // Close any open panel/menu from the previous test.
    await gu.toggleSidePanel("right", "close");
    // Create a standalone custom widget with no selectBy — no link at all.
    await gu.addNewPage("Custom", "Data", { customWidget: /Custom URL/ });
    await gu.setCustomWidgetUrl(`${serving.url}/config`);
    await gu.widgetAccess(AccessLevel.read_table);

    await gu.waitToPass(async () => {
      const settings = await readWidgetSettings();
      assert.isObject(settings, "widget should receive a settings object");
      // linking must always be present (not undefined) so widgets that are aware of the linking
      // can be run on grist that doesn't support it yet. So undefined means "linking not supported".
      assert.deepEqual(settings.linking, { asTarget: null, asSource: false });
    }, 2000);
  });

  it("reports asSource=true when another section is linked by this widget", async function() {
    // New page: custom widget as source, grid linked by it.
    await gu.addNewPage("Custom", "Data", { customWidget: /Custom URL/ });
    await gu.setCustomWidgetUrl(`${serving.url}/config`);
    await gu.widgetAccess(AccessLevel.read_table);
    // Tell Grist this widget can be used as a linking source.
    await gu.customCode(grist => grist.sectionApi.configure({ allowSelectBy: true }));
    // Add a grid linked by the custom widget.
    await gu.addNewSection("Table", "Data", { selectBy: /DATA custom/i });
    // Switch back to the custom widget to read its settings.
    await gu.selectSectionByTitle("DATA custom");

    await gu.waitToPass(async () => {
      const settings = await readWidgetSettings();
      assert.deepEqual(settings.linking, { asTarget: null, asSource: true });
    }, 2000);

    // Remove the link from the grid so the widget is no longer a source.
    await gu.selectSectionByTitle("DATA");
    await gu.selectBy(/Select widget/);
    await gu.selectSectionByTitle("DATA custom");

    await gu.waitToPass(async () => {
      const settings = await readWidgetSettings();
      assert.deepEqual(settings.linking, { asTarget: null, asSource: false });
    }, 2000);
  });

  it("updates linking reactively when selectBy changes", async function() {
    // New page: grid + custom widget on the same table, linked by the grid.
    await gu.addNewPage("Table", "Data");
    await gu.addNewSection("Custom", "Data", { selectBy: "DATA", customWidget: /Custom URL/ });
    await gu.setCustomWidgetUrl(`${serving.url}/config`);
    await gu.widgetAccess(AccessLevel.read_table);

    // Verify initial linked state.
    await gu.waitToPass(async () => {
      const settings = await readWidgetSettings();
      assert.deepEqual(settings.linking, { asTarget: "Cursor:Same-Table", asSource: false });
    }, 2000);

    // Remove the link.
    await gu.selectBy(/Select widget/);

    // Widget should now report no incoming link.
    await gu.waitToPass(async () => {
      const settings = await readWidgetSettings();
      assert.deepEqual(settings.linking, { asTarget: null, asSource: false });
    }, 2000);

    // Re-add the link.
    await gu.selectBy("DATA");

    // Widget should now report the link again.
    await gu.waitToPass(async () => {
      const settings = await readWidgetSettings();
      assert.deepEqual(settings.linking, { asTarget: "Cursor:Same-Table", asSource: false });
    }, 2000);
  });
});
