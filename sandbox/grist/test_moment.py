from datetime import datetime, date, timedelta
import unittest
import moment

# Helpful strftime() format that imcludes all parts of the date including the time zone.
fmt = "%Y-%m-%d %H:%M:%S %Z"

class TestMoment(unittest.TestCase):

  new_york = [
    # - 1918 -
    [datetime(1918, 3, 31, 6, 59, 59), -1633280401000, "EST", 300, 1, 59],
    [datetime(1918, 3, 31, 7, 0, 0), -1633280400000, "EDT", 240, 3, 0],
    [datetime(1918, 10, 27, 5, 59, 59), -1615140001000, "EDT", 240, 1, 59],
    [datetime(1918, 10, 27, 6, 0, 0), -1615140000000, "EST", 300, 1, 0],
    # - 1979 -
    [datetime(1979, 4, 29, 6, 59, 59), 294217199000, "EST", 300, 1, 59],
    [datetime(1979, 4, 29, 7, 0, 0), 294217200000, "EDT", 240, 3, 0],
    [datetime(1979, 10, 28, 5, 59, 59), 309938399000, "EDT", 240, 1, 59],
    [datetime(1979, 10, 28, 6, 0, 0), 309938400000, "EST", 300, 1, 0],
    # - 2037 -
    [datetime(2037, 3, 8, 6, 59, 59), 2120108399000, "EST", 300, 1, 59],
    [datetime(2037, 3, 8, 7, 0, 0), 2120108400000, "EDT", 240, 3, 0],
    [datetime(2037, 11, 1, 5, 59, 59), 2140667999000, "EDT", 240, 1, 59]
  ]
  new_york_errors = [
    ["America/New_York", "2037-3-8 6:59:59", TypeError],
    ["America/New_York", [2037, 3, 8, 6, 59, 59], TypeError],
    ["America/new_york", datetime(1979, 4, 29, 6, 59, 59), KeyError]
  ]

  los_angeles = [
    # - 1918 -
    # Spanning non-existent hour
    [datetime(1918, 3, 31, 1, 59, 59, 0), -1633269601000, "PST", 480, 1, 59],
    [datetime(1918, 3, 31, 2, 0, 0, 0), -1633273200000, "PST", 480, 1, 0],
    [datetime(1918, 3, 31, 2, 59, 59, 0), -1633269601000, "PST", 480, 1, 59],
    [datetime(1918, 3, 31, 3, 0, 0, 0), -1633269600000, "PDT", 420, 3, 0],
    # Spanning doubly-existent hour
    [datetime(1918, 10, 27, 0, 59, 59, 0), -1615132801000, "PDT", 420, 0, 59],
    [datetime(1918, 10, 27, 1, 0, 0, 0), -1615132800000, "PDT", 420, 1, 0],
    [datetime(1918, 10, 27, 1, 59, 59, 0), -1615129201000, "PDT", 420, 1, 59],
    [datetime(1918, 10, 27, 2, 0, 0, 0), -1615125600000, "PST", 480, 2, 0],
    # - 2008 -
    # Spanning non-existent hour
    [datetime(2008, 3, 9, 1, 59, 59, 0), 1205056799000, "PST", 480, 1, 59],
    [datetime(2008, 3, 9, 2, 0, 0, 0), 1205053200000, "PST", 480, 1, 0],
    [datetime(2008, 3, 9, 2, 59, 59, 0), 1205056799000, "PST", 480, 1, 59],
    [datetime(2008, 3, 9, 3, 0, 0, 0), 1205056800000, "PDT", 420, 3, 0],
    # Spanning doubly-existent hour
    [datetime(2008, 11, 2, 0, 59, 59, 0), 1225612799000, "PDT", 420, 0, 59],
    [datetime(2008, 11, 2, 1, 0, 0, 0), 1225612800000, "PDT", 420, 1, 0],
    [datetime(2008, 11, 2, 1, 59, 59, 0), 1225616399000, "PDT", 420, 1, 59],
    [datetime(2008, 11, 2, 2, 0, 0, 0), 1225620000000, "PST", 480, 2, 0],
    # - 2037 -
    [datetime(2037, 3, 8, 1, 59, 59, 0), 2120119199000, "PST", 480, 1, 59],
    [datetime(2037, 3, 8, 2, 0, 0, 0), 2120115600000, "PST", 480, 1, 0],
    [datetime(2037, 11, 1, 0, 59, 59, 0), 2140675199000, "PDT", 420, 0, 59],
    [datetime(2037, 11, 1, 1, 0, 0, 0), 2140675200000, "PDT", 420, 1, 0],
  ]

  def assertMatches(self, data_entry, moment_obj):
    date, timestamp, abbr, offset, hour, minute = data_entry
    dt        = moment_obj.datetime()
    self.assertEqual(moment_obj.timestamp, timestamp)
    self.assertEqual(moment_obj.zoneAbbr(), abbr)
    self.assertEqual(moment_obj.zoneOffset(), timedelta(minutes=-offset))
    self.assertEqual(dt.hour, hour)
    self.assertEqual(dt.minute, minute)

  # For each UTC date, convert to New York time and compare with expected values
  def test_standard_entry(self):
    name = "America/New_York"
    data = self.new_york
    for entry in data:
      date      = entry[0]
      timestamp = entry[1]
      m   = moment.tz(date).tz(name)
      mts = moment.tz(timestamp, name)
      self.assertMatches(entry, m)
      self.assertMatches(entry, mts)
    error_data = self.new_york_errors
    for entry in error_data:
      name  = entry[0]
      date  = entry[1]
      error = entry[2]
      self.assertRaises(error, moment.tz, date, name)

  # For each Los Angeles date, check that the returned date matches expected values
  def test_zone_entry(self):
    name = "America/Los_Angeles"
    data = self.los_angeles
    for entry in data:
      date      = entry[0]
      timestamp = entry[1]
      m         = moment.tz(date, name)
      self.assertMatches(entry, m)


  def test_zone(self):
    name = "America/New_York"
    tzinfo = moment.tzinfo(name)
    data = self.new_york
    for entry in data:
      date      = entry[0]
      ts        = entry[1]
      abbr      = entry[2]
      offset    = entry[3]
      dt = moment.tz(ts, name).datetime()
      self.assertEqual(dt.tzname(), abbr)
      self.assertEqual(dt.utcoffset(), timedelta(minutes=-offset))

  def test_ts_to_dt(self):
    # Verify that ts_to_dt works as expected.
    value_sec = 1426291200      # 2015-03-14 00:00:00 in UTC

    value_dt_utc = moment.ts_to_dt(value_sec, moment.get_zone('UTC'))
    value_dt_aware = moment.ts_to_dt(value_sec, moment.get_zone('America/New_York'))
    self.assertEqual(value_dt_utc.strftime("%Y-%m-%d %H:%M:%S %Z"), '2015-03-14 00:00:00 UTC')
    self.assertEqual(value_dt_aware.strftime("%Y-%m-%d %H:%M:%S %Z"), '2015-03-13 20:00:00 EDT')

  def test_dst_switches(self):
    # Verify that conversions around DST switches happen correctly. (This is tested in other tests
    # as well, but this test case is more focused and easier to debug.)
    dst_before = -1633280401
    dst_begin  = -1633280400
    dst_end    = -1615140001
    dst_after  = -1615140000

    # Should have no surprises in converting to UTC, since there are not DST dfferences.
    def ts_to_dt_utc(dt):
      return moment.ts_to_dt(dt, moment.get_zone('UTC'))
    self.assertEqual(ts_to_dt_utc(dst_before).strftime(fmt), "1918-03-31 06:59:59 UTC")
    self.assertEqual(ts_to_dt_utc(dst_begin ).strftime(fmt), "1918-03-31 07:00:00 UTC")
    self.assertEqual(ts_to_dt_utc(dst_end   ).strftime(fmt), "1918-10-27 05:59:59 UTC")
    self.assertEqual(ts_to_dt_utc(dst_after ).strftime(fmt), "1918-10-27 06:00:00 UTC")

    # Converting to America/New_York should produce correct jumps.
    def ts_to_dt_nyc(dt):
      return moment.ts_to_dt(dt, moment.get_zone('America/New_York'))
    self.assertEqual(ts_to_dt_nyc(dst_before).strftime(fmt), "1918-03-31 01:59:59 EST")
    self.assertEqual(ts_to_dt_nyc(dst_begin ).strftime(fmt), "1918-03-31 03:00:00 EDT")
    self.assertEqual(ts_to_dt_nyc(dst_end   ).strftime(fmt), "1918-10-27 01:59:59 EDT")
    self.assertEqual(ts_to_dt_nyc(dst_after ).strftime(fmt), "1918-10-27 01:00:00 EST")
    self.assertEqual(ts_to_dt_nyc(dst_after + 3599).strftime(fmt), "1918-10-27 01:59:59 EST")


  def test_tzinfo(self):
    # Verify that tzinfo works correctly.
    ts1 = 294217199000      # In EST
    ts2 = 294217200000      # In EDT (spring forward, we skip ahead by 1 hour)
    utc_dt1 = datetime(1979, 4, 29, 6, 59, 59)
    utc_dt2 = datetime(1979, 4, 29, 7, 0, 0)
    self.assertEqual(moment.tz(ts1).datetime().strftime(fmt), '1979-04-29 06:59:59 UTC')
    self.assertEqual(moment.tz(ts2).datetime().strftime(fmt), '1979-04-29 07:00:00 UTC')

    # Verify that we get correct time zone variation depending on DST status.
    nyc_dt1 = moment.tz(ts1, 'America/New_York').datetime()
    nyc_dt2 = moment.tz(ts2, 'America/New_York').datetime()
    self.assertEqual(nyc_dt1.strftime(fmt), '1979-04-29 01:59:59 EST')
    self.assertEqual(nyc_dt2.strftime(fmt), '1979-04-29 03:00:00 EDT')

    # Make sure we can get timestamps back from these datatimes.
    self.assertEqual(moment.dt_to_ts(nyc_dt1)*1000, ts1)
    self.assertEqual(moment.dt_to_ts(nyc_dt2)*1000, ts2)

    # Verify that the datetime objects we get produce correct time zones in terms of DST when we
    # manipulate them. NOTE: it is a bit unexpected that we add 1hr + 1sec rather than just 1sec,
    # but it seems like that is how Python datetime works. Note that timezone does get switched
    # correctly between EDT and EST.
    self.assertEqual(nyc_dt1 + timedelta(seconds=3601), nyc_dt2)
    self.assertEqual(nyc_dt2 - timedelta(seconds=3601), nyc_dt1)
    self.assertEqual((nyc_dt1 + timedelta(seconds=3601)).strftime(fmt), '1979-04-29 03:00:00 EDT')
    self.assertEqual((nyc_dt2 - timedelta(seconds=3601)).strftime(fmt), '1979-04-29 01:59:59 EST')


  def test_dt_to_ds(self):
    # Verify that dt_to_ts works for both naive and aware datetime objects.
    value_dt = datetime(2015, 3, 14, 0, 0)     # In UTC
    value_sec = 1426291200
    tzla = moment.get_zone('America/Los_Angeles')
    def format_utc(ts):
      return moment.ts_to_dt(ts, moment.get_zone('UTC')).strftime(fmt)

    # Check that a naive datetime is interpreted in UTC.
    self.assertEqual(value_dt.strftime("%Y-%m-%d %H:%M:%S %Z"), '2015-03-14 00:00:00 ')
    self.assertEqual(moment.dt_to_ts(value_dt), value_sec)    # Interpreted in UTC

    # Get an explicit UTC version and make sure that also works.
    value_dt_utc = value_dt.replace(tzinfo=moment.TZ_UTC)
    self.assertEqual(value_dt_utc.strftime(fmt), '2015-03-14 00:00:00 UTC')
    self.assertEqual(moment.dt_to_ts(value_dt_utc), value_sec)

    # Get an aware datetime, and make sure that works too.
    value_dt_aware = moment.ts_to_dt(value_sec, moment.get_zone('America/New_York'))
    self.assertEqual(value_dt_aware.strftime(fmt), '2015-03-13 20:00:00 EDT')
    self.assertEqual(moment.dt_to_ts(value_dt_aware), value_sec)

    # Check that dt_to_ts pays attention to the timezone.
    # If we interpret midnight in LA time, it's a later timestamp.
    self.assertEqual(format_utc(moment.dt_to_ts(value_dt, tzla)), '2015-03-14 07:00:00 UTC')
    # The second argument is ignored if the datetime is aware.
    self.assertEqual(format_utc(moment.dt_to_ts(value_dt_utc, tzla)), '2015-03-14 00:00:00 UTC')
    self.assertEqual(format_utc(moment.dt_to_ts(value_dt_aware, tzla)), '2015-03-14 00:00:00 UTC')

    # If we modify an aware datetime, we may get a new timezone abbreviation.
    value_dt_aware -= timedelta(days=28)
    self.assertEqual(value_dt_aware.strftime(fmt), '2015-02-13 20:00:00 EST')

  def test_date_to_ts(self):
    d = date(2015, 3, 14)
    tzla = moment.get_zone('America/Los_Angeles')
    def format_utc(ts):
      return moment.ts_to_dt(ts, moment.get_zone('UTC')).strftime(fmt)

    self.assertEqual(format_utc(moment.date_to_ts(d)), '2015-03-14 00:00:00 UTC')
    self.assertEqual(format_utc(moment.date_to_ts(d, tzla)), '2015-03-14 07:00:00 UTC')
    self.assertEqual(moment.ts_to_dt(moment.date_to_ts(d, tzla), tzla).strftime(fmt),
                     '2015-03-14 00:00:00 PDT')


  def test_parse_iso(self):
    tzny = moment.get_zone('America/New_York')
    iso = moment.parse_iso
    self.assertEqual(iso('2011-11-11T11:11:11'), 1321009871.000000)
    self.assertEqual(iso('2019-01-22T00:47:39.219071-05:00'), 1548136059.219071)
    self.assertEqual(iso('2019-01-22T00:47:39.219071-0500'), 1548136059.219071)
    self.assertEqual(iso('2019-01-22T00:47:39.219071', timezone=tzny), 1548136059.219071)
    self.assertEqual(iso('2019-01-22T00:47:39.219071'), 1548118059.219071)
    self.assertEqual(iso('2019-01-22T00:47:39.219071Z'), 1548118059.219071)
    self.assertEqual(iso('2019-01-22T00:47:39.219071Z', timezone=tzny), 1548118059.219071)
    self.assertEqual(iso('2019-01-22T00:47:39.219'), 1548118059.219)
    self.assertEqual(iso('2019-01-22T00:47:39'), 1548118059)
    self.assertEqual(iso('2019-01-22 00:47:39.219071'), 1548118059.219071)
    self.assertEqual(iso('2019-01-22 00:47:39'), 1548118059)
    self.assertEqual(iso('2019-01-22'), 1548115200)

  def test_parse_iso_date(self):
    tzny = moment.get_zone('America/New_York')
    iso = moment.parse_iso_date
    # Note that time components and time zone do NOT affect the returned timestamp.
    self.assertEqual(iso('2019-01-22'), 1548115200)
    self.assertEqual(iso('2019-01-22T00:47:39.219071'), 1548115200)
    self.assertEqual(iso('2019-01-22 00:47:39Z'), 1548115200)
    self.assertEqual(iso('2019-01-22T00:47:39.219071-05:00'), 1548115200)
    self.assertEqual(iso('2019-01-22T00:47:39.219071+05:00'), 1548115200)

if __name__ == "__main__":
  unittest.main()
