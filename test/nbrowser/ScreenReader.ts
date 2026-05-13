import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { describe } from "mocha";
import { assert, driver, Key } from "mocha-webdriver";

describe("ScreenReader", function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  before(async function() {
    const session = await gu.session().teamSite.login();
    await session.tempDoc(cleanup, "GridWithAllFields.grist");
    // Make sure the doc is loaded before continuing
    await driver.wait(async () => await gu.getActiveCell(), 5000);
  });

  it("has correct markup on the screen reader announcer children", async function() {
    // It may seem insignificant, but it's actually very important to use `divs` rather than `spans` as the
    // #screen-reader-announcer children.
    // If using spans, Edge announces the whole #screen-reader-announcer content when something is added,
    // even with the `aria-atomic="false"` set.
    // @see https://a11ysupport.io/tests/tech__aria__aria-atomic-spans#support-summary-by-at-sr
    try {
      await driver.findWait("#screen-reader-announcer > div", 1000);
    } catch (e) {
      assert.fail("#screen-reader-announcer children should be `div` elements");
    }
  });

  it("has announced current widget state on load", async function() {
    // Check that the current widget name, current cell content, and current cell position have been announced
    await gu.assertScreenReaderAnnouncement("table1 widget", false);
    // "any" here is the name of the grid first column in the GridWithAllFields.grist doc
    await gu.assertScreenReaderAnnouncement("row 1 any");
    // "any text" here is the content of the first cell in the first column
    await gu.assertScreenReaderAnnouncement("any text");
  });

  it("doesn't announce anything when focusing a panel", async function() {
    // Focus next panel, then make sure the screen reader didn't announce anything new, because
    // we rely on usual SR behavior for panels and don't manually announce things in that case.
    await gu.focusNextSection();
    await gu.waitForFocus("textarea.copypaste.mousetrap", false);
    await gu.assertScreenReaderAnnouncement("row 1 any");
  });

  it("announces notifications", async function() {
    // Pressing the nextSection shortcut multiple times triggers the notification
    // saying something like "Trying to access creator panel?"
    await gu.focusNextSection(5);
    // Notifications are automatically prefixed with "Notification:" for screen readers
    await gu.assertScreenReaderAnnouncement("Notification:");
  });

  it("announces grid cell position when moving with keyboard", async function() {
    await driver.sendKeys(Key.RIGHT);
    // We just moved to the column named "TextBox", still on the first row
    await gu.assertScreenReaderAnnouncement("row 1 TextBox");

    await driver.sendKeys(Key.RIGHT);
    // We just moved to the column named "HyperLink", still on the first row
    await gu.assertScreenReaderAnnouncement("row 1 HyperLink");

    await driver.sendKeys(Key.DOWN);
    // We just moved to the second row, still on the column named "HyperLink"
    await gu.assertScreenReaderAnnouncement("row 2 HyperLink");

    // Move back to the first row, first column
    await driver.sendKeys(Key.PAGE_UP);
    await driver.sendKeys(Key.HOME);
  });

  it("announces formatted cell content depending on column type", async function() {
    await driver.sendKeys(Key.RIGHT);
    await gu.assertScreenReaderAnnouncement("textbox text");

    await driver.sendKeys(Key.RIGHT);
    await gu.assertScreenReaderAnnouncement("link https://example.com");

    // Markdown structure is announced when SR mode is on. Otherwise, markdown string is returned as is.
    await gu.sendKeys(Key.chord(Key.SHIFT, Key.F4));
    await gu.assertScreenReaderAnnouncement("Enabled screen reader improvements");
    await driver.sendKeys(Key.RIGHT);
    await gu.assertScreenReaderAnnouncement("heading my title");
    await gu.assertScreenReaderAnnouncement("my text");
    await gu.assertScreenReaderAnnouncement("list: my list item 1, my list item 2");
    await gu.sendKeys(Key.chord(Key.SHIFT, Key.F4));
    await gu.assertScreenReaderAnnouncement("Disabled screen reader improvements");
    await driver.sendKeys(Key.RIGHT);
    await driver.sendKeys(Key.LEFT);
    await gu.assertScreenReaderAnnouncement("#### my title");
    await gu.assertScreenReaderAnnouncement("my text");
    await gu.assertScreenReaderAnnouncement("- my list item 1");

    await driver.sendKeys(Key.RIGHT);
    await gu.assertScreenReaderAnnouncement("3.1415926536");

    await driver.sendKeys(Key.RIGHT);
    await driver.sendKeys(Key.RIGHT);
    await driver.sendKeys(Key.RIGHT);
    await driver.sendKeys(Key.RIGHT);
    // We are now on the "Toggle TextBox" column
    await gu.assertScreenReaderAnnouncement("Checked");
    await driver.sendKeys(Key.RIGHT);
    await gu.assertScreenReaderAnnouncement("Checked");
    await driver.sendKeys(Key.RIGHT);
    await gu.assertScreenReaderAnnouncement("Toggled on");

    await driver.sendKeys(Key.RIGHT);
    await gu.assertScreenReaderAnnouncement("2026-03-23");

    await driver.sendKeys(Key.RIGHT);
    await gu.assertScreenReaderAnnouncement("2026-03-22 7:00am");

    await driver.sendKeys(Key.RIGHT);
    // We are now on the "Choice" column
    await gu.assertScreenReaderAnnouncement("One");
    await driver.sendKeys(Key.RIGHT);
    await gu.assertScreenReaderAnnouncement("Two, Three");
    await driver.sendKeys(Key.RIGHT);
    await gu.assertScreenReaderAnnouncement("Table1[1]");
    await driver.sendKeys(Key.RIGHT);
    await gu.assertScreenReaderAnnouncement("Table1[1], Table1[2]");

    await driver.sendKeys(Key.RIGHT);
    // We are now on the "Attachments" column, the first row has two attachments, one image and one PDF
    await gu.assertScreenReaderAnnouncement("Image, PDF");

    // Go back to first column
    await driver.sendKeys(Key.HOME);
  });

  it("announces next cell after editing a cell", async function() {
    // Enter the first cell floating editor (in the "Any" column)…
    await gu.sendKeys(Key.ENTER);
    // … go out of it to focus back the grid…
    await gu.sendKeys(Key.ENTER);

    // … Since we pressed Enter, we are now focused on the 2nd row, we should have announced it
    await gu.assertScreenReaderAnnouncement("row 2 Any");

    // Go back to the first row, first column
    await gu.sendKeys(Key.UP);
  });

  it("should toggle the screen reader improvements mode with the keyboard shortcut", async function() {
    await gu.sendKeys(Key.chord(Key.SHIFT, Key.F4));
    await gu.assertScreenReaderAnnouncement("Enabled screen reader improvements");

    await gu.sendKeys(Key.chord(Key.SHIFT, Key.F4));
    await gu.assertScreenReaderAnnouncement("Disabled screen reader improvements");
  });

  it("should stay on the same cell after editing a cell when SR improvements are enabled", async function() {
    // Enable SR improvements
    await gu.sendKeys(Key.chord(Key.SHIFT, Key.F4));

    // Enter the first cell floating editor (in the "Any" column), then directly go out of it
    await gu.sendKeys(Key.ENTER);
    await gu.sendKeys(Key.ENTER);

    // With SR improvements enabled, we should be back on the row we just edited (the first one)
    await gu.assertScreenReaderAnnouncement("row 1 Any");
  });

  it("has cleaned up the announcements DOM on the fly", async function() {
    // After all this navigation, we announced a lot of things, but the announcer should not keep everything in the DOM.
    // This test is strongly tied to the implementation but we can't really test actual SRs behavior,
    // so we have to make assumptions.
    await driver.wait(
      async () => (await driver.findAll("#screen-reader-announcer > div")).length < 11,
      2000,
    );
  });

  afterEach(() => gu.checkForErrors());
});
