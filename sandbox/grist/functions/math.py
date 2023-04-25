# pylint: disable=unused-argument

from __future__ import absolute_import

import datetime
import math as _math
import operator
import random
import uuid
from functools import reduce  # pylint: disable=redefined-builtin

from six.moves import zip, xrange
import six

from functions.info import ISNUMBER, ISLOGICAL
from functions.unimplemented import unimplemented
import roman

# Iterates through elements of iterable arguments, or through individual args when not iterable.
def _chain(*values_or_iterables):
  for v in values_or_iterables:
    try:
      v = iter(v)
    except TypeError:
      yield v
    else:
      for x in v:
        yield x


# Iterates through iterable or other arguments, skipping non-numeric ones.
def _chain_numeric(*values_or_iterables):
  for v in _chain(*values_or_iterables):
    if ISNUMBER(v) and not ISLOGICAL(v):
      yield v


# Iterates through iterable or other arguments, replacing non-numeric ones with 0 (or True with 1).
def _chain_numeric_a(*values_or_iterables):
  for v in _chain(*values_or_iterables):
    yield int(v) if ISLOGICAL(v) else v if ISNUMBER(v) else 0


# Iterates through iterable or other arguments, only including numbers, dates, and datetimes.
def _chain_numeric_or_date(*values_or_iterables):
  for v in _chain(*values_or_iterables):
    if ISNUMBER(v) and not ISLOGICAL(v) or isinstance(v, (datetime.date, datetime.datetime)):
      yield v


def _round_toward_zero(value):
  return _math.floor(value) if value >= 0 else _math.ceil(value)

def _round_away_from_zero(value):
  return _math.ceil(value) if value >= 0 else _math.floor(value)

def ABS(value):
  """
  Returns the absolute value of a number.

  >>> ABS(2)
  2
  >>> ABS(-2)
  2
  >>> ABS(-4)
  4
  """
  return abs(value)

def ACOS(value):
  """
  Returns the inverse cosine of a value, in radians.

  >>> round(ACOS(-0.5), 9)
  2.094395102
  >>> round(ACOS(-0.5)*180/PI(), 10)
  120.0
  """
  return _math.acos(value)

def ACOSH(value):
  """
  Returns the inverse hyperbolic cosine of a number.

  >>> ACOSH(1)
  0.0
  >>> round(ACOSH(10), 7)
  2.9932228
  """
  return _math.acosh(value)

def ARABIC(roman_numeral):
  """
  Computes the value of a Roman numeral.

  >>> ARABIC("LVII")
  57
  >>> ARABIC('mcmxii')
  1912
  """
  return roman.fromRoman(roman_numeral.upper())

def ASIN(value):
  """
  Returns the inverse sine of a value, in radians.

  >>> round(ASIN(-0.5), 9)
  -0.523598776
  >>> round(ASIN(-0.5)*180/PI(), 10)
  -30.0
  >>> round(DEGREES(ASIN(-0.5)), 10)
  -30.0
  """
  return _math.asin(value)

def ASINH(value):
  """
  Returns the inverse hyperbolic sine of a number.

  >>> round(ASINH(-2.5), 9)
  -1.647231146
  >>> round(ASINH(10), 9)
  2.99822295
  """
  return _math.asinh(value)

def ATAN(value):
  """
  Returns the inverse tangent of a value, in radians.

  >>> round(ATAN(1), 9)
  0.785398163
  >>> ATAN(1)*180/PI()
  45.0
  >>> DEGREES(ATAN(1))
  45.0
  """
  return _math.atan(value)

def ATAN2(x, y):
  """
  Returns the angle between the x-axis and a line segment from the origin (0,0) to specified
  coordinate pair (`x`,`y`), in radians.

  >>> round(ATAN2(1, 1), 9)
  0.785398163
  >>> round(ATAN2(-1, -1), 9)
  -2.35619449
  >>> ATAN2(-1, -1)*180/PI()
  -135.0
  >>> DEGREES(ATAN2(-1, -1))
  -135.0
  >>> round(ATAN2(1,2), 9)
  1.107148718
  """
  return _math.atan2(y, x)

