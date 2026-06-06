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
    // Adding a calendar with nothing mapped opens the blocking setup modal; dismiss it here so
    // the rest of these tests map columns through the right panel as before. The modal itself is
    // covered by the "setup modal" describe block below.
    await driver.findWait(".test-calendar-setup-start", 2000);
    await driver.find(".test-modal-cancel").click();
    await gu.openWidgetPanel();
    await setMapping("startDate", /From/);
    await setMapping("endDate", /To/);
    await setMapping("title", /Label/);
    await setMapping("isAllDay", /IsFullDay/);
  });

  afterEach(async function() {
    // Keep tests independent: a mistimed grid drag can leave a popup open (TUI's own, or Grist's
    // Record Card from the drag-to-create flow) whose overlay would intercept clicks in the next
    // test, and can add a stray "New Event" placeholder row. dismissCalendarPopup clears both.
    await dismissCalendarPopup();
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
    // Buttons carry their localized labels (from perspectiveLabel's static t("Day")/t("Week")/
    // t("Month"), which the i18n extractor can see).
    assert.equal((await driver.find(".test-calendar-perspective-day").getText()).trim(), "Day");
    assert.equal((await driver.find(".test-calendar-perspective-week").getText()).trim(), "Week");
    assert.equal((await driver.find(".test-calendar-perspective-month").getText()).trim(), "Month");

    await driver.find(".test-calendar-perspective-day").click();
    assert.equal(await getViewName(), "day");
    await driver.find(".test-calendar-perspective-month").click();
    assert.equal(await getViewName(), "month");
    await driver.find(".test-calendar-perspective-week").click();
    assert.equal(await getViewName(), "week");
  });

  it("labels the now-indicator in the same 12-hour format as the hour axis", async function() {
    // The now-indicator only renders on today, so go to day view on today.
    await driver.find(".test-calendar-perspective-day").click();
    await driver.find(".test-calendar-today").click();
    const label = await driver.findWait(".toastui-calendar-timegrid-now-indicator-label", 2000).getText();
    // 12-hour with am/pm (e.g. "3:44 pm"), matching TUI's "3 pm" hour axis, not 24-hour "15:44".
    assert.match(label.trim(), /^\d{1,2}:\d{2} (am|pm)$/);
    await driver.find(".test-calendar-perspective-week").click();
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

    // Week view: a date range separated by a hyphen.
    await driver.find(".test-calendar-perspective-week").click();
    await driver.find(".test-calendar-today").click();
    assert.match(await getCalendarTitle(), /-/);
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
    // Double-clicking an event opens the Record Card, not TUI's create-event form popup. TUI still
    // opens that popup for the same double-click (mispositioned off to the side), so we close it as
    // soon as it appears; assert it isn't left on screen.
    await driver.wait(async () => !(await driver.find(".toastui-calendar-popup-container").isPresent()), 2000);
    await driver.sendKeys(Key.ESCAPE);
    assert.isFalse(await driver.find(".test-record-card-popup-overlay").isPresent());
  });

  it("creates a row and opens the Record Card when the grid is dragged", async function() {
    // Drag on an empty grid to select a time range. With TUI's create-event form popup off
    // (useFormPopup: false), this adds a Grist row for the range and opens Grist's Record Card on
    // it, rather than showing TUI's own popup.
    const day = await gotoCleanDay(9);
    const grid = await driver.find(".test-calendar-widget");
    await driver.withActions(a => a
      .move({ origin: grid, x: 0, y: -60 })
      .press()
      .move({ origin: grid, x: 0, y: -50 })
      .pause(120)
      .move({ origin: grid, x: 0, y: 60 })
      .pause(120)
      .release());
    await gu.waitForServer();
    // Grist's Record Card opens (not TUI's create-event form popup), and a new event lands on the day.
    assert.isTrue(await driver.findWait(".test-record-card-popup-overlay", 2000).isDisplayed());
    assert.isFalse(await driver.find(".toastui-calendar-popup-container").isPresent());
    await driver.wait(async () => Boolean(await getEventByTitle("New Event")), 2000);
    const ev = await getEventByTitle("New Event");
    assert.equal(new Date(ev!.startMs!).toDateString(), day.toDateString());
    // The card and the placeholder "New Event" row are cleaned up by the afterEach teardown.
  });

  // Helpers

  // Deletes any Table1 rows the drag-to-create flow left behind: rows whose Label is the default
  // "New Event" placeholder. Safe when there are none. Used by the teardown to keep tests independent.
  async function removeStrayNewEventRows() {
    const ids = await driver.executeScript<number[]>(`
      const t = window.gristDocPageModel.gristDoc.get().docData.getTable("Table1");
      return t.getRowIds().filter(id => t.getValue(id, "Label") === "New Event");
    `).catch(() => [] as number[]);
    if (ids.length) {
      await gu.sendActions([["BulkRemoveRecord", "Table1", ids]]);
    }
  }

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
    await dismissCalendarPopup();
    await driver.find(".test-calendar-perspective-day").click();
    await driver.find(".test-calendar-today").click();
    for (let i = 0; i < daysAhead; i++) { await driver.find(".test-calendar-next").click(); }
    const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() + daysAhead);
    return day;
  }

  const dayAt = (day: Date, hour: number) =>
    sec(new Date(day.getTime() + hour * 3600_000));

  // A mistimed grid drag can leave a popup open, whose overlay then intercepts clicks in later
  // tests. Two kinds can appear: TUI's own create/edit form popup, and (since useFormPopup is off)
  // Grist's Record Card, which the drag-to-create flow opens. Close whichever is present, and drop
  // any stray "New Event" placeholder row that flow added.
  async function dismissCalendarPopup() {
    // Grist's Record Card (opened by drag-to-create / double-click): dismiss with Escape.
    if (await driver.find(".test-record-card-popup-overlay").isPresent().catch(() => false)) {
      await driver.sendKeys(Key.ESCAPE);
      await driver.wait(async () =>
        !(await driver.find(".test-record-card-popup-overlay").isPresent().catch(() => false)), 1000)
        .catch(() => undefined);
    }
    // Drop placeholder rows the drag-to-create flow left behind, so their events don't leak into a
    // later test's title/unassigned assertions.
    await removeStrayNewEventRows();
    // TUI's own create/edit form popup, if it appeared. Use findElements (returns [] rather than
    // throwing) since some popup variants have no close button; fall back to Escape when it's absent.
    if (await driver.find(".toastui-calendar-popup-overlay").isPresent().catch(() => false)) {
      const [close] = await driver.findElements(By.css("button.toastui-calendar-popup-close"));
      if (close) {
        await close.click().catch(() => undefined);
      } else {
        await driver.sendKeys(Key.ESCAPE);
      }
      await driver.wait(async () =>
        !(await driver.find(".toastui-calendar-popup-overlay").isPresent().catch(() => false)), 1000)
        .catch(() => undefined);
    }
  }

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

