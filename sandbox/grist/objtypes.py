"""
This module implements handling of non-primitive objects as values in Grist data cells. It is
currently only used to handle errors thrown from formulas.

Non-primitive values are represented in actions as [type_name, args...].
  objtypes.register_converter() - registers a new supported object type.
  objtypes.encode_object(obj)   - returns a marshallable list representation.
  objtypes.decode_object(val)   - returns an object represented by the [name, args...] argument.

If an object cannot be encoded or decoded, an "UnmarshallableValue" is returned instead
of the form ['U', repr(obj)].
"""
# pylint: disable=too-many-return-statements
import exceptions
import traceback
from datetime import date, datetime
from math import isnan

import moment
import records


class UnmarshallableError(ValueError):
  """
  Error raised when an object cannot be represented in an action by Grist. It happens if the
  object is of a type for which there is no registered converter, or if encoding it involves
  values that cannot be marshalled.
  """
  pass


class ConversionError(ValueError):
  """
  Indicates a failure to convert a value between Grist types. We don't usually expose it to the
  user, since such a failure normally results in silent alttext.
  """
  pass


class InvalidTypedValue(ValueError):
  """
  Indicates that AltText was in place of a typed value and produced an error. The value of AltText
  is included into the exception, both to be more informative, and to sort displayCols properly.
  """
  def __init__(self, typename, value):
    super(InvalidTypedValue, self).__init__(typename)
    self.typename = typename
    self.value = value

  def __str__(self):
    return "Invalid %s: %s" % (self.typename, self.value)


class AltText(object):
  """
  Represents a text value in a non-text column. The separate class allows formulas to access
  wrong-type values. We use a wrapper rather than expose text directly to formulas, because with
  text there is a risk that e.g. a formula that's supposed to add numbers would add two strings
  with unexpected result.
  """
  def __init__(self, text, typename=None):
    self._text = text
    self._typename = typename

  def __str__(self):
    return self._text

  def __int__(self):
    # This ensures that AltText values that look like ints may be cast back to int.
    # Convert to float first, since python does not allow casting strings with decimals to int.
    return int(float(self._text))

  def __float__(self):
    # This ensures that AltText values that look like floats may be cast back to float.
    return float(self._text)

  def __repr__(self):
    return '%s(%r)' % (self.__class__.__name__, self._text)

  # Allow comparing to AltText("something")
  def __eq__(self, other):
    return isinstance(other, self.__class__) and self._text == other._text

  def __ne__(self, other):
    return not self.__eq__(other)

  def __hash__(self):
    return hash((self.__class__, self._text))

  def __getattr__(self, name):
    # On attempt to do $foo.Bar on an AltText value such as "hello", raise an exception that will
    # show up as e.g. "Invalid Ref: hello" or "Invalid Date: hello".
    raise InvalidTypedValue(self._typename, self._text)


class UnmarshallableValue(object):
  """
  Represents an UnmarshallableValue. There is nothing we can do with it except encode it back.
  """
  def __init__(self, value_repr):
    self.value_repr = value_repr


# Unique sentinel value representing a pending value. It's encoded as ['P'], and shown to the user
# as "Loading..." text. With the switch to stored formulas, it's currently only used when a
# document was just migrated.
_pending_sentinel = object()


_max_js_int = 1<<31

def is_int_short(value):
  return -_max_js_int <= value < _max_js_int

def safe_repr(obj):
  """
  Like repr(obj) but falls back to a simpler "<type-name>" string when repr() itself fails.
  """
  try:
    return repr(obj)
  except Exception:
    return '<' + type(obj).__name__ + '>'

def strict_equal(a, b):
  """Checks the equality of the types of the values as well as the values, and handle errors."""
  # pylint: disable=unidiomatic-typecheck
  # Try/catch needed because some comparisons may fail (e.g. datetimes with different tzinfo)
  try:
    return type(a) == type(b) and a == b
  except Exception:
    return False

def equal_encoding(a, b):
  # pylint: disable=unidiomatic-typecheck
  if isinstance(a, (str, unicode, bool, long, int)) or a is None:
    return type(a) == type(b) and a == b
  if isinstance(a, float):
    return type(a) == type(b) and (a == b or (isnan(a) and isnan(b)))
  return encode_object(a) == encode_object(b)

