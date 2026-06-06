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

  // Seconds-since-epoch for a date string, as Grist stores Date/DateTime values.
  const sec = (s: string) => Math.floor(new Date(s).getTime() / 1000);

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
        From: sec("2023-08-03 13:00"), To: sec("2023-08-03 14:00"),
        Label: "New Event", IsFullDay: false,
      }],
    ]);
    // Wait for the calendar to re-read the table, then check the mapped event.
    await driver.wait(async () => Boolean(await getCalendarEvent(1)), 2000);
    assert.deepEqual(await getCalendarEvent(1), {
      title: "New Event",
      startMs: new Date("2023-08-03 13:00").getTime(),
      endMs: new Date("2023-08-03 14:00").getTime(),
      isAllDay: false,
    });
  });

  it("creates an all-day event when a row is added", async function() {
    await gu.sendActions([
      ["AddRecord", "Table1", -1, {
        From: sec("2023-08-04 13:00"), To: sec("2023-08-04 14:00"),
        Label: "All Day Event", IsFullDay: true,
      }],
    ]);
    await driver.wait(async () => Boolean(await getCalendarEvent(2)), 2000);
    const event = await getCalendarEvent(2);
    assert.equal(event?.title, "All Day Event");
    assert.equal(event?.isAllDay, true);
  });

  it("updates an event when the row changes", async function() {
    const expectedEnd = new Date("2023-08-03 15:00").getTime();
    await gu.sendActions([["UpdateRecord", "Table1", 1, { To: sec("2023-08-03 15:00") }]]);
    await driver.wait(async () => (await getCalendarEvent(1))?.endMs === expectedEnd, 2000);
    assert.deepEqual(await getCalendarEvent(1), {
      title: "New Event",
      startMs: new Date("2023-08-03 13:00").getTime(),
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

  it("shows the correct month name when navigating months", async function() {
    const monthName = (d: Date) => d.toLocaleString(undefined, { month: "long", year: "numeric" });
    const shiftMonth = (d: Date, months: number) => {
      const out = new Date(d);
      out.setDate(1);
      out.setMonth(d.getMonth() + months);
      return out;
    };
    const now = new Date();

    await driver.find(".test-calendar-perspective-month").click();
    await driver.find(".test-calendar-today").click();
    assert.equal(await getCalendarTitle(), monthName(now));

    await driver.find(".test-calendar-prev").click();
    assert.equal(await getCalendarTitle(), monthName(shiftMonth(now, -1)));

    await driver.find(".test-calendar-today").click();
    await driver.find(".test-calendar-next").click();
    assert.equal(await getCalendarTitle(), monthName(shiftMonth(now, 1)));

    await driver.find(".test-calendar-perspective-week").click();
  });

  it("selects the calendar event for the linked grid row", async function() {
    // Create two events today (visible in the default week view).
    const today = new Date(); today.setHours(10, 0, 0, 0);
    const at = (h: number) => Math.floor(new Date(today).setHours(h) / 1000);
    await gu.sendActions([
      ["AddRecord", "Table1", -1, { From: at(10), To: at(11), Label: "Linked A", IsFullDay: false }],
      ["AddRecord", "Table1", -1, { From: at(13), To: at(14), Label: "Linked B", IsFullDay: false }],
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

  // Reaches the live CalendarView instance via the existing window.gristDocPageModel handle, by
  // finding the calendar section in the active view. Tests read its (private) fields below.
  const VIEW = `window.gristDocPageModel.gristDoc.get().viewModel.viewSections().all()
      .find(s => s.parentKey.peek() === 'custom.calendar').viewInstance.peek()`;

  // Reads the TUI event picked by `lookup` (a JS expression with access to the resolved view `v`
  // and executeScript `arguments`), mapped to a serializable shape, or null if there's no match.
  interface CalEvent { title: string; startMs: number | null; endMs: number | null; isAllDay: boolean; }
  function readEvent(lookup: string, ...args: any[]): Promise<CalEvent | null> {
    return driver.executeScript(`
      const v = (${VIEW});
      const ev = ${lookup};
      if (!ev) { return null; }
      // TUI TZDates carry a timezone tag; .local() recovers the original instant before .toDate().
      const ms = x => !x ? null : (x.toDate ? x.local().toDate().getTime() : new Date(x).getTime());
      return {title: ev.title, startMs: ms(ev.start), endMs: ms(ev.end), isAllDay: Boolean(ev.isAllday)};
    `, ...args);
  }

  // An event from the calendar's full set (independent of the visible range), by rowId or title.
  const getCalendarEvent = (rowId: number) => readEvent("v._allEvents.get(arguments[0])", rowId);
  const getEventByTitle = (title: string) =>
    readEvent("[...v._allEvents.values()].find(e => e.title === arguments[0])", title);

  // Title of the currently-selected event (the row the calendar is tracking), or null.
  async function getSelectedEventTitle(): Promise<string | null> {
    const ev = await readEvent("v._selectedRecordId != null ? v._allEvents.get(v._selectedRecordId) : null");
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

  const dayAt = (day: Date, hour: number) => Math.floor((day.getTime() + hour * 3600_000) / 1000);

  async function getViewName(): Promise<string> {
    return driver.executeScript(`return (${VIEW})._calendar.getViewName()`);
  }

  async function getCalendarDate(): Promise<string> {
    return driver.executeScript(`return (${VIEW})._calendar.getDate().toDate().toDateString()`);
  }

  async function getCalendarTitle(): Promise<string> {
    return driver.find(".test-calendar-title").getText();
  }
});
