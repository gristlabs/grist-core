"""
This module implements a way to detect and convert types that's better than messytables (at least
in some relevant cases).

It has a simple interface: get_table_data(row_set) which returns a list of columns, each a
dictionary with "type" and "data" fields, where "type" is a Grist type string, and data is a list
of values. All "data" lists will have the same length.
"""

import datetime
import logging
import re
import moment # TODO grist internal libraries might not be available to plugins in the future.
import six
from six.moves import zip, xrange

log = logging.getLogger(__name__)
log.setLevel(logging.WARNING)


# Typecheck using type(value) instead of isinstance(value, some_type) makes parsing 25% faster
# pylint:disable=unidiomatic-typecheck


# Our approach to type detection is different from that of messytables.
# We first go through each cell in a sample of rows, checking if it's one of the basic
# types, and keep a count of successes for each. We use the counts to decide the basic types (e.g.
# numeric vs text). Then we go through the full data set converting to the chosen basic type.
# During this process, we keep counts of suitable Grist types to consider (e.g. Int vs Numeric).
# We use those counts to produce the selected Grist type at the end.

# Previously string values were used here for type guessing and were parsed to typed values.
# That process now happens elsewhere, and this module only handles the case
# where the imported data already contains actual numbers or dates.
# This happens for Excel sheets but not CSV files.


class BaseConverter(object):
  @classmethod
  def test(cls, value):
    try:
      cls.convert(value)
      return True
    except Exception:
      return False

  @classmethod
  def convert(cls, value):
    """Implement to convert imported value to a basic type."""
    raise NotImplementedError()

  @classmethod
  def get_grist_column(cls, values):
    """
    Given an array of values returned successfully by convert(), return a tuple of
    (grist_type_string, grist_values), where grist_values is an array of values suitable for the
    returned grist type.
    """
    raise NotImplementedError()


numeric_types = six.integer_types + (float, complex, type(None))

class NumericConverter(BaseConverter):
  """Handles the Grist Numeric type"""

  @classmethod
  def convert(cls, value):
    if type(value) is bool:
      return int(value)
    elif type(value) in numeric_types:
      return value
    raise ValueError()

  @classmethod
  def get_grist_column(cls, values):
    return ("Numeric", values)


class BooleanConverter(BaseConverter):
  """Handles the Grist Bool type"""

  @classmethod
  def convert(cls, value):
    if value is False or value is True:
      return value
    raise ValueError()

  @classmethod
  def get_grist_column(cls, values):
    return ("Bool", values)


class SimpleDateTimeConverter(BaseConverter):
  """Handles Date and DateTime values which are already instances of datetime.datetime."""

  @classmethod
  def convert(cls, value):
    if type(value) is datetime.datetime:
      return value
    elif value is None:
      return None
    raise ValueError()

  @classmethod
  def _is_date(cls, value):
    return value is None or value.time() == datetime.time()

  @classmethod
  def get_grist_column(cls, values):
    grist_type = "Date" if all(cls._is_date(v) for v in values) else "DateTime"
    grist_values = [(v if (v is None) else moment.dt_to_ts(v))
                    for v in values]
    return grist_type, grist_values


class AnyConverter(BaseConverter):
  """
  Fallback converter that converts everything to strings.
  Type guessing and parsing of the strings will happen elsewhere.
  """
  @classmethod
  def convert(cls, value):
    if value is None:
      return u''
    return six.text_type(value)

  @classmethod
  def get_grist_column(cls, values):
    return ("Any", values)


class ColumnDetector(object):
  """
  ColumnDetector accepts calls to `add_value()`, and keeps track of successful conversions to
  different basic types. At the end `get_converter()` method returns the class of the most
  suitable converter.
  """
  # Converters are listed in the order of preference, which is only used if two converters succeed
  # on the same exact number of values. Text is always a fallback.
  converters = [SimpleDateTimeConverter, BooleanConverter, NumericConverter]

  # If this many non-junk values or more can't be converted, fall back to text.
  _text_threshold = 0.10

  # Junk values: these aren't counted when deciding whether to fall back to text.
  _junk_re = re.compile(r'^\s*(|-+|\?+|n/?a)\s*$', re.I)

  def __init__(self):
    self._counts = [0] * len(self.converters)
    self._count_nonjunk = 0
    self._count_total = 0
    self._data = []

  def add_value(self, value):
    self._count_total += 1
    if value is None or (type(value) in (str, six.text_type) and self._junk_re.match(value)):
      return

    self._data.append(value)

    self._count_nonjunk += 1
    for i, conv in enumerate(self.converters):
      if conv.test(value):
        self._counts[i] += 1

  def get_converter(self):
    # We find the max by count, and secondarily by minimum index in the converters list.
    count, neg_index = max((c, -i) for (i, c) in enumerate(self._counts))
    if count > 0 and count >= self._count_nonjunk * (1 - self._text_threshold):
      return self.converters[-neg_index]
    return AnyConverter


def _guess_basic_types(rows, num_columns):
  column_detectors = [ColumnDetector() for i in xrange(num_columns)]
  for row in rows:
    for cell, detector in zip(row, column_detectors):
      detector.add_value(cell)

  return [detector.get_converter() for detector in column_detectors]


class ColumnConverter(object):
  """
  ColumnConverter converts and collects values using the passed-in converter object. At the end
  `get_grist_column()` method returns a column of converted data.
  """
  def __init__(self, converter):
    self._converter = converter
    self._all_col_values = []     # Initially this has None's for converted values
    self._converted_values = []   # A list of all converted values
    self._converted_indices = []  # Indices of the converted values into self._all_col_values

  def convert_and_add(self, value):
    # For some reason, we get 'str' type rather than 'unicode' for empty strings.
    # Correct this, since all text should be unicode.
    value = u"" if value == "" else value

    # Integer values sometimes show up as ints (from Excel), sometimes as floats (from Google).
    # Make them consistently ints; this avoid addition of ".0" suffix when converting to text.
    if type(value) == float and value.is_integer():
      value = int(value)

    try:
      conv = self._converter.convert(value)
      self._converted_values.append(conv)
      self._converted_indices.append(len(self._all_col_values))
      self._all_col_values.append(None)
    except Exception:
      self._all_col_values.append(six.text_type(value))

  def get_grist_column(self):
    """
    Returns a dictionary {"type": grist_type, "data": grist_value_array}.
    """
    grist_type, grist_values = self._converter.get_grist_column(self._converted_values)
    for i, v in zip(self._converted_indices, grist_values):
      self._all_col_values[i] = v
    return {"type": grist_type, "data": self._all_col_values}


def get_table_data(rows, num_columns, num_rows=0):
  converters = _guess_basic_types(rows[:1000], num_columns)
  col_converters = [ColumnConverter(c) for c in converters]
  for num, row in enumerate(rows):
    if num_rows and num == num_rows:
      break

    if num % 10000 == 0:
      log.info("Processing row %d", num)

    # Make sure we have a value for every column.
    missing_values = len(converters) - len(row)
    if missing_values > 0:
      row.extend([""] * missing_values)

    for cell, conv in zip(row, col_converters):
      conv.convert_and_add(cell)

  return [conv.get_grist_column() for conv in col_converters]
