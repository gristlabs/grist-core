# -*- coding: utf-8 -*-
import calendar
import datetime
import dateutil.parser
import six

import moment
import docmodel

# pylint: disable=no-member

_excel_date_zero = datetime.datetime(1899, 12, 30)


def _make_datetime(value):
  if isinstance(value, datetime.datetime):
    return value
  elif isinstance(value, datetime.date):
    return datetime.datetime.combine(value, datetime.time())
  elif isinstance(value, datetime.time):
    return datetime.datetime.combine(datetime.date.today(), value)
  elif isinstance(value, six.string_types):
    return dateutil.parser.parse(value)
  else:
    raise ValueError('Invalid date %r' % (value,))

def _get_global_tz():
  # If doc_info record is missing (e.g. in tests), default to UTC. We should not return None,
  # since that would produce naive datetime objects, which is not what we want.
  dm = docmodel.global_docmodel
  return (dm.doc_info.lookupOne(id=1).tzinfo if dm else None) or moment.TZ_UTC

def _get_tzinfo(zonelabel):
  """
  A helper that returns a `datetime.tzinfo` instance for zonelabel. Returns the global
  document timezone if zonelabel is None.
  """
  return moment.tzinfo(zonelabel) if zonelabel else _get_global_tz()

def DTIME(value, tz=None):
  """
  Returns the value converted to a python `datetime` object. The value may be a
  `string`, `date` (interpreted as midnight on that day), `time` (interpreted as a
  time-of-day today), or an existing `datetime`.

  The returned `datetime` will have its timezone set to the `tz` argument, or the
  document's default timezone when `tz` is omitted or None. If the input is itself a
  `datetime` with the timezone set, it is returned unchanged (no changes to its timezone).

  >>> DTIME(datetime.date(2017, 1, 1))
  datetime.datetime(2017, 1, 1, 0, 0, tzinfo=moment.tzinfo('America/New_York'))
  >>> DTIME(datetime.date(2017, 1, 1), 'Europe/Paris')
  datetime.datetime(2017, 1, 1, 0, 0, tzinfo=moment.tzinfo('Europe/Paris'))
  >>> DTIME(datetime.datetime(2017, 1, 1))
  datetime.datetime(2017, 1, 1, 0, 0, tzinfo=moment.tzinfo('America/New_York'))
  >>> DTIME(datetime.datetime(2017, 1, 1, tzinfo=moment.tzinfo('UTC')))
  datetime.datetime(2017, 1, 1, 0, 0, tzinfo=moment.tzinfo('UTC'))
  >>> DTIME(datetime.datetime(2017, 1, 1, tzinfo=moment.tzinfo('UTC')), 'Europe/Paris')
  datetime.datetime(2017, 1, 1, 0, 0, tzinfo=moment.tzinfo('UTC'))
  >>> DTIME("1/1/2008")
  datetime.datetime(2008, 1, 1, 0, 0, tzinfo=moment.tzinfo('America/New_York'))
  """
  value = _make_datetime(value)
  return value if value.tzinfo else value.replace(tzinfo=_get_tzinfo(tz))


def XL_TO_DATE(value, tz=None):
  """
  Converts a provided Excel serial number representing a date into a `datetime` object.
  Value is interpreted as the number of days since December 30, 1899.

  (This corresponds to Google Sheets interpretation. Excel starts with Dec. 31, 1899 but wrongly
  considers 1900 to be a leap year. Excel for Mac should be configured to use 1900 date system,
  i.e. uncheck "Use the 1904 date system" option.)

  The returned `datetime` will have its timezone set to the `tz` argument, or the
  document's default timezone when `tz` is omitted or None.

  >>> XL_TO_DATE(41100.1875)
  datetime.datetime(2012, 7, 10, 4, 30, tzinfo=moment.tzinfo('America/New_York'))
  >>> XL_TO_DATE(39448)
  datetime.datetime(2008, 1, 1, 0, 0, tzinfo=moment.tzinfo('America/New_York'))
  >>> XL_TO_DATE(40982.0625)
  datetime.datetime(2012, 3, 14, 1, 30, tzinfo=moment.tzinfo('America/New_York'))

  More tests:
  >>> XL_TO_DATE(0)
  datetime.datetime(1899, 12, 30, 0, 0, tzinfo=moment.tzinfo('America/New_York'))
  >>> XL_TO_DATE(-1)
  datetime.datetime(1899, 12, 29, 0, 0, tzinfo=moment.tzinfo('America/New_York'))
  >>> XL_TO_DATE(1)
  datetime.datetime(1899, 12, 31, 0, 0, tzinfo=moment.tzinfo('America/New_York'))
  >>> XL_TO_DATE(1.5)
  datetime.datetime(1899, 12, 31, 12, 0, tzinfo=moment.tzinfo('America/New_York'))
  >>> XL_TO_DATE(61.0)
  datetime.datetime(1900, 3, 1, 0, 0, tzinfo=moment.tzinfo('America/New_York'))
  """
  return DTIME(_excel_date_zero, tz) + datetime.timedelta(days=value)


