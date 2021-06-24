import re
from collections import OrderedDict
from datetime import datetime
import moment

# Regex list of lowercase months with characters after the first three made optional
MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december']
MONTHS = [m[:3]+"(?:"+m[3:]+")?" if len(m) > 3 else m[:3] for m in MONTH_NAMES]
# Regex list of lowercase weekdays with characters after the first three made optional
DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
WEEKDAYS = [d[:3]+"(?:"+d[3:]+")?" for d in DAY_NAMES]

# Acceptable format tokens mapped to what they should match in the date string
# Ordered so that larger configurations are matched first
DATE_TOKENS = OrderedDict([
  ("HH",      r"(?P<H>\d{1,2})"),          # 24 hr
  ("H",       r"(?P<H>\d{1,2})"),
  ("hh",      r"(?P<h>\d{1,2})"),          # 12 hr
  ("h",       r"(?P<h>\d{1,2})"),
  ("mm",      r"(?P<m>\d{1,2})"),          # min
  ("m",       r"(?P<m>\d{1,2})"),
  ("A",       r"(?P<A>[ap]m?)"),           # am/pm
  ("a",       r"(?P<A>[ap]m?)"),
  ("ss",      r"(?P<s>\d{1,2})"),          # sec
  ("s",       r"(?P<s>\d{1,2})"),
  ("SSSSSS",  r"(?P<S>\d{1,6})"),          # fractional second
  ("SSSSS",   r"(?P<S>\d{1,6})"),
  ("SSSS",    r"(?P<S>\d{1,6})"),
  ("SSS",     r"(?P<S>\d{1,6})"),
  ("SS",      r"(?P<S>\d{1,6})"),
  ("S",       r"(?P<S>\d{1,6})"),
  ("YYYY",    r"(?P<YY>\d{4}|\d{2})"),     # 4 or 2 digit year
  ("YY",      r"(?P<YY>\d{2})"),           # 2 digit year
  ("MMMM",    r"(?P<MMM>" + ("|".join(MONTHS)) + ")"),  # month name, abbr or not
  ("MMM",     r"(?P<MMM>" + ("|".join(MONTHS)) + ")"),
  ("MM",      r"(?P<M>\d{1,2})"),          # month num
  ("M",       r"(?P<M>\d{1,2})"),
  ("DD",      r"(?P<D>\d{1,2})"),          # day num
  ("Do",      r"(?P<D>\d{1,2})(st|nd|rd|th)"),
  ("D",       r"(?P<D>\d{1,2})"),
  ("dddd",    r"(" + ("|".join(WEEKDAYS)) + ")"),  # day name, abbr or not (ignored)
  ("ddd",     r"(" + ("|".join(WEEKDAYS)) + ")")
])
DATE_TOKENS_REGEX = re.compile("("+("|".join(DATE_TOKENS))+")")

# List of separators to replace and match any standard date/time separators
SEP = r"[\s/.\-:,]*"
SEP_REGEX = re.compile(SEP)
SEP_REPLACEMENT = SEP.replace("\\", "\\\\")

# Maps date parse format to compile regex
FORMAT_CACHE = {}

# Parses date_string using parse_format in the style of moment.js
# See: http://momentjs.com/docs/#/parsing
# Supports the following tokens:
# H HH      0..23 24        hour time
# h hh      1..12 12        hour time used with a A.
# a A       am pm           Post or ante meridiem
# m mm      0..59           Minutes
# s ss      0..59           Seconds
# S SS SSS  0..999          Fractional seconds
# YYYY      2014            4 or 2 digit year
# YY        14              2 digit year
# M MM      1..12           Month number
# MMM MMMM  Jan..December   Month name in locale set by moment.locale()
# D DD      1..31           Day of month
# Do        1st..31st       Day of month with ordinal
def parse(date_string, parse_format, zonelabel='UTC', override_current_date=None):
  """Parse a date string via a moment.js style parse format and a timezone string.
     Supported tokens are documented above. Returns seconds since epoch"""

  if parse_format in FORMAT_CACHE:
    # Check if parse_format has been cache, and retrieve if so
    parser = FORMAT_CACHE[parse_format]
  else:
    # e.g. "MM-YY" -> "(?P<mm>\d{1,2})-(?P<yy>\d{2})"
    # Note that DATE_TOKENS is ordered so that the longer letter chains are recognized first
    tokens = DATE_TOKENS_REGEX.split(parse_format)
    tokens = [DATE_TOKENS[t] if t in DATE_TOKENS else SEP_REGEX.sub(SEP_REPLACEMENT, t)
              for t in tokens]

    # Compile new token string ignoring case (for month names)
    parser = re.compile(''.join(tokens), re.I)
    FORMAT_CACHE[parse_format] = parser

  match = parser.match(date_string)

  # Throw error if matching failed
  if match is None:
    raise Exception("Failed to parse %s with %s" % (date_string, parse_format))

  # Create datetime from the results of parsing
  current_date = override_current_date or moment.CURRENT_DATE
  m = match.groupdict()
  dt = datetime(
    year=getYear(m, current_date.year),
    month=getMonth(m, current_date.month),
    day=int(m['D']) if ('D' in m) else current_date.day,
    hour=getHour(m),
    minute=int(m['m']) if ('m' in m) else 0,
    second=int(m['s']) if ('s' in m) else 0,
    microsecond=getMicrosecond(m)
  )

  # Parses the datetime with the given timezone to return the seconds since EPOCH
  return moment.tz(dt, zonelabel).timestamp_s()


def getYear(match_dict, current_year):
  if 'YYYY' in match_dict:
    return int(match_dict['YYYY'])
  elif 'YY' in match_dict:
    match = match_dict['YY']
    if len(match) == 2:
      # Must guess on the century, choose so the result is closest to the current year
      # The first year that could be meant by YY is the current year - 50.
      first = current_year - 50
      # We are seeking k such that 100k + YY is between first and first + 100.
      # first <= 100k + YY  < first + 100
      # 0 <= 100k + YY - first < 100
      # The value inside the comparison operators is precisely (YY - first) % 100.
      # So we can calculate the century 100k as (YY - first) % 100 - (YY - first).
      return first + (int(match) - first) % 100
    else:
      return int(match)
  else:
    return current_year

def getMonth(match_dict, current_month):
  if 'M' in match_dict:
    return int(match_dict['M'])
  elif 'MMM' in match_dict:
    return lazy_index(MONTHS, match_dict['MMM'][:3].lower()) + 1
  else:
    return current_month

def getHour(match_dict):
  if 'H' in match_dict:
    return int(match_dict['H'])
  elif 'h' in match_dict:
    hr = int(match_dict['h']) % 12
    merid = 12 if 'A' in match_dict and match_dict['A'][0] == "p" else 0
    return hr + merid
  else:
    return 0

def getMicrosecond(match_dict):
  if 'S' in match_dict:
    match = match_dict['S']
    return int(match + ("0"*(6-len(match))) if len(match) < 6 else match[:6])
  else:
    return 0

# Gets the index of the first string from iter that starts with startswith
def lazy_index(l, startswith, missing=None):
  for i, token in enumerate(l):
    if token[:len(startswith)] == startswith:
      return i
  return missing
