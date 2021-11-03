COL_SEPARATOR = ":"

"""
Helper module for sort expressions.
Sort expressions are encoded as a positive number for ascending column,
negative number for descending column. Can also be encoded as strings in a form:
'-1:flag' or '1:flag;flag'
Flags can be:
- emptyLast to put empty values at the end.
- orderByChoice: to order column by choice entry index rather then choice value.
- naturalSort: to treat strings containing numbers as numbers and sort them accordingly.
"""

def col_ref(col_spec):
  """
  Gets column row id from column expression
  """
  return abs(col_spec if isinstance(col_spec, int) else int(col_spec.split(COL_SEPARATOR)[0]))

def direction(col_spec):
  """
  Gets direction for column expression (1 for ascending - 1 for descending).
  """
  if isinstance(col_spec, int):
    return 1 if col_spec >= 0 else -1
  else:
    assert col_spec
    return 1 if col_spec[0] != "-" else -1

def swap_col_ref(col_spec, new_col_ref):
  """
  Swaps colRef in colSpec preserving direction and options (used for display columns).
  """
  new_spec = direction(col_spec) * new_col_ref
  if isinstance(col_spec, int):
    return new_spec
  else:
    parts = col_spec.split(COL_SEPARATOR)
    parts[0] = str(new_spec)
    return COL_SEPARATOR.join(parts)
