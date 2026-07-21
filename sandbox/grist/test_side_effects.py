# This test verifies behavior when a formula produces side effects. The prime example is
# lookupOrAddDerived() function, which adds new records (and is the basis for summary tables).

import engine as engine_module
import objtypes
import test_engine
import testutil
import useractions

class TestSideEffects(test_engine.EngineTestCase):
  address_table_data = [
    ["id",  "city",     "state", "amount" ],
    [ 21,   "New York", "NY"   , 1        ],
    [ 22,   "Albany",   "NY"   , 2        ],
  ]

  schools_table_data = [
    ["id",  "city"     , "name" ],
    [1,    "Boston"    , "MIT"  ],
    [2,    "New York"  , "NYU"  ],
  ]

  sample = testutil.parse_test_sample({
    "SCHEMA": [
      [1, "Address", [
        [1, "city",        "Text",       False, "", "", ""],
        [2, "state",       "Text",       False, "", "", ""],
        [3, "amount",      "Numeric",    False, "", "", ""],
      ]],
      [2, "Schools", [
        [11,   "name",        "Text",      False, "", "", ""],
        [12,   "city",        "Text",      False, "", "", ""],
      ]],
    ],
    "DATA": {
      "Address": address_table_data,
      "Schools": schools_table_data,
    }
  })

  def test_failure_after_side_effect(self):
    # Verify that when a formula fails after a side-effect, the effect is reverted.
    self.load_sample(self.sample)

    formula = 'Schools.lookupOrAddDerived(city="TESTCITY")\nraise Exception("test-error")\nNone'
    out_actions = self.apply_user_action(['AddColumn', 'Address', "A", { 'formula': formula }])
    self.assertPartialOutActions(out_actions, { "stored": [
      ["AddColumn", "Address", "A", {"formula": formula, "isFormula": True, "type": "Any"}],
      ["AddRecord", "_grist_Tables_column", 13, {
        "colId": "A", "formula": formula, "isFormula": True, "label": "A",
        "parentId": 1, "parentPos": 4.0, "type": "Any", "widgetOptions": ""
      }],
      ["BulkUpdateRecord", "Address", [21, 22], {"A": [["E", "Exception"], ["E", "Exception"]]}],
      # The thing to note  here is that while lookupOrAddDerived() should have added a row to
      # Schools, the Exception negated it, and there is no action to add that row.
    ]})

    # Check that data is as expected: no new records in Schools, one new column in Address.
    self.assertTableData('Schools', cols="all", data=self.schools_table_data)
    self.assertTableData('Address', cols="all", data=[
      ["id",  "city",     "state", "amount", "A"            ],
      [ 21,   "New York", "NY"   , 1,        objtypes.RaisedException(Exception())  ],
      [ 22,   "Albany",   "NY"   , 2,        objtypes.RaisedException(Exception())  ],
    ])


  def test_multiple_adds_same_table(self):
    # One cell calling lookupOrAddDerived twice on the same table adds both rows.
    self.load_sample(self.sample)

    formula = '''
Schools.lookupOrAddDerived(city=$city + "-A")
Schools.lookupOrAddDerived(city=$city + "-B")
return None
'''
    self.add_column('Address', 'A', formula=formula)

    # Each of the two existing Address rows should have created two Schools rows.
    self.assertTableData('Schools', cols="subset", data=[
      ["id", "city",       "name"],
      [1,    "Boston",     "MIT"],
      [2,    "New York",   "NYU"],
      [3,    "New York-A", ""],
      [4,    "New York-B", ""],
      [5,    "Albany-A",   ""],
      [6,    "Albany-B",   ""],
    ])

    # A no-op repeat (same key twice) must also be fine, and not add duplicates.
    formula2 = '''
Schools.lookupOrAddDerived(city=$city + "-A")
Schools.lookupOrAddDerived(city=$city + "-A")
return None
'''
    self.add_column('Address', 'B', formula=formula2)
    # No new rows beyond the -A ones already present.
    self.assertTableData('Schools', cols="subset", data=[
      ["id", "city",       "name"],
      [1,    "Boston",     "MIT"],
      [2,    "New York",   "NYU"],
      [3,    "New York-A", ""],
      [4,    "New York-B", ""],
      [5,    "Albany-A",   ""],
      [6,    "Albany-B",   ""],
    ])

  def test_multiple_adds_via_new_record(self):
    # The runtime path: column exists, then a new record triggers the two adds.
    self.load_sample(self.sample)

    formula = '''
Schools.lookupOrAddDerived(city=$city + "-A")
Schools.lookupOrAddDerived(city=$city + "-B")
return None
'''
    self.add_column('Address', 'A', formula=formula)
    # Adding a brand-new Address row should create two Schools rows for it.
    self.add_record('Address', city="Reno")
    reno = [r for r in self.engine.fetch_table('Schools').columns['city'] if str(r).startswith("Reno")]
    self.assertEqual(sorted(reno), ["Reno-A", "Reno-B"])

  def test_multiple_adds_on_empty_then_record(self):
    # Even closer to the runtime: column added to a table with no rows, then a record inserted.
    self.apply_user_action(['AddTable', 'Parent', [
      {'id': 'Name', 'type': 'Text'},
    ]])
    self.apply_user_action(['AddTable', 'Child', [
      {'id': 'Name', 'type': 'Text'},
      {'id': 'Parent', 'type': 'Ref:Parent'},
    ]])
    formula = '''
Child.lookupOrAddDerived(Parent=$id, Name="A")
Child.lookupOrAddDerived(Parent=$id, Name="B")
return None
'''
    self.add_column('Parent', 'make', formula=formula)
    self.add_record('Parent', Name="P1")
    self.assertTableData('Child', cols="subset", data=[
      ["id", "Name", "Parent"],
      [1,    "A",    1],
      [2,    "B",    1],
    ])

  def test_calc_actions_in_side_effect_rollback(self):
    self.load_sample(self.sample)

    # Formula which allows a side effect to be conditionally rolled back.
    formula = '''
Schools.lookupOrAddDerived(city=$city)
if $amount < 0:
  raise Exception("test-error")
return None
'''
    self.add_column('Schools', 'ucity', formula='$city.upper()')
    self.add_column('Address', 'A', formula=formula)

    self.assertTableData('Schools', cols="all", data=[
      ["id", "city", "name", "ucity"],
      [1, "Boston", "MIT", "BOSTON"],
      [2, "New York", "NYU", "NEW YORK"],
      [3, "Albany", "", "ALBANY"],
    ])

    # Check that a successful side-effect which adds a row triggers calc actions for that row.
    out_actions = self.update_record('Address', 22, city="aaa", amount=1000)
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["UpdateRecord", "Address", 22, {"amount": 1000.0, "city": "aaa"}],
        ["AddRecord", "Schools", 4, {"city": "aaa"}],
        ["UpdateRecord", "Schools", 4, {"ucity": "AAA"}],
      ],
    })
    self.assertTableData('Schools', cols="all", data=[
      ["id", "city", "name", "ucity"],
      [1, "Boston", "MIT", "BOSTON"],
      [2, "New York", "NYU", "NEW YORK"],
      [3, "Albany", "", "ALBANY"],
      [4, "aaa", "", "AAA"],
    ])

    # Check that a side effect that failed and got rolled back does not include calc actions for
    # the rows that didn't stay.
    out_actions = self.update_record('Address', 22, city="bbb", amount=-3)
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["UpdateRecord", "Address", 22, {"amount": -3.0, "city": "bbb"}],
        ["UpdateRecord", "Address", 22, {"A": ["E", "Exception"]}],
      ],
    })
    self.assertTableData('Schools', cols="all", data=[
      ["id", "city", "name", "ucity"],
      [1, "Boston", "MIT", "BOSTON"],
      [2, "New York", "NYU", "NEW YORK"],
      [3, "Albany", "", "ALBANY"],
      [4, "aaa", "", "AAA"],
    ])

  # Regression test: recreating a table (RemoveTable + AddTable) must leave no orphaned view/page.
  # Reopening first forces the recreated view onto a new row id instead of reusing the removed
  # view's id -- the circumstance in which the orphan was originally left behind.

  _USER = {
    'Name': 'Foo', 'UserID': 1, 'UserRef': '1', 'LinkKey': {}, 'Origin': None,
    'Email': 'foo@example.com', 'Access': 'owners', 'SessionID': 'u1',
    'IsLoggedIn': True, 'ShareRef': None,
  }

  def _apply(self, *reprs):
    return self.engine.apply_user_actions(
      [useractions.from_repr(a) for a in reprs], self._USER)

  def _reopen(self):
    # Reopen the doc: load stored state into a fresh engine and Calculate.
    meta_tables = self.engine.fetch_table('_grist_Tables')
    meta_columns = self.engine.fetch_table('_grist_Tables_column')
    other = {t: self.engine.fetch_table(t) for t in self.engine.tables
             if t not in ('_grist_Tables', '_grist_Tables_column')}
    self.engine = engine_module.Engine()
    self.engine.load_meta_tables(meta_tables, meta_columns)
    for data in other.values():
      self.engine.load_table(data)
    self._apply(['Calculate'])

  def test_recreate_table_leaves_no_orphan_view(self):
    self._apply(["InitNewDoc"])
    self._apply(["AddEmptyTable", None])
    self._reopen()

    # Recreate Table1 in a single bundle, as replacing a table does.
    self._apply(
      ["RemoveTable", "Table1"],
      ["AddTable", "Table1", [
        {"id": "Toggle", "type": "Bool"},
        {"id": "Another", "type": "Text"},
        {"id": "User_Access", "type": "Text", "isFormula": False, "formula": "user.Email"},
      ]],
      ["AddRecord", "Table1", None, {"Another": "hello"}],
    )

    # Exactly one view and page must remain: no orphan left by RemoveTable.
    views = list(self.engine.docmodel.views.all)
    pages = list(self.engine.docmodel.pages.all)
    self.assertEqual([(v.name, v.type) for v in views], [("Table1", "raw_data")])
    self.assertEqual(len(pages), 1)

    table = self.engine.docmodel.tables.lookupOne(tableId="Table1")
    self.assertEqual(table.primaryViewId._row_id, views[0].id)
    self.assertEqual(pages[0].viewRef._row_id, views[0].id)
    record_sections = [s for s in self.engine.docmodel.view_sections.all
                       if s.parentId._row_id == views[0].id]
    self.assertEqual(len(record_sections), 1)
    self.assertEqual(record_sections[0].tableRef.tableId, "Table1")
