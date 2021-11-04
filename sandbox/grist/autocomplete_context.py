"""
Helper class for handling formula autocomplete.

It's intended to use with rlcompleter.Completer. It allows finding global names using
lowercase searches, and adds function usage information to some results.
"""
import inspect
from collections import namedtuple
from six.moves import builtins
import six

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
    self._functions = {}
    for key, value in six.iteritems(self._context):
      if value and callable(value):
        argspec = inspect.formatargspec(*inspect.getargspec(value))
        self._functions[key] = Completion(key, argspec, is_grist_func(value))

    # Add in the important UserTable methods, with custom friendlier descriptions.
    self._functions['.lookupOne'] = Completion('.lookupOne', '(colName=<value>, ...)', True)
    self._functions['.lookupRecords'] = Completion('.lookupRecords', '(colName=<value>, ...)', True)
    self._functions['.Record'] = Completion('.Record', '', True)
    self._functions['.RecordSet'] = Completion('.RecordSet', '', True)

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
