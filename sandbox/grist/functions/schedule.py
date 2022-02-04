from datetime import datetime, timedelta
import re
from .date import DATEADD, NOW, DTIME

# Limit exports to schedule, so that upper-case constants like MONTH_NAMES, DAY_NAMES don't end up
# exposed as if Excel-style functions (or break docs generation).
__all__ = ['SCHEDULE']

MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december']
# Regex list of lowercase weekdays with characters after the first three made optional
DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

def SCHEDULE(schedule, start=None, count=10, end=None):
  """
  Returns the list of `datetime` objects generated according to the `schedule` string. Starts at
  `start`, which defaults to NOW(). Generates at most `count` results (10 by default). If `end` is
  given, stops there.

  The schedule has the format "INTERVAL: SLOTS, ...". For example:

      annual: Jan-15, Apr-15, Jul-15  -- Three times a year on given dates at midnight.
      annual: 1/15, 4/15, 7/15        -- Same as above.
      monthly: /1 2pm, /15 2pm        -- The 1st and the 15th of each month, at 2pm.
      3-months: /10, +1m /20           -- Every 3 months on the 10th of month 1, 20th of month 2.
      weekly: Mo 9am, Tu 9am, Fr 2pm  -- Three times a week at specified times.
      2-weeks: Mo, +1w Tu             -- Every 2 weeks on Monday of week 1, Tuesday of week 2.
      daily: 07:30, 21:00             -- Twice a day at specified times.
      2-day: 12am, 4pm, +1d 8am       -- Three times every two days, evenly spaced.
      hourly: :15, :45                -- 15 minutes before and after each hour.
      4-hour: :00, 1:20, 2:40         -- Three times every 4 hours, evenly spaced.
      10-minute: +0s                  -- Every 10 minutes on the minute.

  INTERVAL must be either of the form `N-unit` where `N` is a number and `unit` is one of `year`,
  `month`, `week`, `day`, `hour`; or one of the aliases: `annual`, `monthly`, `weekly`, `daily`,
  `hourly`, which mean `1-year`, `1-month`, etc.

  SLOTS support the following units:

      `Jan-15` or `1/15`    -- Month and day of the month; available when INTERVAL is year-based.
      `/15`                 -- Day of the month, available when INTERVAL is month-based.
      `Mon`, `Mo`, `Friday` -- Day of the week (or abbreviation), when INTERVAL is week-based.
      10am, 1:30pm, 15:45   -- Time of day, available for day-based or longer intervals.
      :45, :00              -- Minutes of the hour, available when INTERVAL is hour-based.
      +1d, +15d             -- How many days to add to start of INTERVAL.
      +1w                   -- How many weeks to add to start of INTERVAL.
      +1m                   -- How many months to add to start of INTERVAL.

  The SLOTS are always relative to the INTERVAL rather than to `start`. Week-based intervals start
  on Sunday. E.g. `weekly: +1d, +4d` is the same as `weekly: Mon, Thu`, and generates times on
  Mondays and Thursdays regardless of `start`.

  The first generated time is determined by the *unit* of the INTERVAL without regard to the
  multiple. E.g. both "2-week: Mon" and "3-week: Mon" start on the first Monday after `start`, and
  then generate either every second or every third Monday after that. Similarly, `24-hour: :00`
  starts with the first top-of-the-hour after `start` (not with midnight), and then repeats every
  24 hours. To start with the midnight after `start`, use `daily: 0:00`.

  For interval units of a day or longer, if time-of-day is not specified, it defaults to midnight.

  The time zone of `start` determines the time zone of the generated times.

  >>> def show(dates): return [d.strftime("%Y-%m-%d %H:%M") for d in dates]
  >>> start = datetime(2018, 9, 4, 14, 0);   # 2pm on Tue, Sep 4 2018.

  >>> show(SCHEDULE('annual: Jan-15, Apr-15, Jul-15, Oct-15', start=start, count=4))
  ['2018-10-15 00:00', '2019-01-15 00:00', '2019-04-15 00:00', '2019-07-15 00:00']

  >>> show(SCHEDULE('annual: 1/15, 4/15, 7/15', start=start, count=4))
  ['2019-01-15 00:00', '2019-04-15 00:00', '2019-07-15 00:00', '2020-01-15 00:00']

  >>> show(SCHEDULE('monthly: /1 2pm, /15 5pm', start=start, count=4))
  ['2018-09-15 17:00', '2018-10-01 14:00', '2018-10-15 17:00', '2018-11-01 14:00']

  >>> show(SCHEDULE('3-months: /10, +1m /20', start=start, count=4))
  ['2018-09-10 00:00', '2018-10-20 00:00', '2018-12-10 00:00', '2019-01-20 00:00']

  >>> show(SCHEDULE('weekly: Mo 9am, Tu 9am, Fr 2pm', start=start, count=4))
  ['2018-09-07 14:00', '2018-09-10 09:00', '2018-09-11 09:00', '2018-09-14 14:00']

  >>> show(SCHEDULE('2-weeks: Mo, +1w Tu', start=start, count=4))
  ['2018-09-11 00:00', '2018-09-17 00:00', '2018-09-25 00:00', '2018-10-01 00:00']

  >>> show(SCHEDULE('daily: 07:30, 21:00', start=start, count=4))
  ['2018-09-04 21:00', '2018-09-05 07:30', '2018-09-05 21:00', '2018-09-06 07:30']

  >>> show(SCHEDULE('2-day: 12am, 4pm, +1d 8am', start=start, count=4))
  ['2018-09-04 16:00', '2018-09-05 08:00', '2018-09-06 00:00', '2018-09-06 16:00']

  >>> show(SCHEDULE('hourly: :15, :45', start=start, count=4))
  ['2018-09-04 14:15', '2018-09-04 14:45', '2018-09-04 15:15', '2018-09-04 15:45']

  >>> show(SCHEDULE('4-hour: :00, +1H :20, +2H :40', start=start, count=4))
  ['2018-09-04 14:00', '2018-09-04 15:20', '2018-09-04 16:40', '2018-09-04 18:00']
  """
  return Schedule(schedule).series(start or NOW(), end, count=count)

