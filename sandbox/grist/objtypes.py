"""
This module implements handling of non-primitive objects as values in Grist data cells. It is
currently only used to handle errors thrown from formulas.

Non-primitive values are represented in actions as [type_name, args...].
  objtypes.register_converter() - registers a new supported object type.
  objtypes.encode_object(obj)   - returns a marshallable list representation.
  objtypes.decode_object(val)   - returns an object represented by the [name, args...] argument.

If an object cannot be encoded or decoded, a RaisedError exception is encoded or returned instead.
In a formula, this would cause an exception to be raised.
"""
import marshal
import exceptions
import traceback
from datetime import date, datetime

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


_max_js_int = 1<<31

def is_int_short(value):
  return -_max_js_int <= value < _max_js_int

def check_marshallable(value):
  """
  Raises UnmarshallableError if value cannot be marshalled.
  """
  if isinstance(value, (str, unicode, float, bool)) or value is None:
    # We don't need to marshal these to know they are marshallable.
    return
  if isinstance(value, (long, int)):
    # Ints are also marshallable, except that we only support 32-bit ints on JS side.
    if not is_int_short(value):
      raise UnmarshallableError("Integer too large")
    return

  # Other things we need to try to know.
  try:
    marshal.dumps(value)
  except Exception as e:
    raise UnmarshallableError(str(e))

def is_marshallable(value):
  """
  Returns a boolean for whether the value can be marshalled.
  """
  try:
    check_marshallable(value)
    return True
  except Exception:
    return False


# Maps of type or name to (type, name, converter) tuple.
_registered_converters_by_name = {}
_registered_converters_by_type = {}

def register_converter_by_type(type_, converter_func):
  assert type_ not in _registered_converters_by_type
  _registered_converters_by_type[type_] = converter_func

def register_converter_by_name(converter, type_, name):
  assert name not in _registered_converters_by_name
  _registered_converters_by_name[name] = (type_, name, converter)


def register_converter(converter, type_, name=None):
  """
  Register a new converter for the given type, with the given name (defaulting to type.__name__).
  The converter must implement methods:
    converter.encode_args(obj)            - should return [args...] as a python list of
                                            marshallable arguments.
    converter.decode_args(type, arglist)  - should return obj of type `type`.

  It's up to the converter to ensure that converter.decode_args(type(obj),
  converter.encode_args(obj)) returns a value equivalent to the original obj.
  """
  if name is None:
    name = type_.__name__
  register_converter_by_name(converter, type_, name)
  register_converter_by_type(type_, _encode_obj_impl(converter, name))


def deregister_converter(name):
  """
  De-register a named converter if previously registered.
  """
  prev = _registered_converters_by_name.pop(name, None)
  if prev:
    del _registered_converters_by_type[prev[0]]


def encode_object(obj):
  """
  Given an object, returns [typename, args...] array of marshallable values, which should be
  sufficient to reconstruct `obj`. Given a primitive object, returns it unchanged.

  If obj failed to encode, yields an encoding for RaisedException(UnmarshallableError, message).
  I.e. on reading this back, and using the value, we'll get UnmarshallableError exception.
  """
  try:
    t = type(obj)
    try:
      converter = (
          _registered_converters_by_type.get(t) or
          _registered_converters_by_type[getattr(t, '_objtypes_converter_type', t)])
    except KeyError:
      raise UnmarshallableError("No converter for type %s" % type(obj))
    return converter(obj)

  except Exception as e:
    # Don't risk calling encode_object recursively; instead encode a RaisedException error
    # manually with arguments that ought not fail.
    return ["E", "UnmarshallableError", str(e), repr(obj)]


def decode_object(value):
  """
  Given a value of the form [typename, args...], returns an object represented by it. If typename
  is unknown, or construction fails for any reason, returns (not raises!) RaisedException with
  original exception in its .error property.
  """
  if not isinstance(value, (tuple, list)):
    return value

  try:
    name = value[0]
    args = value[1:]
    try:
      type_, _, converter = _registered_converters_by_name[name]
    except KeyError:
      raise KeyError("Unknown object type %r" % name)
    return converter.decode_args(type_, args)
  except Exception as e:
    return RaisedException(e)


class SelfConverter(object):
  """
  Converter for objects that implement the converter interface:
    self.encode_args() - should return a list of marshallable arguments.
    cls.decode_args(args...) - should return an instance given the arguments from encode_args.
  """
  @classmethod
  def encode_args(cls, obj):
    return obj.encode_args()

  @classmethod
  def decode_args(cls, type_, args):
    return type_.decode_args(*args)

