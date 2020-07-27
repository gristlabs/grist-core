import actions
import schema
import logger
from usertypes import strict_equal

log = logger.Logger(__name__, logger.INFO)

class DocActions(object):
  def __init__(self, engine):
    self._engine = engine

  #----------------------------------------
  # Actions on records.
  #----------------------------------------

  def AddRecord(self, table_id, row_id, column_values):
    self.BulkAddRecord(
      table_id, [row_id], {key: [val] for key, val in column_values.iteritems()})

  def BulkAddRecord(self, table_id, row_ids, column_values):
    table = self._engine.tables[table_id]
    for row_id in row_ids:
      assert row_id not in table.row_ids, \
          "docactions.[Bulk]AddRecord for existing record #%s" % row_id

    self._engine.out_actions.undo.append(actions.BulkRemoveRecord(table_id, row_ids).simplify())

    self._engine.add_records(table_id, row_ids, column_values)

  def RemoveRecord(self, table_id, row_id):
    return self.BulkRemoveRecord(table_id, [row_id])

  def BulkRemoveRecord(self, table_id, row_ids):
    table = self._engine.tables[table_id]

    # Collect the undo values, and unset all values in the column (i.e. set to defaults), just to
    # make sure we don't have stale values hanging around.
    undo_values = {}
    for column in table.all_columns.itervalues():
      if not column.is_formula() and column.col_id != "id":
        col_values = map(column.raw_get, row_ids)
        default = column.getdefault()
        # If this column had all default values, don't include it into the undo BulkAddRecord.
        if not all(strict_equal(val, default) for val in col_values):
          undo_values[column.col_id] = col_values
      for row_id in row_ids:
        column.unset(row_id)

    # Generate the undo action.
    self._engine.out_actions.undo.append(
        actions.BulkAddRecord(table_id, row_ids, undo_values).simplify())

    # Invalidate the deleted rows, so that anything that depends on them gets recomputed.
    self._engine.invalidate_records(table_id, row_ids)

  def UpdateRecord(self, table_id, row_id, columns):
    self.BulkUpdateRecord(
      table_id, [row_id], {key: [val] for key, val in columns.iteritems()})

  def BulkUpdateRecord(self, table_id, row_ids, columns):
    table = self._engine.tables[table_id]
    for row_id in row_ids:
      assert row_id in table.row_ids, \
          "docactions.[Bulk]UpdateRecord for non-existent record #%s" % row_id

    # Load the updated values.
    undo_values = {}
    for col_id, values in columns.iteritems():
      col = table.get_column(col_id)
      undo_values[col_id] = map(col.raw_get, row_ids)
      for (row_id, value) in zip(row_ids, values):
        col.set(row_id, value)

    # Generate the undo action.
    self._engine.out_actions.undo.append(
        actions.BulkUpdateRecord(table_id, row_ids, undo_values).simplify())

    # Invalidate the updated rows, just for the columns that got changed (and, as always,
    # anything that depends on them).
    self._engine.invalidate_records(table_id, row_ids, col_ids=columns.keys())


  def ReplaceTableData(self, table_id, row_ids, column_values):
    old_data = self._engine.fetch_table(table_id, formulas=False)
    self._engine.out_actions.undo.append(actions.ReplaceTableData(*old_data))
    self._engine.load_table(actions.TableData(table_id, row_ids, column_values))

  #----------------------------------------
  # Actions on columns.
  #----------------------------------------

  def AddColumn(self, table_id, col_id, col_info):
    table = self._engine.tables[table_id]
    assert not table.has_column(col_id), "Column %s already exists in %s" % (col_id, table_id)

    # Add the new column to the schema object maintained in the engine.
    self._engine.schema[table_id].columns[col_id] = schema.dict_to_col(col_info, col_id=col_id)
    self._engine.rebuild_usercode()
    self._engine.new_column_name(table)

    # Generate the undo action.
    self._engine.out_actions.undo.append(actions.RemoveColumn(table_id, col_id))

  def RemoveColumn(self, table_id, col_id):
    table = self._engine.tables[table_id]
    assert table.has_column(col_id), "Column %s not in table %s" % (col_id, table_id)

    # Generate (if needed) the undo action to restore the data.
    undo_action = None
    column = table.get_column(col_id)
    if not column.is_formula():
      default = column.getdefault()
      # Add to undo a BulkUpdateRecord for non-default values in the column being removed.
      row_ids = [r for r in table.row_ids if not strict_equal(column.raw_get(r), default)]
      undo_action = actions.BulkUpdateRecord(table_id, row_ids, {
        column.col_id: map(column.raw_get, row_ids)
      }).simplify()

    # Remove the specified column from the schema object.
    colinfo = self._engine.schema[table_id].columns.pop(col_id)
    self._engine.rebuild_usercode()

    # Generate the undo action(s).
    if undo_action:
      self._engine.out_actions.undo.append(undo_action)
    self._engine.out_actions.undo.append(actions.AddColumn(
      table_id, col_id, schema.col_to_dict(colinfo, include_id=False)))

  def RenameColumn(self, table_id, old_col_id, new_col_id):
    table = self._engine.tables[table_id]

    assert table.has_column(old_col_id), "Column %s not in table %s" % (old_col_id, table_id)
    assert not table.has_column(new_col_id), \
        "Column %s already exists in %s" % (new_col_id, table_id)
    old_column = table.get_column(old_col_id)

    # Replace the renamed column in the schema object.
    schema_table_info = self._engine.schema[table_id]
    colinfo = schema_table_info.columns.pop(old_col_id)
    schema_table_info.columns[new_col_id] = schema.SchemaColumn(
      new_col_id, colinfo.type, colinfo.isFormula, colinfo.formula)

    self._engine.rebuild_usercode()
    self._engine.new_column_name(table)

    # We replaced the old column with a new Column object (not strictly necessary, but simpler).
    # For a raw data column, we need to copy over the data from the old column object.
    new_column = table.get_column(new_col_id)
    new_column.copy_from_column(old_column)

    # Generate the undo action.
    self._engine.out_actions.undo.append(actions.RenameColumn(table_id, new_col_id, old_col_id))

  def ModifyColumn(self, table_id, col_id, col_info):
    table = self._engine.tables[table_id]
    assert table.has_column(col_id), "Column %s not in table %s" % (col_id, table_id)
    old_column = table.get_column(col_id)

    # Modify the specified column in the schema object.
    schema_table_info = self._engine.schema[table_id]
    old = schema_table_info.columns[col_id]
    new = schema.SchemaColumn(col_id,
                              col_info.get('type', old.type),
                              bool(col_info.get('isFormula', old.isFormula)),
                              col_info.get('formula', old.formula))
    if new == old:
      log.info("ModifyColumn called which was a noop")
      return

    undo_col_info = {k: v for k, v in schema.col_to_dict(old, include_id=False).iteritems()
                     if k in col_info}

    # Remove the column from the schema, then re-add it, to force creation of a new column object.
    schema_table_info.columns.pop(col_id)
    self._engine.rebuild_usercode()

    schema_table_info.columns[col_id] = new
    self._engine.rebuild_usercode()

    # Fill in the new column with the values from the old column.
    new_column = table.get_column(col_id)
    for row_id in table.row_ids:
      new_column.set(row_id, old_column.raw_get(row_id))

    # Generate the undo action.
    self._engine.out_actions.undo.append(actions.ModifyColumn(table_id, col_id, undo_col_info))

  #----------------------------------------
  # Actions on tables.
  #----------------------------------------

  def AddTable(self, table_id, columns):
    assert table_id not in self._engine.tables, "Table %s already exists" % table_id

    # Update schema, and re-generate the module code.
    self._engine.schema[table_id] = schema.SchemaTable(table_id, schema.dict_list_to_cols(columns))
    self._engine.rebuild_usercode()

    # Generate the undo action.
    self._engine.out_actions.undo.append(actions.RemoveTable(table_id))

  def RemoveTable(self, table_id):
    assert table_id in self._engine.tables, "Table %s doesn't exist" % table_id

    # Create undo actions to restore all the data records of this table.
    table_data = self._engine.fetch_table(table_id, formulas=False)
    undo_action = actions.BulkAddRecord(*table_data).simplify()
    if undo_action:
      self._engine.out_actions.undo.append(undo_action)

    # Update schema, and re-generate the module code.
    schema_table = self._engine.schema.pop(table_id)
    self._engine.rebuild_usercode()

    # Generate the undo action.
    self._engine.out_actions.undo.append(actions.AddTable(
      table_id, schema.cols_to_dict_list(schema_table.columns)))

  def RenameTable(self, old_table_id, new_table_id):
    assert old_table_id in self._engine.tables, "Table %s doesn't exist" % old_table_id
    assert new_table_id not in self._engine.tables, "Table %s already exists" % new_table_id

    old_table = self._engine.tables[old_table_id]

    # Update schema, and re-generate the module code.
    old = self._engine.schema.pop(old_table_id)
    self._engine.schema[new_table_id] = schema.SchemaTable(new_table_id, old.columns)
    self._engine.rebuild_usercode()

    # Copy over all columns from the old table to the new.
    new_table = self._engine.tables[new_table_id]
    for new_column in new_table.all_columns.itervalues():
      if not new_column.is_formula():
        new_column.copy_from_column(old_table.get_column(new_column.col_id))
    new_table.grow_to_max()   # We need to bring formula columns to the right size too.

    # Generate the undo action.
    self._engine.out_actions.undo.append(actions.RenameTable(new_table_id, old_table_id))

# end
