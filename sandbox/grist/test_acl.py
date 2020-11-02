"""
Test of ACL rules.
"""

import acl
import actions
import logger
import schema
import testutil
import test_engine
import useractions

log = logger.Logger(__name__, logger.INFO)


class TestACL(test_engine.EngineTestCase):
  maxDiff = None     # Allow self.assertEqual to display big diffs

  starting_table_data = [
    ["id",  "city",     "state", "amount" ],
    [ 21,   "New York", "NY"   , 1.       ],
    [ 22,   "Albany",   "NY"   , 2.       ],
    [ 23,   "Seattle",  "WA"   , 3.       ],
    [ 24,   "Chicago",  "IL"   , 4.       ],
    [ 25,   "Bedford",  "MA"   , 5.       ],
    [ 26,   "New York", "NY"   , 6.       ],
    [ 27,   "Buffalo",  "NY"   , 7.       ],
    [ 28,   "Bedford",  "NY"   , 8.       ],
    [ 29,   "Boston",   "MA"   , 9.       ],
    [ 30,   "Yonkers",  "NY"   , 10.      ],
    [ 31,   "New York", "NY"   , 11.      ],
  ]

  sample = testutil.parse_test_sample({
    "SCHEMA": [
      [1, "Address", [
        [11, "city",        "Text",       False, "", "City", ""],
        [12, "state",       "Text",       False, "", "State", "WidgetOptions1"],
        [13, "amount",      "Numeric",    False, "", "Amount", "WidgetOptions2"],
      ]]
    ],
    "DATA": {
      "Address": starting_table_data,
      "_grist_ACLRules": [
        ["id",    "resource",     "permissions",      "principals",   "aclFormula", "aclColumn"],
      ],
      "_grist_ACLResources": [
        ["id",    "tableId",    "colIds"],
      ],
      "_grist_ACLPrincipals": [
        ["id",    "type",   "userEmail",    "userName",   "groupName",    "instanceId"],
      ],
      "_grist_ACLMemberships": [
        ["id",  "parent",   "child"],
      ]
    }
  })

  def _apply_ua(self, *useraction_reprs):
    """Returns an ActionBundle."""
    user_actions = [useractions.from_repr(ua) for ua in useraction_reprs]
    return self.engine.acl_split(self.engine.apply_user_actions(user_actions))

  def test_trivial_action_bundle(self):
    # In this test case, we just check that an ActionGroup is packaged unchanged into an
    # ActionBundle when there are no ACL rules at all.
    self.load_sample(self.sample)

    # Verify the starting table; there should be no views yet.
    self.assertTableData("Address", self.starting_table_data)

    # Check that the raw action group created by an action is as expected.
    out_action = self.update_record("Address", 22, amount=20.)
    self.assertPartialOutActions(out_action, {
      'stored': [['UpdateRecord', 'Address', 22, {'amount': 20.}]],
      'undo': [['UpdateRecord', 'Address', 22, {'amount': 2.}]],
      'calc': [],
      'retValues': [None],
    })

    # In this case, we have no rules, and the action is packaged unchanged into an ActionBundle.
    out_bundle = self.engine.acl_split(out_action)
    self.assertEqual(out_bundle.to_json_obj(), {
      'envelopes': [{"recipients": []}],
      'stored': [(0, ['UpdateRecord', 'Address', 22, {'amount': 20.}])],
      'undo': [(0, ['UpdateRecord', 'Address', 22, {'amount': 2.}])],
      'calc': [],
      'retValues': [None],
      'rules': [],
    })

    # Another similar action.
    out_bundle = self._apply_ua(
      ['UpdateRecord', 'Address', 21, {'amount': 10., 'city': 'NYC'}])
    self.assertEqual(out_bundle.to_json_obj(), {
      'envelopes': [{"recipients": []}],
      'stored': [(0, ['UpdateRecord', 'Address', 21, {'amount': 10., 'city': 'NYC'}])],
      'undo': [(0, ['UpdateRecord', 'Address', 21, {'amount': 1., 'city': 'New York'}])],
      'calc': [],
      'retValues': [None],
      'rules': [],
    })

  def test_bundle_default_rules(self):
    # Check that a newly-created document (which should have default rules) produces the same
    # bundle as the trivial document without rules.
    self._apply_ua(['InitNewDoc', 'UTC'])

    # Create a schema for a table, and fill with some data.
    self.apply_user_action(["AddTable", "Address", [
      {"id": "city",    "type": "Text"},
      {"id": "state",   "type": "Text"},
      {"id": "amount",  "type": "Numeric"},
    ]])
    self.add_records("Address", self.starting_table_data[0], self.starting_table_data[1:])
    self.assertTableData("Address", cols="subset", data=self.starting_table_data)

    # Check that an action creates the same bundle as in the trivial case.
    out_bundle = self._apply_ua(
      ['UpdateRecord', 'Address', 21, {'amount': 10., 'city': 'NYC'}])
    self.assertEqual(out_bundle.to_json_obj(), {
      'envelopes': [{"recipients": []}],
      'stored': [(0, ['UpdateRecord', 'Address', 21, {'amount': 10., 'city': 'NYC'}])],
      'undo': [(0, ['UpdateRecord', 'Address', 21, {'amount': 1., 'city': 'New York'}])],
      'calc': [],
      'retValues': [None],
      'rules': [1],
    })

    # Once we add principals to Owners group, they should show up in the recipient list.
    self.add_records('_grist_ACLPrincipals', ['id', 'type', 'userName', 'instanceId'], [
      [20, 'user', 'foo@grist', ''],
      [21, 'instance', '', '12345'],
      [22, 'instance', '', '0abcd'],
    ])
    self.add_records('_grist_ACLMemberships', ['parent', 'child'], [
      [1, 20],    # group 'Owners' contains user 'foo@grist'
      [20, 21],   # user 'foo@grist', contains instance '12345' and '67890'
      [20, 22],
    ])

    # Similar action to before, which is bundled as a single envelope, but includes recipients.
    out_bundle = self._apply_ua(
      ['UpdateRecord', 'Address', 21, {'amount': 11., 'city': 'NYC2'}])
    self.assertEqual(out_bundle.to_json_obj(), {
      'envelopes': [{"recipients": ['0abcd', '12345']}],
      'stored': [(0, ['UpdateRecord', 'Address', 21, {'amount': 11., 'city': 'NYC2'}])],
      'undo': [(0, ['UpdateRecord', 'Address', 21, {'amount': 10., 'city': 'NYC'}])],
      'calc': [],
      'retValues': [None],
      'rules': [1],
    })

  def init_employees_doc(self):
    # Create a document with non-trivial rules, and check that actions are split correctly,
    # using col/table/default rules, and including undo and calc actions.
    #
    # This is the structure we create:
    #   Columns Name, Position
    #     VIEW permission to group Employees
    #     EDITOR permission to groups Managers, Owners
    #   Default for columns
    #     EDITOR permission to groups Managers, Owners

    self._apply_ua(['InitNewDoc', 'UTC'])
    self.apply_user_action(["AddTable", "Employees", [
      {"id": "name",      "type": "Text"},
      {"id": "position",  "type": "Text"},
      {"id": "ssn",       "type": "Text"},
      {"id": "salary",    "type": "Numeric", "isFormula": True,
       "formula": "100000 if $position.startswith('Senior') else 60000"},
    ]])

    # Set up some groups and instances (skip Users for simplicity). See the assert below for
    # better view of the created structure.
    self.add_records('_grist_ACLPrincipals', ['id', 'type', 'groupName', 'instanceId'], [
      [21, 'group',     'Managers',   ''],
      [22, 'group',     'Employees',  ''],
      [23, 'instance',  '',           'alice'],
      [24, 'instance',  '',           'bob'],
      [25, 'instance',  '',           'chuck'],
      [26, 'instance',  '',           'eve'],
      [27, 'instance',  '',           'zack'],
    ])
    # Set up Alice and Bob as Managers; Alice, Chuck, Eve as Employees; and Zack as an Owner.
    self.add_records('_grist_ACLMemberships', ['parent', 'child'], [
      [21, 23], [21, 24],
      [22, 23], [22, 25], [22, 26],
      [1, 27]
    ])
    self.assertTableData('_grist_ACLPrincipals', cols="subset", data=[
      ['id',    'name',             'allInstances'  ],
      [1,       'Group:Owners',     [27]            ],
      [2,       'Group:Admins',     []              ],
      [3,       'Group:Editors',    []              ],
      [4,       'Group:Viewers',    []              ],
      [21,      'Group:Managers',   [23,24]         ],
      [22,      'Group:Employees',  [23,25,26]      ],
      [23,      'Inst:alice',       [23]            ],
      [24,      'Inst:bob',         [24]            ],
      [25,      'Inst:chuck',       [25]            ],
      [26,      'Inst:eve',         [26]            ],
      [27,      'Inst:zack',        [27]            ],
    ])

    # Set up some ACL resources and rules: for columns "name,position", give VIEW permission to
    # Employees, EDITOR to Managers+Owners; for the rest, just Editor to Managers+Owners.
    self.add_records('_grist_ACLResources', ['id', 'tableId', 'colIds'], [
      [2,   'Employees',    'name,position'],
      [3,   'Employees',    ''],
    ])
    self.add_records('_grist_ACLRules', ['id', 'resource', 'permissions', 'principals'], [
      [12,  2,   acl.Permissions.VIEW,    ['L', 22]],
      [13,  2,   acl.Permissions.EDITOR,  ['L', 21,1]],
      [14,  3,   acl.Permissions.EDITOR,  ['L', 21,1]],
    ])

    # OK, now to some actions. The table starts out empty.
    self.assertTableData('Employees', [['id', 'manualSort', 'name', 'position', 'salary', 'ssn']])


  def test_rules_order(self):
    # Test that shows the problem with the ordering of actions in Envelopes.
    self.init_employees_doc()
    self._apply_ua(self.add_records_action('Employees', [
      ['name',  'position',         'ssn'],
      ['John',  'Scientist',        '000-00-0000'],
      ['Ellen', 'Senior Scientist', '111-11-1111'],
      ['Susie', 'Manager',          '222-22-2222'],
      ['Frank', 'Senior Manager',   '222-22-2222'],
    ]))
    out_bundle = self._apply_ua(['ApplyDocActions', [
      ['UpdateRecord', 'Employees', 1, {'ssn': 'xxx-xx-0000'}],
      ['UpdateRecord', 'Employees', 1, {'position': 'Senior Jester'}],
      ['UpdateRecord', 'Employees', 1, {'ssn': 'yyy-yy-0000'}],
    ]])
    self.assertTableData('Employees', cols="subset", data=[
      ['id',  'name',  'position',          'salary', 'ssn'],
      [1,     'John',  'Senior Jester',     100000.0, 'yyy-yy-0000'],
      [2,     'Ellen', 'Senior Scientist',  100000.0, '111-11-1111'],
      [3,     'Susie', 'Manager',           60000.0,  '222-22-2222'],
      [4,     'Frank', 'Senior Manager',    100000.0, '222-22-2222'],
    ])

    # Check the main aspects of the created bundles.
    env = out_bundle.envelopes

    # We expect two envelopes: one for Managers+Owners, one for all including Employees,
    # because 'ssn' and 'position' columns are resources with different permissions.
    # Note how non-consecutive actions may belong to the same envelope. This is needed to allow
    # users (e.g. alice in this example) to process DocActions in the same order as how they were
    # created, even when alice is present in different sets of recipients.
    self.assertEqual(env[0].recipients, {"alice", "bob", "zack"})
    self.assertEqual(env[1].recipients, {"alice", "bob", "zack", "chuck", "eve"})
    self.assertEqual(out_bundle.stored, [
      (0, actions.UpdateRecord('Employees', 1, {'ssn': 'xxx-xx-0000'})),
      (1, actions.UpdateRecord('Employees', 1, {'position': 'Senior Jester'})),
      (0, actions.UpdateRecord('Employees', 1, {'ssn': 'yyy-yy-0000'})),
      (0, actions.UpdateRecord('Employees', 1, {'salary': 100000.00})),
    ])
    self.assertEqual(out_bundle.calc, [])


  def test_with_rules(self):
    self.init_employees_doc()

    out_bundle = self._apply_ua(self.add_records_action('Employees', [
      ['name',  'position',         'ssn'],
      ['John',  'Scientist',        '000-00-0000'],
      ['Ellen', 'Senior Scientist', '111-11-1111'],
      ['Susie', 'Manager',          '222-22-2222'],
      ['Frank', 'Senior Manager',   '222-22-2222'],
    ]))

    # Check the main aspects of the output.
    env = out_bundle.envelopes

    # We expect two envelopes: one for Managers+Owners, one for all including Employees.
    self.assertEqual([e.recipients for e in env], [
      {"alice","chuck","eve","bob","zack"},
      {"alice", "bob", "zack"}
    ])
    # Only "name" and "position" are sent to Employees; the rest only to Managers+Owners.
    self.assertEqual([(env, set(a.columns)) for (env, a) in out_bundle.stored], [
      (0, {"name", "position"}),
      (1, {"ssn", "manualSort"}),
      (1, {"salary"}),
    ])
    self.assertEqual([(env, set(a.columns)) for (env, a) in out_bundle.calc], [])

    # Full bundle requires careful reading. See the checks above for the essential parts.
    self.assertEqual(out_bundle.to_json_obj(), {
      "envelopes": [
        {"recipients": [ "alice", "bob", "chuck", "eve", "zack" ]},
        {"recipients": [ "alice", "bob", "zack" ]},
      ],
      "stored": [
        # TODO Yikes, there is a problem here! We have two envelopes, each with BulkAddRecord
        # actions, but some recipients receive BOTH envelopes. What is "alice" to do with two
        # separate BulkAddRecord actions that both include rowIds 1, 2, 3, 4?
        (0, [ "BulkAddRecord", "Employees", [ 1, 2, 3, 4 ], {
          "position": [ "Scientist", "Senior Scientist", "Manager", "Senior Manager" ],
          "name": [ "John", "Ellen", "Susie", "Frank" ]
        }]),
        (1, [ "BulkAddRecord", "Employees", [ 1, 2, 3, 4 ], {
          "manualSort": [ 1, 2, 3, 4 ],
          "ssn": [ "000-00-0000", "111-11-1111", "222-22-2222", "222-22-2222" ]
        }]),
        (1, [ "BulkUpdateRecord", "Employees", [ 1, 2, 3, 4 ], {
          "salary": [ 60000, 100000, 60000, 100000 ]
        }]),
      ],
      "undo": [
        # TODO All recipients now get BulkRemoveRecord (which is correct), but some get it twice,
        # which is a simpler manifestation of the problem with BulkAddRecord.
        (0, [ "BulkRemoveRecord", "Employees", [ 1, 2, 3, 4 ] ]),
        (1, [ "BulkRemoveRecord", "Employees", [ 1, 2, 3, 4 ] ]),
      ],
      "calc": [],
      "retValues": [[1, 2, 3, 4]],
      "rules": [12,13,14],
    })

  def test_empty_add_record(self):
    self.init_employees_doc()

    out_bundle = self._apply_ua(['AddRecord', 'Employees', None, {}])
    self.assertEqual(out_bundle.to_json_obj(), {
      "envelopes": [{"recipients": [ "alice", "bob", "chuck", "eve", "zack" ]},
                    {"recipients": [ "alice", "bob", "zack" ]} ],
      # TODO Note the same issues as in previous test case: some recipients receive duplicate or
      # near-duplicate AddRecord and RemoveRecord actions, governed by different rules.
      "stored": [
        (0, [ "AddRecord", "Employees", 1, {}]),
        (1, [ "AddRecord", "Employees", 1, {"manualSort": 1.0}]),
        (1, [ "UpdateRecord", "Employees", 1, { "salary": 60000.0 }]),
      ],
      "undo": [
        (0, [ "RemoveRecord", "Employees", 1 ]),
        (1, [ "RemoveRecord", "Employees", 1 ]),
      ],
      "calc": [],
      "retValues": [1],
      "rules": [12,13,14],
    })

    out_bundle = self._apply_ua(['UpdateRecord', 'Employees', 1, {"position": "Senior Citizen"}])
    self.assertEqual(out_bundle.to_json_obj(), {
      "envelopes": [{"recipients": [ "alice", "bob", "chuck", "eve", "zack" ]},
                    {"recipients": [ "alice", "bob", "zack" ]} ],
      "stored": [
        (0, [ "UpdateRecord", "Employees", 1, {"position": "Senior Citizen"}]),
        (1, [ "UpdateRecord", "Employees", 1, { "salary": 100000.0 }])
      ],
      "undo": [
        (0, [ "UpdateRecord", "Employees", 1, {"position": ""}]),
        (1, [ "UpdateRecord", "Employees", 1, { "salary": 60000.0 }])
      ],
      "calc": [],
      "retValues": [None],
      "rules": [12,13,14],
    })

  def test_add_user(self):
    self.init_employees_doc()

    out_bundle = self._apply_ua(['AddUser', 'f@g.c', 'Fred', ['XXX', 'YYY']])
    self.assertEqual(out_bundle.to_json_obj(), {
      # TODO: Only Owners are getting these metadata changes, but all users should get them.
      "envelopes": [{"recipients": [ "XXX", "YYY", "zack" ]}],
      "stored": [
        (0, [ "AddRecord", "_grist_ACLPrincipals", 28, {
          'type': 'user', 'userEmail': 'f@g.c', 'userName': 'Fred'}]),
        (0, [ "BulkAddRecord", "_grist_ACLPrincipals", [29, 30], {
          'type': ['instance', 'instance'],
          'instanceId': ['XXX', 'YYY']
        }]),
        (0, [ "BulkAddRecord", "_grist_ACLMemberships", [7, 8, 9], {
          # Adds instances (29, 30) to user (28), and user (28) to group owners (1)
          'parent': [28, 28, 1],
          'child': [29, 30, 28],
        }]),
      ],
      "undo": [
        (0, [ "RemoveRecord", "_grist_ACLPrincipals", 28]),
        (0, [ "BulkRemoveRecord", "_grist_ACLPrincipals", [29, 30]]),
        (0, [ "BulkRemoveRecord", "_grist_ACLMemberships", [7, 8, 9]]),
      ],
      "calc": [
      ],
      "retValues": [None],
      "rules": [1],
    })

  def test_doc_snapshot(self):
    self.init_employees_doc()

    # Apply an action to the initial employees doc to make the test case more complex
    self.add_records('Employees', ['name', 'position', 'ssn'], [
      ['John',  'Scientist',        '000-00-0000'],
      ['Ellen', 'Senior Scientist', '111-11-1111'],
      ['Susie', 'Manager',          '222-22-2222'],
      ['Frank', 'Senior Manager',   '222-22-2222']
    ])

    # Retrieve the doc snapshot and split it
    snapshot_action_group = self.engine.fetch_snapshot()
    snapshot_bundle = self.engine.acl_split(snapshot_action_group)

    init_schema_actions = [actions.get_action_repr(a) for a in schema.schema_create_actions()]

    # We check that the unsplit doc snapshot bundle includes all the necessary actions
    # to rebuild the doc
    snapshot = snapshot_action_group.get_repr()
    self.assertEqual(snapshot['calc'], [])
    self.assertEqual(snapshot['retValues'], [])
    self.assertEqual(snapshot['undo'], [])

    stored_subset = [
      ['AddTable', 'Employees',
       [{'formula': '','id': 'manualSort','isFormula': False,'type': 'ManualSortPos'},
        {'formula': '','id': 'name','isFormula': False,'type': 'Text'},
        {'formula': '','id': 'position','isFormula': False,'type': 'Text'},
        {'formula': '','id': 'ssn','isFormula': False,'type': 'Text'},
        {'formula': "100000 if $position.startswith('Senior') else 60000",
         'id': 'salary',
         'isFormula': True,
         'type': 'Numeric'}]],
      ['BulkAddRecord', '_grist_Tables', [1],
        {'primaryViewId': [1],
         'summarySourceTable': [0],
         'tableId': ['Employees'],
         'onDemand': [False]}],
      ['BulkAddRecord', 'Employees', [1, 2, 3, 4], {
        'manualSort': [1.0, 2.0, 3.0, 4.0],
        'name': ['John', 'Ellen', 'Susie', 'Frank'],
        'position': ['Scientist', 'Senior Scientist', 'Manager', 'Senior Manager'],
        'ssn': ['000-00-0000', '111-11-1111', '222-22-2222', '222-22-2222']
      }],
      ['BulkAddRecord','_grist_Tables_column',[1, 2, 3, 4, 5],
          {'colId': ['manualSort', 'name', 'position', 'ssn', 'salary'],
           'displayCol': [0, 0, 0, 0, 0],
           'formula': ['','','','',"100000 if $position.startswith('Senior') else 60000"],
           'isFormula': [False, False, False, False, True],
           'label': ['manualSort', 'name', 'position', 'ssn', 'salary'],
           'parentId': [1, 1, 1, 1, 1],
           'parentPos': [1.0, 2.0, 3.0, 4.0, 5.0],
           'summarySourceCol': [0, 0, 0, 0, 0],
           'type': ['ManualSortPos', 'Text', 'Text', 'Text', 'Numeric'],
           'untieColIdFromLabel': [False, False, False, False, False],
           'widgetOptions': ['', '', '', '', ''],
           'visibleCol': [0, 0, 0, 0, 0]}]
    ]
    for action in stored_subset:
      self.assertIn(action, snapshot['stored'])

    # We check that the full doc snapshot bundle is split as expected
    snapshot_bundle_json = snapshot_bundle.to_json_obj()
    self.assertEqual(snapshot_bundle_json['envelopes'], [
      {'recipients': ['#ALL']},
      {'recipients': ['zack']},
      {'recipients': ['alice', 'bob', 'chuck', 'eve', 'zack']},
      {'recipients': ['alice', 'bob', 'zack']}
    ])
    self.assertEqual(snapshot_bundle_json['calc'], [])
    self.assertEqual(snapshot_bundle_json['retValues'], [])
    self.assertEqual(snapshot_bundle_json['undo'], [])
    self.assertEqual(snapshot_bundle_json['rules'], [1, 12, 13, 14])

    stored_subset = ([(0, action_repr) for action_repr in init_schema_actions] + [
      (0, ['AddTable', 'Employees',
        [{'formula': '','id': 'manualSort','isFormula': False,'type': 'ManualSortPos'},
         {'formula': '','id': 'name','isFormula': False,'type': 'Text'},
         {'formula': '','id': 'position','isFormula': False,'type': 'Text'},
         {'formula': '','id': 'ssn','isFormula': False,'type': 'Text'},
         {'formula': "100000 if $position.startswith('Senior') else 60000",
          'id': 'salary',
          'isFormula': True,
          'type': 'Numeric'}]]),
      # TODO (High-priority): The following action only received by 'zack' when it should be
      # received by everyone.
      (1, ['BulkAddRecord', '_grist_Tables', [1],
        {'primaryViewId': [1],
         'summarySourceTable': [0],
         'tableId': ['Employees'],
         'onDemand': [False]}]),
      (2, ['BulkAddRecord', 'Employees', [1, 2, 3, 4],
        {'name': ['John', 'Ellen', 'Susie', 'Frank'],
         'position': ['Scientist', 'Senior Scientist', 'Manager', 'Senior Manager']}]),
      (3, ['BulkAddRecord', 'Employees', [1, 2, 3, 4],
        {'manualSort': [1.0, 2.0, 3.0, 4.0],
         'ssn': ['000-00-0000', '111-11-1111', '222-22-2222', '222-22-2222']}]),
      (1, ['BulkAddRecord', '_grist_Tables_column', [1, 2, 3, 4, 5],
        {'colId': ['manualSort','name','position','ssn','salary'],
         'displayCol': [0, 0, 0, 0, 0],
         'formula': ['','','','',"100000 if $position.startswith('Senior') else 60000"],
         'isFormula': [False, False, False, False, True],
         'label': ['manualSort','name','position','ssn','salary'],
         'parentId': [1, 1, 1, 1, 1],
         'parentPos': [1.0, 2.0, 3.0, 4.0, 5.0],
         'summarySourceCol': [0, 0, 0, 0, 0],
         'type': ['ManualSortPos','Text','Text','Text','Numeric'],
         'untieColIdFromLabel': [False, False, False, False, False],
         'widgetOptions': ['', '', '', '', ''],
         'visibleCol': [0, 0, 0, 0, 0]}])
    ])
    for action in stored_subset:
      self.assertIn(action, snapshot_bundle_json['stored'])
