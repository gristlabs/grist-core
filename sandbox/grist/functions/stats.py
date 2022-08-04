# pylint: disable=redefined-builtin, line-too-long, unused-argument
import datetime

from .math import _chain, _chain_numeric, _chain_numeric_a, _chain_numeric_or_date
from .info import ISNUMBER, ISLOGICAL
from .date import DATE, DTIME       # pylint: disable=unused-import
from .unimplemented import unimplemented

def _average(iterable):
  total, count = 0.0, 0
  for value in iterable:
    total += value
    count += 1
  return total / count

def _default_if_empty(iterable, default):
  """
  Yields all values from iterable, except when it is empty, yields just the single default value.
  """
  empty = True
  for value in iterable:
    empty = False
    yield value
  if empty:
    yield default


@unimplemented
def AVEDEV(value1, value2):
  """Calculates the average of the magnitudes of deviations of data from a dataset's mean."""
  raise NotImplementedError()


def AVERAGE(value, *more_values):
  """
  Returns the numerical average value in a dataset, ignoring non-numerical values.

  Each argument may be a value or an array. Values that are not numbers, including logical
  and blank values, and text representations of numbers, are ignored.

  >>> AVERAGE([2, -1.0, 11])
  4.0
  >>> AVERAGE([2, -1, 11, "Hello"])
  4.0
  >>> AVERAGE([2, -1, "Hello", DATE(2015,1,1)], True, [False, "123", "", 11])
  4.0
  >>> AVERAGE(False, True)
  Traceback (most recent call last):
    ...
  ZeroDivisionError: float division by zero
  """
  return _average(_chain_numeric(value, *more_values))


def AVERAGEA(value, *more_values):
  """
  Returns the numerical average value in a dataset, counting non-numerical values as 0.

  Each argument may be a value of an array. Values that are not numbers, including dates and text
  representations of numbers, are counted as 0 (zero). Logical value of True is counted as 1, and
  False as 0.

  >>> AVERAGEA([2, -1.0, 11])
  4.0
  >>> AVERAGEA([2, -1, 11, "Hello"])
  3.0
  >>> AVERAGEA([2, -1, "Hello", DATE(2015,1,1)], True, [False, "123", "", 11.5])
  1.5
  >>> AVERAGEA(False, True)
  0.5
  """
  return _average(_chain_numeric_a(value, *more_values))

# Note that Google Sheets offers a similar function, called AVERAGE.WEIGHTED
# (https://support.google.com/docs/answer/9084098?hl=en)
def AVERAGE_WEIGHTED(pairs):
  """
  Given a list of (value, weight) pairs, finds the average of the values weighted by the
  corresponding weights. Ignores any pairs with a non-numerical value or weight.

  If you have two lists, of values and weights, use the Python built-in zip() function to create a
  list of pairs.

  >>> AVERAGE_WEIGHTED(((95, .25), (90, .1), ("X", .5), (85, .15), (88, .2), (82, .3), (70, None)))
  87.7
  >>> AVERAGE_WEIGHTED(zip([95, 90, "X", 85, 88, 82, 70], [25, 10, 50, 15, 20, 30, None]))
  87.7
  >>> AVERAGE_WEIGHTED(zip([95, 90, False, 85, 88, 82, 70], [.25, .1, .5, .15, .2, .3, True]))
  87.7
  """
  sum_value, sum_weight = 0.0, 0.0
  for value, weight in pairs:
    # The type-checking here is the same as used by _chain_numeric.
    if ISNUMBER(value) and not ISLOGICAL(value) and ISNUMBER(weight) and not ISLOGICAL(weight):
      sum_value += value * weight
      sum_weight += weight
  return sum_value / sum_weight


@unimplemented
def AVERAGEIF(criteria_range, criterion, average_range=None):
  """Returns the average of a range depending on criteria."""
  raise NotImplementedError()

@unimplemented
def AVERAGEIFS(average_range, criteria_range1, criterion1, *args):
  """Returns the average of a range depending on multiple criteria."""
  raise NotImplementedError()

@unimplemented
def BINOMDIST(num_successes, num_trials, prob_success, cumulative):
  """
  Calculates the probability of drawing a certain number of successes (or a maximum number of
  successes) in a certain number of tries given a population of a certain size containing a
  certain number of successes, with replacement of draws.
  """
  raise NotImplementedError()

