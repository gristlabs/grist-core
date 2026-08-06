/**
 * Exposes utilities for getting the types information associated to each of the widget types.
 */
import { StringUnion } from "app/common/StringUnion";

// Custom widgets that are attached to "Add New" menu.
export const AttachedCustomWidgets = StringUnion("custom.calendar");
export type IAttachedCustomWidget = typeof AttachedCustomWidgets.type;

// all widget types
export type IWidgetType =
  "record" | "detail" | "single" | "chart" | "calendar" | "custom" | "form" | IAttachedCustomWidget;

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
