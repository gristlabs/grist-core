/**
 * Shared utilities for working with raw Grist cell values in simple views
 * that don't go through the full FieldBuilder formatting pipeline.
 */

/**
 * Formats a raw cell value for display. Returns an empty string for null/undefined/empty,
 * "#ERROR" for error tuples, and String(val) for everything else.
 */
/**
 * Convert a 0-based column index to a spreadsheet-style letter:
 * 0 -> A, 25 -> Z, 26 -> AA, 51 -> AZ, 52 -> BA, 701 -> ZZ, 702 -> AAA, etc.
 */
export function indexToLetter(index: number): string {
  let result = "";
  let i = index;
  while (i >= 0) {
    result = String.fromCharCode(65 + (i % 26)) + result;
    i = Math.floor(i / 26) - 1;
  }
  return result;
}

export function formatRawCellValue(val: any): string {
  if (val === null || val === undefined || val === "") { return ""; }
  if (Array.isArray(val) && val[0] === "E") {
    return "#ERROR";
  }
  return String(val);
}
