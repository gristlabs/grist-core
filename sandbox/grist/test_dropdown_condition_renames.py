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
      ['UpdateRecord', '_grist_Tables_column', 12, {
        'widgetOptions': json.dumps({
          'dropdownCondition': {
            'text': '"New" in choice.city and $name == rec.name',
          }
        }),
      }],
    )])

    self.assertTableData('_grist_Tables_column', cols="subset", rows="subset", data=[
      ['id',  'type',         'widgetOptions'],
      [12,    'Ref:Address',  json.dumps({
        'dropdownCondition': {
          'text': '"New" in choice.city and $name == rec.name',
          'parsed': json.dumps(["And", ["In", ["Const", "New"], ["Attr", ["Name", "choice"], "city"]],
                                ["Eq", ["Attr", ["Name", "rec"], "name"], ["Attr", ["Name", "rec"], "name"]]])
        }
      })],
    ])

  def test_referred_column_renames(self):
    self.apply_user_action(['RenameColumn', 'Address', 'city', 'area'])
    self.assertTableData('_grist_Tables_column', cols="subset", rows="subset", data=[
      ['id',  'type',         'widgetOptions'],
      [12,    'Ref:Address',  json.dumps({
        'dropdownCondition': {
          'text': '"New" in choice.area and $name == rec.name',
          'parsed': json.dumps(["And", ["In", ["Const", "New"], ["Attr", ["Name", "choice"], "area"]],
                                ["Eq", ["Attr", ["Name", "rec"], "name"], ["Attr", ["Name", "rec"], "name"]]])
        }
      })],
    ])

  def test_record_column_renames(self):
    self.apply_user_action(['RenameColumn', 'Schools', 'name', 'identifier'])
    self.assertTableData('_grist_Tables_column', cols="subset", rows="subset", data=[
      ['id',  'type',         'widgetOptions'],
      [12,    'Ref:Address',  json.dumps({
        'dropdownCondition': {
          'text': '"New" in choice.city and $identifier == rec.identifier',
          'parsed': json.dumps(["And", ["In", ["Const", "New"], ["Attr", ["Name", "choice"], "city"]],
                                ["Eq", ["Attr", ["Name", "rec"], "identifier"], ["Attr", ["Name", "rec"], "identifier"]]])
        }
      })],
    ])

  def test_multiple_renames(self):
    self.apply_user_action(['RenameColumn', 'Address', 'city', 'area'])
    self.apply_user_action(['RenameColumn', 'Schools', 'name', 'identifier'])
    self.assertTableData('_grist_Tables_column', cols="subset", rows="subset", data=[
      ['id',  'type',         'widgetOptions'],
      [12,    'Ref:Address',  json.dumps({
        'dropdownCondition': {
          'text': '"New" in choice.area and $identifier == rec.identifier',
          'parsed': json.dumps(["And", ["In", ["Const", "New"], ["Attr", ["Name", "choice"], "area"]],
                                ["Eq", ["Attr", ["Name", "rec"], "identifier"], ["Attr", ["Name", "rec"], "identifier"]]])
        }
      })],
    ])