def DATE_TO_XL(date_value):
  """
  Converts a Python `date` or `datetime` object to the serial number as used by
  Excel, with December 30, 1899 as serial number 1.

  See XL_TO_DATE for more explanation.

  >>> DATE_TO_XL(datetime.date(2008, 1, 1))
  39448.0
  >>> DATE_TO_XL(datetime.date(2012, 3, 14))
  40982.0
  >>> DATE_TO_XL(datetime.datetime(2012, 3, 14, 1, 30))
  40982.0625

  More tests:
  >>> DATE_TO_XL(datetime.date(1900, 1, 1))
  2.0
  >>> DATE_TO_XL(datetime.datetime(1900, 1, 1))
  2.0
  >>> DATE_TO_XL(datetime.datetime(1900, 1, 1, 12, 0))
  2.5
  >>> DATE_TO_XL(datetime.datetime(1900, 1, 1, 12, 0, tzinfo=moment.tzinfo('America/New_York')))
  2.5
  >>> DATE_TO_XL(datetime.date(1900, 3, 1))
  61.0
  >>> DATE_TO_XL(datetime.datetime(2008, 1, 1))
  39448.0
  >>> DATE_TO_XL(XL_TO_DATE(39488))
  39488.0
  >>> dt_ny = XL_TO_DATE(39488)
  >>> dt_paris = moment.tz(dt_ny, 'America/New_York').tz('Europe/Paris').datetime()
  >>> DATE_TO_XL(dt_paris)
  39488.0
  """
  # If date_value is `naive` it's ok to pass tz to both DTIME as it won't affect the
  # result.
  return (DTIME(date_value) - DTIME(_excel_date_zero)).total_seconds() / 86400.


def DATE(year, month, day):
  """
  Returns the `datetime.datetime` object that represents a particular date.
  The DATE function is most useful in formulas where year, month, and day are formulas, not
  constants.

  If year is between 0 and 1899 (inclusive), adds 1900 to calculate the year.
  >>> DATE(108, 1, 2)
  datetime.date(2008, 1, 2)
  >>> DATE(2008, 1, 2)
  datetime.date(2008, 1, 2)

  If month is greater than 12, rolls into the following year.
  >>> DATE(2008, 14, 2)
  datetime.date(2009, 2, 2)

  If month is less than 1, subtracts that many months plus 1, from the first month in the year.
  >>> DATE(2008, -3, 2)
  datetime.date(2007, 9, 2)

  If day is greater than the number of days in the given month, rolls into the following months.
  >>> DATE(2008, 1, 35)
  datetime.date(2008, 2, 4)

  If day is less than 1, subtracts that many days plus 1, from the first day of the given month.
  >>> DATE(2008, 1, -15)
  datetime.date(2007, 12, 16)

  More tests:
  >>> DATE(1900, 1, 1)
  datetime.date(1900, 1, 1)
  >>> DATE(1900, 0, 0)
  datetime.date(1899, 11, 30)
  """
  if year < 1900:
    year += 1900
  norm_month = (month - 1) % 12 + 1
  norm_year = year + (month - 1) // 12
  return datetime.date(norm_year, norm_month, 1) + datetime.timedelta(days=day - 1)