def ATANH(value):
  """
  Returns the inverse hyperbolic tangent of a number.

  >>> round(ATANH(0.76159416), 9)
  1.00000001
  >>> round(ATANH(-0.1), 9)
  -0.100335348
  """
  return _math.atanh(value)

def CEILING(value, factor=1):
  """
  Rounds a number up to the nearest multiple of factor, or the nearest integer if the factor is
  omitted or 1.

  >>> CEILING(2.5, 1)
  3
  >>> CEILING(-2.5, -2)
  -4
  >>> CEILING(-2.5, 2)
  -2
  >>> CEILING(1.5, 0.1)
  1.5
  >>> CEILING(0.234, 0.01)
  0.24
  """
  return int(_math.ceil(float(value) / factor)) * factor

def COMBIN(n, k):
  """
  Returns the number of ways to choose some number of objects from a pool of a given size of
  objects.

  >>> COMBIN(8,2)
  28
  >>> COMBIN(4,2)
  6
  >>> COMBIN(10,7)
  120
  """
  # From http://stackoverflow.com/a/4941932/328565
  k = min(k, n-k)
  if k == 0:
    return 1
  numer = reduce(operator.mul, xrange(n, n-k, -1))
  denom = reduce(operator.mul, xrange(1, k+1))
  return numer//denom

def COS(angle):
  """
  Returns the cosine of an angle provided in radians.

  >>> round(COS(1.047), 7)
  0.5001711
  >>> round(COS(60*PI()/180), 10)
  0.5
  >>> round(COS(RADIANS(60)), 10)
  0.5
  """
  return _math.cos(angle)

def COSH(value):
  """
  Returns the hyperbolic cosine of any real number.

  >>> round(COSH(4), 6)
  27.308233
  >>> round(COSH(EXP(1)), 7)
  7.6101251
  """
  return _math.cosh(value)

def DEGREES(angle):
  """
  Converts an angle value in radians to degrees.

  >>> round(DEGREES(ACOS(-0.5)), 10)
  120.0
  >>> DEGREES(PI())
  180.0
  """
  return _math.degrees(angle)

def EVEN(value):
  """
  Rounds a number up to the nearest even integer, rounding away from zero.

  >>> EVEN(1.5)
  2
  >>> EVEN(3)
  4
  >>> EVEN(2)
  2
  >>> EVEN(-1)
  -2
  """
  return int(_round_away_from_zero(float(value) / 2)) * 2

def EXP(exponent):
  """
  Returns Euler's number, e (~2.718) raised to a power.

  >>> round(EXP(1), 8)
  2.71828183
  >>> round(EXP(2), 7)
  7.3890561
  """
  return _math.exp(exponent)

def FACT(value):
  """
  Returns the factorial of a number.

  >>> FACT(5)
  120
  >>> FACT(1.9)
  1
  >>> FACT(0)
  1
  >>> FACT(1)
  1
  >>> FACT(-1)
  Traceback (most recent call last):
    ...
  ValueError: factorial() not defined for negative values
  """
  return _math.factorial(int(value))

def FACTDOUBLE(value):
  """
  Returns the "double factorial" of a number.

  >>> FACTDOUBLE(6)
  48
  >>> FACTDOUBLE(7)
  105
  >>> FACTDOUBLE(3)
  3
  >>> FACTDOUBLE(4)
  8
  """
  return reduce(operator.mul, xrange(value, 1, -2))

