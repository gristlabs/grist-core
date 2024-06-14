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
      # Column #12 is "address" in table "Schools". We add a dropdown condition formula to it.
      ["UpdateRecord", "_grist_Tables_column", 12, {
        "widgetOptions": json.dumps({
          "dropdownCondition": {
            "text": "'New' in choice.city and $name == rec.name",
          }
        }),
      }],
    )])

    # This is what we"ll have at the beginning, for later tests to refer to.
    self.assertTableData("_grist_Tables_column", cols="subset", rows="subset", data=[
      ["id",  "type",         "widgetOptions"],
      [12,    "Ref:Address",  json.dumps({
        "dropdownCondition": {
          "text": "'New' in choice.city and $name == rec.name",
          # The UpdateRecord user action should trigger an auto parse.
          # "parsed" is stored as dumped JSON, so we need to explicitly dump it here as well.
          "parsed": json.dumps(["And", ["In", ["Const", "New"], ["Attr", ["Name", "choice"], "city"]],
                                ["Eq", ["Attr", ["Name", "rec"], "name"], ["Attr", ["Name", "rec"], "name"]]])
        }
      })],
    ])

  def test_referred_column_renames(self):
    # Rename the column "city" in table "Address" to "area". Schools.address refers to it.
    self.apply_user_action(["RenameColumn", "Address", "city", "area"])
    # Now choice.city should become choice.area. This should also be reflected in the parsed formula.
    self.assertTableData("_grist_Tables_column", cols="subset", rows="subset", data=[
      ["id",  "type",         "widgetOptions"],
      [12,    "Ref:Address",  json.dumps({
        "dropdownCondition": {
          "text": "'New' in choice.area and $name == rec.name",
          "parsed": json.dumps(["And", ["In", ["Const", "New"], ["Attr", ["Name", "choice"], "area"]],
                                ["Eq", ["Attr", ["Name", "rec"], "name"], ["Attr", ["Name", "rec"], "name"]]])
        }
      })],
    ])

  def test_record_column_renames(self):
    # Rename the column "name" in table "Schools" to "identifier". Schools.address refers to it in two ways -
    # the dollar sign and "rec.".
    self.apply_user_action(["RenameColumn", "Schools", "name", "identifier"])
    # Now "$name" should become "$identifier" while "rec.name" should become "rec.identifier".
    self.assertTableData("_grist_Tables_column", cols="subset", rows="subset", data=[
      ["id",  "type",         "widgetOptions"],
      [12,    "Ref:Address",  json.dumps({
        "dropdownCondition": {
          "text": "'New' in choice.city and $identifier == rec.identifier",
          "parsed": json.dumps(["And", ["In", ["Const", "New"], ["Attr", ["Name", "choice"], "city"]],
                                ["Eq", ["Attr", ["Name", "rec"], "identifier"], ["Attr", ["Name", "rec"], "identifier"]]])
        }
      })],
    ])

  def test_multiple_renames(self):
    # Put all renames together.
    self.apply_user_action(["RenameColumn", "Address", "city", "area"])
    self.apply_user_action(["RenameColumn", "Schools", "name", "identifier"])
    self.assertTableData("_grist_Tables_column", cols="subset", rows="subset", data=[
      ["id",  "type",         "widgetOptions"],
      [12,    "Ref:Address",  json.dumps({
        "dropdownCondition": {
          "text": "'New' in choice.area and $identifier == rec.identifier",
          "parsed": json.dumps(["And", ["In", ["Const", "New"], ["Attr", ["Name", "choice"], "area"]],
                                ["Eq", ["Attr", ["Name", "rec"], "identifier"], ["Attr", ["Name", "rec"], "identifier"]]])
        }
      })],
    ])
