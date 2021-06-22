"""
TwoWayMap implements mapping from keys to values, and values back to keys. Since keys and values
are not really different here, they are referred to throughout as 'left' and 'right' values.

TwoWayMap supports different types of containers when one value maps to multiple. You may add
support for additional container types using register_container() module function.

It's implemented using Python dictionaries, so both 'left' and 'right' values must be hashable.

For example, to create a dictionary-like structure mapping one key to one value, and which allows
to quickly tell the set of keys that map to a given value, we can use m=TwoWayMap(left=set,
right="single"). Then m.insert(key, value) sets the given key to the given value (overwriting the
value previously set, since the "right" dataset is "single" values), m.lookup_left(key) returns
that value, and m.lookup_right(value) returns a `set` of keys that map to the value.
"""

import six

# Special sentinel value which can never be legitimately stored in TwoWayMap, to easily tell the
# difference between a present and absent value.
_NIL = object()


class TwoWayMap(object):
  def __init__(self, left=set, right=set):
    """
    Create a new TwoWayMap. The `left` and `right` parameters determine the type of bin for
    storing multiple values on the respective side of the map. E.g. if right=set, then
    lookup_left() will return a set (what's on the right side). Supported values are:
      set:      a set of values.
      list:     a list of values, with new items added at the end of the list.
      "single": a single value, new items overwrite previous ones.
      "strict": a single value, new items must not overwrite previous ones.

      To add support for another bin type, use twowaymap.register_container().

    E.g. for TwoWayMap(left="single", right="strict"),
      after insert(1, "a"), insert(1, "b") will succeed, but insert(2, "a") will fail.

    E.g. for TwoWayMap(left=list, right="single"),
      after insert(1, "a"), insert(1, "b"), insert(2, "a"),
      lookup_left(1) will return ["a", "b"], and lookup_right("a") will return 2.
  """
    self._left_bin = _mapper_types[left]
    self._right_bin = _mapper_types[right]
    self._fwd = {}
    self._bwd = {}

  def __nonzero__(self):
    return bool(self._fwd)

  __bool__ = __nonzero__

  def lookup_left(self, left, default=None):
    """ Returns the value(s) on the right corresponding to the given value on the left. """
    return self._fwd.get(left, default)

  def lookup_right(self, right, default=None):
    """ Returns the value(s) on the left corresponding to the given value on the right. """
    return self._bwd.get(right, default)

  def count_left(self):
    """ Returns the count of unique values on the left."""
    return len(self._fwd)

  def count_right(self):
    """ Returns the count of unique values on the right."""
    return len(self._bwd)

  def left_all(self):
    """ Returns an iterable over all values on the left."""
    return six.iterkeys(self._fwd)

  def right_all(self):
    """ Returns an iterable over all values on the right."""
    return six.iterkeys(self._bwd)

  def insert(self, left, right):
    """ Insert the (left, right) value pair. """
    # The tricky thing here is to keep the two maps consistent if an update to the second one
    # raises an exception. To handle it, add_item must return what got added and removed, so that
    # we can restore things after an exception. An exception could be caused by a "strict" bin
    # type, or by using an un-hashable key (on either left or right side), or by using a custom
    # container that can throw.
    right_removed, right_added = self._right_bin.add_item(self._fwd, left, right)
    try:
      left_removed, _ = self._left_bin.add_item(self._bwd, right, left)
    except:
      # _left_bin is responsible to stay unchanged if there was an exception. Now we need to bring
      # _right_bin back in sync with _left_bin.
      if right_added is not _NIL:
        self._right_bin.remove_item(self._fwd, left, right_added)
      if right_removed is not _NIL:
        self._right_bin.add_item(self._fwd, left, right_removed)
      raise

    # It's possible for add_item to overwrite elements, in which case we need to remove the
    # other side of the mapping for the removed element.
    if right_removed is not _NIL:
      self._left_bin.remove_item(self._bwd, right_removed, left)
    if left_removed is not _NIL:
      self._right_bin.remove_item(self._fwd, left_removed, right)

  def remove(self, left, right):
    """ Remove the (left, right) value pair. """
    self._right_bin.remove_item(self._fwd, left, right)
    self._left_bin.remove_item(self._bwd, right, left)

  def remove_left(self, left):
    """ Remove all values on the right corresponding to the given value on the left. """
    right_removed = self._right_bin.remove_key(self._fwd, left)
    for x in right_removed:
      self._left_bin.remove_item(self._bwd, x, left)

  def remove_right(self, right):
    """ Remove all values on the left corresponding to the given value on the right. """
    left_removed = self._left_bin.remove_key(self._bwd, right)
    for x in left_removed:
      self._right_bin.remove_item(self._fwd, x, right)

  def clear(self):
    """ Clear the entire map. """
    self._fwd.clear()
    self._bwd.clear()