def encode_object(value):
  """
  Produces a Grist-encoded version of the value, e.g. turning a Date into ['d', timestamp].
  Returns ['U', repr(value)] if it fails to encode otherwise.
  """
  try:
    if isinstance(value, (str, unicode, float, bool)) or value is None:
      return value
    elif isinstance(value, (long, int)):
      if not is_int_short(value):
        raise UnmarshallableError("Integer too large")
      return value
    elif isinstance(value, AltText):
      return str(value)
    elif isinstance(value, records.Record):
      return ['R', value._table.table_id, value._row_id]
    elif isinstance(value, datetime):
      return ['D', moment.dt_to_ts(value), value.tzinfo.zone.name if value.tzinfo else 'UTC']
    elif isinstance(value, date):
      return ['d', moment.date_to_ts(value)]
    elif isinstance(value, RaisedException):
      return ['E'] + value.encode_args()
    elif isinstance(value, (list, tuple, RecordList, records.ColumnView)):
      return ['L'] + [encode_object(item) for item in value]
    elif isinstance(value, records.RecordSet):
      # Represent RecordSet (e.g. result of lookupRecords) in the same way as a RecordList.
      return ['L'] + [encode_object(int(item)) for item in value]
    elif isinstance(value, dict):
      if not all(isinstance(key, basestring) for key in value):
        raise UnmarshallableError("Dict with non-string keys")
      return ['O', {key: encode_object(val) for key, val in value.iteritems()}]
    elif value == _pending_sentinel:
      return ['P']
    elif isinstance(value, UnmarshallableValue):
      return ['U', value.value_repr]
  except Exception as e:
    pass
  # We either don't know how to convert the value, or failed during the conversion. Instead we
  # return an "UnmarshallableValue" object, with repr() of the value to show to the user.
  return ['U', safe_repr(value)]

def decode_object(value):
  """
  Given a Grist-encoded value, returns an object represented by it.
  If typename is unknown, or construction fails for any reason, returns (not raises!)
  RaisedException with the original exception in its .error property.
  """
  try:
    if not isinstance(value, (list, tuple)):
      if isinstance(value, unicode):
        # TODO For now, the sandbox uses binary strings throughout; see TODO in main.py for more
        # on this. Strings that come from JS become Python binary strings, and we will not see
        # unicode here. But we may see it if unmarshalling data that comes from DB, since
        # DocStorage encodes/decodes values by marshaling JS strings as unicode. For consistency,
        # convert those unicode strings to binary strings too.
        return value.encode('utf8')
      return value
    code = value[0]
    args = value[1:]
    if code == 'R':
      return RecordStub(args[0], args[1])
    elif code == 'D':
      return moment.ts_to_dt(args[0], moment.Zone(args[1]))
    elif code == 'd':
      return moment.ts_to_date(args[0])
    elif code == 'E':
      return RaisedException.decode_args(*args)
    elif code == 'L':
      return [decode_object(item) for item in args]
    elif code == 'O':
      return {decode_object(key): decode_object(val) for key, val in args[0].iteritems()}
    elif code == 'P':
      return _pending_sentinel
    elif code == 'U':
      return UnmarshallableValue(args[0])
    raise KeyError("Unknown object type code %r" % code)
  except Exception as e:
    return RaisedException(e)

#----------------------------------------------------------------------

class RaisedException(object):
  """
  RaisedException is a special type of object which indicates that a value in a cell isn't a plain
  value but an exception to be raised. All caught exceptions are wrapped in RaisedException. The
  original exception is saved in the .error attribute. The traceback is saved in .details
  attribute only when needed (flag include_details is set).

  RaisedException is registered under a special short name ("E") to save bytes since it's such a
  widely-used wrapper. To encode_args, it simply returns the entire encoded stored error, e.g.
  RaisedException(ValueError("foo")) is encoded as ["E", "ValueError", "foo"].
  """
  def __init__(self, error, include_details=False):
    self.error = error
    self.details = traceback.format_exc() if include_details else None

  def encode_args(self):
    # TODO: We should probably return all args, to communicate the error details to the browser
    # and to DB (for when we store formula results). There are two concerns: one is that it's
    # potentially quite verbose; the other is that it's makes the tests more annoying (again b/c
    # verbose).
    if self.details:
      return [type(self.error).__name__, str(self.error), self.details]
    if isinstance(self.error, InvalidTypedValue):
      return [type(self.error).__name__, self.error.typename, self.error.value]
    return [type(self.error).__name__]

  @classmethod
  def decode_args(cls, *args):
    # Decoding of a RaisedException is currently only used in tests.
    name = args[0]
    exc_type = getattr(exceptions, name)
    assert isinstance(exc_type, type) and issubclass(exc_type, BaseException)
    return cls(exc_type(*args[1:]))

  def __eq__(self, other):
    return isinstance(other, type(self)) and self.encode_args() == other.encode_args()

  def __ne__(self, other):
    return not self.__eq__(other)


class RecordList(list):
  """
  Just like list but allows setting custom attributes, which we use for remembering _group_by and
  _sort_by attributes when storing RecordSet as usertypes.ReferenceList type.
  """
  def __init__(self, row_ids, group_by=None, sort_by=None):
    list.__init__(self, row_ids)
    self._group_by = group_by
    self._sort_by = sort_by

  def __repr__(self):
    return "RecordList(%r, group_by=%r, sort_by=%r)" % (
      list.__repr__(self), self._group_by, self._sort_by)



# We don't currently have a good way to convert an incoming marshalled record to a proper Record
# object for an appropriate table. We don't expect incoming marshalled records at all, but if such
# a thing happens, we'll construct this RecordStub.
class RecordStub(object):
  def __init__(self, table_id, row_id):
    self.table_id = table_id
    self.row_id = row_id