def DATEDIF(start_date, end_date, unit):
  """
  Calculates the number of days, months, or years between two dates.
  Unit indicates the type of information that you want returned:

    - "Y": The number of complete years in the period.
    - "M": The number of complete months in the period.
    - "D": The number of days in the period.
    - "MD": The difference between the days in start_date and end_date. The months and years of the
      dates are ignored.
    - "YM": The difference between the months in start_date and end_date. The days and years of the
      dates are ignored.
    - "YD": The difference between the days of start_date and end_date. The years of the dates are
      ignored.

  Two complete years in the period (2)
  >>> DATEDIF(DATE(2001, 1, 1), DATE(2003, 1, 1), "Y")
  2

  440 days between June 1, 2001, and August 15, 2002 (440)
  >>> DATEDIF(DATE(2001, 6, 1), DATE(2002, 8, 15), "D")
  440

  75 days between June 1 and August 15, ignoring the years of the dates (75)
  >>> DATEDIF(DATE(2001, 6, 1), DATE(2012, 8, 15), "YD")
  75

  The difference between 1 and 15, ignoring the months and the years of the dates (14)
  >>> DATEDIF(DATE(2001, 6, 1), DATE(2002, 8, 15), "MD")
  14

  More tests:
  >>> DATEDIF(DATE(1969, 7, 16), DATE(1969, 7, 24), "D")
  8
  >>> DATEDIF(DATE(2014, 1, 1), DATE(2015, 1, 1), "M")
  12
  >>> DATEDIF(DATE(2014, 1, 2), DATE(2015, 1, 1), "M")
  11
  >>> DATEDIF(DATE(2014, 1, 1), DATE(2024, 1, 1), "Y")
  10
  >>> DATEDIF(DATE(2014, 1, 2), DATE(2024, 1, 1), "Y")
  9
  >>> DATEDIF(DATE(1906, 10, 16), DATE(2004, 2, 3), "YM")
  3
  >>> DATEDIF(DATE(2016, 2, 14), DATE(2016, 3, 14), "YM")
  1
  >>> DATEDIF(DATE(2016, 2, 14), DATE(2016, 3, 13), "YM")
  0
  >>> DATEDIF(DATE(2008, 10, 16), DATE(2019, 12, 3), "MD")
  17
  >>> DATEDIF(DATE(2008, 11, 16), DATE(2019, 1, 3), "MD")
  18
  >>> DATEDIF(DATE(2016, 2, 29), DATE(2017, 2, 28), "Y")
  0
  >>> DATEDIF(DATE(2016, 2, 29), DATE(2017, 2, 29), "Y")
  1
  """
  if isinstance(start_date, datetime.datetime):
    start_date = start_date.date()
  if isinstance(end_date, datetime.datetime):
    end_date = end_date.date()
  if unit == 'D':
    return (end_date - start_date).days
  elif unit == 'M':
    months = (end_date.year - start_date.year) * 12 + (end_date.month - start_date.month)
    month_delta = 0 if start_date.day <= end_date.day else 1
    return months - month_delta
  elif unit == 'Y':
    years = end_date.year - start_date.year
    year_delta = 0 if (start_date.month, start_date.day) <= (end_date.month, end_date.day) else 1
    return years - year_delta
  elif unit == 'MD':
    month_delta = 0 if start_date.day <= end_date.day else 1
    return (end_date - DATE(end_date.year, end_date.month - month_delta, start_date.day)).days
  elif unit == 'YM':
    month_delta = 0 if start_date.day <= end_date.day else 1
    return (end_date.month - start_date.month - month_delta) % 12
  elif unit == 'YD':
    year_delta = 0 if (start_date.month, start_date.day) <= (end_date.month, end_date.day) else 1
    return (end_date - DATE(end_date.year - year_delta, start_date.month, start_date.day)).days
  else:
    raise ValueError('Invalid unit %s' % (unit,))


def DATEVALUE(date_string, tz=None):
  """
  Converts a date that is stored as text to a `datetime` object.

  >>> DATEVALUE("1/1/2008")
  datetime.datetime(2008, 1, 1, 0, 0, tzinfo=moment.tzinfo('America/New_York'))
  >>> DATEVALUE("30-Jan-2008")
  datetime.datetime(2008, 1, 30, 0, 0, tzinfo=moment.tzinfo('America/New_York'))
  >>> DATEVALUE("2008-12-11")
  datetime.datetime(2008, 12, 11, 0, 0, tzinfo=moment.tzinfo('America/New_York'))
  >>> DATEVALUE("5-JUL").replace(year=2000)
  datetime.datetime(2000, 7, 5, 0, 0, tzinfo=moment.tzinfo('America/New_York'))

  In case of ambiguity, prefer M/D/Y format.
  >>> DATEVALUE("1/2/3")
  datetime.datetime(2003, 1, 2, 0, 0, tzinfo=moment.tzinfo('America/New_York'))

  More tests:
  >>> DATEVALUE("8/22/2011")
  datetime.datetime(2011, 8, 22, 0, 0, tzinfo=moment.tzinfo('America/New_York'))
  >>> DATEVALUE("22-MAY-2011")
  datetime.datetime(2011, 5, 22, 0, 0, tzinfo=moment.tzinfo('America/New_York'))
  >>> DATEVALUE("2011/02/23")
  datetime.datetime(2011, 2, 23, 0, 0, tzinfo=moment.tzinfo('America/New_York'))
  >>> DATEVALUE("11/3/2011")
  datetime.datetime(2011, 11, 3, 0, 0, tzinfo=moment.tzinfo('America/New_York'))
  >>> DATE_TO_XL(DATEVALUE("11/3/2011"))
  40850.0
  >>> DATEVALUE("asdf")
  Traceback (most recent call last):
  ...
  {}: Unknown string format: asdf
  """
  return dateutil.parser.parse(date_string).replace(tzinfo=_get_tzinfo(tz))