@unimplemented
def CONFIDENCE(alpha, standard_deviation, pop_size):
  """Calculates the width of half the confidence interval for a normal distribution."""
  raise NotImplementedError()

@unimplemented
def CORREL(data_y, data_x):
  """Calculates r, the Pearson product-moment correlation coefficient of a dataset."""
  raise NotImplementedError()

def COUNT(value, *more_values):
  """
  Returns the count of numerical and date/datetime values in a dataset,
  ignoring other types of values.

  Each argument may be a value or an array. Values that are not numbers or dates, including logical
  and blank values, and text representations of numbers, are ignored.

  >>> COUNT([2, -1.0, 11])
  3
  >>> COUNT([2, -1, 11, "Hello"])
  3
  >>> COUNT([DATE(2000, 1, 1), DATE(2000, 1, 2), DATE(2000, 1, 3), "Hello"])
  3
  >>> COUNT([2, -1, "Hello", DATE(2015,1,1)], True, [False, "123", "", 11.5])
  4
  >>> COUNT(False, True)
  0
  """
  return sum(1 for _ in _chain_numeric_or_date(value, *more_values))


def COUNTA(value, *more_values):
  """
  Returns the count of all values in a dataset, including non-numerical values.

  Each argument may be a value or an array.

  >>> COUNTA([2, -1.0, 11])
  3
  >>> COUNTA([2, -1, 11, "Hello"])
  4
  >>> COUNTA([2, -1, "Hello", DATE(2015,1,1)], True, [False, "123", "", 11.5])
  9
  >>> COUNTA(False, True)
  2
  """
  return sum(1 for _ in _chain(value, *more_values))


@unimplemented
def COVAR(data_y, data_x):
  """Calculates the covariance of a dataset."""
  raise NotImplementedError()

@unimplemented
def CRITBINOM(num_trials, prob_success, target_prob):
  """Calculates the smallest value for which the cumulative binomial distribution is greater than or equal to a specified criteria."""
  raise NotImplementedError()

@unimplemented
def DEVSQ(value1, value2):
  """Calculates the sum of squares of deviations based on a sample."""
  raise NotImplementedError()

@unimplemented
def EXPONDIST(x, lambda_, cumulative):
  """Returns the value of the exponential distribution function with a specified lambda at a specified value."""
  raise NotImplementedError()

@unimplemented
def F_DIST(x, degrees_freedom1, degrees_freedom2, cumulative):
  """
  Calculates the left-tailed F probability distribution (degree of diversity) for two data sets
  with given input x. Alternately called Fisher-Snedecor distribution or Snedecor's F
  distribution.
  """
  raise NotImplementedError()

@unimplemented
def F_DIST_RT(x, degrees_freedom1, degrees_freedom2):
  """
  Calculates the right-tailed F probability distribution (degree of diversity) for two data sets
  with given input x. Alternately called Fisher-Snedecor distribution or Snedecor's F
  distribution.
  """
  raise NotImplementedError()

@unimplemented
def FDIST(x, degrees_freedom1, degrees_freedom2):
  """
  Calculates the right-tailed F probability distribution (degree of diversity) for two data sets
  with given input x. Alternately called Fisher-Snedecor distribution or Snedecor's F
  distribution.
  """
  raise NotImplementedError()

@unimplemented
def FISHER(value):
  """Returns the Fisher transformation of a specified value."""
  raise NotImplementedError()

@unimplemented
def FISHERINV(value):
  """Returns the inverse Fisher transformation of a specified value."""
  raise NotImplementedError()

@unimplemented
def FORECAST(x, data_y, data_x):
  """Calculates the expected y-value for a specified x based on a linear regression of a dataset."""
  raise NotImplementedError()

@unimplemented
def GEOMEAN(value1, value2):
  """Calculates the geometric mean of a dataset."""
  raise NotImplementedError()

@unimplemented
def HARMEAN(value1, value2):
  """Calculates the harmonic mean of a dataset."""
  raise NotImplementedError()