/**
 * The blocking setup modal shown when a calendar is first added before its columns are mapped.
 * Each test adds a fresh calendar section so the modal opens from a clean, unmapped state.
 */
describe("CalendarView setup modal", function() {
  this.timeout(30000);
  const cleanup = setupTestSuite();

  before(async function() {
    const session = await gu.session().login();
    await session.tempDoc(cleanup, "Calendar.grist");
    // The fixture only has DateTime columns (From/To). Add a date-only column so we can test the
    // Date -> month-view convention and the mixed-type validation.
    await gu.sendActions([
      ["AddColumn", "Table1", "DateOnly", { type: "Date" }],
    ]);
  });

  // Adds a calendar widget linked to Table1 and waits for the setup modal to open.
  async function addCalendarAndOpenModal() {
    await gu.addNewSection(/Calendar/, /Table1/, { selectBy: /TABLE1/ });
    await driver.findWait(".test-calendar-setup-start", 2000);
  }

  // Picks an option (matched by text) in one of the modal's slot selects.
  async function pickSlot(slot: string, label: RegExp) {
    await driver.find(`.test-calendar-setup-${slot} .test-select-open`).click();
    await driver.findContentWait(".test-select-row", label, 1000).click();
  }

  async function getViewName(): Promise<string> {
    return driver.executeScript("return window.gristCalendarView.getViewName()");
  }

  afterEach(async function() {
    // Make sure no modal is left open between tests. Each test adds its own fresh (unmapped)
    // calendar section, so the next one still triggers the modal regardless of what this one did.
    if (await driver.find(".test-modal-cancel").isPresent().catch(() => false)) {
      await driver.find(".test-modal-cancel").click();
    }
  });

  it("opens a blocking modal that ignores click-away", async function() {
    await addCalendarAndOpenModal();
    // Clicking the backdrop does not dismiss it (noClickAway).
    await driver.find(".test-calendar-container, body").click();
    assert.isTrue(await driver.find(".test-calendar-setup-start").isPresent());
  });

  it("maps existing columns and defaults to week view for date+time", async function() {
    await addCalendarAndOpenModal();
    await pickSlot("start", /From/);
    await pickSlot("title", /Label/);
    await driver.find(".test-modal-confirm").click();
    await gu.waitForServer();
    await driver.findWait(".test-calendar-widget", 2000);
    // From is a DateTime column, so the default view is week.
    assert.equal(await getViewName(), "week");
  });

  it("defaults to month view when an existing Date column is the start", async function() {
    await addCalendarAndOpenModal();
    // DateOnly is a date-only column in the fixture; mapping it should select month view.
    await pickSlot("start", /DateOnly/);
    await pickSlot("title", /Label/);
    await driver.find(".test-modal-confirm").click();
    await gu.waitForServer();
    await driver.findWait(".test-calendar-widget", 2000);
    assert.equal(await getViewName(), "month");
  });

  it("blocks save when start and end have mixed date types", async function() {
    await addCalendarAndOpenModal();
    await pickSlot("start", /From/);       // DateTime
    await pickSlot("end", /DateOnly/);     // Date
    await pickSlot("title", /Label/);
    assert.isTrue(await driver.findWait(".test-calendar-setup-error", 1000).isDisplayed());
    assert.isTrue(await driver.find(".test-modal-confirm").matches("[disabled]"));
  });

  it("blocks save when a new date+time start is mixed with an existing Date end", async function() {
    await addCalendarAndOpenModal();
    // Start = "Create new column" (a new column takes its type from the date/time toggle, which
    // defaults to date+time here). End = an existing Date-only column. The effective types differ
    // (DateTime vs Date), so the mixed-type guard must fire even though start is not yet a real
    // column. Regression: the guard used to only look at existing columns and let this through.
    await pickSlot("start", /Create new column/);
    await pickSlot("end", /DateOnly/);     // Date
    await pickSlot("title", /Label/);
    assert.isTrue(await driver.findWait(".test-calendar-setup-error", 1000).isDisplayed());
    assert.isTrue(await driver.find(".test-modal-confirm").matches("[disabled]"));
  });

  it("creates a new column when asked, and maps it", async function() {
    await addCalendarAndOpenModal();
    await pickSlot("start", /Create new column/);
    await pickSlot("title", /Label/);
    await driver.find(".test-modal-confirm").click();
    await gu.waitForServer();
    await driver.findWait(".test-calendar-widget", 2000);
    // A new Start column now exists on Table1, mapped as startDate, and its type carries the doc
    // timezone (not a bare "DateTime", which the engine would default to America/New_York).
    const info = await driver.executeScript<{ startId: string; type: string; docTz: string }>(`
      const gristDoc = window.gristCalendarView._view.gristDoc;
      const mapped = window.gristCalendarView._view.viewSection.mappedColumns();
      const startId = mapped && mapped.startDate;
      const col = window.gristCalendarView._view.viewSection.columns.peek()
        .find(c => c.colId.peek() === startId);
      return { startId, type: col && col.type.peek(), docTz: gristDoc.docInfo.timezone.peek() };
    `);
    assert.isOk(info.startId);
    assert.equal(info.type, "DateTime:" + info.docTz);
  });
});

