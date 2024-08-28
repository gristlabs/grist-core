import datetime
import functools
import itertools
import logging
import unittest
import six

import actions
from column import SafeSortKey
import moment
import objtypes
import testutil
import test_engine

log = logging.getLogger(__name__)

def D(year, month, day):
  return moment.date_to_ts(datetime.date(year, month, day))


class TestPrevNext(test_engine.EngineTestCase):

  def do_setup(self):
    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Customers", [
          [11, "Name", "Text", False, "", "", ""],
        ]],
        [2, "Purchases", [
          [20, "manualSort", "PositionNumber", False, "", "", ""],
          [21, "Customer", "Ref:Customers", False, "", "", ""],
          [22, "Date", "Date", False, "", "", ""],
          [24, "Category", "Text", False, "", "", ""],
          [25, "Amount", "Numeric", False, "", "", ""],
          [26, "Prev", "Ref:Purchases", True, "None", "", ""],    # To be filled
          [27, "Cumul", "Numeric", True, "$Prev.Cumul + $Amount", "", ""],
        ]],
      ],
      "DATA": {
        "Customers": [
          ["id", "Name"],
          [1,    "Alice"],
          [2,    "Bob"],
        ],
        "Purchases": [
          [ "id",   "manualSort", "Customer", "Date",       "Category", "Amount", ],
          [1,       1.0,          1,          D(2023,12,1), "A",        10],
          [2,       2.0,          2,          D(2023,12,4), "A",        17],
          [3,       3.0,          1,          D(2023,12,3), "A",        20],
          [4,       4.0,          1,          D(2023,12,9), "A",        40],
          [5,       5.0,          1,          D(2023,12,2), "B",        80],
          [6,       6.0,          1,          D(2023,12,6), "B",        160],
          [7,       7.0,          1,          D(2023,12,7), "A",        320],
          [8,       8.0,          1,          D(2023,12,5), "A",        640],
        ],
      }
    }))

  def calc_expected(self, group_key=None, sort_key=None, sort_reverse=False):
    # Returns expected {id, Prev, Cumul} values from Purchases table calculated according to the
    # given grouping and sorting parameters.
    group_key = group_key or (lambda r: 0)
    data = list(actions.transpose_bulk_action(self.engine.fetch_table('Purchases')))
    expected = []
    sorted_data = sorted(data, key=sort_key, reverse=sort_reverse)
    sorted_data = sorted(sorted_data, key=group_key)
    for key, group in itertools.groupby(sorted_data, key=group_key):
      prev = 0
      cumul = 0.0
      for r in group:
        cumul = round(cumul + r.Amount, 2)
        expected.append({"id": r.id, "Prev": prev, "Cumul": cumul})
        prev = r.id
    expected.sort(key=lambda r: r["id"])
    return expected

  def do_test(self, formula, group_key=None, sort_key=None, sort_reverse=False):
    calc_expected = lambda: self.calc_expected(
        group_key=group_key, sort_key=sort_key, sort_reverse=sort_reverse)

    def assertPrevValid():
      # Check that Prev column is legitimate values, e.g. not errors.
      prev = self.engine.fetch_table('Purchases').columns["Prev"]
      self.assertTrue(is_all_ints(prev), "Prev column contains invalid values: %s" %
          [objtypes.encode_object(x) for x in prev])

    # This verification works as follows:
    # (1) Set "Prev" column to the specified formula.
    # (2) Calculate expected values for "Prev" and "Cumul" manually, and compare to reality.
    # (3) Try a few actions that affect the data, and calculate again.
    self.do_setup()
    self.modify_column('Purchases', 'Prev', formula=formula)

    # Check the initial data.
    assertPrevValid()
    self.assertTableData('Purchases', cols="subset", data=calc_expected())

    # Check the result after removing a record.
    self.remove_record('Purchases', 6)
    self.assertTableData('Purchases', cols="subset", data=calc_expected())

    # Check the result after updating a record
    self.update_record('Purchases', 5, Amount=1080)   # original value +1000
    self.assertTableData('Purchases', cols="subset", data=calc_expected())

    first_date = D(2023, 8, 1)

    # Update a few other records
    self.update_record("Purchases", 2, Customer=1)
    self.update_record("Purchases", 1, Customer=2)
    self.update_record("Purchases", 3, Date=first_date)   # becomes earliest in date order
    assertPrevValid()
    self.assertTableData('Purchases', cols="subset", data=calc_expected())

    # Check the result after re-adding a record
    # Note that Date here matches new date of record #3. This tests sort fallback to rowId.
    # Amount is the original amount +1.
    self.add_record('Purchases', 6, manualSort=6.0, Date=first_date, Amount=161)
    self.assertTableData('Purchases', cols="subset", data=calc_expected())

    # Update the manualSort value to test how it affects sort results.
    self.update_record('Purchases', 6, manualSort=0.5)
    self.assertTableData('Purchases', cols="subset", data=calc_expected())
    assertPrevValid()

  def do_test_prevnext(self, formula, group_key=None, sort_key=None, sort_reverse=False):
    # Run do_test() AND also repeat it after replacing PREVIOUS with NEXT in formula, and
    # reversing the expected results.

    # Note that this is a bit fragile: it relies on do_test() being limited to only the kinds of
    # changes that would be reset by another call to self.load_sample().

    with self.subTest(formula=formula):   # pylint: disable=no-member
      self.do_test(formula, group_key=group_key, sort_key=sort_key, sort_reverse=sort_reverse)

    nformula = formula.replace('PREVIOUS', 'NEXT')
    with self.subTest(formula=nformula):  # pylint: disable=no-member
      self.do_test(nformula, group_key=group_key, sort_key=sort_key, sort_reverse=not sort_reverse)

  @unittest.skipUnless(six.PY3, "Python 3 only")
  def test_prevnext_none(self):
    self.do_test_prevnext("PREVIOUS(rec, order_by=None)", group_key=None,
        sort_key=lambda r: r.manualSort)

    # Check that order_by arg is required (get TypeError without it).
    with self.assertRaisesRegex(AssertionError, r'Prev column contains invalid values:.*TypeError'):
      self.do_test("PREVIOUS(rec)", sort_key=lambda r: -r.id)

    # These assertions are just to ensure that do_test() tests do exercise the feature being
    # tested, i.e. fail when comparisons are NOT correct.
    with self.assertRaisesRegex(AssertionError, r'Observed data not as expected'):
      self.do_test("PREVIOUS(rec, order_by=None)", sort_key=lambda r: -r.id)
    with self.assertRaisesRegex(AssertionError, r'Observed data not as expected'):
      self.do_test("PREVIOUS(rec, order_by=None)", group_key=(lambda r: r.Customer),
          sort_key=(lambda r: r.id))

    # Make sure the test case above exercises the disambiguation by 'manualSort' (i.e. fails if
    # 'manualSort' isn't used to disambiguate).
    with self.assertRaisesRegex(AssertionError, r'Observed data not as expected'):
      self.do_test("PREVIOUS(rec, order_by=None)", sort_key=lambda r: r.id)

  @unittest.skipUnless(six.PY3, "Python 3 only")
  def test_prevnext_date(self):
    self.do_test_prevnext("PREVIOUS(rec, order_by='Date')",
        group_key=None, sort_key=lambda r: (SafeSortKey(r.Date), r.manualSort))

    # Make sure the test case above exercises the disambiguation by 'manualSort' (i.e. fails if it
    # isn't used to disambiguate).
    with self.assertRaisesRegex(AssertionError, r'Observed data not as expected'):
      self.do_test("PREVIOUS(rec, order_by='Date')",
          group_key=None, sort_key=lambda r: (SafeSortKey(r.Date), r.id))

  @unittest.skipUnless(six.PY3, "Python 3 only")
  def test_prevnext_date_manualsort(self):
    # Same as the previous test case (with just 'Date'), but specifies 'manualSort' explicitly.
    self.do_test_prevnext("PREVIOUS(rec, order_by=('Date', 'manualSort'))",
        group_key=None, sort_key=lambda r: (SafeSortKey(r.Date), r.manualSort))

  @unittest.skipUnless(six.PY3, "Python 3 only")
  def test_prevnext_rdate(self):
    self.do_test_prevnext("PREVIOUS(rec, order_by='-Date')",
        group_key=None, sort_key=lambda r: (SafeSortKey(r.Date), -r.manualSort), sort_reverse=True)

  @unittest.skipUnless(six.PY3, "Python 3 only")
  def test_prevnext_rdate_id(self):
    self.do_test_prevnext("PREVIOUS(rec, order_by=('-Date', 'id'))",
        group_key=None, sort_key=lambda r: (SafeSortKey(r.Date), -r.id), sort_reverse=True)

  @unittest.skipUnless(six.PY3, "Python 3 only")
  def test_prevnext_customer_rdate(self):
    self.do_test_prevnext("PREVIOUS(rec, group_by=('Customer',), order_by='-Date')",
        group_key=(lambda r: r.Customer), sort_key=lambda r: (SafeSortKey(r.Date), -r.id),
        sort_reverse=True)

  @unittest.skipUnless(six.PY3, "Python 3 only")
  def test_prevnext_category_date(self):
    self.do_test_prevnext("PREVIOUS(rec, group_by=('Category',), order_by='Date')",
        group_key=(lambda r: r.Category), sort_key=lambda r: SafeSortKey(r.Date))

  @unittest.skipUnless(six.PY3, "Python 3 only")
  def test_prevnext_category_date2(self):
    self.do_test_prevnext("PREVIOUS(rec, group_by='Category', order_by='Date')",
        group_key=(lambda r: r.Category), sort_key=lambda r: SafeSortKey(r.Date))

  @unittest.skipUnless(six.PY3, "Python 3 only")
  def test_prevnext_n_cat_date(self):
    self.do_test_prevnext("PREVIOUS(rec, order_by=('Category', 'Date'))",
        sort_key=lambda r: (SafeSortKey(r.Category), SafeSortKey(r.Date)))

  @unittest.skipUnless(six.PY2, "Python 2 only")
  def test_prevnext_py2(self):
    # On Python2, we expect NEXT/PREVIOUS to raise a NotImplementedError. It's not hard to make
    # it work, but the stricter argument syntax supported by Python3 is helpful, and we'd like
    # to drop Python2 support anyway.
    self.do_setup()
    self.modify_column('Purchases', 'Prev', formula='PREVIOUS(rec, order_by=None)')
    self.add_column('Purchases', 'Next', formula="NEXT(rec, group_by='Category', order_by='Date')")
    self.add_column('Purchases', 'Rank', formula="RANK(rec, order_by='Date', order='desc')")

    # Check that all values are the expected exception.
    err = objtypes.RaisedException(NotImplementedError())
    self.assertTableData('Purchases', cols="subset", data=[
      dict(id=r, Prev=err, Next=err, Rank=err, Cumul=err) for r in range(1, 9)
    ])


  def do_test_renames(self, formula, renamed_formula, calc_expected_pre, calc_expected_post):
    self.do_setup()
    self.modify_column('Purchases', 'Prev', formula=formula)

    # Check the initial data.
    self.assertTableData('Purchases', cols="subset", data=calc_expected_pre())

    # Do the renames
    self.apply_user_action(['RenameColumn', 'Purchases', 'Category', 'cat'])
    self.apply_user_action(['RenameColumn', 'Purchases', 'Date', 'Fecha'])
    self.apply_user_action(['RenameColumn', 'Purchases', 'Customer', 'person'])

    # Check that rename worked.
    self.assertTableData('_grist_Tables_column', cols="subset", rows="subset", data=[
      dict(id=26, colId="Prev", formula=renamed_formula)
    ])

    # Check that data is as expected, and reacts to changes.
    self.assertTableData('Purchases', cols="subset", data=calc_expected_post())

    self.update_record("Purchases", 1, cat="B")
    self.assertTableData('Purchases', cols="subset", data=calc_expected_post())

    self.update_record("Purchases", 3, Fecha=D(2023,8,1))
    self.assertTableData('Purchases', cols="subset", data=calc_expected_post())

  @unittest.skipUnless(six.PY3, "Python 3 only")
  def test_renaming_prev_str(self):
    self.do_test_renaming_prevnext_str("PREVIOUS")

  @unittest.skipUnless(six.PY3, "Python 3 only")
  def test_renaming_next_str(self):
    self.do_test_renaming_prevnext_str("NEXT")

  def do_test_renaming_prevnext_str(self, func):
    # Given some PREVIOUS/NEXT calls with group_by and order_by, rename columns mentioned there,
    # and check columns get adjusted and data remains correct.
    formula = "{}(rec, group_by='Category', order_by='Date')".format(func)
    renamed_formula = "{}(rec, group_by='cat', order_by='Fecha')".format(func)
    self.do_test_renames(formula, renamed_formula,
        calc_expected_pre = functools.partial(self.calc_expected,
          group_key=(lambda r: r.Category), sort_key=lambda r: SafeSortKey(r.Date),
          sort_reverse=(func == 'NEXT')
        ),
        calc_expected_post = functools.partial(self.calc_expected,
          group_key=(lambda r: r.cat), sort_key=lambda r: SafeSortKey(r.Fecha),
          sort_reverse=(func == 'NEXT')
        ),
    )

  @unittest.skipUnless(six.PY3, "Python 3 only")
  def test_renaming_prev_tuple(self):
    self.do_test_renaming_prevnext_tuple('PREVIOUS')

  @unittest.skipUnless(six.PY3, "Python 3 only")
  def test_renaming_next_tuple(self):
    self.do_test_renaming_prevnext_tuple('NEXT')

  def do_test_renaming_prevnext_tuple(self, func):
    formula = "{}(rec, group_by=('Customer',), order_by=('Category', '-Date'))".format(func)
    renamed_formula = "{}(rec, group_by=('person',), order_by=('cat', '-Fecha'))".format(func)

    # To handle "-" prefix for Date.
    class Reverse(object):
      def __init__(self, key):
        self.key = key
      def __lt__(self, other):
        return other.key < self.key

    self.do_test_renames(formula, renamed_formula,
        calc_expected_pre = functools.partial(self.calc_expected,
          group_key=(lambda r: r.Customer),
          sort_key=lambda r: (SafeSortKey(r.Category), Reverse(SafeSortKey(r.Date))),
          sort_reverse=(func == 'NEXT')
        ),
        calc_expected_post = functools.partial(self.calc_expected,
          group_key=(lambda r: r.person),
          sort_key=lambda r: (SafeSortKey(r.cat), Reverse(SafeSortKey(r.Fecha))),
          sort_reverse=(func == 'NEXT')
        ),
    )

  @unittest.skipUnless(six.PY3, "Python 3 only")
  def test_rank(self):
    self.do_setup()

    formula = "RANK(rec, group_by='Category', order_by='Date')"
    self.add_column('Purchases', 'Rank', formula=formula)
    self.assertTableData('Purchases', cols="subset", data=[
          [ "id",   "Date",       "Category", "Rank"],
          [1,       D(2023,12,1), "A",        1     ],
          [2,       D(2023,12,4), "A",        3     ],
          [3,       D(2023,12,3), "A",        2     ],
          [4,       D(2023,12,9), "A",        6     ],
          [5,       D(2023,12,2), "B",        1     ],
          [6,       D(2023,12,6), "B",        2     ],
          [7,       D(2023,12,7), "A",        5     ],
          [8,       D(2023,12,5), "A",        4     ],
    ])
    formula = "RANK(rec, order_by='Date', order='desc')"
    self.modify_column('Purchases', 'Rank', formula=formula)
    self.assertTableData('Purchases', cols="subset", data=[
          [ "id",   "Date",       "Category", "Rank"],
          [1,       D(2023,12,1), "A",        8     ],
          [2,       D(2023,12,4), "A",        5     ],
          [3,       D(2023,12,3), "A",        6     ],
          [4,       D(2023,12,9), "A",        1     ],
          [5,       D(2023,12,2), "B",        7     ],
          [6,       D(2023,12,6), "B",        3     ],
          [7,       D(2023,12,7), "A",        2     ],
          [8,       D(2023,12,5), "A",        4     ],
    ])

  @unittest.skipUnless(six.PY3, "Python 3 only")
  def test_rank_rename(self):
    self.do_setup()
    self.add_column('Purchases', 'Rank',
        formula="RANK(rec, group_by=\"Category\", order_by='Date')")
    self.assertTableData('Purchases', cols="subset", data=[
          [ "id",   "Date",       "Category", "Rank"],
          [1,       D(2023,12,1), "A",        1     ],
          [2,       D(2023,12,4), "A",        3     ],
          [3,       D(2023,12,3), "A",        2     ],
          [4,       D(2023,12,9), "A",        6     ],
          [5,       D(2023,12,2), "B",        1     ],
          [6,       D(2023,12,6), "B",        2     ],
          [7,       D(2023,12,7), "A",        5     ],
          [8,       D(2023,12,5), "A",        4     ],
    ])

    self.apply_user_action(['RenameColumn', 'Purchases', 'Category', 'cat'])
    self.apply_user_action(['RenameColumn', 'Purchases', 'Date', 'when'])

    renamed_formula = "RANK(rec, group_by=\"cat\", order_by='when')"
    self.assertTableData('_grist_Tables_column', cols="subset", rows="subset", data=[
      dict(id=28, colId="Rank", formula=renamed_formula)
    ])
    self.assertTableData('Purchases', cols="subset", data=[
          [ "id",   "when",       "cat",    "Rank"],
          [1,       D(2023,12,1), "A",        1     ],
          [2,       D(2023,12,4), "A",        3     ],
          [3,       D(2023,12,3), "A",        2     ],
          [4,       D(2023,12,9), "A",        6     ],
          [5,       D(2023,12,2), "B",        1     ],
          [6,       D(2023,12,6), "B",        2     ],
          [7,       D(2023,12,7), "A",        5     ],
          [8,       D(2023,12,5), "A",        4     ],
    ])

  @unittest.skipUnless(six.PY3, "Python 3 only")
  def test_prevnext_rename_result_attr(self):
    self.do_setup()
    self.add_column('Purchases', 'PrevAmount', formula="PREVIOUS(rec, order_by=None).Amount")
    self.add_column('Purchases', 'NextAmount', formula="NEXT(rec, order_by=None).Amount")
    self.apply_user_action(['RenameColumn', 'Purchases', 'Amount', 'Dollars'])
    self.assertTableData('_grist_Tables_column', cols="subset", rows="subset", data=[
      dict(id=28, colId="PrevAmount", formula="PREVIOUS(rec, order_by=None).Dollars"),
      dict(id=29, colId="NextAmount", formula="NEXT(rec, order_by=None).Dollars"),
    ])


def is_all_ints(array):
  return all(isinstance(x, int) for x in array)
