import escapeRegExp = require('lodash/escapeRegExp');
import memoize = require('lodash/memoize');
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
  'D MMMM YYYY',
  'D MMMM',
  'Do MMMM YYYY',
  'Do MMMM',
  'MMMM',
  'MMM D YYYY',
  'MMM D',
  'MMM Do YYYY',
  'MMM Do',
  'D MMM YYYY',
  'D MMM',
  'Do MMM YYYY',
  'Do MMM',
  'MMM',
  'YYYY M D',
  'YYYY M',
  'YYYY',
  'D M YYYY',
  'D M YY',
  'D M',
  'D'
];

const UNAMBIGUOUS_FORMATS = [
  'YYYY M D',
  ...PARSER_FORMATS.filter(f => f.includes("MMM")),
];

const TIME_REGEX = /(?:^|\s+|T)(?:(\d\d?)(?::(\d\d?)(?::(\d\d?))?)?|(\d\d?)(\d\d))\s*([ap]m?)?$/i;
// [^a-zA-Z] because no letters are allowed directly before the abbreviation
const UTC_REGEX = /[^a-zA-Z](UTC?|GMT|Z)$/i;
const NUMERIC_TZ_REGEX = /([+-]\d\d?)(?::?(\d\d))?$/i;

// Not picky about separators, so replace them in the date and format strings to be spaces.
const SEPARATORS = /[\W_]+/g;

const tzAbbreviations = memoize((tzName: string): RegExp => {
  // Some abbreviations are just e.g. +05
  // and escaping the + seems better than filtering
  const abbreviations = new Set(moment.tz.zone(tzName)!.abbrs.map(escapeRegExp));

  const union = [...abbreviations].join('|');

  // [^a-zA-Z] because no letters are allowed directly before the abbreviation
  // so for example CEST won't match even if EST does
  return new RegExp(`[^a-zA-Z](${union})$`, 'i');
});

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
  const dateFormats = PARSER_FORMATS.slice();
  // If a preferred parse format is given, set that to be the first parser used.
  if (options.dateFormat) {
    dateFormats.unshift(..._buildVariations(options.dateFormat, date));
  }
  const cleanDate = date.replace(SEPARATORS, ' ');
  let datetime = cleanDate.trim();
  let timeformat = '';
  let time = options.time;
  if (time) {
    const parsedTimeZone = parseTimeZone(time, options.timezone!);
    const parsedTime = standardizeTime(parsedTimeZone.remaining);
    if (!parsedTime || parsedTime.remaining) {
      return null;
    }
    time = parsedTime.time;
    const {tzOffset} = parsedTimeZone;
    datetime += ' ' + time + tzOffset;
    timeformat = ' HH:mm:ss' + (tzOffset ? 'Z' : '');
  }
  for (const f of dateFormats) {
    const fullFormat = f + timeformat;
    const m = moment.tz(datetime, fullFormat, true, options.timezone || 'UTC');
    if (m.isValid()) {
      return m.valueOf() / 1000;
    }
  }
  return null;
}

/**
 * Similar to parseDate, with these differences:
 * - Only for a date (no time part)
 * - Only falls back to UNAMBIGUOUS_FORMATS, not the full PARSER_FORMATS
 * - Optionally adds all dates which match some format to `results`, otherwise returns first match.
 * This is safer so it can be used for parsing when pasting a large number of dates
 * and won't silently swap around day and month.
 */
export function parseDateStrict(
  date: string, dateFormat: string | null, results?: Set<number>, timezone: string = 'UTC'
): number | undefined {
  if (!date) {
    return;
  }
  const dateFormats = [];
  if (dateFormat) {
    dateFormats.push(..._buildVariations(dateFormat, date));
  }
  dateFormats.push(...UNAMBIGUOUS_FORMATS);
  const cleanDate = date.replace(SEPARATORS, ' ').trim();
  for (const format of dateFormats) {
    const m = moment.tz(cleanDate, format, true, timezone);
    if (m.isValid()) {
      const value = m.valueOf() / 1000;
      if (results) {
        results.add(value);
      } else {
        return value;
      }
    }
  }
}

