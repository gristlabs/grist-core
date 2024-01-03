# -*- coding: utf-8 -*-
import logging
import unittest

from asttokens.util import fstring_positions_work

import testutil
import test_engine

log = logging.getLogger(__name__)


class TestRenames(test_engine.EngineTestCase):
  # Simpler cases of column renames in formulas. Here's the list of cases we support and test.

  # $COLUMN where NAME is a column (formula or non-formula)
  # $ref.COLUMN when $ref is a non-formula Reference column
  # $ref.column.COLUMN
  # $ref.COLUMN when $ref is a function with a Ref type.
  # $ref.COLUMN when $ref is a function with Any type but clearly returning a Ref.
  # Table.lookupFunc(COLUMN1=value, COLUMN2=value) and for .lookupRecords
  # Table.lookupFunc(...).COLUMN and for .lookupRecords
  # Table.lookupFunc(...).foo.COLUMN and for .lookupRecords
  # [x.COLUMN for x in Table.lookupRecords(...)] for different kinds of comprehensions
  # TABLE.lookupFunc(...) where TABLE is a user-defined table.

  sample = testutil.parse_test_sample({
    "SCHEMA": [
      [1, "Address", [
        [21, "city",        "Text",        False, "", "", ""],
      ]],
      [2, "People", [
        [22, "name",        "Text",        False, "", "", ""],
        [23, "addr",        "Ref:Address", False, "", "", ""],
        [24, "city",        "Any",         True,  "$addr.city", "", ""],
      ]]
    ],
    "DATA": {
      "Address": [
        ["id",  "city"       ],
        [11,    "New York"   ],
        [12,    "Colombia"   ],
        [13,    "New Haven"  ],
        [14,    "West Haven" ],
      ],
      "People": [
        ["id",  "name"  , "addr"  ],
        [1,     "Bob"   , 12      ],
        [2,     "Alice" , 13      ],
        [3,     "Doug"  , 12      ],
        [4,     "Sam"   , 11      ],
      ],
    }
  })

  def test_rename_rec_attribute(self):
    # Simple case: we are renaming `$COLUMN`.
    self.load_sample(self.sample)
    out_actions = self.apply_user_action(["RenameColumn", "People", "addr", "address"])
    self.assertPartialOutActions(out_actions, { "stored": [
      ["RenameColumn", "People", "addr", "address"],
      ["ModifyColumn", "People", "city", {"formula": "$address.city"}],
      ["BulkUpdateRecord", "_grist_Tables_column", [23, 24], {
        "colId": ["address", "city"],
        "formula": ["", "$address.city"]
      }],
    ],
      # Things should get recomputed, but produce same results, hence no calc actions.
      "calc": []
    })

    # Make sure renames of formula columns are also recognized.
    self.add_column("People", "CityUpper", formula="$city.upper()")
    out_actions = self.apply_user_action(["RenameColumn", "People", "city", "ciudad"])
    self.assertPartialOutActions(out_actions, { "stored": [
      ["RenameColumn", "People", "city", "ciudad"],
      ["ModifyColumn", "People", "CityUpper", {"formula": "$ciudad.upper()"}],
      ["BulkUpdateRecord", "_grist_Tables_column", [24, 25], {
        "colId": ["ciudad", "CityUpper"],
        "formula": ["$address.city", "$ciudad.upper()"]
      }]
    ]})

  @unittest.skipUnless(fstring_positions_work(), "Python 3.10+ only")
  def test_rename_inside_fstring(self):
    self.load_sample(self.sample)
    self.add_column("People", "CityUpper", formula="f'{$city.upper()}'")
    out_actions = self.apply_user_action(["RenameColumn", "People", "city", "ciudad"])
    self.assertPartialOutActions(out_actions, { "stored": [
      ["RenameColumn", "People", "city", "ciudad"],
      ["ModifyColumn", "People", "CityUpper", {"formula": "f'{$ciudad.upper()}'"}],
      ["BulkUpdateRecord", "_grist_Tables_column", [24, 25], {
        "colId": ["ciudad", "CityUpper"],
        "formula": ["$addr.city", "f'{$ciudad.upper()}'"]
      }]
    ]})

  def test_rename_reference_attribute(self):
    # Slightly harder: renaming `$ref.COLUMN`
    self.load_sample(self.sample)
    out_actions = self.apply_user_action(["RenameColumn", "Address", "city", "ciudad"])
    self.assertPartialOutActions(out_actions, { "stored": [
      ["RenameColumn", "Address", "city", "ciudad"],
      ["ModifyColumn", "People", "city", {"formula": "$addr.ciudad"}],
      ["BulkUpdateRecord", "_grist_Tables_column", [21, 24], {
        "colId": ["ciudad", "city"],
        "formula": ["", "$addr.ciudad"]
      }],
    ]})

  def test_rename_ref_ref_attr(self):
    # Slightly harder still: renaming $ref.column.COLUMN.
    self.load_sample(self.sample)
    self.add_column("Address", "person", type="Ref:People")
    self.add_column("Address", "person_city", formula="$person.addr.city")
    self.add_column("Address", "person_city2", formula="a = $person.addr\nreturn a.city")
    out_actions = self.apply_user_action(["RenameColumn", "Address", "city", "ciudad"])
    self.assertPartialOutActions(out_actions, { "stored": [
      ["RenameColumn", "Address", "city", "ciudad"],
      ["ModifyColumn", "People", "city", {"formula": "$addr.ciudad"}],
      ["ModifyColumn", "Address", "person_city", {"formula": "$person.addr.ciudad"}],
      ["ModifyColumn", "Address", "person_city2", {"formula":
                                                   "a = $person.addr\nreturn a.ciudad"}],
      ["BulkUpdateRecord", "_grist_Tables_column", [21, 24, 26, 27], {
        "colId": ["ciudad", "city", "person_city", "person_city2"],
        "formula": ["", "$addr.ciudad", "$person.addr.ciudad", "a = $person.addr\nreturn a.ciudad"]
      }],
    ]})

  def test_rename_typed_ref_func_attr(self):
    # Renaming `$ref.COLUMN` when $ref is a function with a Ref type.
    self.load_sample(self.sample)
    self.add_column("People", "addr_func", type="Ref:Address", isFormula=True, formula="$addr")
    self.add_column("People", "city2", formula="$addr_func.city")
    out_actions = self.apply_user_action(["RenameColumn", "Address", "city", "ciudad"])
    self.assertPartialOutActions(out_actions, { "stored": [
      ["RenameColumn", "Address", "city", "ciudad"],
      ["ModifyColumn", "People", "city", {"formula": "$addr.ciudad"}],
      ["ModifyColumn", "People", "city2", {"formula": "$addr_func.ciudad"}],
      ["BulkUpdateRecord", "_grist_Tables_column", [21, 24, 26], {
        "colId": ["ciudad", "city", "city2"],
        "formula": ["", "$addr.ciudad", "$addr_func.ciudad"]
      }],
    ]})

  def test_rename_any_ref_func_attr(self):
    # Renaming `$ref.COLUMN` when $ref is a function with Any type but clearly returning a Ref.
    self.load_sample(self.sample)
    self.add_column("People", "addr_func", isFormula=True, formula="$addr")
    self.add_column("People", "city3", formula="$addr_func.city")
    out_actions = self.apply_user_action(["RenameColumn", "Address", "city", "ciudad"])
    self.assertPartialOutActions(out_actions, { "stored": [
      ["RenameColumn", "Address", "city", "ciudad"],
      ["ModifyColumn", "People", "city", {"formula": "$addr.ciudad"}],
      ["ModifyColumn", "People", "city3", {"formula": "$addr_func.ciudad"}],
      ["BulkUpdateRecord", "_grist_Tables_column", [21, 24, 26], {
        "colId": ["ciudad", "city", "city3"],
        "formula": ["", "$addr.ciudad", "$addr_func.ciudad"]
      }],
    ]})

  def test_rename_reflist_attr(self):
    # Renaming `$ref.COLUMN` where $ref is a data or function with RefList type (most importantly
    # applies to the $group column of summary tables).
    self.load_sample(self.sample)
    self.add_column("People", "addr_list", type="RefList:Address", isFormula=False)
    self.add_column("People", "addr_func", type="RefList:Address", isFormula=True, formula="[1,2]")
    self.add_column("People", "citysum", formula="sum($addr_func.city) + sum($addr_list.city)")
    out_actions = self.apply_user_action(["RenameColumn", "Address", "city", "ciudad"])
    self.assertPartialOutActions(out_actions, { "stored": [
      ["RenameColumn", "Address", "city", "ciudad"],
      ["ModifyColumn", "People", "city", {"formula": "$addr.ciudad"}],
      ["ModifyColumn", "People", "citysum", {"formula":
                                             "sum($addr_func.ciudad) + sum($addr_list.ciudad)"}],
      ["BulkUpdateRecord", "_grist_Tables_column", [21, 24, 27], {
        "colId": ["ciudad", "city", "citysum"],
        "formula": ["", "$addr.ciudad", "sum($addr_func.ciudad) + sum($addr_list.ciudad)"]
      }],
    ]})


  def test_rename_lookup_param(self):
    # Renaming `Table.lookupOne(COLUMN1=value, COLUMN2=value)` and for `.lookupRecords`
    self.load_sample(self.sample)
    self.add_column("Address", "people", formula="People.lookupOne(addr=$id, city=$city)")
    self.add_column("Address", "people2", formula="People.lookupRecords(addr=$id)")
    out_actions = self.apply_user_action(["RenameColumn", "People", "addr", "ADDRESS"])
    self.assertPartialOutActions(out_actions, { "stored": [
      ["RenameColumn", "People", "addr", "ADDRESS"],
      ["ModifyColumn", "People", "city", {"formula": "$ADDRESS.city"}],
      ["ModifyColumn", "Address", "people",
                   {"formula": "People.lookupOne(ADDRESS=$id, city=$city)"}],
      ["ModifyColumn", "Address", "people2",
                   {"formula": "People.lookupRecords(ADDRESS=$id)"}],
      ["BulkUpdateRecord", "_grist_Tables_column", [23, 24, 25, 26], {
        "colId": ["ADDRESS", "city", "people", "people2"],
        "formula": ["", "$ADDRESS.city",
                    "People.lookupOne(ADDRESS=$id, city=$city)",
                    "People.lookupRecords(ADDRESS=$id)"]
      }],
    ]})

    # Another rename that should affect the second parameter.
    out_actions = self.apply_user_action(["RenameColumn", "People", "city", "ciudad"])
    self.assertPartialOutActions(out_actions, { "stored": [
      ["RenameColumn", "People", "city", "ciudad"],
      ["ModifyColumn", "Address", "people",
                   {"formula": "People.lookupOne(ADDRESS=$id, ciudad=$city)"}],
      ["BulkUpdateRecord", "_grist_Tables_column", [24, 25], {
        "colId": ["ciudad", "people"],
        "formula": ["$ADDRESS.city", "People.lookupOne(ADDRESS=$id, ciudad=$city)"]
      }],
    ]})

    # This is kind of unnecessary, but checks how the values of params are affected separately.
    out_actions = self.apply_user_action(["RenameColumn", "Address", "city", "city2"])
    self.assertPartialOutActions(out_actions, { "stored": [
      ["RenameColumn", "Address", "city", "city2"],
      ["ModifyColumn", "People", "ciudad", {"formula": "$ADDRESS.city2"}],
      ["ModifyColumn", "Address", "people",
                   {"formula": "People.lookupOne(ADDRESS=$id, ciudad=$city2)"}],
      ["BulkUpdateRecord", "_grist_Tables_column", [21, 24, 25], {
        "colId": ["city2", "ciudad", "people"],
        "formula": ["", "$ADDRESS.city2", "People.lookupOne(ADDRESS=$id, ciudad=$city2)"]
      }],
    ]})

  def test_rename_lookup_result_attr(self):
    # Renaming `Table.lookupOne(...).COLUMN` and for `.lookupRecords`
    self.load_sample(self.sample)
    self.add_column("Address", "people", formula="People.lookupOne(addr=$id, city=$city).name")
    self.add_column("Address", "people2", formula="People.lookupRecords(addr=$id).name")
    self.add_column("Address", "people3", formula="People.all.name")
    out_actions = self.apply_user_action(["RenameColumn", "People", "name", "nombre"])
    self.assertPartialOutActions(out_actions, { "stored": [
      ["RenameColumn", "People", "name", "nombre"],
      ["ModifyColumn", "Address", "people", {"formula":
                                             "People.lookupOne(addr=$id, city=$city).nombre"}],
      ["ModifyColumn", "Address", "people2", {"formula":
                                              "People.lookupRecords(addr=$id).nombre"}],
      ["ModifyColumn", "Address", "people3", {"formula":
                                              "People.all.nombre"}],
      ["BulkUpdateRecord", "_grist_Tables_column", [22, 25, 26, 27], {
        "colId": ["nombre", "people", "people2", "people3"],
        "formula": ["",
                    "People.lookupOne(addr=$id, city=$city).nombre",
                    "People.lookupRecords(addr=$id).nombre",
                    "People.all.nombre"]
      }],
    ]})

  def test_rename_lookup_ref_attr(self):
    # Renaming `Table.lookupOne(...).foo.COLUMN` and for `.lookupRecords`
    self.load_sample(self.sample)
    self.add_column("Address", "people", formula="People.lookupOne(addr=$id, city=$city).addr.city")
    self.add_column("Address", "people2", formula="People.lookupRecords(addr=$id).addr.city")
    out_actions = self.apply_user_action(["RenameColumn", "Address", "city", "ciudad"])
    self.assertPartialOutActions(out_actions, { "stored": [
      ["RenameColumn", "Address", "city", "ciudad"],
      ["ModifyColumn", "People", "city", {"formula": "$addr.ciudad"}],
      ["ModifyColumn", "Address", "people", {"formula":
                                       "People.lookupOne(addr=$id, city=$ciudad).addr.ciudad"}],
      ["ModifyColumn", "Address", "people2", {"formula":
                                              "People.lookupRecords(addr=$id).addr.ciudad"}],
      ["BulkUpdateRecord", "_grist_Tables_column", [21, 24, 25, 26], {
        "colId": ["ciudad", "city", "people", "people2"],
        "formula": ["", "$addr.ciudad",
                    "People.lookupOne(addr=$id, city=$ciudad).addr.ciudad",
                    "People.lookupRecords(addr=$id).addr.ciudad"]
      }]
    ]})

  def test_rename_lookup_iter_attr(self):
    # Renaming `[x.COLUMN for x in Table.lookupRecords(...)]`.
    self.check_comprehension_rename("People.lookupRecords(addr=$id)",
                                    "People.lookupRecords(ADDRESS=$id)")

  def test_rename_all_iter_attr(self):
    # Renaming `[x.COLUMN for x in Table.all]`.
    self.check_comprehension_rename("People.all", "People.all")

  def check_comprehension_rename(self, iter_expr1, iter_expr2):
    self.load_sample(self.sample)
    self.add_column("Address", "people",
                    formula="','.join(x.addr.city for x in %s)" % iter_expr1)
    self.add_column("Address", "people2",
                    formula="','.join([x.addr.city for x in %s])" % iter_expr1)
    self.add_column("Address", "people3",
                    formula="','.join({x.addr.city for x in %s})" % iter_expr1)
    self.add_column("Address", "people4",
                    formula="{x.addr.city:x.addr for x in %s}" % iter_expr1)
    out_actions = self.apply_user_action(["RenameColumn", "People", "addr", "ADDRESS"])
    self.assertPartialOutActions(out_actions, { "stored": [
      ["RenameColumn", "People", "addr", "ADDRESS"],
      ["ModifyColumn", "People", "city", {"formula": "$ADDRESS.city"}],
      ["ModifyColumn", "Address", "people",
           {"formula": "','.join(x.ADDRESS.city for x in %s)" % iter_expr2}],
      ["ModifyColumn", "Address", "people2",
           {"formula": "','.join([x.ADDRESS.city for x in %s])" % iter_expr2}],
      ["ModifyColumn", "Address", "people3",
           {"formula": "','.join({x.ADDRESS.city for x in %s})" % iter_expr2}],
      ["ModifyColumn", "Address", "people4",
           {"formula": "{x.ADDRESS.city:x.ADDRESS for x in %s}" % iter_expr2}],
      ["BulkUpdateRecord", "_grist_Tables_column", [23, 24, 25, 26, 27, 28], {
        "colId": ["ADDRESS", "city", "people", "people2", "people3", "people4"],
        "formula": ["", "$ADDRESS.city",
           "','.join(x.ADDRESS.city for x in %s)" % iter_expr2,
           "','.join([x.ADDRESS.city for x in %s])" % iter_expr2,
           "','.join({x.ADDRESS.city for x in %s})" % iter_expr2,
           "{x.ADDRESS.city:x.ADDRESS for x in %s}" % iter_expr2],
      }],
    ]})

  def test_rename_table(self):
    # Renaming TABLE.lookupFunc(...) where TABLE is a user-defined table.
    self.load_sample(self.sample)
    self.add_column("Address", "people", formula="People.lookupRecords(addr=$id)")
    self.add_column("Address", "people2", type="Ref:People", formula="People.lookupOne(addr=$id)")
    out_actions = self.apply_user_action(["RenameTable", "People", "Persons"])
    self.assertPartialOutActions(out_actions, { "stored": [
      ["ModifyColumn", "Address", "people2", {"type": "Int"}],
      ["RenameTable", "People", "Persons"],
      ["UpdateRecord", "_grist_Tables", 2, {"tableId": "Persons"}],
      ["ModifyColumn", "Address", "people2", {
        "type": "Ref:Persons", "formula": "Persons.lookupOne(addr=$id)" }],
      ["ModifyColumn", "Address", "people", {"formula": "Persons.lookupRecords(addr=$id)"}],
      ["BulkUpdateRecord", "_grist_Tables_column", [26, 25], {
        "type": ["Ref:Persons", "Any"],
        "formula": ["Persons.lookupOne(addr=$id)", "Persons.lookupRecords(addr=$id)"]
      }],
      ["BulkUpdateRecord", "Address", [11, 12, 13, 14], {
        "people": [["r", "Persons", [4]],
                   ["r", "Persons", [1, 3]],
                   ["r", "Persons", [2]],
                   ["r", "Persons", []]]
      }],
    ]})

  def test_rename_table_autocomplete(self):
    user = {
      'Name': 'Foo',
      'UserID': 1,
      'UserRef': '1',
      'LinkKey': {},
      'Origin': None,
      'Email': 'foo@example.com',
      'Access': 'owners',
      'SessionID': 'u1',
      'IsLoggedIn': True,
      'ShareRef': None
    }

    # Renaming a table should not leave the old name available for auto-complete.
    self.load_sample(self.sample)
    names = {"People", "Persons"}
    autocomplete = self.engine.autocomplete("Pe", "Address", "city", 1, user)
    suggestions = {suggestion for suggestion, value in autocomplete}
    self.assertEqual(
      names.intersection(suggestions),
      {"People"}
    )

    # Rename the table and ensure that "People" is no longer present among top-level names.
    self.apply_user_action(["RenameTable", "People", "Persons"])
    autocomplete = self.engine.autocomplete("Pe", "Address", "city", 1, user)
    suggestions = {suggestion for suggestion, value in autocomplete}
    self.assertEqual(
      names.intersection(suggestions),
      {"Persons"}
    )

  def test_rename_to_id(self):
    # Check that we renaming a column to "Id" disambiguates it with a suffix.
    self.load_sample(self.sample)
    out_actions = self.apply_user_action(["RenameColumn", "People", "name", "Id"])
    self.assertPartialOutActions(out_actions, { "stored": [
      ["RenameColumn", "People", "name", "Id2"],
      ["UpdateRecord", "_grist_Tables_column", 22, {"colId": "Id2"}],
    ]})

  def test_renames_with_non_ascii(self):
    # Test that presence of unicode does not interfere with formula adjustments for renaming.
    self.load_sample(self.sample)
    self.add_column("Address", "CityUpper", formula=u"'Øî'+$city.upper()+'áü'")
    out_actions = self.apply_user_action(["RenameColumn", "Address", "city", "ciudad"])
    self.assertPartialOutActions(out_actions, { "stored": [
      ["RenameColumn", "Address", "city", "ciudad"],
      ["ModifyColumn", "People", "city", {"formula": "$addr.ciudad"}],
      ["ModifyColumn", "Address", "CityUpper", {"formula": u"'Øî'+$ciudad.upper()+'áü'"}],
      ["BulkUpdateRecord", "_grist_Tables_column", [21, 24, 25], {
        "colId": ["ciudad", "city", "CityUpper"],
        "formula": ["", "$addr.ciudad", u"'Øî'+$ciudad.upper()+'áü'"],
      }]
    ]})
    self.assertTableData("Address", cols="all", data=[
      ["id",  "ciudad",     "CityUpper"],
      [11,    "New York",   u"ØîNEW YORKáü"],
      [12,    "Colombia",   u"ØîCOLOMBIAáü"],
      [13,    "New Haven",  u"ØîNEW HAVENáü"],
      [14,    "West Haven", u"ØîWEST HAVENáü"],
    ])

  def test_rename_updates_properties(self):
    # This tests for the following bug: a column A of type Any with formula Table1.lookupOne(B=$B)
    # will return a correct reference; when column Table1.X is renamed to Y, $A.X will be changed
    # to $A.Y correctly. The bug was that the fixed $A.Y formula would fail incorrectly with
    # "Table1 has no column 'Y'".
    #
    # The cause was that Record objects created by $A were not affected by the
    # rename, or recomputed after it, and contained a stale list of allowed column names (the fix
    # removes reliance on storing column names in the Record class).

    self.load_sample(self.sample)
    self.add_column("Address", "person", formula="People.lookupOne(addr=$id)")
    self.add_column("Address", "name", formula="$person.name")
    from datetime import date
    # A helper for comparing Record objects below.
    people_table = self.engine.tables['People']
    people_rec = lambda row_id: people_table.Record(row_id, None)

    # Verify the data and calculations are correct.
    self.assertTableData("Address", cols="all", data=[
      ["id",  "city",       "person",           "name"],
      [11,    "New York",   people_rec(4),      "Sam"],
      [12,    "Colombia",   people_rec(1),      "Bob"],
      [13,    "New Haven",  people_rec(2),      "Alice"],
      [14,    "West Haven", people_rec(0),      ""],
    ])

    # Do the rename.
    out_actions = self.apply_user_action(["RenameColumn", "People", "name", "name2"])
    self.assertPartialOutActions(out_actions, { "stored": [
      ["RenameColumn", "People", "name", "name2"],
      ["ModifyColumn", "Address", "name", {"formula": "$person.name2"}],
      ["BulkUpdateRecord", "_grist_Tables_column", [22, 26], {
        "colId": ["name2", "name"],
        "formula": ["", "$person.name2"],
      }]
    ]})

    # Verify the data and calculations are correct after the rename.
    self.assertTableData("Address", cols="all", data=[
      ["id",  "city",       "person",           "name"],
      [11,    "New York",   people_rec(4),      "Sam"],
      [12,    "Colombia",   people_rec(1),      "Bob"],
      [13,    "New Haven",  people_rec(2),      "Alice"],
      [14,    "West Haven", people_rec(0),      ""],
    ])