/**
 * Back-compat for documents saved by the old bundled calendar widget. Those docs store the section
 * with parentKey "custom.calendar" (not the native "calendar"), plus a saved start/end/title
 * mapping. Opening such a doc must render the native CalendarView, not silently fall back to a grid.
 *
 * The fixture CalendarLegacy.grist was produced on a released (old) Grist: Table1 has Start/End
 * (DateTime) and Title (Text), two events in Jan 2024, and a "custom.calendar" section mapping
 * startDate=Start, endDate=End, title=Title.
 */
describe("CalendarView legacy custom.calendar docs", function() {
  this.timeout(30000);
  const cleanup = setupTestSuite();

  before(async function() {
    const session = await gu.session().login();
    await session.tempDoc(cleanup, "CalendarLegacy.grist");
  });

  it("renders a legacy custom.calendar section as the native calendar", async function() {
    // The native view mounts (not a grid), and there is no custom-widget iframe.
    await driver.findWait(".test-calendar-container", 2000);
    await driver.findWait(".test-calendar-widget", 2000);
    assert.isEmpty(await driver.findElements(By.css("iframe.custom_view")));
    // The fixture's calendar section has no explicit title, so its header falls back to the
    // default "TABLENAME <widget type>". The legacy "custom.calendar" parentKey must still
    // resolve to the Calendar label (via its widgetTypesMap alias), not fall back to "Table".
    assert.include(await gu.getSectionTitles(), "TABLE1 Calendar");
  });

  it("keeps the saved start/end/title mapping and shows the events", async function() {
    // The mapping saved by the old widget survives as-is.
    const mapped = await driver.executeScript<any>(
      "return window.gristCalendarView._view.viewSection.mappedColumns()");
    assert.equal(mapped?.startDate, "Start");
    assert.equal(mapped?.endDate, "End");
    assert.equal(mapped?.title, "Title");

    // The two legacy events render (their start is anchored to Jan 2024, so navigate there first).
    await driver.executeScript(
      "window.gristCalendarView._view._calendar.setDate(new Date(2024, 0, 15))");
    await driver.wait(async () => Boolean(
      await driver.executeScript("return window.gristCalendarView.getEventByTitle('Legacy Event A')"),
    ), 2000);
    const ev = await driver.executeScript<any>(
      "return window.gristCalendarView.getEventByTitle('Legacy Event A')");
    assert.equal(ev?.title, "Legacy Event A");
  });
});

