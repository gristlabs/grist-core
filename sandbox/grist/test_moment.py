from datetime import datetime, date, timedelta
import unittest
import moment
import moment_parse

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
    [datetime(2037, 03, 8, 7, 0, 0), 2120108400000, "EDT", 240, 3, 0],
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

  parse_samples = [
    # Basic set
    ['MM-DD-YYYY',          '12-02-1999',                 944092800.000000],
    ['DD-MM-YYYY',          '12-02-1999',                 918777600.000000],
    ['DD/MM/YYYY',          '12/02/1999',                 918777600.000000],
    ['DD_MM_YYYY',          '12_02_1999',                 918777600.000000],
    ['DD:MM:YYYY',          '12:02:1999',                 918777600.000000],
    ['D-M-YY',              '2-2-99',                     917913600.000000],
    ['YY',                  '99',                         922060800.000000],
    ['DD-MM-YYYY h:m:s',    '12-02-1999 2:45:10',         918787510.000000],
    ['DD-MM-YYYY h:m:s a',  '12-02-1999 2:45:10 am',      918787510.000000],
    ['DD-MM-YYYY h:m:s a',  '12-02-1999 2:45:10 pm',      918830710.000000],
    ['h:mm a',              '12:00 pm',                   1458648000.000000],
    ['h:mm a',              '12:30 pm',                   1458649800.000000],
    ['h:mm a',              '12:00 am',                   1458604800.000000],
    ['h:mm a',              '12:30 am',                   1458606600.000000],
    ['HH:mm',               '12:00',                      1458648000.000000],
    ['YYYY-MM-DDTHH:mm:ss', '2011-11-11T11:11:11',        1321009871.000000],
    ['ddd MMM DD HH:mm:ss YYYY', 'Tue Apr 07 22:52:51 2009',  1239144771.000000],
    ['ddd MMMM DD HH:mm:ss YYYY', 'Tue April 07 22:52:51 2009', 1239144771.000000],
    ['HH:mm:ss',            '12:00:00',                   1458648000.000000],
    ['HH:mm:ss',            '12:30:00',                   1458649800.000000],
    ['HH:mm:ss',            '00:00:00',                   1458604800.000000],
    ['HH:mm:ss S',          '00:30:00 1',                 1458606600.100000],
    ['HH:mm:ss SS',         '00:30:00 12',                1458606600.120000],
    ['HH:mm:ss SSS',        '00:30:00 123',               1458606600.123000],
    ['HH:mm:ss S',          '00:30:00 7',                 1458606600.700000],
    ['HH:mm:ss SS',         '00:30:00 78',                1458606600.780000],
    ['HH:mm:ss SSS',        '00:30:00 789',               1458606600.789000],

    # Dropped m
    ['MM/DD/YYYY h:m:s a',  '05/1/2012 12:25:00 p',       1335875100.000000],
    ['MM/DD/YYYY h:m:s a',  '05/1/2012 12:25:00 a',       1335831900.000000],

    # 2 digit year with YYYY
    ['D/M/YYYY',              '9/2/99',                   918518400.000000],
    ['D/M/YYYY',            '9/2/1999',                   918518400.000000],
    ['D/M/YYYY',              '9/2/66',                   -122860800.000000],
    ['D/M/YYYY',              '9/2/65',                   3001363200.000000],

    # No separators
    ['MMDDYYYY',            '12021999',                   944092800.000000],
    ['DDMMYYYY',            '12021999',                   918777600.000000],
    ['YYYYMMDD',            '19991202',                   944092800.000000],
    ['DDMMMYYYY',          '10Sep2001',                   1000080000.000000],

    # Error forgiveness
    ['MM/DD/YYYY',          '12-02-1999',                 944092800.000000],
    ['DD/MM/YYYY',          '12/02 /1999',                918777600.000000],
    ['DD:MM:YYYY',          '12:02 :1999',                918777600.000000],
    ['D-M-YY',              '2 2 99',                     917913600.000000],
    ['DD-MM-YYYY h:m:s',    '12-02-1999 2:45:10.00',      918787510.000000],
    ['h:mm a',              '12:00pm',                    1458648000.000000],
    ['HH:mm',               '1200',                       1458648000.000000],
    ['dddd MMMM DD HH:mm:ss YYYY', 'Tue Apr 7 22:52:51 2009',  1239144771.000000],
    ['ddd MMM DD HH:mm:ss YYYY',   'Tuesday April 7 22:52:51 2009', 1239144771.000000],
    ['ddd MMM Do HH:mm:ss YYYY',   'Tuesday April 7th 22:52:51 2009', 1239144771.000000]
  ]

  parse_timezone_samples = [
    # Timezone corner cases
    ['MM-DD-YYYY h:ma', '3-13-2016 1:59am', 'America/New_York', 1457852340], # EST
    ['MM-DD-YYYY h:ma', '3-13-2016 2:00am', 'America/New_York', 1457848800], # Invalid, -1hr
    ['MM-DD-YYYY h:ma', '3-13-2016 2:59am', 'America/New_York', 1457852340], # Invalid, -1hr
    ['MM-DD-YYYY h:ma', '3-13-2016 3:00am', 'America/New_York', 1457852400], # EDT
    ['MM-DD-YYYY h:ma', '3-13-2016 1:59am', 'America/Los_Angeles', 1457863140], # PST
    ['MM-DD-YYYY h:ma', '3-13-2016 2:00am', 'America/Los_Angeles', 1457859600], # Invalid, -1hr
    ['MM-DD-YYYY h:ma', '3-13-2016 2:59am', 'America/Los_Angeles', 1457863140], # Invalid, -1hr
    ['MM-DD-YYYY h:ma', '3-13-2016 3:00am', 'America/Los_Angeles', 1457863200]  # PDT
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

  def test_parse(self):
    for s in self.parse_samples:
      self.assertEqual(moment_parse.parse(s[1], s[0], 'UTC', date(2016, 3, 22)), s[2])
    for s in self.parse_timezone_samples:
      self.assertEqual(moment_parse.parse(s[1], s[0], s[2], date(2016, 3, 22)), s[3])

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
    value_dt = datetime(2015, 03, 14, 0, 0)     # In UTC
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
    d = date(2015, 03, 14)
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