def FLOOR(value, factor=1):
  """
  Rounds a number down to the nearest integer multiple of specified significance.

  >>> FLOOR(3.7,2)
  2
  >>> FLOOR(-2.5,-2)
  -2
  >>> FLOOR(2.5,-2)
  Traceback (most recent call last):
    ...
  ValueError: factor argument invalid
  >>> FLOOR(1.58,0.1)
  1.5
  >>> FLOOR(0.234,0.01)
  0.23
  """
  if (factor < 0) != (value < 0):
    raise ValueError("factor argument invalid")
  return int(_math.floor(float(value) / factor)) * factor

def _gcd(a, b):
  while a != 0:
    if a > b:
      a, b = b, a
    a, b = b % a, a
  return b

def GCD(value1, *more_values):
  """
  Returns the greatest common divisor of one or more integers.

  >>> GCD(5, 2)
  1
  >>> GCD(24, 36)
  12
  >>> GCD(7, 1)
  1
  >>> GCD(5, 0)
  5
  >>> GCD(0, 5)
  5
  >>> GCD(5)
  5
  >>> GCD(14, 42, 21)
  7
  """
  values = [v for v in (value1,) + more_values if v]
  if not values:
    return 0
  if any(v < 0 for v in values):
    raise ValueError("gcd requires non-negative values")
  return reduce(_gcd, map(int, values))

def INT(value):
  """
  Rounds a number down to the nearest integer that is less than or equal to it.

  >>> INT(8.9)
  8
  >>> INT(-8.9)
  -9
  >>> 19.5-INT(19.5)
  0.5
  """
  return int(_math.floor(value))

def _lcm(a, b):
  return a * b // _gcd(a, b)

def LCM(value1, *more_values):
  """
  Returns the least common multiple of one or more integers.

  >>> LCM(5, 2)
  10
  >>> LCM(24, 36)
  72
  >>> LCM(0, 5)
  0
  >>> LCM(5)
  5
  >>> LCM(10, 100)
  100
  >>> LCM(12, 18)
  36
  >>> LCM(12, 18, 24)
  72
  """
  values = (value1,) + more_values
  if any(v < 0 for v in values):
    raise ValueError("gcd requires non-negative values")
  if any(v == 0 for v in values):
    return 0
  return reduce(_lcm, map(int, values))

def LN(value):
  """
  Returns the the logarithm of a number, base e (Euler's number).

  >>> round(LN(86), 7)
  4.4543473
  >>> round(LN(2.7182818), 7)
  1.0
  >>> round(LN(EXP(3)), 10)
  3.0
  """
  return _math.log(value)

def LOG(value, base=10):
  """
  Returns the the logarithm of a number given a base.

  >>> LOG(10)
  1.0
  >>> LOG(8, 2)
  3.0
  >>> round(LOG(86, 2.7182818), 7)
  4.4543473
  """
  return _math.log(value, base)

def LOG10(value):
  """
  Returns the the logarithm of a number, base 10.

  >>> round(LOG10(86), 9)
  1.934498451
  >>> LOG10(10)
  1.0
  >>> LOG10(100000)
  5.0
  >>> LOG10(10**5)
  5.0
  """
  return _math.log10(value)

def MOD(dividend, divisor):
  """
  Returns the result of the modulo operator, the remainder after a division operation.

  >>> MOD(3, 2)
  1
  >>> MOD(-3, 2)
  1
  >>> MOD(3, -2)
  -1
  >>> MOD(-3, -2)
  -1
  """
  return dividend % divisor

def MROUND(value, factor):
  """
  Rounds one number to the nearest integer multiple of another.

  >>> MROUND(10, 3)
  9
  >>> MROUND(-10, -3)
  -9
  >>> round(MROUND(1.3, 0.2), 10)
  1.4
  >>> MROUND(5, -2)
  Traceback (most recent call last):
    ...
  ValueError: factor argument invalid
  """
  if (factor < 0) != (value < 0):
    raise ValueError("factor argument invalid")
  return int(_round_toward_zero(float(value) / factor + 0.5)) * factor

