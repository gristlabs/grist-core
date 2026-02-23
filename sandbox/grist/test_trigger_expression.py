import json
import unittest

import test_engine
from predicate_formula import parse_predicate_formula
from trigger_expression import parse_trigger_condition, parse_conditions_in_triggers


class TestConditionParsing(unittest.TestCase):
  """Unit tests for trigger_expression functions."""

  def test_parse_condition_value_with_text_only(self):
    """Test parsing a condition with only text field."""
    condition = json.dumps({'text': '$A == "Foo"'})
    result = parse_trigger_condition(condition)
    result_data = json.loads(result)

    self.assertEqual(result_data['text'], '$A == "Foo"')
    self.assertEqual(result_data['parsed'], parse_predicate_formula('$A == "Foo"'))

  def test_parse_condition_value_already_parsed(self):
    """Test that already parsed conditions are not re-parsed."""
    condition = json.dumps({
      'text': '$A == "Foo"',
      'parsed': '["some", "wrong", "structure"]'
    })
    result = parse_trigger_condition(condition)

    # Should return unchanged
    self.assertEqual(result, condition)

  def test_parse_condition_value_with_plain_string(self):
    """Test that a plain string gets converted to object with text field."""
    condition = '$A == "Foo"'
    result = parse_trigger_condition(condition)
    result_data = json.loads(result)

    self.assertEqual(result_data['text'], '$A == "Foo"')
    self.assertIn('parsed', result_data)

  def test_parse_condition_value_with_empty_text(self):
    """Test that empty text returns original condition."""
    condition = json.dumps({'text': ''})
    result = parse_trigger_condition(condition)

    self.assertIsNone(result)

  def test_parse_condition_value_with_no_text_field(self):
    """Test that object without text field returns original."""
    condition = json.dumps({'foo': 'bar'})
    result = parse_trigger_condition(condition)

    self.assertIsNone(result)

  def test_parse_trigger_condition_multiple_values(self):
    """Test parsing multiple condition values in col_values."""
    col_values = {
      'condition': [
        json.dumps({'text': '$A == "Foo"'}),
        json.dumps({'text': 'rec.B == "Director"'}),
        json.dumps({'text': '', 'parsed': 'existing'}),  # empty text, will be cleared
        'rec.C > 10',  # plain string
      ]
    }

    parse_conditions_in_triggers(col_values)

    result1 = json.loads(col_values['condition'][0])
    self.assertIn('parsed', result1)
    self.assertEqual(result1['text'], '$A == "Foo"')

    result2 = json.loads(col_values['condition'][1])
    self.assertIn('parsed', result2)
    self.assertEqual(result2['text'], 'rec.B == "Director"')

    self.assertIsNone(col_values['condition'][2])

    result4 = json.loads(col_values['condition'][3])
    self.assertIn('parsed', result4)
    self.assertEqual(result4['text'], 'rec.C > 10')

  def test_parse_trigger_condition_no_condition_field(self):
    """Test that missing condition field is handled gracefully."""
    col_values = {'other_field': ['value']}
    parse_conditions_in_triggers(col_values)

    # Should not crash and should not add condition field
    self.assertNotIn('condition', col_values)

  def test_parse_condition_with_json_non_dict(self):
    """Test that valid JSON that's not a dict is treated as plain string."""
    # JSON string value - the entire JSON-encoded string becomes the text

    wrong_conditions = [
      json.dumps("encoded string"),
      json.dumps(42),
      json.dumps(["list", "of", "values"]),
      json.dumps(3.14),
      json.dumps(True),
      json.dumps(None),
    ]

    for cond in wrong_conditions:
      self.assertEqual(parse_trigger_condition(cond), cond)


