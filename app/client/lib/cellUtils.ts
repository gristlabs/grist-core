/**
 * Shared utilities for working with raw Grist cell values in simple views
 * that don't go through the full FieldBuilder formatting pipeline.
 */

/**
 * Formats a raw cell value for display. Returns an empty string for null/undefined/empty,
 * "#ERROR" for error tuples, and String(val) for everything else.
 */
export function formatRawCellValue(val: any): string {
  if (val === null || val === undefined || val === "") { return ""; }
  if (Array.isArray(val) && val[0] === 'E') {
    return "#ERROR";
  }
  return String(val);
}
