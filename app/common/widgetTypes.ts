/**
 * Exposes utilities for getting the types information associated to each of the widget types.
 */

// all widget types
export type IWidgetType = "record" | "detail" | "single" | "chart" | "custom" | "form";
export enum WidgetType {
  Table = "record",
  Card = "single",
  CardList = "detail",
  Chart = "chart",
  Custom = "custom",
  Form = "form",
}
