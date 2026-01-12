import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver } from "mocha-webdriver";

describe("CustomWidgets", function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  before(async function() {
    const session = await gu.session().teamSite.login();
    await session.tempNewDoc(cleanup);
  });

  it("uses the Grist Labs widget repository by default", async function() {
    await gu.addNewSection("Custom", "Table1");
    const widgetNames = new Set(await driver.findAll(".test-custom-widget-gallery-widget-name", e => e.getText()))

    assert.isTrue(widgetNames.has("Custom URL"));
    assert.isTrue(widgetNames.has("Calendar"));
    assert.isTrue(widgetNames.has("Notepad"));
    assert.isTrue(widgetNames.has("Purchase orders"));
  });
});