def MULTINOMIAL(value1, *more_values):
  """
  Returns the factorial of the sum of values divided by the product of the values' factorials.

  >>> MULTINOMIAL(2, 3, 4)
  1260
  >>> MULTINOMIAL(3)
  1
  >>> MULTINOMIAL(1,2,3)
  60
  >>> MULTINOMIAL(0,2,4,6)
  13860
  """
  s = value1
  res = 1
  for v in more_values:
    s += v
    res *= COMBIN(s, v)
  return res

def NUM(value):
  """
  For a Python floating-point value that's actually an integer, returns a Python integer type.
  Otherwise, returns the value unchanged. This is helpful sometimes when a value comes from a
  Numeric Grist column (represented as floats), but when int values are actually expected.

  >>> NUM(-17.0)
  -17
  >>> NUM(1.5)
  1.5
  >>> NUM(4)
  4
  >>> NUM("NA")
  'NA'
  """
  if isinstance(value, float) and value.is_integer():
    return int(value)
  return value

def ODD(value):
  """
  Rounds a number up to the nearest odd integer.

  >>> ODD(1.5)
  3
  >>> ODD(3)
  3
  >>> ODD(2)
  3
  >>> ODD(-1)
  -1
  >>> ODD(-2)
  -3
  """
  return int(_round_away_from_zero(float(value + 1) / 2)) * 2 - 1

def PI():
  """
  Returns the value of Pi to 14 decimal places.

  >>> round(PI(), 9)
  3.141592654
  >>> round(PI()/2, 9)
  1.570796327
  >>> round(PI()*9, 8)
  28.27433388
  """
  return _math.pi

def POWER(base, exponent):
  """
  Returns a number raised to a power.

  >>> POWER(5,2)
  25.0
  >>> round(POWER(98.6,3.2), 3)
  2401077.222
  >>> round(POWER(4,5.0/4), 9)
  5.656854249
  """
  return _math.pow(base, exponent)


def PRODUCT(factor1, *more_factors):
  """
  Returns the result of multiplying a series of numbers together. Each argument may be a number or
  an array.

  >>> PRODUCT([5,15,30])
  2250
  >>> PRODUCT([5,15,30], 2)
  4500
  >>> PRODUCT(5,15,[30],[2])
  4500

  More tests:
  >>> PRODUCT([2, True, None, "", False, "0", 5])
  10
  >>> PRODUCT([2, True, None, "", False, 0, 5])
  0
  """
  return reduce(operator.mul, _chain_numeric(factor1, *more_factors))

def QUOTIENT(dividend, divisor):
  """
  Returns one number divided by another, without the remainder.

  >>> QUOTIENT(5, 2)
  2
  >>> QUOTIENT(4.5, 3.1)
  1
  >>> QUOTIENT(-10, 3)
  -3
  """
  return TRUNC(float(dividend) / divisor)

def RADIANS(angle):
  """
  Converts an angle value in degrees to radians.

  >>> round(RADIANS(270), 6)
  4.712389
  """
  return _math.radians(angle)

def RAND():
  """
  Returns a random number between 0 inclusive and 1 exclusive.
  """
  return random.random()

def RANDBETWEEN(low, high):
  """
  Returns a uniformly random integer between two values, inclusive.
  """
  return random.randrange(low, high + 1)

def ROMAN(number, form_unused=None):
  """
  Formats a number in Roman numerals. The second argument is ignored in this implementation.

  >>> ROMAN(499,0)
  'CDXCIX'
  >>> ROMAN(499.2,0)
  'CDXCIX'
  >>> ROMAN(57)
  'LVII'
  >>> ROMAN(1912)
  'MCMXII'
  """
  # TODO: Maybe we should support the second argument.
  return roman.toRoman(int(number))

