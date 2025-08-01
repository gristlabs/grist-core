"""
The basic types in Grist include Numeric, Text, Reference, Date, and others. Each type needs a
representation in storage (database), in communication messages, and in the memory of JS and
Python interpreters. Each type also needs a convenient Python representation when used in
formulas. Any typed column may also contain values of a wrong type, and those also need a
representation. Finally, every type defines a default value, used when the column is first
created, and for new records.

For values of type int or bool, It's possible to save some memory by using JS typed arrays or
Python's array.array. However, at least on the Python side, it means that we need an additional
data structure for values of the wrong type, and the memory savings aren't that great to be worth
the extra complexity.
"""
# pylint: disable=unidiomatic-typecheck
import csv
import datetime
import io
import json
import logging
import math
import os
from collections import OrderedDict

import depend
import objtypes
from objtypes import AltText, is_int_short
import moment
from records import Record, RecordSet

log = logging.getLogger(__name__)

NoneType = type(None)

# Note that this matches the defaults in app/common/gristTypes.js
_type_defaults = {
  'Any':          None,
  'Attachments':  None,
  'Blob':         None,
  'Bool':         False,
  'Choice':       u'',
  'ChoiceList':   None,
  'Date':         None,
  'DateTime':     None,
  'Id':           0,
  'Int':          0,
  'ManualSortPos':  float('inf'),
  'Numeric':      0.0,
  'PositionNumber': float('inf'),
  'Ref':          0,
  'RefList':      None,
  'Text':         u'',
}

# Compute truthy and falsy values for Bool type here so they are not
# recomputed for every Bool conversion.
# These are the default values, which can be extended by environment variables.
_truthy_values = {"true", "yes", "1"}
_falsy_values = {"false", "no", "0"}
# If the environment variables are set, extend the truthy and falsy values.
if extra_truthy_values := os.environ.get('GRIST_TRUTHY_VALUES', ''):
  _truthy_values |= set(extra_truthy_values.lower().split(','))
if extra_falsy_values := os.environ.get('GRIST_FALSY_VALUES', ''):
  _falsy_values |= set(extra_falsy_values.lower().split(','))

def get_pure_type(col_type):
  """
  Returns type to the first colon, i.e. strips suffix for Ref:, DateTime:, etc.
  """
  return col_type.split(':', 1)[0]

def get_type_default(col_type):
  return _type_defaults.get(get_pure_type(col_type), None)

def formulaType(grist_type):
  """
  formulaType(gristType) is a decorator which saves the type as the 'grist_type' attribute
  on the decorated formula function. It allows the formula columns to be typed.
  """
  def wrapper(method):
    method.grist_type = grist_type
    return method
  return wrapper

def get_referenced_table_id(col_type):
  if col_type.startswith("Ref:"):
    return col_type[4:]
  if col_type.startswith("RefList:"):
    return col_type[8:]
  return None

def is_compatible_ref_type(type1, type2):
  """
  Returns whether type1 and type2 are Ref or RefList types with the same target table.
  """
  ref_table1 = get_referenced_table_id(type1)
  ref_table2 = get_referenced_table_id(type2)
  return bool(ref_table1 and ref_table1 == ref_table2)

def ifError(value, value_if_error):
  """
  Return `value` if it is valid, or `value_if_error` otherwise. Similar to Excel's IFERROR.
  """
  # TODO: this should ideally handle exception values and values of wrong type returned by
  # formulas, but it's unclear how to make that work.
  return value_if_error if isinstance(value, AltText) else value

_numeric_types = (float, int)
_numeric_or_none = (float, int, NoneType)

# Unique sentinel object to tell BaseColumnType constructor to use get_type_default().
_use_type_default = object()


