/**
 * Testing printing using selenium webdriver is tricky.
 *
 * 1. The `--kiosk-printing` option may be set on chromedriver to cause printing to go to a pdf
 *    without a confirmation. But it doesn't work in headless mode.
 *
 * 2. As long as we use `setTimeout(() => window.print(), 0)` instead of plain `window.print()`,
 *    it is possible to interact with the print dialog in chrome (although next steps are
 *    unclear), e.g.:
 *    ```
 *    const windowHandles = await driver.getAllWindowHandles();
 *    await driver.switchTo().window(windowHandles[1]);
 *    driver.sendKeys(Key.ENTER);
 *    ```
 *    This, however, doesn't work in headless either.
 *
 * 3. There is a command `Emulation.setEmulatedMedia`, can do the equivalent of dev console's
 *    simulation of `@media print`. That's what we use here. We don't get to see anything about
 *    pagination, but we can at least check whether various elements are visible for printing.
 */
import { serveCustomViews, Serving } from "test/nbrowser/customUtil";
import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver } from "mocha-webdriver";

function emulateMediaPrint(print: boolean) {
  return (driver as any).sendDevToolsCommand("Emulation.setEmulatedMedia", { media: print ? "print" : "screen" });
}

async function checkPrintSection(sectionName: string, checkFunc: () => Promise<void>) {
  const numTabs = (await driver.getAllWindowHandles()).length;
  await driver.executeScript("window.debugPrinting = 1");
  await gu.openSectionMenu("viewLayout", sectionName);
  await driver.findWait(".test-print-section", 500).click();
  await driver.sleep(100);    // Just to be sure we don't continue before setTimeout(0), used in printing.
  try {
    await emulateMediaPrint(true);
    await checkFunc();
  } finally {
    // Ensure the dialog's window (if it ever opened, only non-headless) is gone.
    await gu.waitToPass(async () => assert.lengthOf(await driver.getAllWindowHandles(), numTabs), 5000);

    // Ensure that `afterprint` callback gets triggered, needed for mac.
    await gu.waitToPass(() => driver.executeScript("window.afterPrintCallback?.()"));

    await emulateMediaPrint(false);
    await gu.waitToPass(() => driver.executeScript("window.finishPrinting()"));
    await driver.executeScript("window.debugPrinting = 0");
  }
}

