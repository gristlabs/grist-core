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
      {'id': 'employee_id',                   'type': 'Int'},
      {'id': 'fname',                         'type': 'Text'},
      {'id': 'mname',                         'type': 'Text'},
      {'id': 'lname',                         'type': 'Text'},
      {'id': 'email',                         'type': 'Text'},
    ]])
    self.apply_user_action(['BulkAddRecord', 'Hidden_table', [1, 2, 3, 4, 5, 6, 7], {
      'employee_id': [1, 2, 3, 4, 5, 6, 7],
      'fname': ['Bob', 'Carry', 'Don', 'Amir', 'Ken', 'George', 'Barbara'],
      'mname': ['F.', None, 'B.', '', 'C.', '', 'D.'],
      'lname': ['Nike', 'Jonson', "Yoon", "Greene", "Foster", "Huang", "Kinney"],
      'email': [
        'bob@example.com', None, "don@example.com", "amir@example.com",
        "ken@example.com", "", "barbara@example.com"
      ]
    }])
    self.assertTableData('_grist_Tables_column', cols="subset", data=[
      ["id",  "colId",                          "type",           "isFormula",  "formula"],
      [1,     "manualSort",                     "ManualSortPos",  False,        ""],
      [2,     "employee_id",                    "Int",            False,        ""],
      [3,     "fname",                          "Text",           False,        ""],
      [4,     "mname",                          "Text",           False,        ""],
      [5,     "lname",                          "Text",           False,        ""],
      [6,     "email",                          "Text",           False,        ""],
    ], rows=lambda r: r.parentId.id == 1)

    #Filled in colids for existing table
    self.TEMP_transform_rule_colids = {
      "destCols": [
        { "colId": "Employee_ID",    "label": "Employee ID",
          "type": "Int",             "formula": "$employee_id" },
        { "colId": "First_Name",     "label": "First Name",
          "type": "Text",            "formula": "$fname" },
        { "colId": "Last_Name",      "label": "Last Name",
          "type": "Text",            "formula": "$lname" },
        { "colId": "Middle_Initial", "label": "Middle Initial",
          "type": "Text",            "formula": "$mname[0] if $mname else ''" },
        { "colId": "Email",          "label": "Email",
          "type": "Text",            "formula": "$email" },
        #{ "colId": "Blank",          "label": "Blank", // Destination1 has no blank column
        #  "type": "Text",            "formula": "" },
      ]
    }

    #Then try it with blank in colIds (for new tables)
    self.TEMP_transform_rule_no_colids = {
      "destCols": [
        { "colId": None,        "label": "Employee ID",
          "type": "Int",        "formula": "$employee_id" },
        { "colId": None,        "label": "First Name",
          "type": "Text",       "formula": "$fname" },
        { "colId": None,        "label": "Last Name",
          "type": "Text",       "formula": "$lname" },
        { "colId": None,        "label": "Middle Initial",
          "type": "Text",       "formula": "$mname[0] if $mname else ''" },
        { "colId": None,        "label": "Email",
          "type": "Text",       "formula": "$email" },
        { "colId": None,        "label": "Blank",
          "type": "Text",       "formula": "" },
      ]
    }

    # Add destination table which contains columns corresponding to source table with different names
    self.apply_user_action(['AddTable', 'Destination1', [
      {'label': 'Employee ID',    'id': 'Employee_ID',    'type': 'Int'},
      {'label': 'First Name',     'id': 'First_Name',     'type': 'Text'},
      {'label': 'Last Name',      'id': 'Last_Name',      'type': 'Text'},
      {'label': 'Middle Initial', 'id': 'Middle_Initial', 'type': 'Text'},
      {'label': 'Email',          'id': 'Email',          'type': 'Text'}]])
    self.apply_user_action(['BulkAddRecord', 'Destination1', [1, 2, 3], {
      'Employee_ID': [1, 2, 3],
      'First_Name': ['Bob', 'Carry', 'Don'],
      'Last_Name': ['Nike', 'Jonson', "Yoon"],
      'Middle_Initial': ['F.', 'M.', None],
      'Email': ['', 'carry.m.jonson@example.com', 'don.b.yoon@example.com']
    }])

    self.assertTableData('_grist_Tables_column', cols="subset", data=[
      ["id",  "colId",          "type",           "isFormula",  "formula"],
      [7,     "manualSort",     "ManualSortPos",  False,        ""],
      [8,     "Employee_ID",    "Int",            False,        ""],
      [9,     "First_Name",     "Text",           False,        ""],
      [10,    "Last_Name",      "Text",           False,        ""],
      [11,    "Middle_Initial", "Text",           False,        ""],
      [12,    "Email",          "Text",           False,        ""],
    ], rows=lambda r: r.parentId.id == 2)

    # Verify created tables
    self.assertPartialData("_grist_Tables", ["id", "tableId"], [
      [1, "Hidden_table"],
      [2, "Destination1"]
    ])


  def test_finish_import_into_new_table(self):
    # Add source and destination tables
    self.init_state()

    #into_new_table = True, transform_rule : no colids (will be generated for new table), merge_options = {}
    out_actions = self.apply_user_action(
        ['TransformAndFinishImport', 'Hidden_table', 'NewTable', True, self.TEMP_transform_rule_no_colids, {}])
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["AddColumn", "Hidden_table", "gristHelper_Import_Middle_Initial", {"formula": "$mname[0] if $mname else ''", "isFormula": True, "type": "Text"}],
        ["AddRecord", "_grist_Tables_column", 13, {"colId": "gristHelper_Import_Middle_Initial", "formula": "$mname[0] if $mname else ''", "isFormula": True, "label": "Middle Initial", "parentId": 1, "parentPos": 13.0, "type": "Text", "widgetOptions": ""}],
        ["BulkRemoveRecord", "_grist_Views_section_field", [1, 2, 3, 4, 5]],
        ["RemoveRecord", "_grist_Views_section", 1],
        ["RemoveRecord", "_grist_TabBar", 1],
        ["RemoveRecord", "_grist_Pages", 1],
        ["RemoveRecord", "_grist_Views", 1],
        ["UpdateRecord", "_grist_Tables", 1, {"primaryViewId": 0}],
        ["BulkRemoveRecord", "_grist_Tables_column", [1, 2, 3, 4, 5, 6, 13]],
        ["RemoveRecord", "_grist_Tables", 1],
        ["RemoveTable", "Hidden_table"],
        ["AddTable", "NewTable", [{"formula": "", "id": "manualSort", "isFormula": False, "type": "ManualSortPos"}, {"formula": "", "id": "Employee_ID", "isFormula": False, "type": "Int"}, {"formula": "", "id": "First_Name", "isFormula": False, "type": "Text"}, {"formula": "", "id": "Last_Name", "isFormula": False, "type": "Text"}, {"formula": "", "id": "Middle_Initial", "isFormula": False, "type": "Text"}, {"formula": "", "id": "Email", "isFormula": False, "type": "Text"}, {"formula": "", "id": "Blank", "isFormula": False, "type": "Text"}]],
        ["AddRecord", "_grist_Tables", 3, {"primaryViewId": 0, "tableId": "NewTable"}],
        ["BulkAddRecord", "_grist_Tables_column", [13, 14, 15, 16, 17, 18, 19], {"colId": ["manualSort", "Employee_ID", "First_Name", "Last_Name", "Middle_Initial", "Email", "Blank"], "formula": ["", "", "", "", "", "", ""], "isFormula": [False, False, False, False, False, False, False], "label": ["manualSort", "Employee ID", "First Name", "Last Name", "Middle Initial", "Email", "Blank"], "parentId": [3, 3, 3, 3, 3, 3, 3], "parentPos": [13.0, 14.0, 15.0, 16.0, 17.0, 18.0, 19.0], "type": ["ManualSortPos", "Int", "Text", "Text", "Text", "Text", "Text"], "widgetOptions": ["", "", "", "", "", "", ""]}],
        ["AddRecord", "_grist_Views", 3, {"name": "NewTable", "type": "raw_data"}],
        ["AddRecord", "_grist_TabBar", 3, {"tabPos": 3.0, "viewRef": 3}],
        ["AddRecord", "_grist_Pages", 3, {"indentation": 0, "pagePos": 3.0, "viewRef": 3}],
        ["AddRecord", "_grist_Views_section", 3, {"borderWidth": 1, "defaultWidth": 100, "parentId": 3, "parentKey": "record", "sortColRefs": "[]", "tableRef": 3, "title": ""}],
        ["BulkAddRecord", "_grist_Views_section_field", [11, 12, 13, 14, 15, 16], {"colRef": [14, 15, 16, 17, 18, 19], "parentId": [3, 3, 3, 3, 3, 3], "parentPos": [11.0, 12.0, 13.0, 14.0, 15.0, 16.0]}],
        ["UpdateRecord", "_grist_Tables", 3, {"primaryViewId": 3}],
        ["BulkAddRecord", "NewTable", [1, 2, 3, 4, 5, 6, 7], {"Email": ["bob@example.com", None, "don@example.com", "amir@example.com", "ken@example.com", "", "barbara@example.com"], "Employee_ID": [1, 2, 3, 4, 5, 6, 7], "First_Name": ["Bob", "Carry", "Don", "Amir", "Ken", "George", "Barbara"], "Last_Name": ["Nike", "Jonson", "Yoon", "Greene", "Foster", "Huang", "Kinney"], "Middle_Initial": ["F", "", "B", "", "C", "", "D"], "manualSort": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0]}],
      ]
    })

    #1-6 in hidden table, 7-12 in destTable, 13-19 for new table
    self.assertTableData('_grist_Tables_column', cols="subset", data=[
      ["id",  "colId",          "type",           "isFormula",  "formula"],
      [13,    "manualSort",     "ManualSortPos",  False,        ""],
      [14,    "Employee_ID",    "Int",            False,        ""],
      [15,    "First_Name",     "Text",           False,        ""],
      [16,    "Last_Name",      "Text",           False,        ""],
      [17,    "Middle_Initial", "Text",           False,        ""],
      [18,    "Email",          "Text",           False,        ""],
      [19,    "Blank",          "Text",           False,        ""],
    ], rows=lambda r: r.parentId.id == 3)

    self.assertTableData('NewTable', cols="all", data=[
      ["id",  "Employee_ID", "First_Name",   "Last_Name", "Middle_Initial", "Email",               "Blank",  "manualSort"],
      [1,     1,             "Bob",          "Nike",      "F",              "bob@example.com",     "",       1.0],
      [2,     2,             "Carry",        "Jonson",    "",               None,                  "",       2.0],
      [3,     3,             "Don",          "Yoon",      "B",              "don@example.com",     "",       3.0],
      [4,     4,             "Amir",         "Greene",    "",               "amir@example.com",    "",       4.0],
      [5,     5,             "Ken",          "Foster",    "C",              "ken@example.com",     "",       5.0],
      [6,     6,             "George",       "Huang",     "",               "",                    "",       6.0],
      [7,     7,             "Barbara",      "Kinney",    "D",              "barbara@example.com", "",       7.0],
    ])

    # Verify removed hidden table and add the new one
    self.assertPartialData("_grist_Tables", ["id", "tableId"], [
      [2, "Destination1"],
      [3, "NewTable"]
    ])

  def test_finish_import_into_existing_table(self):
    # Add source and destination tables
    self.init_state()

    #into_new_table = False, transform_rule : colids, merge_options = None
    self.apply_user_action(['TransformAndFinishImport', 'Hidden_table', 'Destination1', False, self.TEMP_transform_rule_colids, None])

    #1-6 in hidden table, 7-12 in destTable
    self.assertTableData('_grist_Tables_column', cols="subset", data=[
      ["id",  "colId",          "type",           "isFormula",  "formula"],
      [7,     "manualSort",     "ManualSortPos",  False,        ""],
      [8,     "Employee_ID",    "Int",            False,        ""],
      [9,     "First_Name",     "Text",           False,        ""],
      [10,    "Last_Name",      "Text",           False,        ""],
      [11,    "Middle_Initial", "Text",           False,        ""],
      [12,    "Email",          "Text",           False,        ""],
    ], rows=lambda r: r.parentId.id == 2)

    # First 3 rows were already in Destination1 before import
    self.assertTableData('Destination1', cols="all", data=[
      ["id",  "Employee_ID", "First_Name",   "Last_Name", "Middle_Initial", "Email",                      "manualSort"],
      [1,     1,             "Bob",          "Nike",      "F.",             "",                           1.0],
      [2,     2,             "Carry",        "Jonson",    "M.",             "carry.m.jonson@example.com", 2.0],
      [3,     3,             "Don",          "Yoon",      None,             "don.b.yoon@example.com",     3.0],
      [4,     1,             "Bob",          "Nike",      "F",              "bob@example.com",            4.0],
      [5,     2,             "Carry",        "Jonson",    "",               None,                         5.0],
      [6,     3,             "Don",          "Yoon",      "B",              "don@example.com",            6.0],
      [7,     4,             "Amir",         "Greene",    "",               "amir@example.com",           7.0],
      [8,     5,             "Ken",          "Foster",    "C",              "ken@example.com",            8.0],
      [9,     6,             "George",       "Huang",     "",               "",                           9.0],
      [10,    7,             "Barbara",      "Kinney",    "D",              "barbara@example.com",        10.0],
    ])

    # Verify removed hidden table
    self.assertPartialData("_grist_Tables", ["id", "tableId"], [[2, "Destination1"]])

  #does the same thing using a blank transform rule
  def test_finish_import_into_new_table_blank(self):
    # Add source and destination tables
    self.init_state()

    #into_new_table = True, transform_rule = None, merge_options = None
    self.apply_user_action(['TransformAndFinishImport', 'Hidden_table', 'NewTable', True, None, None])

    #1-6 in src table, 7-12 in hiddentable
    self.assertTableData('_grist_Tables_column', cols="subset", data=[
      ["id",  "colId",          "type",           "isFormula",  "formula"],
      [13,    "manualSort",     "ManualSortPos",  False,        ""],
      [14,    "employee_id",    "Int",            False,        ""],
      [15,    "fname",          "Text",           False,        ""],
      [16,    "mname",          "Text",           False,        ""],
      [17,    "lname",          "Text",           False,        ""],
      [18,    "email",          "Text",           False,        ""],
    ], rows=lambda r: r.parentId.id == 3)

    self.assertTableData('NewTable', cols="all", data=[
      ["id",  "employee_id", "fname",        "lname",     "mname",          "email",                      "manualSort"],
      [1,     1,             "Bob",          "Nike",      "F.",             "bob@example.com",            1.0],
      [2,     2,             "Carry",        "Jonson",    None,             None,                         2.0],
      [3,     3,             "Don",          "Yoon",      "B.",             "don@example.com",            3.0],
      [4,     4,             "Amir",         "Greene",    "",               "amir@example.com",           4.0],
      [5,     5,             "Ken",          "Foster",    "C.",             "ken@example.com",            5.0],
      [6,     6,             "George",       "Huang",     "",               "",                           6.0],
      [7,     7,             "Barbara",      "Kinney",    "D.",             "barbara@example.com",        7.0],
    ])


    # Verify removed hidden table and add the new one
    self.assertPartialData("_grist_Tables", ["id", "tableId"], [
      [2, "Destination1"],
      [3, "NewTable"]
    ])

  def test_finish_import_into_existing_table_with_single_merge_col(self):
    # Add source and destination tables.
    self.init_state()

    # Use 'Employee_ID' as the merge column, updating existing employees in Destination1 with the same employee id.
    out_actions = self.apply_user_action(
      ['TransformAndFinishImport', 'Hidden_table', 'Destination1', False, self.TEMP_transform_rule_colids,
      {'mergeCols': ['Employee_ID'], 'mergeStrategy': {'type': 'replace-with-nonblank-source'}}]
    )

    # Check that the right actions were created.
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["AddColumn", "Hidden_table", "gristHelper_Import_Middle_Initial", {"formula": "$mname[0] if $mname else ''", "isFormula": True, "type": "Text"}],
        ["AddRecord", "_grist_Tables_column", 13, {"colId": "gristHelper_Import_Middle_Initial", "formula": "$mname[0] if $mname else ''", "isFormula": True, "label": "Middle Initial", "parentId": 1, "parentPos": 13.0, "type": "Text", "widgetOptions": ""}],
        ["BulkRemoveRecord", "_grist_Views_section_field", [1, 2, 3, 4, 5]],
        ["RemoveRecord", "_grist_Views_section", 1],
        ["RemoveRecord", "_grist_TabBar", 1],
        ["RemoveRecord", "_grist_Pages", 1],
        ["RemoveRecord", "_grist_Views", 1],
        ["UpdateRecord", "_grist_Tables", 1, {"primaryViewId": 0}],
        ["BulkRemoveRecord", "_grist_Tables_column", [1, 2, 3, 4, 5, 6, 13]],
        ["RemoveRecord", "_grist_Tables", 1],
        ["RemoveTable", "Hidden_table"],
        ["BulkUpdateRecord", "Destination1", [1, 3], {"Email": ["bob@example.com", "don@example.com"], "Middle_Initial": ["F", "B"]}],
        ["BulkAddRecord", "Destination1", [4, 5, 6, 7], {"Email": ["amir@example.com", "ken@example.com", "", "barbara@example.com"], "Employee_ID": [4, 5, 6, 7], "First_Name": ["Amir", "Ken", "George", "Barbara"], "Last_Name": ["Greene", "Foster", "Huang", "Kinney"], "Middle_Initial": ["", "C", "", "D"], "manualSort": [4.0, 5.0, 6.0, 7.0]}],
      ]
    })

    self.assertTableData('_grist_Tables_column', cols="subset", data=[
      ["id",  "colId",          "type",           "isFormula",  "formula"],
      [7,     "manualSort",     "ManualSortPos",  False,        ""],
      [8,     "Employee_ID",    "Int",            False,        ""],
      [9,     "First_Name",     "Text",           False,        ""],
      [10,    "Last_Name",      "Text",           False,        ""],
      [11,    "Middle_Initial", "Text",           False,        ""],
      [12,    "Email",          "Text",           False,        ""],
    ], rows=lambda r: r.parentId.id == 2)

    # Check that Destination1 has no duplicates and that previous records (1 - 3) are updated.
    self.assertTableData('Destination1', cols="all", data=[
      ["id",  "Employee_ID", "First_Name",   "Last_Name", "Middle_Initial", "Email",                      "manualSort"],
      [1,     1,             "Bob",          "Nike",      "F",              "bob@example.com",            1.0],
      [2,     2,             "Carry",        "Jonson",    "M.",             "carry.m.jonson@example.com", 2.0],
      [3,     3,             "Don",          "Yoon",      "B",              "don@example.com",            3.0],
      [4,     4,             "Amir",         "Greene",    "",               "amir@example.com",           4.0],
      [5,     5,             "Ken",          "Foster",    "C",              "ken@example.com",            5.0],
      [6,     6,             "George",       "Huang",     "",               "",                           6.0],
      [7,     7,             "Barbara",      "Kinney",    "D",              "barbara@example.com",        7.0],
    ])

    self.assertPartialData("_grist_Tables", ["id", "tableId"], [[2, "Destination1"]])

  def test_finish_import_into_existing_table_with_multiple_merge_cols(self):
    # Add source and destination tables.
    self.init_state()

    # Use 'First_Name' and 'Last_Name' as the merge columns, updating existing employees in Destination1 with the same name.
    out_actions = self.apply_user_action(
      ['TransformAndFinishImport', 'Hidden_table', 'Destination1', False, self.TEMP_transform_rule_colids,
      {'mergeCols': ['First_Name', 'Last_Name'], 'mergeStrategy': {'type': 'replace-with-nonblank-source'}}]
    )

    # Check that the right actions were created.
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["AddColumn", "Hidden_table", "gristHelper_Import_Middle_Initial", {"formula": "$mname[0] if $mname else ''", "isFormula": True, "type": "Text"}],
        ["AddRecord", "_grist_Tables_column", 13, {"colId": "gristHelper_Import_Middle_Initial", "formula": "$mname[0] if $mname else ''", "isFormula": True, "label": "Middle Initial", "parentId": 1, "parentPos": 13.0, "type": "Text", "widgetOptions": ""}],
        ["BulkRemoveRecord", "_grist_Views_section_field", [1, 2, 3, 4, 5]],
        ["RemoveRecord", "_grist_Views_section", 1],
        ["RemoveRecord", "_grist_TabBar", 1],
        ["RemoveRecord", "_grist_Pages", 1],
        ["RemoveRecord", "_grist_Views", 1],
        ["UpdateRecord", "_grist_Tables", 1, {"primaryViewId": 0}],
        ["BulkRemoveRecord", "_grist_Tables_column", [1, 2, 3, 4, 5, 6, 13]],
        ["RemoveRecord", "_grist_Tables", 1],
        ["RemoveTable", "Hidden_table"],
        ["BulkUpdateRecord", "Destination1", [1, 3], {"Email": ["bob@example.com", "don@example.com"], "Middle_Initial": ["F", "B"]}],
        ["BulkAddRecord", "Destination1", [4, 5, 6, 7], {"Email": ["amir@example.com", "ken@example.com", "", "barbara@example.com"], "Employee_ID": [4, 5, 6, 7], "First_Name": ["Amir", "Ken", "George", "Barbara"], "Last_Name": ["Greene", "Foster", "Huang", "Kinney"], "Middle_Initial": ["", "C", "", "D"], "manualSort": [4.0, 5.0, 6.0, 7.0]}],
      ]
    })

    self.assertTableData('_grist_Tables_column', cols="subset", data=[
      ["id",  "colId",          "type",           "isFormula",  "formula"],
      [7,     "manualSort",     "ManualSortPos",  False,        ""],
      [8,     "Employee_ID",    "Int",            False,        ""],
      [9,     "First_Name",     "Text",           False,        ""],
      [10,    "Last_Name",      "Text",           False,        ""],
      [11,    "Middle_Initial", "Text",           False,        ""],
      [12,    "Email",          "Text",           False,        ""],
    ], rows=lambda r: r.parentId.id == 2)

    # Check that Destination1 has no duplicates and that previous records (1 - 3) are updated.
    self.assertTableData('Destination1', cols="all", data=[
      ["id",  "Employee_ID", "First_Name",   "Last_Name", "Middle_Initial", "Email",                      "manualSort"],
      [1,     1,             "Bob",          "Nike",      "F",              "bob@example.com",            1.0],
      [2,     2,             "Carry",        "Jonson",    "M.",             "carry.m.jonson@example.com", 2.0],
      [3,     3,             "Don",          "Yoon",      "B",              "don@example.com",            3.0],
      [4,     4,             "Amir",         "Greene",    "",               "amir@example.com",           4.0],
      [5,     5,             "Ken",          "Foster",    "C",              "ken@example.com",            5.0],
      [6,     6,             "George",       "Huang",     "",               "",                           6.0],
      [7,     7,             "Barbara",      "Kinney",    "D",              "barbara@example.com",        7.0],
    ])

    self.assertPartialData("_grist_Tables", ["id", "tableId"], [[2, "Destination1"]])

  def test_finish_import_into_existing_table_with_no_matching_merge_cols(self):
    # Add source and destination tables.
    self.init_state()

    # Use 'Email' as the merge column: existing employees in Destination1 have different emails, so none should match incoming data.
    out_actions = self.apply_user_action(
      ['TransformAndFinishImport', 'Hidden_table', 'Destination1', False, self.TEMP_transform_rule_colids,
      {'mergeCols': ['Email'], 'mergeStrategy': {'type': 'replace-with-nonblank-source'}}]
    )

    # Check that the right actions were created.
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["AddColumn", "Hidden_table", "gristHelper_Import_Middle_Initial", {"formula": "$mname[0] if $mname else ''", "isFormula": True, "type": "Text"}],
        ["AddRecord", "_grist_Tables_column", 13, {"colId": "gristHelper_Import_Middle_Initial", "formula": "$mname[0] if $mname else ''", "isFormula": True, "label": "Middle Initial", "parentId": 1, "parentPos": 13.0, "type": "Text", "widgetOptions": ""}],
        ["BulkRemoveRecord", "_grist_Views_section_field", [1, 2, 3, 4, 5]],
        ["RemoveRecord", "_grist_Views_section", 1],
        ["RemoveRecord", "_grist_TabBar", 1],
        ["RemoveRecord", "_grist_Pages", 1],
        ["RemoveRecord", "_grist_Views", 1],
        ["UpdateRecord", "_grist_Tables", 1, {"primaryViewId": 0}],
        ["BulkRemoveRecord", "_grist_Tables_column", [1, 2, 3, 4, 5, 6, 13]],
        ["RemoveRecord", "_grist_Tables", 1],
        ["RemoveTable", "Hidden_table"],
        ["BulkAddRecord", "Destination1", [4, 5, 6, 7, 8, 9, 10], {"Email": ["bob@example.com", None, "don@example.com", "amir@example.com", "ken@example.com", "", "barbara@example.com"], "Employee_ID": [1, 2, 3, 4, 5, 6, 7], "First_Name": ["Bob", "Carry", "Don", "Amir", "Ken", "George", "Barbara"], "Last_Name": ["Nike", "Jonson", "Yoon", "Greene", "Foster", "Huang", "Kinney"], "Middle_Initial": ["F", "", "B", "", "C", "", "D"], "manualSort": [4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]}],
      ]
    })

    self.assertTableData('_grist_Tables_column', cols="subset", data=[
      ["id",  "colId",          "type",           "isFormula",  "formula"],
      [7,     "manualSort",     "ManualSortPos",  False,        ""],
      [8,     "Employee_ID",    "Int",            False,        ""],
      [9,     "First_Name",     "Text",           False,        ""],
      [10,    "Last_Name",      "Text",           False,        ""],
      [11,    "Middle_Initial", "Text",           False,        ""],
      [12,    "Email",          "Text",           False,        ""],
    ], rows=lambda r: r.parentId.id == 2)

    # Check that no existing records were updated.
    self.assertTableData('Destination1', cols="all", data=[
      ["id",  "Employee_ID", "First_Name",   "Last_Name", "Middle_Initial", "Email",                      "manualSort"],
      [1,     1,             "Bob",          "Nike",      "F.",             "",                           1.0],
      [2,     2,             "Carry",        "Jonson",    "M.",             "carry.m.jonson@example.com", 2.0],
      [3,     3,             "Don",          "Yoon",      None,             "don.b.yoon@example.com",     3.0],
      [4,     1,             "Bob",          "Nike",      "F",              "bob@example.com",            4.0],
      [5,     2,             "Carry",        "Jonson",    "",               None,                         5.0],
      [6,     3,             "Don",          "Yoon",      "B",              "don@example.com",            6.0],
      [7,     4,             "Amir",         "Greene",    "",               "amir@example.com",           7.0],
      [8,     5,             "Ken",          "Foster",    "C",              "ken@example.com",            8.0],
      [9,     6,             "George",       "Huang",     "",               "",                           9.0],
      [10,    7,             "Barbara",      "Kinney",    "D",              "barbara@example.com",        10.0],
    ])

    self.assertPartialData("_grist_Tables", ["id", "tableId"], [[2, "Destination1"]])

  def test_replace_all_fields_merge_strategy(self):
    # Add source and destination tables.
    self.init_state()

    # Use replace all fields strategy on the 'Employee_ID' column.
    out_actions = self.apply_user_action(
      ['TransformAndFinishImport', 'Hidden_table', 'Destination1', False, self.TEMP_transform_rule_colids,
      {'mergeCols': ['Employee_ID'], 'mergeStrategy': {'type': 'replace-all-fields'}}]
    )

    # Check that the right actions were created.
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["AddColumn", "Hidden_table", "gristHelper_Import_Middle_Initial", {"formula": "$mname[0] if $mname else ''", "isFormula": True, "type": "Text"}],
        ["AddRecord", "_grist_Tables_column", 13, {"colId": "gristHelper_Import_Middle_Initial", "formula": "$mname[0] if $mname else ''", "isFormula": True, "label": "Middle Initial", "parentId": 1, "parentPos": 13.0, "type": "Text", "widgetOptions": ""}],
        ["BulkRemoveRecord", "_grist_Views_section_field", [1, 2, 3, 4, 5]],
        ["RemoveRecord", "_grist_Views_section", 1],
        ["RemoveRecord", "_grist_TabBar", 1],
        ["RemoveRecord", "_grist_Pages", 1],
        ["RemoveRecord", "_grist_Views", 1],
        ["UpdateRecord", "_grist_Tables", 1, {"primaryViewId": 0}],
        ["BulkRemoveRecord", "_grist_Tables_column", [1, 2, 3, 4, 5, 6, 13]],
        ["RemoveRecord", "_grist_Tables", 1],
        ["RemoveTable", "Hidden_table"],
        ["BulkUpdateRecord", "Destination1", [1, 2, 3], {"Email": ["bob@example.com", None, "don@example.com"], "Middle_Initial": ["F", "", "B"]}],
        ["BulkAddRecord", "Destination1", [4, 5, 6, 7], {"Email": ["amir@example.com", "ken@example.com", "", "barbara@example.com"], "Employee_ID": [4, 5, 6, 7], "First_Name": ["Amir", "Ken", "George", "Barbara"], "Last_Name": ["Greene", "Foster", "Huang", "Kinney"], "Middle_Initial": ["", "C", "", "D"], "manualSort": [4.0, 5.0, 6.0, 7.0]}],
      ]
    })

    self.assertTableData('_grist_Tables_column', cols="subset", data=[
      ["id",  "colId",          "type",           "isFormula",  "formula"],
      [7,     "manualSort",     "ManualSortPos",  False,        ""],
      [8,     "Employee_ID",    "Int",            False,        ""],
      [9,     "First_Name",     "Text",           False,        ""],
      [10,    "Last_Name",      "Text",           False,        ""],
      [11,    "Middle_Initial", "Text",           False,        ""],
      [12,    "Email",          "Text",           False,        ""],
    ], rows=lambda r: r.parentId.id == 2)

    # Check that existing fields were replaced with incoming fields.
    self.assertTableData('Destination1', cols="all", data=[
      ["id",  "Employee_ID", "First_Name",   "Last_Name", "Middle_Initial", "Email",                      "manualSort"],
      [1,     1,             "Bob",          "Nike",      "F",              "bob@example.com",            1.0],
      [2,     2,             "Carry",        "Jonson",    "",               None,                         2.0],
      [3,     3,             "Don",          "Yoon",      "B",              "don@example.com",            3.0],
      [4,     4,             "Amir",         "Greene",    "",               "amir@example.com",           4.0],
      [5,     5,             "Ken",          "Foster",    "C",              "ken@example.com",            5.0],
      [6,     6,             "George",       "Huang",     "",               "",                           6.0],
      [7,     7,             "Barbara",      "Kinney",    "D",              "barbara@example.com",        7.0],
    ])

    self.assertPartialData("_grist_Tables", ["id", "tableId"], [[2, "Destination1"]])

  def test_replace_blank_fields_only_merge_strategy(self):
    # Add source and destination tables.
    self.init_state()

    # Use replace blank fields only strategy on the 'Employee_ID' column.
    out_actions = self.apply_user_action(
      ['TransformAndFinishImport', 'Hidden_table', 'Destination1', False, self.TEMP_transform_rule_colids,
      {'mergeCols': ['Employee_ID'], 'mergeStrategy': {'type': 'replace-blank-fields-only'}}]
    )

    # Check that the right actions were created.
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["AddColumn", "Hidden_table", "gristHelper_Import_Middle_Initial", {"formula": "$mname[0] if $mname else ''", "isFormula": True, "type": "Text"}],
        ["AddRecord", "_grist_Tables_column", 13, {"colId": "gristHelper_Import_Middle_Initial", "formula": "$mname[0] if $mname else ''", "isFormula": True, "label": "Middle Initial", "parentId": 1, "parentPos": 13.0, "type": "Text", "widgetOptions": ""}],
        ["BulkRemoveRecord", "_grist_Views_section_field", [1, 2, 3, 4, 5]],
        ["RemoveRecord", "_grist_Views_section", 1],
        ["RemoveRecord", "_grist_TabBar", 1],
        ["RemoveRecord", "_grist_Pages", 1],
        ["RemoveRecord", "_grist_Views", 1],
        ["UpdateRecord", "_grist_Tables", 1, {"primaryViewId": 0}],
        ["BulkRemoveRecord", "_grist_Tables_column", [1, 2, 3, 4, 5, 6, 13]],
        ["RemoveRecord", "_grist_Tables", 1],
        ["RemoveTable", "Hidden_table"],
        ["BulkUpdateRecord", "Destination1", [1, 3], {"Email": ["bob@example.com", "don.b.yoon@example.com"], "Middle_Initial": ["F.", "B"]}],
        ["BulkAddRecord", "Destination1", [4, 5, 6, 7], {"Email": ["amir@example.com", "ken@example.com", "", "barbara@example.com"], "Employee_ID": [4, 5, 6, 7], "First_Name": ["Amir", "Ken", "George", "Barbara"], "Last_Name": ["Greene", "Foster", "Huang", "Kinney"], "Middle_Initial": ["", "C", "", "D"], "manualSort": [4.0, 5.0, 6.0, 7.0]}],
      ]
    })

    self.assertTableData('_grist_Tables_column', cols="subset", data=[
      ["id",  "colId",          "type",           "isFormula",  "formula"],
      [7,     "manualSort",     "ManualSortPos",  False,        ""],
      [8,     "Employee_ID",    "Int",            False,        ""],
      [9,     "First_Name",     "Text",           False,        ""],
      [10,    "Last_Name",      "Text",           False,        ""],
      [11,    "Middle_Initial", "Text",           False,        ""],
      [12,    "Email",          "Text",           False,        ""],
    ], rows=lambda r: r.parentId.id == 2)

    # Check that only blank existing fields were updated.
    self.assertTableData('Destination1', cols="all", data=[
      ["id",  "Employee_ID", "First_Name",   "Last_Name", "Middle_Initial", "Email",                      "manualSort"],
      [1,     1,             "Bob",          "Nike",      "F.",             "bob@example.com",            1.0],
      [2,     2,             "Carry",        "Jonson",    "M.",             "carry.m.jonson@example.com", 2.0],
      [3,     3,             "Don",          "Yoon",      "B",              "don.b.yoon@example.com",     3.0],
      [4,     4,             "Amir",         "Greene",    "",               "amir@example.com",           4.0],
      [5,     5,             "Ken",          "Foster",    "C",              "ken@example.com",            5.0],
      [6,     6,             "George",       "Huang",     "",               "",                           6.0],
      [7,     7,             "Barbara",      "Kinney",    "D",              "barbara@example.com",        7.0],
    ])

    self.assertPartialData("_grist_Tables", ["id", "tableId"], [[2, "Destination1"]])

  def test_merging_updates_all_duplicates_in_destination_table(self):
    # Add source and destination tables.
    self.init_state()

    # Add duplicates to the destination table with different values than original.
    self.apply_user_action(['BulkAddRecord', 'Destination1', [4, 5], {
      'Employee_ID': [3, 3],
      'First_Name': ['Don', 'Don'],
      'Last_Name': ["Yoon", "Yoon"],
      'Middle_Initial': [None, 'B'],
      'Email': ['don.yoon@example.com', 'yoon.don@example.com']
    }])

    # Use replace with nonblank source strategy on the 'Employee_ID' column.
    self.apply_user_action(
      ['TransformAndFinishImport', 'Hidden_table', 'Destination1', False, self.TEMP_transform_rule_colids,
      {'mergeCols': ['Employee_ID'], 'mergeStrategy': {'type': 'replace-with-nonblank-source'}}]
    )

    # Check that all duplicates were updated with new data from the source table.
    self.assertTableData('Destination1', cols="all", data=[
      ["id",  "Employee_ID", "First_Name",   "Last_Name", "Middle_Initial", "Email",                      "manualSort"],
      [1,     1,             "Bob",          "Nike",      "F",              "bob@example.com",            1.0],
      [2,     2,             "Carry",        "Jonson",    "M.",             "carry.m.jonson@example.com", 2.0],
      [3,     3,             "Don",          "Yoon",      "B",              "don@example.com",            3.0],
      [4,     3,             "Don",          "Yoon",      "B",              "don@example.com",            4.0],
      [5,     3,             "Don",          "Yoon",      "B",              "don@example.com",            5.0],
      [6,     4,             "Amir",         "Greene",    "",               "amir@example.com",           6.0],
      [7,     5,             "Ken",          "Foster",    "C",              "ken@example.com",            7.0],
      [8,     6,             "George",       "Huang",     "",               "",                           8.0],
      [9,     7,             "Barbara",      "Kinney",    "D",              "barbara@example.com",        9.0],
    ])

    self.assertPartialData("_grist_Tables", ["id", "tableId"], [[2, "Destination1"]])

  def test_merging_uses_latest_duplicate_in_source_table_for_matching(self):
    # Add source and destination tables.
    self.init_state()

    # Add duplicates to the source table with different values than the original.
    self.apply_user_action(['BulkAddRecord', 'Hidden_table', [8, 9], {
      'employee_id': [3, 3],
      'fname': ['Don', 'Don'],
      'lname': ["Yoon", "yoon"],
      'mname': [None, None],
      'email': ['d.yoon@example.com', 'yoon.don@example.com']
    }])

    # Use replace with nonblank source strategy on the 'Employee_ID' column.
    self.apply_user_action(
      ['TransformAndFinishImport', 'Hidden_table', 'Destination1', False, self.TEMP_transform_rule_colids,
      {'mergeCols': ['Employee_ID'], 'mergeStrategy': {'type': 'replace-with-nonblank-source'}}]
    )

    # Check that the last record for Don Yoon in the source table was used for updating the destination table.
    self.assertTableData('Destination1', cols="all", data=[
      ["id",  "Employee_ID", "First_Name",   "Last_Name", "Middle_Initial", "Email",                      "manualSort"],
      [1,     1,             "Bob",          "Nike",      "F",              "bob@example.com",            1.0],
      [2,     2,             "Carry",        "Jonson",    "M.",             "carry.m.jonson@example.com", 2.0],
      [3,     3,             "Don",          "yoon",      None,             "yoon.don@example.com",       3.0],
      [4,     4,             "Amir",         "Greene",    "",               "amir@example.com",           4.0],
      [5,     5,             "Ken",          "Foster",    "C",              "ken@example.com",            5.0],
      [6,     6,             "George",       "Huang",     "",               "",                           6.0],
      [7,     7,             "Barbara",      "Kinney",    "D",              "barbara@example.com",        7.0],
    ])

    self.assertPartialData("_grist_Tables", ["id", "tableId"], [[2, "Destination1"]])