class BaseColumnType(object):
  """
  Base class for all column types.
  """
  _global_creation_order = 0

  def __init__(self, default=_use_type_default):
    self.default = get_type_default(self.typename()) if default is _use_type_default else default
    self.default_func = None

    # Slightly silly, but it allows us to extract the order in which fields are listed in the
    # model definition, without looking back at the schema.
    self._creation_order = BaseColumnType._global_creation_order
    BaseColumnType._global_creation_order += 1

  @classmethod
  def typename(cls):
    """
    Returns the name of the type, e.g. "Int", "Ref", or "RefList".
    """
    return cls.__name__

  @classmethod
  def is_right_type(cls, _value):
    """
    Returns whether the given value belongs to this type. A cell may contain a wrong-type value
    (e.g. alttext, error), but formulas will only see right-type values, defaulting to the
    column's default.

    If is_right_type returns true, it must be possible to store the value (so with typed arrays,
    it must fit the type's restrictions).
    """
    return True

  @classmethod
  def do_convert(cls, value):
    """
    Converts a value of any type to one of our type (for which is_right_type is true) and returns
    it, or throws an exception. This is the method that should be overridden by subclasses.
    """
    return value

  def convert(self, value_to_convert):
    """
    Converts a value of any type to this type, returning either a value of the right type, or
    alttext, or error. It never throws, and should not be overridden by subclasses (override
    do_convert instead).
    """
    # Don't try to convert errors, although some day we may want to attempt it (e.g. if an error
    # contains original text, we may want to try to convert the original text).
    if isinstance(value_to_convert, objtypes.RaisedException):
      return value_to_convert

    try:
      return self.do_convert(value_to_convert)
    except Exception as e:
      # If conversion failed, return a string to serve as alttext.
      try:
        return str(value_to_convert)
      except Exception:
        # If converting to string failed, we should still produce something.
        return objtypes.safe_repr(value_to_convert)


class Text(BaseColumnType):
  """
  Text is the type for a field holding string (text) data.
  """
  @classmethod
  def do_convert(cls, value):
    if isinstance(value, bytes):
      return value.decode('utf8')
    elif value is None:
      return None
    elif isinstance(value, float) and not (math.isinf(value) or math.isnan(value)):
      # Format as integer if possible to avoid scientific notation
      # so that strings of digits that aren't meant to represent numbers convert correctly.
      # https://stackoverflow.com/questions/1848700/biggest-integer-that-can-be-stored-in-a-double
      # says that 2^53+1 is the first integer that isn't accurately stored in a float,
      # and it looks like 2^53 so we can't trust that either ;)
      if abs(value) < 2 ** 53:
        as_int = int(value)
        if value == as_int:
          return str(as_int)

      # More than 15 digits of precision can make large numbers (e.g. 2^53+1) look as if
      # they're represented exactly when they're not
      return u"%.15g" % value
    else:
      return str(value)

  @classmethod
  def is_right_type(cls, value):
    return isinstance(value, (str, NoneType))


class Blob(BaseColumnType):
  """
  Blob hold binary data.
  """
  @classmethod
  def do_convert(cls, value):
    return value

  @classmethod
  def is_right_type(cls, value):
    return isinstance(value, (bytes, NoneType))


class Any(BaseColumnType):
  """
  Any is the type that can hold any kind of value. It's used to hold computed values.
  """
  @classmethod
  def do_convert(cls, value):
    # Convert AltText values to plain text when assigning to type Any.
    return str(value) if isinstance(value, AltText) else value


class Bool(BaseColumnType):
  """
  Bool is the type for a field holding boolean data.
  """
  @classmethod
  # We'll convert any falsy value to False, non-zero numbers to True, and only strings we
  # recognize.
  # The GRIST_TRUTHY_VALUES and GRIST_FALSY_VALUES environment variables
  # can be set to extend this list.
  # Everything else will result in alttext.
  def do_convert(cls, value):
    if not value:
      return False
    if isinstance(value, _numeric_types):
      return True
    if isinstance(value, AltText):
      value = str(value)
    if isinstance(value, str):
      if value.lower() in _falsy_values:
        return False
      if value.lower() in _truthy_values:
        return True
    raise objtypes.ConversionError("Bool")

  @classmethod
  def is_right_type(cls, value):
    return isinstance(value, (bool, NoneType))


class Int(BaseColumnType):
  """
  Int is the type for a field holding integer data.
  """
  @classmethod
  def do_convert(cls, value):
    if value in ("", None):
      return None
    # Convert to float first, since python does not allow casting strings with decimals to int
    ret = int(float(value))
    if not is_int_short(ret):
      raise OverflowError("Integer value too large")
    return ret

  @classmethod
  def is_right_type(cls, value):
    return value is None or (type(value) is int and is_int_short(value))