describe("Printing", function() {
  this.timeout(30000);
  const cleanup = setupTestSuite();
  let serving: Serving;
  let mainSession: gu.Session;
  let docId: string;

  before(async function() {
    serving = await serveCustomViews();
    mainSession = await gu.session().login();
    docId = (await mainSession.tempDoc(cleanup, "Countries-Print.grist", { load: false })).id;
  });

  after(async function() {
    await serving?.shutdown();
  });

  let originalTab: string;
  let newTab: string;

  beforeEach(async function() {
    // Open a new tab for each test case, to work around what seems to be a bug: in headless
    // chrome, window.print() works the first time in a tab, but not again.
    originalTab = await driver.getWindowHandle();
    await driver.executeScript("window.open('about:blank', '_blank')");
    const tabs = await driver.getAllWindowHandles();
    newTab = tabs[tabs.length - 1];
    await driver.switchTo().window(newTab);

    // Load the doc in the new tab.
    await mainSession.loadDoc(`/doc/${docId}`);
  });

  gu.afterEachCleanup(async function() {
    const newCurrentTab = await driver.getWindowHandle();
    assert.equal(newCurrentTab, newTab);
    await driver.close();
    await driver.switchTo().window(originalTab);
  });

  it("should include all rows when printing tables", async function() {
    await checkPrintSection("COUNTRIES", async () => {
      // All rows (near the beginning and far) are displayed.
      assert.isTrue(await driver.findContent(".print-all-rows .field_clip", /Bulgaria/).isDisplayed());
      assert.isTrue(await driver.findContent(".print-all-rows .field_clip", /Polska/).isDisplayed());
      assert.isTrue(await driver.findContent(".print-all-rows .field_clip", /Vanuatu/).isDisplayed());
      assert.isTrue(await driver.find(".print-row:last-child").isDisplayed());

      // Check the text in last row to be sure what's included.
      assert.match(await driver.find(".print-row:last-child").getText(), /Zimbabwe.*Eastern Africa/s);
    });
  });

  it("should include all rows when printing card list", async function() {
    await gu.getPageItem("Cards and Chart").click();
    await checkPrintSection("COUNTRIES Card List", async () => {
      // Only the selected cards are displayed.
      assert.isTrue(await driver.findContent(".print-all-rows .field_clip", /Aruba/).isDisplayed());
      assert.isTrue(await driver.findContent(".print-all-rows .field_clip", /Grenadines/).isDisplayed());
      assert.isTrue(await driver.findContent(".print-all-rows .field_clip", /North America/).isDisplayed());
      assert.isTrue(await driver.find(".print-row:last-child").isDisplayed());
      // Other countries are not displayed.
      assert.isFalse(await driver.findContent(".print-widget .field_clip", /Aremenia/).isPresent());
      assert.isFalse(await driver.findContent(".print-widget .field_clip", /Africa/).isPresent());
      assert.isFalse(await driver.findContent(".print-widget .field_clip", /Albania/).isPresent());
      // Check some text to see what's included.
      assert.match(await driver.find(".print-row:first-child").getText(), /Aruba.*Caribbean/s);
      assert.match(await driver.find(".print-row:last-child").getText(), /Virgin Islands.*Caribbean/s);
    });
  });

  it("should display charts when printing", async function() {
    await gu.getPageItem("Cards and Chart").click();
    await checkPrintSection("COUNTRIES [By Continent] Chart", async () => {
      await gu.waitToPass(async () => {
        // Expect to see all Continents listed, by population, excluding the filtered-out Antarctica.
        assert.deepEqual(await driver.findAll(".print-widget .legendtext", el => el.getText()),
          ["Africa", "Asia", "Europe", "North America", "Oceania", "South America"]);
      }, 5000);
    });
  });

  it("should not display link icon when printing", async function() {
    await gu.getPageItem("Countries").click();
    await gu.getCell(0, 1).click();
    await gu.enterCell("http://getgrist.com");
    await gu.waitForServer();

    const checkLinkIsDisplayed = async (expected: boolean) => {
      assert.equal(await driver.findContent("span", "http://getgrist.com").isPresent(), true);
      assert.equal(await driver.find('a[href*="http://getgrist.com"]').isDisplayed(), expected);
    };

    await checkLinkIsDisplayed(true);

    await checkPrintSection("COUNTRIES", async () => {
      await gu.waitToPass(async () => {
        await checkLinkIsDisplayed(false);
      }, 5000);
    });
  });

  it("should render markdown cells when printing", async function() {
    await gu.getPageItem("Countries").click();
    await gu.openColumnPanel("Name");
    await gu.setFieldWidgetType("Markdown");
    await gu.getCell({ rowNum: 1, col: "Name" }).click();
    await gu.enterCell("[Aruba](https://getgrist.com/#aruba)");

    const link = driver.findContentWait(".test-text-link", "Aruba", 1000);
    assert.equal(await link.isDisplayed(), true);
    // There is also the link itself, shown as an icon just before the text.
    assert.equal(await link.find("a").getAttribute("href"), "https://getgrist.com/#aruba");
    assert.equal(await link.find("a").isDisplayed(), true);

    await checkPrintSection("COUNTRIES", async () => {
      const link = driver.findContent(".print-all-rows .test-text-link", "Aruba");
      assert.equal(await link.isDisplayed(), true);
      // In print view, the link icon is hidden.
      assert.equal(await link.find("a").isDisplayed(), false);
    });
  });

  // NOTE: the test doc includes a custom section (`${serving.url}/readout` would do), but the
  // media-print emulation doesn't help to test it, since custom sections are printed by
  // triggering window.print() within the widget, with no other style manipulation to test.
});
