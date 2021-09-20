"""This module guesses possible formats of dates which can be parsed using datetime.strptime
based on samples.

dateguesser.guess(sample)
dateguesser.guess takes a sample date string and returns a set of
datetime.strftime/strptime-compliant date format strings that will correctly parse.

dateguesser.guess_bulk(list_of_samples, error_rate=0)
dateguesser.guess_bulk takes a list of sample date strings and acceptable error rate
and returns a list of datetime.strftime/strptime-compliant date format strings
sorted by error rate that will correctly parse.

Algorithm:

  1. Tokenize input string into chunks based on character type: digits, alphas, the rest.
  2. Analyze each token independently in terms what format codes could represent
  3. For given list of tokens generate all permutations of format codes
  4. During generating permutations check for validness of generated format and skip if invalid.
  5. Use rules listed below to decide if format is invalid:

Invalid format checks:

  Rule #1: Year MUST be in the date. Year is the minimum possible parsable date.
  Rule #2. No holes (missing parts) in the format parts.
  Rule #3. Time parts are neighbors to each other. No interleaving time with the date.
  Rule #4. It's highly impossible that minutes coming before hour, millis coming before seconds etc
  Rule #5. Pattern can't have some part of date/time defined more than once.
  Rule #6: Separators between elements of the time group should be the same.
  Rule #7: If am/pm is in date we assume that 12-hour dates are allowed only. Otherwise it's 24-hour
  Rule #8: Year can't be between other date elements

Note:
  dateguess doesn't support defaulting to current year because parsing should be deterministic,
  it's better to to fail guessing the format then to guess it incorrectly.

Examples:
  >>> guess('2014/05/05 14:00:00 UTC')
  set(['%Y/%d/%m %H:%M:%S %Z', '%Y/%m/%d %H:%M:%S %Z'])
  >>> guess('12/12/12')
  set(['%y/%m/%d', '%d/%m/%y', '%m/%d/%y', '%y/%d/%m'])
  >>> guess_bulk(['12-11-2014', '12-25-2014'])
  ['%m-%d-%Y']
  >>> guess_bulk(['12-11-2014', '25-25-2014'])
  []
  >>> guess_bulk(['12-11-2013', '13-8-2013', '05-25-2013', '12-25-2013'], error_rate=0.5)
  ['%m-%d-%Y']
"""


import calendar
import itertools
import logging
import re
from collections import defaultdict

from backports.functools_lru_cache import lru_cache
import moment


MONTH_NAME = calendar.month_name
MONTH_ABBR = calendar.month_abbr
TZ_VALID_NAMES = {z[0] for z in moment.get_tz_data().items()}
AM_PM = {'am', 'pm'}
DAYS_OF_WEEK_NAME = calendar.day_name
DAYS_OF_WEEK_ABBR = calendar.day_abbr
ASCII_DIGITS_RE = re.compile(r'^[0-9]+$')

# Using x.isdigit() matches strings like u'\xb2' (superscripts) which we don't want.
# Use isdigit(x) instead, to only match ASCII digits 0-9.
isdigit = ASCII_DIGITS_RE.match