/**
 * Geometry of drop-to-assign: _dateAtPoint maps a pointer position over the grid to a date. It must
 * account for the week view's left hour-gutter and the month view's day-name header, which don't
 * belong to any day. We drive it directly (rather than through a flaky drag gesture): measure the
 * real day columns / cells TUI renders and assert the date each one maps to.
 */
describe("CalendarView drop geometry", function() {
  this.timeout(30000);
  const cleanup = setupTestSuite();
  // The toolbar's perspective buttons (Day/Week/Month) sit at the right edge; on the default
  // narrow window they can land just outside the viewport and become unclickable. Give this suite
  // a wider window so the whole toolbar is on-screen.
  gu.resizeWindowForSuite(1440, 900);

  before(async function() {
    const session = await gu.session().login();
    // Reuse the legacy fixture: it already has a calendar section mapping Start/End/Title, with
    // events in Jan 2024. Navigate the calendar there so the visible range is deterministic.
    await session.tempDoc(cleanup, "CalendarLegacy.grist");
    await driver.findWait(".test-calendar-widget", 2000);
    await driver.executeScript(
      "window.gristCalendarView._view._calendar.setDate(new Date(2024, 0, 15))");
  });

  // Calls the live view's _dateAtPoint(x, y) and returns the resulting date as a yyyy-mm-dd string.
  async function dateAtPoint(x: number, y: number): Promise<string | null> {
    return driver.executeScript<string | null>(`
      const d = window.gristCalendarView._view._dateAtPoint(arguments[0], arguments[1]);
      if (!d) { return null; }
      const p = (n) => String(n).padStart(2, "0");
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
    `, x, y);
  }

  // Adds `days` to a yyyy-mm-dd string, staying in UTC so no timezone shifts a day. Used to build
  // the expected date for each column/cell from the calendar's range start.
  function addDaysStr(yyyymmdd: string, days: number): string {
    const [y, m, d] = yyyymmdd.split("-").map(Number);
    const out = new Date(Date.UTC(y, m - 1, d + days));
    const p = (n: number) => String(n).padStart(2, "0");
    return `${out.getUTCFullYear()}-${p(out.getUTCMonth() + 1)}-${p(out.getUTCDate())}`;
  }

  it("maps week-view columns to the right day (ignoring the hour gutter)", async function() {
    await driver.find(".test-calendar-perspective-week").click();
    // Read each rendered day column's center and the calendar's visible range start.
    const info = await driver.executeScript<{ centers: { x: number; y: number }[]; start: string }>(`
      const cal = window.gristCalendarView._view._calendar;
      const wrap = document.querySelector(".toastui-calendar-columns").getBoundingClientRect();
      const midY = wrap.top + wrap.height / 2;
      const cols = [...document.querySelectorAll(".toastui-calendar-column")];
      const s = cal.getDateRangeStart().toDate();
      const p = (n) => String(n).padStart(2, "0");
      return {
        centers: cols.map(c => { const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: midY }; }),
        start: s.getFullYear() + "-" + p(s.getMonth() + 1) + "-" + p(s.getDate()),
      };
    `);
    // Each column's center maps to consecutive days starting at the range start.
    for (let i = 0; i < info.centers.length; i++) {
      assert.equal(await dateAtPoint(info.centers[i].x, info.centers[i].y),
        addDaysStr(info.start, i), `column ${i}`);
    }
  });

  it("maps month-view cells to the right day (ignoring the day-name header)", async function() {
    await driver.find(".test-calendar-perspective-month").click();
    const info = await driver.executeScript<{ cells: { x: number; y: number }[]; start: string }>(`
      const cal = window.gristCalendarView._view._calendar;
      const cells = [...document.querySelectorAll(".toastui-calendar-daygrid-cell")];
      const s = cal.getDateRangeStart().toDate();
      const p = (n) => String(n).padStart(2, "0");
      return {
        cells: cells.map(c => { const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }),
        start: s.getFullYear() + "-" + p(s.getMonth() + 1) + "-" + p(s.getDate()),
      };
    `);
    // Check the first two weeks (14 cells) to cover the header-offset boundary without over-testing.
    for (let i = 0; i < Math.min(14, info.cells.length); i++) {
      assert.equal(await dateAtPoint(info.cells[i].x, info.cells[i].y),
        addDaysStr(info.start, i), `cell ${i}`);
    }
  });
});
