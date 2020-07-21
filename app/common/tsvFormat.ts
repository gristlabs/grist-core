/**
 * Given a 2D array of strings, encodes them in tab-separated format.
 * Certain values are quoted; when quoted, internal quotes get doubled. The behavior attempts to
 * match Excel's tsv encoding and parsing when using copy-paste.
 */
export function tsvEncode(data: any[][]): string {
  return data.map(row => row.map(value => encode(value)).join("\t")).join("\n");
}

function encode(rawValue: any): string {
  // For encoding-decoding symmetry, we should also encode any values that start with '"',
  // but neither Excel nor Google Sheets do it. They both decode such values to something
  // different than what produced them (e.g. `"foo""bar"` is encoded into `"foo""bar"`, and
  // that is decoded into `foo"bar`).
  const value: string = typeof rawValue === 'string' ? rawValue :
    (rawValue == null ? "" : String(rawValue));
  if (value.includes("\t") || value.includes("\n")) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/**
 * Given a tab-separated string, decodes it and returns a 2D array of strings.
 * TODO: This does not yet deal with Windows line endings (\r or \r\n).
 */
export function tsvDecode(tsvString: string): string[][] {
  const lines: string[][] = [];
  let row: string[] = [];

  // This is a complex regexp but it does the job of a lot of parsing code. Here are the parts:
  //  A: [^\t\n]*         Sequence of character that does not require the field to get quoted.
  //  B: ([^"]*"")*[^"]*  Sequence of characters containing all double-quotes in pairs (i.e. `""`)
  //  C: "B"(?!")         Quoted sequence, with all double-quotes inside paired up, and ending in a single quote.
  //  D: C?A              A value for one field, a relaxation of C|A (to cope with not-quite expected data)
  //  E: D(\t|\n|$)       Field value with field, line, or file terminator.
  const fieldRegexp = /(("([^"]*"")*[^"]*"(?!"))?[^\t\n]*)(\t|\n|$)/g;
  for (;;) {
    const m = fieldRegexp.exec(tsvString);
    if (!m) { break; }
    const sep = m[4];
    let value = m[1];
    if (value.startsWith('"')) {
      // It's a quoted value, so doubled-up quotes should became individual quotes, and individual
      // quotes should be removed.
      value = value.replace(/"([^"]*"")*[^"]*"(?!")/, q => q.slice(1, -1).replace(/""/g, '"'));
    }
    row.push(value);
    if (sep !== '\t') {
      lines.push(row);
      row = [];
      if (sep === '') {
        break;
      }
    }
  }
  return lines;
}