DATE_ELEMENTS = [
  # Name   Pattern  Predicate               Group (mutual exclusive)  Consumes N prev elements
  ("Year", "%Y", lambda x, p, v: isdigit(x) and len(x) == 4, "Y", 0),
  ("Year short", "%y", lambda x, p, v: isdigit(x) and len(x) == 2, "Y", 0),
  ("Month", "%m", lambda x, p, v: isdigit(x) and len(x) <= 2 and 0 < int(x) <= 12, "m", 0),
  ("Month name full", "%B", lambda x, p, v: x.isalpha() and x.capitalize() in MONTH_NAME, "m", 0),
  ("Month name abbr", "%b", lambda x, p, v: x.isalpha() and x.capitalize() in MONTH_ABBR, "m", 0),
  ("Day", "%d", lambda x, p, v: isdigit(x) and len(x) <= 2 and 0 < int(x) <= 31, "d", 0),
  ("Day of week", "%A", lambda x, p, v: x.isalpha()
                                        and x.capitalize() in DAYS_OF_WEEK_NAME, "a", 0),
  ("Day of week abbr", "%a", lambda x, p, v: x.isalpha()
                                             and x.capitalize() in DAYS_OF_WEEK_ABBR, "a", 0),

  ("Compound HHMMSS", "%H%M%S", lambda x, p, v: isdigit(x) and len(x) == 6
                                                and 0 <= int(x[0:2]) < 24
                                                and 0 <= int(x[2:4]) < 60
                                                and 0 <= int(x[4:6]) < 60, "HMS", 0),

  ("Hour", "%H", lambda x, p, v: isdigit(x) and len(x) <= 2 and 0 <= int(x) <= 23, "H", 0),
  ("Hour in 12hr mode", "%I", lambda x, p, v: isdigit(x) and len(x) <= 2
                                              and 0 <= int(x) <= 11, "H", 0),
  ("AM/PM", "%p", lambda x, p, v: x.isalpha() and len(x) == 2 and x.lower() in AM_PM, "p", 0),
  ("Minutes", "%M", lambda x, p, v: isdigit(x) and len(x) <= 2 and 0 <= int(x) <= 59, "M", 0),
  ("Seconds", "%S", lambda x, p, v: isdigit(x) and len(x) <= 2 and 0 <= int(x) <= 59, "S", 0),
  ("Fraction of second", "%f", lambda x, p, v: isdigit(x) and p is not None
                                               and p.val == '.', "f", 0),
  ("Timezone name", "%Z", lambda x, p, v: x.isalpha() and len(x) > 2
                                          and x in TZ_VALID_NAMES, "Z", 0),
  ("Timezone +HHMM", "%z", lambda x, p, v: isdigit(x) and len(x) == 4 and 0 <= int(x[0:2]) < 15
                                           and 0 <= int(x[2:4]) < 60 and p is not None
                                           and p.val == '+', "Z", 1),
  ("Timezone -HHMM", "%z", lambda x, p, v: isdigit(x) and len(x) == 4 and 0 <= int(x[0:2]) < 15
                                           and 0 <= int(x[2:4]) < 60 and p is not None
                                           and p.val == '-', "Z", 1),
]


class Token(object):
  """Represents a part of a date string that's being parsed.
  Note that __hash__ and __eq__ are overridden in order
  to compare only meaningful parts of an object.
  """
  def __init__(self, val, length):
    self.val = val
    self.length = length
    self.compatible_types = ()

  def __hash__(self):
    h = hash(self.length) + hash(self.compatible_types)
    if not self.compatible_types:
      h += hash(self.val)
    return hash(h)

  def __eq__(self, other):
    """
    Two tokens are equal when these both are true:
    a) length and compatible types are equal
    b) if it is separator (no compatible types), separator values must be equal
    """
    if self.length != other.length or self.compatible_types != other.compatible_types:
      return False
    if not other.compatible_types and self.val != other.val:
      return False
    return True


def _check_rule_1(pattern, types_used):
  """Rule #1: Year MUST be in the date. Year is the minimum possible parsable date.

  Examples:
    >>> _check_rule_1('%Y/%m/%d', 'Ymd')
    True
    >>> _check_rule_1('%m/%d', 'md')
    False
  """
  if 'Y' not in types_used:
    logging.debug("Rule #1 is violated for pattern %s. Types used: %s", pattern, types_used)
    return False
  return True


def _check_rule_2(pattern, types_used):
  """Rule #2: No holes (missing parts) in the format parts.

  Examples:
    >>> _check_rule_2('%Y:%H', 'YH')
    False
    >>> _check_rule_2('%Y/%m/%d %H', 'YmdH')
    True
  """
  priorities = 'YmdHMSf'
  seen_parts = [p in types_used for p in priorities]
  if sorted(seen_parts, reverse=True) != seen_parts:
    logging.debug("Rule #2 is violated for pattern %s. Types used: %s", pattern, types_used)
    return False
  return True