class Delta(object):
  """
  Similar to timedelta, keeps intervals by unit. Specifically, this is needed for months
  and years, since those can't be represented exactly with a timedelta.
  """
  def __init__(self):
    self._timedelta = timedelta(0)
    self._months = 0

  def add_interval(self, number, unit):
    if unit == 'months':
      self._months += number
    elif unit == 'years':
      self._months += number * 12
    else:
      self._timedelta += timedelta(**{unit: number})
    return self

  def add_to(self, dtime):
    return datetime.combine(DATEADD(dtime, months=self._months), dtime.timetz()) + self._timedelta


class Schedule(object):
  """
  Schedule parses a schedule spec into an interval and slots in the constructor. Then the series()
  method applies it to any start/end dates.
  """
  def __init__(self, spec_string):
    parts = spec_string.split(":", 1)
    if len(parts) != 2:
      raise ValueError("schedule must have the form INTERVAL: SLOTS, ...")

    count, unit = _parse_interval(parts[0].strip())
    self._interval_unit = unit
    self._interval = Delta().add_interval(count, unit)
    self._slots = [_parse_slot(t, self._interval_unit) for t in parts[1].split(",")]

  def series(self, start_dtime, end_dtime, count=10):
    # Start with a preceding unit boundary, then check the slots within that unit and start with
    # the first one that's at start_dtime or later.
    start_dtime = DTIME(start_dtime)
    end_dtime = end_dtime and DTIME(end_dtime)
    dtime = _round_down_to_unit(start_dtime, self._interval_unit)
    while True:
      for slot in self._slots:
        if count <= 0:
          return
        out = slot.add_to(dtime)
        if out < start_dtime:
          continue
        if end_dtime is not None and out > end_dtime:
          return
        yield out
        count -= 1
      dtime = self._interval.add_to(dtime)

def _fail(message):
  raise ValueError(message)

