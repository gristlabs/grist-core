import math
import time
import statistics
import testutil
import test_engine


class TestSummaryPerformance(test_engine.EngineTestCase):
  # The structure here mirrors the test in test_lookup_perf.py.
  def test_non_quadratic(self):
    # Timing-based, hence inherently flaky; if it fails legitimately it fails every time, so we
    # retry and only fail if every attempt fails (as in test_lookup_perf).
    for i in range(2):
      try:
        self._do_test_non_quadratic()
        return
      except Exception:
        print("FAIL #%d" % (i + 1))
    self._do_test_non_quadratic()

  def _do_test_non_quadratic(self):
    # Maintaining a summary table should cost O(1) amortized per source row. A summary group's
    # members are found by sorting the helper reference column's inverse_map. Its aggregates
    # ('count' and 'amount') read that stored "group" value. Adding rows in a geometric sequence
    # should take time that's linear in the number of rows. So it should fit a line of slope ~1 in
    # log-log space; a quadratic term (e.g. re-sorting per reader, or re-scanning all rows per
    # add) would push the slope toward 2.
    self.setUp()
    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Items", [
          [1, "cat",    "Text",    False, "", "", ""],
          [2, "amount", "Numeric", False, "", "", ""],
        ]],
      ],
      "DATA": {}
    }))
    # Summarize by cat, into a handful of groups that grow as we add rows.
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [1], None])

    num_records = 0

    def add_records(count):
      self.add_records("Items", ["cat", "amount"],
                       [["cat%d" % (i % 8), float(i)] for i in range(count)])
      return num_records + count

    # Add records in a geometric sequence, timing each batch.
    times = {}
    start_time = time.time()
    last_time = start_time
    count_add = 16
    while last_time < start_time + 2:       # Stop once we've spent 2 seconds
      add_time = time.time()
      num_records = add_records(count_add)
      last_time = time.time()
      times[num_records] = last_time - add_time
      count_add *= 2

    # Sanity check that we have some expected data in the summary table. We summarized by category
    # "cat0" through "cat7",
    self.assertTableData(
      "Items_summary_cat", cols="subset", rows="all", data=[
        ["id", "cat", "count"],
        [1,    "cat0", num_records / 8],
        [2,    "cat1", num_records / 8],
        [3,    "cat2", num_records / 8],
        [4,    "cat3", num_records / 8],
        [5,    "cat4", num_records / 8],
        [6,    "cat5", num_records / 8],
        [7,    "cat6", num_records / 8],
        [8,    "cat7", num_records / 8],
      ])

    count_array = sorted(times.keys())
    times_array = [times[r] for r in count_array]

    # Linear regression on log-transformed data.
    log_count_array = [math.log(x) for x in count_array]
    log_times_array = [math.log(x) for x in times_array]
    slope, intercept = statistics.linear_regression(log_count_array, log_times_array)
    r_squared = statistics.correlation(log_count_array, log_times_array) ** 2

    # Linear maintenance gives a log-log slope near 1; a quadratic term would push it toward 2. We
    # guard the upper side (the regression we care about) and require the line to actually fit;
    # the lower side is left open because the constant-overhead term legitimately keeps the
    # measured slope a bit under 1 (typically ~0.8 here).
    err_msg = "Summary maintenance looks non-linear: slope {} R^2 {}".format(slope, r_squared)
    self.assertLess(slope, 1.5, msg=err_msg)
    self.assertGreater(r_squared, 0.7, msg=err_msg)
