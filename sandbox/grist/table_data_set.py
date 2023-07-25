import logging
from six.moves import zip as izip
import six

import actions
from usertypes import get_type_default

log = logging.getLogger(__name__)

class TableDataSet(object):
  """
  TableDataSet represents the full data of a Grist document as a dictionary mapping tableId to
  actions.TableData. It then allows applying arbitrary doc-actions, and updates its representation
  of the document accordingly. The dictionary is available as the object's `all_tables` member.

  This is used, in particular, for migrations, which need to access data with minimal assumptions
  about its interpretation.

  Note that to initialize a TableDataSet, the schema is needed, so it should be done by applying
  AddTable actions, followed by BulkAddRecord or ReplaceTableData actions.
  """

  def __init__(self):
    # Dictionary of { tableId: actions.TableData object }
    self.all_tables = {}

    # Dictionary of { tableId: { colId: values }} where values come from AddTable, as modified by
    # Add/ModifyColumn actions.
    self._schema = {}

  def apply_doc_action(self, action):
    try:
      getattr(self, action.__class__.__name__)(*action)
    except Exception as e:
      log.warning("ERROR applying action %s: %s", action, e)
      raise

  def apply_doc_actions(self, doc_actions):
    for a in doc_actions:
      self.apply_doc_action(a)
    return doc_actions

  def get_col_info(self, table_id, col_id):
    return self._schema[table_id][col_id]

  def get_schema(self):
    return self._schema

  #----------------------------------------
  # Actions on records.
  #----------------------------------------
  def AddRecord(self, table_id, row_id, columns):
    self.BulkAddRecord(table_id, [row_id], {key: [val] for key, val in six.iteritems(columns)})

  def BulkAddRecord(self, table_id, row_ids, columns):
    table_data = self.all_tables[table_id]
    table_data.row_ids.extend(row_ids)
    for col, values in six.iteritems(table_data.columns):
      if col in columns:
        values.extend(columns[col])
      else:
        col_info = self._schema[table_id][col]
        default = get_type_default(col_info['type'])
        values.extend([default] * len(row_ids))

  def RemoveRecord(self, table_id, row_id):
    return self.BulkRemoveRecord(table_id, [row_id])

  def BulkRemoveRecord(self, table_id, row_ids):
    table_data = self.all_tables[table_id]
    remove_set = set(row_ids)
    for col, values in six.iteritems(table_data.columns):
      values[:] = [v for r, v in izip(table_data.row_ids, values) if r not in remove_set]
    table_data.row_ids[:] = [r for r in table_data.row_ids if r not in remove_set]

  def UpdateRecord(self, table_id, row_id, columns):
    self.BulkUpdateRecord(
      table_id, [row_id], {key: [val] for key, val in six.iteritems(columns)})

  def BulkUpdateRecord(self, table_id, row_ids, columns):
    table_data = self.all_tables[table_id]
    rowid_map = {r:i for i, r in enumerate(table_data.row_ids)}
    table_indices = [rowid_map[r] for r in row_ids]
    for col, values in six.iteritems(columns):
      if col in table_data.columns:
        col_values = table_data.columns[col]
        for i, v in izip(table_indices, values):
          col_values[i] = v

  def ReplaceTableData(self, table_id, row_ids, columns):
    table_data = self.all_tables[table_id]
    del table_data.row_ids[:]
    for col, values in six.iteritems(table_data.columns):
      del values[:]
    self.BulkAddRecord(table_id, row_ids, columns)

  #----------------------------------------
  # Actions on columns.
  #----------------------------------------

  def AddColumn(self, table_id, col_id, col_info):
    self._schema[table_id][col_id] = col_info
    default = get_type_default(col_info['type'])
    table_data = self.all_tables[table_id]
    table_data.columns[col_id] = [default] * len(table_data.row_ids)

  def RemoveColumn(self, table_id, col_id):
    self._schema[table_id].pop(col_id, None)
    table_data = self.all_tables[table_id]
    table_data.columns.pop(col_id, None)

  def RenameColumn(self, table_id, old_col_id, new_col_id):
    self._schema[table_id][new_col_id] = self._schema[table_id].pop(old_col_id)
    table_data = self.all_tables[table_id]
    table_data.columns[new_col_id] = table_data.columns.pop(old_col_id)

  def ModifyColumn(self, table_id, col_id, col_info):
    self._schema[table_id][col_id].update(col_info)

  #----------------------------------------
  # Actions on tables.
  #----------------------------------------
  def AddTable(self, table_id, columns):
    self.all_tables[table_id] = actions.TableData(table_id, [], {c['id']: [] for c in columns})
    self._schema[table_id] = {c['id']: c.copy() for c in columns}

  def RemoveTable(self, table_id):
    del self.all_tables[table_id]
    del self._schema[table_id]

  def RenameTable(self, old_table_id, new_table_id):
    table_data = self.all_tables.pop(old_table_id)
    self.all_tables[new_table_id] = actions.TableData(new_table_id, table_data.row_ids,
                                              table_data.columns)
    self._schema[new_table_id] = self._schema.pop(old_table_id)
