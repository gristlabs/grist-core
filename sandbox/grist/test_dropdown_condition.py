# -*- coding: utf-8 -*-
# pylint:disable=line-too-long
import json

import test_engine

class TestDropdownConditionUserActions(test_engine.EngineTestCase):
  def test_dropdown_condition_col_actions(self):
    self.apply_user_action(['AddTable', 'Table1', [
      {'id': 'A', 'type': 'Text'},
      {'id': 'B', 'type': 'Text'},
      {'id': 'C', 'type': 'Text'},
    ]])

    # Check that setting dropdownCondition.text automatically sets a parsed version.
    out_actions = self.apply_user_action(['UpdateRecord', '_grist_Tables_column', 1, {
        "widgetOptions": json.dumps({
          "dropdownCondition": {
            "text": 'choice.Role == "Manager"',
          },
        }),
    }])
    self.assertPartialOutActions(out_actions, { "stored": [
      ["UpdateRecord", "_grist_Tables_column", 1, {
        "widgetOptions": "{\"dropdownCondition\": {\"text\": "
          + "\"choice.Role == \\\"Manager\\\"\", \"parsed\": "
          + "\"[\\\"Eq\\\", [\\\"Attr\\\", [\\\"Name\\\", \\\"choice\\\"], "
          + "\\\"Role\\\"], [\\\"Const\\\", \\\"Manager\\\"]]\"}}"
      }]
    ]})
    out_actions = self.apply_user_action(['BulkUpdateRecord', '_grist_Tables_column', [2, 3], {
      "widgetOptions": [
        json.dumps({
          "dropdownCondition": {
            "text": 'choice == "Manager"',
          },
        }),
        json.dumps({
          "dropdownCondition": {
            "text": '$Role == "Manager"',
          },
        }),
      ],
    }])
    self.assertPartialOutActions(out_actions, { "stored": [
      ["BulkUpdateRecord", "_grist_Tables_column", [2, 3], {
        "widgetOptions": [
          "{\"dropdownCondition\": {\"text\": \"choice == "
            + "\\\"Manager\\\"\", \"parsed\": \"[\\\"Eq\\\", "
            + "[\\\"Name\\\", \\\"choice\\\"], [\\\"Const\\\", \\\"Manager\\\"]]\"}}",
          "{\"dropdownCondition\": {\"text\": \"$Role == "
            + "\\\"Manager\\\"\", \"parsed\": \"[\\\"Eq\\\", "
            + "[\\\"Attr\\\", [\\\"Name\\\", \\\"rec\\\"], \\\"Role\\\"], "
            + "[\\\"Const\\\", \\\"Manager\\\"]]\"}}",
        ]
      }]
    ]})

  def test_dropdown_condition_field_actions(self):
    self.apply_user_action(['AddTable', 'Table1', [
      {'id': 'A', 'type': 'Text'},
      {'id': 'B', 'type': 'Text'},
      {'id': 'C', 'type': 'Text'},
    ]])

    # Check that setting dropdownCondition.text automatically sets a parsed version.
    out_actions = self.apply_user_action(['UpdateRecord', '_grist_Views_section_field', 1, {
        "widgetOptions": json.dumps({
          "dropdownCondition": {
            "text": 'choice.Role == "Manager"',
          },
        }),
    }])
    self.assertPartialOutActions(out_actions, { "stored": [
      ["UpdateRecord", "_grist_Views_section_field", 1, {
        "widgetOptions": "{\"dropdownCondition\": {\"text\": "
          + "\"choice.Role == \\\"Manager\\\"\", \"parsed\": "
          + "\"[\\\"Eq\\\", [\\\"Attr\\\", [\\\"Name\\\", \\\"choice\\\"], "
          + "\\\"Role\\\"], [\\\"Const\\\", \\\"Manager\\\"]]\"}}"
      }]
    ]})
    out_actions = self.apply_user_action(['BulkUpdateRecord', '_grist_Views_section_field', [2, 3], {
      "widgetOptions": [
        json.dumps({
          "dropdownCondition": {
            "text": 'choice == "Manager"',
          },
        }),
        json.dumps({
          "dropdownCondition": {
            "text": '$Role == "Manager"',
          },
        }),
      ],
    }])
    self.assertPartialOutActions(out_actions, { "stored": [
      ["BulkUpdateRecord", "_grist_Views_section_field", [2, 3], {
        "widgetOptions": [
          "{\"dropdownCondition\": {\"text\": \"choice == "
            + "\\\"Manager\\\"\", \"parsed\": \"[\\\"Eq\\\", "
            + "[\\\"Name\\\", \\\"choice\\\"], [\\\"Const\\\", \\\"Manager\\\"]]\"}}",
          "{\"dropdownCondition\": {\"text\": \"$Role == "
            + "\\\"Manager\\\"\", \"parsed\": \"[\\\"Eq\\\", "
            + "[\\\"Attr\\\", [\\\"Name\\\", \\\"rec\\\"], \\\"Role\\\"], "
            + "[\\\"Const\\\", \\\"Manager\\\"]]\"}}",
        ]
      }]
    ]})
