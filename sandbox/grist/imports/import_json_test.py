from unittest import TestCase
from imports import import_json

class TestImportJSON(TestCase):

  maxDiff = None

  def test_simple_json_array(self):
    grist_tables = import_json.dumps([{'a': 1, 'b': 'baba'}, {'a': 4, 'b': 'abab'}], '')
    self.assertEqual(grist_tables['tables'], [{
      'column_metadata': [
        {'id': 'a', 'type': 'Numeric'}, {'id': 'b', 'type': 'Text'}],
      'table_data': [[1, 4],  ['baba', 'abab']],
      'table_name': ''
    }])

  def test_missing_data(self):
    grist_tables = import_json.dumps([{'a': 1}, {'b': 'abab'}, {'a': 4}])
    self.assertEqual(grist_tables['tables'], [{
      'column_metadata': [
        {'id': 'a', 'type': 'Numeric'}, {'id': 'b', 'type': 'Text'}],
      'table_data': [[1, None, 4],  [None, 'abab', None]],
      'table_name': ''
    }])

  def test_even_more_simple_array(self):
    self.assertEqual(
      import_json.dumps(['apple', 'pear', 'banana'], '')['tables'],
      [{
        'column_metadata': [
          {'id': '', 'type': 'Text'}],
        'table_data': [['apple', 'pear', 'banana']],
        'table_name': ''
        }])

  def test_mixing_simple_and_even_more_simple(self):
    self.assertEqual(
      import_json.dumps(['apple', 'pear', {'a': 'some cucumbers'}, 'banana'], '')['tables'],
      [{
        'column_metadata': [
          {'id': '', 'type': 'Text'},
          {'id': 'a', 'type': 'Text'}],
        'table_data': [['apple', 'pear', None, 'banana'], [None, None, 'some cucumbers', None]],
        'table_name': ''
        }])

  def test_array_with_reference(self):
    # todo: reference should follow Grist's format
    self.assertEqual(
      import_json.dumps([{'a': {'b': 2}, 'c': 'foo'}], 'Hello')['tables'],
      [{
          'column_metadata': [
            {'id': 'a', 'type': 'Ref:Hello_a'}, {'id': 'c', 'type': 'Text'}
          ],
          'table_data': [[1],  ['foo']],
          'table_name': 'Hello'
        }, {
          'column_metadata': [
            {'id': 'b', 'type': 'Numeric'}
          ],
          'table_data': [[2]],
          'table_name': 'Hello_a'
        }])

  def test_nested_nested_object(self):
    self.assertEqual(
      import_json.dumps([{'a': {'b': 2, 'd': {'a': 'sugar'}}, 'c': 'foo'}], 'Hello')['tables'],
      [{
          'column_metadata': [
            {'id': 'a', 'type': 'Ref:Hello_a'}, {'id': 'c', 'type': 'Text'}
          ],
          'table_data': [[1],  ['foo']],
          'table_name': 'Hello'
        }, {
          'column_metadata': [
            {'id': 'b', 'type': 'Numeric'}, {'id': 'd', 'type': 'Ref:Hello_a_d'}
          ],
          'table_data': [[2], [1]],
          'table_name': 'Hello_a'
        }, {
          'column_metadata': [
            {'id': 'a', 'type': 'Text'}
          ],
          'table_data': [['sugar']],
          'table_name': 'Hello_a_d'
        }])


  def test_array_with_list(self):
    self.assertEqual(
      import_json.dumps([{'a': ['ES', 'FR', 'US']}, {'a': ['FR']}], 'Hello')['tables'],
      [{
        'column_metadata': [],
        'table_data': [],
        'table_name': 'Hello'
        }, {
          'column_metadata': [{'id': '', 'type': 'Text'}, {'id': 'Hello', 'type': 'Ref:Hello'}],
          'table_data': [['ES', 'FR', 'US', 'FR'], [1, 1, 1, 2]],
          'table_name': 'Hello_a'
        }])

  def test_array_with_list_of_dict(self):
    self.assertEqual(
      import_json.dumps([{'a': [{'b': 1}, {'b': 4}]}, {'c': 2}], 'Hello')['tables'],
      [ {
          'column_metadata': [{'id': 'c', 'type': 'Numeric'}],
          'table_data': [[None, 2]],
          'table_name': 'Hello'
        }, {
          'column_metadata': [
            {'id': 'b', 'type': 'Numeric'},
            {'id': 'Hello', 'type': 'Ref:Hello'}
          ],
          'table_data': [[1, 4], [1, 1]],
          'table_name': 'Hello_a'
        }])


  def test_array_of_array(self):
    self.assertEqual(
      import_json.dumps([['FR', 'US'], ['ES', 'CH']], 'Hello')['tables'],
      [{
          'column_metadata': [],
          'table_data': [],
          'table_name': 'Hello'
        }, {
          'column_metadata': [{'id': '', 'type': 'Text'}, {'id': 'Hello', 'type': 'Ref:Hello'}],
          'table_data': [['FR', 'US', 'ES', 'CH'], [1, 1, 2, 2]],
          'table_name': 'Hello_'
        }, ])


  def test_json_dict(self):
    self.assertEqual(
      import_json.dumps({
        'foo': [{'a': 1, 'b': 'santa'}, {'a': 4, 'b': 'cats'}],
        'bar': [{'c': 2, 'd': 'ducks'}, {'c': 5, 'd': 'dogs'}],
        'status': {'success': True, 'time': '5s'}
      }, 'Hello')['tables'], [{
          'table_name': 'Hello',
          'column_metadata': [{'id': 'status', 'type': 'Ref:Hello_status'}],
          'table_data': [[1]]
        }, {
          'table_name': 'Hello_bar',
          'column_metadata': [
            {'id': 'c', 'type': 'Numeric'},
            {'id': 'd', 'type': 'Text'},
            {'id': 'Hello', 'type': 'Ref:Hello'}
          ],
          'table_data': [[2, 5], ['ducks', 'dogs'], [1, 1]]
        }, {
          'table_name': 'Hello_foo',
          'column_metadata': [
            {'id': 'a', 'type': 'Numeric'},
            {'id': 'b', 'type': 'Text'},
            {'id': 'Hello', 'type': 'Ref:Hello'}],
          'table_data': [[1, 4], ['santa', 'cats'], [1, 1]]
        }, {
          'table_name': 'Hello_status',
          'column_metadata': [
            {'id': 'success', 'type': 'Bool'},
            {'id': 'time', 'type': 'Text'}
          ],
          'table_data': [[True], ['5s']]
        }])

  def test_json_types(self):
    self.assertEqual(import_json.dumps({
      'a': 3, 'b': 3.14, 'c': True, 'd': 'name', 'e': -4, 'f': '3.14', 'g': None
    }, 'Hello')['tables'],
      [{
        'table_name': 'Hello',
        'column_metadata': [
          {'id': 'a', 'type': 'Numeric'},
          {'id': 'b', 'type': 'Numeric'},
          {'id': 'c', 'type': 'Bool'},
          {'id': 'd', 'type': 'Text'},
          {'id': 'e', 'type': 'Numeric'},
          {'id': 'f', 'type': 'Text'},
          {'id': 'g', 'type': 'Text'}
        ],
      'table_data': [[3], [3.14], [True], ['name'], [-4], ['3.14'], [None]]
      }])

  def test_type_is_defined_with_first_value(self):
    tables = import_json.dumps([{'a': 'some text'}, {'a': 3}], '')
    self.assertIsNotNone(tables['tables'])
    self.assertIsNotNone(tables['tables'][0])
    self.assertIsNotNone(tables['tables'][0]['column_metadata'])
    self.assertIsNotNone(tables['tables'][0]['column_metadata'][0])
    self.assertEqual(tables['tables'][0]['column_metadata'][0]['type'], 'Text')

  def test_first_unique_key(self):
    self.assertEqual(import_json.first_available_key({'a': 1}, 'a'), 'a2')
    self.assertEqual(import_json.first_available_key({'a': 1}, 'b'), 'b')
    self.assertEqual(import_json.first_available_key({'a': 1, 'a2': 1}, 'a'), 'a3')


