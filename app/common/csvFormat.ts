/**
 * Simple utilities for escaping/quoting/parsing CSV data.
 *
 * This only supports the default Excel-like encoding, in which fields containing any separators
 * or quotes get quoted (using '"'), and quotes get doubled.
 *
 * Quoting is also applied when values contain leading or trailing whitespace, and on parsing,
 * leading or trailing whitespace in unquoted values is trimmed, so that "," or ", " may be used
 * as a separator.
 *
 * This is intended for copy-pasting multi-choice values, where plain comma-separated text is the
 * most user-friendly, and CSV encoding is used to ensure we can handle arbitrary values.
 */

// Encode a row. If {prettier: true} is set, separate output with ", ". Leading whitespace gets
// encoded in any case.
export function csvEncodeRow(values: string[], options: {prettier?: boolean} = {}): string {
  return values.map(csvEncodeCell).join(options.prettier ? ", " : ",");
}

export function csvDecodeRow(text: string): string[] {
  // Clever regexp from https://github.com/micnews/csv-line
  const parts = text.split(/((?:(?:"[^"]*")|[^,])*)/);
  const main = parts.filter((v, idx) => idx % 2).map(csvDecodeCell);
  // The "delimiter" (odd-numbered parts) is our content. If it's not at the start/end, it means
  // we have commas, and should include empty fields at those ends.
  if (parts[0]) { main.unshift(""); }
  if (parts[parts.length - 1]) { main.push(""); }
  return main;
}

export function csvEncodeCell(value: string): string {
  return /[,\r\n"]|^\s|\s$/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
}

export function csvDecodeCell(value: string): string {
  return value.trim().replace(/^"|"$/g, '').replace(/""/g, '"');
}
