import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, By, driver, Key } from "mocha-webdriver";

/**
 * Behavioral tests for the native CalendarView (the in-app replacement for the bundled calendar
 * custom widget). Ported from gristlabs/grist-widget's test/calendar.ts, adapted for native
 * rendering: there is no iframe, so we reach the live CalendarView instance through the existing
 * `window.gristDocPageModel` handle and read its state, and assert against the calendar's own DOM.
 */
describe("CalendarView", function() {
  this.timeout(30000);
  const cleanup = setupTestSuite();

  // Seconds-since-epoch for a date, as Grist stores Date/DateTime values.
  const sec = (d: Date) => Math.floor(d.getTime() / 1000);

  // Anchor every fixture event off "today" so events stay in the visible week regardless of when
  // the test runs (rather than the previous mix of 2023-anchored events and "today"-relative
  // navigation, which made it easy for a future change to break depending on the date).
  const baseDay = new Date();
  baseDay.setHours(0, 0, 0, 0);
  const atHour = (h: number) => { const d = new Date(baseDay); d.setHours(h, 0, 0, 0); return d; };

  before(async function() {
    const session = await gu.session().login();
    await session.tempDoc(cleanup, "Calendar.grist");
    await gu.addNewSection(/Calendar/, /Table1/, { selectBy: /TABLE1/ });
    await gu.openWidgetPanel();
    await setMapping("startDate", /From/);
    await setMapping("endDate", /To/);
    await setMapping("title", /Label/);
    await setMapping("isAllDay", /IsFullDay/);
  });

  it("renders natively, without an iframe", async function() {
    await driver.findWait(".test-calendar-container", 2000);
    await driver.findWait(".test-calendar-widget", 2000);
    assert.isEmpty(await driver.findElements(By.css("iframe.custom_view")));
    // The mapping config is shown in the creator panel (no iframe permission prompts).
    assert.exists(await driver.find(".test-config-widget-mapping-for-startDate"));
    assert.isEmpty(await driver.findElements(By.css(".test-wselect-permission")));
  });

  it("creates an event when a row is added", async function() {
    await gu.sendActions([
      ["AddRecord", "Table1", -1, {
        From: sec(atHour(13)), To: sec(atHour(14)),
        Label: "New Event", IsFullDay: false,
      }],
    ]);
    // Wait for the calendar to re-read the table, then check the mapped event.
    await driver.wait(async () => Boolean(await getCalendarEvent(1)), 2000);
    assert.deepEqual(await getCalendarEvent(1), {
      title: "New Event",
      startMs: atHour(13).getTime(),
      endMs: atHour(14).getTime(),
      isAllDay: false,
    });
  });

  it("creates an all-day event when a row is added", async function() {
    await gu.sendActions([
      ["AddRecord", "Table1", -1, {
        From: sec(atHour(13)), To: sec(atHour(14)),
        Label: "All Day Event", IsFullDay: true,
      }],
    ]);
    await driver.wait(async () => Boolean(await getCalendarEvent(2)), 2000);
    const event = await getCalendarEvent(2);
    assert.equal(event?.title, "All Day Event");
    assert.equal(event?.isAllDay, true);
  });

  it("updates an event when the row changes", async function() {
    const expectedEnd = atHour(15).getTime();
    await gu.sendActions([["UpdateRecord", "Table1", 1, { To: sec(atHour(15)) }]]);
    await driver.wait(async () => (await getCalendarEvent(1))?.endMs === expectedEnd, 2000);
    assert.deepEqual(await getCalendarEvent(1), {
      title: "New Event",
      startMs: atHour(13).getTime(),
      endMs: expectedEnd,
      isAllDay: false,
    });
  });

  it("removes an event when the row is deleted", async function() {
    await gu.sendActions([["RemoveRecord", "Table1", 1]]);
    await driver.wait(async () => (await getCalendarEvent(1)) === null, 2000);
  });

  it("changes perspective when a toolbar button is pressed", async function() {
    await driver.find(".test-calendar-perspective-day").click();
    assert.equal(await getViewName(), "day");
    await driver.find(".test-calendar-perspective-month").click();
    assert.equal(await getViewName(), "month");
    await driver.find(".test-calendar-perspective-week").click();
    assert.equal(await getViewName(), "week");
  });

  it("navigates to the previous/next/current period", async function() {
    const today = new Date();
    const validateDate = async (daysToAdd: number) => {
      const expected = new Date(today);
      expected.setDate(today.getDate() + daysToAdd);
      assert.equal(await getCalendarDate(), expected.toDateString());
    };

    await driver.find(".test-calendar-prev").click();
    await validateDate(-7);
    await driver.find(".test-calendar-today").click();
    await validateDate(0);
    await driver.find(".test-calendar-next").click();
    await validateDate(7);
  });

  it("shows the right title for each view (month / week / day)", async function() {
    const monthName = (d: Date) => d.toLocaleString(undefined, { month: "long", year: "numeric" });
    const shiftMonth = (d: Date, months: number) => {
      const out = new Date(d);
      out.setDate(1);
      out.setMonth(d.getMonth() + months);
      return out;
    };
    const now = new Date();

    // Month view: month + year.
    await driver.find(".test-calendar-perspective-month").click();
    await driver.find(".test-calendar-today").click();
    assert.equal(await getCalendarTitle(), monthName(now));

    await driver.find(".test-calendar-prev").click();
    assert.equal(await getCalendarTitle(), monthName(shiftMonth(now, -1)));

    await driver.find(".test-calendar-today").click();
    await driver.find(".test-calendar-next").click();
    assert.equal(await getCalendarTitle(), monthName(shiftMonth(now, 1)));

    // Day view: a full date including weekday + day + month + year.
    await driver.find(".test-calendar-perspective-day").click();
    await driver.find(".test-calendar-today").click();
    const dayTitle = await getCalendarTitle();
    const today = new Date();
    assert.include(dayTitle, String(today.getDate()));
    assert.include(dayTitle, String(today.getFullYear()));

    // Week view: a date range with an en-dash.
    await driver.find(".test-calendar-perspective-week").click();
    await driver.find(".test-calendar-today").click();
    assert.match(await getCalendarTitle(), /–/);
  });

  it("selects the calendar event for the linked grid row", async function() {
    // Create two events today (visible in the default week view).
    await gu.sendActions([
      ["AddRecord", "Table1", -1, { From: sec(atHour(10)), To: sec(atHour(11)),
        Label: "Linked A", IsFullDay: false }],
      ["AddRecord", "Table1", -1, { From: sec(atHour(13)), To: sec(atHour(14)),
        Label: "Linked B", IsFullDay: false }],
    ]);

    // Clicking a grid cell moves the grid cursor; the linked calendar should select the match.
    await driver.findContentWait(".field_clip", /Linked A/, 2000).click();
    await driver.wait(async () => (await getSelectedEventTitle()) === "Linked A", 2000);

    await driver.findContentWait(".field_clip", /Linked B/, 2000).click();
    await driver.wait(async () => (await getSelectedEventTitle()) === "Linked B", 2000);
  });

  it("moves an event (and writes it back) when dragged", async function() {
    // Use day view on an otherwise-empty day: the event is a full-width block, so the drag lands
    // reliably (in week view, with many events, the hit-testing and scroll position are flaky).
    const day = await gotoCleanDay(3);
    await gu.sendActions([
      ["AddRecord", "Table1", -1, { From: dayAt(day, 9), To: dayAt(day, 10), Label: "DragMe", IsFullDay: false }],
    ]);

    // findContentWait for the rendered event also waits for the calendar to catch up.
    const el = await driver.findContentWait("[data-event-id]", /DragMe/, 2000);
    await driver.executeScript("arguments[0].scrollIntoView({block: 'center'})", el);
    const before = await getEventByTitle("DragMe");
    assert.isNotNull(before);
    // Drag the event body downward. Jiggle first so TUI registers the drag start.
    await driver.withActions(a => a
      .move({ origin: el })
      .press()
      .move({ origin: el, x: 0, y: 6 })
      .pause(120)
      .move({ origin: el, x: 0, y: 100 })
      .pause(120)
      .release());
    await gu.waitForServer();

    // The drag moved the event to a later time (write path: TUI drag -> UpdateRecord).
    await driver.wait(async () => {
      const after = await getEventByTitle("DragMe");
      return Boolean(after && after.startMs! > before!.startMs!);
    }, 2000);
    const after = await getEventByTitle("DragMe");
    // ...preserving its duration (a move, not a resize).
    assert.equal(after!.endMs! - after!.startMs!, before!.endMs! - before!.startMs!);
  });

  it("opens the Record Card on double-click of an event", async function() {
    const day = await gotoCleanDay(5);
    await gu.sendActions([
      ["AddRecord", "Table1", -1, { From: dayAt(day, 9), To: dayAt(day, 11), Label: "CardMe", IsFullDay: false }],
    ]);
    const el = await driver.findContentWait("[data-event-id]", /CardMe/, 2000);
    await driver.executeScript("arguments[0].scrollIntoView({block: 'center'})", el);
    await driver.withActions(a => a.doubleClick(el));
    assert.isTrue(await driver.findWait(".test-record-card-popup-overlay", 2000).isDisplayed());
    assert.isTrue(await driver.findContent(".g_record_detail_value", /CardMe/).isPresent());
    await driver.sendKeys(Key.ESCAPE);
    assert.isFalse(await driver.find(".test-record-card-popup-overlay").isPresent());
  });

  // --------------------------------------------------------------------------
  // Helpers

  async function setMapping(name: string, value: RegExp) {
    await driver.findWait(`.test-config-widget-mapping-for-${name}`, 2000);
    await gu.waitToPass(async () => {
      await driver.find(`.test-config-widget-mapping-for-${name} .test-select-open`).click();
      await driver.findWait(".grist-floating-menu", 500);
      await driver.findContentWait(".test-select-menu li", value, 500).click();
    });
    await gu.waitForServer();
  }

  // Live CalendarView exposes a narrow window.gristCalendarView test hook (see
  // app/client/components/CalendarView.ts._testHook). We go through it rather than walking into
  // private fields, so renames inside the view don't ripple into the test.
  interface CalEvent { title: string; startMs: number | null; endMs: number | null; isAllDay: boolean; }
  const getCalendarEvent = (rowId: number) =>
    driver.executeScript<CalEvent | null>(
      "return window.gristCalendarView.getEventByRowId(arguments[0])", rowId);
  const getEventByTitle = (title: string) =>
    driver.executeScript<CalEvent | null>(
      "return window.gristCalendarView.getEventByTitle(arguments[0])", title);

  // Title of the currently-selected event (the row the calendar is tracking), or null.
  async function getSelectedEventTitle(): Promise<string | null> {
    const rowId = await driver.executeScript<number | null>(
      "return window.gristCalendarView.getSelectedRecordId()");
    if (rowId == null) { return null; }
    const ev = await getCalendarEvent(rowId);
    return ev?.title ?? null;
  }

  // Switches to day view and navigates `daysAhead` days forward (to a day with no other events,
  // since all fixture events are today or in 2023). Returns that day at local midnight.
  async function gotoCleanDay(daysAhead: number): Promise<Date> {
    await driver.find(".test-calendar-perspective-day").click();
    await driver.find(".test-calendar-today").click();
    for (let i = 0; i < daysAhead; i++) { await driver.find(".test-calendar-next").click(); }
    const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() + daysAhead);
    return day;
  }

  const dayAt = (day: Date, hour: number) =>
    sec(new Date(day.getTime() + hour * 3600_000));

  async function getViewName(): Promise<string> {
    return driver.executeScript("return window.gristCalendarView.getViewName()");
  }

  async function getCalendarDate(): Promise<string> {
    return driver.executeScript("return window.gristCalendarView.getCalendarDate()");
  }

  async function getCalendarTitle(): Promise<string> {
    return driver.find(".test-calendar-title").getText();
  }
});