@unimplemented
def HYPGEOMDIST(num_successes, num_draws, successes_in_pop, pop_size):
  """Calculates the probability of drawing a certain number of successes in a certain number of tries given a population of a certain size containing a certain number of successes, without replacement of draws."""
  raise NotImplementedError()

@unimplemented
def INTERCEPT(data_y, data_x):
  """Calculates the y-value at which the line resulting from linear regression of a dataset will intersect the y-axis (x=0)."""
  raise NotImplementedError()

@unimplemented
def KURT(value1, value2):
  """Calculates the kurtosis of a dataset, which describes the shape, and in particular the "peakedness" of that dataset."""
  raise NotImplementedError()

@unimplemented
def LARGE(data, n):
  """Returns the nth largest element from a data set, where n is user-defined."""
  raise NotImplementedError()

@unimplemented
def LOGINV(x, mean, standard_deviation):
  """Returns the value of the inverse log-normal cumulative distribution with given mean and standard deviation at a specified value."""
  raise NotImplementedError()

@unimplemented
def LOGNORMDIST(x, mean, standard_deviation):
  """Returns the value of the log-normal cumulative distribution with given mean and standard deviation at a specified value."""
  raise NotImplementedError()


def MAX(value, *more_values):
  """
  Returns the maximum value in a dataset, ignoring values other than numbers and dates/datetimes.

  Each argument may be a value or an array. Values that are not numbers or dates, including logical
  and blank values, and text representations of numbers, are ignored. Returns 0 if the arguments
  contain no numbers or dates.

  >>> MAX([2, -1.5, 11.5])
  11.5
  >>> MAX([2, -1.5, "Hello"], True, [False, "123", "", 11.5])
  11.5
  >>> MAX(True, -123)
  -123
  >>> MAX("123", -123)
  -123
  >>> MAX("Hello", "123", True, False)
  0
  >>> MAX(DATE(2015, 1, 1), DATE(2015, 1, 2))
  datetime.date(2015, 1, 2)
  >>> MAX(DATE(2015, 1, 1), datetime.datetime(2015, 1, 1, 12, 34, 56))
  datetime.datetime(2015, 1, 1, 12, 34, 56)
  >>> MAX(DATE(2015, 1, 2), datetime.datetime(2015, 1, 1, 12, 34, 56))
  datetime.date(2015, 1, 2)
  """
  values = _default_if_empty(_chain_numeric_or_date(value, *more_values), 0)
  return max(values, key=_compare_date_datetime_key)


def MAXA(value, *more_values):
  """
  Returns the maximum numeric value in a dataset.

  Each argument may be a value of an array. Values that are not numbers, including dates and text
  representations of numbers, are counted as 0 (zero). Logical value of True is counted as 1, and
  False as 0. Returns 0 if the arguments contain no numbers.

  >>> MAXA([2, -1.5, 11.5])
  11.5
  >>> MAXA([2, -1.5, "Hello", DATE(2015, 1, 1)], True, [False, "123", "", 11.5])
  11.5
  >>> MAXA(True, -123)
  1
  >>> MAXA("123", -123)
  0
  >>> MAXA("Hello", "123", DATE(2015, 1, 1))
  0
  """
  return max(_default_if_empty(_chain_numeric_a(value, *more_values), 0))


