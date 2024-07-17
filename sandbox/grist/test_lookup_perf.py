import math
import time
import testutil
import test_engine

class TestLookupPerformance(test_engine.EngineTestCase):
  def test_non_quadratic(self):
    # This test measures performance which depends on other stuff running on the machine, which
    # makes it inherently flaky. But if it fails legitimately, it should fail every time. So we
    # run multiple times (3), and fail only if all of those times fail.
    for i in range(2):
      try:
        return self._do_test_non_quadratic()
      except Exception as e:
        print("FAIL #%d" % (i + 1))
    self._do_test_non_quadratic()

  def _do_test_non_quadratic(self):
    # If the same lookupRecords is called by many cells, it should reuse calculations, not lead to
    # quadratic complexity. (Actually making use of the result would often still be O(N) in each
    # cell, but here we check that just doing the lookup is O(1) amortized.)

    # Table1 has columns: Date and Status, each will have just two distinct values.
    # We add a bunch of formulas that should take constant time outside of the lookup.

    # The way we test for quadratic complexity is by timing "BulkAddRecord" action that causes all
    # rows to recalculate for a geometrically growing sequence of row counts. Then we
    # log-transform the data and do linear regression on it. It should produce data that fits
    # closely a line of slope 1.

    self.setUp()    # Repeat setup because this test case gets called multiple times.
    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Table1", [
          [1, "Date", "Date", False, "", "", ""],
          [2, "Status", "Text", False, "", "", ""],
          [3, "lookup_1a", "Any", True, "len(Table1.all)", "", ""],
          [4, "lookup_2a", "Any", True, "len(Table1.lookupRecords(order_by='-Date'))", "", ""],
          [5, "lookup_3a", "Any", True,
            "len(Table1.lookupRecords(Status=$Status, order_by=('-Date', '-id')))", "", ""],
          [6, "lookup_1b", "Any", True, "Table1.lookupOne().id", "", ""],
          # Keep one legacy sort_by example (it shares implementation, so should work similarly)
          [7, "lookup_2b", "Any", True, "Table1.lookupOne(sort_by='-Date').id", "", ""],
          [8, "lookup_3b", "Any", True,
            "Table1.lookupOne(Status=$Status, order_by=('-Date', '-id')).id", "", ""],
        ]]
      ],
      "DATA": {}
    }))

    num_records = 0

    def add_records(count):
      assert count % 4 == 0, "Call add_records with multiples of 4 here"
      self.add_records("Table1", ["Date", "Status"], [
        [ "2024-01-01",  "Green" ],
        [ "2024-01-01",  "Green" ],
        [ "2024-02-01",  "Blue" ],
        [ "2000-01-01",  "Blue" ],
      ] * (count // 4))

      N = num_records + count
      self.assertTableData(
        "Table1", cols="subset", rows="subset", data=[
          ["id", "lookup_1a", "lookup_2a", "lookup_3a", "lookup_1b", "lookup_2b", "lookup_3b"],
          [1,    N,           N,           N // 2,      1,           3,           N - 2],
        ])
      return N

    # Add records in a geometric sequence
    times = {}
    start_time = time.time()
    last_time = start_time
    count_add = 20
    while last_time < start_time + 2:       # Stop once we've spent 2 seconds
      add_time = time.time()
      num_records = add_records(count_add)
      last_time = time.time()
      times[num_records] = last_time - add_time
      count_add *= 2

    count_array = sorted(times.keys())
    times_array = [times[r] for r in count_array]

    # Perform linear regression on log-transformed data
    log_count_array = [math.log(x) for x in count_array]
    log_times_array = [math.log(x) for x in times_array]

    # Calculate slope and intercept using the least squares method.
    # Doing this manually so that it works in Python2 too.
    # Otherwise, we could just use statistics.linear_regression()
    n = len(log_count_array)
    sum_x = sum(log_count_array)
    sum_y = sum(log_times_array)
    sum_xx = sum(x * x for x in log_count_array)
    sum_xy = sum(x * y for x, y in zip(log_count_array, log_times_array))
    slope = (n * sum_xy - sum_x * sum_y) / (n * sum_xx - sum_x * sum_x)
    intercept = (sum_y - slope * sum_x) / n

    # Calculate R-squared
    mean_y = sum_y / n
    ss_tot = sum((y - mean_y) ** 2 for y in log_times_array)
    ss_res = sum((y - (slope * x + intercept)) ** 2
        for x, y in zip(log_count_array, log_times_array))
    r_squared = 1 - (ss_res / ss_tot)

    # Check that the slope is close to 1. For log-transformed data, this means a linear
    # relationship (a quadratic term would make the slope 2).
    # In practice, we see slope even less 1 (because there is a non-trivial constant term), so we
    # can assert things a bit lower than 1: 0.86 to 1.04.
    err_msg = "Time is non-linear: slope {} R^2 {}".format(slope, r_squared)
    self.assertAlmostEqual(slope, 0.95, delta=0.09, msg=err_msg)

    # Check that R^2 is close to 1, meaning that data is very close to that line (of slope ~1).
    self.assertAlmostEqual(r_squared, 1, delta=0.08, msg=err_msg)
