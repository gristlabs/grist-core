"""
Helper class for handling formula autocomplete.

It's intended to use with rlcompleter.Completer. It allows finding global names using
lowercase searches, and adds function usage information to some results.
"""
import inspect
import re
from collections import namedtuple, defaultdict
from six.moves import builtins, reprlib
import six

import column
from table import UserTable

# funcname is the function name, e.g. "MAX"
# argspec is the signature, e.g. "(arg, *more_args)"
# isgrist is a boolean for whether this function should be in Grist documentation.
Completion = namedtuple('Completion', ['funcname', 'argspec', 'isgrist'])

def is_grist_func(func):
  try:
    return inspect.getmodule(func).__name__.startswith('functions.')
  except Exception as e:
    return e

class AutocompleteContext(object):
  def __init__(self, usercode_context):
    # rlcompleter is case-sensitive. This is hard to work around while maintaining attribute
    # lookups. As a middle ground, we only introduce lowercase versions of all global names.
    self._context = {
      key: value for key, value in six.iteritems(usercode_context)
      # Don't propose unimplemented functions in autocomplete
      if not (value and callable(value) and getattr(value, 'unimplemented', None))
    }

    # Add some common non-lowercase builtins, so that we include them into the case-handling below.
    self._context.update({
      'True': True,
      'False': False,
      'None': None,
    })

    # Prepare detailed Completion objects for functions where we can supply more info.
    # TODO It would be nice to include builtin functions too, but getargspec doesn't work there.
    self._functions = {
      # Add in the important UserTable methods, with custom friendlier descriptions.
      '.lookupOne': Completion('.lookupOne', '(colName=<value>, ...)', True),
      '.lookupRecords': Completion('.lookupRecords', '(colName=<value>, ...)', True),
      '.Record': Completion('.Record', '', True),
      '.RecordSet': Completion('.RecordSet', '', True),
    }
    for key, value in six.iteritems(self._context):
      if value and callable(value):
        if six.PY2:
          argspec = inspect.formatargspec(*inspect.getargspec(value))
        else:
          argspec = str(inspect.signature(value))  # pylint: disable=no-member
        self._functions[key] = Completion(key, argspec, is_grist_func(value))

    for key, value in self._context.copy().items():
      if isinstance(value, UserTable):
        for func in [".lookupOne", ".lookupRecords"]:
          # Add fake variable names like `Table1.lookupOne` to the context.
          # This allows the method to be suggested
          # even before the user finishes typing the table name.
          # Such a variable name isn't actually possible, so it doesn't matter what value we set.
          self._context[key + func] = None
          self._functions[key + func] = self._functions[func]._replace(funcname=key + func)

    # Remember the original name for each lowercase one.
    self._lowercase = {}
    for key in self._context:
      lower = key.lower()
      if lower == key:
        continue
      if not any((lower in d) for d in (self._context, self._lowercase, builtins.__dict__)):
        self._lowercase[lower] = key
      else:
        # This is still good enough to find a match for, and translate back to the original.
        # It allows rlcompleter to match e.g. 'max' against 'max', 'Max', and 'MAX' (using keys
        # 'max', 'max*', and 'max**', respectively).
        lower += '*'
        if lower in self._lowercase:
          lower += '*'
        self._lowercase[lower] = key

    # Lowercase 'value' is used in trigger formulas, and is not the same as 'VALUE'.
    self._lowercase.pop('value', None)

    # Add the lowercase names to the context, and to the detailed completions in _functions.
    for lower, key in six.iteritems(self._lowercase):
      self._context[lower] = self._context[key]
      if key in self._functions:
        self._functions[lower] = self._functions[key]

  def get_context(self):
    return self._context

  def process_result(self, result):
    # 'for' suggests the autocompletion 'for ' in python 3
    result = result.rstrip()

    # Table.lookup methods are special to allow completion just from the table name.
    match = re.search(r'\w+\.(lookupOne|lookupRecords)$', result, re.IGNORECASE)
    if match:
      funcname = match.group().lower()
      funcname = self._lowercase.get(match, funcname)
      func = self._functions.get(funcname)
      if func:
        return tuple(func)

    # Callables are returned by rlcompleter with a trailing "(".
    if result.endswith('('):
      funcname = result[0:-1]
      dot = funcname.rfind(".")
      key = funcname[dot:] if dot >= 0 else funcname
      completion = self._functions.get(key)
      # Return the detailed completion if we have it, or the result string otherwise.
      if completion:
        # For methods (eg ".lookupOne"), use the original result as funcname (eg "Foo.lookupOne").
        if dot >= 0:
          varname = funcname[:dot]
          funcname = self._lowercase.get(varname, varname) + key
          completion = completion._replace(funcname=funcname)
        return tuple(completion)

      return result

    # Return translation from lowercase if there is one, or the result string otherwise.
    return self._lowercase.get(result, result)


