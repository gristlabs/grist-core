import { GristDoc } from "app/client/components/GristDoc";
import { makeTestId } from "app/client/lib/domUtils";
import { makeT } from "app/client/lib/localization";
import { ColumnToMapImpl } from "app/client/models/ColumnToMap";
import { ColumnRec, ViewSectionRec } from "app/client/models/DocModel";
import { WidgetColumnMapping } from "app/client/models/entities/ViewSectionRec";
import { cssLabel, cssRow } from "app/client/ui/RightPanelStyles";
import { theme, vars } from "app/client/ui2018/cssVars";
import { IOptionFull, select } from "app/client/ui2018/menus";
import { saveModal } from "app/client/ui2018/modals";
import { isDateOnlyType } from "app/common/gristTypes";

import { Computed, dom, Observable, styled } from "grainjs";

const t = makeT("CalendarConfigModal");
const testId = makeTestId("test-calendar-setup-");

// Sentinel value used in the slot dropdowns to mean "make a new column for me". A string (not a
// number) on purpose: negative numbers are valid rowIds in some parts of Grist, so a numeric
// sentinel could collide with a real column; a string can't.
const CREATE_NEW = "create-new";

// Date-vs-DateTime is a single choice that drives both the type of any created start/end
// column and the default calendar view (see _perspectiveFor below).
type DateMode = "date" | "datetime";

// A slot select holds either a real column rowId (a positive number), the CREATE_NEW sentinel,
// or 0 for "none" (only the optional End slot can be 0).
type SlotValue = number | typeof CREATE_NEW;

/**
 * Blocking setup dialog shown when a calendar widget is first added before its columns are
 * mapped. It lets the user pick or create the Start (required), End (optional) and Title
 * (required) columns, choose whether dates carry a time, and writes both the column mapping
 * and the default view back to the section.
 *
 * The mapping is stored the same way the right-panel picker stores it: as colRefs (rowIds)
 * under `viewSection.customDef.columnsMapping` (see CustomSectionConfig.ts). Column creation
 * goes through `viewSection.insertColumn`, and the whole thing is bundled so a single undo
 * reverts the new columns, the mapping and the view together.
 */
