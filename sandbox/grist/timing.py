import contextlib
import time
import six


class Timing(object):
  def __init__(self):
    self._items = {}
    self._marks_stack = []

  @contextlib.contextmanager
  def measure(self, key):
    start = time.time()
    stack_start_len = len(self._marks_stack)
    try:
      yield
    finally:
      end = time.time()
      self._record_time(key, end - start)

      # Handle the marks added while in this invocation.
      n = len(self._marks_stack) - stack_start_len
      if n > 0:
        next_mark = ("end", end)
        while n > 0:
          mark = self._marks_stack.pop()
          self._record_time("{}@{}={}:{}".format(key, n, mark[0], next_mark[0]),
              next_mark[1] - mark[1])
          next_mark = mark
          n -= 1
        self._record_time("{}@{}={}:{}".format(key, n, "start", next_mark[0]), next_mark[1] - start)

  def mark(self, mark_name):
    self._marks_stack.append((mark_name, time.time()))

  def get(self, clear = True):
    # Copy it and clear immediately if requested.
    timing_log = self._items.copy()
    if clear:
      self.clear()
    # Stats will contain a json like structure with table_id, col_id, sum, count, average, max
    # and optionally a array of marks (in similar format)
    stats = []
    for key, t in sorted(timing_log.items(), key=lambda x: str(x[0])):
      # Key can be either a node (tuple with table_id and col_id) or a string with a mark.
      # The list is sorted so, we always first get the stats for the node and then the marks.
      # We will add marks to the last node.
      if isinstance(key, tuple):
        stats.append({"tableId": key[0], "colId": key[1], "sum": t.sum, "count": t.count,
                      "average": t.average, "max": t.max})
      else:
        # Create a marks array for the last node or append to the existing one.
        if stats:
          prev = stats[-1].get("marks", [])
          stats[-1]["marks"] = prev + [{
            "name": key, "sum": t.sum,
            "count": t.count, "average": t.average,
            "max": t.max
          }]
    return stats

  def dump(self):
    out = []
    for key, t in sorted(self._items.items(), key=lambda x: str(x[0])):
      out.append("%6d, %10f, %10f, %10f, %s" % (t.count, t.average, t.max, t.sum, key))
    print("Timing\n" + "\n".join(out))
    self.clear()

  def _record_time(self, key, time_sec):
    t = self._items.get(key)
    if not t:
      t = self._items[key] = TimingStats()
    t.add(time_sec)

  def clear(self):
    self._items.clear()



# An implementation that adds minimal overhead.
class DummyTiming(object):
  # pylint: disable=no-self-use,unused-argument,no-member
  def measure(self, key):
    if six.PY2:
      return contextlib.nested()
    return contextlib.nullcontext()

  def mark(self, mark_name):
    pass

  def dump(self):
    pass

  def get(self, clear = True):
    return []

  def clear(self):
    pass


class TimingStats(object):
  def __init__(self):
    self.count = 0
    self.sum = 0
    self.max = 0

  @property
  def average(self):
    return self.sum / self.count if self.count > 0 else 0

  def add(self, value):
    self.count += 1
    self.sum += value
    if value > self.max:
      self.max = value
