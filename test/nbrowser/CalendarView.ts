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

  it("lists rows with a date and title as events", async function() {
    // A table with a date column (auto-mapped as start) and a text column (auto-mapped as title).
    await gu.sendActions([
      ["AddTable", "Events", [
        { id: "When", type: "Date" },
        { id: "Name", type: "Text" },
      ]],
      ["AddRecord", "Events", null, { When: dateSec("2023-08-09"), Name: "Alpha" }],
      ["AddRecord", "Events", null, { When: dateSec("2023-08-10"), Name: "Beta" }],
    ]);
    await gu.openPage("Events");
    await gu.addNewSection(/Calendar/, "Events");

    // Both rows show up in the calendar's event list, most-recently-added order aside.
    await driver.findWait(".test-calendar-event-list", 2000);
    await driver.wait(async () => (await eventTexts()).length === 2, 2000);
    const texts = await eventTexts();
    assert.isTrue(texts.some(x => /Alpha/.test(x)), `expected an Alpha event, got: ${texts.join(" | ")}`);
    assert.isTrue(texts.some(x => /Beta/.test(x)), `expected a Beta event, got: ${texts.join(" | ")}`);

    // Adding a row adds an event.
    await gu.sendActions([
      ["AddRecord", "Events", null, { When: dateSec("2023-08-11"), Name: "Gamma" }],
    ]);
    await driver.wait(async () => (await eventTexts()).some(x => /Gamma/.test(x)), 2000);
  });
});

// Seconds-since-epoch (UTC midnight) for a YYYY-MM-DD, as Grist stores Date values.
function dateSec(yyyymmdd: string): number {
  return Date.parse(yyyymmdd + "T00:00:00Z") / 1000;
}

async function eventTexts(): Promise<string[]> {
  const els = await driver.findAll(".test-calendar-event");
  return Promise.all(els.map(el => el.getText()));
}