export function buildCalendarSetupModal(section: ViewSectionRec, gristDoc: GristDoc): void {
  saveModal((ctl, owner) => {
    // Date-only vs date+time. Defaults to date+time (week view), the common calendar case.
    const dateMode = Observable.create<DateMode>(owner, "datetime");

    // Slot selections. Start/Title default to "create new"; End defaults to "none" (0).
    const startVal = Observable.create<SlotValue>(owner, CREATE_NEW);
    const endVal = Observable.create<SlotValue>(owner, 0);
    const titleVal = Observable.create<SlotValue>(owner, CREATE_NEW);

    const dateCol = new ColumnToMapImpl({ name: "startDate", type: "Date,DateTime", strictType: true });
    const textCol = new ColumnToMapImpl({ name: "title", type: "Text", strictType: true });

    // Existing columns of the section's table, by type group, as dropdown options.
    const dateColumns = Computed.create(owner, use =>
      use(section.columns).filter(col => dateCol.canByMapped(use(col.pureType))));
    const textColumns = Computed.create(owner, use =>
      use(section.columns).filter(col => textCol.canByMapped(use(col.pureType))));

    const dateOptions = (includeNone: boolean) => Computed.create(owner, (use): IOptionFull<SlotValue>[] => [
      { value: CREATE_NEW, label: t("Create new column"), icon: "Plus" },
      ...(includeNone ? [{ value: 0, label: t("None") } as IOptionFull<SlotValue>] : []),
      ...use(dateColumns).map(col => ({ value: col.getRowId(), label: use(col.label), icon: "FieldColumn" as const })),
    ]);
    const titleOptions = Computed.create(owner, (use): IOptionFull<SlotValue>[] => [
      { value: CREATE_NEW, label: t("Create new column"), icon: "Plus" },
      ...use(textColumns).map(col => ({ value: col.getRowId(), label: use(col.label), icon: "FieldColumn" as const })),
    ]);

    // When an existing Start column is chosen, its type fixes the date mode (and locks the
    // toggle): a Date column means date-only, a DateTime column means date+time. Creating a
    // new column leaves the choice to the user.
    const startIsExisting = Computed.create(owner, use => isRealColumn(use(startVal)));
    owner.autoDispose(startVal.addListener((val) => {
      const col = colFor(section, val);
      if (col) { dateMode.set(isDateOnlyType(col.pureType.peek()) ? "date" : "datetime"); }
    }));

    // The date flavor (true = date-only, false = date+time) a slot will actually resolve to:
    // an existing column keeps its own type; a "Create new column" slot takes the toggle's mode.
    // Returns null for the "none" slot, which imposes no constraint.
    const slotIsDateOnly = (use: (o: any) => any, val: SlotValue): boolean | null => {
      if (val === CREATE_NEW) { return use(dateMode) === "date"; }
      const col = colFor(section, val);
      return col ? isDateOnlyType(use(col.pureType)) : null;
    };

    // Mixed-type guard: if Start and End resolve to different date flavors (Date vs DateTime),
    // we can't render them consistently, so block save with an inline message. This covers a new
    // column vs an existing one too, since a new column's type follows the date/time toggle.
    const mixedTypeError = Computed.create(owner, (use) => {
      const start = slotIsDateOnly(use, use(startVal));
      const end = slotIsDateOnly(use, use(endVal));
      if (start === null || end === null) { return ""; }
      if (start !== end) {
        return t("Start and end must be the same date type.");
      }
      return "";
    });

    // Start/Title are required: unset means the "none" slot value 0. CREATE_NEW and any real
    // rowId both count as set.
    const isSet = (val: SlotValue) => val !== 0;
    const saveDisabled = Computed.create(owner, use =>
      !isSet(use(startVal)) || !isSet(use(titleVal)) || Boolean(use(mixedTypeError)));

    async function resolveColumn(val: SlotValue, type: string, label: string): Promise<number | null> {
      if (val === 0) { return null; }
      if (val === CREATE_NEW) {
        const info = await section.insertColumn(null, { colInfo: { type, label }, nestInActiveBundle: true });
        return info.colRef;
      }
      return val;
    }

    async function saveFunc() {
      const mode = dateMode.get();
      // A bare "DateTime" makes the engine default to America/New_York; created columns must carry
      // the doc timezone (same convention as TypeConversion.addColTypeSuffix) so the grid, formulas
      // and exports agree with what the calendar renders.
      const dateType = mode === "date" ? "Date" : `DateTime:${gristDoc.docInfo.timezone.peek()}`;
      // Resolve (and, for "Create new column", create) the columns inside the bundle. insertColumn
      // passes nestInActiveBundle:true, so with this outer bundle active each new column folds into
      // the single "Configure calendar" action instead of becoming its own. That keeps the whole
      // setup atomic: one undo backs out the columns, the mapping and the view together, and a failed
      // mapping write can't leave orphan columns behind.
      await gristDoc.docData.bundleActions("Configure calendar", async () => {
        const startRef = await resolveColumn(startVal.get(), dateType, t("Start"));
        const endRef = await resolveColumn(endVal.get(), dateType, t("End"));
        const titleRef = await resolveColumn(titleVal.get(), "Text", t("Title"));
        const existing = section.customDef.columnsMapping.peek() || {};
        const mapping: WidgetColumnMapping = { ...existing, startDate: startRef, title: titleRef };
        if (endRef) { mapping.endDate = endRef; } else { delete mapping.endDate; }
        await section.customDef.columnsMapping.setAndSave(mapping);
        await section.optionsObj.prop("calendarViewPerspective").setAndSave(perspectiveFor(mode));
      });
    }

    return {
      title: t("Set up calendar"),
      saveLabel: t("Add calendar"),
      width: "fixed-wide",
      saveDisabled,
      saveFunc,
      body: dom("div",
        cssHelpText(t("Pick the columns that hold your event dates and titles, or create new ones.")),
        cssLabel(t("Dates")),
        cssRow(
          cssModeButton(t("Date only"),
            cssModeButton.cls("-active", use => use(dateMode) === "date"),
            dom.boolAttr("disabled", startIsExisting),
            dom.on("click", () => dateMode.set("date")),
            testId("mode-date")),
          cssModeButton(t("Date + time"),
            cssModeButton.cls("-active", use => use(dateMode) === "datetime"),
            dom.boolAttr("disabled", startIsExisting),
            dom.on("click", () => dateMode.set("datetime")),
            testId("mode-datetime")),
        ),
        cssLabel(t("Start")),
        cssRow(select(startVal, dateOptions(false), { defaultLabel: t("Select a column") }), testId("start")),
        cssLabel(t("End (optional)")),
        cssRow(select(endVal, dateOptions(true), { defaultLabel: t("None") }), testId("end")),
        cssLabel(t("Title")),
        cssRow(select(titleVal, titleOptions, { defaultLabel: t("Select a column") }), testId("title")),
        dom.maybe(mixedTypeError, msg => cssError(msg, testId("error"))),
      ),
    };
  }, { noClickAway: true });
}


// Date-only events are all-day, so day/week views are meaningless; default to month. Timed
// events default to week.
function perspectiveFor(mode: DateMode): "month" | "week" {
  return mode === "date" ? "month" : "week";
}

// True when a slot value points at a real, existing column (a positive rowId), as opposed to
// "none" (0) or the "create new" sentinel (a string).
function isRealColumn(val: SlotValue): val is number {
  return typeof val === "number" && val > 0;
}

// Returns the existing ColumnRec for a slot value, or null for "none"/"create new".
function colFor(section: ViewSectionRec, val: SlotValue): ColumnRec | null {
  return isRealColumn(val) ? section.columns.peek().find(c => c.getRowId() === val) || null : null;
}

const cssHelpText = styled("div", `
  color: ${theme.lightText};
  margin-bottom: 16px;
`);

const cssModeButton = styled("button", `
  flex: 1;
  height: 30px;
  padding: 5px;
  border: 1px solid ${theme.inputBorder};
  background: ${theme.inputBg};
  color: ${theme.text};
  cursor: pointer;
  font: inherit;
  font-size: ${vars.mediumFontSize};
  &:first-child { border-radius: 3px 0 0 3px; }
  &:last-child { border-radius: 0 3px 3px 0; border-left: none; }
  &-active {
    background: ${theme.controlPrimaryBg};
    color: ${theme.controlPrimaryFg};
    border-color: ${theme.controlPrimaryBg};
  }
  &:disabled { opacity: 0.6; cursor: default; }
`);

const cssError = styled("div", `
  color: ${theme.errorText};
  margin-top: 8px;
`);
