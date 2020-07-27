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
    self.apply_user_action(['TransformAndFinishImport', 'Hidden_table', 'NewTable', True, self.TEMP_transform_rule_no_colids])

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
