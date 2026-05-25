"""
Tests for the Spreadsheet widget feature: a per-cell grid backed by a single Grist record
whose columns are named by cell address (A1, B2, C3, ...).  Each visual cell is an independent
physical column, so formulas apply to exactly one cell.
"""
import logging
import time
import test_engine
from test_engine import Table, Column, View, Section, Field

log = logging.getLogger(__name__)


def spreadsheet_col_letter(index):
  """Convert a 0-based column index to a letter: 0->A, 1->B, ..., 25->Z."""
  if index < 26:
    return chr(ord('A') + index)
  return 'A' + chr(ord('A') + index - 26)


def spreadsheet_cell_col_id(col_index, row_index):
  """Convert (col_index, row_index) to a cell column ID: (0,0)->'A1', (1,1)->'B2'."""
  return spreadsheet_col_letter(col_index) + str(row_index + 1)


SPREADSHEET_NUM_COLS = 18
SPREADSHEET_NUM_ROWS = 30
SPREADSHEET_TOTAL_COLS = SPREADSHEET_NUM_COLS * SPREADSHEET_NUM_ROWS
SPREADSHEET_COL_LETTERS = [spreadsheet_col_letter(i) for i in range(SPREADSHEET_NUM_COLS)]
SPREADSHEET_CELL_IDS = [
  spreadsheet_cell_col_id(c, r)
  for r in range(SPREADSHEET_NUM_ROWS)
  for c in range(SPREADSHEET_NUM_COLS)
]


