from .info import lazy_value_or_error, is_error
from usertypes import AltText   # pylint: disable=unused-import,import-error


def AND(logical_expression, *logical_expressions):
  """
  Returns True if all of the arguments are logically true, and False if any are false.
  Same as `all([value1, value2, ...])`.

  >>> AND(1)
  True
  >>> AND(0)
  False
  >>> AND(1, 1)
  True
  >>> AND(1,2,3,4)
  True
  >>> AND(1,2,3,4,0)
  False
  """
  return all((logical_expression,) + logical_expressions)


def FALSE():
  """
  Returns the logical value `False`. You may also use the value `False` directly. This
  function is provided primarily for compatibility with other spreadsheet programs.

  >>> FALSE()
  False
  """
  return False


def IF(logical_expression, value_if_true, value_if_false):
  """
  Returns one value if a logical expression is `True` and another if it is `False`.

  The equivalent Python expression is:
  ```
  value_if_true if logical_expression else value_if_false
  ```

  Since Grist supports multi-line formulas, you may also use Python blocks such as:
  ```
  if logical_expression:
    return value_if_true
  else:
    return value_if_false
  ```

  NOTE: Grist follows Excel model by only evaluating one of the value expressions, by
  automatically wrapping the expressions to use lazy evaluation. This allows `IF(False, 1/0, 1)`
  to evaluate to `1` rather than raise an exception.

  >>> IF(12, "Yes", "No")
  'Yes'
  >>> IF(None, "Yes", "No")
  'No'
  >>> IF(True, 0.85, 0.0)
  0.85
  >>> IF(False, 0.85, 0.0)
  0.0

  More tests:
  >>> IF(True, lambda: (1/0), lambda: (17))  # doctest: +IGNORE_EXCEPTION_DETAIL
  Traceback (most recent call last):
  ...
  ZeroDivisionError: integer division or modulo by zero
  >>> IF(False, lambda: (1/0), lambda: (17))
  17
  """
  return lazy_value(value_if_true) if logical_expression else lazy_value(value_if_false)


def IFERROR(value, value_if_error=""):
  """
  Returns the first argument if it is not an error value, otherwise returns the second argument if
  present, or a blank if the second argument is absent.

  NOTE: Grist handles values that raise an exception by wrapping them to use lazy evaluation.

  >>> IFERROR(float('nan'), "**NAN**")
  '**NAN**'
  >>> IFERROR(17.17, "**NAN**")
  17.17
  >>> IFERROR("Text")
  'Text'
  >>> IFERROR(AltText("hello"))
  ''

  More tests:
  >>> IFERROR(lambda: (1/0.1), "X")
  10.0
  >>> IFERROR(lambda: (1/0.0), "X")
  'X'
  >>> IFERROR(lambda: AltText("A"), "err")
  'err'
  >>> IFERROR(lambda: None, "err")

  >>> IFERROR(lambda: foo.bar, 123)
  123
  >>> IFERROR(lambda: "test".bar(), 123)
  123
  >>> IFERROR(lambda: "test".bar())
  ''
  >>> IFERROR(lambda: "test".upper(), 123)
  'TEST'
  """
  value = lazy_value_or_error(value)
  return value if not is_error(value) else value_if_error


def NOT(logical_expression):
  """
  Returns the opposite of a logical value: `NOT(True)` returns `False`; `NOT(False)` returns
  `True`. Same as `not logical_expression`.

  >>> NOT(123)
  False
  >>> NOT(0)
  True
  """
  return not logical_expression


def OR(logical_expression, *logical_expressions):
  """
  Returns True if any of the arguments is logically true, and false if all of the
  arguments are false.
  Same as `any([value1, value2, ...])`.

  >>> OR(1)
  True
  >>> OR(0)
  False
  >>> OR(1, 1)
  True
  >>> OR(0, 1)
  True
  >>> OR(0, 0)
  False
  >>> OR(0,False,0.0,"",None)
  False
  >>> OR(0,None,3,0)
  True
  """
  return any((logical_expression,) + logical_expressions)


def TRUE():
  """
  Returns the logical value `True`. You may also use the value `True` directly. This
  function is provided primarily for compatibility with other spreadsheet programs.

  >>> TRUE()
  True
  """
  return True

def lazy_value(value):
  """
  Evaluates a lazy value by calling it when it's a callable, or returns it unchanged otherwise.
  """
  return value() if callable(value) else value