def _check_rule_3(pattern, types_used):
  """Rule #3: Time parts are neighbors to time only. No interleaving time with the date.

  Examples:
    >>> _check_rule_3('%m/%d %H:%M %Y', 'mdHMY')
    True
    >>> _check_rule_3('%m/%d %H:%Y:%M', 'mdHYM')
    False
  """
  time_parts = 'HMSf'
  time_parts_highlighted = [t in time_parts for t in types_used]
  time_parts_deduplicated = [a[0] for a in itertools.groupby(time_parts_highlighted)]
  if len(list(filter(lambda x: x, time_parts_deduplicated))) > 1:
    logging.debug("Rule #3 is violated for pattern %s. Types used: %s", pattern, types_used)
    return False
  return True


def _check_rule_4(pattern, types_used):
  """Rule #4: It's highly impossible that minutes coming before hours,
  millis coming before seconds etc.

  Examples:
    >>> _check_rule_4('%H:%M', 'HM')
    True
    >>> _check_rule_4('%S:%M', 'SM')
    False
  """
  time_parts_priority = 'HMSf'
  time_parts_indexes = list(filter(lambda x: x >= 0,
                                              [time_parts_priority.find(t) for t in types_used]))
  if sorted(time_parts_indexes) != time_parts_indexes:
    logging.debug("Rule #4 is violated for pattern %s. Types used: %s", pattern, types_used)
    return False
  return True


def _check_rule_5(pattern, types_used):
  """Rule #5: Pattern can't have some part of date/time defined more than once.

  Examples:
    >>> _check_rule_5('%Y/%Y', 'YY')
    False
    >>> _check_rule_5('%m/%b', 'mm')
    False
    >>> _check_rule_5('%Y/%m', 'Ym')
    True
  """
  if len(types_used) != len(set(types_used)):
    logging.debug("Rule #5 is violated for pattern %s. Types used: %s", pattern, types_used)
    return False
  return True


def _check_rule_6(tokens_chosen, pattern, types_used):
  """Rule #6: Separators between elements of the time group should be the same.

  Examples:
    _check_rule_5(tokens_chosen_1, '%Y-%m-%dT%H:%M:%S', 'YmdHMS') => True
    _check_rule_5(tokens_chosen_2, '%Y-%m-%dT%H %M %S', 'YmdHMS') => True
    _check_rule_5(tokens_chosen_3, '%Y-%m-%dT%H-%M:%S', 'YmdHMS') => False (different separators
                                                                  ('-' and ':') in time group)
  """
  time_parts = 'HMS'
  num_of_time_parts_used = len(list(filter(lambda x: x in time_parts, types_used)))
  time_parts_seen = 0
  separators_seen = []
  previous_was_a_separator = False

  for token in tokens_chosen:
    if token[1] is not None and token[1][3] in time_parts:
      # This rule doesn't work for separator-less time group so when we found the type
      # and it's three letters then it's (see type "Compound HHMMSS") then stop iterating
      if len(token[1][3]) == 3:
        break
      # If not a first time then
      if time_parts_seen > 0 and not previous_was_a_separator:
        separators_seen.append(None)
      time_parts_seen += 1
      if time_parts_seen == num_of_time_parts_used:
        break
      previous_was_a_separator = False
    else:
      if time_parts_seen > 0:
        separators_seen.append(token[0].val)
      previous_was_a_separator = True

  if len(set(separators_seen)) > 1:
    logging.debug("Rule #6 is violated for pattern %s. Seen separators: %s",
                  pattern, separators_seen)
    return False
  return True


def _check_rule_7a(pattern):
  """Rule #7a: If am/pm is in date we assume that 12-hour dates are allowed only.
  Otherwise it's 24-hour.

  Examples:
    >>> _check_rule_7a('%Y/%m/%d %H:%M %p')
    False
    >>> _check_rule_7a('%Y/%m/%d %I:%M %p')
    True
  """
  if '%p' in pattern and '%H' in pattern:
    logging.debug("Rule #7a is violated for pattern %s", pattern)
    return False
  return True


