import collections
import types

import six
from six.moves import xrange

import column
import depend
import docmodel
import lookup
import records
import relation as relation_module    # "relation" is used too much as a variable name below.
import usertypes

import logger
log = logger.Logger(__name__, logger.INFO)


def _make_sample_record(table_id, col_objs):
  """
  Helper to create a sample record for a table, used for auto-completions.
  """
  # This type gets created with a property for each column. We use property-methods rather than
  # plain properties because this sample record is created before all tables have initialized, so
  # reference values (using .sample_record for other tables) are not yet available.
  RecType = type(table_id, (), {
    # Note col=col to bind col at lambda-creation time; see
    # https://stackoverflow.com/questions/10452770/python-lambdas-binding-to-local-values
    col.col_id: property(lambda self, col=col: col.sample_value())
    for col in col_objs
    if column.is_user_column(col.col_id) or col.col_id == 'id'
  })
  return RecType()

def get_default_func_name(col_id):
  return "_default_" + col_id

def get_validation_func_name(index):
  return "validation___%d" % index

class UserTable(object):
  """
  Each data table in the document is represented in the code by an instance of `UserTable` class.
  These names are always capitalized. A UserTable provides access to all the records in the table,
  as well as methods to look up particular records.

  Every table in the document is available to all formulas.
  """
  # UserTables are only created in auto-generated code by using UserTable as decorator for a table
  # model class. I.e.
  #
  #   @grist.UserTable
  #   class Students:
  #     ...
  #
  # makes the "Students" identifier an actual UserTable instance, so that Students.lookupRecords
  # and so on can be used.

  def __init__(self, model_class):
    docmodel.enhance_model(model_class)
    self.Model = model_class
    column_ids = {col for col in model_class.__dict__ if not col.startswith("_")}
    column_ids.add('id')
    self.table = None

  def _set_table_impl(self, table_impl):
    self.table = table_impl

  @property
  def Record(self):
    return self.table.Record

  @property
  def RecordSet(self):
    return self.table.RecordSet

  # Note these methods are named camelCase since they are a public interface exposed to formulas,
  # and we decided camelCase was a more user-friendly choice for user-facing functions.
  def lookupRecords(self, **field_value_pairs):
    """
    Returns the Records from this table that match the given field=value arguments. If
    `sort_by=field` is given, sort the results by that field.

    For example:
    ```
    People.lookupRecords(Last_Name="Johnson", sort_by="First_Name")
    People.lookupRecords(First_Name="George", Last_Name="Washington")
    ```

    See [RecordSet](#recordset) for useful properties offered by the returned object.
    """
    return self.table.lookup_records(**field_value_pairs)

  def lookupOne(self, **field_value_pairs):
    """
    Returns a Record matching the given field=value arguments. If multiple records match, returns
    one of them. If none match, returns the special empty record.

    For example:
    ```
    People.lookupOne(First_Name="Lewis", Last_Name="Carroll")
    ```
    """
    return self.table.lookup_one_record(**field_value_pairs)

  def lookupOrAddDerived(self, **kwargs):
    return self.table.lookupOrAddDerived(**kwargs)

  def getSummarySourceGroup(self, rec):
    return self.table.getSummarySourceGroup(rec)

  @property
  def all(self):
    """
    Name: all
    Usage: UserTable.__all__

    The list of all the records in this table.

    For example, this evaluates to the number of records in the table `Students`.
    ```
    len(Students.all)
    ```

    This evaluates to the sum of the `Population` field for every record in the table `Countries`.
    ```
    sum(r.Population for r in Countries.all)
    ```
    """
    return self.lookupRecords()

  def __dir__(self):
    # Suppress member properties when listing dir(TableClass). This affects rlcompleter, with the
    # result that auto-complete will only return class properties, not member properties added in
    # the constructor.
    return []


