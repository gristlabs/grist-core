/**
 * Exposes utilities for getting the types information associated to each of the widget types.
 */

// What the row-number gutter of a grid shows: position numbers (default), bracketed row IDs,
// or nothing (gutter collapsed).
export type RowNumbersMode = "number" | "rowId" | "hidden";

// What a widget shows when its options say nothing. Read by the client models and by the
// server tools that report a widget's options.
export const DEFAULT_VIEW_SECTION_OPTIONS = {
  verticalGridlines: true,
  horizontalGridlines: true,
  zebraStripes: false,
  rowNumbers: "number" as RowNumbersMode,
};

// all widget types; "custom.calendar" exists only for old documents, new code never sets it.
export type IWidgetType =
  "record" | "detail" | "single" | "chart" | "calendar" | "custom" | "form" | "custom.calendar";

export enum WidgetType {
  Table = "record",
  Card = "single",
  CardList = "detail",
  Chart = "chart",
  Custom = "custom",
  Form = "form",
  Calendar = "calendar",
}

// Identifiers of the retired calendar custom widget. Old documents may have plain "custom"
// sections pointing at it: either at the copy bundled with Grist (referenced by widgetId, since
// its URL varied per deployment), or at the gallery version (referenced by URL).
export const LEGACY_CALENDAR_WIDGET_ID = "@gristlabs/widget-calendar";
export const LEGACY_CALENDAR_WIDGET_URL = "https://gristlabs.github.io/grist-widget/calendar/index.html";

/**
 * Whether a "custom" section's definition refers to the retired calendar custom widget.
 * Such sections are rendered with the native calendar.
 */
export function isLegacyCalendarCustomDef(customDef: {
  widgetId?: string | null,
  url?: string | null,
} | null | undefined): boolean {
  return customDef?.widgetId === LEGACY_CALENDAR_WIDGET_ID || customDef?.url === LEGACY_CALENDAR_WIDGET_URL;
}