def MEDIAN(value, *more_values):
  """
  Returns the median value in a numeric dataset, ignoring non-numerical values.

  Each argument may be a value or an array. Values that are not numbers, including logical
  and blank values, and text representations of numbers, are ignored.

  Produces an error if the arguments contain no numbers.

  The median is the middle number when all values are sorted. So half of the values in the dataset
  are less than the median, and half of the values are greater. If there is an even number of
  values in the dataset, returns the average of the two numbers in the middle.

  >>> MEDIAN(1, 2, 3, 4, 5)
  3
  >>> MEDIAN(3, 5, 1, 4, 2)
  3
  >>> MEDIAN(range(10))
  4.5
  >>> MEDIAN("Hello", "123", DATE(2015, 1, 1), 12.3)
  12.3
  >>> MEDIAN("Hello", "123", DATE(2015, 1, 1))
  Traceback (most recent call last):
    ...
  ValueError: MEDIAN requires at least one number
  """
  values = sorted(_chain_numeric(value, *more_values))
  if not values:
    raise ValueError("MEDIAN requires at least one number")
  count = len(values)
  if count % 2 == 0:
    return (values[count // 2 - 1] + values[count // 2]) / 2.0
  else:
    return values[(count - 1) // 2]


def _compare_date_datetime_key(x):
  # Convert dates and naive datetimes to timezone-aware datetimes for sorting.
  if isinstance(x, (datetime.date, datetime.datetime)):
    return DTIME(x)
  else:
    return x


def MIN(value, *more_values):
  """
  Returns the minimum value in a dataset, ignoring values other than numbers and dates/datetimes.

  Each argument may be a value or an array. Values that are not numbers or dates, including logical
  and blank values, and text representations of numbers, are ignored. Returns 0 if the arguments
  contain no numbers or dates.

  >>> MIN([2, -1.5, 11.5])
  -1.5
  >>> MIN([2, -1.5, "Hello"], True, [False, "123", "", 11.5])
  -1.5
  >>> MIN(True, 123)
  123
  >>> MIN("-123", 123)
  123
  >>> MIN("Hello", "123", True, False)
  0
  >>> MIN(DATE(2015, 1, 1), DATE(2015, 1, 2))
  datetime.date(2015, 1, 1)
  >>> MIN(DATE(2015, 1, 1), datetime.datetime(2015, 1, 1, 12, 34, 56))
  datetime.date(2015, 1, 1)
  >>> MIN(DATE(2015, 1, 2), datetime.datetime(2015, 1, 1, 12, 34, 56))
  datetime.datetime(2015, 1, 1, 12, 34, 56)
  """
  values = _default_if_empty(_chain_numeric_or_date(value, *more_values), 0)
  return min(values, key=_compare_date_datetime_key)

def MINA(value, *more_values):
  """
  Returns the minimum numeric value in a dataset.

  Each argument may be a value of an array. Values that are not numbers, including dates and text
  representations of numbers, are counted as 0 (zero). Logical value of True is counted as 1, and
  False as 0. Returns 0 if the arguments contain no numbers.

  >>> MINA([2, -1.5, 11.5])
  -1.5
  >>> MINA([2, -1.5, "Hello", DATE(2015, 1, 1)], True, [False, "123", "", 11.5])
  -1.5
  >>> MINA(True, 123)
  1
  >>> MINA("-123", 123)
  0
  >>> MINA("Hello", "123", DATE(2015, 1, 1))
  0
  """
  return min(_default_if_empty(_chain_numeric_a(value, *more_values), 0))


@unimplemented
def MODE(value1, value2):
  """Returns the most commonly occurring value in a dataset."""
  raise NotImplementedError()

@unimplemented
def NEGBINOMDIST(num_failures, num_successes, prob_success):
  """Calculates the probability of drawing a certain number of failures before a certain number of successes given a probability of success in independent trials."""
  raise NotImplementedError()

@unimplemented
def NORMDIST(x, mean, standard_deviation, cumulative):
  """
  Returns the value of the normal distribution function (or normal cumulative distribution
  function) for a specified value, mean, and standard deviation.
  """
  raise NotImplementedError()

@unimplemented
def NORMINV(x, mean, standard_deviation):
  """Returns the value of the inverse normal distribution function for a specified value, mean, and standard deviation."""
  raise NotImplementedError()

@unimplemented
def NORMSDIST(x):
  """Returns the value of the standard normal cumulative distribution function for a specified value."""
  raise NotImplementedError()

@unimplemented
def NORMSINV(x):
  """Returns the value of the inverse standard normal distribution function for a specified value."""
  raise NotImplementedError()

@unimplemented
def PEARSON(data_y, data_x):
  """Calculates r, the Pearson product-moment correlation coefficient of a dataset."""
  raise NotImplementedError()

@unimplemented
def PERCENTILE(data, percentile):
  """Returns the value at a given percentile of a dataset."""
  raise NotImplementedError()

@unimplemented
def PERCENTRANK(data, value, significant_digits=None):
  """Returns the percentage rank (percentile) of a specified value in a dataset."""
  raise NotImplementedError()

@unimplemented
def PERCENTRANK_EXC(data, value, significant_digits=None):
  """Returns the percentage rank (percentile) from 0 to 1 exclusive of a specified value in a dataset."""
  raise NotImplementedError()

@unimplemented
def PERCENTRANK_INC(data, value, significant_digits=None):
  """Returns the percentage rank (percentile) from 0 to 1 inclusive of a specified value in a dataset."""
  raise NotImplementedError()

@unimplemented
def PERMUT(n, k):
  """Returns the number of ways to choose some number of objects from a pool of a given size of objects, considering order."""
  raise NotImplementedError()

@unimplemented
def POISSON(x, mean, cumulative):
  """
  Returns the value of the Poisson distribution function (or Poisson cumulative distribution
  function) for a specified value and mean.
  """
  raise NotImplementedError()

@unimplemented
def PROB(data, probabilities, low_limit, high_limit=None):
  """Given a set of values and corresponding probabilities, calculates the probability that a value chosen at random falls between two limits."""
  raise NotImplementedError()

@unimplemented
def QUARTILE(data, quartile_number):
  """Returns a value nearest to a specified quartile of a dataset."""
  raise NotImplementedError()

@unimplemented
def RANK(value, data, is_ascending=None):
  """Returns the rank of a specified value in a dataset."""
  raise NotImplementedError()

@unimplemented
def RANK_AVG(value, data, is_ascending=None):
  """Returns the rank of a specified value in a dataset. If there is more than one entry of the same value in the dataset, the average rank of the entries will be returned."""
  raise NotImplementedError()

@unimplemented
def RANK_EQ(value, data, is_ascending=None):
  """Returns the rank of a specified value in a dataset. If there is more than one entry of the same value in the dataset, the top rank of the entries will be returned."""
  raise NotImplementedError()

@unimplemented
def RSQ(data_y, data_x):
  """Calculates the square of r, the Pearson product-moment correlation coefficient of a dataset."""
  raise NotImplementedError()

@unimplemented
def SKEW(value1, value2):
  """Calculates the skewness of a dataset, which describes the symmetry of that dataset about the mean."""
  raise NotImplementedError()

@unimplemented
def SLOPE(data_y, data_x):
  """Calculates the slope of the line resulting from linear regression of a dataset."""
  raise NotImplementedError()

@unimplemented
def SMALL(data, n):
  """Returns the nth smallest element from a data set, where n is user-defined."""
  raise NotImplementedError()

@unimplemented
def STANDARDIZE(value, mean, standard_deviation):
  """Calculates the normalized equivalent of a random variable given mean and standard deviation of the distribution."""
  raise NotImplementedError()

# This should make us all cry a little. Because the sandbox does not do Python3 (which has
# statistics package), and because it does not do numpy (because it's native and hasn't been built
# for it), we have to implement simple stats functions by hand.
# TODO: switch to use the statistics package instead, once we upgrade to Python3.
#
# The following implementation of stdev is taken from https://stackoverflow.com/a/27758326/328565
def _mean(data):
  return sum(data) / float(len(data))

def _ss(data):
  """Return sum of square deviations of sequence data."""
  c = _mean(data)
  return sum((x-c)**2 for x in data)

def _stddev(data, ddof=0):
  """Calculates the population standard deviation
  by default; specify ddof=1 to compute the sample
  standard deviation."""
  n = len(data)
  ss = _ss(data)
  pvar = ss/(n-ddof)
  return pvar**0.5

# The examples in the doctests below come from https://support.google.com/docs/answer/3094054 and
# related articles, which helps ensure correctness and compatibility.
def STDEV(value, *more_values):
  """
  Calculates the standard deviation based on a sample, ignoring non-numerical values.

  >>> STDEV([2, 5, 8, 13, 10])
  4.277849927241488
  >>> STDEV([2, 5, 8, 13, 10, True, False, "Test"])
  4.277849927241488
  >>> STDEV([2, 5, 8, 13, 10], 3, 12, 15)
  4.810702354423639
  >>> STDEV([2, 5, 8, 13, 10], [3, 12, 15])
  4.810702354423639
  >>> STDEV([5])
  Traceback (most recent call last):
    ...
  ZeroDivisionError: float division by zero
  """
  return _stddev(list(_chain_numeric(value, *more_values)), 1)

def STDEVA(value, *more_values):
  """
  Calculates the standard deviation based on a sample, setting text to the value `0`.

  >>> STDEVA([2, 5, 8, 13, 10])
  4.277849927241488
  >>> STDEVA([2, 5, 8, 13, 10, True, False, "Test"])
  4.969550137731641
  >>> STDEVA([2, 5, 8, 13, 10], 1, 0, 0)
  4.969550137731641
  >>> STDEVA([2, 5, 8, 13, 10], [1, 0, 0])
  4.969550137731641
  >>> STDEVA([5])
  Traceback (most recent call last):
    ...
  ZeroDivisionError: float division by zero
  """
  return _stddev(list(_chain_numeric_a(value, *more_values)), 1)

def STDEVP(value, *more_values):
  """
  Calculates the standard deviation based on an entire population, ignoring non-numerical values.

  >>> STDEVP([2, 5, 8, 13, 10])
  3.8262252939417984
  >>> STDEVP([2, 5, 8, 13, 10, True, False, "Test"])
  3.8262252939417984
  >>> STDEVP([2, 5, 8, 13, 10], 3, 12, 15)
  4.5
  >>> STDEVP([2, 5, 8, 13, 10], [3, 12, 15])
  4.5
  >>> STDEVP([5])
  0.0
  """
  return _stddev(list(_chain_numeric(value, *more_values)), 0)

def STDEVPA(value, *more_values):
  """
  Calculates the standard deviation based on an entire population, setting text to the value `0`.

  >>> STDEVPA([2, 5, 8, 13, 10])
  3.8262252939417984
  >>> STDEVPA([2, 5, 8, 13, 10, True, False, "Test"])
  4.648588495446763
  >>> STDEVPA([2, 5, 8, 13, 10], 1, 0, 0)
  4.648588495446763
  >>> STDEVPA([2, 5, 8, 13, 10], [1, 0, 0])
  4.648588495446763
  >>> STDEVPA([5])
  0.0
  """
  return _stddev(list(_chain_numeric_a(value, *more_values)), 0)

@unimplemented
def STEYX(data_y, data_x):
  """Calculates the standard error of the predicted y-value for each x in the regression of a dataset."""
  raise NotImplementedError()

@unimplemented
def T_INV(probability, degrees_freedom):
  """Calculates the negative inverse of the one-tailed TDIST function."""
  raise NotImplementedError()

@unimplemented
def T_INV_2T(probability, degrees_freedom):
  """Calculates the inverse of the two-tailed TDIST function."""
  raise NotImplementedError()

@unimplemented
def TDIST(x, degrees_freedom, tails):
  """Calculates the probability for Student's t-distribution with a given input (x)."""
  raise NotImplementedError()

@unimplemented
def TINV(probability, degrees_freedom):
  """Calculates the inverse of the two-tailed TDIST function."""
  raise NotImplementedError()

@unimplemented
def TRIMMEAN(data, exclude_proportion):
  """Calculates the mean of a dataset excluding some proportion of data from the high and low ends of the dataset."""
  raise NotImplementedError()

@unimplemented
def TTEST(range1, range2, tails, type):
  """Returns the probability associated with t-test. Determines whether two samples are likely to have come from the same two underlying populations that have the same mean."""
  raise NotImplementedError()

@unimplemented
def VAR(value1, value2):
  """Calculates the variance based on a sample."""
  raise NotImplementedError()

@unimplemented
def VARA(value1, value2):
  """Calculates an estimate of variance based on a sample, setting text to the value `0`."""
  raise NotImplementedError()

@unimplemented
def VARP(value1, value2):
  """Calculates the variance based on an entire population."""
  raise NotImplementedError()

@unimplemented
def VARPA(value1, value2):
  """Calculates the variance based on an entire population, setting text to the value `0`."""
  raise NotImplementedError()

@unimplemented
def WEIBULL(x, shape, scale, cumulative):
  """
  Returns the value of the Weibull distribution function (or Weibull cumulative distribution
  function) for a specified shape and scale.
  """
  raise NotImplementedError()

@unimplemented
def ZTEST(data, value, standard_deviation):
  """Returns the two-tailed P-value of a Z-test with standard distribution."""
  raise NotImplementedError()
