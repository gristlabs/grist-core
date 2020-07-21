import * as moment from 'moment-timezone';

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
  const separators = /\W+/g;
  const dateFormats = PARSER_FORMATS.slice();
  // If a preferred parse format is given, set that to be the first parser used.
  if (options.dateFormat) {
    // Momentjs has an undesirable feature in strict mode where MM and DD
    // matches require two digit numbers. Change MM, DD to M, D.
    const format = options.dateFormat.replace(/\bMM\b/g, 'M')
      .replace(/\bDD\b/g, 'D')
      .replace(separators, ' ');
    dateFormats.unshift(_getPartialFormat(date, format));
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
  // Define a regular expression to match contiguous separators.
  const re = /\W+/g;
  // Clean off any whitespace from the ends, and count the number of separators.
  const inputMatch = input.trim().match(re);
  const numInputSeps = inputMatch ? inputMatch.length : 0;
  // Find the separator matches in the format string.
  let formatMatch;
  for (let i = 0; i < numInputSeps + 1; i++) {
    formatMatch = re.exec(format);
    if (!formatMatch) {
      break;
    }
  }
  // Get the format string up until the corresponding input ends.
  return formatMatch ? format.slice(0, formatMatch.index) : format;
}