class Numeric(BaseColumnType):
  """
  Numeric is the type for a field holding numerical data.
  """
  @classmethod
  def do_convert(cls, value):
    return float(value) if value not in ("", None) else None

  @classmethod
  def is_right_type(cls, value):
    # TODO: Python distinguishes ints from floats, while JS only has floats. A value that can be
    # interpreted as an int will upon being entered have type 'float', but after database reload
    # will have type 'int'.
    return type(value) in _numeric_or_none


class Date(Numeric):
  """
  Date is the type for a field holding date data (no timezone).
  """
  @classmethod
  def do_convert(cls, value):
    if value in ("", None):
      return None
    elif isinstance(value, datetime.datetime):
      return moment.date_to_ts(value.date())
    elif isinstance(value, datetime.date):
      return moment.date_to_ts(value)
    elif isinstance(value, _numeric_types):
      return float(value)
    elif isinstance(value, str):
      # We also accept a date in ISO format (YYYY-MM-DD), the time portion is optional and ignored
      return moment.parse_iso_date(value)
    else:
      raise objtypes.ConversionError('Date')

  @classmethod
  def is_right_type(cls, value):
    return isinstance(value, _numeric_or_none)


class DateTime(Date):
  """
  DateTime is the type for a field holding date and time data.
  """
  def __init__(self, timezone="America/New_York", default=_use_type_default):
    super(DateTime, self).__init__(default)

    try:
      self.timezone = moment.Zone(timezone)
    except KeyError:
      self.timezone = moment.Zone('UTC')

  def do_convert(self, value):
    if value in ("", None):
      return None
    elif isinstance(value, datetime.datetime):
      return moment.dt_to_ts(value, self.timezone)
    elif isinstance(value, datetime.date):
      return moment.date_to_ts(value, self.timezone)
    elif isinstance(value, _numeric_types):
      return float(value)
    elif isinstance(value, str):
      # We also accept a datetime in ISO format (YYYY-MM-DD[T]HH:mm:ss)
      return moment.parse_iso(value, self.timezone)
    else:
      raise objtypes.ConversionError('DateTime')

class Choice(Text):
  """
  Choice is the type for a field holding one of a set of acceptable string (text) values.
  TODO: Type should possibly be aware of the allowed choices, and be considered invalid
    when its value isn't one of them
  """
  pass


class ChoiceList(BaseColumnType):
  """
  ChoiceList is the type for a field holding a list of strings from a set of acceptable choices.
  """
  def do_convert(self, value):
    if not value:
      return None
    elif isinstance(value, str):
      # If it's a string that looks like JSON, try to parse it as such.
      if value.startswith('['):
        try:
          return tuple(str(item) for item in json.loads(value))
        except Exception:
          pass
      return value
    else:
      # Accepts other kinds of iterables; if that doesn't work, fail the conversion too.
      return tuple(str(item) for item in value)

  @classmethod
  def is_right_type(cls, value):
    return value is None or (isinstance(value, (tuple, list)) and
                             all(isinstance(item, str) for item in value))

  @classmethod
  def toString(cls, value):
    if isinstance(value, (tuple, list)):
      try:
        buf = io.StringIO()
        csv.writer(buf).writerow(value)
        return buf.getvalue().strip()
      except Exception:
        pass
    return value


class PositionNumber(BaseColumnType):
  """
  PositionNumber is the type for a position field used to order records in record lists.
  """
  # The 'inf' default is used by prepare_new_values() in column.py, which always changes it to
  # finite numbers, but relies on it to keep newly-added records below existing ones by default.
  @classmethod
  def do_convert(cls, value):
    return float(value) if value not in ("", None) else float('inf')

  @classmethod
  def is_right_type(cls, value):
    # Same as Numeric, but does not support None.
    return type(value) in _numeric_types


class ManualSortPos(PositionNumber):
  pass


class Id(BaseColumnType):
  """
  Id is the type for the record ID field, present automatically in each table.
  The default of 0 points to the always-present empty record. Real records start at index 1.
  """
  @classmethod
  def do_convert(cls, value):
    # Just like Int.do_convert, but skips conversion via float. This also makes it work for Record
    # types, which override int() conversion to yield the row ID. Arbitrary values should not be
    # cast to ints as it results in false hits when converting numerical values to reference ids.
    if not value:
      return 0
    if not isinstance(value, (int, Record)):
      raise TypeError("Cannot convert to Id type")
    ret = int(value)
    if not is_int_short(ret):
      raise OverflowError("Integer value too large")
    return ret

  @classmethod
  def is_right_type(cls, value):
    return (type(value) is int and is_int_short(value))