DATEVALUE.__doc__ = DATEVALUE.__doc__.format(
  "dateutil.parser._parser.ParserError" if six.PY3 else "ParserError"
)


def DAY(date):
  """
  Returns the day of a date, as an integer ranging from 1 to 31. Same as `date.day`.

  >>> DAY(DATE(2011, 4, 15))
  15
  >>> DAY("5/31/2012")
  31
  >>> DAY(datetime.datetime(1900, 1, 1))
  1
  """
  return _make_datetime(date).day


def DAYS(end_date, start_date):
  """
  Returns the number of days between two dates. Same as `(end_date - start_date).days`.

  >>> DAYS("3/15/11","2/1/11")
  42
  >>> DAYS(DATE(2011, 12, 31), DATE(2011, 1, 1))
  364
  >>> DAYS("2/1/11", "3/15/11")
  -42
  """
  return (_make_datetime(end_date) - _make_datetime(start_date)).days


def EDATE(start_date, months):
  """
  Returns the date that is the given number of months before or after `start_date`. Use
  EDATE to calculate maturity dates or due dates that fall on the same day of the month as the
  date of issue.

  >>> EDATE(DATE(2011, 1, 15), 1)
  datetime.date(2011, 2, 15)
  >>> EDATE(DATE(2011, 1, 15), -1)
  datetime.date(2010, 12, 15)
  >>> EDATE(DATE(2011, 1, 15), 2)
  datetime.date(2011, 3, 15)
  >>> EDATE(DATE(2012, 3, 1), 10)
  datetime.date(2013, 1, 1)
  >>> EDATE(DATE(2012, 5, 1), -2)
  datetime.date(2012, 3, 1)
  """
  return DATE(start_date.year, start_date.month + months, start_date.day)


def DATEADD(start_date, days=0, months=0, years=0, weeks=0):
  """
  Returns the date a given number of days, months, years, or weeks away from `start_date`. You may
  specify arguments in any order if you specify argument names. Use negative values to subtract.

  For example, `DATEADD(date, 1)` is the same as `DATEADD(date, days=1)`, ands adds one day to
  `date`. `DATEADD(date, years=1, days=-1)` adds one year minus one day.

  >>> DATEADD(DATE(2011, 1, 15), 1)
  datetime.date(2011, 1, 16)
  >>> DATEADD(DATE(2011, 1, 15), months=1, days=-1)
  datetime.date(2011, 2, 14)
  >>> DATEADD(DATE(2011, 1, 15), years=-2, months=1, days=3, weeks=2)
  datetime.date(2009, 3, 4)
  >>> DATEADD(DATE(1975, 4, 30), years=50, weeks=-5)
  datetime.date(2025, 3, 26)
  """
  return DATE(start_date.year + years, start_date.month + months,
              start_date.day + days + weeks * 7)


def EOMONTH(start_date, months):
  """
  Returns the date for the last day of the month that is the indicated number of months before or
  after start_date. Use EOMONTH to calculate maturity dates or due dates that fall on the last day
  of the month.

  >>> EOMONTH(DATE(2011, 1, 1), 1)
  datetime.date(2011, 2, 28)
  >>> EOMONTH(DATE(2011, 1, 15), -3)
  datetime.date(2010, 10, 31)
  >>> EOMONTH(DATE(2012, 3, 1), 10)
  datetime.date(2013, 1, 31)
  >>> EOMONTH(DATE(2012, 5, 1), -2)
  datetime.date(2012, 3, 31)
  """
  return DATE(start_date.year, start_date.month + months + 1, 1) - datetime.timedelta(days=1)


def HOUR(time):
  """
  Returns the hour of a `datetime`, as an integer from 0 (12:00 A.M.) to 23 (11:00 P.M.).
  Same as `time.hour`.

  >>> HOUR(XL_TO_DATE(0.75))
  18
  >>> HOUR("7/18/2011 7:45")
  7
  >>> HOUR("4/21/2012")
  0
  """
  return _make_datetime(time).hour


def ISOWEEKNUM(date):
  """
  Returns the ISO week number of the year for a given date.

  >>> ISOWEEKNUM("3/9/2012")
  10
  >>> [ISOWEEKNUM(DATE(2000 + y, 1, 1)) for y in [0,1,2,3,4,5,6,7,8]]
  [52, 1, 1, 1, 1, 53, 52, 1, 1]
  """
  return _make_datetime(date).isocalendar()[1]


def MINUTE(time):
  """
  Returns the minutes of `datetime`, as an integer from 0 to 59.
  Same as `time.minute`.

  >>> MINUTE(XL_TO_DATE(0.75))
  0
  >>> MINUTE("7/18/2011 7:45")
  45
  >>> MINUTE("12:59:00 PM")
  59
  >>> MINUTE(datetime.time(12, 58, 59))
  58
  """
  return _make_datetime(time).minute


