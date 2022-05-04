# -*- coding: utf-8 -*-
import json

from collections import namedtuple
from summary import skip_rules_update
import testutil
import test_engine


class TestRules(test_engine.EngineTestCase):
  sample = testutil.parse_test_sample({
    "SCHEMA": [
      [1, "Inventory", [
        [2, "Label", "Text", False, "", "", ""],
        [3, "Stock", "Int", False, "", "", ""],
      ]],
    ],
    "DATA": {
      "Inventory": [
        ["id", "Label", "Stock"],
        [1, "A1", 0],
        [2, "A2", 2],
        [3, "A3", 5],
        # Duplicate
        [4, "A1", 10]
      ],
    }
  })

  # Helper for rules action
  def add_empty(self, col_id):
    return self.apply_user_action(['AddEmptyRule', "Inventory", 0, col_id])

  def field_add_empty(self, field_id):
    return self.apply_user_action(['AddEmptyRule', "Inventory", field_id, 0])

  def set_rule(self, col_id, rule_index, formula):
    rules = self.engine.docmodel.columns.table.get_record(col_id).rules
    rule = list(rules)[rule_index]
    return self.apply_user_action(['UpdateRecord', '_grist_Tables_column',
                                   rule.id, {"formula": formula}])

  def field_set_rule(self, field_id, rule_index, formula):
    rules = self.engine.docmodel.view_fields.table.get_record(field_id).rules
    rule = list(rules)[rule_index]
    return self.apply_user_action(['UpdateRecord', '_grist_Tables_column',
                                   rule.id, {"formula": formula}])

  def remove_rule(self, col_id, rule_index):
    rules = self.engine.docmodel.columns.table.get_record(col_id).rules
    rule = list(rules)[rule_index]
    return self.apply_user_action(['RemoveColumn', 'Inventory', rule.colId])

  def field_remove_rule(self, field_id, rule_index):
    rules = self.engine.docmodel.view_fields.table.get_record(field_id).rules
    rule = list(rules)[rule_index]
    return self.apply_user_action(['RemoveColumn', 'Inventory', rule.colId])

  def test_summary_updates(self):
    Col = namedtuple('Col', 'widgetOptions')
    col = Col(None)
    # Should remove rules from update
    self.assertEqual({}, skip_rules_update(col, {'rules': [15]}))
    # Should leave col_updates untouched when there are no rules.
    col_updates = {'type': 'Int'}
    self.assertEqual(col_updates, skip_rules_update(col, col_updates))

    # Should return same dict when not updating ruleOptions
    col_updates = {'widgetOptions': '{"color": "red"}'}
    self.assertEqual(col_updates, skip_rules_update(col, col_updates))
    col = Col('{"color": "red"}')
    self.assertEqual(col_updates, skip_rules_update(col, col_updates))

    # Should remove ruleOptions from update
    col_updates = {'widgetOptions': '{"rulesOptions": [{"color": "black"}], "color": "blue"}'}
    self.assertEqual({'widgetOptions': '{"color": "blue"}'},
                         skip_rules_update(col, col_updates))
    col_updates = {'widgetOptions': '{"rulesOptions": [], "color": "blue"}'}
    self.assertEqual({'widgetOptions': '{"color": "blue"}'},
                         skip_rules_update(col, col_updates))

    # Should preserve original ruleOptions
    col = Col('{"rulesOptions": [{"color":"red"}], "color": "blue"}')
    col_updates = {'widgetOptions': '{"rulesOptions": [{"color": "black"}], "color": "red"}'}
    updated = skip_rules_update(col, col_updates)
    self.assertEqual({"rulesOptions": [{"color": "red"}], "color": "red"},
                         json.loads(updated.get('widgetOptions')))
    col_updates = {'widgetOptions': '{"color": "red"}'}
    updated = skip_rules_update(col, col_updates)
    self.assertEqual({"rulesOptions": [{"color": "red"}], "color": "red"},
                         json.loads(updated.get('widgetOptions')))


  def test_simple_rules(self):
    self.load_sample(self.sample)
    # Mark all records with Stock = 0
    out_actions = self.add_empty(3)
    self.assertPartialOutActions(out_actions, {"stored": [
      ["AddColumn", "Inventory", "gristHelper_ConditionalRule",
       {"formula": "", "isFormula": True, "type": "Any"}],
      ["AddRecord", "_grist_Tables_column", 4,
       {"colId": "gristHelper_ConditionalRule", "formula": "", "isFormula": True,
        "label": "gristHelper_ConditionalRule", "parentId": 1, "parentPos": 3.0,
        "type": "Any",
        "widgetOptions": ""}],
      ["UpdateRecord", "_grist_Tables_column", 3, {"rules": ["L", 4]}],
    ]})
    out_actions = self.set_rule(3, 0, "$Stock == 0")
    self.assertPartialOutActions(out_actions, {"stored": [
      ["ModifyColumn", "Inventory", "gristHelper_ConditionalRule",
       {"formula": "$Stock == 0"}],
      ["UpdateRecord", "_grist_Tables_column", 4, {"formula": "$Stock == 0"}],
      ["BulkUpdateRecord", "Inventory", [1, 2, 3, 4],
       {"gristHelper_ConditionalRule": [True, False, False, False]}],
    ]})

    # Replace this rule with another rule to mark Stock = 2
    out_actions = self.set_rule(3, 0, "$Stock == 2")
    self.assertPartialOutActions(out_actions, {"stored": [
      ["ModifyColumn", "Inventory", "gristHelper_ConditionalRule",
       {"formula": "$Stock == 2"}],
      ["UpdateRecord", "_grist_Tables_column", 4, {"formula": "$Stock == 2"}],
      ["BulkUpdateRecord", "Inventory", [1, 2],
       {"gristHelper_ConditionalRule": [False, True]}],
    ]})

    # Add another rule Stock = 10
    out_actions = self.add_empty(3)
    self.assertPartialOutActions(out_actions, {"stored": [
      ["AddColumn", "Inventory", "gristHelper_ConditionalRule2",
       {"formula": "", "isFormula": True, "type": "Any"}],
      ["AddRecord", "_grist_Tables_column", 5,
       {"colId": "gristHelper_ConditionalRule2", "formula": "", "isFormula": True,
        "label": "gristHelper_ConditionalRule2", "parentId": 1, "parentPos": 4.0,
        "type": "Any",
        "widgetOptions": ""}],
      ["UpdateRecord", "_grist_Tables_column", 3, {"rules": ["L", 4, 5]}],
    ]})
    out_actions = self.set_rule(3, 1, "$Stock == 10")
    self.assertPartialOutActions(out_actions, {"stored": [
      ["ModifyColumn", "Inventory", "gristHelper_ConditionalRule2",
       {"formula": "$Stock == 10"}],
      ["UpdateRecord", "_grist_Tables_column", 5, {"formula": "$Stock == 10"}],
      ["BulkUpdateRecord", "Inventory", [1, 2, 3, 4],
       {"gristHelper_ConditionalRule2": [False, False, False, True]}],
    ]})

    # Remove the last rule
    out_actions = self.remove_rule(3, 1)
    self.assertPartialOutActions(out_actions, {"stored": [
      ["RemoveRecord", "_grist_Tables_column", 5],
      ["UpdateRecord", "_grist_Tables_column", 3, {"rules": ["L", 4]}],
      ["RemoveColumn", "Inventory", "gristHelper_ConditionalRule2"]
    ]})

    # Remove last rule
    out_actions = self.remove_rule(3, 0)
    self.assertPartialOutActions(out_actions, {"stored": [
      ["RemoveRecord", "_grist_Tables_column", 4],
      ["UpdateRecord", "_grist_Tables_column", 3, {"rules": None}],
      ["RemoveColumn", "Inventory", "gristHelper_ConditionalRule"]
    ]})

  def test_duplicates(self):
    self.load_sample(self.sample)

    # Create rule that marks duplicate values
    formula = "len(Inventory.lookupRecords(Label=$Label)) > 1"

    # First add rule on stock column, to test naming - second rule column should have 2 as a suffix
    self.add_empty(3)
    self.set_rule(3, 0, "$Stock == 0")
    # Now highlight duplicates on labels
    self.add_empty(2)
    out_actions = self.set_rule(2, 0, formula)
    self.assertPartialOutActions(out_actions, {"stored": [
      ["ModifyColumn", "Inventory", "gristHelper_ConditionalRule2",
       {"formula": "len(Inventory.lookupRecords(Label=$Label)) > 1"}],
      ["UpdateRecord", "_grist_Tables_column", 5,
       {"formula": "len(Inventory.lookupRecords(Label=$Label)) > 1"}],
      ["BulkUpdateRecord", "Inventory", [1, 2, 3, 4],
       {"gristHelper_ConditionalRule2": [True, False, False, True]}]
    ]})

  def test_column_removal(self):
    # Test that rules are removed with a column.

    self.load_sample(self.sample)
    self.add_empty(3)
    self.set_rule(3, 0, "$Stock == 0")
    before = self.engine.docmodel.columns.lookupOne(colId='gristHelper_ConditionalRule')
    self.assertNotEqual(before, 0)
    out_actions = self.apply_user_action(['RemoveColumn', 'Inventory', 'Stock'])
    self.assertPartialOutActions(out_actions, {"stored": [
      ["BulkRemoveRecord", "_grist_Tables_column", [3, 4]],
      ["RemoveColumn", "Inventory", "Stock"],
      ["RemoveColumn", "Inventory", "gristHelper_ConditionalRule"],
    ]})

  def test_column_removal_for_a_field(self):
    # Test that rules are removed with a column when attached to a field.

    self.load_sample(self.sample)
    self.apply_user_action(['CreateViewSection', 1, 0, 'record', None, None])
    self.field_add_empty(2)
    self.field_set_rule(2, 0, "$Stock == 0")
    before = self.engine.docmodel.columns.lookupOne(colId='gristHelper_ConditionalRule')
    self.assertNotEqual(before, 0)
    out_actions = self.apply_user_action(['RemoveColumn', 'Inventory', 'Stock'])
    self.assertPartialOutActions(out_actions, {"stored": [
      ["RemoveRecord", "_grist_Views_section_field", 2],
      ["BulkRemoveRecord", "_grist_Tables_column", [3, 4]],
      ["RemoveColumn", "Inventory", "Stock"],
      ["RemoveColumn", "Inventory", "gristHelper_ConditionalRule"],
    ]})

  def test_field_removal(self):
    # Test that rules are removed with a field.

    self.load_sample(self.sample)
    self.apply_user_action(['CreateViewSection', 1, 0, 'record', None, None])
    self.field_add_empty(2)
    self.field_set_rule(2, 0, "$Stock == 0")
    rule_id = self.engine.docmodel.columns.lookupOne(colId='gristHelper_ConditionalRule').id
    self.assertNotEqual(rule_id, 0)
    out_actions = self.apply_user_action(['RemoveRecord', '_grist_Views_section_field', 2])
    self.assertPartialOutActions(out_actions, {"stored": [
      ["RemoveRecord", "_grist_Views_section_field", 2],
      ["RemoveRecord", "_grist_Tables_column", rule_id],
      ["RemoveColumn", "Inventory", "gristHelper_ConditionalRule"]
    ]})