def ROUND(value, places=0):
  """
  Rounds a number to a certain number of decimal places,
  by default to the nearest whole number if the number of places is not given.

  Rounds away from zero ('up' for positive numbers)
  in the case of a tie, i.e. when the last digit is 5.

  >>> ROUND(1.4)
  1.0
  >>> ROUND(1.5)
  2.0
  >>> ROUND(2.5)
  3.0
  >>> ROUND(-2.5)
  -3.0
  >>> ROUND(2.15, 1)
  2.2
  >>> ROUND(-1.475, 2)
  -1.48
  >>> ROUND(21.5, -1)
  20.0
  >>> ROUND(626.3,-3)
  1000.0
  >>> ROUND(1.98,-1)
  0.0
  >>> ROUND(-50.55,-2)
  -100.0
  >>> ROUND(0)
  0.0
  """
  p = 10 ** places
  if value >= 0:
    return float(_math.floor((value * p) + 0.5)) / p
  else:
    return float(_math.ceil((value * p) - 0.5)) / p


def ROUNDDOWN(value, places=0):
  """
  Rounds a number to a certain number of decimal places, always rounding down towards zero.

  >>> ROUNDDOWN(3.2, 0)
  3
  >>> ROUNDDOWN(76.9,0)
  76
  >>> ROUNDDOWN(3.14159, 3)
  3.141
  >>> ROUNDDOWN(-3.14159, 1)
  -3.1
  >>> ROUNDDOWN(31415.92654, -2)
  31400
  """
  factor = 10**-places
  return int(_round_toward_zero(float(value) / factor)) * factor

def ROUNDUP(value, places=0):
  """
  Rounds a number to a certain number of decimal places, always rounding up away from zero.

  >>> ROUNDUP(3.2,0)
  4
  >>> ROUNDUP(76.9,0)
  77
  >>> ROUNDUP(3.14159, 3)
  3.142
  >>> ROUNDUP(-3.14159, 1)
  -3.2
  >>> ROUNDUP(31415.92654, -2)
  31500
  """
  factor = 10**-places
  return int(_round_away_from_zero(float(value) / factor)) * factor

def SERIESSUM(x, n, m, a):
  """
  Given parameters x, n, m, and a, returns the power series sum a_1*x^n + a_2*x^(n+m)
  + ... + a_i*x^(n+(i-1)m), where i is the number of entries in range `a`.

  >>> SERIESSUM(1,0,1,1)
  1
  >>> SERIESSUM(2,1,0,[1,2,3])
  12
  >>> SERIESSUM(-3,1,1,[2,4,6])
  -132
  >>> round(SERIESSUM(PI()/4,0,2,[1,-1./FACT(2),1./FACT(4),-1./FACT(6)]), 6)
  0.707103
  """
  return sum(coef*pow(x, n+i*m) for i, coef in enumerate(_chain(a)))

def SIGN(value):
  """
  Given an input number, returns `-1` if it is negative, `1` if positive, and `0` if it is zero.

  >>> SIGN(10)
  1
  >>> SIGN(4.0-4.0)
  0
  >>> SIGN(-0.00001)
  -1
  """
  return 0 if value == 0 else int(_math.copysign(1, value))

def SIN(angle):
  """
  Returns the sine of an angle provided in radians.

  >>> round(SIN(PI()), 10)
  0.0
  >>> SIN(PI()/2)
  1.0
  >>> round(SIN(30*PI()/180), 10)
  0.5
  >>> round(SIN(RADIANS(30)), 10)
  0.5
  """
  return _math.sin(angle)

def SINH(value):
  """
  Returns the hyperbolic sine of any real number.

  >>> round(2.868*SINH(0.0342*1.03), 7)
  0.1010491
  """
  return _math.sinh(value)

def SQRT(value):
  """
  Returns the positive square root of a positive number.

  >>> SQRT(16)
  4.0
  >>> SQRT(-16)
  Traceback (most recent call last):
    ...
  ValueError: math domain error
  >>> SQRT(ABS(-16))
  4.0
  """
  return _math.sqrt(value)