def MONTH(date):
  """
  Returns the month of a date represented, as an integer from from 1 (January) to 12 (December).
  Same as `date.month`.

  >>> MONTH(DATE(2011, 4, 15))
  4
  >>> MONTH("5/31/2012")
  5
  >>> MONTH(datetime.datetime(1900, 1, 1))
  1
  """
  return _make_datetime(date).month


def NOW(tz=None):
  """
  Returns the `datetime` object for the current time.
  """
  engine = docmodel.global_docmodel._engine
  engine.use_current_time()
  return datetime.datetime.now(_get_tzinfo(tz))


def SECOND(time):
  """
  Returns the seconds of `datetime`, as an integer from 0 to 59.
  Same as `time.second`.

  >>> SECOND(XL_TO_DATE(0.75))
  0
  >>> SECOND("7/18/2011 7:45:13")
  13
  >>> SECOND(datetime.time(12, 58, 59))
  59
  """

  return _make_datetime(time).second


def TODAY(tz=None):
  """
  Returns the `date` object for the current date.
  """
  return NOW(tz=tz).date()


_weekday_type_map = {
  # type: (first day of week (according to date.weekday()), number to return for it)
  1: (6, 1),
  2: (0, 1),
  3: (0, 0),
  11: (0, 1),
  12: (1, 1),
  13: (2, 1),
  14: (3, 1),
  15: (4, 1),
  16: (5, 1),
  17: (6, 1),
}

def WEEKDAY(date, return_type=1):
  """
  Returns the day of the week corresponding to a date. The day is given as an integer, ranging
  from 1 (Sunday) to 7 (Saturday), by default.

  Return_type determines the type of the returned value.

    - 1 (default) - Returns 1 (Sunday) through 7 (Saturday).
    - 2   - Returns 1 (Monday) through 7 (Sunday).
    - 3   - Returns 0 (Monday) through 6 (Sunday).
    - 11  - Returns 1 (Monday) through 7 (Sunday).
    - 12  - Returns 1 (Tuesday) through 7 (Monday).
    - 13  - Returns 1 (Wednesday) through 7 (Tuesday).
    - 14  - Returns 1 (Thursday) through 7 (Wednesday).
    - 15  - Returns 1 (Friday) through 7 (Thursday).
    - 16  - Returns 1 (Saturday) through 7 (Friday).
    - 17  - Returns 1 (Sunday) through 7 (Saturday).

  >>> WEEKDAY(DATE(2008, 2, 14))
  5
  >>> WEEKDAY(DATE(2012, 3, 1))
  5
  >>> WEEKDAY(DATE(2012, 3, 1), 1)
  5
  >>> WEEKDAY(DATE(2012, 3, 1), 2)
  4
  >>> WEEKDAY("3/1/2012", 3)
  3

  More tests:
  >>> WEEKDAY(XL_TO_DATE(10000), 1)
  4
  >>> WEEKDAY(DATE(1901, 1, 1))
  3
  >>> WEEKDAY(DATE(1901, 1, 1), 2)
  2
  >>> [WEEKDAY(DATE(2008, 2, d)) for d in [10, 11, 12, 13, 14, 15, 16, 17]]
  [1, 2, 3, 4, 5, 6, 7, 1]
  >>> [WEEKDAY(DATE(2008, 2, d), 1) for d in [10, 11, 12, 13, 14, 15, 16, 17]]
  [1, 2, 3, 4, 5, 6, 7, 1]
  >>> [WEEKDAY(DATE(2008, 2, d), 17) for d in [10, 11, 12, 13, 14, 15, 16, 17]]
  [1, 2, 3, 4, 5, 6, 7, 1]
  >>> [WEEKDAY(DATE(2008, 2, d), 2) for d in [10, 11, 12, 13, 14, 15, 16, 17]]
  [7, 1, 2, 3, 4, 5, 6, 7]
  >>> [WEEKDAY(DATE(2008, 2, d), 3) for d in [10, 11, 12, 13, 14, 15, 16, 17]]
  [6, 0, 1, 2, 3, 4, 5, 6]
  """
  if return_type not in _weekday_type_map:
    raise ValueError("Invalid return type %s" % (return_type,))
  (first, index) = _weekday_type_map[return_type]
  return (_make_datetime(date).weekday() - first) % 7 + index


