# pylint: disable=line-too-long
import logger
import test_engine

log = logger.Logger(__name__, logger.INFO)


#TODO: test naming (basics done, maybe check numbered column renaming)
#TODO: check autoimport into existing table (match up column names)


class TestImportTransform(test_engine.EngineTestCase):
  def init_state(self):
    # Add source table
    self.apply_user_action(['AddTable', 'Hidden_table', [
      {'id': 'fname',                         'type': 'Text'},
      {'id': 'mname',                         'type': 'Text'},
      {'id': 'lname',                         'type': 'Text'},
    ]])
    self.apply_user_action(['BulkAddRecord', 'Hidden_table', [1, 2], {'fname': ['Carry', 'Don'],
                                                                      'mname': ['M.', 'B.'],
                                                                      'lname': ['Jonson', "Yoon"]
                                                                      }])
    self.assertTableData('_grist_Tables_column', cols="subset", data=[
      ["id",  "colId",                          "type",           "isFormula",  "formula"],
      [1,     "manualSort",                     "ManualSortPos",  False,        ""],
      [2,     "fname",                          "Text",           False,        ""],
      [3,     "mname",                          "Text",           False,        ""],
      [4,     "lname",                          "Text",           False,        ""],
    ], rows=lambda r: r.parentId.id == 1)



    #Filled in colids for existing table
    self.TEMP_transform_rule_colids = {
        "destCols": [
            { "colId": "First_Name", "label": "First Name",
              "type": "Text",       "formula": "$fname" },
            { "colId": "Last_Name",  "label": "Last Name",
              "type": "Text",       "formula": "$lname" },
            { "colId": "Middle_Initial", "label": "Middle Initial",
              "type": "Text",       "formula": "$mname[0]" },
            #{ "colId": "Blank",     "label": "Blank", //destination1 has no blank column
            #  "type": "Text",       "formula": "" },
        ]
    }

    #Then try it with blank in colIds (for new tables)
    self.TEMP_transform_rule_no_colids = {
        "destCols": [
            { "colId": None,  "label": "First Name",
              "type": "Text",       "formula": "$fname" },
            { "colId": None,  "label": "Last Name",
              "type": "Text",       "formula": "$lname" },
            { "colId": None,  "label": "Middle Initial",
              "type": "Text",       "formula": "$mname[0]" },
            { "colId": None,  "label": "Blank",
              "type": "Text",       "formula": "" },
        ]
    }


    # Add destination table which contains columns corresponding to source table with different names
    self.apply_user_action(['AddTable', 'Destination1', [
        {'label': 'First Name',     'id': 'First_Name',  'type': 'Text'},
        {'label': 'Last Name',      'id': 'Last_Name',   'type': 'Text'},
        {'label': 'Middle Initial', 'id': 'Middle_Initial', 'type': 'Text'}]])
    self.apply_user_action(['BulkAddRecord', 'Destination1', [1], {'First_Name': ['Bob'],
                                                                    'Last_Name': ['Nike'],
                                                                    'Middle_Initial': ['F.']}])

    self.assertTableData('_grist_Tables_column', cols="subset", data=[
      ["id",  "colId",      "type",           "isFormula",  "formula"],
      [5,     "manualSort", "ManualSortPos",  False,        ""],
      [6,     "First_Name", "Text",           False,        ""],
      [7,     "Last_Name",  "Text",           False,        ""],
      [8,     "Middle_Initial","Text",           False,        ""],
    ], rows=lambda r: r.parentId.id == 2)

    # Verify created tables
    self.assertPartialData("_grist_Tables", ["id", "tableId"], [
      [1, "Hidden_table"],
      [2, "Destination1"]
    ])



  def test_finish_import_into_new_table(self):
    # Add source and destination tables
    self.init_state()

    #into_new_table = True, transform_rule : no colids (will be generated for new table)
    out_actions = self.apply_user_action(
        ['TransformAndFinishImport', 'Hidden_table', 'NewTable', True, self.TEMP_transform_rule_no_colids])
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["AddColumn", "Hidden_table", "gristHelper_Import_Middle_Initial", {"formula": "$mname[0]", "isFormula": True, "type": "Text"}],
        ["AddRecord", "_grist_Tables_column", 9, {"colId": "gristHelper_Import_Middle_Initial", "formula": "$mname[0]", "isFormula": True, "label": "Middle Initial", "parentId": 1, "parentPos": 9.0, "type": "Text", "widgetOptions": ""}],
        ["BulkRemoveRecord", "_grist_Views_section_field", [1, 2, 3]],
        ["RemoveRecord", "_grist_Views_section", 1],
        ["RemoveRecord", "_grist_TabBar", 1],
        ["RemoveRecord", "_grist_Pages", 1],
        ["RemoveRecord", "_grist_Views", 1],
        ["UpdateRecord", "_grist_Tables", 1, {"primaryViewId": 0}],
        ["BulkRemoveRecord", "_grist_Tables_column", [1, 2, 3, 4, 9]],
        ["RemoveRecord", "_grist_Tables", 1],
        ["RemoveTable", "Hidden_table"],
        ["AddTable", "NewTable", [{"formula": "", "id": "manualSort", "isFormula": False, "type": "ManualSortPos"}, {"formula": "", "id": "First_Name", "isFormula": False, "type": "Text"}, {"formula": "", "id": "Last_Name", "isFormula": False, "type": "Text"}, {"formula": "", "id": "Middle_Initial", "isFormula": False, "type": "Text"}, {"formula": "", "id": "Blank", "isFormula": False, "type": "Text"}]],
        ["AddRecord", "_grist_Tables", 3, {"primaryViewId": 0, "tableId": "NewTable"}],
        ["BulkAddRecord", "_grist_Tables_column", [9, 10, 11, 12, 13], {"colId": ["manualSort", "First_Name", "Last_Name", "Middle_Initial", "Blank"], "formula": ["", "", "", "", ""], "isFormula": [False, False, False, False, False], "label": ["manualSort", "First Name", "Last Name", "Middle Initial", "Blank"], "parentId": [3, 3, 3, 3, 3], "parentPos": [9.0, 10.0, 11.0, 12.0, 13.0], "type": ["ManualSortPos", "Text", "Text", "Text", "Text"], "widgetOptions": ["", "", "", "", ""]}],
        ["AddRecord", "_grist_Views", 3, {"name": "NewTable", "type": "raw_data"}],
        ["AddRecord", "_grist_TabBar", 3, {"tabPos": 3.0, "viewRef": 3}],
        ["AddRecord", "_grist_Pages", 3, {"indentation": 0, "pagePos": 3.0, "viewRef": 3}],
        ["AddRecord", "_grist_Views_section", 3, {"borderWidth": 1, "defaultWidth": 100, "parentId": 3, "parentKey": "record", "sortColRefs": "[]", "tableRef": 3, "title": ""}],
        ["BulkAddRecord", "_grist_Views_section_field", [7, 8, 9, 10], {"colRef": [10, 11, 12, 13], "parentId": [3, 3, 3, 3], "parentPos": [7.0, 8.0, 9.0, 10.0]}],
        ["UpdateRecord", "_grist_Tables", 3, {"primaryViewId": 3}],
        ["BulkAddRecord", "NewTable", [1, 2], {"First_Name": ["Carry", "Don"], "Last_Name": ["Jonson", "Yoon"], "Middle_Initial": ["M", "B"], "manualSort": [1.0, 2.0]}],
      ]
    })

    #1-4 in hidden table, 5-8 in destTable, 9-13 for new table
    self.assertTableData('_grist_Tables_column', cols="subset", data=[
      ["id",  "colId",          "type",           "isFormula",  "formula"],
      [ 9,    "manualSort",     "ManualSortPos",  False,        ""],
      [10,    "First_Name",     "Text",           False,        ""],
      [11,    "Last_Name",      "Text",           False,        ""],
      [12,    "Middle_Initial", "Text",           False,        ""],
      [13,    "Blank",          "Text",           False,        ""],
    ], rows=lambda r: r.parentId.id == 3)

    self.assertTableData('NewTable', cols="all", data=[
      ["id",  "First_Name",   "Last_Name", "Middle_Initial",  "Blank",  "manualSort"],
      [1,     "Carry",        "Jonson",    "M",               "",       1.0],
      [2,     "Don",          "Yoon",      "B",               "",       2.0]
    ])


    # Verify removed hidden table and add the new one
    self.assertPartialData("_grist_Tables", ["id", "tableId"], [
      [2, "Destination1"],
      [3, "NewTable"]
    ])

  def test_finish_import_into_existing_table(self):


    # Add source and destination tables
    self.init_state()

    #into_new_table false, transform_rule=null
    self.apply_user_action(['TransformAndFinishImport', 'Hidden_table', 'Destination1', False, self.TEMP_transform_rule_colids])

    #1-4 in hidden table, 5-8 in destTable
    self.assertTableData('_grist_Tables_column', cols="subset", data=[
      ["id",  "colId",          "type",           "isFormula",  "formula"],
      [5,     "manualSort",     "ManualSortPos",  False,        ""],
      [6,     "First_Name",     "Text",           False,        ""],
      [7,     "Last_Name",      "Text",           False,        ""],
      [8,     "Middle_Initial", "Text",           False,        ""],
    ], rows=lambda r: r.parentId.id == 2)

    self.assertTableData('Destination1', cols="all", data=[
      ["id",  "First_Name", "Last_Name",  "Middle_Initial",  "manualSort"],
      [1,     "Bob",        "Nike",       "F.",              1.0], #F. was there to begin with
      [2,     "Carry",      "Jonson",     "M",               2.0], #others imported with $mname[0]
      [3,     "Don",        "Yoon",       "B",               3.0],
    ])

    # Verify removed hidden table
    self.assertPartialData("_grist_Tables", ["id", "tableId"], [[2, "Destination1"]])

  #does the same thing using a blank transform rule
  def test_finish_import_into_new_table_blank(self):
    # Add source and destination tables
    self.init_state()

    #into_new_table = True, transform_rule : no colids (will be generated for new table)
    self.apply_user_action(['TransformAndFinishImport', 'Hidden_table', 'NewTable', True, None])

    #1-4 in src table, 5-8 in hiddentable
    self.assertTableData('_grist_Tables_column', cols="subset", data=[
      ["id",  "colId",          "type",           "isFormula",  "formula"],
      [9,     "manualSort",     "ManualSortPos",  False,        ""],
      [10,    "fname",          "Text",           False,        ""],
      [11,    "mname",          "Text",           False,        ""],
      [12,    "lname",          "Text",           False,        ""],
    ], rows=lambda r: r.parentId.id == 3)

    self.assertTableData('NewTable', cols="all", data=[
      ["id",  "fname",        "lname",      "mname",      "manualSort"],
      [1,     "Carry",        "Jonson",     "M.",         1.0],
      [2,     "Don",          "Yoon",       "B.",         2.0]
    ])


    # Verify removed hidden table and add the new one
    self.assertPartialData("_grist_Tables", ["id", "tableId"], [
      [2, "Destination1"],
      [3, "NewTable"]
    ])
