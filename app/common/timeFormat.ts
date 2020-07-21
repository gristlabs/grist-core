/**
 * timeFormat(format, date) formats the passed-in Date object using the format string. The format
 * string may contain the following:
 *    'h': hour (00 - 23)
 *    'm': minute (00 - 59)
 *    's': second (00 - 59)
 *    'd': day of the month (01 - 31)
 *    'n': month (01 - 12)
 *    'y': 4-digit year
 *    'M': milliseconds (000 - 999)
 *    'Y': date as 20140212
 *    'D': date as 2014-02-12
 *    'T': time as 00:51:06
 *    'A': full time and date, as 2014-02-12 00:51:06.123
 * @param {String} format The format string.
 * @param {Date} date The date/time object to format.
 * @returns {String} The formatted date and/or time.
 */

function pad(num: number, len: number): string {
  const s = num.toString();
  return s.length >= len ? s : "00000000".slice(0, len - s.length) + s;
}

type FormatHelper = (out: string[], date: Date) => void;
const timeFormatKeys: {[spec: string]: FormatHelper} = {
  h: (out, date) => out.push(pad(date.getHours(), 2)),
  m: (out, date) => out.push(pad(date.getMinutes(), 2)),
  s: (out, date) => out.push(pad(date.getSeconds(), 2)),
  d: (out, date) => out.push(pad(date.getDate(), 2)),
  n: (out, date) => out.push(pad(date.getMonth() + 1, 2)),
  y: (out, date) => out.push("" + date.getFullYear()),
  M: (out, date) => out.push(pad(date.getMilliseconds(), 3)),
  Y: (out, date) => timeFormatHelper(out, 'ynd', date),
  D: (out, date) => timeFormatHelper(out, 'y-n-d', date),
  T: (out, date) => timeFormatHelper(out, 'h:m:s', date),
  A: (out, date) => timeFormatHelper(out, 'D T.M', date),
};

function timeFormatHelper(out: string[], format: string, date: Date) {
  for (let i = 0, len = format.length; i < len; i++) {
    const c = format[i];
    const helper = timeFormatKeys[c];
    if (helper) {
      helper(out, date);
    } else {
      out.push(c);
    }
  }
}

export function timeFormat(format: string, date: Date): string {
  const out: string[] = [];
  timeFormatHelper(out, format, date);
  return out.join("");
}
