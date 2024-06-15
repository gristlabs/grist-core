# -*- coding: utf-8 -*-

import json

import test_engine
import testsamples
import useractions

class TestDCRenames(test_engine.EngineTestCase):

  def setUp(self):
    super(TestDCRenames, self).setUp()

    self.load_sample(testsamples.sample_students)

    self.engine.apply_user_actions([useractions.from_repr(ua) for ua in (
      # Add some irrelevant columns to the table Schools. These should never be renamed.
      ["AddColumn", "Schools", "name2", {
        "type": "Text"
      }],
      ["AddColumn", "Schools", "choice", {
        "type": "Ref:Address"
      }],
      ["AddColumn", "Address", "rec", {
        "type": "Text"
      }],
      # Add a dropdown condition formula to Schools.address (column #12).
      ["ModifyColumn", "Schools", "address", {
        "widgetOptions": json.dumps({
          "dropdownCondition": {
            "text": "'New' in choice.city and $name == rec.name + rec.choice.city or choice.rec.city != $name2",
          }
        }),
      }],
      # Create a similar column with an invalid dropdown condition formula.
      # This formula should never be touched.
      # This column will have the ID 25.
      ["AddColumn", "Schools", "address2", {
        "type": "Ref:Address",
        "widgetOptions": json.dumps({
          "dropdownCondition": {
            "text": "+ 'New' in choice.city and $name == rec.name",
          }
        }),
      }],
    )])

    # This is what we'll have at the beginning, for later tests to refer to.
    # Table Schools is 2.
    self.assertTableData("_grist_Tables_column", cols="subset", rows="subset", data=[
      ["id", "parentId", "colId", "widgetOptions"],
      [12, 2, "address", json.dumps({
        "dropdownCondition": {
          "text": "'New' in choice.city and $name == rec.name + rec.choice.city or choice.rec.city != $name2",
          # The ModifyColumn user action should trigger an auto parse.
          # "parsed" is stored as dumped JSON, so we need to explicitly dump it here as well.
          "parsed": json.dumps(["Or", ["And", ["In", ["Const", "New"], ["Attr", ["Name", "choice"], "city"]], ["Eq", ["Attr", ["Name", "rec"], "name"], ["Add", ["Attr", ["Name", "rec"], "name"], ["Attr", ["Attr", ["Name", "rec"], "choice"], "city"]]]], ["NotEq", ["Attr", ["Attr", ["Name", "choice"], "rec"], "city"], ["Attr", ["Name", "rec"], "name2"]]])
        }
      })],
    ])
    self.assert_invalid_formula_untouched()

  def assert_invalid_formula_untouched(self):
    self.assertTableData("_grist_Tables_column", cols="subset", rows="subset", data=[
      ["id", "parentId", "colId", "widgetOptions"],
      [25, 2, "address2", json.dumps({
        "dropdownCondition": {
          "text": "+ 'New' in choice.city and $name == rec.name",
        }
      })]
    ])

  def test_referred_column_renames(self):
    # Rename the column "city" in table "Address" to "area". Schools.address refers to it.
    self.apply_user_action(["RenameColumn", "Address", "city", "area"])
    # Now choice.city should become choice.area. This should also be reflected in the parsed formula.
    self.assertTableData("_grist_Tables_column", cols="subset", rows="subset", data=[
      ["id", "parentId", "colId", "widgetOptions"],
      [12, 2, "address", json.dumps({
        "dropdownCondition": {
          "text": "'New' in choice.area and $name == rec.name + rec.choice.city or choice.rec.city != $name2",
          "parsed": json.dumps(["Or", ["And", ["In", ["Const", "New"], ["Attr", ["Name", "choice"], "area"]], ["Eq", ["Attr", ["Name", "rec"], "name"], ["Add", ["Attr", ["Name", "rec"], "name"], ["Attr", ["Attr", ["Name", "rec"], "choice"], "city"]]]], ["NotEq", ["Attr", ["Attr", ["Name", "choice"], "rec"], "city"], ["Attr", ["Name", "rec"], "name2"]]])
        }
      })],
    ])
    self.assert_invalid_formula_untouched()

  def test_record_column_renames(self):
    # Rename the column "name" in table "Schools" to "identifier". Schools.address refers to it in two ways -
    # the dollar sign and "rec.".
    self.apply_user_action(["RenameColumn", "Schools", "name", "identifier"])
    # Now "$name" should become "$identifier" while "rec.name" should become "rec.identifier".
    self.assertTableData("_grist_Tables_column", cols="subset", rows="subset", data=[
      ["id", "parentId", "colId", "widgetOptions"],
      [12, 2, "address", json.dumps({
        "dropdownCondition": {
          "text": "'New' in choice.city and $identifier == rec.identifier + rec.choice.city or choice.rec.city != $name2",
          "parsed": json.dumps(["Or", ["And", ["In", ["Const", "New"], ["Attr", ["Name", "choice"], "city"]], ["Eq", ["Attr", ["Name", "rec"], "identifier"], ["Add", ["Attr", ["Name", "rec"], "identifier"], ["Attr", ["Attr", ["Name", "rec"], "choice"], "city"]]]], ["NotEq", ["Attr", ["Attr", ["Name", "choice"], "rec"], "city"], ["Attr", ["Name", "rec"], "name2"]]])
        }
      })],
    ])
    self.assert_invalid_formula_untouched()

  def test_multiple_renames(self):
    # Put all renames together.
    self.apply_user_action(["RenameColumn", "Address", "city", "area"])
    self.apply_user_action(["RenameColumn", "Schools", "name", "identifier"])
    self.assertTableData("_grist_Tables_column", cols="subset", rows="subset", data=[
      ["id", "parentId", "colId", "widgetOptions"],
      [12, 2, "address", json.dumps({
        "dropdownCondition": {
          "text": "'New' in choice.area and $identifier == rec.identifier + rec.choice.city or choice.rec.city != $name2",
          "parsed": json.dumps(["Or", ["And", ["In", ["Const", "New"], ["Attr", ["Name", "choice"], "area"]], ["Eq", ["Attr", ["Name", "rec"], "identifier"], ["Add", ["Attr", ["Name", "rec"], "identifier"], ["Attr", ["Attr", ["Name", "rec"], "choice"], "city"]]]], ["NotEq", ["Attr", ["Attr", ["Name", "choice"], "rec"], "city"], ["Attr", ["Name", "rec"], "name2"]]])
        }
      })],
    ])
    self.assert_invalid_formula_untouched()