def WEEKNUM(date, return_type=1):
  """
  Returns the week number of a specific date. For example, the week containing January 1 is the
  first week of the year, and is numbered week 1.

  Return_type determines which week is considered the first week of the year.

    - 1 (default) - Week 1 is the first week starting Sunday that contains January 1.
    - 2   - Week 1 is the first week starting Monday that contains January 1.
    - 11  - Week 1 is the first week starting Monday that contains January 1.
    - 12  - Week 1 is the first week starting Tuesday that contains January 1.
    - 13  - Week 1 is the first week starting Wednesday that contains January 1.
    - 14  - Week 1 is the first week starting Thursday that contains January 1.
    - 15  - Week 1 is the first week starting Friday that contains January 1.
    - 16  - Week 1 is the first week starting Saturday that contains January 1.
    - 17  - Week 1 is the first week starting Sunday that contains January 1.
    - 21  - ISO 8601 Approach: Week 1 is the first week starting Monday that contains January 4.
          Equivalently, it is the week that contains the first Thursday of the year.

  >>> WEEKNUM(DATE(2012, 3, 9))
  10
  >>> WEEKNUM(DATE(2012, 3, 9), 2)
  11
  >>> WEEKNUM('1/1/1900')
  1
  >>> WEEKNUM('2/1/1900')
  5

  More tests:
  >>> WEEKNUM('2/1/1909', 2)
  6
  >>> WEEKNUM('1/1/1901', 21)
  1
  >>> [WEEKNUM(DATE(2012, 3, 9), t) for t in [1,2,11,12,13,14,15,16,17,21]]
  [10, 11, 11, 11, 11, 11, 11, 10, 10, 10]
  """
  if return_type == 21:
    return ISOWEEKNUM(date)
  if return_type not in _weekday_type_map:
    raise ValueError("Invalid return type %s" % (return_type,))
  (first, index) = _weekday_type_map[return_type]
  date = _make_datetime(date)
  jan1 = datetime.datetime(date.year, 1, 1)
  week1_start = jan1 - datetime.timedelta(days=(jan1.weekday() - first) % 7)
  return (date - week1_start).days // 7 + 1


def YEAR(date):
  """
  Returns the year corresponding to a date as an integer.
  Same as `date.year`.

  >>> YEAR(DATE(2011, 4, 15))
  2011
  >>> YEAR("5/31/2030")
  2030
  >>> YEAR(datetime.datetime(1900, 1, 1))
  1900
  """
  return _make_datetime(date).year


def _date_360(y, m, d):
  return y * 360 + m * 30 + d

def _last_of_feb(date):
  return date.month == 2 and (date + datetime.timedelta(days=1)).month == 3