class TestSpreadsheet(test_engine.EngineTestCase):

  # ---------------------------------------------------------------------------
  # Table creation
  # ---------------------------------------------------------------------------

  @test_engine.test_undo
  def test_add_spreadsheet_table_creates_table(self):
    """AddSpreadsheetTable should create a table with the correct tableId."""
    self.apply_user_action(['AddSpreadsheetTable', None])
    tables = self.engine.fetch_table('_grist_Tables')
    table_ids = list(tables.columns['tableId'])
    self.assertIn('Spreadsheet', table_ids)

  @test_engine.test_undo
  def test_add_spreadsheet_table_custom_name(self):
    """AddSpreadsheetTable should accept a custom table name."""
    self.apply_user_action(['AddSpreadsheetTable', 'Budget'])
    tables = self.engine.fetch_table('_grist_Tables')
    table_ids = list(tables.columns['tableId'])
    self.assertIn('Budget', table_ids)

  @test_engine.test_undo
  def test_add_spreadsheet_table_has_cell_columns(self):
    """The spreadsheet table should have N_COLS*N_ROWS cell columns plus manualSort."""
    self.apply_user_action(['AddSpreadsheetTable', None])
    columns = self.engine.fetch_table('_grist_Tables_column')

    tables = self.engine.fetch_table('_grist_Tables')
    table_idx = list(tables.columns['tableId']).index('Spreadsheet')
    table_ref = tables.row_ids[table_idx]

    table_col_ids = [
      columns.columns['colId'][i]
      for i in range(len(columns.row_ids))
      if columns.columns['parentId'][i] == table_ref
    ]

    for cell_id in ['A1', 'B1', 'A2', 'R30']:
      self.assertIn(cell_id, table_col_ids,
                    "Cell column %s should exist" % cell_id)
    self.assertIn('manualSort', table_col_ids)
    self.assertEqual(len(table_col_ids), SPREADSHEET_TOTAL_COLS + 1)  # +1 for manualSort

  @test_engine.test_undo
  def test_add_spreadsheet_table_has_one_row(self):
    """The spreadsheet table should have exactly 1 record."""
    self.apply_user_action(['AddSpreadsheetTable', None])
    table_data = self.engine.fetch_table('Spreadsheet')
    self.assertEqual(len(table_data.row_ids), 1)

  @test_engine.test_undo
  def test_add_spreadsheet_table_columns_are_any_type(self):
    """All spreadsheet cell columns should be of type 'Any'."""
    self.apply_user_action(['AddSpreadsheetTable', None])
    columns = self.engine.fetch_table('_grist_Tables_column')

    tables = self.engine.fetch_table('_grist_Tables')
    table_idx = list(tables.columns['tableId']).index('Spreadsheet')
    table_ref = tables.row_ids[table_idx]

    for i in range(len(columns.row_ids)):
      if (columns.columns['parentId'][i] == table_ref and
          columns.columns['colId'][i] != 'manualSort'):
        col_type = columns.columns['type'][i]
        col_id = columns.columns['colId'][i]
        self.assertEqual(col_type, 'Any',
                         "Column %s should be type 'Any', got '%s'" % (col_id, col_type))

  @test_engine.test_undo
  def test_columns_are_data_columns(self):
    """All spreadsheet cell columns should be data columns (isFormula=False)."""
    self.apply_user_action(['AddSpreadsheetTable', None])
    columns = self.engine.fetch_table('_grist_Tables_column')

    tables = self.engine.fetch_table('_grist_Tables')
    table_idx = list(tables.columns['tableId']).index('Spreadsheet')
    table_ref = tables.row_ids[table_idx]

    for i in range(len(columns.row_ids)):
      if (columns.columns['parentId'][i] == table_ref and
          columns.columns['colId'][i] != 'manualSort'):
        is_formula = columns.columns['isFormula'][i]
        col_id = columns.columns['colId'][i]
        self.assertFalse(is_formula,
                         "Column %s should be a data column (isFormula=False)" % col_id)

  # ---------------------------------------------------------------------------
  # View section type
  # ---------------------------------------------------------------------------

  @test_engine.test_undo
  def test_spreadsheet_view_section_type(self):
    """The primary view section should have parentKey='spreadsheet'."""
    self.apply_user_action(['AddSpreadsheetTable', None])
    sections = self.engine.fetch_table('_grist_Views_section')

    tables = self.engine.fetch_table('_grist_Tables')
    table_idx = list(tables.columns['tableId']).index('Spreadsheet')
    table_ref = tables.row_ids[table_idx]

    found = any(
      sections.columns['tableRef'][i] == table_ref and
      sections.columns['parentKey'][i] == 'spreadsheet'
      for i in range(len(sections.row_ids))
    )
    self.assertTrue(found, "Should have a view section with parentKey='spreadsheet'")

  # ---------------------------------------------------------------------------
  # Multiple spreadsheet tables
  # ---------------------------------------------------------------------------

  @test_engine.test_undo
  def test_add_multiple_spreadsheet_tables(self):
    """Adding multiple spreadsheet tables should auto-increment names."""
    self.apply_user_action(['AddSpreadsheetTable', None])
    self.apply_user_action(['AddSpreadsheetTable', None])

    tables = self.engine.fetch_table('_grist_Tables')
    table_ids = list(tables.columns['tableId'])
    self.assertIn('Spreadsheet', table_ids)
    self.assertIn('Spreadsheet2', table_ids)

  # ---------------------------------------------------------------------------
  # Setting and reading cell values (1-record model)
  # ---------------------------------------------------------------------------

  @test_engine.test_undo
  def test_set_cell_value(self):
    """Setting a cell value stores it in the corresponding column of the single record."""
    self.apply_user_action(['AddSpreadsheetTable', None])
    self.apply_user_action(['UpdateRecord', 'Spreadsheet', 1, {'A1': 42}])

    table_data = self.engine.fetch_table('Spreadsheet')
    self.assertEqual(table_data.columns['A1'][0], 42)

  @test_engine.test_undo
  def test_cell_values_are_independent(self):
    """Each cell column is independent -- setting A1 does not affect A2, B1, etc."""
    self.apply_user_action(['AddSpreadsheetTable', None])
    self.apply_user_action(['UpdateRecord', 'Spreadsheet', 1, {'A1': 10, 'B2': 20}])

    table_data = self.engine.fetch_table('Spreadsheet')
    self.assertEqual(table_data.columns['A1'][0], 10)
    self.assertEqual(table_data.columns['B2'][0], 20)
    self.assertIsNone(table_data.columns['A2'][0])
    self.assertIsNone(table_data.columns['B1'][0])
    self.assertIsNone(table_data.columns['C1'][0])

  # ---------------------------------------------------------------------------
  # Per-cell formulas
  # ---------------------------------------------------------------------------

  @test_engine.test_undo
  def test_formula_in_single_cell(self):
    """A formula set on column C1 should compute only in that cell."""
    self.apply_user_action(['AddSpreadsheetTable', None])
    self.apply_user_action(['UpdateRecord', 'Spreadsheet', 1, {'A1': 10, 'B1': 20}])
    self.modify_column('Spreadsheet', 'C1', isFormula=True, formula='$A1 + $B1', type='Any')

    table_data = self.engine.fetch_table('Spreadsheet')
    self.assertEqual(table_data.columns['C1'][0], 30)
    self.assertIsNone(table_data.columns['C2'][0])
    self.assertIsNone(table_data.columns['C3'][0])

  @test_engine.test_undo
  def test_cell_ref_isolated_formula(self):
    """A1=10, B2=20, formula in C3=$A1+$B2 => C3=30, all other cells empty."""
    self.apply_user_action(['AddSpreadsheetTable', None])
    self.apply_user_action(['UpdateRecord', 'Spreadsheet', 1, {'A1': 10, 'B2': 20}])
    self.modify_column('Spreadsheet', 'C3', isFormula=True, formula='$A1 + $B2', type='Any')

    table_data = self.engine.fetch_table('Spreadsheet')

    # C3 should be 30
    self.assertEqual(table_data.columns['C3'][0], 30)

    # Other C cells should be empty
    self.assertIsNone(table_data.columns['C1'][0])
    self.assertIsNone(table_data.columns['C2'][0])
    self.assertIsNone(table_data.columns['C4'][0])

    # A: only A1 has a value
    self.assertEqual(table_data.columns['A1'][0], 10)
    self.assertIsNone(table_data.columns['A2'][0])
    self.assertIsNone(table_data.columns['A3'][0])

    # B: only B2 has a value
    self.assertIsNone(table_data.columns['B1'][0])
    self.assertEqual(table_data.columns['B2'][0], 20)
    self.assertIsNone(table_data.columns['B3'][0])

    # D, E cells: completely untouched
    for col_letter in ('D', 'E'):
      for r in (1, 2, 3):
        cell_id = col_letter + str(r)
        self.assertIsNone(table_data.columns[cell_id][0],
                          "Cell %s should be empty" % cell_id)

  @test_engine.test_undo
  def test_formula_dependency_chain(self):
    """Formulas should support dependency chains: A1->B1->C1."""
    self.apply_user_action(['AddSpreadsheetTable', None])
    self.apply_user_action(['UpdateRecord', 'Spreadsheet', 1, {'A1': 5}])
    self.modify_column('Spreadsheet', 'B1', isFormula=True, formula='$A1 * 2', type='Any')
    self.modify_column('Spreadsheet', 'C1', isFormula=True, formula='$B1 + 10', type='Any')

    table_data = self.engine.fetch_table('Spreadsheet')
    self.assertEqual(table_data.columns['B1'][0], 10)
    self.assertEqual(table_data.columns['C1'][0], 20)

    self.apply_user_action(['UpdateRecord', 'Spreadsheet', 1, {'A1': 7}])
    table_data = self.engine.fetch_table('Spreadsheet')
    self.assertEqual(table_data.columns['B1'][0], 14)
    self.assertEqual(table_data.columns['C1'][0], 24)

  @test_engine.test_undo
  def test_formula_updates_on_dependency_change(self):
    """Changing a referenced cell should update dependent formula cells."""
    self.apply_user_action(['AddSpreadsheetTable', None])
    self.apply_user_action(['UpdateRecord', 'Spreadsheet', 1, {'A1': 5}])
    self.modify_column('Spreadsheet', 'B1', isFormula=True, formula='$A1 * 10', type='Any')

    table_data = self.engine.fetch_table('Spreadsheet')
    self.assertEqual(table_data.columns['B1'][0], 50)

    self.apply_user_action(['UpdateRecord', 'Spreadsheet', 1, {'A1': 8}])
    table_data = self.engine.fetch_table('Spreadsheet')
    self.assertEqual(table_data.columns['B1'][0], 80)

  @test_engine.test_undo
  def test_cross_cell_formula(self):
    """A formula in D1 can reference cells from different visual rows/columns."""
    self.apply_user_action(['AddSpreadsheetTable', None])
    self.apply_user_action(['UpdateRecord', 'Spreadsheet', 1, {
      'A1': 10, 'A2': 20, 'A3': 30,
    }])
    self.modify_column('Spreadsheet', 'B1', isFormula=True,
                       formula='$A1 + $A2 + $A3', type='Any')

    table_data = self.engine.fetch_table('Spreadsheet')
    self.assertEqual(table_data.columns['B1'][0], 60)

  @test_engine.test_undo
  def test_cross_table_reference(self):
    """Spreadsheet cells can reference data from other tables."""
    self.apply_user_action(['AddSpreadsheetTable', None])
    self.apply_user_action(['AddTable', 'Prices', [
      {'id': 'item', 'type': 'Text'},
      {'id': 'price', 'type': 'Numeric'},
    ]])
    self.apply_user_action(['BulkAddRecord', 'Prices', [None, None], {
      'item': ['Apple', 'Banana'],
      'price': [1.5, 2.0],
    }])

    self.modify_column('Spreadsheet', 'A1', isFormula=True,
                       formula='Prices.lookupOne(item="Apple").price', type='Any')

    table_data = self.engine.fetch_table('Spreadsheet')
    self.assertEqual(table_data.columns['A1'][0], 1.5)

  # ---------------------------------------------------------------------------
  # Codebuilder: $A1 compiles to rec.A1 (not lookupOne)
  # ---------------------------------------------------------------------------

  @test_engine.test_undo
  def test_cell_ref_compiles_to_rec(self):
    """$A1 should compile to rec.A1, not table.lookupOne(id=1).A."""
    import codebuilder
    body = codebuilder.make_formula_body('$A1', None).get_text()
    self.assertEqual(body, 'return rec.A1')

  @test_engine.test_undo
  def test_cell_ref_arithmetic_compiles(self):
    """$A1 + $B2 should compile to rec.A1 + rec.B2."""
    import codebuilder
    body = codebuilder.make_formula_body('$A1 + $B2', None).get_text()
    self.assertEqual(body, 'return rec.A1 + rec.B2')

  @test_engine.test_undo
  def test_lowercase_not_cell_ref(self):
    """$foo123 (lowercase) should be a regular column reference."""
    import codebuilder
    body = codebuilder.make_formula_body('$foo123', None).get_text()
    self.assertEqual(body, 'return rec.foo123')

  # ---------------------------------------------------------------------------
  # Return value
  # ---------------------------------------------------------------------------

  @test_engine.test_undo
  def test_add_spreadsheet_table_returns_info(self):
    """AddSpreadsheetTable should return table info with id, table_id, views."""
    out_actions = self.apply_user_action(['AddSpreadsheetTable', None])
    ret = out_actions.retValues[0]
    self.assertIn('id', ret)
    self.assertIn('table_id', ret)
    self.assertIn('views', ret)
    self.assertEqual(ret['table_id'], 'Spreadsheet')

  # ---------------------------------------------------------------------------
  # Performance
  # ---------------------------------------------------------------------------

  def test_performance_grid_sizes(self):
    """Measure creation time for grid sizes in 3:5 ratio to find optimal default."""
    import sys
    candidates = [
      (12, 20),   #  240 cols
      (15, 25),   #  375 cols
      (18, 30),   #  540 cols
      (21, 35),   #  735 cols
      (24, 40),   #  960 cols
      (27, 45),   # 1215 cols
      (30, 50),   # 1500 cols
    ]
    results = []
    for cols, rows in candidates:
      total = cols * rows
      if total > 1990:
        print("  SKIP %dx%d (%d cols): exceeds SQLite limit" % (cols, rows, total),
              file=sys.stderr)
        continue
      start = time.time()
      try:
        self.apply_user_action([
          'AddSpreadsheetTable', 'Perf_%dx%d' % (cols, rows), cols, rows])
        elapsed = time.time() - start
        results.append((cols, rows, total, elapsed))
        print("  Grid %dx%d (%d columns): %.3fs" % (cols, rows, total, elapsed),
              file=sys.stderr)
      except Exception as e:
        print("  FAIL %dx%d: %s" % (cols, rows, e), file=sys.stderr)
        break
    # All valid sizes must complete within 60 seconds
    for cols, rows, total, elapsed in results:
      self.assertLess(elapsed, 60.0,
                      "Grid %dx%d (%d cols) took too long: %.1fs" % (cols, rows, total, elapsed))