def SQRTPI(value):
  """
  Returns the positive square root of the product of Pi and the given positive number.

  >>> round(SQRTPI(1), 6)
  1.772454
  >>> round(SQRTPI(2), 6)
  2.506628
  """
  return _math.sqrt(_math.pi * value)

@unimplemented
def SUBTOTAL(function_code, range1, range2):
  """
  Returns a subtotal for a vertical range of cells using a specified aggregation function.
  """
  raise NotImplementedError()


def SUM(value1, *more_values):
  """
  Returns the sum of a series of numbers. Each argument may be a number or an array.
  Non-numeric values are ignored.

  >>> SUM([5,15,30])
  50
  >>> SUM([5.,15,30], 2)
  52.0
  >>> SUM(5,15,[30],[2])
  52

  More tests:
  >>> SUM([10.25, None, "", False, "other", 20.5])
  30.75
  >>> SUM([True, "3", 4], True)
  6
  """
  return sum(_chain_numeric_a(value1, *more_values))


@unimplemented
def SUMIF(records, criterion, sum_range):
  """
  Returns a conditional sum across a range.
  """
  raise NotImplementedError()

@unimplemented
def SUMIFS(sum_range, criteria_range1, criterion1, *args):
  """
  Returns the sum of a range depending on multiple criteria.
  """
  raise NotImplementedError()

def SUMPRODUCT(array1, *more_arrays):
  """
  Multiplies corresponding components in two equally-sized arrays,
  and returns the sum of those products.

  >>> SUMPRODUCT([3,8,1,4,6,9], [2,6,5,7,7,3])
  156
  >>> SUMPRODUCT([], [], [])
  0
  >>> SUMPRODUCT([-0.25], [-2], [-3])
  -1.5
  >>> SUMPRODUCT([-0.25, -0.25], [-2, -2], [-3, -3])
  -3.0
  """
  return sum(reduce(operator.mul, values) for values in zip(array1, *more_arrays))

@unimplemented
def SUMSQ(value1, value2):
  """
  Returns the sum of the squares of a series of numbers and/or cells.
  """
  raise NotImplementedError()

def TAN(angle):
  """
  Returns the tangent of an angle provided in radians.

  >>> round(TAN(0.785), 8)
  0.99920399
  >>> round(TAN(45*PI()/180), 10)
  1.0
  >>> round(TAN(RADIANS(45)), 10)
  1.0
  """
  return _math.tan(angle)

def TANH(value):
  """
  Returns the hyperbolic tangent of any real number.

  >>> round(TANH(-2), 6)
  -0.964028
  >>> TANH(0)
  0.0
  >>> round(TANH(0.5), 6)
  0.462117
  """
  return _math.tanh(value)

def TRUNC(value, places=0):
  """
  Truncates a number to a certain number of significant digits by omitting less significant
  digits.

  >>> TRUNC(8.9)
  8
  >>> TRUNC(-8.9)
  -8
  >>> TRUNC(0.45)
  0
  """
  # TRUNC seems indistinguishable from ROUNDDOWN.
  return ROUNDDOWN(value, places)

def UUID():
  """
  Generate a random UUID-formatted string identifier.

  Since UUID() produces a different value each time it's called, it is best to use it in
  [trigger formula](formulas.md#trigger-formulas) for new records.
  This would only calculate UUID() once and freeze the calculated value. By contrast, a regular
  formula may get recalculated any time the document is reloaded, producing a different value for
  UUID() each time.
  """
  try:
    uid = uuid.uuid4()
  except Exception:
    # Pynbox doesn't support the above because it doesn't support `os.urandom()`.
    # Using the `random` module is less secure but should be OK.
    if six.PY2:
      byts = [chr(random.randrange(0, 256)) for _ in xrange(0, 16)]
    else:
      byts = bytes([random.randrange(0, 256) for _ in range(0, 16)])
    uid = uuid.UUID(bytes=byts, version=4)
  return str(uid)
