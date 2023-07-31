from six.moves import reprlib

import records


class AttributeRecorder(object):
  """
  Wrapper around a Record that records attribute accesses.
  Used to generate a prompt for the AI with basic 'debugging' info.
  """
  def __init__(self, inner, name, attributes):
    assert isinstance(inner, records.Record)
    self._inner = inner
    self._name = name
    self._attributes = attributes

  def __getattr__(self, name):
    """
    Record attribute access.
    If the result is a Record or RecordSet, wrap that with AttributeRecorder
    to also record nested attribute values.
    """
    result = getattr(self._inner, name)
    full_name = "{}.{}".format(self._name, name)
    if isinstance(result, records.Record):
      result = AttributeRecorder(result, full_name, self._attributes)
    elif isinstance(result, records.RecordSet):
      # Use a tuple to imply immutability so that the AI doesn't try appending.
      # Don't try recording attributes of all contained records, just record the first access.
      # Pretend that the attribute is always accessed from the first record for simplicity.
      result = tuple(AttributeRecorder(r, full_name + "[0]", self._attributes) for r in result)
    self._attributes.setdefault(full_name, safe_repr(result))
    return result

  def __repr__(self):
    # The usual Record repr looks like Table1[2] which may surprise the AI.
    return "{}(id={})".format(self._inner._table.table_id, self._inner._row_id)


arepr = reprlib.Repr()
arepr.maxlevel = 3
arepr.maxtuple = 3
arepr.maxlist = 3
arepr.maxarray = 3
arepr.maxdict = 4
arepr.maxset = 3
arepr.maxfrozenset = 3
arepr.maxdeque = 3
arepr.maxstring = 40
arepr.maxlong = 20
arepr.maxother = 60


def safe_repr(x):
  try:
    return arepr.repr(x)
  except Exception:
    # Copied from Repr.repr_instance in Python 3.
    return '<%s instance at %#x>' % (x.__class__.__name__, id(x))
