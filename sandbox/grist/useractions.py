# pylint: disable=too-many-lines
from collections import namedtuple, Counter, OrderedDict
import re
import json
import sys

import six
from six.moves import xrange

import acl
from acl_formula import parse_acl_formula_json
import actions
import column
import identifiers
from objtypes import strict_equal, encode_object
import schema
from schema import RecalcWhen
import summary
import import_actions
import textbuilder
import usertypes
import treeview

from table import get_validation_func_name

import logger
log = logger.Logger(__name__, logger.INFO)


_current_module = sys.modules[__name__]
_action_types = {}

# When distinguishing actions directly requested by the user from actions that
# are indirect consequences of those actions (specifically, adding rows to summary tables)
# we count levels of indirection. Zero indirection levels implies an action is directly
# requested.
DIRECT_ACTION = 0

# Fields of _grist_Tables_column table that may be modified using ModifyColumns useraction.
_modifiable_col_fields = {'type', 'widgetOptions', 'formula', 'isFormula', 'label',
                          'untieColIdFromLabel'}

# Fields of _grist_Tables_column table that are inherited by group-by columns from their source.
_inherited_groupby_col_fields = {'colId', 'widgetOptions', 'label', 'untieColIdFromLabel'}

# Fields of _grist_Tables_column table that are inherited by summary formula columns from source.
_inherited_summary_col_fields = {'colId', 'label'}

# Schema properties that can be modified using ModifyColumn docaction.
_modify_col_schema_props = {'type', 'formula', 'isFormula'}


# A few generic helpers.
def select_keys(dict_obj, keys):
  """Return copy of dict_obj containing only the given keys."""
  return {k: v for k, v in six.iteritems(dict_obj) if k in keys}

def has_value(dict_obj, key, value):
  """Returns True if dict_obj contains key, and its value is value."""
  return key in dict_obj and dict_obj[key] == value

def has_diff_value(dict_obj, key, value):
  """Returns True if dict_obj contains key, and its value is something other than value."""
  return key in dict_obj and dict_obj[key] != value

def make_bulk_values_dict(record_values_pairs):
  """
  Given a list of (record, values_dict) pairs, returns a single dict with a union of the keys of
  all values_dicts, mapping each key to the array of values parallel to records. The output is the
  kind of dict required for BulkUpdateRecord/BulkAddRecord actions.
  Missing values are filled in with corresponding attributes from the original records.
  """
  all_keys = {key for (rec, values) in record_values_pairs for key in values}
  return {
    # Whenever we are missing a value, use the original value from the col record.
    key: [values.get(key, getattr(rec, key)) for (rec, values) in record_values_pairs]
    for key in all_keys
  }


def is_hidden_table(table_id):
  return table_id.startswith('GristHidden_')


def useraction(method):
  """
  Decorator for a method, which creates an action class with the same name and arguments.
  """
  code = method.__code__
  name = method.__name__
  cls = namedtuple(name, code.co_varnames[1:code.co_argcount])
  setattr(_current_module, name, cls)
  _action_types[name] = cls
  return method


# UserActions that require special handling for different tables can have table-specific special
# implementations defined in methods decorated with `override_action(action_name, table_id)`.
# These get stored in _action_method_overrides map, with (action_name, table_id) as key.
_action_method_overrides = {}
def override_action(action_name, table_id):
  def do_wrap(method):
    _action_method_overrides[(action_name, table_id)] = method
    return method
  return do_wrap


def from_repr(user_action):
  """
  Converts a UserAction array into an object such as UpdateRecord.
  """
  action_type = _action_types.get(user_action[0])
  if not action_type:
    raise ValueError('Unknown action %s' % user_action[0])
  try:
    return action_type(*user_action[1:])
  except TypeError as e:
    raise TypeError("%s: %s" % (user_action[0], str(e)))

def _make_clean_col_info(col_info, col_id=None):
  """
  Fills in missing fields in a col_info object of AddColumn or AddTable user actions.
  """
  is_formula = col_info.get('isFormula', True)
  ret = {
    'isFormula': is_formula,
    # A formula column should default to type 'Any'.
    'type': col_info.get('type', 'Any' if is_formula else 'Text'),
    'formula': col_info.get('formula', '')
  }
  if col_id:
    ret['id'] = col_id
  return ret


def guess_type(values, convert=False):
  """
  Returns a suitable type for the given iterable of values, optionally attempting conversions.
  """
  # TODO: this should consider all possible types we support, and pick the most common one.
  numeric = usertypes.Numeric()
  counter = Counter(bool(numeric.is_right_type(numeric.convert(v) if convert else v))
      for v in values if v not in ('', None))
  total = sum(counter.values())
  return "Numeric" if total and counter[True] >= total * 0.9 else "Text"