#----------------------------------------------------------------------
# Implementations of encoding objects. For basic types, there is nothing to encode, but for
# integers, we check that they are in JS range.

def _encode_obj_impl(converter, name):
  def inner(obj):
    try:
      args = converter.encode_args(obj)
    except Exception:
      raise UnmarshallableError("Encoding of %s failed" % name)

    for arg in args:
      check_marshallable(arg)
    return [name] + args
  return inner

def _encode_identity(value):
  return value

def _encode_integer(value):
  if not is_int_short(value):
    raise UnmarshallableError("Integer too large")
  return value

register_converter_by_type(str,        _encode_identity)
register_converter_by_type(unicode,    _encode_identity)
register_converter_by_type(float,      _encode_identity)
register_converter_by_type(bool,       _encode_identity)
register_converter_by_type(type(None), _encode_identity)
register_converter_by_type(long,       _encode_integer)
register_converter_by_type(int,        _encode_integer)

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
    return cls(decode_object(args))

  def __eq__(self, other):
    return isinstance(other, type(self)) and self.encode_args() == other.encode_args()

  def __ne__(self, other):
    return not self.__eq__(other)


class ExceptionConverter(object):
  """
  Converter for any type derived from BaseException. On encoding it returns the exception object's
  .args attribute, and uses them on decoding as constructor arguments to instantiate the error.
  """
  @classmethod
  def encode_args(cls, obj):
    return list(getattr(obj, 'args', ()))

  @classmethod
  def decode_args(cls, type_, args):
    return type_(*args)


# Register all Exceptions as valid types that can be handled by Grist.
for _, my_type in exceptions.__dict__.iteritems():
  if isinstance(my_type, type) and issubclass(my_type, BaseException):
    register_converter(ExceptionConverter, my_type)

# Register the special exceptions we defined.
register_converter(ExceptionConverter, UnmarshallableError)
register_converter(ExceptionConverter, ConversionError)

# Register the special wrapper class for raised exceptions with a custom short name.
register_converter(SelfConverter, RaisedException, "E")


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


class ListConverter(object):
  """
  Converter for the 'list' type.
  """
  @classmethod
  def encode_args(cls, obj):
    return obj

  @classmethod
  def decode_args(cls, type_, args):
    return type_(args)

# Register a converter for lists, also with a custom short name. It is used, in particular, for
# ReferenceLists. The first line ensures RecordLists are encoded as just lists; the second line
# overrides the decoding of 'L', so that it always decodes to a plain list, since for now, at
# least, there is no need to accept incoming RecordLists.
register_converter_by_type(RecordList, _encode_obj_impl(ListConverter, "L"))
register_converter(ListConverter, list, "L")


class DateTimeConverter(object):
  """
  Converter for the 'datetime.datetime' type.
  """
  @classmethod
  def encode_args(cls, obj):
    return [moment.dt_to_ts(obj), obj.tzinfo.zone.name]

  @classmethod
  def decode_args(cls, _type, args):
    return moment.ts_to_dt(args[0], moment.Zone(args[1]))

# Register a converter for dates, also with a custom short name.
register_converter(DateTimeConverter, datetime, "D")


class DateConverter(object):
  """
  Converter for the 'datetime.date' type.
  """
  @classmethod
  def encode_args(cls, obj):
    return [moment.date_to_ts(obj)]

  @classmethod
  def decode_args(cls, _type, args):
    return moment.ts_to_date(args[0])

register_converter(DateConverter, date, "d")



# We don't currently have a good way to convert an incoming marshalled record to a proper Record
# object for an appropriate table. We don't expect incoming marshalled records at all, but if such
# a thing happens, we'll construct this RecordStub.
class RecordStub(object):
  def __init__(self, table_id, row_id):
    self.table_id = table_id
    self.row_id = row_id


class RecordConverter(object):
  """
  Converter for 'record.Record' objects.
  """
  @classmethod
  def encode_args(cls, obj):
    return [obj._table.table_id, obj._row_id]

  @classmethod
  def decode_args(cls, _type, args):
    return RecordStub(args[0], args[1])


# When marshalling any subclass of Record in objtypes.py, we'll use the base Record as the type.
records.Record._objtypes_converter_type = records.Record
register_converter(RecordConverter, records.Record, "R")
