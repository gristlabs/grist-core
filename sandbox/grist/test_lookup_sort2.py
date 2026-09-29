"""
More tests of lookups with order_by, focusing on rebuilds of the sort-by column.

Sorted lookups cache sorted row ids per (key, sort_spec). A rebuild of the sort-by column (a
type change or a data<->formula toggle) replaces the values the cache was sorted by, so the
cache must be dropped and the results re-sorted.
"""

import testutil
import test_engine
from test_reload_oracle import ReloadOracleMixin


class TestLookupSort2(ReloadOracleMixin, test_engine.EngineTestCase):

  def _sorted_sample(self, sort_col_type, order_col="Score", data=None):
    return testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Classes", [
          [12, "Sorted", "Any", True,
            "','.join(Students.lookupRecords(MainClass=$id, order_by='%s').Name)" % order_col, "", ""],
        ]],
        [2, "Students", [
          [20, "Name",      "Text",         False, "", "", ""],
          [21, "MainClass", "Ref:Classes",  False, "", "", ""],
          [22, order_col,   sort_col_type,  False, "", "", ""],
        ]],
      ],
      "DATA": {
        "Classes": [["id"], [1]],
        "Students": data,
      },
    })

  def test_sort_column_type_change(self):
    """
    Changing a sort-by column's type must re-sort dependent lookups with the converted values,
    not keep the order cached for the old type.
    """
    # Scores chosen so that the numeric order (BB,AA,CC), the text order ("100","81","9" ->
    # CC,AA,BB), and the row-id order (AA,BB,CC) are all distinct: a stale cache or a corrupted
    # rebuild can't pass by coincidence.
    self.load_sample(self._sorted_sample("Numeric", data=[
      ["id", "Name", "MainClass", "Score"],
      [1, "AA", 1, 81], [2, "BB", 1, 9], [3, "CC", 1, 100]]))
    self.assertEqual(self.engine.fetch_table("Classes").columns["Sorted"][0], "BB,AA,CC")

    self.apply_user_action(["ModifyColumn", "Students", "Score", {"type": "Text"}])
    self.assertEqual(self.engine.fetch_table("Classes").columns["Sorted"][0], "CC,AA,BB")
    self.assert_reload_consistent("after sort-column type change")

  def test_sort_column_date_change(self):
    """
    A Date sort column changed to Numeric keeps the same stored values and the same correct
    order; the rebuild must not corrupt the cached order (e.g. into row-id order).
    """
    # Date cells compare at day granularity, so the timestamps must differ by at least a day.
    self.load_sample(self._sorted_sample("Date", order_col="When", data=[
      ["id", "Name", "MainClass", "When"],
      [1, "A", 1, 300 * 86400], [2, "B", 1, 100 * 86400], [3, "C", 1, 200 * 86400]]))
    self.assertEqual(self.engine.fetch_table("Classes").columns["Sorted"][0], "B,C,A")
    self.apply_user_action(["ModifyColumn", "Students", "When", {"type": "Numeric"}])
    self.assertEqual(self.engine.fetch_table("Classes").columns["Sorted"][0], "B,C,A")
    self.assert_reload_consistent("after Date->Numeric sort-column change")

  def test_sort_column_isformula_toggle(self):
    """
    A data->formula toggle also rebuilds the sort column; the new formula values must drive the
    order.
    """
    self.load_sample(self._sorted_sample("Numeric", order_col="When", data=[
      ["id", "Name", "MainClass", "When"], [1, "A", 1, 300], [2, "B", 1, 100], [3, "C", 1, 200]]))
    self.assertEqual(self.engine.fetch_table("Classes").columns["Sorted"][0], "B,C,A")
    self.apply_user_action(["ModifyColumn", "Students", "When",
      {"isFormula": True, "formula": "400 - $id"}])
    # 400-id: row1->399, row2->398, row3->397; ascending -> C,B,A.
    self.assertEqual(self.engine.fetch_table("Classes").columns["Sorted"][0], "C,B,A")
    self.assert_reload_consistent("after isFormula toggle on sort column")

  def test_sorted_match_empty(self):
    """
    Adding order_by to a CONTAINS(0, match_empty=0) lookup must not change what it matches: the
    sorted lookup path must apply the same empty-value key handling as the plain path.
    """
    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Table1", [
          [1, "Refs", "RefList:Table1", False, "", "", ""],
          [2, "Hits", "Any", True,
            "len(Table1.lookupRecords(Refs=CONTAINS(0, match_empty=0)))", "", ""],
          [3, "Sorted", "Any", True,
            "len(Table1.lookupRecords(Refs=CONTAINS(0, match_empty=0), order_by='-id'))", "", ""],
        ]],
      ],
      "DATA": {"Table1": [["id", "Refs"], [1, None]]},
    }))
    # Hits (the plain path) doubles as the control for Sorted.
    self.assertTableData("Table1", cols="subset", data=[
      ["id", "Hits", "Sorted"],
      [1, 1, 1],
    ])
    self.assert_reload_consistent("sorted match_empty lookup")

  def test_sorted_ref_contains(self):
    """
    CONTAINS(x) on a plain Ref column matches by equality (a Ref cell behaves as a
    single-element RefList; see test_lookups_refs.test_ref_contains); adding order_by must
    return the same rows, sorted.
    """
    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Classes", [
          [12, "Sorted", "Any", True,
            "','.join(Students.lookupRecords(MainClass=CONTAINS($id), order_by='Score').Name)",
            "", ""],
        ]],
        [2, "Students", [
          [20, "Name",      "Text",        False, "", "", ""],
          [21, "MainClass", "Ref:Classes", False, "", "", ""],
          [22, "Score",     "Numeric",     False, "", "", ""],
        ]],
      ],
      "DATA": {
        "Classes": [["id"], [1]],
        "Students": [["id", "Name", "MainClass", "Score"],
                     [1, "AA", 1, 81], [2, "BB", 1, 9], [3, "CC", 1, 100]],
      },
    }))
    self.assertEqual(self.engine.fetch_table("Classes").columns["Sorted"][0], "BB,AA,CC")
    self.update_record("Students", 2, Score=200)
    self.assertEqual(self.engine.fetch_table("Classes").columns["Sorted"][0], "AA,CC,BB")
    self.assert_reload_consistent("sorted CONTAINS on a plain Ref")

  def test_sorted_helper_cleanup(self):
    """
    A sorted lookup helper column is shared by all formulas doing the same sorted lookup.
    Removing one of them must not disturb the helper while others remain; removing the last one
    must reclaim it, even while another formula keeps using the unsorted lookup on the same key.
    """
    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Classes", [
          [11, "Cnt", "Any", True, "len(Students.lookupRecords(MainClass=$id))", "", ""],
          [12, "Sorted", "Any", True,
            "','.join(Students.lookupRecords(MainClass=$id, order_by='Score').Name)", "", ""],
          [13, "Sorted2", "Any", True,
            "':'.join(Students.lookupRecords(MainClass=$id, order_by='Score').Name)", "", ""],
        ]],
        [2, "Students", [
          [20, "Name",      "Text",        False, "", "", ""],
          [21, "MainClass", "Ref:Classes", False, "", "", ""],
          [22, "Score",     "Numeric",     False, "", "", ""],
        ]],
      ],
      "DATA": {
        "Classes": [["id"], [1]],
        "Students": [["id", "Name", "MainClass", "Score"],
                     [1, "AA", 1, 81], [2, "BB", 1, 9], [3, "CC", 1, 100]],
      },
    }))
    students = self.engine.tables["Students"]
    self.assertIn("#lookup#MainClass#Score", students._special_cols)
    self.assertTableData("Classes", cols="subset", data=[
      ["id", "Cnt", "Sorted",    "Sorted2"],
      [1,    3,     "BB,AA,CC",  "BB:AA:CC"],
    ])

    # Removing one of the two formulas sharing the sorted helper must leave it alive and
    # reactive for the other.
    self.apply_user_action(["RemoveColumn", "Classes", "Sorted"])
    self.assertIn("#lookup#MainClass#Score", students._special_cols)
    self.update_record("Students", 2, Score=200)
    self.assertTableData("Classes", cols="subset", data=[
      ["id", "Cnt", "Sorted2"],
      [1,    3,     "AA:CC:BB"],
    ])

    # Removing the last formula using the sorted lookup reclaims the helper, while the unsorted
    # lookup (still used by Cnt) stays and keeps working.
    self.apply_user_action(["RemoveColumn", "Classes", "Sorted2"])
    self.assertNotIn("#lookup#MainClass#Score", students._special_cols)
    self.assertIn("#lookup#MainClass", students._special_cols)
    self.update_record("Students", 2, MainClass=0)
    self.assertTableData("Classes", cols="subset", data=[
      ["id", "Cnt"],
      [1,    2],
    ])