def _round_down_to_unit(dtime, unit):
  """
  Rounds datetime down to the given unit. Weeks are rounded to start of Sunday.
  """
  tz = dtime.tzinfo
  return ( datetime(dtime.year, 1, 1, tzinfo=tz)                               if unit == 'years'
      else datetime(dtime.year, dtime.month, 1, tzinfo=tz)                     if unit == 'months'
      else (dtime - timedelta(days=dtime.isoweekday() % 7))
           .replace(hour=0, minute=0, second=0, microsecond=0)                 if unit == 'weeks'
      else dtime.replace(hour=0, minute=0, second=0, microsecond=0)            if unit == 'days'
      else dtime.replace(minute=0, second=0, microsecond=0)                    if unit == 'hours'
      else dtime.replace(second=0, microsecond=0)                              if unit == 'minutes'
      else dtime.replace(microsecond=0)                                        if unit == 'seconds'
      else _fail("Invalid unit %s" % unit)
  )

_UNITS = ('years', 'months', 'weeks', 'days', 'hours', 'minutes', 'seconds')
_VALID_UNITS = set(_UNITS)
_SINGULAR_UNITS = dict(zip(('year', 'month', 'week', 'day', 'hour', 'minute', 'second'), _UNITS))
_SHORT_UNITS = dict(zip(('y', 'm', 'w', 'd', 'H', 'M', 'S'), _UNITS))

_INTERVAL_ALIASES = {
  'annual':   (1, 'years'),
  'monthly':  (1, 'months'),
  'weekly':   (1, 'weeks'),
  'daily':    (1, 'days'),
  'hourly':   (1, 'hours'),
}

_INTERVAL_RE = re.compile(r'^(?P<num>\d+)[-\s]+(?P<unit>[a-z]+)$', re.I)

# Maps weekday names, including 2- and 3-letter abbreviations, to numbers 0 through 6.
WEEKDAY_OFFSETS = {}
for (i, name) in enumerate(DAY_NAMES):
  WEEKDAY_OFFSETS[name] = i
  WEEKDAY_OFFSETS[name[:3]] = i
  WEEKDAY_OFFSETS[name[:2]] = i

# Maps month names, including 3-letter abbreviations, to numbers 0 through 11.
MONTH_OFFSETS = {}
for (i, name) in enumerate(MONTH_NAMES):
  MONTH_OFFSETS[name] = i
  MONTH_OFFSETS[name[:3]] = i


def _parse_interval(interval_str):
  """
  Given a spec like "daily" or "3-week", returns (N, unit), such as (1, "days") or (3, "weeks").
  """
  interval_str = interval_str.lower()
  if interval_str in _INTERVAL_ALIASES:
    return _INTERVAL_ALIASES[interval_str]

  m = _INTERVAL_RE.match(interval_str)
  if not m:
    raise ValueError("Not a valid interval '%s'" % interval_str)
  num = int(m.group("num"))
  unit = m.group("unit")
  unit = _SINGULAR_UNITS.get(unit, unit)
  if unit not in _VALID_UNITS:
    raise ValueError("Unknown unit '%s' in interval '%s'" % (unit, interval_str))
  return (num, unit)


def _parse_slot(slot_str, parent_unit):
  """
  Parses a slot in one of several recognized formats. Allowed formats depend on parent_unit, e.g.
  'Jan-15' is valid when parent_unit is 'years', but not when it is 'hours'. We also disallow
  using the same unit more than once, which is confusing, e.g. "+1d +2d" or "9:30am +2H".
  Returns a Delta object.
  """
  parts = slot_str.split()
  if not parts:
    raise ValueError("At least one slot must be specified")

  delta = Delta()
  seen_units = set()
  allowed_slot_types = _ALLOWED_SLOTS_BY_UNIT.get(parent_unit) or ('delta',)

  # Slot parts go through parts like "Jan-15 16pm", collecting the offsets into a single Delta.
  for part in parts:
    m = _SLOT_RE.match(part)
    if not m:
      raise ValueError("Invalid slot '%s'" % part)
    for slot_type in allowed_slot_types:
      if m.group(slot_type):
        # If there is a group for one slot type, that's the only group. We find and use the
        # corresponding parser, then move on to the next slot part.
        for count, unit in _SLOT_PARSERS[slot_type](m):
          delta.add_interval(count, unit)
          if unit in seen_units:
            raise ValueError("Duplicate unit %s in '%s'" % (unit, slot_str))
          seen_units.add(unit)
        break
    else:
      # If none of the allowed slot types was found, it must be a disallowed one.
      raise ValueError("Invalid slot '%s' for unit '%s'" % (part, parent_unit))
  return delta

