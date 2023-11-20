# pylint: disable=line-too-long
import logging
import test_engine

log = logging.getLogger(__name__)


class TestImportActions(test_engine.EngineTestCase):
  def init_state(self):
    # Add source table
    self.apply_user_action(['AddTable', 'Source', [{'id': 'Name', 'type': 'Text'},
                                                {'id': 'City', 'type': 'Text'},
                                                {'id': 'Zip', 'type': 'Int'}]])
    self.apply_user_action(['BulkAddRecord', 'Source', [1, 2], {'Name': ['John', 'Alison'],
                                                                'City': ['New York', 'Boston'],
                                                                'Zip': [3011, 7003]}])
    self.assertTableData('_grist_Tables_column', cols="subset", data=[
      ["id",  "colId",      "type",           "isFormula",  "formula"],
      [1,     "manualSort", "ManualSortPos",  False,        ""],
      [2,     "Name",       "Text",           False,        ""],
      [3,     "City",       "Text",           False,        ""],
      [4,     "Zip",        "Int",            False,        ""],
    ], rows=lambda r: r.parentId.id == 1)

    # Add destination table which contains columns corresponding to source table
    self.apply_user_action(['AddTable', 'Destination1', [{'id': 'Name', 'type': 'Text'},
                                                        {'id': 'City', 'type': 'Text'}]])
    self.apply_user_action(['BulkAddRecord', 'Destination1', [1, 2], {'Name': ['Bob'],
                                                                    'City': ['New York']}])
    self.assertTableData('_grist_Tables_column', cols="subset", data=[
      ["id",  "colId",      "type",           "isFormula",  "formula"],
      [5,     "manualSort", "ManualSortPos",  False,        ""],
      [6,     "Name",       "Text",           False,        ""],
      [7,     "City",       "Text",           False,        ""],
    ], rows=lambda r: r.parentId.id == 2)

    # Add destination table which has no columns corresponding to source table
    self.apply_user_action(['AddTable', 'Destination2', [{'id': 'State', 'type': 'Text'}]])
    self.apply_user_action(['BulkAddRecord', 'Destination2', [1, 2], {'State': ['NY']}])
    self.assertTableData('_grist_Tables_column', cols="subset", data=[
      ["id",  "colId",      "type",           "isFormula",  "formula"],
      [8,     "manualSort", "ManualSortPos",  False,        ""],
      [9,     "State",      "Text",           False,        ""]
    ], rows=lambda r: r.parentId.id == 3)

    # Verify created tables
    self.assertPartialData("_grist_Tables", ["id", "tableId"], [
      [1, "Source"],
      [2, "Destination1"],
      [3, "Destination2"],
    ])

    # Verify created sections
    self.assertPartialData("_grist_Views_section", ["id", "tableRef", 'fields'], [
      [1, 1, [1, 2, 3]],  # section for "Source" table
      [2, 1, [4, 5, 6]],  # section for "Source" table
      [3, 1, [7, 8, 9]],  # section for "Source" table
      [4, 2, [10, 11]],   # section for "Destination1" table
      [5, 2, [12, 13]],   # section for "Destination1" table
      [6, 2, [14, 15]],   # section for "Destination1" table
      [7, 3, [16]],       # section for "Destination2" table
      [8, 3, [17]],       # section for "Destination2" table
      [9, 3, [18]],       # section for "Destination2" table
    ])

  def test_transform(self):
    # Add source and destination tables
    self.init_state()

    # Update transform while importing to destination table which have
    # columns with the same names as source
    self.apply_user_action(['GenImporterView', 'Source', 'Destination1', None, {}])

    # Verify the new structure of source table and sections
    # (two columns with special names were added)
    self.assertTableData('_grist_Tables_column', cols="subset", data=[
      ["id",  "colId",                    "type",           "isFormula",  "formula"],
      [1,     "manualSort",               "ManualSortPos",  False,        ""],
      [2,     "Name",                     "Text",           False,        ""],
      [3,     "City",                     "Text",           False,        ""],
      [4,     "Zip",                      "Int",            False,        ""],
      [10,    "gristHelper_Import_Name",  "Text",           True,         "$Name"],
      [11,    "gristHelper_Import_City",  "Text",           True,         "$City"],
    ], rows=lambda r: r.parentId.id == 1)

    self.assertTableData('Source', cols="all", data=[
      ["id",  "Name",   "City",     "Zip",  "gristHelper_Import_Name", "gristHelper_Import_City", "manualSort"],
      [1,     "John",   "New York", 3011,  "John",                    "New York",                1.0],
      [2,     "Alison", "Boston",   7003,  "Alison",                  "Boston",                  2.0],
    ])

    self.assertPartialData("_grist_Views_section", ["id", "tableRef", 'fields'], [
      [1, 1, [1, 2, 3]],
      [2, 1, [4, 5, 6]],
      [3, 1, [7, 8, 9]],
      [4, 2, [10, 11]],
      [5, 2, [12, 13]],
      [6, 2, [14, 15]],
      [7, 3, [16]],
      [8, 3, [17]],
      [9, 3, [18]],
      [10, 1, [19, 20]],  # new section for transform preview
    ])

    # Apply useraction again to verify that old columns and sections are removing
    # Update transform while importing to destination table which has no common columns with source
    self.apply_user_action(['GenImporterView', 'Source', 'Destination2', None, {}])

    # Verify the new structure of source table and sections (old special columns were removed
    # and one new columns with empty formula were added)
    self.assertTableData('_grist_Tables_column', cols="subset", data=[
      ["id",  "colId",                    "type",           "isFormula",  "formula"],
      [1,     "manualSort",               "ManualSortPos",  False,        ""],
      [2,     "Name",                     "Text",           False,        ""],
      [3,     "City",                     "Text",           False,        ""],
      [4,     "Zip",                      "Int",            False,        ""],
      [10,    "gristHelper_Import_State", "Text",           True,         ""]
    ], rows=lambda r: r.parentId.id == 1)

    self.assertTableData('Source', cols="all", data=[
      ["id",  "Name",   "City",     "Zip",  "gristHelper_Import_State", "manualSort"],
      [1,     "John",   "New York", 3011,  "",                         1.0],
      [2,     "Alison", "Boston",   7003,  "",                         2.0],
    ])
    self.assertPartialData("_grist_Views_section", ["id", "tableRef", 'fields'], [
      [1,  1, [1, 2, 3]],
      [2,  1, [4, 5, 6]],
      [3,  1, [7, 8, 9]],
      [4,  2, [10, 11]],
      [5,  2, [12, 13]],
      [6,  2, [14, 15]],
      [7,  3, [16]],
      [8,  3, [17]],
      [9,  3, [18]],
      [10, 1, [19]], # new section for transform preview
    ])


  def test_regenerate_importer_view(self):
    # Generate without a destination table, and then with one. Ensure that we don't omit the
    # actions needed to populate the table in the second call.
    self.init_state()
    self.apply_user_action(['GenImporterView', 'Source', None, None, {}])
    out_actions = self.apply_user_action(['GenImporterView', 'Source', 'Destination1', None, {}])
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["BulkRemoveRecord", "_grist_Views_section_field", [19, 20, 21]],
        ["RemoveRecord", "_grist_Views_section", 10],
        ["BulkRemoveRecord", "_grist_Tables_column", [10, 11, 12]],
        ["RemoveColumn", "Source", "gristHelper_Import_Name"],
        ["RemoveColumn", "Source", "gristHelper_Import_City"],
        ["RemoveColumn", "Source", "gristHelper_Import_Zip"],
        ["AddColumn", "Source", "gristHelper_Import_Name", {"formula": "$Name", "isFormula": True, "type": "Text"}],
        ["AddRecord", "_grist_Tables_column", 10, {"colId": "gristHelper_Import_Name", "formula": "$Name", "isFormula": True, "label": "Name", "parentId": 1, "parentPos": 10.0, "type": "Text", "widgetOptions": ""}],
        ["AddColumn", "Source", "gristHelper_Import_City", {"formula": "$City", "isFormula": True, "type": "Text"}],
        ["AddRecord", "_grist_Tables_column", 11, {"colId": "gristHelper_Import_City", "formula": "$City", "isFormula": True, "label": "City", "parentId": 1, "parentPos": 11.0, "type": "Text", "widgetOptions": ""}],
        ["AddRecord", "_grist_Views_section", 10, {"borderWidth": 1, "defaultWidth": 100, "parentKey": "record", "sortColRefs": "[]", "tableRef": 1}],
        ["BulkAddRecord", "_grist_Views_section_field", [19, 20], {"colRef": [10, 11], "parentId": [10, 10], "parentPos": [19.0, 20.0]}],
        # The actions to populate the removed and re-added columns should be there.
        ["BulkUpdateRecord", "Source", [1, 2], {"gristHelper_Import_City": ["New York", "Boston"]}],
        ["BulkUpdateRecord", "Source", [1, 2], {"gristHelper_Import_Name": ["John", "Alison"]}],
      ],
      "calc": []
    })


  def test_transform_destination_new_table(self):
    # Add source and destination tables
    self.init_state()

    # Update transform while importing to destination table which is "New Table"
    self.apply_user_action(['GenImporterView', 'Source', None, None, {}])

    # Verify the new structure of source table and sections (old special columns were removed
    # and three new columns, which are the same as in source table were added)
    self.assertTableData('_grist_Tables_column', cols="subset", data=[
      ["id",  "colId",                    "type",           "isFormula",  "formula"],
      [1,     "manualSort",               "ManualSortPos",  False,        ""],
      [2,     "Name",                     "Text",           False,        ""],
      [3,     "City",                     "Text",           False,        ""],
      [4,     "Zip",                      "Int",            False,        ""],
      [10,    "gristHelper_Import_Name",  "Text",           True,         "$Name"],
      [11,    "gristHelper_Import_City",  "Text",           True,         "$City"],
      [12,    "gristHelper_Import_Zip",   "Int",            True,         "$Zip"],
    ], rows=lambda r: r.parentId.id == 1)

    self.assertTableData('Source', cols="all", data=[
      ["id",  "Name",   "City",     "Zip",  "gristHelper_Import_Name", "gristHelper_Import_City", "gristHelper_Import_Zip", "manualSort"],
      [1,     "John",   "New York", 3011,  "John",                    "New York",                3011,                    1.0],
      [2,     "Alison", "Boston",   7003,  "Alison",                  "Boston",                  7003,                    2.0],
    ])
    self.assertPartialData("_grist_Views_section", ["id", "tableRef", 'fields'], [
      [1,  1, [1, 2, 3]],
      [2,  1, [4, 5, 6]],
      [3,  1, [7, 8, 9]],
      [4,  2, [10, 11]],
      [5,  2, [12, 13]],
      [6,  2, [14, 15]],
      [7,  3, [16]],
      [8,  3, [17]],
      [9,  3, [18]],
      [10, 1, [19, 20, 21]],  # new section for transform preview
    ])