class Table(object):
  """
  Table represents a table with all its columns and data.
  """

  class RowIDs(object):
    """
    Helper container that represents the set of valid row IDs in this table.
    """
    def __init__(self, id_column):
      self._id_column = id_column

    def __contains__(self, row_id):
      return row_id < self._id_column.size() and self._id_column.raw_get(row_id) > 0

    def __iter__(self):
      for row_id in xrange(self._id_column.size()):
        if self._id_column.raw_get(row_id) > 0:
          yield row_id

    def max(self):
      last = self._id_column.size() - 1
      while last > 0 and last not in self:
        last -= 1
      return last


  def __init__(self, table_id, engine):
    # The id of the table is the name of its class.
    self.table_id = table_id

    # Each table maintains a reference to the engine that owns it.
    self._engine = engine

    # The UserTable object for this table, set in _rebuild_model
    self.user_table = None

    # Store the identity Relation for this table.
    self._identity_relation = relation_module.IdentityRelation(table_id)

    # Set of ReferenceColumn objects that refer to this table
    self._back_references = set()

    # Store the constant Node for "new columns". Accessing invalid columns creates a dependency
    # on this node, and triggers recomputation when columns are added or renamed.
    self._new_columns_node = depend.Node(self.table_id, None)

    # Collection of special columns that this table maintains, which include LookupMapColumns
    # and formula columns for maintaining summary tables. These persist across table rebuilds, and
    # get cleaned up with delete_column().
    self._special_cols = {}

    # Maintain Column objects both as a mapping from col_id and as an ordered list.
    self.all_columns = collections.OrderedDict()

    # This column is always present.
    self._id_column = column.create_column(self, 'id', column.get_col_info(usertypes.Id()))

    # The `row_ids` member offers some useful interfaces:
    #     * if row_id in table.row_ids
    #     * for row_id in table.row_ids
    self.row_ids = self.RowIDs(self._id_column)

    # For a summary table, this is a reference to the Table object for the source table.
    self._summary_source_table = None

    # For a summary table, the name of the special helper column auto-added to the source table.
    self._summary_helper_col_id = None

    # Add Record and RecordSet subclasses which fill in this table as the first argument
    class Record(records.Record):
      def __init__(inner_self, *args, **kwargs):  # pylint: disable=no-self-argument
        super(Record, inner_self).__init__(self, *args, **kwargs)

    class RecordSet(records.RecordSet):
      def __init__(inner_self, *args, **kwargs):  # pylint: disable=no-self-argument
        super(RecordSet, inner_self).__init__(self, *args, **kwargs)

    self.Record = Record
    self.RecordSet = RecordSet

  def _rebuild_model(self, user_table):
    """
    Sets class-wide properties from a new Model class for the table (inner class within the table
    class), and rebuilds self.all_columns from the new Model, reusing columns with existing names.
    """
    self.user_table = user_table
    self.Model = user_table.Model

    new_cols = collections.OrderedDict()
    new_cols['id'] = self._id_column

    # List of Columns in the same order as they appear in the generated Model definition.
    col_items = [c for c in six.iteritems(self.Model.__dict__) if not c[0].startswith("_")]
    col_items.sort(key=lambda c: self._get_sort_order(c[1]))

    for col_id, col_model in col_items:
      default_func = self.Model.__dict__.get(get_default_func_name(col_id))
      new_cols[col_id] = self._create_or_update_col(col_id, col_model, default_func)

    # Used for auto-completion as a record with correct properties of correct types.
    self.sample_record = _make_sample_record(self.table_id, six.itervalues(new_cols))

    # Note that we reuse previous special columns like lookup maps, since those not affected by
    # column changes should stay the same. These get removed when unneeded using other means.
    new_cols.update(sorted(six.iteritems(self._special_cols)))

    # Set the new columns.
    self.all_columns = new_cols

    # Make sure any new columns get resized to the full table size.
    self.grow_to_max()

    # If this is a summary table, auto-create a necessary helper formula in the source table.
    summary_src = getattr(self.Model, '_summarySourceTable', None)
    if summary_src not in self._engine.tables:
      self._summary_source_table = None
      self._summary_helper_col_id = None
    else:
      self._summary_source_table = self._engine.tables[summary_src]
      self._summary_helper_col_id = "#summary#%s" % self.table_id
      # Figure out the group-by columns: these are all the non-formula columns.
      groupby_cols = tuple(sorted(col_id for (col_id, col_model) in col_items
                                  if not isinstance(col_model, types.FunctionType)))
      # Add the special helper column to the source table.
      self._summary_source_table._add_update_summary_col(self, groupby_cols)

  def _add_update_summary_col(self, summary_table, groupby_cols):
    # TODO: things need to be removed also from summary_cols when a summary table is deleted.
    @usertypes.formulaType(usertypes.Reference(summary_table.table_id))
    def _updateSummary(rec, table):   # pylint: disable=unused-argument
      return summary_table.lookupOrAddDerived(**{c: getattr(rec, c) for c in groupby_cols})
    _updateSummary.is_private = True
    col_id = summary_table._summary_helper_col_id
    col_obj = self._create_or_update_col(col_id, _updateSummary)
    self._special_cols[col_id] = col_obj
    self.all_columns[col_id] = col_obj

  def get_helper_columns(self):
    """
    Returns a list of columns from other tables that are only needed for the sake of this table.
    """
    if self._summary_source_table and self._summary_helper_col_id:
      helper_col = self._summary_source_table.get_column(self._summary_helper_col_id)
      return [helper_col]
    return []

  def _create_or_update_col(self, col_id, col_model, default_func=None):
    """
    Helper to update an existing column with a new model, or create a new column object.
    """
    col_info = column.get_col_info(col_model, default_func)
    col_obj = self.all_columns.get(col_id)
    if col_obj:
      # This is important for when a column has NOT changed, since although the formula method is
      # unchanged, it's important to use the new instance of it from the newly built module.
      col_obj.update_method(col_info.method)
    else:
      col_obj = column.create_column(self, col_id, col_info)
      self._engine.invalidate_column(col_obj)
    return col_obj

  @staticmethod
  def _get_sort_order(col_model):
    """
    We sort columns according to the order in which they appear in the model definition. To
    detect this order, we sort data columns by _creation_order, and formula columns by the
    function's source-code line number.
    """
    return ((0, col_model._creation_order)
            if not isinstance(col_model, types.FunctionType) else
            (1, col_model.__code__.co_firstlineno))

  def next_row_id(self):
    """
    Returns the ID of the next row that can be added to this table.
    """
    return self.row_ids.max() + 1

  def grow_to_max(self):
    """
    Resizes all columns as needed so that all valid row_ids are valid indices into all columns.
    """
    size = self.row_ids.max() + 1
    for col_obj in six.itervalues(self.all_columns):
      col_obj.growto(size)

  def get_column(self, col_id):
    """
    Returns the column with the given column ID.
    """
    return self.all_columns[col_id]

  def has_column(self, col_id):
    """
    Returns whether col_id represents a valid column in the table.
    """
    return col_id in self.all_columns

  def lookup_records(self, **kwargs):
    """
    Returns a Record matching the given column=value arguments. It creates the necessary
    dependencies, so that the formula will get re-evaluated if needed. It also creates and starts
    maintaining a lookup index to make such lookups fast.
    """
    # The tuple of keys used determines the LookupMap we need.
    sort_by = kwargs.pop('sort_by', None)
    col_ids = tuple(sorted(kwargs))
    key = tuple(kwargs[c] for c in col_ids)

    lookup_map = self._get_lookup_map(col_ids)
    row_id_set, rel = lookup_map.do_lookup(key)
    if sort_by:
      row_ids = sorted(row_id_set, key=lambda r: self._get_col_value(sort_by, r, rel))
    else:
      row_ids = sorted(row_id_set)
    return self.RecordSet(row_ids, rel, group_by=kwargs, sort_by=sort_by)

  def lookup_one_record(self, **kwargs):
    return self.lookup_records(**kwargs).get_one()

  def _get_lookup_map(self, col_ids_tuple):
    """
    Helper which returns the LookupMapColumn for the given combination of lookup columns. A
    LookupMap behaves a bit like a formula column in that it depends on the passed-in columns and
    gets updated whenever any of them change.
    """
    # LookupMapColumn is a Node, so identified by (table_id, col_id) pair, so we make up a col_id
    # to identify this lookup object uniquely in this Table.
    lookup_col_id = "#lookup#" + ":".join(col_ids_tuple)
    lmap = self._special_cols.get(lookup_col_id)
    if not lmap:
      # Check that the table actually has all the columns we looking up.
      for c in col_ids_tuple:
        if not self.has_column(c):
          raise KeyError("Table %s has no column %s" % (self.table_id, c))
      lmap = lookup.LookupMapColumn(self, lookup_col_id, col_ids_tuple)
      self._special_cols[lookup_col_id] = lmap
      self.all_columns[lookup_col_id] = lmap
    return lmap

  def delete_column(self, col_obj):
    assert col_obj.table_id == self.table_id
    self._special_cols.pop(col_obj.col_id, None)
    self.all_columns.pop(col_obj.col_id, None)

  def lookupOrAddDerived(self, **kwargs):
    record = self.lookup_one_record(**kwargs)
    if not record._row_id and not self._engine.is_triggered_by_table_action(self.table_id):
      record._row_id = self._engine.user_actions.AddRecord(self.table_id, None, kwargs)
    return record

  def getSummarySourceGroup(self, rec):
    return (self._summary_source_table.lookup_records(**{self._summary_helper_col_id: int(rec)})
            if self._summary_source_table else None)

  def get(self, **kwargs):
    """
    Returns the first row_id matching the given column=value arguments. This is intended for grist
    internal code rather than for user formulas, because it doesn't create the necessary
    dependencies.
    """
    # TODO: It should use indices, to avoid linear searching
    # TODO: It should create dependencies as needed when used from formulas.
    # TODO: It should return Record instead, for convenience of user formulas
    col_values = [(self.all_columns[col_id], value) for (col_id, value) in six.iteritems(kwargs)]
    for row_id in self.row_ids:
      if all(col.raw_get(row_id) == value for col, value in col_values):
        return row_id
    raise KeyError("'get' found no matching record")

  def filter(self, **kwargs):
    """
    Generates all row_ids matching the given column=value arguments. This is intended for grist
    internal code rather than for user formulas, because it doesn't create the necessary
    dependencies. Use filter_records() to generate Record objects instead.
    """
    # TODO: It should use indices, to avoid linear searching
    # TODO: It should create dependencies as needed when used from formulas.
    # TODO: It should return Record instead, for convenience of user formulas
    col_values = [(self.all_columns[col_id], value) for (col_id, value) in six.iteritems(kwargs)]
    for row_id in self.row_ids:
      if all(col.raw_get(row_id) == value for col, value in col_values):
        yield row_id

  def get_record(self, row_id):
    """
    Returns a Record object corresponding to the given row_id. This is intended for grist internal
    code rather than user formulas.
    """
    # We don't set up any dependencies, so it would be incorrect to use this from formulas.
    # We no longer assert, however, since such calls may still happen e.g. while applying
    # user-actions caused by formula side-effects (e.g. as trigged by lookupOrAddDerived())
    if row_id not in self.row_ids:
      raise KeyError("'get_record' found no matching record")
    return self.Record(row_id, None)

  def filter_records(self, **kwargs):
    """
    Generator for Record objects for all the rows matching the given column=value arguments.
    This is intended for grist internal code rather than user formula. You may call this with no
    arguments to generate all Records in the table.
    """
    # See note in get_record() about using this call from formulas.

    for row_id in self.filter(**kwargs):
      yield self.Record(row_id, None)


  # TODO: document everything here.

  def _use_column(self, col_id, relation, row_ids):
    """
    relation - Describes how the record was obtained, on which col_id is being accessed.
    """
    col = self.all_columns[col_id]
    # The _use_node call both creates a dependency and brings formula columns up-to-date.
    self._engine._use_node(col.node, relation, row_ids)
    return col

  # Called when record.foo is accessed
  def _get_col_value(self, col_id, row_id, relation):
    return records.adjust_record(relation,
                          self._use_column(col_id, relation, [row_id]).get_cell_value(row_id))

  def _attribute_error(self, col_id, relation):
    self._engine._use_node(self._new_columns_node, relation)
    raise AttributeError("Table '%s' has no column '%s'" % (self.table_id, col_id))

  # Called when record_set.foo is accessed. Should return something like a ColumnView.
  def _get_col_subset(self, col_id, row_ids, relation):
    # TODO: when column is a reference, we ought to return RecordSet. Otherwise ColumnView
    # looks like a RecordSet (returns Records), but doesn't support property access.
    return records.ColumnView(self._use_column(col_id, relation, row_ids), row_ids, relation)