def YEARFRAC(start_date, end_date, basis=0):
  """
  Calculates the fraction of the year represented by the number of whole days between two dates.

  Basis is the type of day count basis to use.

    * `0` (default) - US (NASD) 30/360
    * `1`   - Actual/actual
    * `2`   - Actual/360
    * `3`   - Actual/365
    * `4`   - European 30/360
    * `-1`  - Actual/actual (Google Sheets variation)

  This function is useful for financial calculations. For compatibility with Excel, it defaults to
  using the NASD standard calendar. For use in non-financial settings, option `-1` is
  likely the best choice.

  See <https://en.wikipedia.org/wiki/360-day_calendar> for explanation of
  the US 30/360 and European 30/360 methods. See <http://www.dwheeler.com/yearfrac/> for analysis of
  Excel's particular implementation.

  Basis `-1` is similar to `1`, but differs from Excel when dates span both leap and non-leap years.
  It matches the calculation in Google Sheets, counting the days in each year as a fraction of
  that year's length.

  Fraction of the year between 1/1/2012 and 7/30/12, omitting the Basis argument.
  >>> "%.8f" % YEARFRAC(DATE(2012, 1, 1), DATE(2012, 7, 30))
  '0.58055556'

  Fraction between same dates, using the Actual/Actual basis argument. Because 2012 is a Leap
  year, it has a 366 day basis.
  >>> "%.8f" % YEARFRAC(DATE(2012, 1, 1), DATE(2012, 7, 30), 1)
  '0.57650273'

  Fraction between same dates, using the Actual/365 basis argument. Uses a 365 day basis.
  >>> "%.8f" % YEARFRAC(DATE(2012, 1, 1), DATE(2012, 7, 30), 3)
  '0.57808219'

  More tests:
  >>> round(YEARFRAC(DATE(2012, 1, 1), DATE(2012, 6, 30)), 10)
  0.4972222222
  >>> round(YEARFRAC(DATE(2012, 1, 1), DATE(2012, 6, 30), 0), 10)
  0.4972222222
  >>> round(YEARFRAC(DATE(2012, 1, 1), DATE(2012, 6, 30), 1), 10)
  0.4945355191
  >>> round(YEARFRAC(DATE(2012, 1, 1), DATE(2012, 6, 30), 2), 10)
  0.5027777778
  >>> round(YEARFRAC(DATE(2012, 1, 1), DATE(2012, 6, 30), 3), 10)
  0.495890411
  >>> round(YEARFRAC(DATE(2012, 1, 1), DATE(2012, 6, 30), 4), 10)
  0.4972222222
  >>> [YEARFRAC(DATE(2012, 1, 1), DATE(2012, 1, 1), t) for t in [0, 1, -1, 2, 3, 4]]
  [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
  >>> [round(YEARFRAC(DATE(1985, 3, 15), DATE(2016, 2, 29), t), 6) for t in [0, 1, -1, 2, 3, 4]]
  [30.955556, 30.959617, 30.961202, 31.411111, 30.980822, 30.955556]
  >>> [round(YEARFRAC(DATE(2001, 2, 28), DATE(2016, 3, 31), t), 6) for t in [0, 1, -1, 2, 3, 4]]
  [15.086111, 15.085558, 15.086998, 15.305556, 15.09589, 15.088889]
  >>> [round(YEARFRAC(DATE(1968, 4, 7), DATE(2011, 2, 14), t), 6) for t in [0, 1, -1, 2, 3, 4]]
  [42.852778, 42.855578, 42.855521, 43.480556, 42.884932, 42.852778]

  Here we test "basis 1" on leap and non-leap years.
  >>> [round(YEARFRAC(DATE(2015, 1, 1), DATE(2015, 3, 1), t), 6) for t in [1, -1]]
  [0.161644, 0.161644]
  >>> [round(YEARFRAC(DATE(2016, 1, 1), DATE(2016, 3, 1), t), 6) for t in [1, -1]]
  [0.163934, 0.163934]
  >>> [round(YEARFRAC(DATE(2015, 1, 1), DATE(2016, 1, 1), t), 6) for t in [1, -1]]
  [1.0, 1.0]
  >>> [round(YEARFRAC(DATE(2016, 1, 1), DATE(2017, 1, 1), t), 6) for t in [1, -1]]
  [1.0, 1.0]
  >>> [round(YEARFRAC(DATE(2016, 2, 29), DATE(2017, 1, 1), t), 6) for t in [1, -1]]
  [0.838798, 0.838798]
  >>> [round(YEARFRAC(DATE(2014, 12, 15), DATE(2015, 3, 15), t), 6) for t in [1, -1]]
  [0.246575, 0.246575]

  For these examples, Google Sheets differs from Excel, and we match Excel here.
  >>> [round(YEARFRAC(DATE(2015, 12, 15), DATE(2016, 3, 15), t), 6) for t in [1, -1]]
  [0.248634, 0.248761]
  >>> [round(YEARFRAC(DATE(2015, 1, 1), DATE(2016, 2, 29), t), 6) for t in [1, -1]]
  [1.160055, 1.161202]
  >>> [round(YEARFRAC(DATE(2015, 1, 1), DATE(2016, 2, 28), t), 6) for t in [1, -1]]
  [1.157319, 1.15847]
  >>> [round(YEARFRAC(DATE(2015, 3, 1), DATE(2016, 2, 29), t), 6) for t in [1, -1]]
  [0.997268, 0.999558]
  >>> [round(YEARFRAC(DATE(2015, 3, 1), DATE(2016, 2, 28), t), 6) for t in [1, -1]]
  [0.99726, 0.996826]
  >>> [round(YEARFRAC(DATE(2016, 3, 1), DATE(2017, 1, 1), t), 6) for t in [1, -1]]
  [0.838356, 0.836066]
  >>> [round(YEARFRAC(DATE(2015, 1, 1), DATE(2017, 1, 1), t), 6) for t in [1, -1]]
  [2.000912, 2.0]
  """
  # pylint: disable=too-many-return-statements
  # This function is actually completely crazy. The rules are strange too. We'll follow the logic
  # in http://www.dwheeler.com/yearfrac/excel-ooxml-yearfrac.pdf
  if start_date == end_date:
    return 0.0
  if start_date > end_date:
    start_date, end_date = end_date, start_date

  d1, m1, y1 = start_date.day, start_date.month, start_date.year
  d2, m2, y2 = end_date.day, end_date.month, end_date.year

  if basis == 0:
    if d1 == 31:
      d1 = 30
    if d1 == 30 and d2 == 31:
      d2 = 30
    if _last_of_feb(start_date):
      d1 = 30
      if _last_of_feb(end_date):
        d2 = 30
    return (_date_360(y2, m2, d2) - _date_360(y1, m1, d1)) / 360.0

  elif basis == 1:
    # This implements Excel's convoluted logic.
    if (y1 + 1, m1, d1) >= (y2, m2, d2):
      # Less than or equal to one year.
      if y1 == y2 and calendar.isleap(y1):
        year_length = 366.0
      elif (y1, m1, d1) < (y2, 2, 29) <= (y2, m2, d2) and calendar.isleap(y2):
        year_length = 366.0
      elif (y1, m1, d1) <= (y1, 2, 29) < (y2, m2, d2) and calendar.isleap(y1):
        year_length = 366.0
      else:
        year_length = 365.0
    else:
      year_length = (datetime.date(y2 + 1, 1, 1) - datetime.date(y1, 1, 1)).days / (y2 + 1.0 - y1)
    return (end_date - start_date).days / year_length

  elif basis == -1:
    # This is Google Sheets implementation. Call it an overkill, but I think it's more sensible.
    #
    # Excel's logic has the unfortunate property that YEARFRAC(a, b) + YEARFRAC(b, c) is not
    # always equal to YEARFRAC(a, c). Google Sheets implements a variation that does have this
    # property, counting the days in each year as a fraction of that year's length (as if each day
    # is counted as 1/365 or 1/366 depending on the year).
    #
    # The one redeeming quality of Excel's logic is that YEARFRAC for two days that differ by
    # exactly one year is 1.0 (not always true for GS). But in GS version, YEARFRAC between any
    # two Jan 1 is always a whole number (not always true in Excel).
    if y1 == y2:
      return _one_year_frac(start_date, end_date)
    return (
      + _one_year_frac(start_date, datetime.date(y1 + 1, 1, 1))
      + (y2 - y1 - 1)
      + _one_year_frac(datetime.date(y2, 1, 1), end_date)
    )

  elif basis == 2:
    return (end_date - start_date).days / 360.0

  elif basis == 3:
    return (end_date - start_date).days / 365.0

  elif basis == 4:
    if d1 == 31:
      d1 = 30
    if d2 == 31:
      d2 = 30
    return (_date_360(y2, m2, d2) - _date_360(y1, m1, d1)) / 360.0

  raise ValueError('Invalid basis argument %r' % (basis,))

