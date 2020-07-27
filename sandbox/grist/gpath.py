def _is_array(obj):
  return isinstance(obj, list)

def get(obj, path):
  """
  Looks up and returns a path in the object. Returns None if the path isn't there.
  """
  for part in path:
    try:
      obj = obj[part]
    except(KeyError, IndexError):
      return None
  return obj

def glob(obj, path, func, extra_arg):
  """
  Resolves wildcards in `path`, calling func for all matching paths. Returns the number of
  times that func was called.
    obj - An object to scan.
    path - Path to an item in an object or an array in obj. May contain the special key '*', which
          -- for arrays only -- means "for all indices".
    func - Will be called as func(subobj, key, fullPath, extraArg).
    extra_arg - An arbitrary value to pass along to func, for convenience.
  Returns count of matching paths, for which func got called.
  """
  return _globHelper(obj, path, path, func, extra_arg)

def _globHelper(obj, path, full_path, func, extra_arg):
  for i, part in enumerate(path[:-1]):
    if part == "*" and _is_array(obj):
      # We got an array wildcard
      subpath = path[i + 1:]
      count = 0
      for subobj in obj:
        count += _globHelper(subobj, subpath, full_path, func, extra_arg)
      return count

    try:
      obj = obj[part]
    except:
      raise Exception("gpath.glob: non-existent object at " +
                      describe(full_path[:len(full_path) - len(path) + i + 1]))

  return func(obj, path[-1], full_path, extra_arg) or 1

def place(obj, path, value):
  """
  Sets or deletes an object property in DocObj.
    gpath - Path to an Object in obj.
    value - Any value. Setting None will remove the selected object key.
  """
  return glob(obj, path, _placeHelper, value)

def _placeHelper(subobj, key, full_path, value):
  if not isinstance(subobj, dict):
    raise Exception("gpath.place: not a plain object at " + describe(dirname(full_path)))

  if value is not None:
    subobj[key] = value
  elif key in subobj:
    del subobj[key]

def _checkIsArray(subobj, errPrefix, index, itemPath, isInsert):
  """
  This is a helper for checking operations on arrays, and throwing descriptive errors.
  """
  if subobj is None:
    raise Exception(errPrefix + ": non-existent object at " + describe(dirname(itemPath)))
  elif not _is_array(subobj):
    raise Exception(errPrefix + ": not an array at " + describe(dirname(itemPath)))
  else:
    length = len(subobj)
    validIndex = (isinstance(index, int) and index >= 0 and index < length)
    validInsertIndex = (index is None or index == length)
    if not (validIndex or (isInsert and validInsertIndex)):
      raise Exception(errPrefix + ": invalid array index: " + describe(itemPath))

def insert(obj, path, value):
  """
  Inserts an element into an array in DocObj.
    gpath - Path to an item in an array in obj.
       The new value will be inserted before the item pointed to by gpath.
       The last component of gpath may be null, in which case the value is appended at the end.
    value - Any value.
  """
  return glob(obj, path, _insertHelper, value)

def _insertHelper(subobj, index, fullPath, value):
  _checkIsArray(subobj, "gpath.insert", index, fullPath, True)
  if index is None:
    subobj.append(value)
  else:
    subobj.insert(index, value)

def update(obj, path, value):
  """
  Updates an element in an array in DocObj.
    gpath - Path to an item in an array in obj.
    value - Any value.
  """
  return glob(obj, path, _updateHelper, value)

def _updateHelper(subobj, index, fullPath, value):
  if index == '*':
    _checkIsArray(subobj, "gpath.update", None, fullPath, True)
    for i in xrange(len(subobj)):
      subobj[i] = value
    return len(subobj)
  else:
    _checkIsArray(subobj, "gpath.update", index, fullPath, False)
    subobj[index] = value

def remove(obj, path):
  """
  Removes an element from an array in DocObj.
    gpath - Path to an item in an array in obj.
  """
  return glob(obj, path, _removeHelper, None)

def _removeHelper(subobj, index, fullPath, _):
  _checkIsArray(subobj, "gpath.remove", index, fullPath, False)
  del subobj[index]


def dirname(path):
  """
  Returns path without the last component, like a directory name in a filesystem path.
  """
  return path[:-1]

def basename(path):
  """
  Returns the last component of path, like base name of a filesystem path.
  """
  return path[-1] if path else None

def describe(path):
  """
  Returns a human-readable representation of path.
  """
  return "/" + "/".join(str(p) for p in path)
