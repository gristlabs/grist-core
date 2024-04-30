# -*- coding: utf-8 -*-
# pylint:disable=line-too-long

import test_engine

class TestACLFormulaUserActions(test_engine.EngineTestCase):
  def test_acl_actions(self):
    # Adding or updating ACLRules automatically includes aclFormula compilation.

    # Single Add
    out_actions = self.apply_user_action(
      ['AddRecord', '_grist_ACLRules', None, {"resource": 1, "aclFormula": "user.UserID == 7"}],
    )
    self.assertPartialOutActions(out_actions, { "stored": [
      ["AddRecord", "_grist_ACLRules", 1, {"resource": 1, "aclFormula": "user.UserID == 7",
        "aclFormulaParsed": '["Eq", ["Attr", ["Name", "user"], "UserID"], ["Const", 7]]',
        "rulePos": 1.0
      }],
    ]})

    # Single Update
    out_actions = self.apply_user_action(
      ['UpdateRecord', '_grist_ACLRules', 1, {
        "aclFormula": "user.UserID == 8",
        "aclFormulaParsed": "hello"
      }],
    )
    self.assertPartialOutActions(out_actions, { "stored": [
      ["UpdateRecord", "_grist_ACLRules", 1, {
        "aclFormula": "user.UserID == 8",
        "aclFormulaParsed": '["Eq", ["Attr", ["Name", "user"], "UserID"], ["Const", 8]]',
      }],
    ]})

    # BulkAddRecord
    out_actions = self.apply_user_action(['BulkAddRecord', '_grist_ACLRules', [None, None], {
      "resource": [1, 1],
      "aclFormula": ["user.IsGood", "user.IsBad"],
      "aclFormulaParsed": ["[1]", '["ignored"]'],   # Should get overwritten
    }])
    self.assertPartialOutActions(out_actions, { "stored": [
      [ 'BulkAddRecord', '_grist_ACLRules', [2, 3], {
        "resource": [1, 1],
        "aclFormula": ["user.IsGood", "user.IsBad"],
        "aclFormulaParsed": [                         # Gets overwritten
          '["Attr", ["Name", "user"], "IsGood"]',
          '["Attr", ["Name", "user"], "IsBad"]',
        ],
        "rulePos": [2.0, 3.0],                        # Gets filled in.
      }],
    ]})

    # BulkUpdateRecord
    out_actions = self.apply_user_action(['BulkUpdateRecord', '_grist_ACLRules', [2, 3], {
      "aclFormula": ["not user.IsGood", ""],
    }])
    self.assertPartialOutActions(out_actions, { "stored": [
      ['BulkUpdateRecord', '_grist_ACLRules', [2, 3], {
        "aclFormula": ["not user.IsGood", ""],
        "aclFormulaParsed": ['["Not", ["Attr", ["Name", "user"], "IsGood"]]', ''],
      }],
    ]})
