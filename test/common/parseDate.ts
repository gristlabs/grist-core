/* global describe, it */
import {guessDateFormat, guessDateFormats, parseDate, parseDateStrict, parseDateTime} from 'app/common/parseDate';
import {assert} from 'chai';
import * as moment from 'moment-timezone';

const today = new Date();
const year = today.getUTCFullYear();
const month = String(today.getUTCMonth() + 1).padStart(2, '0');

/**
 * Assert that parseDate and parseDateStrict parse `input` correctly,
 * returning a date that looks like expectedDateStr in ISO format.
 * parseDate should always produce a parsed date from `input`.
 * parseDateStrict should return at most one date, i.e. the formats it tries shouldn't allow ambiguity.
 *
 * fallback=true indicates the date cannot be parsed strictly with the given format
 * so parseDate has to fallback to another format and parseDateStrict gives no results.
 *
 * Otherwise, parseDateStrict should return a result
 * unless no dateFormat is given in which case it may or may not.
 */
function testParse(dateFormat: string|null, input: string, expectedDateStr: string|null, fallback: boolean = false) {
  assertDateEqual(parseDate(input, dateFormat ? {dateFormat} : {}), expectedDateStr);

  const strict = new Set<number>();
  parseDateStrict(input, dateFormat, strict);
  assert.include([0, 1], strict.size);

  // fallback=true indicates the date cannot be parsed strictly with the given format
  // so it has to fallback to another format.
  if (fallback) {
    assert.isEmpty(strict);
  } else if (dateFormat) {
    assert.equal(strict.size, 1);
  }

  if (strict.size) {
    const strictParsed = [...strict][0];
    assertDateEqual(strictParsed, expectedDateStr);
    assertDateEqual(parseDateTime(input, dateFormat ? {dateFormat} : {})!, expectedDateStr);
  }
}

function assertDateEqual(parsed: number|null, expectedDateStr: string|null) {
  const formatted = parsed === null ? null : new Date(parsed * 1000).toISOString().slice(0, 10);
  assert.equal(formatted, expectedDateStr);
}

function testTimeParse(input: string, expectedUTCTimeStr: string | null, timezone?: string) {
  const parsed1 = parseDateTime('1993-04-02T' + input,
    {timeFormat: 'Z', timezone, dateFormat: 'YYYY-MM-DD'}) || null;
  const parsed2 = parseDate('1993-04-02', {time: input, timeFormat: 'UNUSED', timezone});
  for (const parsed of [parsed1, parsed2]) {
    if (expectedUTCTimeStr === null) {
      assert.isNull(parsed);
      return;
    }
    const output = new Date(parsed! * 1000).toISOString().slice(11, 19);
    assert.equal(output, expectedUTCTimeStr, `testTimeParse(${input}, ${timezone})`);
  }
}

function testDateTimeParse(
  date: string, time: string, expectedUTCTimeStr: string | null, timezone: string, dateFormat?: string
) {
  const parsed1 = parseDateTime(date + ' ' + time,
    {timeFormat: 'Z', timezone, dateFormat: dateFormat || 'YYYY-MM-DD'}) || null;

  // This is for testing the combination of date and time which is important when daylight savings is involved
  const parsed2 = parseDate(date, {time, timeFormat: 'UNUSED', timezone, dateFormat});

  for (const parsed of [parsed1, parsed2]) {
    if (expectedUTCTimeStr === null) {
      assert.isNull(parsed);
      return;
    }
    const output = new Date(parsed! * 1000).toISOString().slice(0, 19).replace("T", " ");
    assert.equal(output, expectedUTCTimeStr);
  }
}

function testDateTimeStringParse(
  dateTime: string, expectedUTCTimeStr: string | null, dateFormat: string, timezone?: string,
) {
  const parsed = parseDateTime(dateTime, {timezone, dateFormat});

  if (expectedUTCTimeStr === null) {
    assert.isUndefined(parsed);
    return;
  }
  const output = new Date(parsed! * 1000).toISOString().slice(0, 19).replace("T", " ");
  assert.equal(output, expectedUTCTimeStr);
}