# We parse all slot types using one big regex. The constants below define one part of the regex
# for each slot type (e.g. to match "Jan-15" or "5:30am" or "+1d"). Note that all group names
# (defined with (?P<NAME>...)) must be distinct.
_DATE_RE = r'(?:(?P<month_name>[a-z]+)-|(?P<month_num>\d+)/)(?P<month_day>\d+)'
_MDAY_RE = r'/(?P<month_day2>\d+)'
_WDAY_RE = r'(?P<weekday>[a-z]+)'
_TIME_RE = r'(?P<hours>\d+)(?:\:(?P<minutes>\d{2})(?P<ampm1>am|pm)?|(?P<ampm2>am|pm))'
_MINS_RE = r':(?P<minutes2>\d{2})'
_DELTA_RE = r'\+(?P<count>\d+)(?P<unit>[a-z]+)'

# The regex parts are combined and compiled here. Only one group will match, corresponding to one
# slot type. Different slot types depend on the unit of the overall interval.
_SLOT_RE = re.compile(
    r'^(?:(?P<date>%s)|(?P<mday>%s)|(?P<wday>%s)|(?P<time>%s)|(?P<mins>%s)|(?P<delta>%s))$' %
    (_DATE_RE, _MDAY_RE, _WDAY_RE, _TIME_RE, _MINS_RE, _DELTA_RE), re.IGNORECASE)

# Slot types that make sense for each unit of overall interval. If not listed (e.g. "minutes")
# then only "delta" slot type is allowed.
_ALLOWED_SLOTS_BY_UNIT = {
  'years': ('date', 'time', 'delta'),
  'months': ('mday', 'time', 'delta'),
  'weeks': ('wday', 'time', 'delta'),
  'days': ('time', 'delta'),
  'hours': ('mins', 'delta'),
}

# The helper methods below parse one slot type each, given a regex match that matched that slot
# type. These are combined and used via the _SLOT_PARSERS dict below.
def _parse_slot_date(m):
  mday = int(m.group("month_day"))
  month_name = m.group("month_name")
  month_num = m.group("month_num")
  if month_name:
    name = month_name.lower()
    if name not in MONTH_OFFSETS:
      raise ValueError("Unknown month '%s'" % month_name)
    mnum = MONTH_OFFSETS[name]
  else:
    mnum = int(month_num) - 1
  return [(mnum, 'months'), (mday - 1, 'days')]

def _parse_slot_mday(m):
  mday = int(m.group("month_day2"))
  return [(mday - 1, 'days')]

def _parse_slot_wday(m):
  wday = m.group("weekday").lower()
  if wday not in WEEKDAY_OFFSETS:
    raise ValueError("Unknown day of the week '%s'" % wday)
  return [(WEEKDAY_OFFSETS[wday], "days")]

def _parse_slot_time(m):
  hours = int(m.group("hours"))
  minutes = int(m.group("minutes") or 0)
  ampm = m.group("ampm1") or m.group("ampm2")
  if ampm:
    hours = (hours % 12) + (12 if ampm.lower() == "pm" else 0)
  return [(hours, 'hours'), (minutes, 'minutes')]

def _parse_slot_mins(m):
  minutes = int(m.group("minutes2"))
  return [(minutes, 'minutes')]

def _parse_slot_delta(m):
  count = int(m.group("count"))
  unit = m.group("unit")
  if unit not in _SHORT_UNITS:
    raise ValueError("Unknown unit '%s' in interval '%s'" % (unit, m.group()))
  return [(count, _SHORT_UNITS[unit])]

_SLOT_PARSERS = {
  'date': _parse_slot_date,
  'mday': _parse_slot_mday,
  'wday': _parse_slot_wday,
  'time': _parse_slot_time,
  'mins': _parse_slot_mins,
  'delta': _parse_slot_delta,
}
