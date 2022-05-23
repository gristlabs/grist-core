# This test verifies behavior when a formula produces side effects. The prime example is
# lookupOrAddDerived() function, which adds new records (and is the basis for summary tables).

import objtypes
import test_engine
import testutil

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
