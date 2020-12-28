# -*- coding: utf-8 -*-

import json

import test_engine
import testsamples
import useractions

user_attr1 = {
    'name': 'School',
    'charId': 'Email',
    'tableId': 'Schools',
    'lookupColId': 'LiasonEmail',
}

class TestACLRenames(test_engine.EngineTestCase):

  def setUp(self):
    super(TestACLRenames, self).setUp()

    self.load_sample(testsamples.sample_students)

    # Add column to Schools to use with User Attribute.
    self.engine.apply_user_actions([useractions.from_repr(ua) for ua in (
      ['AddColumn', 'Schools', 'LiasonEmail', {'type': 'Text'}],
      ['AddRecord', '_grist_ACLResources', -1, {'tableId': '*', 'colIds': '*'}],
      ['AddRecord', '_grist_ACLRules', None, {
        'resource': -1,
        'userAttributes': json.dumps(user_attr1),
      }],
      ['AddRecord', '_grist_ACLResources', -2, {
        'tableId': 'Students', 'colIds': 'firstName,lastName'
      }],
      ['AddRecord', '_grist_ACLResources', -3, {
        'tableId': 'Students', 'colIds': '*'
      }],
      ['AddRecord', '_grist_ACLRules', None, {
        'resource': -2,
        # Include comments and unicode to check that renaming respects all that.
        'aclFormula': '( rec.schoolName !=  # ünîcødé comment\n  user.School.name)',
        'permissionsText': 'none',
      }],
      ['AddRecord', '_grist_ACLRules', None, {
        'resource': -3,
        'permissionsText': 'all'
      }],
    )])

    # Here's what we expect to be in the ACL tables (for reference in tests below).
    self.assertTableData('_grist_ACLResources', cols="subset", data=[
      ['id',  'tableId',  'colIds'],
      [1,     '*',        '*'],
      [2,     'Students', 'firstName,lastName'],
      [3,     'Students', '*'],
    ])
    self.assertTableData('_grist_ACLRules', cols="subset", data=[
      ['id',  'resource', 'aclFormula', 'permissionsText', 'userAttributes'],
      [1,     1,          '',           '',                json.dumps(user_attr1)],
      [2,     2,  '( rec.schoolName !=  # ünîcødé comment\n  user.School.name)', 'none', ''],
      [3,     3,          '',           'all',              ''],
    ])

  def test_acl_table_renames(self):
    # Rename some tables.
    self.apply_user_action(['RenameTable', 'Students', 'Estudiantes'])
    self.apply_user_action(['RenameTable', 'Schools', 'Escuelas'])

    user_attr1_renamed = dict(user_attr1, tableId='Escuelas')

    # Check the result of both renames.
    self.assertTableData('_grist_ACLResources', cols="subset", data=[
      ['id', 'tableId', 'colIds'],
      [1,     '*',        '*'],
      [2,     'Estudiantes', 'firstName,lastName'],
      [3,     'Estudiantes', '*'],
    ])
    self.assertTableData('_grist_ACLRules', cols="subset", data=[
      ['id',  'resource', 'aclFormula', 'permissionsText', 'userAttributes'],
      [1,     1,          '',           '',                json.dumps(user_attr1_renamed)],
      [2,     2,  '( rec.schoolName !=  # ünîcødé comment\n  user.School.name)', 'none', ''],
      [3,     3,          '',           'all',              ''],
    ])

  def test_acl_column_renames(self):
    # Rename some columns.
    self.apply_user_action(['RenameColumn', 'Students', 'lastName', 'Family_Name'])
    self.apply_user_action(['RenameColumn', 'Schools', 'name', 'schoolName'])
    self.apply_user_action(['RenameColumn', 'Students', 'schoolName', 'escuela'])
    self.apply_user_action(['RenameColumn', 'Schools', 'LiasonEmail', 'AdminEmail'])

    user_attr1_renamed = dict(user_attr1, lookupColId='AdminEmail')

    # Check the result of both renames.
    self.assertTableData('_grist_ACLResources', cols="subset", data=[
      ['id', 'tableId', 'colIds'],
      [1,     '*',        '*'],
      [2,     'Students', 'firstName,Family_Name'],
      [3,     'Students', '*'],
    ])
    self.assertTableData('_grist_ACLRules', cols="subset", data=[
      ['id',  'resource', 'aclFormula', 'permissionsText', 'userAttributes'],
      [1,     1,          '',           '',                json.dumps(user_attr1_renamed)],
      [2,     2,  '( rec.escuela !=  # ünîcødé comment\n  user.School.schoolName)', 'none', ''],
      [3,     3,          '',           'all',              ''],
    ])

  def test_multiple_renames(self):
    # Combine several renames into one bundle.
    self.engine.apply_user_actions([useractions.from_repr(ua) for ua in (
      ['RenameColumn', 'Students', 'firstName', 'Given_Name'],
      ['RenameColumn', 'Students', 'lastName', 'Family_Name'],
      ['RenameTable', 'Students', 'Students2'],
      ['RenameColumn', 'Students2', 'schoolName', 'escuela'],
      ['RenameColumn', 'Schools', 'name', 'schoolName'],
    )])
    self.assertTableData('_grist_ACLResources', cols="subset", data=[
      ['id', 'tableId',     'colIds'],
      [1,     '*',          '*'],
      [2,     'Students2',  'Given_Name,Family_Name'],
      [3,     'Students2',  '*'],
    ])
    self.assertTableData('_grist_ACLRules', cols="subset", data=[
      ['id',  'resource', 'aclFormula', 'permissionsText', 'userAttributes'],
      [1,     1,          '',           '',                json.dumps(user_attr1)],
      [2,     2,  '( rec.escuela !=  # ünîcødé comment\n  user.School.schoolName)', 'none', ''],
      [3,     3,          '',           'all',              ''],
    ])