class Reference(Id):
  """
  Reference is the type for a field holding a reference into another table.

  Note that if `foo` is a Reference('Foo'), then `rec.foo` is of type `Foo.Record`. The ID of that
  record is available as `rec.foo._row_id`. It is equivalent to `rec.foo.id`, except that
  accessing `id`, as other public properties, involves a lookup in `Foo` table.
  """
  def __init__(self, table_id, reverse_of=None):
    super(Reference, self).__init__()
    self.table_id = table_id
    self._reverse_col_id = reverse_of

  @classmethod
  def typename(cls):
    return "Ref"

  def reverse_source_node(self):
    """ Returns the reverse column as depend.Node, if it exists. """
    return depend.Node(self.table_id, self._reverse_col_id) if self._reverse_col_id else None

class ReferenceList(BaseColumnType):
  """
  ReferenceList stores a list of references into another table.
  """
  def __init__(self, table_id, reverse_of=None):
    super(ReferenceList, self).__init__()
    self.table_id = table_id
    self._reverse_col_id = reverse_of

  @classmethod
  def typename(cls):
    return "RefList"

  def reverse_source_node(self):
    """ Returns the reverse column as depend.Node, if it exists. """
    return depend.Node(self.table_id, self._reverse_col_id) if self._reverse_col_id else None

  def do_convert(self, value):
    if isinstance(value, str):
      # This is second part of a "hack" we have to do when we rename tables. During
      # the rename, we briefly change all Ref columns to Int columns (to lose the table
      # part), and then back to Ref columns. The values during this change are stored
      # as serialized strings, which we expect to understand when the column is back to
      # being a Ref column. We can either end up with a list of ints, or a RecordList
      # serialized as a string.
      # TODO: explain why we need to do this and why we have chosen the Int column
      try:
        # If it's a string that looks like JSON, try to parse it as such.
        if value.startswith('['):
          parsed = json.loads(value)
          # It must be list of integers, and all of them must be positive integers.
          if (isinstance(parsed, list) and
              all(isinstance(v, int) and v > 0 for v in parsed)):
            value = parsed
        else:
        # Else try to parse it as a RecordList
          value = objtypes.RecordList.from_repr(value)
      except Exception:
        pass

    if isinstance(value, RecordSet):
      assert value._table.table_id == self.table_id
      return objtypes.RecordList(value._row_ids, group_by=value._group_by, sort_by=value._sort_by,
          sort_key=value._sort_key)
    elif not value:
      # Represent an empty ReferenceList as None (also its default value). Formulas will see [].
      return None

    # We can also have a list of RecordSet, in that case just flatten this list. This is used by
    # formulas like `Table1.lookupRecords().OtherRecords' which returns a list of RecordSets.
    elif isinstance(value, list) and all(
         isinstance(rset, RecordSet) and rset._table.table_id == self.table_id for rset in value
      ):
      row_ids_flat_list = [rec.id for rset in value for rec in rset]
      row_ids_unique_list = list(OrderedDict((el, None) for el in row_ids_flat_list).keys())
      return row_ids_unique_list

    return [Reference.do_convert(val) for val in value]

  @classmethod
  def is_right_type(cls, value):
    # TODO: whenever is_right_type isn't trivial, get_cell_value should just remember the result
    # rather than recompute it on every access. Actually this applies not only to is_right_type
    # but to everything get_cell_value does. It should use minimal-memory minimal-overhead
    # translations of raw->rich for valid values, and use what memory it needs but still guarantee
    # constant time for invalid values.
    return (value is None or
        (isinstance(value, objtypes.RecordList)) or
        (isinstance(value, list) and all(Reference.is_right_type(val) for val in value))
    )


class Attachments(ReferenceList):
  """
  Currently attachment type is the field for holding data for attachments.
  """
  def __init__(self):
    super(Attachments, self).__init__('_grist_Attachments')
