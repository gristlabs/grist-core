import test_engine
import reference_preview
import docmodel
from unittest import mock


class TestReferencePreview(test_engine.EngineTestCase):
  def test_restores_model_on_success_and_failure_and_does_not_expose_preview_values(self):
    self.apply_user_action(['AddTable', 'Items', [dict(id='Price', type='Numeric', isFormula=False)]])
    self.apply_user_action(['AddRecord', 'Items', 1, dict(Price=5)])
    original = docmodel.global_docmodel
    reference_preview.preview(self.engine, [['UpdateRecord', 'Items', 1, dict(Price=99)]])
    self.assertIs(docmodel.global_docmodel, original)
    self.apply_user_action(['AddColumn', 'Items', 'PreviewRead', dict(type='Numeric', isFormula=True,
      formula="import docmodel\nreturn docmodel.global_docmodel.get_table('Items').lookupOne().Price")])
    self.assertEqual(self.engine.fetch_table('Items').columns['PreviewRead'], [5])
    with mock.patch('engine.Engine.load_meta_tables', side_effect=ValueError('preview failed')):
      with self.assertRaisesRegex(ValueError, 'preview failed'):
        reference_preview.preview(self.engine, [])
    self.assertIs(docmodel.global_docmodel, original)

  def test_peek_still_uses_live_engine_after_preview(self):
    self.apply_user_action(['AddTable', 'Cycle', [
      dict(id='A', type='Numeric', isFormula=True, formula='PEEK($B) + $Input'),
      dict(id='B', type='Numeric', isFormula=True, formula='$A + 1'),
      dict(id='Input', type='Numeric', isFormula=False)]])
    self.apply_user_action(['AddRecord', 'Cycle', 1, dict(Input=1)])
    reference_preview.preview(self.engine, [])
    self.apply_user_action(['UpdateRecord', 'Cycle', 1, dict(Input=2)])
    self.assertEqual(self.engine.fetch_table('Cycle').columns['A'], [4])
    self.assertEqual(self.engine.fetch_table('Cycle').columns['B'], [5])

  def test_now_and_request_still_dispatch_to_live_model_after_preview(self):
    from functions.date import NOW
    from functions.info import REQUEST
    reference_preview.preview(self.engine, [])
    with mock.patch.object(self.engine, 'use_current_time') as current_time:
      NOW()
      current_time.assert_called_once_with()
    with mock.patch.object(self.engine, '_requesting', side_effect=ValueError('live request')) as request:
      with self.assertRaisesRegex(ValueError, 'live request'):
        REQUEST('https://example.invalid')
      self.assertEqual(request.call_count, 1)

  def test_preview_is_isolated_and_reports_transitive_formulas(self):
    self.apply_user_action(['AddTable', 'Items', [dict(id='Price', type='Numeric', isFormula=False)]])
    self.apply_user_action(['AddRecord', 'Items', 1, dict(Price=5)])
    self.apply_user_action(['AddTable', 'Total', [
      dict(id='Sum', type='Numeric', isFormula=True, formula='sum(Items.all.Price)'),
      dict(id='Double', type='Numeric', isFormula=True, formula='$Sum * 2')]])
    self.apply_user_action(['AddRecord', 'Total', 1, {}])
    before = self.engine.fetch_table('Total')
    result = reference_preview.preview(self.engine, [['UpdateRecord', 'Items', 1, dict(Price=8)]])
    self.assertEqual(result['changed'], 2)
    self.assertEqual(result['newErrors'], 0)
    self.assertEqual([c['after'] for c in result['samples']], [8, 16])
    self.assertEqual(self.engine.fetch_table('Total'), before)
    self.assertEqual(self.engine.fetch_table('Items').columns['Price'], [5])
    # A later live change still has its dependencies, unaffected by clone disposal.
    self.apply_user_action(['UpdateRecord', 'Items', 1, dict(Price=9)])
    self.assertEqual(self.engine.fetch_table('Total').columns['Double'], [18])

  def test_removed_column_reports_formula_error_without_removing_live_column(self):
    self.apply_user_action(['AddTable', 'Items', [dict(id='Price', type='Numeric', isFormula=False)]])
    self.apply_user_action(['AddRecord', 'Items', 1, dict(Price=5)])
    self.apply_user_action(['AddTable', 'Total', [
      dict(id='Sum', type='Numeric', isFormula=True, formula='sum(Items.all.Price)')]])
    self.apply_user_action(['AddRecord', 'Total', 1, {}])
    result = reference_preview.preview(self.engine, [['RemoveColumn', 'Items', 'Price']])
    self.assertEqual(result['newErrors'], 1)
    self.assertEqual(result['samples'][0]['before'], 5)
    self.assertIn('Price', self.engine.fetch_table('Items').columns)

  def test_added_and_removed_formula_rows_are_counted(self):
    self.apply_user_action(['AddTable', 'Totals', [
      dict(id='Value', type='Numeric', isFormula=True, formula='10')]])
    self.apply_user_action(['AddRecord', 'Totals', 1, {}])
    result = reference_preview.preview(self.engine, [
      ['RemoveRecord', 'Totals', 1], ['AddRecord', 'Totals', 2, {}]])
    self.assertEqual(result['changed'], 2)
    self.assertEqual(result['samples'][0]['after'], None)
    self.assertEqual(result['samples'][1]['before'], None)
    self.assertEqual(self.engine.fetch_table('Totals').row_ids, [1])

  def test_large_incoming_snapshot_is_rejected_before_loading_a_clone(self):
    self.apply_user_action(['AddTable', 'Items', [dict(id='Value', type='Numeric', isFormula=False)]])
    with self.assertRaisesRegex(ValueError, '500000'):
      reference_preview.preview(self.engine, [['BulkAddRecord', 'Items', list(range(1, 500001)),
                                               dict(Value=[1] * 500000)]])
    self.assertEqual(self.engine.fetch_table('Items').row_ids, [])