def dump_tables(options):
  data = {
    "foos": [
      {'foo': 1, 'link': [1, 2]},
      {'foo': 2, 'link': [1, 2]}
    ],
    "bar": {'hi': 'santa'}
  }
  return [t for t in import_json.dumps(data, 'FooBar', options)['tables']]


class TestParseOptions(TestCase):

  maxDiff = None

  # helpers
  def assertColInTable(self, tables, **kwargs):
    table = next(t for t in tables if t['table_name'] == kwargs['table_name'])
    self.assertEqual(any(col['id'] == kwargs['col_id'] for col in table['column_metadata']),
                     kwargs['present'])

  def assertTableNamesEqual(self, tables, expected_table_names):
    table_names = [t['table_name'] for t in tables]
    self.assertEqual(sorted(table_names), sorted(expected_table_names))

  def test_including_empty_string_includes_all(self):
    tables = dump_tables({'includes': '', 'excludes': ''})
    self.assertTableNamesEqual(tables, ['FooBar', 'FooBar_bar', 'FooBar_foos', 'FooBar_foos_link'])

  def test_including_foos_includes_nested_object_and_removes_ref_to_table_not_included(self):
    tables = dump_tables({'includes': 'FooBar_foos', 'excludes': ''})
    self.assertTableNamesEqual(tables, ['FooBar_foos', 'FooBar_foos_link'])
    self.assertColInTable(tables, table_name='FooBar_foos', col_id='FooBar', present=False)
    tables = dump_tables({'includes': 'FooBar_foos_link', 'excludes': ''})
    self.assertTableNamesEqual(tables, ['FooBar_foos_link'])
    self.assertColInTable(tables, table_name='FooBar_foos_link', col_id='FooBar_foos',
                          present=False)

  def test_excluding_foos_excludes_nested_object_and_removes_link_to_excluded_table(self):
    tables = dump_tables({'includes': '', 'excludes': 'FooBar_foos'})
    self.assertTableNamesEqual(tables, ['FooBar', 'FooBar_bar'])
    self.assertColInTable(tables, table_name='FooBar', col_id='foos', present=False)

  def test_excludes_works_on_nested_object_that_are_included(self):
    tables = dump_tables({'includes': 'FooBar_foos', 'excludes': 'FooBar_foos_link'})
    self.assertTableNamesEqual(tables, ['FooBar_foos'])

  def test_excludes_works_on_property(self):
    tables = dump_tables({'includes': '', 'excludes': 'FooBar_foos_foo'})
    self.assertTableNamesEqual(tables, ['FooBar', 'FooBar_foos', 'FooBar_foos_link', 'FooBar_bar'])
    self.assertColInTable(tables, table_name='FooBar_foos', col_id='foo', present=False)

  def test_works_with_multiple_includes(self):
    tables = dump_tables({'includes': 'FooBar_foos_link', 'excludes': ''})
    self.assertTableNamesEqual(tables, ['FooBar_foos_link'])
    tables = dump_tables({'includes': 'FooBar_foos_link;FooBar_bar', 'excludes': ''})
    self.assertTableNamesEqual(tables, ['FooBar_bar', 'FooBar_foos_link'])

  def test_works_with_multiple_excludes(self):
    tables = dump_tables({'includes': '', 'excludes': 'FooBar_foos_link;FooBar_bar'})
    self.assertTableNamesEqual(tables, ['FooBar', 'FooBar_foos'])
