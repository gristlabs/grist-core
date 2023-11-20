import logging

import testutil
import test_engine
from test_engine import Table, Column

log = logging.getLogger(__name__)

class TestUserActions(test_engine.EngineTestCase):
  ref_sample = testutil.parse_test_sample({
    # pylint: disable=line-too-long
    "SCHEMA": [
      [1, "Television", [
        [21, "show",    "Text", False, "", "", ""],
        [22, "network", "Text", False, "", "", ""],
        [23, "viewers", "Int",  False, "", "", ""]
      ]]
    ],
    "DATA": {
      "Television": [
        ["id",  "show"           , "network", "viewers"],
        [11,    "Game of Thrones", "HBO"    , 100],
        [12,    "Narcos"         , "Netflix", 500],
        [13,    "Today"          , "NBC"    , 200],
        [14,    "Empire"         , "Fox"    , 300]],
    }
  })

  def test_display_cols(self):
    # Test the implementation of display columns which adds a column modified by
    # a formula as a display version of the original column.

    self.load_sample(self.ref_sample)

    # Add a new table for People so that we get the associated views and fields.
    self.apply_user_action(['AddTable', 'Favorites', [{'id': 'favorite', 'type':
      'Ref:Television'}]])
    self.apply_user_action(['BulkAddRecord', 'Favorites', [1,2,3,4,5], {
      'favorite': [2, 4, 1, 4, 3]
    }])
    self.assertTables([
      Table(1, "Television", 0, 0, columns=[
        Column(21, "show",    "Text", False,  "", 0),
        Column(22, "network", "Text", False,  "", 0),
        Column(23, "viewers", "Int",  False,  "", 0),
      ]),
      Table(2, "Favorites", 1, 0, columns=[
        Column(24, "manualSort", "ManualSortPos", False, "", 0),
        Column(25, "favorite", "Ref:Television", False,  "", 0),
      ]),
    ])
    self.assertTableData("_grist_Views_section_field", cols="subset", data=[
      ["id", "colRef", "displayCol"],
      [1,          25,            0],
      [2,          25,            0],
      [3,          25,            0],
    ])
    self.assertTableData("Favorites", cols="subset", data=[
      ["id",  "favorite"],
      [1, 2],
      [2, 4],
      [3, 1],
      [4, 4],
      [5, 3]
    ])

    # Add an extra view for the new table to test multiple fields at once
    self.apply_user_action(['AddView', 'Favorites', 'raw_data', 'Extra View'])
    self.assertTableData("_grist_Views_section_field", cols="subset", data=[
      ["id", "colRef", "displayCol"],
      [1,          25,            0],
      [2,          25,            0],
      [3,          25,            0],
      [4,          25,            0],
    ])

    # Set display formula for 'favorite' column.
    # A "gristHelper_Display" column with the requested formula should be added and set as the
    # displayCol of the favorite column.
    self.apply_user_action(['SetDisplayFormula', 'Favorites', None, 25, '$favorite.show'])
    self.assertTableData("_grist_Tables_column", cols="subset", rows=(lambda r: r.id >= 25), data=[
      ["id", "colId", "parentId", "displayCol", "formula"],
      [25, "favorite",      2, 26, ""],
      [26, "gristHelper_Display", 2,  0, "$favorite.show"]
    ])

    # Set display formula for 'favorite' column fields.
    # A single "gristHelper_Display2" column should be added with the requested formula, since both
    # require the same formula. The fields' colRefs should be set to the new column.
    self.apply_user_action(['SetDisplayFormula', 'Favorites', 1, None, '$favorite.network'])
    self.apply_user_action(['SetDisplayFormula', 'Favorites', 4, None, '$favorite.network'])
    self.assertTableData("_grist_Tables_column", cols="subset", rows=(lambda r: r.id >= 25), data=[
      ["id", "colId", "parentId", "displayCol", "formula"],
      [25, "favorite",       2, 26, ""],
      [26, "gristHelper_Display",  2,  0, "$favorite.show"],
      [27, "gristHelper_Display2", 2,  0, "$favorite.network"],
    ])
    self.assertTableData("_grist_Views_section_field", cols="subset", data=[
      ["id", "colRef", "displayCol"],
      [1,   25,   27],
      [2,   25,    0],
      [3,   25,    0],
      [4,   25,   27],
    ])

    # Change display formula for a field.
    # Since the field is changing to use a formula not yet held by a display column,
    # a new display column should be added with the desired formula.
    self.apply_user_action(['SetDisplayFormula', 'Favorites', 4, None, '$favorite.viewers'])
    self.assertTableData("_grist_Tables_column", cols="subset", rows=(lambda r: r.id >= 25), data=[
      ["id", "colId", "parentId", "displayCol", "formula"],
      [25, "favorite",       2, 26, ""],
      [26, "gristHelper_Display",  2,  0, "$favorite.show"],
      [27, "gristHelper_Display2", 2,  0, "$favorite.network"],
      [28, "gristHelper_Display3", 2,  0, "$favorite.viewers"]
    ])
    self.assertTableData("_grist_Views_section_field", cols="subset", data=[
      ["id", "colRef", "displayCol"],
      [1,   25,   27],
      [2,   25,    0],
      [3,   25,    0],
      [4,   25,   28],
    ])

    # Remove a field.
    # This should also remove the display column used by that field, since it is not used
    # by any other fields.
    self.apply_user_action(['RemoveRecord', '_grist_Views_section_field', 4])
    self.assertTableData("_grist_Tables_column", cols="subset", rows=(lambda r: r.id >= 25), data=[
      ["id", "colId", "parentId", "displayCol", "formula"],
      [25, "favorite",       2, 26, ""],
      [26, "gristHelper_Display",  2,  0, "$favorite.show"],
      [27, "gristHelper_Display2", 2,  0, "$favorite.network"],
    ])
    self.assertTableData("_grist_Views_section_field", cols="subset", data=[
      ["id", "colRef", "displayCol"],
      [1,   25,   27],
      [2,   25,    0],
      [3,   25,    0],
    ])

    # Add a new column with a formula.
    self.apply_user_action(['AddVisibleColumn', 'Favorites', 'fav_viewers', {
      'formula': '$favorite.viewers'
    }])
    # Add a field back for the favorites table and set its display formula to the
    # same formula that the new column has. Make sure that the new column is NOT used as
    # the display column.
    self.apply_user_action(['AddRecord', '_grist_Views_section_field', None, {
      'parentId': 3,
      'colRef': 25
    }])
    self.apply_user_action(['SetDisplayFormula', 'Favorites', 8, None, '$favorite.viewers'])
    self.assertTableData("_grist_Tables_column", cols="subset", rows=(lambda r: r.id >= 25), data=[
      ["id", "colId", "parentId", "displayCol", "formula"],
      [25, "favorite",       2, 26, ""],
      [26, "gristHelper_Display",  2,  0, "$favorite.show"],
      [27, "gristHelper_Display2", 2,  0, "$favorite.network"],
      [28, "fav_viewers",    2,  0, "$favorite.viewers"],
      [29, "gristHelper_Display3", 2,  0, "$favorite.viewers"]
    ])
    self.assertTableData("_grist_Views_section_field", cols="subset", data=[
      ["id", "colRef", "displayCol"],
      [1,   25,   27],
      [2,   25,    0],
      [3,   25,    0],
      [4,   28,    0], # fav_viewers field
      [5,   28,    0], # fav_viewers field
      [6,   28,    0], # fav_viewers field
      [7,   28,    0], # re-added field w/ display col
      [8,   25,    29], # fav_viewers field
    ])

    # Change the display formula for a field to be the same as the other field, then remove
    # the field.
    # The display column should not be removed since it is still in use.
    self.apply_user_action(['SetDisplayFormula', 'Favorites', 8, None, '$favorite.network'])
    self.apply_user_action(['RemoveRecord', '_grist_Views_section_field', 8])
    self.assertTableData("_grist_Tables_column", cols="subset", rows=(lambda r: r.id >= 25), data=[
      ["id", "colId", "parentId", "displayCol", "formula"],
      [25, "favorite",      2, 26, ""],
      [26, "gristHelper_Display", 2,  0, "$favorite.show"],
      [27, "gristHelper_Display2",2,  0, "$favorite.network"],
      [28, "fav_viewers",   2,  0, "$favorite.viewers"],
    ])
    self.assertTableData("_grist_Views_section_field", cols="subset", data=[
      ["id", "colRef", "displayCol"],
      [1,   25,   27],
      [2,   25,   0],
      [3,   25,   0],
      [4,   28,   0],
      [5,   28,   0],
      [6,   28,   0],
      [7,   28,   0],
    ])

    # Clear field display formula, then set it again.
    # Clearing the display formula should remove the display column, since it is no longer
    # used by any column or field.
    self.apply_user_action(['SetDisplayFormula', 'Favorites', 1, None, ''])
    self.assertTableData("_grist_Tables_column", cols="subset", rows=(lambda r: r.id >= 25), data=[
      ["id", "colId", "parentId", "displayCol", "formula"],
      [25, "favorite",      2, 26, ""],
      [26, "gristHelper_Display", 2,  0, "$favorite.show"],
      [28, "fav_viewers",   2,  0, "$favorite.viewers"],
    ])
    self.assertTableData("_grist_Views_section_field", cols="subset", data=[
      ["id", "colRef", "displayCol"],
      [1,   25,   0],
      [2,   25,   0],
      [3,   25,   0],
      [4,   28,   0],
      [5,   28,   0],
      [6,   28,   0],
      [7,   28,   0],
    ])
    # Setting the display formula should add another display column.
    self.apply_user_action(['SetDisplayFormula', 'Favorites', 1, None, '$favorite.viewers'])
    self.assertTableData("_grist_Tables_column", cols="subset", rows=(lambda r: r.id >= 25), data=[
      ["id", "colId", "parentId", "displayCol", "formula"],
      [25, "favorite",      2, 26, ""],
      [26, "gristHelper_Display", 2,  0, "$favorite.show"],
      [28, "fav_viewers",   2,  0, "$favorite.viewers"],
      [29, "gristHelper_Display2",2,  0, "$favorite.viewers"],
    ])
    self.assertTableData("_grist_Views_section_field", cols="subset", data=[
      ["id", "colRef", "displayCol"],
      [1,   25,  29],
      [2,   25,   0],
      [3,   25,   0],
      [4,   28,   0],
      [5,   28,   0],
      [6,   28,   0],
      [7,   28,   0],
    ])

    # Change column display formula.
    # This should re-use the current display column since it is only used by the column.
    self.apply_user_action(['SetDisplayFormula', 'Favorites', None, 25, '$favorite.network'])
    self.assertTableData("_grist_Tables_column", cols="subset", rows=(lambda r: r.id >= 25), data=[
      ["id", "colId", "parentId", "displayCol", "formula"],
      [25, "favorite",      2, 26, ""],
      [26, "gristHelper_Display",2,  0, "$favorite.network"],
      [28, "fav_viewers",   2,  0, "$favorite.viewers"],
      [29, "gristHelper_Display2",2,  0, "$favorite.viewers"],
    ])
    self.assertTableData("_grist_Views_section_field", cols="subset", data=[
      ["id", "colRef", "displayCol"],
      [1,   25,  29],
      [2,   25,   0],
      [3,   25,   0],
      [4,   28,   0],
      [5,   28,   0],
      [6,   28,   0],
      [7,   28,   0],
    ])

    # Remove column.
    # This should remove the display column used by the column.
    self.apply_user_action(['RemoveColumn', "Favorites", "favorite"])
    self.assertTableData("_grist_Tables_column", cols="subset", rows=(lambda r: r.id >= 25), data=[
      ["id", "colId", "parentId", "displayCol", "formula"],
      [28, "fav_viewers",   2,  0, "$favorite.viewers"]
    ])
    self.assertTableData("_grist_Views_section_field", cols="subset", data=[
      ["id", "colRef", "displayCol"],
      [4,   28,   0],
      [5,   28,   0],
      [6,   28,   0],
      [7,   28,   0],
    ])


  def test_display_col_removal(self):
    # Test that when removing a column, we don't produce unnecessary calc actions for a display
    # column that may also get auto-removed.

    self.load_sample(self.ref_sample)

    # Create a display column.
    self.apply_user_action(['SetDisplayFormula', 'Television', None, 21, '$show.upper()'])

    # Verify the state of columns and display columns.
    self.assertTableData("_grist_Tables_column", cols="subset", data=[
      ["id",  "colId",                "type", "displayCol", "formula" ],
      [21,    "show",                 "Text", 24          , ""        ],
      [22,    "network",              "Text", 0           , ""        ],
      [23,    "viewers",              "Int",  0           , ""        ],
      [24,    "gristHelper_Display",  "Any",  0           , "$show.upper()"]
    ])
    self.assertTableData("Television", cols="all", data=[
      ["id",  "show"           , "network", "viewers",  "gristHelper_Display"],
      [11,    "Game of Thrones", "HBO"    , 100,        "GAME OF THRONES"],
      [12,    "Narcos"         , "Netflix", 500,        "NARCOS"],
      [13,    "Today"          , "NBC"    , 200,        "TODAY"],
      [14,    "Empire"         , "Fox"    , 300,        "EMPIRE"],
    ])

    # Remove the column that has a displayCol referring to it.
    out_actions = self.apply_user_action(['RemoveColumn', 'Television', 'show'])

    # Verify that the resulting actions don't include any calc actions.
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["BulkRemoveRecord", "_grist_Tables_column", [21, 24]],
        ["RemoveColumn", "Television", "show"],
        ["RemoveColumn", "Television", "gristHelper_Display"],
      ],
      "calc": []
    })

    # Verify the state of columns and display columns afterwards.
    self.assertTableData("_grist_Tables_column", cols="subset", data=[
      ["id",  "colId",                "type", "displayCol", "formula" ],
      [22,    "network",              "Text", 0           , ""        ],
      [23,    "viewers",              "Int",  0           , ""        ],
    ])
    self.assertTableData("Television", cols="all", data=[
      ["id",  "network", "viewers"  ],
      [11,    "HBO"    , 100        ],
      [12,    "Netflix", 500        ],
      [13,    "NBC"    , 200        ],
      [14,    "Fox"    , 300        ],
    ])

  def test_display_col_and_field_removal(self):
    # When there are different displayCols associated with the column and with the field, removal
    # takes more steps, and order of produced actions matters.
    self.load_sample(self.ref_sample)

    # Add a table for people, which includes an associated view.
    self.apply_user_action(['AddTable', 'People', [
      {'id': 'name', 'type': 'Text'},
      {'id': 'favorite', 'type': 'Ref:Television',
       'widgetOptions': '\"{\"alignment\":\"center\",\"visibleCol\":\"show\"}\"'},
    ]])
    self.apply_user_action(['BulkAddRecord', 'People', [1,2,3], {
      'name': ['Bob', 'Jim', 'Don'],
      'favorite': [12, 11, 13]
    }])

    # Add a display formula for the 'favorite' column. A "gristHelper_Display" column with the
    # requested formula should be added and set as the displayCol of the favorite column.
    self.apply_user_action(['SetDisplayFormula', 'People', None, 26, '$favorite.show'])

    # Set display formula for 'favorite' column field.
    # A single "gristHelper_Display2" column should be added with the requested formula.
    self.apply_user_action(['SetDisplayFormula', 'People', 2, None, '$favorite.network'])

    expected_tables1 = [
      Table(1, "Television", 0, 0, columns=[
        Column(21, "show",    "Text", False,  "", 0),
        Column(22, "network", "Text", False,  "", 0),
        Column(23, "viewers", "Int",  False,  "", 0),
      ]),
      Table(2, "People", 1, 0, columns=[
        Column(24, "manualSort", "ManualSortPos", False, "", 0),
        Column(25, "name", "Text", False,  "", 0),
        Column(26, "favorite", "Ref:Television", False,  "", 0),
        Column(27, "gristHelper_Display", "Any", True, "$favorite.show", 0),
        Column(28, "gristHelper_Display2", "Any", True, "$favorite.network", 0)
      ]),
    ]
    expected_data1 = [
      ["id", "name", "favorite", "gristHelper_Display", "gristHelper_Display2"],
      [1,    "Bob",  12,         "Narcos",              "Netflix"],
      [2,    "Jim",  11,         "Game of Thrones",     "HBO"],
      [3,    "Don",  13,         "Today",               "NBC"]
    ]
    self.assertTables(expected_tables1)
    self.assertTableData("People", cols="subset", data=expected_data1)
    self.assertTableData(
      "_grist_Views_section_field", cols="subset", rows=lambda r: r.parentId.parentId, data=[
      ["id", "parentId", "colRef", "displayCol"],
      [1,    1,          25,       0],
      [2,    1,          26,       28],
    ])

    # Now remove the 'favorite' column.
    out_actions = self.apply_user_action(['RemoveColumn', 'People', 'favorite'])

    # The associated field and both displayCols should be gone.
    self.assertTables([
      expected_tables1[0],
      Table(2, "People", 1, 0, columns=[
        Column(24, "manualSort", "ManualSortPos", False, "", 0),
        Column(25, "name", "Text", False,  "", 0),
      ]),
    ])
    self.assertTableData(
      "_grist_Views_section_field", cols="subset", rows=lambda r: r.parentId.parentId, data=[
      ["id", "parentId", "colRef", "displayCol"],
      [1,    1,          25,       0],
    ])

    # Verify that the resulting actions don't include any extraneous calc actions.
    # pylint:disable=line-too-long
    self.assertOutActions(out_actions, {
      "stored": [
        ["BulkRemoveRecord", "_grist_Views_section_field", [2, 4, 6]],
        ["BulkRemoveRecord", "_grist_Tables_column", [26, 27]],
        ["RemoveColumn", "People", "favorite"],
        ["RemoveColumn", "People", "gristHelper_Display"],
        ["RemoveRecord", "_grist_Tables_column", 28],
        ["RemoveColumn", "People", "gristHelper_Display2"],
      ],
      "direct": [True, True, True, True, False, False],
      "undo": [
        ["BulkUpdateRecord", "People", [1, 2, 3], {"gristHelper_Display2": ["Netflix", "HBO", "NBC"]}],
        ["BulkUpdateRecord", "People", [1, 2, 3], {"gristHelper_Display": ["Narcos", "Game of Thrones", "Today"]}],
        ["BulkAddRecord", "_grist_Views_section_field", [2, 4, 6], {"colRef": [26, 26, 26], "displayCol": [28, 0, 0], "parentId": [1, 2, 3], "parentPos": [2.0, 4.0, 6.0]}],
        ["BulkAddRecord", "_grist_Tables_column", [26, 27], {"colId": ["favorite", "gristHelper_Display"], "displayCol": [27, 0], "formula": ["", "$favorite.show"], "isFormula": [False, True], "label": ["favorite", "gristHelper_Display"], "parentId": [2, 2], "parentPos": [6.0, 7.0], "type": ["Ref:Television", "Any"], "widgetOptions": ["\"{\"alignment\":\"center\",\"visibleCol\":\"show\"}\"", ""]}],
        ["BulkUpdateRecord", "People", [1, 2, 3], {"favorite": [12, 11, 13]}],
        ["AddColumn", "People", "favorite", {"formula": "", "isFormula": False, "type": "Ref:Television"}],
        ["AddColumn", "People", "gristHelper_Display", {"formula": "$favorite.show", "isFormula": True, "type": "Any"}],
        ["AddRecord", "_grist_Tables_column", 28, {"colId": "gristHelper_Display2", "formula": "$favorite.network", "isFormula": True, "label": "gristHelper_Display2", "parentId": 2, "parentPos": 8.0, "type": "Any"}],
        ["AddColumn", "People", "gristHelper_Display2", {"formula": "$favorite.network", "isFormula": True, "type": "Any"}],
      ],
    })

    # Now undo; expect the structure and values restored.
    stored_actions = out_actions.get_repr()["stored"]
    undo_actions = out_actions.get_repr()["undo"]
    out_actions = self.apply_user_action(['ApplyUndoActions', undo_actions])
    self.assertTables(expected_tables1)
    self.assertTableData("People", cols="subset", data=expected_data1)
    self.assertTableData(
      "_grist_Views_section_field", cols="subset", rows=lambda r: r.parentId.parentId, data=[
      ["id", "parentId", "colRef", "displayCol"],
      [1,    1,          25,       0],
      [2,    1,          26,       28],
    ])

    self.assertPartialOutActions(out_actions, {
      "stored": reversed(undo_actions),
    })

  def test_display_col_copying(self):
    # Test that when switching types and using CopyFromColumn, displayCol is set/unset correctly.

    self.load_sample(self.ref_sample)

    # Add a new table for People so that we get the associated views and fields.
    self.apply_user_action(['AddTable', 'Favorites', [
      {'id': 'favorite', 'type': 'Ref:Television'},
      {'id': 'favorite2', 'type': 'Text'}]])
    self.apply_user_action(['BulkAddRecord', 'Favorites', [1,2,3,4,5], {
      'favorite': [2, 4, 1, 4, 3]
    }])

    # Set a displayCol.
    self.apply_user_action(['SetDisplayFormula', 'Favorites', None, 25, '$favorite.show'])
    self.assertTableData("_grist_Tables_column", cols="subset", rows=(lambda r: r.id > 24), data=[
      ["id" , "colId"               , "parentId", "displayCol", "type",   "formula"],
      [25   , "favorite"            , 2         , 27          , "Ref:Television", ""],
      [26   , "favorite2"           , 2         , 0           , "Text",   ""],
      [27   , "gristHelper_Display" , 2         , 0           , "Any",    "$favorite.show"],
    ])

    # Copy 'favorite' to 'favorite2': displayCol should be set on the latter.
    self.apply_user_action(['CopyFromColumn', 'Favorites', 'favorite', 'favorite2', None])
    self.assertTableData("_grist_Tables_column", cols="subset", rows=(lambda r: r.id > 24), data=[
      ["id" , "colId"               , "parentId", "displayCol", "type",   "formula"],
      [25   , "favorite"            , 2         , 27          , "Ref:Television", ""],
      [26   , "favorite2"           , 2         , 28          , "Ref:Television", ""],
      [27   , "gristHelper_Display" , 2         , 0           , "Any",    "$favorite.show"],
      [28   , "gristHelper_Display2", 2         , 0           , "Any",    "$favorite2.show"],
    ])

    # SetDisplyFormula to a different formula: displayCol should get reused.
    self.apply_user_action(['SetDisplayFormula', 'Favorites', None, 25, '$favorite.network'])
    self.assertTableData("_grist_Tables_column", cols="subset", rows=(lambda r: r.id > 24), data=[
      ["id" , "colId"               , "parentId", "displayCol", "type",   "formula"],
      [25   , "favorite"            , 2         , 27          , "Ref:Television", ""],
      [26   , "favorite2"           , 2         , 28          , "Ref:Television", ""],
      [27   , "gristHelper_Display" , 2         , 0           , "Any",    "$favorite.network"],
      [28   , "gristHelper_Display2", 2         , 0           , "Any",    "$favorite2.show"],
    ])

    # Copy again; the destination displayCol should get adjusted but reused.
    self.apply_user_action(['CopyFromColumn', 'Favorites', 'favorite', 'favorite2', None])
    self.assertTableData("_grist_Tables_column", cols="subset", rows=(lambda r: r.id > 24), data=[
      ["id" , "colId"               , "parentId", "displayCol", "type",   "formula"],
      [25   , "favorite"            , 2         , 27          , "Ref:Television", ""],
      [26   , "favorite2"           , 2         , 28          , "Ref:Television", ""],
      [27   , "gristHelper_Display" , 2         , 0           , "Any",    "$favorite.network"],
      [28   , "gristHelper_Display2", 2         , 0           , "Any",    "$favorite2.network"],
    ])

    # If we change column type, the displayCol should get unset and deleted.
    out_actions = self.apply_user_action(['ModifyColumn', 'Favorites', 'favorite',
                                          {'type': 'Numeric'}])
    self.assertTableData("_grist_Tables_column", cols="subset", rows=(lambda r: r.id > 24), data=[
      ["id" , "colId"               , "parentId", "displayCol", "type",           "formula"],
      [25   , "favorite"            , 2         , 0           , "Numeric",        ""],
      [26   , "favorite2"           , 2         , 28          , "Ref:Television", ""],
      [28   , "gristHelper_Display2", 2         , 0           , "Any",    "$favorite2.network"],
    ])

    # Copy again; the destination displayCol should now get deleted too.
    self.apply_user_action(['CopyFromColumn', 'Favorites', 'favorite', 'favorite2', None])
    self.assertTableData("_grist_Tables_column", cols="subset", rows=(lambda r: r.id > 24), data=[
      ["id" , "colId"               , "parentId", "displayCol", "type",      "formula"],
      [25   , "favorite"            , 2         , 0           , "Numeric",   ""],
      [26   , "favorite2"           , 2         , 0           , "Numeric",   ""],
    ])

  def test_display_col_table_rename(self):
    self.load_sample(self.ref_sample)

    # Add a table for people to get an associated view.
    self.apply_user_action(['AddTable', 'People', [
      {'id': 'name', 'type': 'Text'},
      {'id': 'favorite', 'type': 'Ref:Television',
       'widgetOptions': '\"{\"alignment\":\"center\",\"visibleCol\":\"show\"}\"'},
      {'id': 'network', 'type': 'Any', 'isFormula': True,
       'formula': 'Television.lookupOne(show=rec.favorite.show).network'}]])
    self.apply_user_action(['BulkAddRecord', 'People', [1,2,3], {
      'name': ['Bob', 'Jim', 'Don'],
      'favorite': [12, 11, 13]
    }])

    # Add a display formula for the 'favorite' column.
    # A "gristHelper_Display" column with the requested formula should be added and set as the
    # displayCol of the favorite column.
    self.apply_user_action(['SetDisplayFormula', 'People', None, 26, '$favorite.show'])

    # Set display formula for 'favorite' column field.
    # A single "gristHelper_Display2" column should be added with the requested formula.
    self.apply_user_action(['SetDisplayFormula', 'People', 1, None, '$favorite.network'])

    # Check that the tables are set up as expected.
    self.assertTables([
      Table(1, "Television", 0, 0, columns=[
        Column(21, "show",    "Text", False,  "", 0),
        Column(22, "network", "Text", False,  "", 0),
        Column(23, "viewers", "Int",  False,  "", 0),
      ]),
      Table(2, "People", 1, 0, columns=[
        Column(24, "manualSort", "ManualSortPos", False, "", 0),
        Column(25, "name", "Text", False,  "", 0),
        Column(26, "favorite", "Ref:Television", False,  "", 0),
        Column(27, "network", "Any", True,
          "Television.lookupOne(show=rec.favorite.show).network", 0),
        Column(28, "gristHelper_Display", "Any", True, "$favorite.show", 0),
        Column(29, "gristHelper_Display2", "Any", True, "$favorite.network", 0)
      ]),
    ])
    self.assertTableData("People", cols="subset", data=[
      ["id", "name", "favorite", "network"],
      [1,    "Bob",  12,         "Netflix"],
      [2,    "Jim",  11,         "HBO"],
      [3,    "Don",  13,         "NBC"]
    ])
    self.assertTableData("_grist_Tables_column", cols="subset", rows=(lambda r: r.parentId.id == 2),
    data=[
      ["id", "colId",                "parentId", "displayCol", "formula"],
      [24,   "manualSort",           2,          0,            ""],
      [25,   "name",                 2,          0,            ""],
      [26,   "favorite",             2,          28,           ""],
      [27,   "network",              2,          0,
        "Television.lookupOne(show=rec.favorite.show).network"],
      [28,   "gristHelper_Display",  2,          0,            "$favorite.show"],
      [29,   "gristHelper_Display2", 2,          0,            "$favorite.network"]
    ])
    self.assertTableData(
      "_grist_Views_section_field", cols="subset", rows=lambda r: r.parentId.parentId, data=[
      ["id", "colRef", "displayCol"],
      [1,    25,       29],
      [2,    26,       0],
      [3,    27,       0]
    ])

    # Rename the referenced table.
    out_actions = self.apply_user_action(['RenameTable', 'Television', 'Television2'])

    # Verify the resulting actions.
    # This tests a bug fix where table renames would cause widgetOptions and displayCols
    # of columns referencing the renamed table to be unset. See https://phab.getgrist.com/T206.
    # Ensure that no actions are generated to unset the widgetOptions and the displayCols of the
    # field or column.
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["ModifyColumn", "People", "favorite", {"type": "Int"}],
        ["RenameTable", "Television", "Television2"],
        ["UpdateRecord", "_grist_Tables", 1, {"tableId": "Television2"}],
        ["ModifyColumn", "People", "favorite", {"type": "Ref:Television2"}],
        ["ModifyColumn", "People", "network",
          {"formula": "Television2.lookupOne(show=rec.favorite.show).network"}],
        ["BulkUpdateRecord", "_grist_Tables_column", [26, 27], {
          "formula": ["", "Television2.lookupOne(show=rec.favorite.show).network"],
          "type": ["Ref:Television2", "Any"]
        }]
      ],
      "calc": []
    })

    # Verify that the tables have responded as expected to the change.
    self.assertTables([
      Table(1, "Television2", 0, 0, columns=[
        Column(21, "show",    "Text", False,  "", 0),
        Column(22, "network", "Text", False,  "", 0),
        Column(23, "viewers", "Int",  False,  "", 0),
      ]),
      Table(2, "People", 1, 0, columns=[
        Column(24, "manualSort", "ManualSortPos", False, "", 0),
        Column(25, "name", "Text", False,  "", 0),
        Column(26, "favorite", "Ref:Television2", False,  "", 0),
        Column(27, "network", "Any", True,
          "Television2.lookupOne(show=rec.favorite.show).network", 0),
        Column(28, "gristHelper_Display", "Any", True, "$favorite.show", 0),
        Column(29, "gristHelper_Display2", "Any", True, "$favorite.network", 0)
      ]),
    ])
    self.assertTableData("People", cols="subset", data=[
      ["id", "name", "favorite", "network"],
      [1,    "Bob",  12,         "Netflix"],
      [2,    "Jim",  11,         "HBO"],
      [3,    "Don",  13,         "NBC"]
    ])
    self.assertTableData("_grist_Tables_column", cols="subset", rows=(lambda r: r.parentId.id == 2),
    data=[
      ["id", "colId",                "parentId", "displayCol", "formula"],
      [24,   "manualSort",           2,          0,            ""],
      [25,   "name",                 2,          0,            ""],
      [26,   "favorite",             2,          28,           ""],
      [27,   "network",              2,          0,
        "Television2.lookupOne(show=rec.favorite.show).network"],
      [28,   "gristHelper_Display",  2,          0,            "$favorite.show"],
      [29,   "gristHelper_Display2", 2,          0,            "$favorite.network"]
    ])
    self.assertTableData(
      "_grist_Views_section_field", cols="subset", rows=lambda r: r.parentId.parentId, data=[
      ["id", "colRef", "displayCol"],
      [1,    25,       29],
      [2,    26,       0],
      [3,    27,       0]
    ])