def lookup_autocomplete_options(lookup_table, formula_table, reverse_only):
  """
  Returns a list of strings to add to `Table.lookupRecords(` (or lookupOne)
  to suggest arguments for the method.
  `lookup_table` is the table that the method is being called on.
  `formula_table` is the table that the formula is being written in.
  `reverse_only` should be True to only suggest 'reverse reference' lookup arguments
  (i.e. `<refcol>=$id`) and no other reference lookups (i.e. `<refcol>=$<other refcol>`).
  """
  # dict mapping tables to lists of col_ids in `formula_table` that are references
  # to the the table with that table_id.
  # In particular `$id` is treated as a reference to `formula_table`.
  ref_cols = defaultdict(list, {formula_table: ["id"]})
  if not reverse_only:
    for col_id, col in formula_table.all_columns.items():
      # Note that we can't support reflist columns in the current table,
      # as there is no `IN()` function to do the opposite of the `CONTAINS()` function.
      if isinstance(col, column.ReferenceColumn) and column.is_visible_column(col_id):
        ref_cols[col._target_table].append(col_id)

  # Find referencing columns in the lookup table that target tables in ref_cols.
  results = []
  for lookup_col_id, lookup_col in lookup_table.all_columns.items():
    if not column.is_visible_column(lookup_col_id):
      continue
    if isinstance(lookup_col, column.ReferenceColumn):
      value_template = "${}"
    elif isinstance(lookup_col, column.ReferenceListColumn):
      value_template = "CONTAINS(${})"
    else:
      continue
    target_table_id = lookup_col._target_table
    for ref_col_id in ref_cols[target_table_id]:
      value = value_template.format(ref_col_id)
      results.append("{}={})".format(lookup_col_id, value))
  return results


def eval_suggestion(suggestion, rec, user):
  """
  Evaluate a simple string of Python code,
  and return a limited string representation of the result,
  or None if this isn't possible.
  Only supports code starting with `rec` or `user`,
  followed by any number of attribute accesses, nothing else.
  """

  if not isinstance(suggestion, six.string_types):
    # `suggestion` is a tuple corresponding to a function
    return None

  parts = suggestion.split(".")
  if parts[0] == "rec":
    result = rec
  elif parts[0] == "user":
    result = user
    if parts in (["user"], ["user", "LinkKey"]):
      # `user` and `user.LinkKey` have no useful string representation.
      return None
  else:
    # Other variables are not supported since we can't know their values.
    return None

  parts = parts[1:]  # attribute names, if any
  for part in parts:
    try:
      result = getattr(result, part)
    except Exception:
      return None

  # Convert the value to a string and truncate the length if needed.
  return repr_example(result)[:arepr.maxother]


class AutocompleteExampleRepr(reprlib.Repr):
  """
  The default repr for dates and datetimes is long and ugly.
  This class is used so that repr_example is mostly the same as repr,
  but dates look the way they're formatted in Grist.
  """
  @staticmethod
  def repr_date(obj, _level):
    # e.g. "2019-12-31"
    return obj.strftime("%Y-%m-%d")

  @staticmethod
  def repr_datetime(obj, _level):
    # e.g. "2019-12-31 1:23pm"
    return obj.strftime("%Y-%m-%d %-I:%M%p").lower()


arepr = AutocompleteExampleRepr()
# Set the same high value for all limits, because we just want to avoid
# sending huge strings to the client, but the truncation shouldn't be visible in the UI.
arepr.maxother = 200
arepr.maxtuple = arepr.maxother
arepr.maxlist = arepr.maxother
arepr.maxarray = arepr.maxother
arepr.maxdict = arepr.maxother
arepr.maxset = arepr.maxother
arepr.maxfrozenset = arepr.maxother
arepr.maxdeque = arepr.maxother
arepr.maxstring = arepr.maxother
arepr.maxlong = arepr.maxother

def repr_example(x):
  try:
    return arepr.repr(x)
  except Exception:
    # Copied from Repr.repr_instance in Python 3.
    return '<%s instance at %#x>' % (x.__class__.__name__, id(x))
