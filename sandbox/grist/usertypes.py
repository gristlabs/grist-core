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
import datetime
import six
import objtypes
from objtypes import AltText
import moment
import logger
from records import Record, RecordSet
log = logger.Logger(__name__, logger.INFO)

NoneType = type(None)

def strict_equal(a, b):
  """Checks the equality of the types of the values as well as the values."""
  # pylint: disable=unidiomatic-typecheck
  return type(a) == type(b) and a == b

# Note that this matches the defaults in app/common/gristTypes.js
_type_defaults = {
  'Any':          None,
  'Attachments':  None,
  'Blob':         None,
  'Bool':         False,
  'Choice':       '',
  'Date':         None,
  'DateTime':     None,
  'Id':           0,
  'Int':          0,
  'ManualSortPos':  float('inf'),
  'Numeric':      0.0,
  'PositionNumber': float('inf'),
  'Ref':          0,
  'RefList':      None,
  'Text':         '',
}

def get_type_default(col_type):
  col_type = col_type.split(':', 1)[0]      # Strip suffix for Ref:, DateTime:, etc.
  return _type_defaults.get(col_type, None)

def formulaType(grist_type):
  """
  formulaType(gristType) is a decorator which saves the type as the 'grist_type' attribute
  on the decorated formula function. It allows the formula columns to be typed.
  """
  def wrapper(method):
    method.grist_type = grist_type
    return method
  return wrapper


def ifError(value, value_if_error):
  """
  Return `value` if it is valid, or `value_if_error` otherwise. Similar to Excel's IFERROR.
  """
  # TODO: this should ideally handle exception values and values of wrong type returned by
  # formulas, but it's unclear how to make that work.
  return value_if_error if isinstance(value, AltText) else value


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
        if isinstance(value_to_convert, six.text_type):
          # str() will fail for a non-ascii unicode object, which needs an explicit encoding.
          return value_to_convert.encode('utf8')
        return str(value_to_convert)
      except Exception:
        # If converting to string failed, we should still produce something.
        return objtypes.safe_repr(value_to_convert)


  # This is a user-facing method, hence the camel-case naming, as for `lookupRecords` and such.
  @classmethod
  def typeConvert(cls, value):
    """
    Convert a value from a different type to something that this type can accept, as when
    explicitly converting a column type. Note that usual conversion (such as converting numbers to
    strings or vice versa) will still apply to the returned value.
    """
    return value


class Text(BaseColumnType):
  """
  Text is the type for a field holding string (text) data.
  """
  @classmethod
  def do_convert(cls, value):
    return str(value) if value is not None else None

  @classmethod
  def is_right_type(cls, value):
    return isinstance(value, (basestring, NoneType))

  @classmethod
  def typeConvert(cls, value):
    # When converting NULLs (that typically show up as a plain empty cell for Numeric or Date
    # columns) to Text, it makes more sense to end up with a plain blank text cell.
    return '' if value is None else value


class Blob(BaseColumnType):
  """
  Blob hold binary data.
  """
  @classmethod
  def do_convert(cls, value):
    return str(value) if value is not None else None

  @classmethod
  def is_right_type(cls, value):
    return isinstance(value, (basestring, NoneType))


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
  def do_convert(cls, value):
    # We'll convert any falsy value to False, non-zero numbers to True, and only strings we
    # recognize. Everything else will result in alttext.
    if not value:
      return False
    if isinstance(value, (float, int, long)):
      return True
    if isinstance(value, AltText):
      value = str(value)
    if isinstance(value, basestring):
      if value.lower() in ("false", "no", "0"):
        return False
      if value.lower() in ("true", "yes", "1"):
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
    if not objtypes.is_int_short(ret):
      raise OverflowError("Integer value too large")
    return ret

  @classmethod
  def is_right_type(cls, value):
    return value is None or (isinstance(value, (int, long)) and not isinstance(value, bool) and
      objtypes.is_int_short(value))


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
    return isinstance(value, (float, int, long, NoneType)) and not isinstance(value, bool)


class Date(Numeric):
  """
  Date is the type for a field holding date data (no timezone).
  """
  @classmethod
  def do_convert(cls, value):
    if value in ("", None):
      return None
    elif isinstance(value, datetime.datetime):
      return moment.dt_to_ts(value)
    elif isinstance(value, datetime.date):
      return moment.date_to_ts(value)
    elif isinstance(value, (float, int, long)):
      return float(value)
    elif isinstance(value, basestring):
      # We also accept a date in ISO format (YYYY-MM-DD), the time portion is optional and ignored
      return moment.parse_iso_date(value)
    else:
      raise objtypes.ConversionError('Date')

  @classmethod
  def is_right_type(cls, value):
    return isinstance(value, (float, int, long, NoneType))

  @classmethod
  def typeConvert(cls, value, date_format, timezone='UTC'):   # pylint: disable=arguments-differ
    # Note: the timezone argument is used in DateTime conversions, allows sharing this method.
    try:
      return moment.parse(value, date_format, timezone)
    except Exception:
      return value

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
    elif isinstance(value, (float, int, long)):
      return float(value)
    elif isinstance(value, basestring):
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
    return isinstance(value, (float, int, long)) and not isinstance(value, bool)


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
    if not objtypes.is_int_short(ret):
      raise OverflowError("Integer value too large")
    return ret

  @classmethod
  def is_right_type(cls, value):
    return (isinstance(value, (int, long)) and not isinstance(value, bool) and
      objtypes.is_int_short(value))


class Reference(Id):
  """
  Reference is the type for a field holding a reference into another table.

  Note that if `foo` is a Reference('Foo'), then `rec.foo` is of type `Foo.Record`. The ID of that
  record is available as `rec.foo._row_id`. It is equivalent to `rec.foo.id`, except that
  accessing `id`, as other public properties, involves a lookup in `Foo` table.
  """
  def __init__(self, table_id):
    super(Reference, self).__init__()
    self.table_id = table_id

  @classmethod
  def typename(cls):
    return "Ref"

  @classmethod
  def typeConvert(cls, value, ref_table, visible_col=None):  # pylint: disable=arguments-differ
    if ref_table and visible_col:
      return ref_table.lookupOne(**{visible_col: value}) or str(value)
    else:
      return value


class ReferenceList(BaseColumnType):
  """
  ReferenceList stores a list of references into another table.
  """
  def __init__(self, table_id):
    super(ReferenceList, self).__init__()
    self.table_id = table_id

  @classmethod
  def typename(cls):
    return "RefList"

  def do_convert(self, value):
    if isinstance(value, RecordSet):
      assert value._table.table_id == self.table_id
      return objtypes.RecordList(value._row_ids, group_by=value._group_by, sort_by=value._sort_by)
    elif not value:
      return []
    return [Reference.do_convert(val) for val in value]

  @classmethod
  def is_right_type(cls, value):
    return value is None or (isinstance(value, list) and
                             all(Reference.is_right_type(val) for val in value))

class Attachments(ReferenceList):
  """
  Currently attachment type is the field for holding data for attachments.
  """
  def __init__(self):
    super(Attachments, self).__init__('_grist_Attachments')
