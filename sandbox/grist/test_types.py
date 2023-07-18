# -*- coding: utf-8 -*-
# pylint: disable=line-too-long
import logging
import six

import testutil
import test_engine

log = logging.getLogger(__name__)

class TestTypes(test_engine.EngineTestCase):
  sample = testutil.parse_test_sample({
    "SCHEMA": [
      [1, "Types", [
        [21, "text",    "Text",    False, "", "", ""],
        [22, "numeric", "Numeric", False, "", "", ""],
        [23, "int",     "Int",     False, "", "", ""],
        [24, "bool",    "Bool",    False, "", "", ""],
        [25, "date",    "Date",    False, "", "", ""]
      ]],
      [2, "Formulas", [
        [30, "division", "Any",    True,  "Types.lookupOne(id=18).numeric / 2", "", ""]
      ]]
    ],
    "DATA": {
      "Types": [
        ["id", "text",     "numeric",  "int",      "bool",     "date"],
        [11,   "New York", "New York", "New York", "New York", "New York"],
        [12,   u"Chîcágö",  u"Chîcágö",  u"Chîcágö",  u"Chîcágö",  u"Chîcágö"],
        [13,   False,      False,      False,      False,      False],
        [14,   True,       True,       True,       True,       True],
        [15,   1509556595, 1509556595, 1509556595, 1509556595, 1509556595],
        [16,   8.153,      8.153,      8.153,      8.153,      8.153],
        [17,   0,          0,          0,          0,          0],
        [18,   1,          1,          1,          1,          1],
        [19,   "",         "",         "",         "",         ""],
        [20,   None,       None,       None,       None,       None]],
      "Formulas": [
        ["id"],
        [1]]
    },
  })
  all_row_ids = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]

  def test_update_typed_cells(self):
    """
    Tests that updated typed values are set as expected in the sandbox. Types should follow
    the rules:
     - After updating a cell with a value of a type compatible to the column type,
       the cell value should have the column's standard type
     - Otherwise, the cell value should have the type AltText
    """
    self.load_sample(self.sample)

    out_actions = self.apply_user_action(["BulkUpdateRecord", "Types", self.all_row_ids, {
      "text":    [None, "", 1, 0, 8.153, 1509556595, True, False, u"Chîcágö", "New York"],
      "numeric": [None, "", 1, 0, 8.153, 1509556595, True, False, u"Chîcágö", "New York"],
      "int":     [None, "", 1, 0, 8.153, 1509556595, True, False, u"Chîcágö", "New York"],
      "bool":    [None, "", 1, 0, 8.153, 1509556595, True, False, u"Chîcágö", "New York"],
      "date":    [None, "", 1, 0, 8.153, 1509556595, True, False, u"2019-01-22 00:47:39", "New York"]
    }])

    self.assertPartialOutActions(out_actions, {
      "stored": [["BulkUpdateRecord", "Types", self.all_row_ids, {
        "text":    [None,"","1","0","8.153","1509556595","True","False",u"Chîcágö","New York"],
        "numeric": [None, None, 1.0, 0.0, 8.153, 1509556595.0, 1.0, 0.0, u"Chîcágö", "New York"],
        "int":     [None, None, 1, 0, 8, 1509556595, 1, 0, u"Chîcágö", "New York"],
        "bool":    [False, False, True, False, True, True, True, False, u"Chîcágö", "New York"],
        "date":    [None, None, 1.0, 0.0, 8.153, 1509556595.0, 1.0, 0.0, 1548115200.0, "New York"]
        }],
        ["UpdateRecord", "Formulas", 1, {"division": 0.0}],
      ],
      "undo": [["BulkUpdateRecord", "Types", self.all_row_ids, {
        "text":    ["New York", u"Chîcágö", False, True, 1509556595, 8.153, 0, 1, "", None],
        "numeric": ["New York", u"Chîcágö", False, True, 1509556595, 8.153, 0, 1, "", None],
        "int":     ["New York", u"Chîcágö", False, True, 1509556595, 8.153, 0, 1, "", None],
        "bool":    ["New York", u"Chîcágö", False, True, 1509556595, 8.153, False, True, "", None],
        "date":    ["New York", u"Chîcágö", False, True, 1509556595, 8.153, 0, 1, "", None]
        }],
        ["UpdateRecord", "Formulas", 1, {"division": 0.5}],
      ]
    })

    self.assertTableData("Types", data=[
      ["id", "text",       "numeric",  "int",      "bool",     "date"],
      [11,   None,         None,       None,       False,      None],
      [12,   "",           None,       None,       False,      None],
      [13,   "1",          1.0,        1,          True,       1.0],
      [14,   "0",          0.0,        0,          False,      0.0],
      [15,   "8.153",      8.153,      8,          True,       8.153],
      [16,   "1509556595", 1509556595, 1509556595, True,       1509556595.0],
      [17,   "True",       1.0,        1,          True,       1.0],
      [18,   "False",      0.0,        0,          False,      0.0],
      [19,   u"Chîcágö",    u"Chîcágö",  u"Chîcágö",  u"Chîcágö",  1548115200.0],
      [20,   "New York",   "New York", "New York", "New York", "New York"]
    ])


  def test_text_conversions(self):
    """
    Tests that column type changes occur as expected in the sandbox:
     - Resulting cell values should all be Text
     - Only non-compatible values should appear in the resulting BulkUpdateRecord
    """
    self.load_sample(self.sample)

    # Test Text -> Text conversion
    out_actions = self.apply_user_action(["ModifyColumn", "Types", "text", { "type" : "Text" }])
    self.assertPartialOutActions(out_actions, {
      "stored": [],
      "undo": []
    })

    # Test Numeric -> Text conversion
    out_actions = self.apply_user_action(["ModifyColumn", "Types", "numeric", { "type" : "Text" }])
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["ModifyColumn", "Types", "numeric", {"type": "Text"}],
        ["BulkUpdateRecord", "Types", [13, 14, 15, 16, 17, 18],
          {"numeric": ["False", "True", "1509556595", "8.153", "0", "1"]}],
        ["UpdateRecord", "_grist_Tables_column", 22, {"type": "Text"}],
        ["UpdateRecord", "Formulas", 1, {"division": ["E", "TypeError"]}],
      ],
      "undo": [
        ["BulkUpdateRecord", "Types", [13, 14, 15, 16, 17, 18],
          {"numeric": [False, True, 1509556595, 8.153, 0, 1]}],
        ["ModifyColumn", "Types", "numeric", {"type": "Numeric"}],
        ["UpdateRecord", "_grist_Tables_column", 22, {"type": "Numeric"}],
        ["UpdateRecord", "Formulas", 1, {"division": 0.5}],
      ]
    })

    # Test Int -> Text conversion
    out_actions = self.apply_user_action(["ModifyColumn", "Types", "int", { "type" : "Text" }])
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["ModifyColumn", "Types", "int", {"type": "Text"}],
        ["BulkUpdateRecord", "Types", [13, 14, 15, 16, 17, 18],
          {"int": ["False", "True", "1509556595", "8.153", "0", "1"]}],
        ["UpdateRecord", "_grist_Tables_column", 23, {"type": "Text"}],
      ],
      "undo": [
        ["BulkUpdateRecord", "Types", [13, 14, 15, 16, 17, 18],
          {"int": [False, True, 1509556595, 8.153, 0, 1]}],
        ["ModifyColumn", "Types", "int", {"type": "Int"}],
        ["UpdateRecord", "_grist_Tables_column", 23, {"type": "Int"}],
      ]
    })

    # Test Bool -> Text
    out_actions = self.apply_user_action(["ModifyColumn", "Types", "bool", { "type" : "Text" }])
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["ModifyColumn", "Types", "bool", {"type": "Text"}],
        ["BulkUpdateRecord", "Types", [13, 14, 15, 16, 17, 18],
          {"bool": ["False", "True", "1509556595", "8.153", "False", "True"]}],
        ["UpdateRecord", "_grist_Tables_column", 24, {"type": "Text"}],
      ],
      "undo": [
        ["BulkUpdateRecord", "Types", [13, 14, 15, 16, 17, 18],
          {"bool": [False, True, 1509556595, 8.153, False, True]}],
        ["ModifyColumn", "Types", "bool", {"type": "Bool"}],
        ["UpdateRecord", "_grist_Tables_column", 24, {"type": "Bool"}],
      ]
    })

    # Test Date -> Text
    out_actions = self.apply_user_action(["ModifyColumn", "Types", "date", { "type" : "Text" }])
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["ModifyColumn", "Types", "date", {"type": "Text"}],
        ["BulkUpdateRecord", "Types", [13, 14, 15, 16, 17, 18],
          {"date": ["False", "True", "1509556595", "8.153", "0", "1"]}],
        ["UpdateRecord", "_grist_Tables_column", 25, {"type": "Text"}]
      ],
      "undo": [
        ["BulkUpdateRecord", "Types", [13, 14, 15, 16, 17, 18],
          {"date": [False, True, 1509556595.0, 8.153, 0.0, 1.0]}],
        ["ModifyColumn", "Types", "date", {"type": "Date"}],
        ["UpdateRecord", "_grist_Tables_column", 25, {"type": "Date"}]
      ]
    })

    # Assert that the final table is as expected
    self.assertTableData("Types", data=[
      ["id", "text",      "numeric",   "int",       "bool",      "date"],
      [11,   "New York",  "New York",  "New York",  "New York",  "New York"],
      [12,   u"Chîcágö",   u"Chîcágö",   u"Chîcágö",   u"Chîcágö",   u"Chîcágö"],
      [13,   False,       "False",     "False",     "False",     "False"],
      [14,   True,        "True",      "True",      "True",      "True"],
      [15,   1509556595,  "1509556595","1509556595","1509556595","1509556595"],
      [16,   8.153,       "8.153",     "8.153",     "8.153",     "8.153"],
      [17,   0,           "0",         "0",         "False",     "0"],
      [18,   1,           "1",         "1",         "True",      "1"],
      [19,   "",          "",          "",          "",          ""],
      [20,   None,        None,        None,        None,        None]
    ])


  def test_numeric_conversions(self):
    """
    Tests that column type changes occur as expected in the sandbox:
     - Resulting cell values should all be of type Numeric or AltText
     - Only non-compatible values should appear in the resulting BulkUpdateRecord
    """
    self.load_sample(self.sample)

    # Test Text -> Numeric conversion
    out_actions = self.apply_user_action(["ModifyColumn", "Types", "text", { "type" : "Numeric" }])
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["ModifyColumn", "Types", "text", {"type": "Numeric"}],
        ["BulkUpdateRecord", "Types", [13, 14, 19],
          {"text": [0.0, 1.0, None]}],
        ["UpdateRecord", "_grist_Tables_column", 21, {"type": "Numeric"}],
      ],
      "undo": [
        ["BulkUpdateRecord", "Types", [13, 14, 19],
          {"text": [False, True, ""]}],
        ["ModifyColumn", "Types", "text", {"type": "Text"}],
        ["UpdateRecord", "_grist_Tables_column", 21, {"type": "Text"}],
      ]
    })

    # Test Numeric -> Numeric conversion
    out_actions = self.apply_user_action(["ModifyColumn", "Types", "numeric", {"type": "Numeric"}])
    self.assertPartialOutActions(out_actions, {
      "stored": [],
      "undo": []
    })

    # Test Int -> Numeric conversion
    out_actions = self.apply_user_action(["ModifyColumn", "Types", "int", { "type" : "Numeric" }])
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["ModifyColumn", "Types", "int", {"type": "Numeric"}],
        ["BulkUpdateRecord", "Types", [13, 14, 19],
          {"int": [0.0, 1.0, None]}],
        ["UpdateRecord", "_grist_Tables_column", 23, {"type": "Numeric"}],
      ],
      "undo": [
        ["BulkUpdateRecord", "Types", [13, 14, 19],
          {"int": [False, True, ""]}],
        ["ModifyColumn", "Types", "int", {"type": "Int"}],
        ["UpdateRecord", "_grist_Tables_column", 23, {"type": "Int"}],
      ]
    })

    # Test Bool -> Numeric conversion
    out_actions = self.apply_user_action(["ModifyColumn", "Types", "bool", { "type" : "Numeric" }])
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["ModifyColumn", "Types", "bool", {"type": "Numeric"}],
        ["BulkUpdateRecord", "Types", [13, 14, 17, 18, 19],
          {"bool": [0.0, 1.0, 0.0, 1.0, None]}],
        ["UpdateRecord", "_grist_Tables_column", 24, {"type": "Numeric"}],
      ],
      "undo": [
        ["BulkUpdateRecord", "Types", [13, 14, 17, 18, 19],
          {"bool": [False, True, False, True, ""]}],
        ["ModifyColumn", "Types", "bool", {"type": "Bool"}],
        ["UpdateRecord", "_grist_Tables_column", 24, {"type": "Bool"}],
      ]
    })

    # Test Date -> Numeric conversion
    out_actions = self.apply_user_action(["ModifyColumn", "Types", "date", { "type" : "Numeric" }])
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["ModifyColumn", "Types", "date", {"type": "Numeric"}],
        ["BulkUpdateRecord", "Types", [13, 14, 19],
          {"date": [0.0, 1.0, None]}],
        ["UpdateRecord", "_grist_Tables_column", 25, {"type": "Numeric"}]
      ],
      "undo": [
        ["BulkUpdateRecord", "Types", [13, 14, 19],
          {"date": [False, True, ""]}],
        ["ModifyColumn", "Types", "date", {"type": "Date"}],
        ["UpdateRecord", "_grist_Tables_column", 25, {"type": "Date"}]
      ]
    })

    # Assert that the final table is as expected
    self.assertTableData("Types", data=[
      ["id", "text",     "numeric",  "int",      "bool",     "date"],
      [11,   "New York", "New York", "New York", "New York", "New York"],
      [12,   u"Chîcágö",  u"Chîcágö",  u"Chîcágö",  u"Chîcágö",  u"Chîcágö"],
      [13,   0.0,        False,      0.0,        0.0,        0.0],
      [14,   1.0,        True,       1.0,        1.0,        1.0],
      [15,   1509556595, 1509556595, 1509556595, 1509556595, 1509556595],
      [16,   8.153,      8.153,      8.153,      8.153,      8.153],
      [17,   0.0,        0.0,        0.0,        0.0,        0.0],
      [18,   1.0,        1.0,        1.0,        1.0,        1.0],
      [19,   None,       "",         None,       None,       None],
      [20,   None,       None,       None,       None,       None],
    ])

  def test_numeric_to_text_conversion(self):
    """
    Tests text formatting of floats of different sizes.
    """
    sample = testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Types", [
          [22, "numeric", "Numeric", False, "", "", ""],
          [23, "other", "Text", False, "", "", ""],
        ]],
      ],
      "DATA": {
        "Types": [["id", "numeric"]] + [[i+1, 1.23456789 * 10 ** (i-20)] for i in range(40)]
      },
    })
    self.load_sample(sample)

    out_actions = self.apply_user_action(["ModifyColumn", "Types", "numeric", { "type" : "Text" }])
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["ModifyColumn", "Types", "numeric", {"type": "Text"}],
        ["BulkUpdateRecord", "Types",
         [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
          21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40],
         {"numeric": ["1.23456789e-20",
                      "1.23456789e-19",
                      "1.23456789e-18",
                      "1.23456789e-17",
                      "1.23456789e-16",
                      "1.23456789e-15",
                      "1.23456789e-14",
                      "1.23456789e-13",
                      "1.23456789e-12",
                      "1.23456789e-11",
                      "1.23456789e-10",
                      "1.23456789e-09",
                      "1.23456789e-08",
                      "1.23456789e-07",
                      "1.23456789e-06",
                      "1.23456789e-05",
                      "0.000123456789",
                      "0.00123456789",
                      "0.0123456789",
                      "0.123456789",
                      "1.23456789",
                      "12.3456789",
                      "123.456789",
                      "1234.56789",
                      "12345.6789",
                      "123456.789",
                      "1234567.89",
                      "12345678.9",
                      "123456789",
                      "1234567890",
                      "12345678900",
                      "123456789000",
                      "1234567890000",
                      "12345678900000",
                      "123456789000000",
                      "1234567890000000",
                      "1.23456789e+16",
                      "1.23456789e+17",
                      "1.23456789e+18",
                      "1.23456789e+19"]}],
        ["UpdateRecord", "_grist_Tables_column", 22, {"type": "Text"}],
      ],
      "undo": [
        ["BulkUpdateRecord", "Types",
         [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
          21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40],
         {"numeric": [1.2345678899999998e-20,
                      1.2345678899999999e-19,
                      1.23456789e-18,
                      1.23456789e-17,
                      1.2345678899999998e-16,
                      1.23456789e-15,
                      1.23456789e-14,
                      1.23456789e-13,
                      1.2345678899999998e-12,
                      1.2345678899999998e-11,
                      1.2345678899999998e-10,
                      1.23456789e-09,
                      1.2345678899999999e-08,
                      1.23456789e-07,
                      1.2345678899999998e-06,
                      1.23456789e-05,
                      0.000123456789,
                      0.00123456789,
                      0.012345678899999999,
                      0.123456789,
                      1.23456789,
                      12.3456789,
                      123.45678899999999,
                      1234.5678899999998,
                      12345.678899999999,
                      123456.78899999999,
                      1234567.89,
                      12345678.899999999,
                      123456788.99999999,
                      1234567890.0,
                      12345678899.999998,
                      123456788999.99998,
                      1234567890000.0,
                      12345678899999.998,
                      123456788999999.98,
                      1234567890000000.0,
                      1.2345678899999998e+16,
                      1.2345678899999998e+17,
                      1.23456789e+18,
                      1.2345678899999998e+19]}],
        ["ModifyColumn", "Types", "numeric", {"type": "Numeric"}],
        ["UpdateRecord", "_grist_Tables_column", 22, {"type": "Numeric"}],
      ]
    })

  def test_int_conversions(self):
    """
    Tests that column type changes occur as expected in the sandbox:
     - Resulting cell values should all be of type Int or AltText
     - Only non-compatible values should appear in the resulting BulkUpdateRecord
    """
    self.load_sample(self.sample)

    # Test Text -> Int conversion
    out_actions = self.apply_user_action(["ModifyColumn", "Types", "text", { "type" : "Int" }])
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["ModifyColumn", "Types", "text", {"type": "Int"}],
        ["BulkUpdateRecord", "Types", [13, 14, 16, 19], {"text": [0, 1, 8, None]}],
        ["UpdateRecord", "_grist_Tables_column", 21, {"type": "Int"}],
      ],
      "undo": [
        ["BulkUpdateRecord", "Types", [13, 14, 16, 19],
          {"text": [False, True, 8.153, ""]}],
        ["ModifyColumn", "Types", "text", {"type": "Text"}],
        ["UpdateRecord", "_grist_Tables_column", 21, {"type": "Text"}],
      ]
    })

    # Test Numeric -> Int conversion
    out_actions = self.apply_user_action(["ModifyColumn", "Types", "numeric", { "type" : "Int" }])
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["ModifyColumn", "Types", "numeric", {"type": "Int"}],
        ["BulkUpdateRecord", "Types", [13, 14, 16, 19],
         {"numeric": [0, 1, 8, None]}],
        ["UpdateRecord", "_grist_Tables_column", 22, {"type": "Int"}],
      ] + six.PY2 * [["UpdateRecord", "Formulas", 1, {"division": 0}]],  # Only in Python 2 due to integer division,
      "undo": [
        ["BulkUpdateRecord", "Types", [13, 14, 16, 19],
          {"numeric": [False, True, 8.153, ""]}],
        ["ModifyColumn", "Types", "numeric", {"type": "Numeric"}],
        ["UpdateRecord", "_grist_Tables_column", 22, {"type": "Numeric"}],
      ] + six.PY2 * [["UpdateRecord", "Formulas", 1, {"division": 0.5}]],  # Only in Python 2 due to integer division
    })

    # Test Int -> Int conversion
    out_actions = self.apply_user_action(["ModifyColumn", "Types", "int", { "type" : "Int" }])
    self.assertPartialOutActions(out_actions, {
      "stored": [],
      "undo": []
    })

    # Test Bool -> Int conversion
    out_actions = self.apply_user_action(["ModifyColumn", "Types", "bool", { "type" : "Int" }])
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["ModifyColumn", "Types", "bool", {"type": "Int"}],
        ["BulkUpdateRecord", "Types", [13, 14, 16, 17, 18, 19],
          {"bool": [0, 1, 8, 0, 1, None]}],
        ["UpdateRecord", "_grist_Tables_column", 24, {"type": "Int"}],
      ],
      "undo": [
        ["BulkUpdateRecord", "Types", [13, 14, 16, 17, 18, 19],
          {"bool": [False, True, 8.153, False, True, ""]}],
        ["ModifyColumn", "Types", "bool", {"type": "Bool"}],
        ["UpdateRecord", "_grist_Tables_column", 24, {"type": "Bool"}],
      ]
    })

    # Test Date -> Int conversion
    out_actions = self.apply_user_action(["ModifyColumn", "Types", "date", { "type" : "Int" }])
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["ModifyColumn", "Types", "date", {"type": "Int"}],
        ["BulkUpdateRecord", "Types", [13, 14, 16, 19],
          {"date": [0, 1, 8, None]}],
        ["UpdateRecord", "_grist_Tables_column", 25, {"type": "Int"}]
      ],
      "undo": [
        ["BulkUpdateRecord", "Types", [13, 14, 16, 19],
          {"date": [False, True, 8.153, ""]}],
        ["ModifyColumn", "Types", "date", {"type": "Date"}],
        ["UpdateRecord", "_grist_Tables_column", 25, {"type": "Date"}]
      ]
    })

    # Assert that the final table is as expected
    self.assertTableData("Types", data=[
      ["id", "text",     "numeric",  "int",      "bool",     "date"],
      [11,   "New York", "New York", "New York", "New York", "New York"],
      [12,   u"Chîcágö",  u"Chîcágö",  u"Chîcágö",  u"Chîcágö",  u"Chîcágö"],
      [13,   0,          0,          False,      0,          0],
      [14,   1,          1,          True,       1,          1],
      [15,   1509556595, 1509556595, 1509556595, 1509556595, 1509556595],
      [16,   8,          8,          8.153,      8,          8],
      [17,   0,          0,          0,          0,          0],
      [18,   1,          1,          1,          1,          1],
      [19,   None,       None,       "",         None,       None],
      [20,   None,       None,       None,       None,       None]
    ])


  def test_bool_conversions(self):
    """
    Tests that column type changes occur as expected in the sandbox:
     - Resulting cell values should all be of type Bool or AltText
     - Only non-compatible values should appear in the resulting BulkUpdateRecord
    """
    self.load_sample(self.sample)

    # Test Text -> Bool conversion
    out_actions = self.apply_user_action(["ModifyColumn", "Types", "text", { "type" : "Bool" }])
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["ModifyColumn", "Types", "text", {"type": "Bool"}],
        ["BulkUpdateRecord", "Types", [15, 16, 17, 18, 19, 20],
          {"text": [True, True, False, True, False, False]}],
        ["UpdateRecord", "_grist_Tables_column", 21, {"type": "Bool"}],
      ],
      "undo": [
        ["BulkUpdateRecord", "Types", [15, 16, 17, 18, 19, 20],
          {"text": [1509556595, 8.153, 0, 1, "", None]}],
        ["ModifyColumn", "Types", "text", {"type": "Text"}],
        ["UpdateRecord", "_grist_Tables_column", 21, {"type": "Text"}],
      ]
    })

    # Test Numeric -> Bool conversion
    out_actions = self.apply_user_action(["ModifyColumn", "Types", "numeric", { "type" : "Bool" }])
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["ModifyColumn", "Types", "numeric", {"type": "Bool"}],
        ["BulkUpdateRecord", "Types", [15, 16, 17, 18, 19, 20],
          {"numeric": [True, True, False, True, False, False]}],
        ["UpdateRecord", "_grist_Tables_column", 22, {"type": "Bool"}],
      ] + six.PY2 * [["UpdateRecord", "Formulas", 1, {"division": 0}]],  # Only in Python 2 due to integer division,
      "undo": [
        ["BulkUpdateRecord", "Types", [15, 16, 17, 18, 19, 20],
          {"numeric": [1509556595.0, 8.153, 0.0, 1.0, "", None]}],
        ["ModifyColumn", "Types", "numeric", {"type": "Numeric"}],
        ["UpdateRecord", "_grist_Tables_column", 22, {"type": "Numeric"}],
      ] + six.PY2 * [["UpdateRecord", "Formulas", 1, {"division": 0.5}]],  # Only in Python 2 due to integer division
    })

    # Test Int -> Bool conversion
    out_actions = self.apply_user_action(["ModifyColumn", "Types", "int", { "type" : "Bool" }])
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["ModifyColumn", "Types", "int", {"type": "Bool"}],
        ["BulkUpdateRecord", "Types", [15, 16, 17, 18, 19, 20],
          {"int": [True, True, False, True, False, False]}],
        ["UpdateRecord", "_grist_Tables_column", 23, {"type": "Bool"}],
      ],
      "undo": [
        ["BulkUpdateRecord", "Types", [15, 16, 17, 18, 19, 20],
          {"int": [1509556595, 8.153, 0, 1, "", None]}],
        ["ModifyColumn", "Types", "int", {"type": "Int"}],
        ["UpdateRecord", "_grist_Tables_column", 23, {"type": "Int"}],
      ]
    })

    # Test Bool -> Bool conversion
    out_actions = self.apply_user_action(["ModifyColumn", "Types", "bool", { "type" : "Bool" }])
    self.assertPartialOutActions(out_actions, {
      "stored": [],
      "undo": []
    })

    # Test Date -> Bool conversion
    out_actions = self.apply_user_action(["ModifyColumn", "Types", "date", { "type" : "Bool" }])
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["ModifyColumn", "Types", "date", {"type": "Bool"}],
        ["BulkUpdateRecord", "Types", [15, 16, 17, 18, 19, 20],
          {"date": [True, True, False, True, False, False]}],
        ["UpdateRecord", "_grist_Tables_column", 25, {"type": "Bool"}]
      ],
      "undo": [
        ["BulkUpdateRecord", "Types", [15, 16, 17, 18, 19, 20],
          {"date": [1509556595, 8.153, 0, 1, "", None]}],
        ["ModifyColumn", "Types", "date", {"type": "Date"}],
        ["UpdateRecord", "_grist_Tables_column", 25, {"type": "Date"}]
      ]
    })

    # Assert that the final table is as expected
    self.assertTableData("Types", data=[
      ["id", "text",     "numeric",  "int",      "bool",     "date"],
      [11,   "New York", "New York", "New York", "New York", "New York"],
      [12,   u"Chîcágö",  u"Chîcágö",  u"Chîcágö",  u"Chîcágö",  u"Chîcágö"],
      [13,   False,      False,      False,      False,      False],
      [14,   True,       True,       True,       True,       True],
      [15,   True,       True,       True,       1509556595, True],
      [16,   True,       True,       True,       8.153,      True],
      [17,   False,      False,      False,      0,          False],
      [18,   True,       True,       True,       1,          True],
      [19,   False,      False,      False,      "",         False],
      [20,   False,      False,      False,      None,       False]
    ])


  def test_date_conversions(self):
    """
    Tests that column type changes occur as expected in the sandbox:
     - Resulting cell values should all be of type Date or AltText
     - Only non-compatible values should appear in the resulting BulkUpdateRecord
    """
    self.load_sample(self.sample)

    # Test Text -> Date conversion
    out_actions = self.apply_user_action(["ModifyColumn", "Types", "text", { "type" : "Date" }])
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["ModifyColumn", "Types", "text", {"type": "Date"}],
        ["BulkUpdateRecord", "Types", [13, 14, 19],
          {"text": [0.0, 1.0, None]}],
        ["UpdateRecord", "_grist_Tables_column", 21, {"type": "Date"}],
      ],
      "undo": [
        ["BulkUpdateRecord", "Types", [13, 14, 19],
          {"text": [False, True, ""]}],
        ["ModifyColumn", "Types", "text", {"type": "Text"}],
        ["UpdateRecord", "_grist_Tables_column", 21, {"type": "Text"}],
      ]
    })

    # Test Numeric -> Date conversion
    out_actions = self.apply_user_action(["ModifyColumn", "Types", "numeric", { "type" : "Date" }])
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["ModifyColumn", "Types", "numeric", {"type": "Date"}],
        ["BulkUpdateRecord", "Types", [13, 14, 19],
          {"numeric": [0.0, 1.0, None]}],
        ["UpdateRecord", "_grist_Tables_column", 22, {"type": "Date"}],
        ["UpdateRecord", "Formulas", 1, {"division": ["E", "TypeError"]}],
      ],
      "undo": [
        ["BulkUpdateRecord", "Types", [13, 14, 19],
          {"numeric": [False, True, ""]}],
        ["ModifyColumn", "Types", "numeric", {"type": "Numeric"}],
        ["UpdateRecord", "_grist_Tables_column", 22, {"type": "Numeric"}],
        ["UpdateRecord", "Formulas", 1, {"division": 0.5}],
      ]
    })

    # Test Int -> Date conversion
    out_actions = self.apply_user_action(["ModifyColumn", "Types", "int", { "type" : "Date" }])
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["ModifyColumn", "Types", "int", {"type": "Date"}],
        ["BulkUpdateRecord", "Types", [13, 14, 19],
          {"int": [0.0, 1.0, None]}],
        ["UpdateRecord", "_grist_Tables_column", 23, {"type": "Date"}],
      ],
      "undo": [
        ["BulkUpdateRecord", "Types", [13, 14, 19],
          {"int": [False, True, ""]}],
        ["ModifyColumn", "Types", "int", {"type": "Int"}],
        ["UpdateRecord", "_grist_Tables_column", 23, {"type": "Int"}],
      ]
    })

    # Test Bool -> Date conversion
    out_actions = self.apply_user_action(["ModifyColumn", "Types", "bool", { "type" : "Date" }])
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["ModifyColumn", "Types", "bool", {"type": "Date"}],
        ["BulkUpdateRecord", "Types", [13, 14, 17, 18, 19],
          {"bool": [0.0, 1.0, 0.0, 1.0, None]}],
        ["UpdateRecord", "_grist_Tables_column", 24, {"type": "Date"}]
      ],
      "undo": [
        ["BulkUpdateRecord", "Types", [13, 14, 17, 18, 19],
          {"bool": [False, True, False, True, ""]}],
        ["ModifyColumn", "Types", "bool", {"type": "Bool"}],
        ["UpdateRecord", "_grist_Tables_column", 24, {"type": "Bool"}]
      ]
    })

    # Test Date -> Date conversion
    out_actions = self.apply_user_action(["ModifyColumn", "Types", "date", { "type" : "Date" }])
    self.assertPartialOutActions(out_actions, {
      "stored": [],
      "undo": []
    })

    # Assert that the final table is as expected
    self.assertTableData("Types", data=[
      ["id", "text",     "numeric",  "int",      "bool",     "date"],
      [11,   "New York", "New York", "New York", "New York", "New York"],
      [12,   u"Chîcágö",  u"Chîcágö",  u"Chîcágö",  u"Chîcágö",  u"Chîcágö"],
      [13,   0.0,        0.0,        0.0,        0.0,        False],
      [14,   1.0,        1.0,        1.0,        1.0,        True],
      [15,   1509556595, 1509556595, 1509556595, 1509556595, 1509556595],
      [16,   8.153,      8.153,      8.153,      8.153,      8.153],
      [17,   0.0,        0.0,        0.0,        0.0,        0],
      [18,   1.0,        1.0,        1.0,        1.0,        1],
      [19,   None,       None,       None,       None,        ""],
      [20,   None,       None,       None,       None,       None]
    ])

  def test_numerics_are_floats(self):
    """
    Tests that in formulas, numeric values are floats, not integers.
    Important to avoid truncation.
    """
    self.load_sample(self.sample)
    self.assertTableData('Formulas', data=[
      ['id', 'division'],
      [ 1,   0.5],
    ])