def _one_year_frac(start_date, end_date):
  year_length = 366.0 if calendar.isleap(start_date.year) else 365.0
  return (end_date - start_date).days / year_length


# Constants for moon phase calculations.
_new_moon_date = datetime.date(1900, 1, 1)    # Known new moon.
_synodic_month = 29.530588853                 # Length of synodic month, in days.

def MOONPHASE(date, output="emoji"):
  """
  Returns the phase of the moon on the given date. The output defaults to a moon-phase emoji.

  - With `output="days"`, the output is the age of the moon in days (new moon being 0).
  - With `output="fraction"`, the output is the fraction of the lunar month since new moon.

  The calculation isn't astronomically precise, but good enough for wolves and sailors.

  Do NOT! use `output="lunacy"`.

  >>> MOONPHASE(datetime.date(1900, 1, 1), "days")
  0.0
  >>> MOONPHASE(datetime.date(1900, 1, 1), "fraction")
  0.0
  >>> MOONPHASE(datetime.datetime(1900, 1, 1)) == '🌑'
  True
  >>> MOONPHASE(datetime.date(1900, 1, 15)) == '🌕'
  True
  >>> MOONPHASE(datetime.date(1900, 1, 30)) == '🌑'
  True
  >>> [MOONPHASE(DATEADD(datetime.date(2023, 4, 1), days=4*n)) for n in range(8)] == ['🌔', '🌕', '🌖', '🌗', '🌘', '🌑', '🌒', '🌓']
  True
  >>> [round(MOONPHASE(DATEADD(datetime.date(2023, 4, 1), days=4*n), "days"), 1) for n in range(8)]
  [10.4, 14.4, 18.4, 22.4, 26.4, 0.9, 4.9, 8.9]
  """
  days = (_make_datetime(date).date() - _new_moon_date).total_seconds() / 86400.
  age = days % _synodic_month
  phase = age / _synodic_month
  if output == "fraction":
    return phase
  elif output == "days":
    return age
  else:
    # DRAW THE MOON'S PHASES WITH EMOJI. ALL MOON PHASES ARE BEAUTIFUL, EVEN (near) INSTANT
    # ONES LIKE NEW, QUARTER, AND FULL (my fave, AWOOOO!) TO BE FAIR TO ALL PHASES, DIVIDE UP
    # EACH QUARTER INTO 10% FOR THE SHORT PHASES, 15% FOR THE LONG ONES.
    quarter, frac = divmod((phase + 0.05) % 1, 0.25)
    index = int(quarter) * 2 + int(frac > 0.1)
    if output == "lunacy":
      return "🐺" if index == 4 else "🕺"
    return ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"][index]