#----------------------------------------------------------------------
# The private classes below implement the different container types.

class _BaseBinType(object):
  """ Base class for other BinTypes. """
  def add_item(self, mapping, key, value):
    pass
  def remove_item(self, mapping, key, value):
    pass
  def remove_key(self, mapping, key):
    pass


class _SingleValueBin(_BaseBinType):
  """ Bin that contains a single value, with new values overwriting previous ones."""
  def add_item(self, mapping, key, value):
    stored = mapping.get(key, _NIL)
    mapping[key] = value
    if stored is _NIL:
      return _NIL, value
    elif stored == value:
      return _NIL, _NIL
    else:
      return stored, value

  def remove_item(self, mapping, key, value):
    stored = mapping.get(key, _NIL)
    if stored == value:
      del mapping[key]

  def remove_key(self, mapping, key):
    stored = mapping.pop(key, _NIL)
    return () if stored is _NIL else (stored,)


class _SingleValueStrictBin(_SingleValueBin):
  """ Bin that contains a single value, overwriting which raises ValueError."""
  def add_item(self, mapping, key, value):
    stored = mapping.get(key, _NIL)
    if stored is _NIL:
      mapping[key] = value
      return _NIL, value
    elif stored == value:
      return _NIL, _NIL
    else:
      raise ValueError("twowaymap: one-to-one map violation for key %s" % key)


class _ContainerBin(_BaseBinType):
  """
  Bin that contains a container of values managed by the passed-in functions. See
  register_container() for documentation of the arguments.
  """
  def __init__(self, make_func, add_func, remove_func):
    self.make = make_func
    self.add = add_func
    self.remove = remove_func

  def add_item(self, mapping, key, value):
    stored = mapping.get(key, _NIL)
    if stored is _NIL:
      mapping[key] = self.make(value)
      return _NIL, value
    else:
      return _NIL, (value if self.add(stored, value) else _NIL)

  def remove_item(self, mapping, key, value):
    stored = mapping.get(key, _NIL)
    if stored is not _NIL:
      self.remove(stored, value)
      if not stored:
        del mapping[key]

  def remove_key(self, mapping, key):
    return mapping.pop(key, ())

#----------------------------------------------------------------------

_mapper_types = {
  'single': _SingleValueBin(),
  'strict': _SingleValueStrictBin(),
}

def register_container(cls, make_func, add_func, remove_func):
  """
  Register another container type. The first argument can be the container's class object, but
  really can be any hashable value, which you can then give as an argument to left= or right=
  arguments when constructing a TwoWayMap. The other arguments are:

    make_func(value) - must return a new instance of the container with a single value.
        This container must support iteration through values, and in boolean context must
        evaluate to whether it's non-empty.

    add_func(container, value) - must add value to container, only if it's not already there,
        and return True if the value was added, False if it was already there.

    remove_func(container, value) - must remove value from container if present.
        This must never raise an exception, since that could leave the map in inconsistent state.
  """
  _mapper_types[cls] = _ContainerBin(make_func, add_func, remove_func)


# Allow `set` to be used as a bin type.
def _set_make(value):
  return {value}
def _set_add(container, value):
  if value not in container:
    container.add(value)
    return True
  return False
def _set_remove(container, value):
  container.discard(value)

register_container(set, _set_make, _set_add, _set_remove)


# Allow `list` to be used as a bin type.
def _list_make(value):
  return [value]
def _list_add(container, value):
  if value not in container:
    container.append(value)
    return True
  return False
def _list_remove(container, value):
  try:
    container.remove(value)
  except ValueError:
    pass

register_container(list, _list_make, _list_add, _list_remove)
