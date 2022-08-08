# -*- coding: utf-8 -*-
import test_engine


class TestGridRules(test_engine.EngineTestCase):
  # Helper for rules action
  def add_empty(self):
    return self.apply_user_action(['AddEmptyRule', "Table1", 0, 0])


  def set_rule(self, rule_index, formula):
    rules = self.engine.docmodel.tables.lookupOne(tableId='Table1').rawViewSectionRef.rules
    rule = list(rules)[rule_index]
    return self.apply_user_action(['UpdateRecord', '_grist_Tables_column',
                                   rule.id, {"formula": formula}])


  def remove_rule(self, rule_index):
    rules = self.engine.docmodel.tables.lookupOne(tableId='Table1').rawViewSectionRef.rules
    rule = list(rules)[rule_index]
    return self.apply_user_action(['RemoveColumn', 'Table1', rule.colId])


  def test_simple_rules(self):
    self.apply_user_action(['AddEmptyTable', None])
    self.apply_user_action(['AddRecord', "Table1", None, {"A": 1}])
    self.apply_user_action(['AddRecord', "Table1", None, {"A": 2}])
    self.apply_user_action(['AddRecord', "Table1", None, {"A": 3}])
    out_actions = self.add_empty()
    self.assertPartialOutActions(out_actions, {"stored": [
      ["AddColumn", "Table1", "gristHelper_RowConditionalRule",
       {"formula": "", "isFormula": True, "type": "Any"}],
      ["AddRecord", "_grist_Tables_column", 5,
       {"colId": "gristHelper_RowConditionalRule", "formula": "", "isFormula": True,
        "label": "gristHelper_RowConditionalRule", "parentId": 1, "parentPos": 5.0,
        "type": "Any",
        "widgetOptions": ""}],
      ["UpdateRecord", "_grist_Views_section", 2, {"rules": ["L", 5]}],
    ]})
    out_actions = self.set_rule(0, "$A == 1")
    self.assertPartialOutActions(out_actions, {"stored": [
      ["ModifyColumn", "Table1", "gristHelper_RowConditionalRule",
       {"formula": "$A == 1"}],
      ["UpdateRecord", "_grist_Tables_column", 5, {"formula": "$A == 1"}],
      ["BulkUpdateRecord", "Table1", [1, 2, 3],
       {"gristHelper_RowConditionalRule": [True, False, False]}],
    ]})

    # Replace this rule with another rule to mark A = 2
    out_actions = self.set_rule(0, "$A == 2")
    self.assertPartialOutActions(out_actions, {"stored": [
      ["ModifyColumn", "Table1", "gristHelper_RowConditionalRule",
       {"formula": "$A == 2"}],
      ["UpdateRecord", "_grist_Tables_column", 5, {"formula": "$A == 2"}],
      ["BulkUpdateRecord", "Table1", [1, 2],
       {"gristHelper_RowConditionalRule": [False, True]}],
    ]})

    # Add another rule A = 3
    self.add_empty()
    out_actions = self.set_rule(1, "$A == 3")
    self.assertPartialOutActions(out_actions, {"stored": [
      ["ModifyColumn", "Table1", "gristHelper_RowConditionalRule2",
       {"formula": "$A == 3"}],
      ["UpdateRecord", "_grist_Tables_column", 6, {"formula": "$A == 3"}],
      ["BulkUpdateRecord", "Table1", [1, 2, 3],
       {"gristHelper_RowConditionalRule2": [False, False, True]}],
    ]})

    # Remove the last rule
    out_actions = self.remove_rule(1)
    self.assertPartialOutActions(out_actions, {"stored": [
      ["RemoveRecord", "_grist_Tables_column", 6],
      ["UpdateRecord", "_grist_Views_section", 2, {"rules": ["L", 5]}],
      ["RemoveColumn", "Table1", "gristHelper_RowConditionalRule2"]
    ]})

    # Remove last rule
    out_actions = self.remove_rule(0)
    self.assertPartialOutActions(out_actions, {"stored": [
      ["RemoveRecord", "_grist_Tables_column", 5],
      ["UpdateRecord", "_grist_Views_section", 2, {"rules": None}],
      ["RemoveColumn", "Table1", "gristHelper_RowConditionalRule"]
    ]})