def _check_rule_7b(pattern):
  """Rule #7b: If am/pm is in date we assume that 12-hour dates are allowed only.
  Otherwise it's 24-hour.

  Examples:
    >>> _check_rule_7b('%Y/%m/%d %I:%M')
    False
    >>> _check_rule_7b('%Y/%m/%d %I:%M %p')
    True
  """
  if '%I' in pattern and '%p' not in pattern:
    logging.debug("Rule #7b is violated for pattern %s", pattern)
    return False
  return True


def _check_rule_8(pattern, types_used):
  """Rule #9: Year can't be between other date elements

  Examples:
    >>> _check_rule_8('%m/%Y/%d %I:%M', 'mYdIM')
    False
  """
  if 'mYd' in types_used or 'dYm' in types_used:
    logging.debug("Rule #8 is violated for pattern %s", pattern)
    return False
  return True


def _tokenize_by_character_class(s):
  """Return a list of strings by splitting s (tokenizing) by character class.

  Example:
    >>> t = _tokenize_by_character_class('Thu, May 14th, 2014 1:15 pm +0000')
    >>> [i.val for i in t]
    ['Thu', ',', ' ', 'May', ' ', '14', 'th', ',', ' ', '2014', ' ', '1', ':', '15', ' ', 'pm', ' ', '+', '0000']

    >>> t = _tokenize_by_character_class('5/14/2014')
    >>> [i.val for i in t]
    ['5', '/', '14', '/', '2014']
  """
  res = re.split(r'(\d+)|(\W)|(_)', s)
  return [Token(i, len(i)) for i in res if i]


def _sliding_triplets(tokens):
  for idx, t in enumerate(tokens):
    yield (t, tokens[idx-1] if idx > 0 else None, tokens[idx+1] if idx < len(tokens)-1 else None)


def _analyze_tokens(tokens):
  """Analize each token and find out compatible types for it."""
  for token, prev, nxt in _sliding_triplets(tokens):
    token.compatible_types = tuple([t for t in DATE_ELEMENTS if t[2](token.val, prev, nxt)])


@lru_cache()
def _generate_all_permutations(tokens):
  """Generate all permutations of format codes for given list of tokens.

  Brute-forcing of all possible permutations and rules checking eats most of the time or date
  parsing. But since the input is expected to be highly uniform then we can expect that
  memoization of this step will be very efficient.

  Token contains values for date parts but due to overridden eq and hash methods,
  we treat two tokens having the same length and same possible formats as equal
  tokens and separators should be the same
  """
  all_patterns = set()
  _generate_all_permutations_recursive(tokens, 0, [], "", all_patterns, "")

  return all_patterns


def _check_is_pattern_valid_quick_fail_rules(pattern, types_used):
  """Apply rules which are applicable for partially constructed patterns.

  Example: duplicates of a date part in a pattern.
  """
  return _check_rule_5(pattern, types_used) \
      and _check_rule_4(pattern, types_used) \
      and _check_rule_7a(pattern)


def _check_is_pattern_valid_full_pattern_rules(tokens_chosen, pattern, types_used):
  """Apply rules which are applicable for full pattern only.

  Example: existence of Year part in the pattern.
  """
  return _check_rule_1(pattern, types_used) \
      and _check_rule_2(pattern, types_used) \
      and _check_rule_3(pattern, types_used) \
      and _check_rule_6(tokens_chosen, pattern, types_used) \
      and _check_rule_7b(pattern) \
      and _check_rule_8(pattern, types_used)


