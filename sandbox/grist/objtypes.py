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
import traceback
from datetime import date, datetime
from math import isnan

import six

import friendly_errors
import moment
import records
import depend


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

# A placeholder for a value hidden by access control rules.
# Depending on the types of the columns involved, copying
# a censored value and pasting elsewhere will either use
# CensoredValue.__repr__ (python) or CensoredValue.toString (typescript)
# so they should match
class CensoredValue(object):
  def __repr__(self):
    return 'CENSORED'

_censored_sentinel = CensoredValue()


def is_int_short(value):
  return -(1<<31) <= value < (1<<31)

def safe_shift(arg, default=None):
  value = arg.pop(0) if arg else None
  return default if value is None else value

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
  # Compare NaNs as equal.
  if isinstance(a, float) and isinstance(b, float):
    return a == b or (isnan(a) and isnan(b))

  # Compare bools as equal only to bools (these are distinguishable from numbers in JSON, and we
  # take care to distinguish them in DB too).
  if isinstance(a, bool) or isinstance(b, bool):
    # pylint: disable=unidiomatic-typecheck
    return type(a) == type(b) and a == b

  # Note for simple types, encode_object is trivial, and will result in a non-type-specific
  # comparison (e.g. 1 and 1.0 will compare equal, as would "a" and u"a"). This is to capture
  # equivalence of values in their JSON representations.
  return encode_object(a) == encode_object(b)

