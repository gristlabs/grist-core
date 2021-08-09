import unittest
from imports.dateguess import guess, guess_bulk


class TestGuesser(unittest.TestCase):
  def assertDate(self, input_str, fmt_list):
    guessed = guess(input_str)
    self.assertEqual(set(guessed), set(fmt_list))

  def assertDates(self, input_lst, error_rate, fmt_list):
    guessed = guess_bulk(input_lst, error_rate=error_rate)
    self.assertEqual(set(guessed), set(fmt_list))

  def test_guess_dates(self):
    self.assertDate('', [])
    self.assertDate("2013-13-13", [])
    self.assertDate("25/25/1911", [])

    self.assertDate("2014-01-11", ['%Y-%m-%d', '%Y-%d-%m'])
    self.assertDate("2014-11-01", ['%Y-%m-%d', '%Y-%d-%m'])
    self.assertDate("1990-05-05", ['%Y-%m-%d', '%Y-%d-%m'])
    self.assertDate("2013-12-13", ['%Y-%m-%d'])

    self.assertDate("12/31/1999", ['%m/%d/%Y'])
    self.assertDate("11/11/1911", ['%m/%d/%Y', '%d/%m/%Y'])
    self.assertDate("5/9/1981", ['%m/%d/%Y', '%d/%m/%Y'])
    self.assertDate("6/3/1985", ['%m/%d/%Y', '%d/%m/%Y'])

    self.assertDate("12/31/99", ['%m/%d/%y'])
    self.assertDate("11/11/11", ['%y/%m/%d', '%y/%d/%m', '%m/%d/%y', '%d/%m/%y'])
    self.assertDate("5/9/81", ['%m/%d/%y', '%d/%m/%y'])
    self.assertDate("6/3/85", ['%m/%d/%y', '%d/%m/%y'])

    self.assertDate("31.12.91", ['%d.%m.%y'])
    self.assertDate("4.4.87", ['%m.%d.%y', '%d.%m.%y'])

    self.assertDate("13.2.8", ['%y.%m.%d', '%y.%d.%m'])
    self.assertDate("31.12.1991", ['%d.%m.%Y'])
    self.assertDate("4.4.1987", ['%m.%d.%Y', '%d.%m.%Y'])
    self.assertDate("13.2.2008", ['%d.%m.%Y'])
    self.assertDate("31.12.91", ['%d.%m.%y'])
    self.assertDate("4.4.87", ['%m.%d.%y', '%d.%m.%y'])
    self.assertDate("13.2.8", ['%y.%m.%d', '%y.%d.%m'])

    self.assertDate("9 May 1981", ['%d %b %Y', '%d %B %Y'])
    self.assertDate("31 Dec 1999", ['%d %b %Y'])
    self.assertDate("1 Jan 2012", ['%d %b %Y'])
    self.assertDate("3 August 2009", ['%d %B %Y'])
    self.assertDate("2 May 1980", ['%d %B %Y', '%d %b %Y'])

    self.assertDate("13/1/2012", ['%d/%m/%Y'])

    self.assertDate("Aug 1st 2014", ['%b %dst %Y'])
    self.assertDate("12/22/2015 00:00:00.10", ['%m/%d/%Y %H:%M:%S.%f'])

  def test_guess_datetimes(self):
    self.assertDate("Thu Sep 25 10:36:28 2003", ['%a %b %d %H:%M:%S %Y'])
    self.assertDate("Thu Sep 25 2003 10:36:28", ['%a %b %d %Y %H:%M:%S'])
    self.assertDate("10:36:28 Thu Sep 25 2003", ['%H:%M:%S %a %b %d %Y'])

    self.assertDate("2014-01-11T12:21:05", ['%Y-%m-%dT%H:%M:%S', '%Y-%d-%mT%H:%M:%S'])
    self.assertDate("2015-02-16T16:05:31", ['%Y-%m-%dT%H:%M:%S'])
    # TODO remove all except first one
    self.assertDate("2015-02-16T16:05", ['%Y-%m-%dT%H:%M', '%Y-%H-%MT%d:%m',
                                         '%Y-%m-%HT%M:%d', '%Y-%d-%HT%M:%m'])
    self.assertDate("2015-02-16T16", ['%Y-%m-%dT%H', '%Y-%m-%HT%d'])    #TODO remove second one

    self.assertDate("Mon Jan 13 9:52:52 am MST 2014", ['%a %b %d %I:%M:%S %p %Z %Y'])
    self.assertDate("Tue Jan 21 3:30:00 PM EST 2014", ['%a %b %d %I:%M:%S %p %Z %Y'])
    self.assertDate("Mon Jan 13 09:52:52 MST 2014", ['%a %b %d %H:%M:%S %Z %Y'])
    self.assertDate("Tue Jan 21 15:30:00 EST 2014", ['%a %b %d %H:%M:%S %Z %Y'])
    self.assertDate("Mon Jan 13 9:52 am MST 2014", ['%a %b %d %I:%M %p %Z %Y'])
    self.assertDate("Tue Jan 21 3:30 PM EST 2014", ['%a %b %d %I:%M %p %Z %Y'])

    self.assertDate("2014-01-11T12:21:05", ['%Y-%m-%dT%H:%M:%S', '%Y-%d-%mT%H:%M:%S'])
    self.assertDate("2015-02-16T16:05:31", ['%Y-%m-%dT%H:%M:%S'])
    self.assertDate("Thu Sep 25 10:36:28 2003", ['%a %b %d %H:%M:%S %Y'])
    self.assertDate("10:36:28 Thu Sep 25 2003", ['%H:%M:%S %a %b %d %Y'])

    self.assertDate("2014-01-11T12:21:05+0000", ['%Y-%d-%mT%H:%M:%S%z', '%Y-%m-%dT%H:%M:%S%z'])
    self.assertDate("2015-02-16T16:05:31-0400", ['%Y-%m-%dT%H:%M:%S%z'])
    self.assertDate("Thu, 25 Sep 2003 10:49:41 -0300", ['%a, %d %b %Y %H:%M:%S %z'])
    self.assertDate("Thu, 25 Sep 2003 10:49:41 +0300", ['%a, %d %b %Y %H:%M:%S %z'])

    self.assertDate("2003-09-25T10:49:41", ['%Y-%m-%dT%H:%M:%S'])
    self.assertDate("2003-09-25T10:49", ['%Y-%m-%dT%H:%M'])

  def test_guess_bulk_dates(self):
    self.assertDates(["11/11/1911", "25/11/1911", "11/11/1911", "11/11/1911"], 0.0, ['%d/%m/%Y'])
    self.assertDates(["25/11/1911", "25/25/1911", "11/11/1911", "11/11/1911"], 0.0, [])
    self.assertDates(["25/11/1911", "25/25/1911", "11/11/1911", "11/11/1911"], 0.5, ['%d/%m/%Y'])

    self.assertDates(["25/11/1911", "25/25/1911", "11/11/1911", "11/11/1911"], 0.1, [])
    self.assertDates(["23/11/1911", '2004 May 12', "11/11/1911", "11/11/1911"], 0.5, ['%d/%m/%Y'])

    self.assertDates(['2004 May 12', "11/11/1911", "11/11/1911", "23/11/1911"], 0.5, ['%d/%m/%Y'])
    self.assertDates(['2004 May 12', "11/11/1911", "11/11/1911", "23/11/1911"], 0.0, [])
    self.assertDates(['12/22/2015', "12/22/2015 1:15pm", "2018-02-27 16:08:39 +0000"], 0.1, [])


if __name__ == "__main__":
  unittest.main()
