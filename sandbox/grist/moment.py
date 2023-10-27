from datetime import datetime, timedelta, tzinfo as _tzinfo
from collections import namedtuple
import marshal
from time import time
import bisect
import os
import iso8601
import six
from six.moves import zip

try:
  from functools import lru_cache
except ImportError:
  from backports.functools_lru_cache import lru_cache  # noqa


# This is prepared by sandbox/install_tz.py
ZoneRecord = namedtuple("ZoneRecord", ("name", "abbrs", "offsets", "untils"))

# moment.py mirrors core functionality of moment-timezone.js
# Documentation: http://momentjs.com/timezone/docs/

EPOCH = datetime(1970, 1, 1)
DATE_EPOCH = EPOCH.date()

CURRENT_DATE = DATE_EPOCH + timedelta(seconds=time())

_TZDATA = None

# Returns a dictionary mapping timezone name to ZoneRecord object. It reads the data on first
# call, caches it, and returns cached data on all future calls.
def get_tz_data():
  global _TZDATA    # pylint: disable=global-statement
  if _TZDATA is None:
    all_zones = read_tz_raw_data()
    # The marshalled data is an array of tuples (name, abbrs, offsets, untils)
    _TZDATA = {x[0]: ZoneRecord._make(x) for x in all_zones}
  return _TZDATA

# Reads and returns the marshalled tzdata file (produced by sandbox/install_tz.py).
# The return value is a list of tuples (name, abbrs, offsets, untils).
def read_tz_raw_data():
  tzfile = os.path.join(os.path.dirname(__file__), "tzdata.data")
  with open(tzfile, "rb") as tzdata:
    return marshal.load(tzdata)


# Converts a UTC datetime to timestamp in milliseconds.
def utc_to_ts_ms(dt):
  return (dt.replace(tzinfo=None) - EPOCH).total_seconds() * 1000

# Converts timestamp in seconds to datetime in the given timezone. If tzinfo is given, then zone
# is ignored and may be None.
@lru_cache(maxsize=1024)
def ts_to_dt(timestamp, zone, tzinfo=None):
  return (EPOCH_UTC + timedelta(seconds=timestamp)).astimezone(tzinfo or zone.get_tzinfo(None))

# Converts datetime to timestamp in seconds. Optional timezone may be given to serve as the
# default if dt is unaware (has no associated timezone).
def dt_to_ts(dt, timezone=None):
  offset = dt.utcoffset()
  if offset is None:
    offset = timezone.dt_offset(dt) if timezone else timedelta(0)
  return (dt.replace(tzinfo=None) - offset - EPOCH).total_seconds()

# Converts timestamp in seconds to date.
@lru_cache(maxsize=1024)
def ts_to_date(timestamp):
  return DATE_EPOCH + timedelta(seconds=timestamp)

# Converts date to timestamp of the midnight in seconds, in the given timezone, or UTC by default.
def date_to_ts(date, timezone=None):
  ts = (date - DATE_EPOCH).total_seconds()
  return ts if not timezone else ts - timezone.offset(ts * 1000).total_seconds()

# Parses a datetime in the ISO format, YYYY-MM-DDTHH:MM:SS.mmmmmm+HH:MM. Most parts are optional;
# see https://pypi.org/project/iso8601/ for details. Returns a timestamp in seconds.
def parse_iso(date_string, timezone=None):
  dt = iso8601.parse_date(date_string, default_timezone=None)
  return dt_to_ts(dt, timezone)

# Parses a date in ISO format, ignoring all time components. Returns timestamp of UTC midnight.
def parse_iso_date(date_string):
  dt = iso8601.parse_date(date_string, default_timezone=None)
  return date_to_ts(dt.date())


class tz(object):
  """Implements basics of moment.js and moment-timezone.js"""
  # dt (datetime / number) - Either a local datetime in the time of the
  #   provided timezone or a timestamp since epoch in milliseconds.
  # zonelabel (string) - The name of the timezone; should correspond to
  #   one of the names in the moment-timezone json data.
  def __init__(self, dt, zonelabel="UTC"):
    self._tzinfo = tzinfo(zonelabel)
    if isinstance(dt, datetime):
      timestamp = dt_to_ts(dt.replace(tzinfo=self._tzinfo)) * 1000
    elif isinstance(dt, (float, six.integer_types)):
      timestamp = dt
    else:
      raise TypeError("'dt' should be a datetime object or a numeric type")
    self.timestamp = timestamp

  # Returns the timestamp in seconds
  def timestamp_s(self):
    return self.timestamp / 1000

  # Changes the timezone to the one corresponding to 'zonelabel' without
  #   changing the underlying time since epoch.
  def tz(self, zonelabel):
    self._tzinfo = tzinfo(zonelabel)
    return self

  # Returns a datetime object with the moment-timezone object's local time and the timezone
  #   at the current timestamp.
  def datetime(self):
    return ts_to_dt(self.timestamp / 1000.0, None, self._tzinfo)

  def zoneName(self):
    return self._tzinfo.zone.name

  def zoneAbbr(self):
    return self._tzinfo.zone.abbr(self.timestamp)

  def zoneOffset(self):
    return self._tzinfo.zone.offset(self.timestamp)


