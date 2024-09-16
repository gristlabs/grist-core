# -*- coding: utf-8 -*-
# pylint: disable=line-too-long

import json

import test_engine
import testsamples
import useractions

# A sample dropdown condition formula for the column Schools.address and alike, of type Ref/RefList.
def build_dc1_text(school_name, address_city):
  return "'New' in choice.{address_city} and ${school_name} == rec.{school_name} + rec.choice.city or choice.rec.city != $name2".format(**locals())

# Another sample formula for a new column of type ChoiceList (or actually, anything other than Ref/RefList).
def build_dc2_text(school_name, school_address):
  # We currently don't support layered attribute access, e.g. rec.address.city, so this is not tested.
  # choice.city really is nonsense, as choice will not be an object.
  # Just for testing purposes, to make sure nothing is renamed here.
  return "choice + ${school_name} == choice.city or rec.{school_address} > 2".format(**locals())

def build_dc1(school_name, address_city):
  return json.dumps({
    "dropdownCondition": {
      "text": build_dc1_text(school_name, address_city),
      # The ModifyColumn user action should trigger an auto parse.
      # "parsed" is stored as dumped JSON, so we need to explicitly dump it here as well.
      "parsed": json.dumps(["Or", ["And", ["In", ["Const", "New"], ["Attr", ["Name", "choice"], address_city]], ["Eq", ["Attr", ["Name", "rec"], school_name], ["Add", ["Attr", ["Name", "rec"], school_name], ["Attr", ["Attr", ["Name", "rec"], "choice"], "city"]]]], ["NotEq", ["Attr", ["Attr", ["Name", "choice"], "rec"], "city"], ["Attr", ["Name", "rec"], "name2"]]])
    }
  })

def build_dc2(school_name, school_address):
  return json.dumps({
    "dropdownCondition": {
      "text": build_dc2_text(school_name, school_address),
      "parsed": json.dumps(["Or", ["Eq", ["Add", ["Name", "choice"], ["Attr", ["Name", "rec"], school_name]], ["Attr", ["Name", "choice"], "city"]], ["Gt", ["Attr", ["Name", "rec"], school_address], ["Const", 2]]])
    }
  })

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
            "text": build_dc1_text("name", "city"),
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
      # And another similar column, but of type RefList.
      # This column will have the ID 26.
      ["AddColumn", "Schools", "addresses", {
        "type": "RefList:Address",
      }],
      # AddColumn will not trigger parsing. We emulate a real user's action here by creating it first,
      # then editing its widgetOptions.
      ["ModifyColumn", "Schools", "addresses", {
        "widgetOptions": json.dumps({
          "dropdownCondition": {
            "text": build_dc1_text("name", "city"),
          }
        }),
      }],
      # And another similar column, but of type ChoiceList.
      # widgetOptions stay when the column type changes. We do our best to rename stuff in stray widgetOptions.
      # This column will have the ID 27.
      ["AddColumn", "Schools", "features", {
        "type": "ChoiceList",
      }],
      ["ModifyColumn", "Schools", "features", {
        "widgetOptions": json.dumps({
          "dropdownCondition": {
            "text": build_dc2_text("name", "address"),
          }
        }),
      }],
    )])

    # This is what we'll have at the beginning, for later tests to refer to.
    # Table Schools is 2.
    self.assertTableData("_grist_Tables_column", cols="subset", rows="subset", data=[
      ["id", "parentId", "colId", "widgetOptions"],
      [12, 2, "address", build_dc1("name", "city")],
      [26, 2, "addresses", build_dc1("name", "city")],
      [27, 2, "features", build_dc2("name", "address")],
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
    self.apply_user_action(["RenameColumn", "Address", "city", "area"])
    self.assertTableData("_grist_Tables_column", cols="subset", rows="subset", data=[
      ["id", "parentId", "colId", "widgetOptions"],
      [12, 2, "address", build_dc1("name", "area")],
      [26, 2, "addresses", build_dc1("name", "area")],
      # Nothing should be renamed here, as only column renames in the table "Schools" are relevant.
      [27, 2, "features", build_dc2("name", "address")],
    ])
    self.assert_invalid_formula_untouched()

  def test_record_column_renames(self):
    self.apply_user_action(["RenameColumn", "Schools", "name", "identifier"])
    self.apply_user_action(["RenameColumn", "Schools", "address", "location"])
    self.assertTableData("_grist_Tables_column", cols="subset", rows="subset", data=[
      ["id", "parentId", "colId", "widgetOptions"],
      # Side effect: "address" becomes "location".
      [12, 2, "location", build_dc1("identifier", "city")],
      [26, 2, "addresses", build_dc1("identifier", "city")],
      # Now "$name" should become "$identifier", just like in Ref/RefList columns. Nothing else should change.
      [27, 2, "features", build_dc2("identifier", "location")],
    ])
    self.assert_invalid_formula_untouched()

  def test_multiple_renames(self):
    # Put all renames together.
    self.apply_user_action(["RenameColumn", "Address", "city", "area"])
    self.apply_user_action(["RenameColumn", "Schools", "name", "identifier"])
    self.assertTableData("_grist_Tables_column", cols="subset", rows="subset", data=[
      ["id", "parentId", "colId", "widgetOptions"],
      [12, 2, "address", build_dc1("identifier", "area")],
      [26, 2, "addresses", build_dc1("identifier", "area")],
      [27, 2, "features", build_dc2("identifier", "address")],
    ])
    self.assert_invalid_formula_untouched()

  def test_rename_when_null_widget_options(self):
    # Create a column with None for widget options. Just a presence of such a column was causing
    # an error at one point.
    self.engine.apply_user_actions([useractions.from_repr(ua) for ua in (
      ["AddColumn", "Schools", "dummy", {
        "type": "Text",
        "widgetOptions": None,
      }],
    )])

    # Check that rename works when it needs to affect a dropdown condition.
    # First check the dropdown condition before the rename.
    self.assertTableData("_grist_Tables_column", cols="subset", rows="subset", data=[
      ["id", "parentId", "colId", "widgetOptions"],
      [12, 2, "address", build_dc1("name", "city")],
    ])

    self.apply_user_action(["RenameColumn", "Address", "city", "area"])

    # Check the condition got updated after the rename.
    self.assertTableData("_grist_Tables_column", cols="subset", rows="subset", data=[
      ["id", "parentId", "colId", "widgetOptions"],
      [12, 2, "address", build_dc1("name", "area")],
    ])
