from datetime import date, datetime, timedelta
import os
import timeit
import unittest

import moment
from . import schedule
from functions.date import DTIME
from functions import date as _date

DT = DTIME

TICK = timedelta.resolution
_orig_global_tz_getter = None

class TestSchedule(unittest.TestCase):
  def assertDate(self, date_or_dtime, expected_str):
    """Formats date_or_dtime and compares the formatted value."""
    return self.assertEqual(date_or_dtime.strftime("%Y-%m-%d %H:%M:%S"), expected_str)

  def assertDateIso(self, date_or_dtime, expected_str):
    """Formats date_or_dtime and compares the formatted value."""
    return self.assertEqual(date_or_dtime.isoformat(' '), expected_str)

  def assertDelta(self, delta, months=0, **timedelta_args):
    """Asserts that the given delta corresponds to the given number of various units."""
    self.assertEqual(delta._months, months)
    self.assertEqual(delta._timedelta, timedelta(**timedelta_args))

  @classmethod
  def setUpClass(cls):
    global _orig_global_tz_getter # pylint: disable=global-statement
    _orig_global_tz_getter = _date._get_global_tz
    _date._get_global_tz = lambda: moment.tzinfo('America/New_York')

  @classmethod
  def tearDownClass(cls):
    _date._get_global_tz = _orig_global_tz_getter


  def test_round_down_to_unit(self):
    RDU = schedule._round_down_to_unit
    self.assertDate(RDU(DT("2018-09-04 14:38:11"), "years"), "2018-01-01 00:00:00")
    self.assertDate(RDU(DT("2018-01-01 00:00:00"), "years"), "2018-01-01 00:00:00")
    self.assertDate(RDU(DT("2018-01-01 00:00:00") - TICK, "years"), "2017-01-01 00:00:00")

    self.assertDate(RDU(DT("2018-09-04 14:38:11"), "months"), "2018-09-01 00:00:00")
    self.assertDate(RDU(DT("2018-09-01 00:00:00"), "months"), "2018-09-01 00:00:00")
    self.assertDate(RDU(DT("2018-09-01 00:00:00") - TICK, "months"), "2018-08-01 00:00:00")

    # Note that 9/4 was a Tuesday, so start of the week (Sunday) is 9/2
    self.assertDate(RDU(DT("2018-09-04 14:38:11"), "weeks"), "2018-09-02 00:00:00")
    self.assertDate(RDU(DT("2018-09-02 00:00:00"), "weeks"), "2018-09-02 00:00:00")
    self.assertDate(RDU(DT("2018-09-02 00:00:00") - TICK, "weeks"), "2018-08-26 00:00:00")

    self.assertDate(RDU(DT("2018-09-04 14:38:11"), "days"), "2018-09-04 00:00:00")
    self.assertDate(RDU(DT("2018-09-04 00:00:00"), "days"), "2018-09-04 00:00:00")
    self.assertDate(RDU(DT("2018-09-04 00:00:00") - TICK, "days"), "2018-09-03 00:00:00")

    self.assertDate(RDU(DT("2018-09-04 14:38:11"), "hours"), "2018-09-04 14:00:00")
    self.assertDate(RDU(DT("2018-09-04 14:00:00"), "hours"), "2018-09-04 14:00:00")
    self.assertDate(RDU(DT("2018-09-04 14:00:00") - TICK, "hours"), "2018-09-04 13:00:00")

    self.assertDate(RDU(DT("2018-09-04 14:38:11"), "minutes"), "2018-09-04 14:38:00")
    self.assertDate(RDU(DT("2018-09-04 14:38:00"), "minutes"), "2018-09-04 14:38:00")
    self.assertDate(RDU(DT("2018-09-04 14:38:00") - TICK, "minutes"), "2018-09-04 14:37:00")

    self.assertDate(RDU(DT("2018-09-04 14:38:11"), "seconds"), "2018-09-04 14:38:11")
    self.assertDate(RDU(DT("2018-09-04 14:38:11") - TICK, "seconds"), "2018-09-04 14:38:10")

    with self.assertRaisesRegex(ValueError, r"Invalid unit inches"):
      RDU(DT("2018-09-04 14:38:11"), "inches")

  def test_round_down_to_unit_tz(self):
    RDU = schedule._round_down_to_unit
    dt = datetime(2018, 1, 1, 0, 0, 0, tzinfo=moment.tzinfo("America/New_York"))
    self.assertDateIso(RDU(dt, "years"), "2018-01-01 00:00:00-05:00")
    self.assertDateIso(RDU(dt - TICK, "years"), "2017-01-01 00:00:00-05:00")

    self.assertDateIso(RDU(dt, "months"), "2018-01-01 00:00:00-05:00")
    self.assertDateIso(RDU(dt - TICK, "months"), "2017-12-01 00:00:00-05:00")

    # 2018-01-01 is a Monday
    self.assertDateIso(RDU(dt, "weeks"), "2017-12-31 00:00:00-05:00")
    self.assertDateIso(RDU(dt - timedelta(days=1) - TICK, "weeks"), "2017-12-24 00:00:00-05:00")

    self.assertDateIso(RDU(dt, "days"), "2018-01-01 00:00:00-05:00")
    self.assertDateIso(RDU(dt - TICK, "days"), "2017-12-31 00:00:00-05:00")

    self.assertDateIso(RDU(dt, "hours"), "2018-01-01 00:00:00-05:00")
    self.assertDateIso(RDU(dt - TICK, "hours"), "2017-12-31 23:00:00-05:00")

  def test_parse_interval(self):
    self.assertEqual(schedule._parse_interval("annual"), (1, "years"))
    self.assertEqual(schedule._parse_interval("daily"), (1, "days"))
    self.assertEqual(schedule._parse_interval("1-year"), (1, "years"))
    self.assertEqual(schedule._parse_interval("1 year"), (1, "years"))
    self.assertEqual(schedule._parse_interval("1  Years"), (1, "years"))
    self.assertEqual(schedule._parse_interval("25-months"), (25, "months"))
    self.assertEqual(schedule._parse_interval("3-day"), (3, "days"))
    self.assertEqual(schedule._parse_interval("2-hour"), (2, "hours"))
    with self.assertRaisesRegex(ValueError, "Not a valid interval"):
      schedule._parse_interval("1Year")
    with self.assertRaisesRegex(ValueError, "Not a valid interval"):
      schedule._parse_interval("1y")
    with self.assertRaisesRegex(ValueError, "Unknown unit"):
      schedule._parse_interval("1-daily")

  def test_parse_slot(self):
    self.assertDelta(schedule._parse_slot('Jan-15', 'years'), months=0, days=14)
    self.assertDelta(schedule._parse_slot('1/15', 'years'), months=0, days=14)
    self.assertDelta(schedule._parse_slot('march-1', 'years'), months=2, days=0)
    self.assertDelta(schedule._parse_slot('03/09', 'years'), months=2, days=8)

    self.assertDelta(schedule._parse_slot('/15', 'months'), days=14)
    self.assertDelta(schedule._parse_slot('/1', 'months'), days=0)

    self.assertDelta(schedule._parse_slot('Mon', 'weeks'), days=1)
    self.assertDelta(schedule._parse_slot('tu', 'weeks'), days=2)
    self.assertDelta(schedule._parse_slot('Friday', 'weeks'), days=5)

    self.assertDelta(schedule._parse_slot('10am', 'days'), hours=10)
    self.assertDelta(schedule._parse_slot('1:30pm', 'days'), hours=13, minutes=30)
    self.assertDelta(schedule._parse_slot('15:45', 'days'), hours=15, minutes=45)
    self.assertDelta(schedule._parse_slot('Apr-1 9am', 'years'), months=3, days=0, hours=9)
    self.assertDelta(schedule._parse_slot('/3 12:30', 'months'), days=2, hours=12, minutes=30)
    self.assertDelta(schedule._parse_slot('Sat 6:15pm', 'weeks'), days=6, hours=18, minutes=15)

    self.assertDelta(schedule._parse_slot(':45', 'hours'), minutes=45)
    self.assertDelta(schedule._parse_slot(':00', 'hours'), minutes=00)

    self.assertDelta(schedule._parse_slot('+1d', 'days'), days=1)
    self.assertDelta(schedule._parse_slot('+15d', 'months'), days=15)
    self.assertDelta(schedule._parse_slot('+3w', 'weeks'), weeks=3)
    self.assertDelta(schedule._parse_slot('+2m', 'years'), months=2)
    self.assertDelta(schedule._parse_slot('+1y', 'years'), months=12)

    # Test a few combinations.
    self.assertDelta(schedule._parse_slot('+1y 4/5 3:45pm +30S', 'years'),
        months=15, days=4, hours=15, minutes=45, seconds=30)
    self.assertDelta(schedule._parse_slot('+2w Wed +6H +20M +40S', 'weeks'),
        weeks=2, days=3, hours=6, minutes=20, seconds=40)
    self.assertDelta(schedule._parse_slot('+2m /20 11pm', 'months'), months=2, days=19, hours=23)
    self.assertDelta(schedule._parse_slot('+2M +30S', 'minutes'), minutes=2, seconds=30)

  def test_parse_slot_errors(self):
    # Test failures with duplicate units
    with self.assertRaisesRegex(ValueError, 'Duplicate unit'):
      schedule._parse_slot('+1d +2d', 'weeks')
    with self.assertRaisesRegex(ValueError, 'Duplicate unit'):
      schedule._parse_slot('9:30am +2H', 'days')
    with self.assertRaisesRegex(ValueError, 'Duplicate unit'):
      schedule._parse_slot('/15 +1d', 'months')
    with self.assertRaisesRegex(ValueError, 'Duplicate unit'):
      schedule._parse_slot('Feb-1 12:30pm +20M', 'years')

    # Test failures with improper slot types
    with self.assertRaisesRegex(ValueError, 'Invalid slot.*for unit'):
      schedule._parse_slot('Feb-1', 'weeks')
    with self.assertRaisesRegex(ValueError, 'Invalid slot.*for unit'):
      schedule._parse_slot('Monday', 'months')
    with self.assertRaisesRegex(ValueError, 'Invalid slot.*for unit'):
      schedule._parse_slot('4/15', 'hours')
    with self.assertRaisesRegex(ValueError, 'Invalid slot.*for unit'):
      schedule._parse_slot('/1', 'years')

    # Test failures with outright invalid slot syntax.
    with self.assertRaisesRegex(ValueError, 'Invalid slot'):
      schedule._parse_slot('Feb:1', 'weeks')
    with self.assertRaisesRegex(ValueError, 'Invalid slot'):
      schedule._parse_slot('/1d', 'months')
    with self.assertRaisesRegex(ValueError, 'Invalid slot'):
      schedule._parse_slot('10', 'hours')
    with self.assertRaisesRegex(ValueError, 'Invalid slot'):
      schedule._parse_slot('H1', 'years')

    # Test failures with unknown values
    with self.assertRaisesRegex(ValueError, 'Unknown month'):
      schedule._parse_slot('februarium-1', 'years')
    with self.assertRaisesRegex(ValueError, 'Unknown day of the week'):
      schedule._parse_slot('snu', 'weeks')
    with self.assertRaisesRegex(ValueError, 'Unknown unit'):
      schedule._parse_slot('+1t', 'hours')

  def test_schedule(self):
    # A few more examples. The ones in doctest strings are those that help documentation; the rest
    # are in this file to keep the size of the main file more manageable.

    # Note that the start of 2018-01-01 is a Monday
    self.assertEqual(list(schedule.SCHEDULE(
      "1-week: +1d 9:30am, +4d 3:30pm", start=datetime(2018,1,1), end=datetime(2018,1,31))),
      [
        DT("2018-01-01 09:30:00"), DT("2018-01-04 15:30:00"),
        DT("2018-01-08 09:30:00"), DT("2018-01-11 15:30:00"),
        DT("2018-01-15 09:30:00"), DT("2018-01-18 15:30:00"),
        DT("2018-01-22 09:30:00"), DT("2018-01-25 15:30:00"),
        DT("2018-01-29 09:30:00"),
      ])

    self.assertEqual(list(schedule.SCHEDULE(
      "3-month: +0d 12pm", start=datetime(2018,1,1), end=datetime(2018,6,30))),
      [DT('2018-01-01 12:00:00'), DT('2018-04-01 12:00:00')])

    # Ensure we can use date() object for start/end too.
    self.assertEqual(list(schedule.SCHEDULE(
      "3-month: +0d 12pm", start=date(2018,1,1), end=date(2018,6,30))),
      [DT('2018-01-01 12:00:00'), DT('2018-04-01 12:00:00')])

    # We can even use strings.
    self.assertEqual(list(schedule.SCHEDULE(
      "3-month: +0d 12pm", start="2018-01-01", end="2018-06-30")),
      [DT('2018-01-01 12:00:00'), DT('2018-04-01 12:00:00')])

  def test_timezone(self):
    # Verify that the time zone of `start` determines the time zone of generated times.
    tz_ny = moment.tzinfo("America/New_York")
    self.assertEqual([d.isoformat(' ') for d in schedule.SCHEDULE(
      "daily: 9am", count=4, start=datetime(2018, 2, 14, tzinfo=tz_ny))],
      [ '2018-02-14 09:00:00-05:00', '2018-02-15 09:00:00-05:00',
        '2018-02-16 09:00:00-05:00', '2018-02-17 09:00:00-05:00' ])

    tz_la = moment.tzinfo("America/Los_Angeles")
    self.assertEqual([d.isoformat(' ') for d in schedule.SCHEDULE(
      "daily: 9am, 4:30pm", count=4, start=datetime(2018, 2, 14, 9, 0, tzinfo=tz_la))],
      [ '2018-02-14 09:00:00-08:00', '2018-02-14 16:30:00-08:00',
        '2018-02-15 09:00:00-08:00', '2018-02-15 16:30:00-08:00' ])

    tz_utc = moment.tzinfo("UTC")
    self.assertEqual([d.isoformat(' ') for d in schedule.SCHEDULE(
      "daily: 9am, 4:30pm", count=4, start=datetime(2018, 2, 14, 17, 0, tzinfo=tz_utc))],
      [ '2018-02-15 09:00:00+00:00', '2018-02-15 16:30:00+00:00',
        '2018-02-16 09:00:00+00:00', '2018-02-16 16:30:00+00:00' ])

  # This is not really a test but just a way to see some timing information about Schedule
  # implementation. Run with env PY_TIMING_TESTS=1 in the environment, and the console output will
  # include the measured times.
  @unittest.skipUnless(os.getenv("PY_TIMING_TESTS") == "1", "Set PY_TIMING_TESTS=1 for timing")
  def test_timing(self):
    N = 1000
    sched = "weekly: Mo 10:30am, We 10:30am"
    setup = """
from functions import schedule
from datetime import datetime
"""
    setup = "from functions import test_schedule as t"

    expected_result = [
      datetime(2018, 9, 24, 10, 30), datetime(2018, 9, 26, 22, 30),
      datetime(2018, 10, 1, 10, 30), datetime(2018, 10, 3, 22, 30),
    ]
    self.assertEqual(timing_schedule_full(), expected_result)
    t = min(timeit.repeat(stmt="t.timing_schedule_full()", setup=setup, number=N, repeat=3))
    print("\n*** SCHEDULE call with 4 points: %.2f us" % (t * 1000000 / N))

    t = min(timeit.repeat(stmt="t.timing_schedule_init()", setup=setup, number=N, repeat=3))
    print("*** Schedule constructor: %.2f us" % (t * 1000000 / N))

    self.assertEqual(timing_schedule_series(), expected_result)
    t = min(timeit.repeat(stmt="t.timing_schedule_series()", setup=setup, number=N, repeat=3))
    print("*** Schedule series with 4 points: %.2f us" % (t * 1000000 / N))

def timing_schedule_full():
  return list(schedule.SCHEDULE("weekly: Mo 10:30am, We 10:30pm",
    start=datetime(2018, 9, 23), count=4))

def timing_schedule_init():
  return schedule.Schedule("weekly: Mo 10:30am, We 10:30pm")

def timing_schedule_series(sched=schedule.Schedule("weekly: Mo 10:30am, We 10:30pm")):
  return list(sched.series(datetime(2018, 9, 23), None, count=4))