def encode_object(value):
  """
  Produces a Grist-encoded version of the value, e.g. turning a Date into ['d', timestamp].
  Returns ['U', repr(value)] if it fails to encode otherwise.
  """
  try:
    if isinstance(value, (six.text_type, float, bool)) or value is None:
      return value
    elif isinstance(value, six.binary_type):
      return value.decode('utf8')
    elif isinstance(value, six.integer_types):
      if not is_int_short(value):
        raise UnmarshallableError("Integer too large")
      return value
    elif isinstance(value, AltText):
      return six.text_type(value)
    elif isinstance(value, records.Record):
      return ['R', value._table.table_id, value._row_id]
    elif isinstance(value, RecordStub):
      return ['R', value.table_id, value.row_id]
    elif isinstance(value, datetime):
      return ['D', moment.dt_to_ts(value), value.tzinfo.zone.name if value.tzinfo else 'UTC']
    elif isinstance(value, date):
      return ['d', moment.date_to_ts(value)]
    elif isinstance(value, RaisedException):
      return ['E'] + value.encode_args()
    elif isinstance(value, (list, tuple)):
      return ['L'] + [encode_object(item) for item in value]
    elif isinstance(value, records.RecordSet):
      return ['r', value._table.table_id, value._get_encodable_row_ids()]
    elif isinstance(value, RecordSetStub):
      return ['r', value.table_id, value.row_ids]
    elif isinstance(value, dict):
      if not all(isinstance(key, six.string_types) for key in value):
        raise UnmarshallableError("Dict with non-string keys")
      return ['O', {key: encode_object(val) for key, val in six.iteritems(value)}]
    elif value == _pending_sentinel:
      return ['P']
    elif value == _censored_sentinel:
      return ['C']
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
      return value
    code = value[0]
    args = value[1:]
    if code == 'R':
      return RecordStub(args[0], args[1])
    elif code == 'r':
      return RecordSetStub(args[0], args[1])
    elif code == 'D':
      return moment.ts_to_dt(args[0], moment.Zone(args[1]))
    elif code == 'd':
      return moment.ts_to_date(args[0])
    elif code == 'E':
      return RaisedException.decode_args(*args)
    elif code == 'L':
      return [decode_object(item) for item in args]
    elif code == 'l':
      return ReferenceLookup(*args)
    elif code == 'O':
      return {decode_object(key): decode_object(val) for key, val in six.iteritems(args[0])}
    elif code == 'P':
      return _pending_sentinel
    elif code == 'C':
      return _censored_sentinel
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

  When user_input is passed, RaisedException(ValueError("foo"), user_input=2) is encoded as:
  ["E", "ValueError", "foo", {u: 2}].
  """

  # Marker object that indicates that there was no user input.
  NO_INPUT = object()

  def __init__(self, error, include_details=False, user_input=NO_INPUT):
    self.user_input = user_input
    self.error = error
    self.details = None
    self._encoded_error = None
    self._name = None
    self._message = None
    if error is not None:
      self._fill_from_error(self.has_user_input(), include_details)
      error.__traceback__ = None

  def encode_args(self):
    if self._encoded_error is not None:
      return self._encoded_error
    if self.has_user_input():
      user_input = {"u": encode_object(self.user_input)}
    else:
      user_input = None
    result = [self._name, self._message, self.details, user_input]
    # Trim last values that are None
    while len(result) > 1 and result[-1] is None:
      result.pop()
    self._encoded_error = result
    return result

  def _fill_from_error(self, include_message=False, include_details=False):
    # TODO: We should probably return all args, to communicate the error details to the browser
    # and to DB (for when we store formula results). There are two concerns: one is that it's
    # potentially quite verbose; the other is that it's makes the tests more annoying (again b/c
    # verbose).
    error = self.error
    location = ""
    while isinstance(error, CellError):
      if not location:
        location = "\n(in referenced cell {error.location})".format(error=error)
      error = error.error
    self._name = type(error).__name__
    if include_details:
      self.details = traceback.format_exc()
      self._message = str(error) + location
      if not (isinstance(error, (SyntaxError, depend.CircularRefError)) or error != self.error):
        # For SyntaxError, the friendly message was already added earlier.
        # CircularRefError and CellError are Grist-specific and have no friendly message.
        self._message += friendly_errors.friendly_message(error)
    elif isinstance(error, InvalidTypedValue):
      self._message = error.typename
      self.details = error.value
    elif include_message:
      self._message = str(error) + location

  def has_user_input(self):
    return self.user_input is not RaisedException.NO_INPUT

  def no_traceback(self):
    exc = RaisedException(None)
    exc._name = self._name
    exc.error = self.error
    exc.user_input = self.user_input
    exc.details = "This error is left over from before, and " + \
                  "the formula hasn't been triggered since then."
    exc._message = self._message
    return exc

  @classmethod
  def decode_args(cls, *args):
    exc = cls(None)
    args = list(args)
    assert args
    exc._name = safe_shift(args)
    exc._message = safe_shift(args)
    exc.details = safe_shift(args)
    exc.user_input = safe_shift(args, {})
    exc.user_input = decode_object(exc.user_input.get("u", RaisedException.NO_INPUT))
    return exc

class CellError(Exception):
  def __init__(self, table_id, col_id, row_id, error):
    super(CellError, self).__init__(table_id, col_id, row_id, error)
    self.table_id = table_id
    self.col_id = col_id
    self.row_id = row_id
    self.error = error

  def __str__(self):
    return (
      "{self.error.__class__.__name__} in referenced cell {self.location}"
    ).format(self=self)

  @property
  def location(self):
    return "{self.table_id}[{self.row_id}].{self.col_id}".format(self=self)


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
    return "RecordList(%s, group_by=%r, sort_by=%r)" % (
      list.__repr__(self), self._group_by, self._sort_by)



# We don't currently have a good way to convert an incoming marshalled record to a proper Record
# object for an appropriate table. We don't expect incoming marshalled records at all, but if such
# a thing happens, we'll construct this RecordStub.
class RecordStub(object):
  def __init__(self, table_id, row_id):
    self.table_id = table_id
    self.row_id = row_id


class RecordSetStub(object):
  def __init__(self, table_id, row_ids):
    self.table_id = table_id
    self.row_ids = row_ids


class ReferenceLookup(object):
  def __init__(self, value, options=None):
    self.value = value
    self.options = options or {}

  @property
  def alt_text(self):
    result = self.options.get("raw")
    if result is None:
      values = self.value
      if not isinstance(values, list):
        values = [values]
      result = ", ".join(map(six.text_type, values))
    return result
