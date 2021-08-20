import * as moment from 'moment-timezone';

// When using YY format, use a consistent interpretation in datepicker and in moment parsing: add
// 2000 if the result is at most 10 years greater than the current year; otherwise add 1900. See
// https://bootstrap-datepicker.readthedocs.io/en/latest/options.html#assumenearbyyear and
// "Parsing two digit years" in https://momentjs.com/docs/#/parsing/string-format/.
export const TWO_DIGIT_YEAR_THRESHOLD = 10;
const MAX_TWO_DIGIT_YEAR = new Date().getFullYear() + TWO_DIGIT_YEAR_THRESHOLD - 2000;

// Moment suggests that overriding this is fine, but we need to force TypeScript to allow it.
(moment as any).parseTwoDigitYear = function(yearString: string): number {
  const year = parseInt(yearString, 10);
  return year + (year > MAX_TWO_DIGIT_YEAR ? 1900 : 2000);
};


// Order of formats to try if the date cannot be parsed as the currently set format.
// Formats are parsed in momentjs strict mode, but separator matching and the MM/DD
// two digit requirement are ignored. Also, partial completion is permitted, so formats
// may match even if only beginning elements are provided.
// TODO: These should be affected by the user's locale/settings.
// TODO: We may want to consider adding default time formats as well to support more
//  time formats.
const PARSER_FORMATS: string[] = [
  'M D YYYY',
  'M D YY',
  'M D',
  'M',
  'MMMM D YYYY',
  'MMMM D',
  'MMMM Do YYYY',
  'MMMM Do',
  'MMMM',
  'MMM D YYYY',
  'MMM D',
  'D MMM YYYY',
  'D MMM',
  'MMM',
  'YYYY M D',
  'YYYY M',
  'YYYY',
  'D M YYYY',
  'D M YY',
  'D M',
  'D'
];

interface ParseOptions {
  time?: string;
  dateFormat?: string;
  timeFormat?: string;
  timezone?: string;
}

/**
 * parseDate - Attempts to parse a date string using several common formats. Returns the
 *  timestamp of the parsed date in seconds since epoch, or returns null on failure.
 * @param {String} date - The date string to parse.
 * @param {String} options.dateFormat - The preferred momentjs format to use to parse the
 *  date. This is attempted before the default formats.
 * @param {String} options.time - The time string to parse.
 * @param {String} options.timeFormat - The momentjs format to use to parse the time. This
 *  must be given if options.time is given.
 * @param {String} options.timezone - The timezone string for the date/time, which affects
 *  the resulting timestamp.
 */
export function parseDate(date: string, options: ParseOptions = {}): number | null {
  // If no date, return null.
  if (!date) {
    return null;
  }
  // Not picky about separators, so replace them in the date and format strings to be spaces.
  const separators = /[\W_]+/g;
  const dateFormats = PARSER_FORMATS.slice();
  // If a preferred parse format is given, set that to be the first parser used.
  if (options.dateFormat) {
    // Momentjs has an undesirable feature in strict mode where MM and DD
    // matches require two digit numbers. Change MM, DD to M, D.
    let format = options.dateFormat.replace(/MM+/g, m => (m === 'MM' ? 'M' : m))
      .replace(/DD+/g, m => (m === 'DD' ? 'D' : m))
      .replace(separators, ' ');
    format = _getPartialFormat(date, format);
    // Consider some alternatives to the preferred format.
    const variations = _buildVariations(format);
    dateFormats.unshift(...variations);
  }
  const cleanDate = date.replace(separators, ' ');
  const datetime = (options.time ? `${cleanDate} ${options.time}` : cleanDate).trim();
  for (const f of dateFormats) {
    // Momentjs has an undesirable feature in strict mode where HH, mm, and ss
    // matches require two digit numbers. Change HH, mm, and ss to H, m, and s.
    const timeFormat = options.timeFormat ? options.timeFormat.replace(/\bHH\b/g, 'H')
      .replace(/\bmm\b/g, 'm')
      .replace(/\bss\b/g, 's') : null;
    const fullFormat = options.time && timeFormat ? `${f} ${timeFormat}` : f;
    const m = moment.tz(datetime, fullFormat, true, options.timezone || 'UTC');
    if (m.isValid()) {
      return m.valueOf() / 1000;
    }
  }
  return null;
}

// Helper function to get the partial format string based on the input. Momentjs has a feature
// which allows defaulting to the current year, month and/or day if not accounted for in the
// parser. We remove any parts of the parser not given in the input to take advantage of this
// feature.
function _getPartialFormat(input: string, format: string): string {
  // Define a regular expression to match contiguous non-separators.
  const re = /Y+|M+|D+|[a-zA-Z0-9]+/g;
  // Count the number of meaningful parts in the input.
  const numInputParts = input.match(re)?.length || 0;

  // Count the number of parts in the format string.
  let numFormatParts = format.match(re)?.length || 0;

  if (numFormatParts > numInputParts) {
    // Remove year from format first, to default to current year.
    if (/Y+/.test(format)) {
      format = format.replace(/Y+/, ' ').trim();
      numFormatParts -= 1;
    }
    if (numFormatParts > numInputParts) {
      // Remove month from format next.
      format = format.replace(/M+/, ' ').trim();
    }
  }
  return format;
}

// Moment non-strict mode is considered bad, as it's far too lax. But moment's strict mode is too
// strict. We want to allow YY|YYYY for either year specifier, as well as M for MMM or MMMM month
// specifiers. It's silly that we need to create multiple format variations to support this.
function _buildVariations(format: string) {
  const variations = new Set<string>([format]);
  const otherYear = format.replace(/Y{2,4}/, (m) => (m === 'YY' ? 'YYYY' : (m === 'YYYY' ? 'YY' : m)));
  variations.add(otherYear);
  variations.add(format.replace(/MMM+/, 'M'));
  if (otherYear !== format) {
    variations.add(otherYear.replace(/MMM+/, 'M'));
  }
  return variations;
}