class TzInfo(_tzinfo):
  """
  Implements datetime.tzinfo interface using moment-timezone data. If favor_offset is used, it
  tells which offset to favor when a datetime is ambiguous. If None, the offset that's in effect
  earlier is favored.
  """
  def __init__(self, zone, favor_offset):
    super(TzInfo, self).__init__()
    self.zone = zone
    self._favor_offset = favor_offset

  def utcoffset(self, dt):
    """Implementation of tzinfo.utcoffset interface."""
    return self.zone.dt_offset(dt, self._favor_offset)

  def tzname(self, dt):
    """Implementation of tzinfo.tzname interface."""
    abbr = self.zone.dt_tzname(dt, self._favor_offset)
    if six.PY2 and isinstance(abbr, six.text_type):
      abbr = abbr.encode('utf8')
    return abbr

  def dst(self, dt):
    """Implementation of tzinfo.dst interface."""
    return self.utcoffset(dt) - self.zone.standard_offset

  def fromutc(self, dt):
    # This produces a datetime with a specific offset, and sets tzinfo that favors that offset.
    offset = self.zone.offset(utc_to_ts_ms(dt))
    return (dt + offset).replace(tzinfo=self.zone.get_tzinfo(offset))

  def __repr__(self):
    """
    Produces a friendly representation
    >>> moment.tzinfo('America/New_York')
    moment.tzinfo('America/New_York')
    """
    return 'moment.tzinfo({!r})'.format(self.zone.name)


class Zone(object):
  """
  Implements the zone object of moment-timezone.js, and contains the logic needed by TzInfo.
  This is the class that interfaces directly with moment-timezone data.
  """
  def __init__(self, zonelabel):
    """
    Creates a Zone object for the given zonelabel, which must be a string key into the
    moment-timezone json data.
    """
    zone_data = get_tz_data()[zonelabel]
    self.name = zonelabel
    self.untils = zone_data.untils[:-1]   # In ms. We omit the trailing None value.
    self.abbrs = zone_data.abbrs
    self.offsets = zone_data.offsets      # Offsets in minutes.
    self.standard_offset = timedelta(minutes=-self.offsets[0])
    # "Until" times adjusted by the corresponding offsets. These are used in translating from
    # datetime to absolute timestamp.
    self.offset_untils = [until - offset * 60000 for (until, offset) in
                          zip(self.untils, self.offsets)]
    # Cache of TzInfo objects for this Zone, used by get_tzinfo(). There could be multiple TzInfo
    # objects, one for each possible offset, but their behavior only differs for ambiguous time.
    self._tzinfo = {}

  def dt_offset(self, dt, favor_offset=None):
    """Returns the timedelta for timezone offset east of UTC at the given datetime."""
    i = self._index_dt(dt, favor_offset)
    return timedelta(minutes = -self.offsets[i])

  def dt_tzname(self, dt, favor_offset=None):
    """Returns the timezone abbreviation (e.g. EST or EDT) at the given datetime."""
    i = self._index_dt(dt, favor_offset)
    return self.abbrs[i]

  def offset(self, timestamp_ms):
    """Returns the timedelta for timezone offset east of UTC at the given ms timestamp."""
    i = self._index(timestamp_ms)
    return timedelta(minutes = -self.offsets[i])

  def abbr(self, timestamp_ms):
    """Returns the timezone abbreviation (e.g. EST or EDT) at the given ms timestamp."""
    i = self._index(timestamp_ms)
    return self.abbrs[i]

  def _index(self, timestamp):
    """Helper to return the index into the offsets data corresponding to the given timestamp."""
    return bisect.bisect_right(self.untils, timestamp)

  def _index_dt(self, dt, favor_offset):
    """
    Helper to return the index into the offsets data corresponding to the given datetime.
    In case of ambiguous dates, will favor the given favor_offset. If it is None or doesn't match
    the later of the two offsets, will use the offset that's was in effect earlier.
    """
    timestamp = utc_to_ts_ms(dt)
    i = bisect.bisect_right(self.offset_untils, timestamp)
    if i < len(self.offset_untils) and timestamp >= self.untils[i] - self.offsets[i + 1] * 60000:
      # We have an ambiguous time and can use self.offsets[i] or self.offsets[i + 1]. If
      # favor_offset matches the later offset, use that. Otherwise, prefer the earlier one.
      if timedelta(minutes=-self.offsets[i + 1]) == favor_offset:
        return i + 1
    return i

  def get_tzinfo(self, favor_offset):
    """
    Returns a TzInfo object for this Zone that favors the given offset in case of ambiguity.
    If favor_offset is none, ambiguous times are resolved to the offset that comes into effect
    earlier. This is used with a particular offset by TzInfo.fromutc() method, which is part of
    implementation of TzInfo.astimezone(). We distinguish ambiguous times by using TzInfo variants
    that favor one offset or another for different meanings of the ambiguous times.
    """
    return (self._tzinfo.get(favor_offset) or
            self._tzinfo.setdefault(favor_offset, TzInfo(self, favor_offset)))



_zone_cache = {}

def get_zone(zonelabel):
  """Returns Zone(zonelabel), with caching."""
  return (_zone_cache.get(zonelabel) or
          _zone_cache.setdefault(zonelabel, Zone(zonelabel)))

def tzinfo(zonelabel, favor_offset=None):
  """
  Returns TzInfo instance for zonelabel, with the optional favor_offset (mainly for internal use
  by astimezone via fromutc).
  """
  return get_zone(zonelabel).get_tzinfo(favor_offset)


# Some more globals that rely on the machinery above.
TZ_UTC = tzinfo('UTC')
EPOCH_UTC = EPOCH.replace(tzinfo=TZ_UTC)    # Same as EPOCH, but an "aware" instance.