def _generate_all_permutations_recursive(tokens, token_idx, tokens_chosen, pattern, found_patterns,
                                         types_used):
  """Generate all format elements permutations recursively.

  Args:
    tokens (list[Token]): List of tokens.
    token_idx (int): Index of token processing this cycle.
    tokens_chosen (list[(Token, Token.compatible_type)]): List of tuples
      containing token and compatible type
    pattern (str): String containing format for parsing
    found_patterns (set): Set of guessed patterns
    types_used (str): String of types used to build pattern.

  Returns:
    list: List of permutations
  """
  if not _check_is_pattern_valid_quick_fail_rules(pattern, types_used):
    return

  if token_idx < len(tokens):
    t = tokens[token_idx]
    if t.compatible_types:
      for ct in t.compatible_types:
        _generate_all_permutations_recursive(tokens, token_idx+1, tokens_chosen[:] + [(t, ct)],
                                             (pattern if ct[4] == 0 else pattern[:-ct[4]]) + ct[1],
                                             found_patterns, types_used + ct[3])
    else:
      # if no compatible types it should be separator, add it to the pattern
      _generate_all_permutations_recursive(tokens, token_idx+1,
                                           tokens_chosen[:] + [(t, None)], pattern + t.val,
                                           found_patterns, types_used)
  else:
    if _check_is_pattern_valid_full_pattern_rules(tokens_chosen, pattern, types_used):
      found_patterns.add(pattern)


def guess(date):
  """Guesses datetime.strftime/strptime-compliant date formats for date string.

  Args:
    date (str): Date string.

  Returns:
    set: Set of datetime.strftime/strptime-compliant date format strings

  Examples:
    >>> guess('2014/05/05 14:00:00 UTC')
    set(['%Y/%d/%m %H:%M:%S %Z', '%Y/%m/%d %H:%M:%S %Z'])
    >>> guess('12/12/12')
    set(['%y/%m/%d', '%d/%m/%y', '%m/%d/%y', '%y/%d/%m'])
  """
  # Don't attempt to parse strings that are so long as to be certainly non-dates. Somewhat long
  # strings could be dates (like "Wednesday, September 16, 2020 A.D. 08:47:02.2667911 AM -06:00",
  # and who knows what other languages do). A limit is important also because the current approach
  # can run into "maximum recursion depth exceeded" on a very long string.
  if len(date) > 150:
    return set()
  tokens = _tokenize_by_character_class(date)
  _analyze_tokens(tokens)
  return _generate_all_permutations(tuple(tokens))


def guess_bulk(dates, error_rate=0):
  """Guesses datetime.strftime/strptime-compliant date formats for list of the samples.

  Args:
    dates (list): List of samples date strings.
    error_rate (float): Acceptable error rate (default 0.0)

  Returns:
    list: List of datetime.strftime/strptime-compliant date format strings sorted by error rate

  Examples:
    >>> guess_bulk(['12-11-2014', '12-25-2014'])
    ['%m-%d-%Y']
    >>> guess_bulk(['12-11-2014', '25-25-2014'])
    []
    >>> guess_bulk(['12-11-2013', '13-8-2013', '05-25-2013', '12-25-2013'], error_rate=0.5)
    ['%m-%d-%Y']
  """
  if error_rate == 0.0:
    patterns = None
    for date in dates:
      guesses_patterns = guess(date)
      if patterns is None:
        patterns = guesses_patterns
      else:
        patterns = patterns.intersection(guesses_patterns)
      if not patterns:
        break   # No need to iterate more if zero patterns found
    return list(patterns)
  else:
    found_dates = 0
    pattern_counters = defaultdict(lambda: 0)
    num_dates = len(dates)
    min_num_dates_to_be_found = num_dates - num_dates * error_rate

    for idx, date in enumerate(dates):
      patterns = guess(date)
      if patterns:
        found_dates += 1
      for pattern in patterns:
        pattern_counters[pattern] = pattern_counters[pattern] + 1

      # Early return if number of strings that can't be date is already over error rate
      cells_left = num_dates - idx - 1
      cannot_be_found = float(found_dates + cells_left) < min_num_dates_to_be_found
      if cannot_be_found:
        return []

    patterns = [(v, k) for k, v in pattern_counters.items()
                if v > min_num_dates_to_be_found]
    patterns.sort(reverse=True)
    return [k for (v, k) in patterns]
