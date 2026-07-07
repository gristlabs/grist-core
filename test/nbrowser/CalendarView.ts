import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver } from "mocha-webdriver";

describe("CalendarView", function() {
  this.timeout(30000);
  const cleanup = setupTestSuite();

  before(async function() {
    const session = await gu.session().teamSite.login();
    await session.tempNewDoc(cleanup, "CalendarView");
  });

  afterEach(() => gu.checkForErrors());

  it("shows events in the right month-grid cell", async function() {
    // Anchor events to the current month so they land in the visible grid (the view shows the month
    // containing today). Use a text column (title) and a date column (start), which are auto-mapped.
    const d1 = onDay(10), d2 = onDay(12);
    await gu.sendActions([
      ["AddTable", "Events", [
        { id: "When", type: "Date" },
        { id: "Name", type: "Text" },
      ]],
      ["AddRecord", "Events", null, { When: d1.sec, Name: "Alpha" }],
      ["AddRecord", "Events", null, { When: d2.sec, Name: "Beta" }],
    ]);
    await gu.openPage("Events");
    await gu.addNewSection(/Calendar/, "Events");

    // A 6x7 month grid is rendered.
    await driver.findWait(".test-calendar-month", 2000);
    await driver.wait(async () => (await driver.findAll(".test-calendar-day")).length === 42, 2000);

    // All 7 weekday labels render, and none is clipped outside the section: the last one (rightmost
    // column) must stay within the header's right edge. This guards the minmax(0, 1fr) grid fix,
    // where a plain 1fr let the columns overflow and pushed the last day off-screen.
    const weekdays = await driver.findAll(".test-calendar-weekday");
    assert.lengthOf(weekdays, 7);
    const header = await driver.find(".test-calendar-weekdays");
    const headerRight = (await header.rect()).x + (await header.rect()).width;
    const lastCol = weekdays[6];
    const lastRect = await lastCol.rect();
    assert.isAbove(lastRect.width, 0, "last weekday column has width");
    assert.isAtMost(lastRect.x + lastRect.width, headerRight + 1, "last weekday fits inside the header");

    // Both events show up, and each sits in the cell for its own day.
    await driver.wait(async () => (await eventTexts()).length === 2, 2000);
    assert.deepEqual(await cellEventsForDay(d1.dom), ["Alpha"]);
    assert.deepEqual(await cellEventsForDay(d2.dom), ["Beta"]);

    // Adding a row adds an event to its day's cell.
    const d3 = onDay(15);
    await gu.sendActions([
      ["AddRecord", "Events", null, { When: d3.sec, Name: "Gamma" }],
    ]);
    await driver.wait(async () => (await cellEventsForDay(d3.dom)).includes("Gamma"), 2000);
  });
});

// A day in the current month: its Grist Date value (UTC-midnight seconds) and the day-of-month that
// the grid cell shows (the cell's date number is read in the browser's local time).
function onDay(dayOfMonth: number): { sec: number, dom: number } {
  const now = new Date();
  const utc = Date.UTC(now.getFullYear(), now.getMonth(), dayOfMonth);
  return { sec: utc / 1000, dom: dayOfMonth };
}

async function eventTexts(): Promise<string[]> {
  const els = await driver.findAll(".test-calendar-event");
  return Promise.all(els.map(el => el.getText()));
}

// Event titles inside the current-month cell whose day-number matches `dayOfMonth`.
async function cellEventsForDay(dayOfMonth: number): Promise<string[]> {
  const cells = await driver.findAll(".test-calendar-day");
  for (const cell of cells) {
    // Skip other-month cells (they can repeat the same day number).
    if ((await cell.getAttribute("class")).includes("-other-month")) { continue; }
    const num = (await cell.find(".test-calendar-day > div").getText()).trim();
    if (num === String(dayOfMonth)) {
      const evs = await cell.findAll(".test-calendar-event");
      return Promise.all(evs.map(e => e.getText()));
    }
  }
  return [];
}