describe('parseDate', function() {
  this.timeout(5000);
  this.slow(50);

  it('should allow parsing common date formats', function() {
    testParse(null, 'November 18th, 1994',  '1994-11-18');
    testParse(null, 'nov 18 1994',          '1994-11-18');
    testParse(null, '11-18-94',             '1994-11-18');
    testParse(null, '11-18-1994',           '1994-11-18');
    testParse(null, '1994-11-18',           '1994-11-18');
    testParse(null, 'November 18, 1994',    '1994-11-18');
    testParse('DD/MM/YY', '18/11/94',       '1994-11-18');
    // fallback format is used because 18 is not a valid month
    testParse('MM/DD/YY', '18/11/94',       '1994-11-18', true);

    testParse(null,       '18/11/94',       '1994-11-18');
    testParse(null,       '12/11/94',       '1994-12-11');
    testParse('DD/MM/YY', '12/11/94',       '1994-11-12');
    testParse('MM/DD/YY', '11/12/94',       '1994-11-12');

    testParse(null, '25', `${year}-${month}-25`);
    testParse(null, '10', `${year}-${month}-10`);
    testParse('DD/MM/YY', '10', `${year}-${month}-10`);
    testParse('DD/MM/YY', '3/4', `${year}-04-03`);
    // Separators in the format should not affect the parsing (for better or worse).
    testParse('YY-DD/MM', '3/4', `${year}-04-03`);
    testParse('YY/DD-MM', '3/4', `${year}-04-03`);
    testParse('MM/DD/YY', '3/4', `${year}-03-04`);
    testParse('YY/MM/DD', '3/4', `${year}-03-04`);
    testParse(null, '3/4', `${year}-03-04`);

    // Single number gets parse according to the most specific item in the format string.
    testParse('DD',     '10',   `${year}-${month}-10`);
    testParse('DD/MM',  '10',   `${year}-${month}-10`);
    testParse('MM',     '10',   `${year}-10-01`);
    testParse('MM/YY',  '10',   `${year}-10-01`);
    testParse('MMM',    '10',   `${year}-10-01`);
    testParse('YY',     '10',   `2010-01-01`);
    testParse('YYYY',   '10',   `2010-01-01`);

    testParse('YY',   '05',     `2005-01-01`);
    testParse('YY',   '5',      `${year}-05-01`, true);   // Not a valid year, so falls back to "M" format
    testParse('YYYY', '1910',   `1910-01-01`);
    testParse('YY',   '3/4',    `${year}-03-04`, true);   // Falls back to another format
    testParse('DD/MM', '3/4',   `${year}-04-03`);
    testParse('MM/YY', '3/04',  `2004-03-01`);
    testParse('MM/YY', '3/4',   `${year}-03-04`, true);   // Not a valid year, so falls back to "M/D" format

    testParse(null, '4/2/93',           '1993-04-02');
    testParse(null, '04-02-1993',       '1993-04-02');
    testParse(null, '4-02-93',          '1993-04-02');
    testParse(null, 'April 2nd, 1993',  '1993-04-02');

    testParse('DD MMM YY',   '15-Jan 99',   '1999-01-15');
    testParse('DD MMM YYYY', '15-Jan 1999', '1999-01-15');
    testParse('DD MMM',      '15-Jan 1999', '1999-01-15');

    testParse('MMMM Do, YYYY', 'April 2nd, 1993',  '1993-04-02');
    testParse('MMM Do YYYY', 'Apr 2nd 1993',  `1993-04-02`);
    testParse('Do MMMM YYYY', '2nd April 1993',  `1993-04-02`);
    testParse('Do MMM YYYY', '2nd Apr 1993',  `1993-04-02`);
    testParse('MMMM D, YYYY', 'April 2, 1993',  '1993-04-02');
    testParse('MMM D YYYY', 'Apr 2 1993',  `1993-04-02`);
    testParse('D MMMM YYYY', '2 April 1993',  `1993-04-02`);
    testParse('D MMM YYYY', '2 Apr 1993',  `1993-04-02`);
    testParse('MMMM Do, ', 'April 2nd, 1993',  '1993-04-02');
    testParse('MMM Do ', 'Apr 2nd 1993',  `1993-04-02`);
    testParse('Do MMMM ', '2nd April 1993',  `1993-04-02`);
    testParse('Do MMM ', '2nd Apr 1993',  `1993-04-02`);
    testParse('MMMM D, ', 'April 2, 1993',  '1993-04-02');
    testParse('MMM D ', 'Apr 2 1993',  `1993-04-02`);
    testParse('D MMMM ', '2 April 1993',  `1993-04-02`);
    testParse('D MMM ', '2 Apr 1993',  `1993-04-02`);
    testParse('MMMM Do, ', 'April 2nd',  `${year}-04-02`);
    testParse('MMM Do ', 'Apr 2nd',  `${year}-04-02`);
    testParse('Do MMMM ', '2nd April',  `${year}-04-02`);
    testParse('Do MMM ', '2nd Apr',  `${year}-04-02`);
    testParse('MMMM D, ', 'April 2',  `${year}-04-02`);
    testParse('MMM D ', 'Apr 2',  `${year}-04-02`);
    testParse('D MMMM ', '2 April',  `${year}-04-02`);
    testParse('D MMM ', '2 Apr',  `${year}-04-02`);

    // Test the combination of Do and YY, which was buggy at one point.
    testParse('MMMM Do, YY', 'April 2nd, 93',  '1993-04-02');
    testParse('MMM Do, YY', 'Apr 2nd, 93',  '1993-04-02');
    testParse('Do MMMM YY', '2nd April 93',  `1993-04-02`);
    testParse('Do MMM YY', '2nd Apr 93',  `1993-04-02`);

    testParse('  D   MMM   ', ' 2  Apr ',  `${year}-04-02`);
    testParse('D MMM', ' 2  Apr ',  `${year}-04-02`);
    testParse('  D   MMM   ', '2 Apr',  `${year}-04-02`);

    testParse(null, '  11-18-94     ',       '1994-11-18');
    testParse('   DD   MM   YY', '18/11/94', '1994-11-18');
  });

  it('should allow parsing common date-time formats', function() {
    // These are the test cases from before.
    testTimeParse('22:18:04', '22:18:04');
    testTimeParse('8pm',      '20:00:00');
    testTimeParse('22:18:04', '22:18:04', 'UTC');
    testTimeParse('22:18:04', '03:18:04', 'America/New_York');
    testTimeParse('22:18:04', '06:18:04', 'America/Los_Angeles');
    testTimeParse('22:18:04', '13:18:04', 'Japan');

    // Weird time formats are no longer parsed
    // testTimeParse('HH-mm',    '1-15',     '01:15:00');
    // testTimeParse('ss mm HH', '4 23 3',   '03:23:04');

    // The current behavior parses any standard-like format (with HH:MM:SS components in the usual
    // order) regardless of the format requested.

    // Test a few variations of spelling AM/PM.
    for (const [am, pm] of [['A', ' p'], ['  am', 'pM'], ['AM', ' PM']]) {
      testTimeParse('1', '01:00:00');
      testTimeParse('1' + am, '01:00:00');
      testTimeParse('1' + pm, '13:00:00');
      testTimeParse('22', '22:00:00');
      testTimeParse('22' + am, '22:00:00');   // Best guess for 22am/22pm is 22:00.
      testTimeParse('22' + pm, '22:00:00');
      testTimeParse('0', '00:00:00');
      testTimeParse('0' + am, '00:00:00');
      testTimeParse('0' + pm, '00:00:00');
      testTimeParse('12', '12:00:00');        // 12:00 is more likely 12pm than 12am
      testTimeParse('12' + am, '00:00:00');
      testTimeParse('12' + pm, '12:00:00');
      testTimeParse('9:8', '09:08:00');
      testTimeParse('9:8' + am, '09:08:00');
      testTimeParse('9:8' + pm, '21:08:00');
      testTimeParse('09:08', '09:08:00');
      testTimeParse('09:08' + am, '09:08:00');
      testTimeParse('09:08' + pm, '21:08:00');
      testTimeParse('21:59', '21:59:00');
      testTimeParse('21:59' + am, '21:59:00');
      testTimeParse('21:59' + pm, '21:59:00');
      testTimeParse('10:18:04', '10:18:04');
      testTimeParse('10:18:04' + am, '10:18:04');
      testTimeParse('10:18:04' + pm, '22:18:04');
      testTimeParse('22:18:04', '22:18:04');
      testTimeParse('22:18:04' + am, '22:18:04');
      testTimeParse('22:18:04' + pm, '22:18:04');
      testTimeParse('12:18:04', '12:18:04');
      testTimeParse('12:18:04' + am, '00:18:04');
      testTimeParse('12:18:04' + pm, '12:18:04');
      testTimeParse('908', '09:08:00');
      testTimeParse('0910', '09:10:00');
      testTimeParse('2112', '21:12:00');
    }

    // Tests with time zones.
    testTimeParse('09:08', '09:08:00', 'UTC');
    testTimeParse('09:08', '14:08:00', 'America/New_York');
    testTimeParse('09:08', '00:08:00', 'Japan');
    testTimeParse('09:08 Z', '09:08:00');
    testTimeParse('09:08z', '09:08:00');
    testTimeParse('09:08 UT', '09:08:00');
    testTimeParse('09:08 UTC', '09:08:00');
    testTimeParse('09:08-05', '14:08:00');
    testTimeParse('09:08-5', '14:08:00');
    testTimeParse('09:08-0500', '14:08:00');
    testTimeParse('09:08-05:00', '14:08:00');
    testTimeParse('09:08-500', '14:08:00');
    testTimeParse('09:08-5:00', '14:08:00');
    testTimeParse('09:08+05', '04:08:00');
    testTimeParse('09:08+5', '04:08:00');
    testTimeParse('09:08+0500', '04:08:00');
    testTimeParse('09:08+5:00', '04:08:00');
    testTimeParse('09:08+05:00', '04:08:00');
  });

  it('should handle timezone abbreviations', function() {
    // New York can be abbreviated as EDT or EST depending on the time of year for daylight savings.
    // We ignore the abbreviation so it's parsed the same whichever is used.
    // However the parsed UTC time depends on the date.
    testDateTimeParse('2020-02-02', '09:45 edt', '2020-02-02 14:45:00', 'America/New_York');
    testDateTimeParse('2020-10-10', '09:45 edt', '2020-10-10 13:45:00', 'America/New_York');
    testDateTimeParse('2020-02-02', '09:45 est', '2020-02-02 14:45:00', 'America/New_York');
    testDateTimeParse('2020-10-10', '09:45 est', '2020-10-10 13:45:00', 'America/New_York');
    // Spaces and case shouldn't matter.
    testDateTimeParse('2020-10-10', '09:45 EST', '2020-10-10 13:45:00', 'America/New_York');
    testDateTimeParse('2020-10-10', '09:45EST', '2020-10-10 13:45:00', 'America/New_York');
    testDateTimeParse('2020-10-10', '09:45EDT', '2020-10-10 13:45:00', 'America/New_York');

    // Testing that AEDT is rejected in the New York timezone even though it ends with EDT which is valid.
    testTimeParse('09:45:00 aedt', null, 'America/New_York');
    testTimeParse('09:45:00AEDT',  null, 'America/New_York');
    testTimeParse('09:45:00 aedt', '23:45:00', 'Australia/ACT');
    testTimeParse('09:45:00AEDT',  '23:45:00', 'Australia/ACT');

    // Testing multiple abbreviations of US/Pacific
    testDateTimeParse('2020-02-02', '09:45 PST', null, 'America/New_York');
    testDateTimeParse('2020-02-02', '09:45 PST', '2020-02-02 17:45:00', 'US/Pacific');
    testDateTimeParse('2020-10-10', '09:45 PST', '2020-10-10 16:45:00', 'US/Pacific');
    testDateTimeParse('2020-02-02', '09:45 PDT', '2020-02-02 17:45:00', 'US/Pacific');
    testDateTimeParse('2020-10-10', '09:45 PDT', '2020-10-10 16:45:00', 'US/Pacific');
    // PWT and PPT are some obscure abbreviations apparently used at some time and thus supported by moment
    testDateTimeParse('2020-10-10', '09:45 PWT', '2020-10-10 16:45:00', 'US/Pacific');
    testDateTimeParse('2020-10-10', '09:45 PPT', '2020-10-10 16:45:00', 'US/Pacific');
    // POT is not valid
    testDateTimeParse('2020-10-10', '09:45 POT', null, 'US/Pacific');

    // Both these timezones have CST and CDT, but not COT.
    // The timezones are far apart so the parsed UTC times are too.
    testTimeParse('09:45 CST', '01:45:00', 'Asia/Shanghai');
    testTimeParse('09:45 CDT', '01:45:00', 'Asia/Shanghai');
    testTimeParse('09:45 CST', '15:45:00', 'Canada/Central');
    testTimeParse('09:45 CDT', '15:45:00', 'Canada/Central');
    testTimeParse('09:45 COT', null, 'Asia/Shanghai');
    testTimeParse('09:45 COT', null, 'Canada/Central');
  });

  it('should parse datetime strings', function() {
    for (const separator of [' ', 'T']) {
      for (let tz of ['Z', 'UTC', '+00:00', '-00', '']) {
        for (const tzSeparator of ['', ' ']) {
          tz = tzSeparator + tz;

          let expected = '2020-03-04 12:34:56';
          testDateTimeStringParse(
            ` 2020-03-04${separator}12:34:56${tz} `, expected, 'YYYY-MM-DD'
          );
          testDateTimeStringParse(
            ` 03-04-2020${separator}12:34:56${tz} `, expected, 'MM/DD/YYYY'
          );
          testDateTimeStringParse(
            ` 04-03-20${separator}12:34:56${tz} `, expected, 'DD-MM-YY'
          );
          testDateTimeStringParse(
            ` 2020-03-04${separator}12:34:56${tz} `, expected, '',
          );
          expected = '2020-03-04 12:34:00';
          testDateTimeStringParse(
            ` 04-03-20${separator}12:34${tz} `, expected, 'DD-MM-YY'
          );
        }
      }
    }
  });

  it('should handle datetimes as formatted by moment', function() {
    this.timeout(10000);  // there may be a LOT of timezone names.
    for (const date of ['2020-02-03', '2020-06-07', '2020-10-11']) {  // different months for daylight savings
      const dateTime = date + ' 12:34:56';
      const utcMoment = moment.tz(dateTime, 'UTC');
      for (const dateFormat of ['DD/MM/YY', 'MM/DD/YY']) {
        for (const tzFormat of ['z', 'Z']) {  // abbreviation (z) vs +/-HH:MM (Z)
          assert.isTrue(utcMoment.isValid());
          for (const tzName of moment.tz.names()) {
            const tzMoment = moment.tz(utcMoment, tzName);
            const formattedTime = tzMoment.format('HH:mm:ss ' + tzFormat);
            const formattedDate = tzMoment.format(dateFormat);
            testDateTimeParse(formattedDate, formattedTime, dateTime, tzName, dateFormat);
          }
        }
      }
    }
  });

  it('should be flexible in parsing the preferred format', function() {
    for (const format of ['DD-MM-YYYY', 'DD-MM-YY', 'DD-MMM-YYYY', 'DD-MMM-YY']) {
      testParse(format, '1/2/21',     '2021-02-01');
      testParse(format, '01/02/2021', '2021-02-01');
      testParse(format, '1-02-21',    '2021-02-01');
    }

    for (const format of ['MM-DD-YYYY', 'MM-DD-YY', 'MMM-DD-YYYY', 'MMM-DD-YY']) {
      testParse(format, '1/2/21',     '2021-01-02');
      testParse(format, '01/02/2021', '2021-01-02');
      testParse(format, '1-02-21',    '2021-01-02');
    }

    for (const format of ['YY-MM-DD', 'YYYY-MM-DD', 'YY-MMM-DD', 'YYYY-MMM-DD']) {
      testParse(format, '01/2/3',     '2001-02-03');
      testParse(format, '2001/02/03', '2001-02-03');
      testParse(format, '01-02-03',   '2001-02-03');
      testParse(format, '10/11',      `${year}-10-11`);
      testParse(format, '2/3',        `${year}-02-03`);
      testParse(format, '12',         `${year}-${month}-12`);
    }

    testParse('DD MMM YYYY', '1 FEB 2021', '2021-02-01');
    testParse('DD MMM YYYY', '1-feb-21',   '2021-02-01');
    testParse('DD MMM YYYY', '1/2/21',     '2021-02-01');
    testParse('DD MMM YYYY', '01/02/2021', '2021-02-01');
    testParse('DD MMM YYYY', '1-02-21',    '2021-02-01');
    testParse('DD MMM YYYY', '1 2',        `${year}-02-01`);
    testParse('DD MMM YYYY', '1 feb',      `${year}-02-01`);

    testParse('DD MMM', '1 FEB 2021', '2021-02-01');
    testParse('DD MMM', '1-feb-2021', '2021-02-01');
    testParse('DD MMM', '1/2/2021',   '2021-02-01');
    testParse('DD MMM', '01/02/2021', '2021-02-01');
    testParse('DD MMM', '1-02-2021',  '2021-02-01');
    testParse('DD MMM', '1 2 2021',   `2021-02-01`);
    testParse('DD MMM', '1 feb 2021', `2021-02-01`);
  });

  it('should support underscores as separators', async function() {
    testParse('DD_MM_YY', '3/4',      `${year}-04-03`);
    testParse('DD_MM_YY', '3_4',      `${year}-04-03`);
    testParse('DD_MM_YY', '3_4_98',   `1998-04-03`);
    testParse('DD/MM/YY', '3_4_98',   `1998-04-03`);
  });

  it('should interpret two-digit years as bootstrap datepicker does', function() {
    const yy = year % 100;
    // These checks are expected to work as long as today's year is between 2021 and 2088.
    testParse('MM-DD-YY', `1/2/${yy}`, `20${yy}-01-02`);
    testParse('MM-DD-YY', `1/2/${yy + 9}`, `20${yy + 9}-01-02`);
    testParse('MM-DD-YY', `1/2/${yy + 11}`, `19${yy + 11}-01-02`);
    // These should work until 2045 (after that 55 would be interpreted as 2055).
    testParse('MM-DD-YY', `1/2/00`, `2000-01-02`);
    testParse('MM-DD-YY', `1/2/08`, `2008-01-02`);
    testParse('MM-DD-YY', `1/2/20`, `2020-01-02`);
    testParse('MM-DD-YY', `1/2/30`, `2030-01-02`);
    testParse('MM-DD-YY', `1/2/55`, `1955-01-02`);
    testParse('MM-DD-YY', `1/2/79`, `1979-01-02`);
    testParse('MM-DD-YY', `1/2/98`, `1998-01-02`);
  });

  it('should parse timestamps as dates', function() {
    testParse(null,   '123456789', '1973-11-29');
    testParse(null,   '100000000', '1973-03-03');
    testParse(null,  '1000000000', '2001-09-09');
    testParse(null, '10000000000', null);

    testParse(null,   '20230926', null);
    testParse(null, '12345678', null);
    testParse(null, '-1000000', null);
    testParse(null, '-9999999', null);
    testParse(null, '123456789.0', null);
    testParse(null,  '-100000000', null);

    testParse(null, '100000000000', null);
    testParse(null, '1000000000000', null);

    // Test exact times.
    assert.equal(parseDate( '123456789'), 123456789);
    assert.equal(parseDate( '100000000'), 100000000);

    // Now those that don't fit into our format.
    assert.isNull(parseDate('1234567'));
    assert.isNull(parseDate('-999999'));
    assert.isNull(parseDate('12345678.0'));
    assert.isNull(parseDate('-100000000'));
    assert.isNull(parseDate('100000000000'));
    assert.isNull(parseDate('1000000000000'));
  });

  describe('guessDateFormat', function() {
    it('should guess date formats', function() {
      // guessDateFormats with an *s* shows all the equally likely guesses.
      // It's only directly used in tests, just to reveal the inner workings.
      // guessDateFormat picks one of those formats which is actually used in type conversion etc.

      // ISO YYYY-MM-DD is king
      assert.deepEqual(guessDateFormats(["2020-01-02"]), ["YYYY-MM-DD"]);
      assert.deepEqual(guessDateFormat(["2020-01-02"]), "YYYY-MM-DD");

      // Some ambiguous dates
      assert.deepEqual(guessDateFormats(["01/01/2020"]), ["DD/MM/YYYY", "MM/DD/YYYY"]);
      assert.deepEqual(guessDateFormats(["01/02/03"]), ['DD/MM/YY', 'MM/DD/YY', 'YY/MM/DD']);
      assert.deepEqual(guessDateFormats(["01-01-2020"]), ["DD-MM-YYYY", "MM-DD-YYYY"]);
      assert.deepEqual(guessDateFormats(["01-02-03"]), ['DD-MM-YY', 'MM-DD-YY', 'YY-MM-DD']);
      assert.deepEqual(guessDateFormat(["01/01/2020"]), "MM/DD/YYYY");
      assert.deepEqual(guessDateFormat(["01/02/03"]), 'YY/MM/DD');
      assert.deepEqual(guessDateFormat(["01-01-2020"]), "MM-DD-YYYY");
      assert.deepEqual(guessDateFormat(["01-02-03"]), 'YY-MM-DD');

      // Ambiguous date with only two parts
      assert.deepEqual(guessDateFormats(["01/02"]), ["DD/MM", "MM/DD", "YY/MM"]);
      assert.deepEqual(guessDateFormat(["01/02"]), "YY/MM");

      // First date is ambiguous, second date makes the guess unambiguous.
      assert.deepEqual(guessDateFormats(["01/01/2020", "20/01/2020"]), ["DD/MM/YYYY"]);
      assert.deepEqual(guessDateFormats(["01/01/2020", "01/20/2020"]), ["MM/DD/YYYY"]);
      assert.deepEqual(guessDateFormat(["01/01/2020", "20/01/2020"]), "DD/MM/YYYY");
      assert.deepEqual(guessDateFormat(["01/01/2020", "01/20/2020"]), "MM/DD/YYYY");

      // Not a date at all, guess YYYY-MM-DD as the default.
      assert.deepEqual(guessDateFormats(["foo bar"]), null);
      assert.deepEqual(guessDateFormat(["foo bar"]), "YYYY-MM-DD");
    });
  });
});