export function parseDateTime(dateTime: string, options: ParseOptions): number | undefined {
  dateTime = dateTime.trim();
  if (!dateTime) {
    return;
  }

  const dateFormat = options.dateFormat || null;
  const timezone = options.timezone || "UTC";

  const dateOnly = parseDateStrict(dateTime, dateFormat, undefined, timezone);
  if (dateOnly) {
    return dateOnly;
  }

  const parsedTimeZone = parseTimeZone(dateTime, timezone);
  let tzOffset = '';
  if (parsedTimeZone) {
    tzOffset = parsedTimeZone.tzOffset;
    dateTime = parsedTimeZone.remaining;
  }

  const parsedTime = standardizeTime(dateTime);
  if (!parsedTime) {
    return;
  }

  dateTime = parsedTime.remaining;
  const date = parseDateStrict(dateTime, dateFormat);

  if (!date) {
    return;
  }

  // date is a timestamp of midnight in UTC, so to get a formatted representation (for parsing
  // together with time), take care to interpret it in UTC.
  const dateString = moment.unix(date).utc().format("YYYY-MM-DD");
  dateTime = dateString + ' ' + parsedTime.time + tzOffset;
  const fullFormat = "YYYY-MM-DD HH:mm:ss" + (tzOffset ? 'Z' : '');
  return moment.tz(dateTime, fullFormat, true, timezone).valueOf() / 1000;
}


// Helper function to get the partial format string based on the input. Momentjs has a feature
// which allows defaulting to the current year, month and/or day if not accounted for in the
// parser. We remove any parts of the parser not given in the input to take advantage of this
// feature.
function _getPartialFormat(input: string, format: string): string {
  // Define a regular expression to match contiguous non-separators.
  const re = /Y+|M+o?|D+o?|[a-zA-Z0-9]+/ig;
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
function _buildVariations(dateFormat: string, date: string) {
  // Momentjs has an undesirable feature in strict mode where MM and DD
  // matches require two digit numbers. Change MM, DD to M, D.
  let format = dateFormat.replace(/MM+/g, m => (m === 'MM' ? 'M' : m))
    .replace(/DD+/g, m => (m === 'DD' ? 'D' : m))
    .replace(SEPARATORS, ' ')
    .trim();

  // Allow the input date to end with a 4-digit year even if the format doesn't mention the year
  if (
    format.includes("M") &&
    format.includes("D") &&
    !format.includes("Y")
  ) {
    format += " YYYY";
  }

  format = _getPartialFormat(date, format);

  // Consider some alternatives to the preferred format.
  const variations = new Set<string>([format]);
  const otherYear = format.replace(/Y{2,4}/, (m) => (m === 'YY' ? 'YYYY' : (m === 'YYYY' ? 'YY' : m)));
  variations.add(otherYear);
  variations.add(format.replace(/MMM+/, 'M'));
  if (otherYear !== format) {
    variations.add(otherYear.replace(/MMM+/, 'M'));
  }
  return variations;
}


// Based on private calculateOffset in moment source code.
function calculateOffset(tzMatch: string[]): string {
  const [, hhOffset, mmOffset] = tzMatch;
  const sign = hhOffset.slice(0, 1);
  return sign + hhOffset.slice(1).padStart(2, '0') + ':' + (mmOffset || '0').padStart(2, '0');
}

function parseTimeZone(str: string, timezone: string): { remaining: string, tzOffset: string } {
  str = str.trim();

  let tzMatch = UTC_REGEX.exec(str);
  let matchStart = 0;
  let tzOffset = '';
  if (tzMatch) {
    tzOffset = '+00:00';
    matchStart = tzMatch.index + 1;  // skip [^a-zA-Z] at regex start
  } else {
    tzMatch = NUMERIC_TZ_REGEX.exec(str);
    if (tzMatch) {
      tzOffset = calculateOffset(tzMatch);
      matchStart = tzMatch.index;
    } else if (timezone) {
      // Abbreviations are simply stripped and ignored, so tzOffset is not set in this case
      tzMatch = tzAbbreviations(timezone).exec(str);
      if (tzMatch) {
        matchStart = tzMatch.index + 1;  // skip [^a-zA-Z] at regex start
      }
    }
  }

  if (tzMatch) {
    str = str.slice(0, matchStart).trim();
  }

  return {remaining: str, tzOffset};
}

// Parses time of the form, roughly, HH[:MM[:SS]][am|pm]. Returns the time in the
// standardized HH:mm:ss format.
// This turns out easier than coaxing moment to parse time sensibly and flexibly.
function standardizeTime(timeString: string): { remaining: string, time: string } | undefined {
  const match = TIME_REGEX.exec(timeString);
  if (!match) {
    return;
  }
  let hours = parseInt(match[1] || match[4], 10);
  const mm = (match[2] || match[5] || '0').padStart(2, '0');
  const ss = (match[3] || '0').padStart(2, '0');
  const ampm = (match[6] || '').toLowerCase();
  if (hours < 12 && hours > 0 && ampm.startsWith('p')) {
    hours += 12;
  } else if (hours === 12 && ampm.startsWith('a')) {
    hours = 0;
  }
  const hh = String(hours).padStart(2, '0');
  return {remaining: timeString.slice(0, match.index).trim(), time: `${hh}:${mm}:${ss}`};
}