class TestTriggerActions(test_engine.EngineTestCase):
  def test_condition_parsed_on_add_and_update(self):
    # Create a table so the trigger has a valid tableRef.
    self.apply_user_action(['AddTable', 'Table1', [
      {'id': 'A', 'type': 'Text'},
    ]])

    tables = self.engine.fetch_table('_grist_Tables')
    table_ref = tables.row_ids[tables.columns['tableId'].index('Table1')]

    condition_text = '$A == "Foo"'
    self.apply_user_action(['AddRecord', '_grist_Triggers', None, {
      'tableRef': table_ref,
      'condition': json.dumps({'text': condition_text}),
    }])

    expected_condition = json.dumps({
      'text': condition_text,
      'parsed': parse_predicate_formula(condition_text),
    })
    trigger_table = self.engine.fetch_table('_grist_Triggers')
    trigger_id = trigger_table.row_ids[0]
    self.assertEqual(trigger_table.columns['condition'], [expected_condition])

    # Update the condition text and ensure it is re-parsed.
    new_condition_text = 'rec.A == "Bar"'
    self.apply_user_action(['UpdateRecord', '_grist_Triggers', trigger_id, {
      'condition': json.dumps({'text': new_condition_text}),
    }])
    updated_condition = json.dumps({
      'text': new_condition_text,
      'parsed': parse_predicate_formula(new_condition_text),
    })
    trigger_table = self.engine.fetch_table('_grist_Triggers')
    self.assertEqual(trigger_table.columns['condition'], [updated_condition])

    # Add another one with plain string condition.
    plain_condition_text = 'rec.A != "Baz"'
    self.apply_user_action(['AddRecord', '_grist_Triggers', None, {
      'tableRef': table_ref,
      'condition': plain_condition_text,
    }])

    expected_plain_condition = json.dumps({
      'text': plain_condition_text,
      'parsed': parse_predicate_formula(plain_condition_text),
    })
    trigger_table = self.engine.fetch_table('_grist_Triggers')
    self.assertEqual(trigger_table.columns['condition'][1], expected_plain_condition)

  def test_should_clear_the_condition_when_text_cleared(self):
    self.apply_user_action(['AddTable', 'Table1', [
      {'id': 'A', 'type': 'Text'},
    ]])

    tables = self.engine.fetch_table('_grist_Tables')
    table_ref = tables.row_ids[tables.columns['tableId'].index('Table1')]

    condition_text = '$A == "Foo"'
    self.apply_user_action(['AddRecord', '_grist_Triggers', None, {
      'tableRef': table_ref,
      'condition': condition_text,
    }])

    values_to_clear = [
      None,
      "",
      json.dumps({'text': ''}),
      json.dumps({'text': None}),
    ]

    for val in values_to_clear:
      # First restore the condition to a valid state if it was cleared in a previous iteration
      self.apply_user_action(['UpdateRecord', '_grist_Triggers', 1, {
        'condition': json.dumps({'text': condition_text}),
      }])

      # Sanity check that it worked
      trigger_table = self.engine.fetch_table('_grist_Triggers')
      self.assertEqual(trigger_table.columns['condition'], [
        json.dumps({
          'text': condition_text,
          'parsed': parse_predicate_formula(condition_text)
        })
      ])

      # Now apply the value that should clear the condition
      self.apply_user_action(['UpdateRecord', '_grist_Triggers', 1, {
        'condition': val,
      }])

      trigger_table = self.engine.fetch_table('_grist_Triggers')
      self.assertEqual(trigger_table.columns['condition'], [None])


class TestTriggerConditionRenames(test_engine.EngineTestCase):
  def setUp(self):
    super().setUp()

    # Create a table with columns for tests
    self.apply_user_action(['AddTable', 'Table1', [
      {'id': 'A', 'type': 'Text'},
      {'id': 'B', 'type': 'Text'},
    ]])

    self.apply_user_action(['AddTable', 'Table2', [
      {'id': 'A', 'type': 'Text'},
      {'id': 'B', 'type': 'Text'},
    ]])

    tables = self.engine.fetch_table('_grist_Tables')
    table_1 = tables.row_ids[tables.columns['tableId'].index('Table1')]
    table_2 = tables.row_ids[tables.columns['tableId'].index('Table2')]

    # Add a trigger with a condition referencing the Status column
    self.apply_user_action(['AddRecord', '_grist_Triggers', None, {
      'tableRef': table_1,
      'condition': '$A == 1',
    }])

    self.apply_user_action(['AddRecord', '_grist_Triggers', None, {
      'tableRef': table_2,
      'condition': '$A == 2',
    }])

  def get_condition(self, index=0):
    # Get the condition from the text of the trigger at the given index
    trigger_table = self.engine.fetch_table('_grist_Triggers')
    condition_json = json.loads(trigger_table.columns['condition'][index])
    return condition_json['text']

  def set_condition(self, condition_text):
    # Update the condition of the first trigger
    self.apply_user_action(['UpdateRecord', '_grist_Triggers', 1, {
      'condition': condition_text,
    }])

  def test_column_rename_updates_trigger_condition(self):
    """Test that renaming a column updates the trigger condition formula."""
    # Rename the Status column
    self.apply_user_action(['RenameColumn', 'Table1', 'A', 'A2'])

    # Check that the Table1 trigger condition was updated
    self.assertEqual(self.get_condition(0), '$A2 == 1')
    # Check that the Table2 trigger condition was not changed
    self.assertEqual(self.get_condition(1), '$A == 2')

  def test_column_rename_with_oldRec(self):
    """Test that renaming a column updates oldRec references in trigger conditions."""
    # Update the trigger to use oldRec reference
    self.set_condition('rec.A != oldRec.A and rec.B == "test"')

    # Rename both columns
    self.apply_user_action(['RenameColumn', 'Table1', 'A', 'A2'])
    self.apply_user_action(['RenameColumn', 'Table1', 'B', 'B2'])

    # Check that both rec and oldRec references were updated in Table1's trigger
    self.assertEqual(self.get_condition(0), 'rec.A2 != oldRec.A2 and rec.B2 == "test"')
    # Check that the Table2 trigger condition was not changed
    self.assertEqual(self.get_condition(1), '$A == 2')

  def test_column_rename_updates_both_table_triggers(self):
    """Test that renaming columns in both tables updates both trigger conditions."""
    # Rename columns in Table1
    self.apply_user_action(['RenameColumn', 'Table1', 'A', 'A2'])

    # Rename columns in Table2
    self.apply_user_action(['RenameColumn', 'Table2', 'A', 'A3'])

    # Check that both trigger conditions were updated correctly
    self.assertEqual(self.get_condition(0), '$A2 == 1')
    self.assertEqual(self.get_condition(1), '$A3 == 2')