class UserActions(object):
  def __init__(self, eng):
    self._engine = eng
    self._docmodel = eng.docmodel
    self._summary = summary.SummaryActions(self, self._docmodel)
    self._import_actions = import_actions.ImportActions(self, self._docmodel, eng)
    self._allow_changes = False
    self._indirection_level = DIRECT_ACTION

    # Map of methods implementing particular (action_name, table_id) combinations. It mirrors
    # global _action_method_overrides, but with methods *bound* to this UserActions instance.
    self._overrides = {key: method.__get__(self, UserActions)
                       for key, method in six.iteritems(_action_method_overrides)}

  def enter_indirection(self):
    """
    Mark any actions following this call as being indirect, until leave_indirection is
    called. Nesting is supported (but not used).
    """
    self._indirection_level += 1

  def leave_indirection(self):
    """
    Undo an enter_indirection.
    """
    self._indirection_level -= 1
    assert self._indirection_level >= 0

  def _do_doc_action(self, action):
    if hasattr(action, 'simplify'):
      # Convert bulk actions to single actions if possible, or None if it affects no rows.
      action = action.simplify()
    if action:
      self._engine.out_actions.stored.append(action)
      self._engine.out_actions.direct.append(self._indirection_level == DIRECT_ACTION)
      self._engine.apply_doc_action(action)

  def _bulk_action_iter(self, table_id, row_ids, col_values=None):
    """
    Helper for processing Bulk actions, which generates a list of (i, record, value_dict) tuples,
    one for each record, where value_dict maps keys to values for that particular record.
    If col_values is None, generates a list of (i, record) pairs.
    """
    table = self._engine.tables[table_id]
    for i, row_id in enumerate(row_ids):
      rec = table.get_record(row_id)
      yield ((i, rec) if col_values is None else
             (i, rec, {k: v[i] for k, v in six.iteritems(col_values)}))

  def _collect_back_references(self, table_recs):
    """
    Return a list of columns records for Reference or ReferenceList columns that refer to any of
    the passed-in tables.
    """
    cols = []
    for table_rec in table_recs:
      table_obj = self._engine.tables[table_rec.tableId]
      for col in table_obj._back_references:
        if not col.is_private():
          cols.extend(self._docmodel.columns.lookupRecords(tableId=col.table_id, colId=col.col_id))
    cols.sort()
    return cols

  #----------------------------------------
  # Special user actions.
  #----------------------------------------

  @useraction
  def InitNewDoc(self, timezone, locale):
    creation_actions = schema.schema_create_actions()
    self._engine.out_actions.stored.extend(creation_actions)
    self._engine.out_actions.direct += [True] * len(creation_actions)
    self._do_doc_action(actions.AddRecord("_grist_DocInfo", 1,
                                          {'schemaVersion': schema.SCHEMA_VERSION,
                                           'timezone': timezone,
                                           'documentSettings': json.dumps({'locale': locale})}))

    # Set up initial ACL data.
    # NOTE The special records below are not actually used. They were intended for obsolete ACL
    # plans, and are kept here to ensure that old versions of Grist can still open newer or
    # migrated documents. (At least as long as they don't actually include additional new ACL
    # rules.)
    self._do_doc_action(actions.BulkAddRecord("_grist_ACLPrincipals", [1,2,3,4], {
      'type':       ['group', 'group', 'group', 'group'],
      'groupName':  ['Owners', 'Admins', 'Editors', 'Viewers'],
    }))
    self._do_doc_action(actions.AddRecord("_grist_ACLResources", 1, {
      'tableId': '',
      'colIds': ''
    }))
    self._do_doc_action(actions.AddRecord("_grist_ACLRules", 1, {
      'resource': 1,
      'permissions': acl.Permissions.OWNER,
      'principals': '[1]'
    }))

  @useraction
  def ApplyDocActions(self, doc_actions):
    for doc_action in doc_actions:
      self._do_doc_action(actions.action_from_repr(doc_action))

  @useraction
  def ApplyUndoActions(self, undo_actions):
    for undo_action in reversed(undo_actions):
      self._do_doc_action(actions.action_from_repr(undo_action))

  @useraction
  def Calculate(self):
    """
    This is a dummy action whose only purpose is to trigger calculation
    of any dirty cells.
    """
    pass

  #----------------------------------------
  # User actions on records.
  #----------------------------------------

  @useraction
  def AddRecord(self, table_id, row_id, column_values):
    return self.BulkAddRecord(
      table_id, [row_id], {key: [val] for key, val in six.iteritems(column_values)}
    )[0]

  @useraction
  def BulkAddRecord(self, table_id, row_ids, column_values):
    column_values = actions.decode_bulk_values(column_values)
    for col_id, values in six.iteritems(column_values):
      self._ensure_column_accepts_data(table_id, col_id, values)
    method = self._overrides.get(('BulkAddRecord', table_id), self.doBulkAddOrReplace)
    return method(table_id, row_ids, column_values)

  @useraction
  def ReplaceTableData(self, table_id, row_ids, column_values):
    column_values = actions.decode_bulk_values(column_values)
    # There doesn't seem any need to return the big array of ids.
    self.doBulkAddOrReplace(table_id, row_ids, column_values, replace=True)

  def doBulkAddOrReplace(self, table_id, row_ids, column_values, replace=False):
    table = self._engine.tables[table_id]
    next_row_id = 1 if replace else table.next_row_id()

    # Make a copy of row_ids and fill in those set to None.
    filled_row_ids = row_ids[:]
    for i, row_id in enumerate(filled_row_ids):
      if row_id is None or row_id < 0:
        filled_row_ids[i] = row_id = next_row_id
      next_row_id = max(next_row_id, row_id) + 1

    # Whenever we add new rows, remember the mapping from any negative row_ids to their final
    # values. This allows the negative_row_ids to be used as Reference values in subsequent
    # actions in the same bundle.
    self._engine.out_actions.summary.update_new_rows_map(table_id, row_ids, filled_row_ids)

    # Convert entered values to the correct types.
    ActionType = actions.ReplaceTableData if replace else actions.BulkAddRecord
    action, extra_actions = self._engine.convert_action_values(
      ActionType(table_id, filled_row_ids, column_values))

    # If any extra actions were generated (e.g. to adjust positions), apply them.
    for a in extra_actions:
      self._do_doc_action(a)

    # We could set static default values for omitted data columns, or we can ensure that other
    # code (JS, DocStorage) is aware of the static defaults. Since other code is already aware,
    # we'll skip this step. We also don't populate column defaults when adding a new column.

    if table_id == "_grist_Validations":
      for idx, row_id in enumerate(filled_row_ids):
        self.doAddColumn(
          self._engine.tables["_grist_Tables"].get_column("tableId").raw_get(
            column_values["tableRef"][idx]), get_validation_func_name(row_id),
          { "isFormula" : True, "formula" : column_values["formula"][idx], "type": "Any" })

    self._do_doc_action(action)

    # Invalidate new records, including the columns that may have default formulas (trigger
    # formulas set to recalculate on new records), to get dynamically-computed default values.
    recalc_cols = set()
    for col_id in table.all_columns:
      if col_id in column_values:
        continue
      if not table_id.startswith('_grist_'):
        col_rec = self._docmodel.columns.lookupOne(tableId=table_id, colId=col_id)
        if col_rec.recalcWhen == RecalcWhen.NEVER:
          continue
      recalc_cols.add(col_id)

    self._engine.invalidate_records(table_id, filled_row_ids, data_cols_to_recompute=recalc_cols)

    return filled_row_ids

  @override_action('BulkAddRecord', '_grist_ACLRules')
  def _addACLRules(self, table_id, row_ids, col_values):
    # Automatically populate aclFormulaParsed value by parsing aclFormula.
    if 'aclFormula' in col_values:
      col_values['aclFormulaParsed'] = [parse_acl_formula_json(v) for v in col_values['aclFormula']]
    return self.doBulkAddOrReplace(table_id, row_ids, col_values)

  #----------------------------------------
  # UpdateRecords & co.
  #----------------------------------------

  def doBulkUpdateRecord(self, table_id, row_ids, columns):
    # Convert passed-in values to the column's correct types (or alttext, or errors) and trim any
    # unchanged values.
    action, extra_actions = self._engine.convert_action_values(
      actions.BulkUpdateRecord(table_id, row_ids, columns))
    action = self._engine.trim_update_action(action)

    # If any extra actions were generated (e.g. to adjust positions), apply them.
    for a in extra_actions:
      self._do_doc_action(a)

    # Finally, update the record
    self._do_doc_action(action)

    # Invalidate trigger-formula columns affected by this update.
    table = self._engine.tables[table_id]
    column_values = action[2]
    if column_values:     # Only if this is a non-trivial update.
      for col_id, col_obj in six.iteritems(table.all_columns):
        if col_obj.is_formula() or not col_obj.has_formula():
          continue
        col_rec = self._docmodel.columns.lookupOne(tableId=table_id, colId=col_id)

        # Schedule for recalculation those trigger-formulas that depend on any manual update.
        if col_rec.recalcWhen == RecalcWhen.MANUAL_UPDATES:
          self._engine.invalidate_column(col_obj, row_ids, recompute_data_col=True)

        # When we have an explicit value for a trigger-formula, the logic in docactions.py
        # normally prevents recalculation so that the explicit value would stay (it is also
        # important for undos). For a data-cleaning column (one that depends on itself), a manual
        # change *should* trigger recalculation, so we un-prevent it here.
        if col_id in column_values and col_rec.recalcOnChangesToSelf:
          self._engine.prevent_recalc(col_obj.node, row_ids, should_prevent=False)


  # Helper to perform doBulkUpdateRecord using record update value pairs. This saves
  #  the steps of separating the value pairs into row ids and column values.
  # The record_values_pairs should be given as a list of tuples, the first element of each
  #  being a record and the second being an object mapping col_id to the updated value.
  def doBulkUpdateFromPairs(self, table_id, record_values_pairs):
    row_ids = [int(r) for (r, _) in record_values_pairs]
    return self.doBulkUpdateRecord(table_id, row_ids, make_bulk_values_dict(record_values_pairs))

  @useraction
  def UpdateRecord(self, table_id, row_id, columns):
    self.BulkUpdateRecord(table_id, [row_id],
                          {key: [col] for key, col in six.iteritems(columns)})

  @useraction
  def BulkUpdateRecord(self, table_id, row_ids, columns):
    columns = actions.decode_bulk_values(columns)

    # Handle special tables, updates to which imply metadata actions.

    # Check that the update is valid.
    for col_id, values in six.iteritems(columns):
      self._ensure_column_accepts_data(table_id, col_id, values)

      # Additionally check that we are not trying to modify group-by values in a summary column
      # (this check is only for updating records, not for adding). Note that col_rec will not be
      # found for metadata tables (since there is no metadata for the metadata tables).
      col_rec = self._docmodel.columns.lookupOne(tableId=table_id, colId=col_id)
      if col_rec and col_rec.summarySourceCol:
        raise ValueError("Cannot enter data into summary group-by column %s" % col_id)

    method = self._overrides.get(('BulkUpdateRecord', table_id), self.doBulkUpdateRecord)
    method(table_id, row_ids, columns)

  @override_action('BulkUpdateRecord', '_grist_Validations')
  def _updateValidationRecords(self, table_id, row_ids, col_values):
    for i, rec, values in self._bulk_action_iter(table_id, row_ids, col_values):
      vcolid = get_validation_func_name(rec.id)
      col_rec = self._docmodel.columns.lookupOne(parentId=rec.tableRef, colId=vcolid)
      # TODO: Validations table's tableRef should be a Reference rather than an Int.
      if has_diff_value(values, 'tableRef', rec.tableRef):
        self._docmodel.remove([col_rec])
        new_table_id = self._docmodel.tables.table.get_record(values['tableRef']).tableId
        new_col_info = {"isFormula": True, "type": "Any",
                        "formula": values.get('formula', rec.formula)}
        self.doAddColumn(new_table_id, vcolid, new_col_info)
      elif has_diff_value(values, 'formula', rec.formula):
        self._docmodel.update([col_rec], formula=values['formula'])

    self.doBulkUpdateRecord(table_id, row_ids, col_values)


  @override_action('BulkUpdateRecord', '_grist_Tables')
  def _updateTableRecords(self, table_id, row_ids, col_values):
    avoid_tableid_set = set(self._engine.tables)
    update_pairs = []
    for i, rec, values in self._bulk_action_iter(table_id, row_ids, col_values):
      update_pairs.append((rec, values))
      if has_diff_value(values, 'tableId', rec.tableId):
        # Disallow renaming of summary tables.
        if rec.summarySourceTable:
          raise ValueError("RenameTable: cannot rename a summary table")

        # Find a non-conflicting name, except that we don't need to avoid the old name.
        avoid = avoid_tableid_set - {rec.tableId}
        new_table_id = identifiers.pick_table_ident(values['tableId'], avoid=avoid)
        values['tableId'] = new_table_id
        avoid_tableid_set.add(new_table_id)
        if new_table_id != rec.tableId:
          # If there are summary tables based on this table, rename them to appropriate names.
          for st in rec.summaryTables:
            st_table_id = summary.encode_summary_table_name(new_table_id)
            st_table_id = identifiers.pick_table_ident(st_table_id, avoid=avoid_tableid_set)
            avoid_tableid_set.add(st_table_id)
            update_pairs.append((st, {'tableId': st_table_id}))

    # If other tables have columns referring to this table, generate actions to modify their types
    # (e.g. from 'Ref:Foo' to 'Ref:Bar'). We change type to 'Int' temporarily, to avoid having
    # invalid references, then change to correct type. Undo involves a similar sequence of events.
    backref_cols = self._collect_back_references(table_rec for table_rec, _ in update_pairs)
    col_updates = OrderedDict()
    table_renames = {t.tableId: values['tableId'] for t, values in update_pairs
               if has_diff_value(values, 'tableId', t.tableId)}
    for col in backref_cols:
      # Typename will normally be "Ref" or "RefList".
      typename, old_target = col.type.split(':')[:2]
      if old_target in table_renames:
        col_updates[col] = {'type': typename + ':' + table_renames[old_target]}

    if table_renames:
      # Build up a dictionary mapping col_ref of each affected formula to the new formula text.
      formula_updates = self._prepare_formula_renames(
        {(old, None): new for (old, new) in six.iteritems(table_renames)})
      # Add the changes to the dict of col_updates. sort for reproducible order.
      for col_rec, new_formula in sorted(six.iteritems(formula_updates)):
        col_updates.setdefault(col_rec, {})['formula'] = new_formula

    # If a table changes to onDemand, any empty columns (formula columns with no set formula)
    # should be converted to non-formula text columns to avoid SQL errors when they are updated.
    on_demand_set = [t for t, values in update_pairs
      if has_diff_value(values, 'onDemand', t.onDemand) and values['onDemand']]
    empty_cols = [c for t in on_demand_set for c in t.columns if c.isFormula and not c.formula]
    for col in empty_cols:
      col_updates.setdefault(col, {}).update(isFormula=False, type='Text')

    for col, values in six.iteritems(col_updates):
      if 'type' in values:
        self.doModifyColumn(col.tableId, col.colId, {'type': 'Int'})

    make_acl_updates = acl.prepare_acl_table_renames(self._docmodel, self, table_renames)

    # Collect all the table renames, and do the actual schema actions to apply them.
    for tbl, values in update_pairs:
      if has_diff_value(values, 'tableId', tbl.tableId):
        self._do_doc_action(actions.RenameTable(tbl.tableId, values['tableId']))

    # Update the metadata to reflect the renamed tables.
    self.doBulkUpdateFromPairs(table_id, update_pairs)

    # Do the modifications of column types and formulas affected by the renames.
    # Internal functions are used to prevent unintended additional changes from occurring.
    # Specifically, this prevents widgetOptions and displayCol from being cleared as a side
    # effect of the column type change.
    for col, values in six.iteritems(col_updates):
      self.doModifyColumn(col.tableId, col.colId, values)
    self.doBulkUpdateFromPairs('_grist_Tables_column', col_updates.items())
    make_acl_updates()


  @override_action('BulkUpdateRecord', '_grist_Tables_column')
  def _updateColumnRecords(self, table_id, row_ids, col_values):
    # Does various automatic adjustments required for column updates.
    # col_values is a dict of arrays, each array containing values for all col_recs. We process
    # each column individually (to keep code simpler), in _adjust_one_column_update.
    #
    # Adjustments made:
    # (1) colIds are sanitized and disambiguated.
    # (2) Changes to label cause a change to colId, unless untieColIdFromLabel flag is set.
    # (3) Turning off untieColIdFromLabel flag also syncs label to colId.
    #
    # Additionally, summary tables require some special handling of columns changes.
    # (1) We disallow converting summary-table columns between formula and non-formula.
    # (2) We disallow renaming summary-table group-by (non-formula) columns directly (but such
    #     renames are auto-generated when renaming their source column).
    # (3) Updates to summary-table formula columns should affect sister columns (same-named
    #     columns for all summary tables of the same source table).
    # (4) Updates to the source columns of summary group-by columns (including renaming and type
    #     changes) should be copied to those group-by columns.

    # A list of individual (col_rec, values) updates, where values is a per-column dict.
    col_updates = OrderedDict()
    avoid_colid_set = set()
    rebuild_summary_tables = set()
    for i, col_rec, values in self._bulk_action_iter(table_id, row_ids, col_values):
      col_updates.update(
        self._adjust_one_column_update(col_rec, values, avoid_colid_set, rebuild_summary_tables)
      )

    # Collect all renamings that we are about to apply.
    renames = {(c.parentId.tableId, c.colId): values['colId']
               for c, values in six.iteritems(col_updates)
               if has_diff_value(values, 'colId', c.colId)}

    if renames:
      # Build up a dictionary mapping col_ref of each affected formula to the new formula text.
      formula_updates = self._prepare_formula_renames(renames)

      # For any affected columns, include the formula into the update.
      for col_rec, new_formula in sorted(six.iteritems(formula_updates)):
        col_updates.setdefault(col_rec, {}).setdefault('formula', new_formula)

    update_pairs = col_updates.items()

    # Disallow most changes to summary group-by columns, except to match the underlying column.
    for col, values in update_pairs:
      if col.summarySourceCol:
        underlying = col_updates.get(col.summarySourceCol, {})
        if not all(value == getattr(col, key) or has_value(underlying, key, value)
                   for key, value in six.iteritems(values)
                   if key not in ('displayCol', 'visibleCol')):
          raise ValueError("Cannot modify summary group-by column '%s'" % col.colId)

    make_acl_updates = acl.prepare_acl_col_renames(self._docmodel, self, renames)

    for c, values in update_pairs:
      # Trigger ModifyColumn and RenameColumn as necessary
      schema_colinfo = select_keys(values, _modify_col_schema_props)
      if schema_colinfo:
        self.doModifyColumn(c.parentId.tableId, c.colId, schema_colinfo)
      if has_diff_value(values, 'colId', c.colId):
        self._do_doc_action(actions.RenameColumn(c.parentId.tableId, c.colId, values['colId']))

    # If we change a column's type, we should ALSO unset each affected field's widgetOptions and
    # displayCol.
    type_changed = [c for c, values in update_pairs if has_diff_value(values, 'type', c.type)]
    self._docmodel.update([f for c in type_changed for f in c.viewFields],
                          widgetOptions='', displayCol=0)

    # If the column update changes its trigger-formula conditions, rebuild dependencies.
    if any(("recalcWhen" in values or "recalcDeps" in values) for c, values in update_pairs):
      self._engine.trigger_columns_changed()

    self.doBulkUpdateFromPairs(table_id, update_pairs)

    for table_id in rebuild_summary_tables:
      table = self._engine.tables[table_id]
      self._engine._update_table_model(table, table.user_table)

    make_acl_updates()


  @override_action('BulkUpdateRecord', '_grist_Views')
  def _updateViewRecords(self, table_id, row_ids, col_values):
    # If we change a view's name, and that view is a primary view, change
    # its table's tableId as well.
    if 'name' in col_values:
      rename_table_recs = []
      rename_names = []
      for i, rec, values in self._bulk_action_iter(table_id, row_ids, col_values):
        if rec.primaryViewTable:
          rename_table_recs.append(rec.primaryViewTable)
          rename_names.append(values['name'])
      self._docmodel.update(rename_table_recs, tableId=rename_names)

    self.doBulkUpdateRecord(table_id, row_ids, col_values)

  @override_action('BulkUpdateRecord', '_grist_ACLRules')
  def _updateACLRules(self, table_id, row_ids, col_values):
    # Automatically populate aclFormulaParsed value by parsing aclFormula.
    if 'aclFormula' in col_values:
      col_values['aclFormulaParsed'] = [parse_acl_formula_json(v) for v in col_values['aclFormula']]
    return self.doBulkUpdateRecord(table_id, row_ids, col_values)

  def _prepare_formula_renames(self, renames):
    """
    Helper that accepts a dict of {(table_id, col_id): new_name} (where col_id is None when table
    is being renamed) and returns a dictionary mapping col_recs to updated formulas, for all
    columns whose formula is affected by the rename.
    """
    # We'll maintain a list of textbuilder patches for each affected col_rec.
    patches_map = {}

    for (formula_info, pos, table_id, col_id) in self._engine.gencode.grist_names():
      # Check if we are seeing a mention of a column that's getting renamed.
      new_name = renames.get((table_id, col_id))
      if new_name:
        # Get the record for the affected formula column.
        (formula_table, formula_col) = formula_info
        col_rec = self._docmodel.get_column_rec(formula_table, formula_col)
        # Create a patch and append to the list for this col_rec.
        name = col_id or table_id
        formula = col_rec.formula
        patch = textbuilder.make_patch(formula, pos, pos + len(name), new_name)
        patches_map.setdefault(col_rec, []).append(patch)

    # Apply the collected patches to each affected formula
    result = {}
    for col_rec, patches in patches_map.items():
      formula = col_rec.formula
      replacer = textbuilder.Replacer(textbuilder.Text(formula), patches)
      result[col_rec] = replacer.get_text()
    return result


  def _get_column_values(self, col_rec):
    table = self._engine.tables[col_rec.parentId.tableId]
    col_obj = table.get_column(col_rec.colId)
    return (col_obj.raw_get(r) for r in table.row_ids)

  def _adjust_one_column_update(self, col, col_values, avoid_colid_set, rebuild_summary_tables):
    # Adjust an update for a single column, implementing the meat of _updateColumnRecords().
    # Returns a list of (col, values) pairs (containing the input column but possibly more).
    # Note that it may modify col_values in-place, and may reuse it for multiple results.

    results = []
    def add(cols, value_dict):
      results.extend((c, value_dict) for c in cols)

    # If changing label, sync it to colId unless untieColIdFromLabel flag is set.
    if 'label' in col_values and not col_values.get('untieColIdFromLabel',col.untieColIdFromLabel):
      col_values.setdefault('colId', col_values['label'])

    # If changing untieColIdFromLabel flag to False, then sync colId to label.
    if has_value(col_values, 'untieColIdFromLabel', False):
      col_values.setdefault('colId', col_values.get('label', col.label))

    # If renaming columns, pick unique names for them. In addition to avoiding existing names, we
    # avoid all the names used while processing _adjust_columns_update(). This is necessary when
    # multiple updates have conflicting sanitized names.
    if has_diff_value(col_values, 'colId', col.colId):
      col_values['colId'] = self._pick_col_name(col.parentId, col_values['colId'],
                                                old_col_id=col.colId, avoid_extra=avoid_colid_set)
      avoid_colid_set.add(col_values['colId'])

    # If converting a formula column of type "Any" to non-formula, set a reasonable type for it.
    if (col.isFormula and has_value(col_values, 'isFormula', False) and
        col.type == 'Any' and 'type' not in col_values):
      # Look at the actual data for that column (first 1000 values) to decide on the type.
      col_values['type'] = guess_type(self._get_column_values(col), convert=False)

    # If changing the type of a column, unset its widgetOptions and displayCol by default.
    if 'type' in col_values:
      col_values.setdefault('widgetOptions', '')
      col_values.setdefault('displayCol', 0)

    source_table = col.parentId.summarySourceTable
    if source_table:  # This is a summary-table column.
      # Disallow isFormula changes.
      if has_diff_value(col_values, 'isFormula', col.isFormula):
        raise ValueError("Cannot change summary column '%s' between formula and data" % col.colId)

      if col.isFormula:
        # Get all same-named formula columns from other summary tables for the same source table,
        # and apply the same changes to them.
        add(self._get_sister_columns(source_table, col), col_values)

    else:             # A non-summary-table column.
      # If there are group-by columns based on this, change their properties to match (including
      # colId, for renaming), except formula/isFormula.
      changes = select_keys(col_values, _inherited_groupby_col_fields)
      if 'type' in col_values:
        changes['type'] = summary.summary_groupby_col_type(col_values['type'])
        if col_values['type'] != changes['type']:
          rebuild_summary_tables.update(t.tableId for t in col.summaryGroupByColumns.parentId)
      add(col.summaryGroupByColumns, changes)

      # If there are summary tables with a same-named formula column, rename those to match.
      add(self._get_sister_columns(col.parentId, col),
          select_keys(col_values, _inherited_summary_col_fields))

    # We keep the original column at the end. This matters for modifying source group-by columns:
    # adjusting the summary columns first ensures that they have the new (converted) values by
    # the time lookupOrAddDerived() calls search for converted value.
    results.append((col, col_values))
    return results


  def _get_sister_columns(self, source_table, col):
    """
    Returns all summary columns based on the given source_table, with colId matching that of col,
    and excluding col from the returned list.
    """
    # The filter removes falsy columns, i.e. results from tables that don't have a match.
    col_recs = [self._docmodel.columns.lookupOne(parentId=t, colId=col.colId, isFormula=True)
                for t in source_table.summaryTables]
    return [c for c in col_recs if c and c != col]


  def _ensure_column_accepts_data(self, table_id, col_id, values):
    """
    When we store values (via Add or Update), check that the column is a data column. If it is an
    empty column (formula column with an empty formula), convert to data. If it's a real formula
    column, then fail.
    """
    schema_col = self._engine.schema[table_id].columns[col_id]
    if not schema_col.isFormula:
      # Plain old data column, OK to enter values.
      return

    if not schema_col.formula:
      # An empty column (isFormula=True, formula=""), now is the time to convert it to data.
      if schema_col.type == 'Any':
        # Guess the type when it starts out as Any. We unfortunately need to a separate
        # ModifyColumn call for type conversion, to recompute type-specific defaults
        # before they are used in formula->data conversion.
        self.ModifyColumn(table_id, col_id, {'type': guess_type(values, convert=True)})
      self.ModifyColumn(table_id, col_id, {'isFormula': False})
    else:
      # Otherwise, this is an error. We can't save individual values to formula columns.
      raise ValueError("Can't save value to formula column %s" % col_id)

  #----------------------------------------
  # RemoveRecords & co.
  #----------------------------------------

  def doBulkRemoveRecord(self, table_id, row_ids_or_records):
    table = self._engine.tables[table_id]
    assert all(isinstance(r, (int, table.Record)) for r in row_ids_or_records)
    row_ids = [int(r) for r in row_ids_or_records]

    self._do_doc_action(actions.BulkRemoveRecord(table_id, row_ids))

    # Also remove any references to this row from other tables.
    row_id_set = set(row_ids)
    for ref_col in table._back_references:
      if ref_col.is_formula() or not isinstance(ref_col, column.BaseReferenceColumn):
        continue
      updates = ref_col.get_updates_for_removed_target_rows(row_id_set)
      if updates:
        self._do_doc_action(actions.BulkUpdateRecord(ref_col.table_id,
          [row_id for (row_id, value) in updates],
          { ref_col.col_id: [value for (row_id, value) in updates] }
        ))

  @useraction
  def RemoveRecord(self, table_id, row_id):
    return self.BulkRemoveRecord(table_id, [row_id])

  @useraction
  def BulkRemoveRecord(self, table_id, row_ids):
    # table_rec will not be found for metadata tables, but they are not summary tables anyway.
    table_rec = self._docmodel.tables.lookupOne(tableId=table_id)
    if table_rec and table_rec.summarySourceTable:
      raise ValueError("Cannot remove record from summary table")

    method = self._overrides.get(('BulkRemoveRecord', table_id), self.doBulkRemoveRecord)
    method(table_id, row_ids)


  @override_action('BulkRemoveRecord', '_grist_Validations')
  def _removeValidationRecords(self, table_id, row_ids):
    # TODO: Validations should be redesigned to use helper columns.
    col_recs = [
      self._docmodel.columns.lookupOne(parentId=v.tableRef, colId=get_validation_func_name(v.id))
      for i, v in self._bulk_action_iter(table_id, row_ids)
    ]
    self.doBulkRemoveRecord(table_id, row_ids)

    # Remove the associated validation columns.
    self._docmodel.remove(col_recs)


  @override_action('BulkRemoveRecord', '_grist_Tables')
  def _removeTableRecords(self, table_id, row_ids):
    remove_table_recs = [rec for i, rec in self._bulk_action_iter(table_id, row_ids)]

    # If there are summary tables based on this table, remove those too.
    remove_table_recs.extend(st for t in remove_table_recs for st in t.summaryTables)

    # If other tables have columns referring to this table, remove them.
    self._docmodel.remove(self._collect_back_references(remove_table_recs))

    # Remove all view sections and fields for all tables being removed.
    self._docmodel.remove(vs for t in remove_table_recs for vs in t.viewSections)

    # TODO: we need sandbox-side tests for this logic and similar logic elsewhere that deals with
    # application-level relationships; it is not tested by testscript (nor should be, most likely;
    # it should have much simpler tests).

    # Remove any views that no longer have view sections. We scan through TableViews (i.e. left
    # side-pane entries) for this table, so Views under other tables or under "other views" will
    # be unaffected to avoid confusing the user by deleteing views they are not interacting with.
    views_to_remove = [tv.viewRef for t in remove_table_recs for tv in t.tableViews
                       if not tv.viewRef.viewSections]
    # Also delete the primary views for tables being deleted, even if it has remaining sections.
    for t in remove_table_recs:
      if t.primaryViewId and t.primaryViewId not in views_to_remove:
        views_to_remove.append(t.primaryViewId)
    self._docmodel.remove(views_to_remove)

    # Save table IDs, which will be inaccessible once we remove the metadata records.
    remove_table_ids = [t.tableId for t in remove_table_recs]

    # Remove the metadata for the columns and the table itself.
    col_row_ids = [int(col) for t in remove_table_recs for col in t.columns]
    table_row_ids = [int(t) for t in remove_table_recs]
    self.doBulkRemoveRecord('_grist_Tables_column', col_row_ids)
    self.doBulkRemoveRecord(table_id, table_row_ids)

    # Do the actual RemoveTable docactions. This is done at the end, in reverse order of how
    # AddTable works, so that 'undo' does schema and metadata actions in the usual order.
    for table_id in remove_table_ids:
      self._do_doc_action(actions.RemoveTable(table_id))


  @override_action('BulkRemoveRecord', '_grist_Tables_column')
  def _removeColumnRecords(self, table_id, row_ids):
    col_recs = [c for i, c in self._bulk_action_iter(table_id, row_ids)]

    # Summary tables disallow removing group-by columns.
    if any(c.summarySourceCol for c in col_recs):
      raise ValueError("RemoveColumn: cannot remove a group-by column from a summary table")

    # We need to remove group-by columns based on the columns being removed. To ensure we don't end
    # up with multiple summary tables with the same breakdown, we'll implement this by using
    # UpdateSummaryViewSection() on all the affected sections.
    removed_groupby_cols = set(col_recs)
    summary_tables = {sc.parentId for c in col_recs for sc in c.summaryGroupByColumns}
    for tbl in sorted(summary_tables):
      for section in tbl.viewSections:
        source_cols = [f.colRef.summarySourceCol for f in section.fields]
        new_groupby_cols = [int(c) for c in source_cols if c and c not in removed_groupby_cols]
        self.UpdateSummaryViewSection(int(section), new_groupby_cols)

    # At this point, group-by columns based on this should only remain in unused tables
    # which will get auto-deleted.

    # Remove this column from any sort specs to which it belongs.
    parent_sections = {section for c in col_recs for section in c.parentId.viewSections}
    removed_col_refs = set(row_ids)
    re_sort_sections = []
    re_sort_specs = []
    for section in parent_sections:
      # Only iterates once for each section. Updated sort removes all columns being deleted.
      sort = json.loads(section.sortColRefs) if section.sortColRefs else []
      updated_sort = [sort_ref for sort_ref in sort if abs(sort_ref) not in removed_col_refs]
      if sort != updated_sort:
        re_sort_sections.append(section)
        re_sort_specs.append(json.dumps(updated_sort))
    self._docmodel.update(re_sort_sections, sortColRefs=re_sort_specs)

    # Remove all view fields for all removed columns.
    self._docmodel.remove([f for c in col_recs for f in c.viewFields])

    # If there is a displayCol, it may get auto-removed, but may first produce calc actions
    # triggered by the removal of this column. To avoid those, remove displayCols immediately.
    # Also remove displayCol for any columns or fields that use this col as their visibleCol.
    more_removals = set()
    more_removals.update([c.displayCol for c in col_recs],
                         [vc.displayCol for c in col_recs
                          for vc in self._docmodel.columns.lookupRecords(visibleCol=c.id)],
                         [vf.displayCol for c in col_recs
                          for vf in self._docmodel.view_fields.lookupRecords(visibleCol=c.id)])

    # Add any extra removals after removing the requested columns in the requested order.
    orig_removals = set(col_recs)
    all_removals = col_recs + sorted(c for c in more_removals if c.id and c not in orig_removals)

    # Remove metadata records, but prepare schema actions before the metadata is cleared.
    removals = [actions.RemoveColumn(c.parentId.tableId, c.colId) for c in all_removals]
    self.doBulkRemoveRecord(table_id, [int(c) for c in all_removals])

    # Finally do the schema actions to remove the columns.
    for action in removals:
      self._do_doc_action(action)


  @override_action('BulkRemoveRecord', '_grist_Views')
  def _removeViewRecords(self, table_id, row_ids):
    """
    Remove views, including all related items (tab bar, sections, etc.)
    """
    view_recs = [rec for i, rec in self._bulk_action_iter(table_id, row_ids)]

    # Remove all the tabBar and tableView items, and the view sections.
    self._docmodel.remove(t for v in view_recs for t in v.tabBarItems)
    self._docmodel.remove(t for v in view_recs for t in v.tableViewItems)
    self._docmodel.remove(vs for v in view_recs for vs in v.viewSections)

    # Remove all the pages and fixes indentation
    self._docmodel.remove([p for v in view_recs for p in v.pageItems])

    # Remove the view records themselves.
    self.doBulkRemoveRecord(table_id, row_ids)

  @override_action('BulkRemoveRecord', '_grist_Pages')
  def _removePageRecords(self, table_id, row_ids):
    """
    Remove page records and for the those that have children, udpate the first child's indentation
    so that it becomes the new parent. Note that this run a O(n) routine for each page to remove but
    it's ok considering that the list of _grist_Pages is not meant to grow that big.
    """
    all_pages = list(self._engine.tables[table_id].filter_records())
    all_pages.sort(key=lambda p: p.pagePos)
    fixes = treeview.fix_indents(all_pages, row_ids)
    if fixes:
      fixed_row_ids = [f[0] for f in fixes]
      fixed_indentation = [f[1] for f in fixes]
      self.doBulkUpdateRecord(table_id, fixed_row_ids, {'indentation': fixed_indentation})

    self.doBulkRemoveRecord(table_id, row_ids)

  @override_action('BulkRemoveRecord', '_grist_Views_section')
  def _removeViewSectionRecords(self, table_id, row_ids):
    """
    Remove view sections, including their fields.
    """
    view_section_recs = [rec for i, rec in self._bulk_action_iter(table_id, row_ids)]
    self._docmodel.remove(f for vs in view_section_recs for f in vs.fields)
    self.doBulkRemoveRecord(table_id, row_ids)


  #----------------------------------------
  # User actions on columns.
  #----------------------------------------

  @useraction
  def AddColumn(self, table_id, col_id, col_info):
    table_rec = self._docmodel.get_table_rec(table_id)

    # New columns by default are empty formula columns, but OnDemand tables require adding
    # new columns as data columns.
    if table_rec.onDemand:
      col_info.setdefault("isFormula", False)

    # Summary tables disallow creating new non-formula columns.
    if table_rec.summarySourceTable:
      clean_colinfo = _make_clean_col_info(col_info)
      if not clean_colinfo["isFormula"]:
        raise ValueError("AddColumn: cannot add a non-formula column to a summary table")

    transform = col_id is not None and col_id.startswith('gristHelper_Transform')

    if transform:
      # Delete any currently existing transform columns with the same id
      if self._engine.tables[table_id].has_column(col_id):
        self.RemoveColumn(table_id, col_id)

    ret = self.doAddColumn(table_id, col_id, col_info)

    if not transform:
      # Add a field for this column to the "raw_data" view(s) for this table.
      for section in table_rec.viewSections:
        if section.parentKey == 'record':
          # TODO: the position of the inserted field or of the inserted column will often be
          # bogus, since fields and columns are not the same. This requires better coordination
          # with the client-side.
          self._docmodel.insert(section.fields, col_info.get('_position'), colRef=ret['colRef'])

    return ret

  @useraction
  def AddHiddenColumn(self, table_id, col_id, col_info):
    return self.doAddColumn(table_id, col_id, col_info)

  @classmethod
  def _pick_col_name(cls, table_rec, col_id, old_col_id=None, avoid_extra=None):
    avoid_set = set(c.colId for c in table_rec.columns)
    avoid_set.add('id')     # 'id' is already taken although not included among column objects.
    for t in table_rec.summaryTables:
      avoid_set.update(c.colId for c in t.columns)

    if avoid_extra:
      avoid_set.update(avoid_extra)

    # For renaming, don't avoid the old id, e.g. renaming "a_b" to "a*b" should still give "a_b".
    if old_col_id:
      avoid_set.discard(old_col_id)

    return identifiers.pick_col_ident(col_id, avoid=avoid_set)

  def doAddColumn(self, table_id, col_id, col_info):
    table_rec = self._docmodel.get_table_rec(table_id)
    col_id = self._pick_col_name(table_rec, col_id)
    clean_colinfo = _make_clean_col_info(col_info)
    self._do_doc_action(actions.AddColumn(table_id, col_id, clean_colinfo))

    # Update the meta tables.
    values = clean_colinfo.copy()
    values.update({
      'colId': col_id,
      'widgetOptions': col_info.get('widgetOptions', ''),
      'label': col_info.get('label', col_id),
    })
    if 'recalcWhen' in col_info:
      values['recalcWhen'] = col_info['recalcWhen']
    if 'recalcDeps' in col_info:
      values['recalcDeps'] = col_info['recalcDeps']
    visible_col = col_info.get('visibleCol', 0)
    if visible_col:
      values['visibleCol'] = visible_col
    position = col_info.get('_position', None)
    inserted = self._docmodel.insert(table_rec.columns, position, **values)

    return {
      'colRef': inserted[0].id,
      'colId':  col_id
    }


  @useraction
  def RemoveColumn(self, table_id, col_id):
    # We can remove a column via either a "RemoveColumn" useraction or by removing a column
    # metadata record. We implement the former interface by forwarding to the latter.
    col = self._docmodel.get_column_rec(table_id, col_id)
    self._docmodel.remove([col])


  @useraction
  def RenameColumn(self, table_id, old_col_id, new_col_id):
    # We can rename a column via either a "RenameColumn" useraction or by updating a column
    # metadata record. We implement the former interface by forwarding to the latter.
    col = self._docmodel.get_column_rec(table_id, old_col_id)
    self._docmodel.update([col], colId=new_col_id)
    return col.colId

  @useraction
  def SetDisplayFormula(self, table_id, field_ref, col_ref, formula):
    # Assert user is not setting both field and col formula, since it is likely unintentional.
    assert not field_ref or not col_ref, "Should set either field or column display formula"
    table_rec = self._docmodel.get_table_rec(table_id)

    if field_ref:
      field_rec = self._docmodel.view_fields.table.get_record(field_ref)
      old_display_col_rec = field_rec.displayCol
      display_col_ref = self._add_or_update_helper_col(table_rec, old_display_col_rec, formula)
      if display_col_ref is not None:
        # Update the field's displayCol ref
        self._docmodel.update([field_rec], displayCol=display_col_ref)

    if col_ref:
      col_rec = self._docmodel.columns.table.get_record(col_ref)
      old_display_col_rec = col_rec.displayCol
      display_col_ref = self._add_or_update_helper_col(table_rec, old_display_col_rec, formula)
      if display_col_ref is not None:
        # Update the col's displayCol ref
        self._docmodel.update([col_rec], displayCol=display_col_ref)

  # Helper function to get a helper column with the given formula, or to add one if none
  # currently exist.
  def _add_or_update_helper_col(self, table_rec, display_col_rec, formula):
    if formula:
      if display_col_rec.numDisplayColUsers == 1:
        # If this is the only user of the display column, use it as new display column
        self._docmodel.update([display_col_rec], formula=formula)
        return None
      else:
        formula_cols = self._docmodel.columns.lookupRecords(parentId=table_rec.id, formula=formula)
        # Get the first display column with the desired formula
        display_col_ref = next((c.id for c in formula_cols if
          c.colId.startswith('gristHelper_Display')), 0)
        # If no appropriate display column exists, add one
        if not display_col_ref:
          display_col_info = self.doAddColumn(table_rec.tableId, 'gristHelper_Display', {
            'type': 'Any',
            'formula': formula,
            'isFormula': True
          })
          display_col_ref = display_col_info['colRef']
        return display_col_ref
    else:
      return 0

  @useraction
  def ModifyColumn(self, table_id, col_id, col_info):
    # We can modify a column via either a "ModifyColumn" useraction or by updating a column
    # metadata record. We implement the former interface by forwarding to the latter.
    col = self._docmodel.get_column_rec(table_id, col_id)

    update_values = {k: v for k, v in six.iteritems(col_info) if k in _modifiable_col_fields}
    if '_position' in col_info:
      update_values['parentPos'] = col_info['_position']
    self._docmodel.update([col], **update_values)

  def doModifyColumn(self, table_id, col_id, col_info):
    """
    ModifyColumn involves a ModifyColumn docaction which changes the column's schema, and creates
    a new Column object, destroying the old one. Additionally, it may have an effect on the
    column's data:

    (1) It may change the column's type, which requires a conversion of the data. Note that the
    action to fill in converted data must come AFTER the ModifyColumn docaction (so that column
    is already of the right type), including in the "undo" direction.

    (2) It may switch a column between "formula" and "data". Since formula columns are computed
    on the fly and not stored in DB (at least not always), such a switch requires an action to
    fill in all values.
    """
    table = self._engine.tables[table_id]
    old_column = table.get_column(col_id)
    from_formula = old_column.is_formula()
    to_formula = bool(col_info.get('isFormula', from_formula))

    old_col_info = schema.col_to_dict(self._engine.schema[table_id].columns[col_id],
                                      include_id=False)

    col_info = {k: v for k, v in six.iteritems(col_info) if old_col_info.get(k, v) != v}
    if not col_info:
      log.info("useractions.ModifyColumn is a noop")
      return

    if from_formula and not to_formula:
      # Make sure the old column is up to date, in case anything was to be recomputed.
      self._engine.bring_col_up_to_date(old_column)

    # Get the values from the old column, which is about to be destroyed.
    all_rows = list(table.row_ids)
    all_old_values = {r: old_column.raw_get(r) for r in all_rows}

    # Do the actual schema change: this destroys the old column and creates a new one.
    self._do_doc_action(actions.ModifyColumn(table_id, col_id, col_info))

    old_column = None     # We should no longer refer to this.
    new_column = table.get_column(col_id)
    assert to_formula == new_column.is_formula(), "Wrongly interpreted isFormula conversion"

    # ModifyColumn has updated the column's values with converted values, but it's up to us to
    # generate the appropriate BulkUpdateRecord actions for the data changes.


    # Fill in the new column by converting the values from the old column. If the type hasn't
    # changed, or is compatible, the conversion should return the value unchanged.
    changes = []
    for row_id in all_rows:
      orig_value = all_old_values[row_id]
      new_value = new_column.convert(orig_value)
      if not strict_equal(orig_value, new_value):
        new_column.set(row_id, new_value)
        changes.append((row_id, orig_value, new_column.raw_get(row_id)))

    # Prepare the changes as if for a formula column; they'd get merged at this point with any
    # previous calc_changes for this column.
    if changes:
      self._engine.out_actions.summary.add_changes(table_id, col_id, changes)

    if not to_formula:
      # If converting to non-formula, any previously prepared calc actions should be removed from
      # calc summary and actualized now (so that they don't override subsequent changes).

      # The UNDO action needs to be inserted before the one created by ModifyColumn, so that on
      # undo, we apply ModifyColumn first (getting the correct type), then set the values of
      # that type. We do it by moving the last (ModifyColumn) action to the end.
      assert isinstance(self._engine.out_actions.undo[-1], actions.ModifyColumn), \
          "ModifyColumn not where expected in undo list"
      mod_action = self._engine.out_actions.undo.pop()
      try:
        self._engine.out_actions.flush_calc_changes_for_column(table_id, col_id)
      finally:
        self._engine.out_actions.undo.append(mod_action)


  @useraction
  def CopyFromColumn(self, table_id, src_col_id, dst_col_id, widgetOptions):
    """
    CopyFromColumn involves a ModifyColumn docaction which changes the destination column's schema,
    and a BulkUpdateRecord docaction which replaces the destination col's data with the source data.
    If not None, widgetOptions may contain a JSON-string of widgetOptions to use instead of the
    source column's.
    """
    table = self._engine.tables[table_id]
    src_col = self._docmodel.get_column_rec(table_id, src_col_id)
    dst_col = self._docmodel.get_column_rec(table_id, dst_col_id)
    src_column = table.get_column(src_col_id)

    # Make sure the src column is up to date, in case anything was to be recomputed.
    # If not, bring it up to date now before transferring values.
    if src_column.is_formula():
      self._engine.bring_col_up_to_date(src_column)

    # Update the destination column to match the source's type and options. Also unset displayCol,
    # except if src_col has a displayCol, then keep it unchanged until SetDisplayFormula below.
    if widgetOptions is None:
      widgetOptions = src_col.widgetOptions
    self._docmodel.update([dst_col], type=src_col.type, widgetOptions=[widgetOptions],
                          visibleCol=[src_col.visibleCol if src_col.visibleCol else 0],
                          displayCol=[dst_col.displayCol if src_col.displayCol else 0])

    # Copy over display column as well, if the source column has one.
    self.maybe_copy_display_formula(src_col, dst_col)

    # Get the values from the columns and check which have changed.
    all_row_ids = list(table.row_ids)
    all_src_values = [src_column.raw_get(r) for r in all_row_ids]

    dst_column = table.get_column(dst_col_id)
    changed_rows, changed_values = [], []
    for row_id, src_value in zip(all_row_ids, all_src_values):
      if src_value != dst_column.raw_get(row_id):
        changed_rows.append(row_id)
        changed_values.append(src_value)

    # Produce the BulkUpdateRecord update.
    self._do_doc_action(actions.BulkUpdateRecord(table_id, changed_rows,
                                                 {dst_col_id: changed_values}))


  def maybe_copy_display_formula(self, src_col, dst_col):
    """
    If src_col has a displayCol set, create an equivalent one for dst_col.
    """
    # TODO: Should use the same formula renaming logic that is used when renaming columns.
    if src_col.displayCol:
      self.SetDisplayFormula(dst_col.parentId.tableId, None, dst_col.id,
        re.sub((r'\$%s\b' % src_col.colId), '$' + dst_col.colId, src_col.displayCol.formula))

  @useraction
  def RenameChoices(self, table_id, col_id, renames):
    """
    Updates the data in a Choice/ChoiceList column to reflect the new choice names.
    `renames` should be a dict of {old_choice_name: new_choice_name}.
    This doesn't touch the choices configuration in widgetOptions, that must be done separately.
    """

    table = self._engine.tables[table_id]
    col = table.get_column(col_id)

    if col.is_formula():
      # We don't set the values of formula columns, they should just recalculate themselves
      return None

    row_ids, values = col.rename_choices(renames)
    values = [encode_object(v) for v in values]
    return self.BulkUpdateRecord(table_id, row_ids, {col_id: values})

  #----------------------------------------
  # User actions on tables.
  #----------------------------------------

  @useraction
  def AddEmptyTable(self):
    """
    Adds an empty table. Currently it makes up the next available table name, and adds three
    default columns, also picking default names for them (presumably, A, B, and C).
    """
    return self.AddTable(None, [{'id': None, 'isFormula': True} for x in xrange(3)])

  @useraction
  def AddTable(self, table_id, columns):
    # For any columns missing 'isFormula' field, default to False when formula is empty. We will
    # normally default new columns to "empty" (isFormula=True), and AddEmptyTable creates empty
    # columns, but an AddTable action created e.g. by an import will default to data columns.
    for c in columns:
      c.setdefault("isFormula", bool(c.get('formula')))

    # Add a manualSort column.
    columns.insert(0, column.MANUAL_SORT_COL_INFO.copy())
    # First the tables is created without a primary view assigned as no view for it exists.
    result = self.doAddTable(table_id, columns)
    # Then its Primary View is created.
    primary_view = self.doAddView(result["table_id"], 'raw_data', result["table_id"])
    self.UpdateRecord('_grist_Tables', result["id"], {'primaryViewId': primary_view["id"]})
    result["views"] = [primary_view]
    return result

  def doAddTable(self, table_id, columns, summarySourceTableRef=0):
    """
    Add the given table with columns without creating views.
    """
    # If needed, transform table_id into a valid identifier, and add a suffix to make it unique.
    table_id = identifiers.pick_table_ident(table_id, avoid=six.viewkeys(self._engine.tables))

    # Sanitize and de-duplicate column identifiers.
    col_ids = [c['id'] for c in columns]
    col_ids = identifiers.pick_col_ident_list(col_ids, avoid={'id'})

    # Clean up col_info objects, including setting certain defaults for omitted fields.
    clean_colinfo = [_make_clean_col_info(ci, col_id) for (ci, col_id) in zip(columns, col_ids)]
    self._do_doc_action(actions.AddTable(table_id, clean_colinfo))

    # Update the meta tables.
    extra = {'summarySourceTable': summarySourceTableRef} if summarySourceTableRef else {}
    table_rec = self._docmodel.add(self._docmodel.tables, tableId=table_id, primaryViewId=0,
                                   **extra)[0]
    self._docmodel.insert(
      table_rec.columns, None,
      colId         = col_ids,
      type          = [c['type'] for c in clean_colinfo],
      isFormula     = [c['isFormula'] for c in clean_colinfo],
      formula       = [c['formula'] for c in clean_colinfo],
      label         = [c.get('label', col_id) for (c, col_id) in zip(columns, col_ids)],
      widgetOptions = [c.get('widgetOptions', '') for c in columns])

    return {
      "id": table_rec.id,
      "table_id": table_id,
      "columns": col_ids[1:],   # All the column ids, except the auto-added manualSort.
    }

  @useraction
  def RemoveTable(self, table_id):
    # We can remove a table via either a "RemoveTable" useraction or by removing a table
    # metadata record. We implement the former interface by forwarding to the latter.
    table_rec = self._docmodel.get_table_rec(table_id)
    self._docmodel.remove([table_rec])


  @useraction
  def RenameTable(self, old_table_id, new_table_id):
    # We can rename a table via either a "RenameTable" useraction or by updating a table
    # metadata record. We implement the former interface by forwarding to the latter.
    table_rec = self._docmodel.get_table_rec(old_table_id)
    self._docmodel.update([table_rec], tableId=new_table_id)
    return table_rec.tableId


  def _fetch_table_col_recs(self, table_ref, col_refs):
    """Helper that converts col_refs from table table_ref into column Records."""
    try:
      cols = [self._docmodel.columns.table.get_record(c) for c in col_refs]
    except KeyError:
      raise ValueError("Invalid column requested")
    if not all(c.parentId.id == table_ref for c in cols):
      raise ValueError("Invalid column requested (wrong table)")
    return cols

  @useraction
  def CreateViewSection(self, table_ref, view_ref, section_type, groupby_colrefs):
    """
    Create a new view section. If table_ref is 0, also creates a new empty table. If view_ref is
    0, also creates a new view that will contain the new section. If groupby_colrefs is None,
    creates a plain section; else creates a summary section grouped by those columns.
    """
    # If we have groupby_colrefs, ensure they belong to the right table.
    if groupby_colrefs is not None:
      groupby_cols = self._fetch_table_col_recs(table_ref, groupby_colrefs)

    if not table_ref:
      table_ref = self.AddEmptyTable()['id']
    table = self._docmodel.tables.table.get_record(table_ref)

    if not view_ref:
      view_ref = self.AddView(table.tableId, 'empty', 'New page')['id']
    view = self._docmodel.views.table.get_record(view_ref)

    if groupby_colrefs is not None:
      section = self._summary.create_new_summary_section(table, groupby_cols, view, section_type)
    else:
      section = self._docmodel.add(view.viewSections, tableRef=table.id, parentKey=section_type,
                                   borderWidth=1, defaultWidth=100)[0]
      # TODO: We should address the automatic selection of fields for charts in a better way.
      self._RebuildViewFields(table.tableId, section.id,
                              limit=(2 if section_type == 'chart' else None))
    return {
      'tableRef': table_ref,
      'viewRef': view_ref,
      'sectionRef': section.id
    }

  @useraction
  def UpdateSummaryViewSection(self, section_ref, groupby_colrefs):
    """
    Update a summary section to be grouped by a different set of columns. This will update fields
    of the view section, setting their colRefs to similar columns in a different summary table.
    """
    section = self._docmodel.view_sections.table.get_record(section_ref)
    source_table = section.tableRef.summarySourceTable
    groupby_cols = self._fetch_table_col_recs(source_table.id, groupby_colrefs)
    self._summary.update_summary_section(section, source_table, groupby_cols)

  @useraction
  def DetachSummaryViewSection(self, section_ref):
    """
    Create a real table equivalent to the given summary section, and update the section to show
    the new table instead of the summary.
    """
    section = self._docmodel.view_sections.table.get_record(section_ref)
    if not section.tableRef.summarySourceTable:
      raise ValueError("Can't detach a non-summary section")
    self._summary.detach_summary_section(section)


  #----------------------------------------
  # User actions on views.
  #----------------------------------------

  @useraction
  def AddView(self, table_id, view_type, name):
    """
    Creates records for a View
    """
    result = self.doAddView(table_id, view_type, name)
    table_row_id = self._engine.tables['_grist_Tables'].get(tableId=table_id)
    self.AddRecord('_grist_TableViews', None, {
      'tableRef': table_row_id,
      'viewRef': result["id"]
    })
    return result

  def doAddView(self, table_id, view_type, name):

    # Create the raw view for the new table, with a field for each column.
    view_row_id = self.AddRecord('_grist_Views', None, {
      'name': name,
      'type': view_type,
    })

    # Include the new view in the tab bar by default if table isn't hidden
    if not is_hidden_table(table_id):
      tab_positions = [r.tabPos for r in self._engine.tables['_grist_TabBar'].filter_records()]
      max_pos = max(tab_positions) + 1 if tab_positions else 0
      self.AddRecord('_grist_TabBar', None, {
        'viewRef': view_row_id,
        'tabPos': max_pos
      })

    # Include the new view in the pages tree view
    self.AddRecord('_grist_Pages', None, {
      'viewRef': view_row_id,
      'indentation': 0,
      'pagePos': None # insert at the end
    })

    view_sections = []
    # View type may be 'raw_data' or 'empty'
    if view_type == 'raw_data':
      record_section = self.AddViewSection('', 'record', view_row_id, table_id)
      view_sections.append(record_section['id'])

    return {
      "id": view_row_id,
      "sections": view_sections
    }

  # TODO: Deprecated; should just use RemoveRecord('_grist_Views', view_id)
  @useraction
  def RemoveView(self, view_id):
    """
    Removes records for view at view_id
    """
    view_rec = self._docmodel.views.table.get_record(view_id)
    self._docmodel.remove([view_rec])

  #----------------------------------------
  # User actions on viewSections.
  #----------------------------------------

  # TODO: Deprecated; This should no longer be an exposed action; it is superceded by
  # CreateViewSection.
  @useraction
  def AddViewSection(self, title, view_section_type, view_row_id, table_id):
    """
    Creates records for a viewsection
    """
    table_rec = self._docmodel.get_table_rec(table_id)
    view = self._docmodel.views.table.get_record(view_row_id)
    section = self._docmodel.add(view.viewSections, tableRef=table_rec.id,
                                 parentKey=view_section_type, title=title,
                                 borderWidth=1, defaultWidth=100,
                                 sortColRefs='[]')[0]
    self._RebuildViewFields(table_id, section.id,
                            limit=(2 if view_section_type == 'chart' else None))
    return {"id": section.id}

  # TODO: Deprecated; should just use RemoveRecord('_grist_Views_section', view_id)
  @useraction
  def RemoveViewSection(self, view_section_id):
    """
    Removes records for viewsection at viewsection_id
    """
    section = self._docmodel.view_sections.table.get_record(view_section_id)
    self._docmodel.remove([section])

  #--------------------------------------------------------------------------------
  # Methods for creating and maintaining default views. This is a work-in-progress.
  #--------------------------------------------------------------------------------

  def _UpdateViews(self, table_id):
    """
    Updates records for default Views to include those fields that they should include by default
    (such as all fields for the Raw View, and first 4 fields for 'list' section of List View).
    """
    table_row_id = self._engine.tables['_grist_Tables'].get(tableId=table_id)
    meta_view_sections = self._engine.tables['_grist_Views_section']
    for view_section_row_id in meta_view_sections.filter(tableRef=table_row_id):
      parent_key = meta_view_sections.all_columns['parentKey'].raw_get(view_section_row_id)
      limit = 4 if parent_key == 'list' else None
      self._RebuildViewFields(table_id, view_section_row_id, limit=limit)

  def _RebuildViewFields(self, table_id, section_row_id, limit=None):
    """
    Does the actual work of rebuilding ViewFields to correspond to the table's columns.
    """
    section_rec = self._docmodel.view_sections.table.get_record(section_row_id)
    table_rec = self._docmodel.tables.lookupOne(tableId=table_id)

    # Maybe first remove all view fields
    if section_rec.fields:
      self._docmodel.remove(section_rec.fields)

    # Include all table columns that are intended to be visible to the user.
    cols = [c for c in table_rec.columns if column.is_visible_column(c.colId)
            # TODO: hack to avoid auto-adding the 'group' column when detaching summary tables.
            and c.colId != 'group']
    cols.sort(key=lambda c: c.parentPos)
    if limit is not None:
      cols = cols[:limit]
    self._docmodel.add(section_rec.fields, colRef=[c.id for c in cols])


  #----------------------------------------------------------------------
  # UserActions used for imports    (passthrough to import_actions.py)
  #----------------------------------------------------------------------

  @useraction
  def GenImporterView(self, source_table_id, dest_table_id, transform_rule = None):
    return self._import_actions.DoGenImporterView(source_table_id, dest_table_id, transform_rule)

  @useraction
  def MakeImportTransformColumns(self, source_table_id, transform_rule, gen_all):
    return self._import_actions.MakeImportTransformColumns(source_table_id, transform_rule, gen_all)

  @useraction
  def FillTransformRuleColIds(self, transform_rule):
    return self._import_actions.FillTransformRuleColIds(transform_rule)
