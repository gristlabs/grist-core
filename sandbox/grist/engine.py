# pylint:disable=too-many-lines
"""
The data engine ties the code generated from the schema with the document data, and with
dependency tracking.
"""
import itertools
import logging
import re
import rlcompleter
import sys
import time
import traceback
from collections import namedtuple, OrderedDict, defaultdict

import six
from six.moves import zip
from six.moves.collections_abc import Hashable  # pylint:disable=import-error,no-name-in-module
from sortedcontainers import SortedSet

import acl
import actions
import action_obj
from attribute_recorder import AttributeRecorder
from autocomplete_context import AutocompleteContext, lookup_autocomplete_options, eval_suggestion
from codebuilder import DOLLAR_REGEX
import depend
import docactions
import docmodel
from fake_std_streams import FakeStdStreams
import gencode
import match_counter
import objtypes
from objtypes import strict_equal
from relation import SingleRowsIdentityRelation
import sandbox
import schema
from schema import RecalcWhen
import table as table_module
from user import User # pylint:disable=wrong-import-order
import useractions
import column
import urllib_patch  # noqa imported for side effect # pylint:disable=unused-import

log = logging.getLogger(__name__)

if six.PY2:
  reload(sys)
  sys.setdefaultencoding('utf8')  # noqa # pylint:disable=no-member


class OrderError(Exception):
  """
  An exception thrown and handled internally, representing when
  evaluating a formula for a cell requires a value from another cell
  (or lookup) that has not yet itself been evaluated.  Formulas used
  to be evaluated recursively, on the program stack, but now ordering
  is organized explicitly by watching for this exception and adapting
  evaluation order appropriately.
  """
  def __init__(self, message, node, row_id):
    super(OrderError, self).__init__(message)
    self.node = node               # The column of the cell evaluated out of order.
    self.row_id = row_id           # The row_id of the cell evaluated out of order.
    self.requiring_node = None     # The column of the original cell being evaluated.
                                   # Added later since not known at point of exception.
    self.requiring_row_id = None   # the row_id of the original cell being evaluated

  def set_requirer(self, node, row_id):
    self.requiring_node = node
    self.requiring_row_id = row_id


class RequestingError(Exception):
  """
  An exception thrown and handled internally, a bit like OrderError.
  Indicates that the formula called the REQUEST function and needs to delegate an HTTP request
  to the NodeJS server.
  """
  pass


# An item of work to be done by Engine._update
WorkItem = namedtuple('WorkItem', ('node', 'row_ids', 'locks'))

# skip private members, and methods we don't want to expose to users.
skipped_completions = re.compile(r'\.(_|lookupOrAddDerived|getSummarySourceGroup)')

# The schema for the data is documented in gencode.py.

# There is a general process by which values get recomputed. There are two stages:
# (1) when raw data is loaded or changed by an action, it marks things as "dirty".
#     This is done using engine.recompute_map, which maps Nodes to sets of dirty rows.
# (2) when up-to-date data is needed, _recompute is called, and updates the dirty rows.
#     Up-to-date data is needed when it's required externally (e.g. to send to client), and
#     may be needed recursively when other data is being recomputed.

# In this implementation, rows are identified by a row_id, which functions like an index, so that
# data may be stored in lists and typed arrays. This is very memory-efficient when row_ids are
# dense, but bad when they get too sparse. TODO The proposed solution is to have a condense
# operation which renumbers row_ids when they get too sparse.

# TODO:
# We should support types SubRecord, SubRecordList, and SubRecordMap. Original thought was to
# represent them as derived tables with special names, such as "Foo.field". This breaks several
# assumptions about how to organize generated code. Instead, we can use derived tables with valid
# names (such as "Foo_field"), and add an actual column "field" with an appropriate type. This
# column may refer to derived tables or independent tables. Derived tables would have an extra
# property, marking them as derived, which would affect certain UI decisions.


class Engine(object):
  """
  The Engine is the core of the grist per-document logic. Some of its methods form the API exposed
  to the Node controller. These are:

    Initialization:

      load_empty()
        Initializes an empty document; useful for newly-created documents.

      load_meta_tables(meta_tables, meta_columns)
      load_table(table_data)
      load_done()
        These three must be called in-order to initialize a non-empty document.
        - First, load_meta_tables() must be called with data for the two special metadata tables
          containing the schema. It returns the list of other table names the data engine expects.
        - Then load_table() must be called once for each of the other tables (both special tables,
          and user tables), with that table's data (no need to call it for empty tables).
        - Finally, load_done() must be called once to finish initialization.
          NOTE: instead of load_done(), Grist now applies the no-op 'Calculate' user action.

    Other methods:

      fetch_table(table_id, formulas)
        Returns a TableData object containing the full data for the table. Formula columns
        are included only if formulas is True.

      apply_user_actions(user_actions, user)
        Applies a list of UserActions, which are tuples consisting of the name of the action
        method (as defind in useractions.py) and the arguments to it. Returns ActionGroup tuple,
        containing several categories of DocActions, including the results of computations.
  """

  def __init__(self):
    # The document data, including logic (formulas), and metadata (tables prefixed with "_grist_").
    self.tables = {}                # Maps table IDs (or names) to Table objects.

    # Schema contains information about tables and columns, needed in particular to generate the
    # code, from which in turn we create all the Table and Column objects. Schema is an
    # OrderedDict of tableIds to schema.SchemaTable objects. Each of those contains a .columns
    # OrderedDict of colId to schema.SchemaColumns objects. Order is used when generating code.
    self.schema = OrderedDict()

    # A more convenient interface to the document metadata.
    self.docmodel = docmodel.DocModel(self)

    # The module containing the compiled user code generated from the schema.
    self.gencode = gencode.GenCode()

    # Maintain the dependency graph of what Nodes (columns) depend on what other Nodes.
    self.dep_graph = depend.Graph()

    # Maps Nodes to sets of dirty rows (that need to be recomputed).
    self.recompute_map = {}

    # Maps Nodes to sets of done rows (to avoid recomputing in an infinite loop).
    self._recompute_done_map = {}

    # Contains Nodes once an exception value has been seen for them.
    self._is_node_exception_reported = set()

    # Contains Edges (node1, node2, relation) already seen during formula accesses.
    self._recompute_edge_set = set()

    # Sanity-check counter to check if we are making progress.
    self._recompute_done_counter = 0

    # Maps Nodes to a list of [rowId, value] pairs for cells that have been changed.
    # Ordered to preserve the order in which first change was made to a column.
    # This allows actions to be emitted in a legacy order that a lot of tests depend
    # on.  Not necessary to functioning, just a convenience.
    self._changes_map = OrderedDict()

    # This is set when we are running engine._update_loop, which has the ability to
    # evaluate dependencies.  We check this flag in engine._recompute_in_order, which will
    # start an update loop if called without one already in place.
    self._in_update_loop = False

    # A set of (node, row_id) cell references.  When evaluating a formula, a dependency
    # on any of these cells implies a circular dependency.
    self._locked_cells = set()

    # Set to True by the PEEK() function to temporarily disable dependency tracking
    self._peeking = False

    # The lists of actions of different kinds, built up while applying an action.
    self.out_actions = action_obj.ActionGroup()

    # What's currently being computed
    self._current_node = None
    self._current_row_id = None
    self._is_current_node_formula = False  # True for formula columns, False for trigger formulas

    # Certain recomputations are triggered by a particular doc action. This keep track of it.
    self._triggering_doc_action = None

    # The list of columns that got deleted while applying an action.
    self._gone_columns = []

    # The set of potentially unused LookupMapColumns.
    self._unused_lookups = set()

    # Create the formula tracer that can be overridden to trace formula evaluations. It is called
    # with the Column and Record object for the formula about to be evaluated. It's used in tests.
    self.formula_tracer = lambda col, record: None

    # Create the object that knows how to interpret UserActions.
    self.doc_actions = docactions.DocActions(self)

    # Create the object that knows how to interpret UserActions.
    self.user_actions = useractions.UserActions(self)

    # Map from node to set of row_ids, for cells that should not be recalculated because they are
    # data columns manually changed in this UserAction.
    self._prevent_recompute_map = {}

    # Whether any trigger columns may need to have their dependencies rebuilt.
    self._have_trigger_columns_changed = True

    # A flag for when a useraction causes a schema change, to verify consistency afterwards.
    self._schema_updated = False

    # Set to false temporarily to suppress rebuild_usercode for performance.
    # Used when importing which can add many columns which calls rebuild_usercode each time.
    self._should_rebuild_usercode = True

    # Stores an exception representing the first unevaluated cell met while recomputing the
    # current cell.
    self._cell_required_error = None

    # User that is currently applying user actions.
    self._user = None

    # In general you should access the property autocomplete_context instead,
    # which initialises this attribute lazily when it's needed by autocomplete.
    # When the schema changes and usercode is regenerated, this needs to be updated,
    # but creating a new AutocompleteContext is quite expensive, so we instead
    # clear this cached context on schema changes and let the property recreate it as needed.
    self._autocomplete_context = None

    self._table_stats = {"meta": [], "user": []}

    #### Attributes used by the REQUEST function:
    # True when the formula should synchronously call the exported JS method to make the request
    # immediately instead of reevaluating the formula later. Used when reevaluating a single
    # formula cell to get an error traceback.
    self._sync_request = False
    # dict of string keys to responses, set by the RespondToRequests user action to reevaluate
    # formulas based on a batch of completed requests.
    self._request_responses = {}
    # set of string keys identifying requests that are currently cached in files and can thus
    # be fetched synchronously via the exported JS method. This allows a single formula to
    # make multiple different requests without needing to keep all the responses in memory.
    self._cached_request_keys = set()

  @property
  def autocomplete_context(self):
    # See the comment on _autocomplete_context in __init__ above.
    if self._autocomplete_context is None:
      self._autocomplete_context = AutocompleteContext(self.gencode.usercode.__dict__)
    return self._autocomplete_context

  def record_table_stats(self, table_data, table_data_repr):
    table_id = table_data.table_id
    category = "meta" if table_id.startswith("_grist") else "user"
    result = dict(
      rows=len(table_data.row_ids),
      columns=len(table_data.columns),
      bytes=len(table_data_repr or ""),
      table_id=table_id,
    )
    result["cells"] = result["rows"] * result["columns"]
    self._table_stats[category].append(result)

  def get_table_stats(self):
    result = defaultdict(int, num_user_tables=len(self._table_stats["user"]))

    for table in self._table_stats["meta"]:
      for field in ["rows", "bytes"]:
        key = "%s_%s" % (table["table_id"], field)
        result[key] = table[field]

    for table in self._table_stats["user"]:
      for field in table:
        if field == "table_id":
          continue
        key = "user_%s" % field
        result[key] += table[field]

    return dict(result)

  def load_empty(self):
    """
    Initialize an empty document, e.g. a newly-created one.
    """
    self.load_meta_tables(actions.TableData('_grist_Tables', [], {}),
                          actions.TableData('_grist_Tables_column', [], {}))
    self.load_done()

  def load_meta_tables(self, meta_tables, meta_columns):
    """
    Must be the first method to call for this Engine. The arguments must contain the data for the
    _grist_Tables and _grist_Tables_column tables, in the form of actions.TableData.
    Returns the list of all the other table names that data engine expects to be loaded.
    """
    self.schema = schema.build_schema(meta_tables, meta_columns)

    # Compile the user-defined module code (containing all formulas in particular).
    self.rebuild_usercode()

    # Load the data into the now-existing metadata tables. This isn't used directly, it's just a
    # mirror of the schema for storage and for looking at.
    self.load_table(meta_tables)
    self.load_table(meta_columns)
    return sorted(table_id for table_id in self.tables
                  if table_id not in (meta_tables.table_id, meta_columns.table_id))

  def load_table(self, data):
    """
    Must be called for each of the metadata tables (except the ones given to load_meta), and for
    each user-defined table. The argument is an actions.TableData object.
    """
    table = self.tables[data.table_id]

    # Clear all columns, whether or not they are present in the data.
    for column in six.itervalues(table.all_columns):
      column.clear()

    # Only load columns that aren't stored.
    columns = {col_id: data for (col_id, data) in six.iteritems(data.columns)
               if table.has_column(col_id)}

    # Add the records.
    self.add_records(data.table_id, data.row_ids, columns)

  def load_done(self):
    """
    Finalizes the loading of data into this Engine.
    NOTE: instead of load_done(), Grist now applies the no-op 'Calculate' user action.
    """
    self._bring_all_up_to_date()

  def add_records(self, table_id, row_ids, column_values):
    """
    Helper to add records to the given table, with row_ids and column_values having the same
    interpretation as in TableData or BulkAddRecords. It's used both for the initial loading of
    data, and for BulkAddRecords itself.
    """
    table = self.tables[table_id]

    growto_size = (max(row_ids) + 1) if row_ids else 1

    # Create the new records.
    id_column = table.get_column('id')
    id_column.growto(growto_size)
    for row_id in row_ids:
      id_column.set(row_id, row_id)

    # Resize all columns to the full table size.
    table.grow_to_max()

    # Load the new values.
    for col_id, values in six.iteritems(column_values):
      column = table.get_column(col_id)
      column.growto(growto_size)
      for row_id, value in zip(row_ids, values):
        column.set(row_id, value)

    # Invalidate new records to cause the formula columns to get recomputed.
    self.invalidate_records(table_id, row_ids)

  def fetch_table(self, table_id, formulas=True, private=False, query=None):
    """
    Returns TableData object representing all data in this table.
    """
    table = self.tables[table_id]
    column_values = {}

    query_cols = []
    if query:
      for col_id, values in six.iteritems(query):
        col = table.get_column(col_id)
        try:
          # Try to use a set for speed.
          values = set(values)
        except TypeError:
          # Values contains an unhashable value, leave it as a list.
          pass
        query_cols.append((col, values))
    row_ids = []
    for r in table.row_ids:
      for (c, values) in query_cols:
        try:
          if c.raw_get(r) not in values:
            break
        except TypeError:
          # values is a set but c.raw_get(r) is unhashable, so it's definitely not in values
          break
      else:
        # No break, i.e. all columns matched
        row_ids.append(r)

    for c in six.itervalues(table.all_columns):
      # pylint: disable=too-many-boolean-expressions
      if ((formulas or not c.is_formula())
          and (private or not c.is_private())
          and c.col_id != "id" and not column.is_virtual_column(c.col_id)):
        column_values[c.col_id] = [c.raw_get(r) for r in row_ids]

    return actions.TableData(table_id, row_ids, column_values)

  def fetch_table_schema(self):
    return self.gencode.get_user_text()

  def fetch_meta_tables(self, formulas=True):
    """
    Returns {table_id: TableData} mapping for all metadata tables (those starting with '_grist_').

    Note the slight naming difference with load_meta_tables: that one expects just two
    extra-special tables, whereas fetch_meta_tables returns all special tables.
    """
    return {table_id: self.fetch_table(table_id, formulas=formulas)
            for table_id in self.tables if table_id.startswith('_grist_')}

  def find_col_from_values(self, values, n, opt_table_id=None):
    """
    Returns a list of colRefs for columns whose values match a given list. The results are ordered
    from best to worst according to the number of matches of distinct values.

    If n is non-zero, limits the results to that number. If opt_table_id is given, search only
    that table for matching columns.
    """
    start_time = time.time()
    # Exclude default values, since these will often result in matching new/incomplete columns.
    # If a value is unhashable, set() will fail, so we check for that.
    sample = set(v for v in values if isinstance(v, Hashable))
    matched_cols = []

    # If the column has no values, return
    if not sample:
      return []

    search_cols = (self.docmodel.get_table_rec(opt_table_id).columns
                   if opt_table_id in self.tables else self.docmodel.columns.all)

    m = match_counter.MatchCounter(sample)
    # Iterates through each valid column in the document, counting matches.
    for c in search_cols:
      if (not (gencode._is_special_table(c.tableId) or c.parentId.summarySourceTable) and
          column.is_visible_column(c.colId) and
          not c.type.startswith('Ref')):
        table = self.tables[c.tableId]
        col = table.get_column(c.colId)
        matches = m.count_unique(col.raw_get(r) for r in itertools.islice(table.row_ids, 1000))
        if matches > 0:
          matched_cols.append((matches, c.id))

    # Sorts the matched columns by the matches, then select the best-matching columns
    matched_cols.sort(reverse=True)
    if n:
      matched_cols = matched_cols[:n]

    log.info('Found column from values in %.3fs', time.time() - start_time)
    return [c[1] for c in matched_cols]

  def assert_schema_consistent(self):
    """
    Asserts that the internally-stored schema is equivalent to the schema as represented by the
    special tables of metadata.
    """
    meta_tables = self.fetch_table('_grist_Tables')
    meta_columns = self.fetch_table('_grist_Tables_column')
    gen_schema = schema.build_schema(meta_tables, meta_columns)
    gen_schema_dicts = {k: (t.tableId, dict(t.columns))
                        for k, t in six.iteritems(gen_schema)}
    cur_schema_dicts = {k: (t.tableId, dict(t.columns))
                        for k, t in six.iteritems(self.schema)}
    if cur_schema_dicts != gen_schema_dicts:
      import pprint
      import difflib
      a = (pprint.pformat(cur_schema_dicts) + "\n").splitlines(True)
      b = (pprint.pformat(gen_schema_dicts) + "\n").splitlines(True)
      raise AssertionError("Internal schema different from that in metadata:\n" +
          "".join(difflib.unified_diff(a, b, fromfile="internal", tofile="metadata")))

    # Check there are no stray column records (they aren't picked up by schema diffs, but will
    # cause inconsistencies with future tables).
    # TODO: This inconsistency can be triggered by undo of an AddTable action if the table
    # acquired more columns in subsequent actions. We may want to check for similar situations
    # with other metadata, e.g. ViewSection fields, where they'd cause different symptoms.
    # (Or better ensure consistency by design by applying undo correctly, probably via rebase).
    valid_table_refs = set(meta_tables.row_ids)
    col_parent_ids = set(meta_columns.columns['parentId'])
    if col_parent_ids > valid_table_refs:
      collist = sorted(actions.transpose_bulk_action(meta_columns),
                       key=lambda c: (c.parentId, c.parentPos))
      raise AssertionError("Internal schema inconsistent; extra columns in metadata:\n"
          + "\n".join('  #%s %s' %
                      (c.id, schema.SchemaColumn(c.colId, c.type, bool(c.isFormula), c.formula))
                      for c in collist if c.parentId not in valid_table_refs))

  def dump_state(self):
    self.dep_graph.dump_graph()
    self.dump_recompute_map()

  def dump_recompute_map(self):
    log.debug("Recompute map (%d nodes):", len(self.recompute_map))
    for node, dirty_rows in six.iteritems(self.recompute_map):
      log.debug("  Node %s: %s", node, dirty_rows)

  def _use_node(self, node, relation, row_ids=[]):
    # This is used whenever a formula accesses any part of any record. It's hot code, and
    # it's worth optimizing.

    if self._peeking:
      return

    if self._is_current_node_formula:
      # Add an edge to indicate that the node being computed depends on the node passed in.
      # Note that during evaluation, we only *add* dependencies. We *remove* them by clearing them
      # whenever ALL rows for a node are invalidated (on schema changes and reloads).
      edge = (self._current_node, node, relation)
      if edge not in self._recompute_edge_set:
        self.dep_graph.add_edge(*edge)
        self._recompute_edge_set.add(edge)

    # This check is not essential here, but is an optimization that saves cycles.
    if self.recompute_map.get(node) is None:
      return

    self._recompute(node, row_ids)

  def _pre_update(self):
    """
    Called at beginning of _bring_all_up_to_date or _bring_mlookups_up_to_date.
    Makes sure cell change accumulation is reset.
    """
    self._changes_map = OrderedDict()
    self._recompute_done_map = {}
    self._locked_cells = set()
    self._is_node_exception_reported = set()
    self._recompute_edge_set = set()
    self._cell_required_error = None

  def _post_update(self):
    """
    Called at end of _bring_all_up_to_date or _bring_mlookups_up_to_date.
    Issues actions for any accumulated cell changes.
    """
    for node, changes in six.iteritems(self._changes_map):
      table = self.tables[node.table_id]
      col = table.get_column(node.col_id)
      # If there are changes, save them in out_actions.
      if changes and not col.is_private():
        self.out_actions.summary.add_changes(node.table_id, node.col_id, changes)

    self._pre_update()  # empty lists/sets/maps

  def _update_loop(self, work_items, ignore_other_changes=False):
    """
    Called to compute the specified cells, including any nested dependencies.
    Consumes OrderError exceptions, and reacts to them with a strategy for
    reordering cell evaluation.  That strategy is currently simple:
      * Maintain a stack of work item triplets.  Each work item has:
         - A node (table/column pair).
         - A list of row_ids to compute (this can be None, meaning "all").
         - A list of row_ids to "unlock" once finished.
      * Until stack is empty, take a work item off the stack and attempt to
        _recompute the specified rows of the specified node.
         - If an OrderError is received, first check it is for a cell we
           requested (_recompute will opportunistically try to compute
           other cells we haven't asked for, and it is important for the
           purposes of cycle detection to discount that).
         - If so, "lock" that cell, push the current work item back on the
           stack (remembering which cell to unlock later), and add a new
           work item for the cell that threw the OrderError.
           + The "lock" serves only for cycle detection.
           + The order of stack placement means that the cell that threw
             the OrderError will now be evaluated before the cell that
             depends on it.
         - If not, ignore the OrderError.  If we actually need that cell,
           We'll get back to it later as we work up the work_items stack.
      * The _recompute method, as mentioned, will attempt to compute not
        just the requested rows of a particular column, but any other dirty
        cells in that column.  This is an important optimization for the
        common case of columns with non-self-referring dependencies.
    """
    self._in_update_loop = True
    while self.recompute_map:
      self._recompute_done_counter = 0
      self._expected_done_counter = 0
      while work_items:
        node, row_ids, locks = work_items.pop()
        try:
          self._recompute_step(node, require_rows=row_ids)
        except OrderError as e:
          # Need to schedule re-ordered evaluation
          assert node == e.requiring_node
          assert (not row_ids) or (e.requiring_row_id in row_ids)
          # Put current work item back on stack, and don't dispose its locks
          work_items.append(WorkItem(node, row_ids, locks))
          locks = []
          # Add a new work item for the cell we are following up, and lock
          # it to forbid circular dependencies
          lock = (node, e.requiring_row_id)
          work_items.append(WorkItem(e.node, [e.row_id], [lock]))
          self._locked_cells.add(lock)
        # Discard any locks once work item is complete
        for lock in locks:
          if lock not in self._locked_cells:
            # If cell is already unlocked, don't double-count it.
            continue
          self._locked_cells.discard(lock)
          # Sanity check: make sure we've computed at least one more cell
          self._expected_done_counter += 1
          if self._recompute_done_counter < self._expected_done_counter:
            raise Exception('data engine not making progress updating dependencies')
      if ignore_other_changes:
        # For _bring_mlookups_up_to_date, we should only wait for the work items
        # explicitly requested.
        break
      # Sanity check that we computed at least one cell.
      if self.recompute_map and self._recompute_done_counter == 0:
        raise Exception('data engine not making progress updating formulas')
      # Figure out remaining work to do, maintaining classic Grist ordering.
      work_items = self._make_sorted_work_items(self.recompute_map.keys())
    self._in_update_loop = False

  def _make_sorted_work_items(self, nodes):     # pylint:disable=no-self-use
    # Build WorkItems from a list of nodes, maintaining classic Grist ordering (in order by name).
    # WorkItems are processed from the end (hence reverse=True). Additionally, we sort all
    # #lookups to be processed first. See note in _bring_mlookups_up_to_date why this is important.
    nodes = sorted(nodes, reverse=True, key=lambda n: (not n.col_id.startswith('#lookup'), n))
    return [WorkItem(node, None, []) for node in nodes]

  def _bring_all_up_to_date(self):
    # Bring all nodes up to date. We iterate in sorted order of the keys so that the order is
    # deterministic (which is helpful for tests in particular).
    self._pre_update()
    try:
      # Figure out remaining work to do, maintaining classic Grist ordering.
      work_items = self._make_sorted_work_items(self.recompute_map.keys())
      self._update_loop(work_items)
      # Check if any potentially unused LookupMaps are still unused, and if so, delete them.
      for lookup_map in self._unused_lookups:
        if self.dep_graph.remove_node_if_unused(lookup_map.node):
          self.delete_column(lookup_map)
    finally:
      self._unused_lookups.clear()
      self._post_update()

  def _bring_mlookups_up_to_date(self, triggering_doc_action):
    # Just bring the *metadata* lookup nodes up to date.
    #
    # In general, lookup nodes don't know exactly what depends on them until they are
    # recomputed. So invalidating lookup nodes doesn't complete all invalidation; further
    # invalidations may be generated in the course of recomputing the lookup nodes.
    #
    # We use some private formulas on metadata tables internally (e.g. for a list columns of a
    # table). This method is part of a somewhat hacky solution in apply_doc_action: to force
    # recomputation of lookup nodes to ensure that we see up-to-date results between applying doc
    # actions.
    #
    # For regular data, correct values aren't needed until we recompute formulas. So we process
    # lookups before other formulas, but do not need to update lookups after each doc_action.
    #
    # In addition, we expose the triggering doc_action so that lookupOrAddDerived can avoid adding
    # a record to a derived table when the trigger itself is a change to the derived table. This
    # currently only happens on undo, and is admittedly an ugly workaround.
    self._pre_update()
    try:
      self._triggering_doc_action = triggering_doc_action
      nodes = [node for node in self.recompute_map
               if node.col_id.startswith('#lookup') and node.table_id.startswith('_grist_')]
      work_items = self._make_sorted_work_items(nodes)
      self._update_loop(work_items, ignore_other_changes=True)
    finally:
      self._triggering_doc_action = None
      self._post_update()

  def is_triggered_by_table_action(self, table_id):
    # Workaround for lookupOrAddDerived that prevents AddRecord from being created when the
    # trigger is itself an action for the same table. See comments for _bring_mlookups_up_to_date.
    a = self._triggering_doc_action
    return a and getattr(a, 'table_id', None) == table_id

  def bring_col_up_to_date(self, col_obj):
    """
    Public interface to recompute a column if it is dirty. It also generates a calc or stored
    action and adds it into self.out_actions object.
    """
    self._pre_update()
    try:
      self._recompute_done_map.pop(col_obj.node, None)
      self._recompute(col_obj.node)
    finally:
      self._post_update()

  def get_formula_error(self, table_id, col_id, row_id):
    """
    Returns an error message (traceback) for one concrete cell which user clicked.
    It is sufficient in case when we want to get traceback for only one formula cell with error,
    not recomputing the whole column and dependent columns as well. So it recomputes the formula
    for this cell and returns error message with details.
    """
    result = self.get_formula_value(table_id, col_id, row_id)
    table = self.tables[table_id]
    col = table.get_column(col_id)
    # If the error is gone for a trigger formula
    if col.has_formula() and not col.is_formula():
      if not isinstance(result, objtypes.RaisedException):
        # Get the error stored in the cell
        # and change it to show to the user that no traceback is available
        error_in_cell = objtypes.decode_object(col.raw_get(row_id))
        assert isinstance(error_in_cell, objtypes.RaisedException)
        return error_in_cell.no_traceback()
    return result

  def get_formula_value(self, table_id, col_id, row_id, record_attributes=None):
    table = self.tables[table_id]
    col = table.get_column(col_id)
    checkpoint = self._get_undo_checkpoint()
    # Makes calls to REQUEST synchronous, since raising a RequestingError can't work here.
    self._sync_request = True
    try:
      return self._recompute_one_cell(table, col, row_id, record_attributes=record_attributes)
    finally:
      # It is possible for formula evaluation to have side-effects that produce DocActions (e.g.
      # lookupOrAddDerived() creates those). In case of get_formula_error(), these aren't fully
      # processed (e.g. don't get applied to DocStorage), so it's important to reverse them.
      self._sync_request = False
      self._undo_to_checkpoint(checkpoint)

  def _recompute(self, node, row_ids=None):
    """
    Make sure cells of a node are up to date, recomputing as necessary.  Can optionally
    be limited to a list of rows that are of interest.
    """
    if self._in_update_loop:
      # This is a nested evaluation.  If there are in fact any cells to evaluate,
      # this must result in an OrderError.  We let engine._recompute_step
      # take care of figuring this out.
      self._recompute_step(node, allow_evaluation=False, require_rows=row_ids)
    else:
      # Sometimes _use_node is called from outside _update_loop.  In this case,
      # we start an _update_loop to compute whatever is required.  Otherwise
      # nested dependencies would not get computed.
      self._update_loop([WorkItem(node, row_ids, [])], ignore_other_changes=True)


  def _recompute_step(self, node, allow_evaluation=True, require_rows=None): # pylint: disable=too-many-statements
    """
    Recomputes a node (i.e. column), evaluating the appropriate formula for the given rows
    to get new values. Only columns whose .has_formula() is true should ever have invalidated rows
    in recompute_map (this includes data columns with a default formula, for newly-added records).

    If `allow_evaluation` is false, any time we would recompute a node, we instead throw
    an OrderError exception.  This is used to "flatten" computation - instead of evaluating
    nested dependencies on the program stack, an external loop will evaluate them in an
    unnested order.  Remember that formulas may access other columns, and column access calls
    engine._use_node, which calls _recompute to bring those nodes up to date.

    Recompute records changes in _changes_map, which is used later to generate appropriate
    BulkUpdateRecord actions, either calc (for formulas) or stored (for non-formula columns).
    """

    dirty_rows = self.recompute_map.get(node, None)
    if dirty_rows is None:
      return

    table = self.tables[node.table_id]
    col = table.get_column(node.col_id)
    assert col.has_formula(), "Engine._recompute: called on no-formula node %s" % (node,)

    # Get a sorted list of row IDs, excluding deleted rows (they will sometimes end up in
    # recompute_map) and rows already done (since _recompute_done_map got cleared).
    if node not in self._recompute_done_map:
      # Before starting to evaluate a formula, call reset_rows()
      # on all relations with nodes we depend on. E.g. this is
      # used for lookups, so that we can reset stored lookup
      # information for rows that are about to get reevaluated.
      self.dep_graph.reset_dependencies(node, dirty_rows)
      self._recompute_done_map[node] = set()

    exclude = self._recompute_done_map[node]
    if dirty_rows == depend.ALL_ROWS:
      dirty_rows = SortedSet(r for r in table.row_ids if r not in exclude)
      self.recompute_map[node] = dirty_rows

    exempt = self._prevent_recompute_map.get(node, None)
    if exempt:
      # If allow_evaluation=False we're not supposed to actually compute dirty_rows.
      # But we may need to compute them later,
      # so ensure self.recompute_map[node] isn't mutated by separating it from dirty_rows.
      # Therefore dirty_rows is assigned a new value. Note that -= would be a mutation.
      dirty_rows = dirty_rows - exempt
      if allow_evaluation:
        self.recompute_map[node] = dirty_rows

    require_rows = sorted(require_rows or [])

    previous_current_node = self._current_node
    previous_is_current_node_formula = self._is_current_node_formula
    self._current_node = node
    # Prevents dependency creation for non-formula nodes. A non-formula column may include a
    # formula to eval for a newly-added record. Those shouldn't create dependencies.
    self._is_current_node_formula = col.is_formula()

    changes = None
    cleaned = []    # this lists row_ids that can be removed from dirty_rows once we are no
                    # longer iterating on it.
    try:
      require_count = len(require_rows)
      for i, row_id in enumerate(itertools.chain(require_rows, dirty_rows)):
        required = i < require_count or require_count == 0
        if require_count and row_id not in dirty_rows:
          # Nothing need be done for required rows that are already up to date.
          continue
        if row_id not in table.row_ids or row_id in exclude:
          # We can declare victory for absent or excluded rows.
          cleaned.append(row_id)
          continue
        if not allow_evaluation:
          # We're not actually in a position to evaluate this cell, we need to just
          # report that we needed an _update_loop will arrange for us to be called
          # again in a better order.
          if required:
            msg = 'Cell value not available yet'
            err = OrderError(msg, node, row_id)
            if not self._cell_required_error:
              # Cache the exception in case user consumes it or modifies it in their formula.
              self._cell_required_error = OrderError(msg, node, row_id)
            raise err
          # For common-case formulas, all cells in a column are likely to fail in the same way,
          # so don't bother trying more from this column until we've reordered.
          return
        save_value = True
        value = None
        try:
          # We figure out if we've hit a cycle here.  If so, we just let _recompute_on_cell
          # know, so it can set the cell value appropriately and do some other bookkeeping.
          cycle = required and (node, row_id) in self._locked_cells
          value = self._recompute_one_cell(table, col, row_id, cycle=cycle, node=node)
        except RequestingError:
          # The formula will be evaluated again soon when we have a response.
          save_value = False
        except OrderError as e:
          if not required:
            # We're out of order, but for a cell we were evaluating opportunistically.
            # Don't throw an exception, since it could lead us off on a wild goose
            # chase - let _update_loop focus on one path at a time.
            return
          # Keep track of why this cell was needed.
          e.requiring_node = node
          e.requiring_row_id = row_id
          raise e

        # Successfully evaluated a cell!  Unlock it if it was locked, so other cells can
        # use it without triggering a cyclic dependency error.
        self._locked_cells.discard((node, row_id))

        if isinstance(value, objtypes.RaisedException):
          is_first = node not in self._is_node_exception_reported
          if is_first:
            self._is_node_exception_reported.add(node)
            log.info("Formula error in %s: %s", node, value.details)
            # strip out details after logging
            value = objtypes.RaisedException(value.error, user_input=value.user_input)

        # TODO: validation columns should be wrapped to always return True/False (catching
        # exceptions), so that we don't need special handling here.
        if column.is_validation_column_name(col.col_id):
          value = (value in (True, None))

        if save_value:
          # Convert the value, and if needed, set, and include into the returned action.
          value = col.convert(value)
          previous = col.raw_get(row_id)
          if not strict_equal(value, previous):
            if not changes:
              changes = self._changes_map.setdefault(node, [])
            changes.append((row_id, previous, value))
            col.set(row_id, value)

        exclude.add(row_id)
        cleaned.append(row_id)
        self._recompute_done_counter += 1
    finally:
      self._current_node = previous_current_node
      self._is_current_node_formula = previous_is_current_node_formula
      # Usually dirty_rows refers to self.recompute_map[node], so this modifies both
      dirty_rows -= cleaned

      # However it's possible for them to be different
      # (see above where `exempt` is nonempty and allow_evaluation=True)
      # so here we check self.recompute_map[node] directly
      if not self.recompute_map[node]:
        self.recompute_map.pop(node)

  def _requesting(self, key, args):
    """
    Called by the REQUEST function. If we don't have a response already and we can't
    synchronously get it from the JS side, then note the request to be made in JS asynchronously
    and raise RequestingError to indicate that the formula
    should be evaluated again later when we have a response.
    """
    # This will make the formula reevaluate periodically with the UpdateCurrentTime action.
    # This assumes that the response changes with time and having the latest data is ideal.
    # We will probably want to reconsider this to avoid making unwanted requests,
    # along with avoiding refreshing the request when the doc is loaded with the Calculate action.
    self.use_current_time()

    if key in self._request_responses:
      # This formula is being reevaluated in a RespondToRequests action, and the response is ready.
      return self._request_responses[key]
    elif self._sync_request or key in self._cached_request_keys:
      # Not always ideal, but in this case the best strategy is to make the request immediately
      # and block while waiting for a response.
      return sandbox.call_external("request", key, args)

    # We can't get a response to this request now. Note the request so it can be delegated.
    table_id, column_id = self._current_node
    (self.out_actions.requests  # `out_actions.requests` is returned by apply_user_actions
         # Here is where the request arguments are stored if they haven't been already
         .setdefault(key, args)
         # While all this stores the cell that made the request so that it can be invalidated later
         .setdefault("deps", {})
         .setdefault(table_id, {})
         .setdefault(column_id, [])
         .append(self._current_row_id))

    # As with OrderError, note the exception so it gets raised even if the formula catches it
    self._cell_required_error = RequestingError()

    raise RequestingError()

  def _recompute_one_cell(self, table, col, row_id, cycle=False, node=None, record_attributes=None):
    """
    Recomputes an one formula cell and returns a value.
    The value can be:
      - the recomputed value in case there are no errors
      - exception
      - exception with details if flag include_details is set
    """
    self._current_row_id = row_id

    # Baffling, but keeping a reference to current generated "usercode" module protects against a
    # seeming garbage-collection bug: if during formula evaluation the module gets regenerated
    # (e.g. a side-effect causes a formula column to change to non-formula), the stale-module
    # formula code that's still running will see None values in the usermodule's module-dictionary;
    # just keeping this extra reference allows stale formulas to see valid values.
    usercode_reference = self.gencode.usercode

    checkpoint = self._get_undo_checkpoint()
    record = table.Record(row_id, table._identity_relation)
    if record_attributes is not None:
      assert isinstance(record_attributes, dict)
      assert col.is_formula()
      assert not cycle
      record = AttributeRecorder(record, "rec", record_attributes)
    value = None
    try:
      if cycle:
        raise depend.CircularRefError("Circular Reference")
      if not col.is_formula():
        value = col.get_cell_value(int(record), restore=True)
        with FakeStdStreams():
          result = col.method(record, table.user_table, value, self._user)
      else:
        with FakeStdStreams():
          result = col.method(record, table.user_table)
      if self._cell_required_error:
        raise self._cell_required_error  # pylint: disable=raising-bad-type
      self.formula_tracer(col, record)
      return result
    except MemoryError:
      # Don't try to wrap memory errors.
      raise
    except:  # pylint: disable=bare-except
      # Since col.method runs untrusted user code, we use a bare except to catch all
      # exceptions (even those not derived from BaseException).

      # Before storing the exception value, make sure there isn't an OrderError pending.
      # If there is, we will raise it after undoing any side effects.
      order_error = self._cell_required_error

      # Otherwise, we use sys.exc_info to recover the raised exception object.
      regular_error = sys.exc_info()[1] if not order_error else None

      # It is possible for formula evaluation to have side-effects that produce DocActions (e.g.
      # lookupOrAddDerived() creates those). If there is an error, undo any such side-effects.
      self._undo_to_checkpoint(checkpoint)

      # Now we can raise the order error, if there was one.  Cell evaluation will be reordered
      # in response.
      if order_error:
        self._cell_required_error = None
        raise order_error  # pylint: disable=raising-bad-type

      self.formula_tracer(col, record)

      include_details = (node not in self._is_node_exception_reported) if node else True
      if not col.is_formula():
        return objtypes.RaisedException(regular_error, include_details, user_input=value)
      else:
        return objtypes.RaisedException(regular_error, include_details)

  def convert_action_values(self, action):
    """
    Given a BulkUpdateRecord or BulkAddRecord action, convert the values using the appropriate
    Column objects, replacing them with the right-type value, alttext, or error objects.
    """
    table_id, row_ids, column_values = action
    table = self.tables[action.table_id]
    new_values = {}
    extra_actions = []
    for col_id, values in six.iteritems(column_values):
      col_obj = table.get_column(col_id)
      values = [col_obj.convert(val) for val in values]

      # If there are values for any PositionNumber columns, ensure PositionNumbers are ordered as
      # intended but are all unique, which may require updating other positions.
      nvalues, adjustments = col_obj.prepare_new_values(values,
          action_summary=self.out_actions.summary)
      if adjustments:
        extra_actions.append(actions.BulkUpdateRecord(
          action.table_id, [r for r,v in adjustments], {col_id: [v for r,v in adjustments]}))

      new_values[col_id] = nvalues

    if isinstance(action, (actions.BulkAddRecord, actions.ReplaceTableData)):
      # Make sure we call prepare_new_values() for ALL columns when adding rows. The for-loop
      # above does it for columns explicitly mentioned; this section does it for the other
      # columns, using their default values as input to prepare_new_values().
      ignore_data = isinstance(action, actions.ReplaceTableData)
      for col_id, col_obj in six.iteritems(table.all_columns):
        if col_id in column_values or column.is_virtual_column(col_id) or col_obj.is_formula():
          continue
        defaults = [col_obj.getdefault() for r in row_ids]
        # We use defaults to get new values or adjustments. If we are replacing data, we'll make
        # the adjustments without regard to the existing data.
        nvalues, adjustments = col_obj.prepare_new_values(defaults, ignore_data=ignore_data,
            action_summary=self.out_actions.summary)
        if adjustments:
          extra_actions.append(actions.BulkUpdateRecord(
            action.table_id, [r for r,v in adjustments], {col_id: [v for r,v in adjustments]}))
        if nvalues != defaults:
          new_values[col_id] = nvalues

    # Return action of the same type (e.g. BulkUpdateAction, BulkAddAction), but with new values,
    # as well as any extra actions that were generated (as could happen for position adjustments).
    return (type(action)(table_id, row_ids, new_values), extra_actions)

  def trim_update_action(self, action):
    """
    Takes a BulkUpdateAction, and returns a new BulkUpdateAction with only those rows that
    actually cause any changes.
    """
    table_id, row_ids, column_values = action
    table = self.tables[action.table_id]

    # Collect for each column the Column object and a list of new values.
    cols = [(table.get_column(col_id), values) for (col_id, values) in six.iteritems(column_values)]

    # In comparisons below, we rely here on Python's "==" operator to check for equality. After a
    # type conversion, it may compare the new type to the old, e.g. 1 == 1.0 == True. It's
    # important that such equality is acceptable also to JS and to DocStorage. So far, it seems
    # just right.

    # Find columns for which any value actually changed.
    cols = [(col_obj, values) for (col_obj, values) in cols
            if any(values[i] != col_obj.raw_get(row_id) for (i, row_id) in enumerate(row_ids))]

    # Now find the indices of rows for which any value actually changed from what's in its Column.
    row_subset = [i for i, row_id in enumerate(row_ids)
                  if any(values[i] != col_obj.raw_get(row_id) for (col_obj, values) in cols)]

    # Create and return a new action with just the selected subset of rows.
    return actions.BulkUpdateRecord(
      action.table_id,
      [row_ids[i] for i in row_subset],
      {col_obj.col_id: [values[i] for i in row_subset]
       for (col_obj, values) in cols}
    )

  def invalidate_records(self, table_id, row_ids=depend.ALL_ROWS, col_ids=None,
                         data_cols_to_recompute=frozenset()):
    """
    Invalidate the records with the given row_ids. If col_ids is given, only those columns are
    invalidated (otherwise all columns). If data_cols_to_recompute is given, then non-formula
    col_ids that have an associated formula will get invalidated too, to cause recomputation.

    Note that it's not just about formula columns; pure data columns need to cause invalidation of
    formula columns that depend on them. Those data columns that have an associated formula may
    additionally (typically on AddRecord) be themselves invalidated, to cause recomputation.
    """
    table = self.tables[table_id]
    columns = (table.all_columns.values()
               if col_ids is None else [table.get_column(c) for c in col_ids])
    for column in columns:
      # If data_cols_to_recompute includes this column, compute its default formula. This
      # flag is set on AddRecord and BulkAddRecord, when a default formula needs to be computed.
      self.invalidate_column(column, row_ids, column.col_id in data_cols_to_recompute)

  def invalidate_column(self, col_obj, row_ids=depend.ALL_ROWS, recompute_data_col=False):
    # Normally, only formula columns use include_self (to recompute themselves). However, if
    # recompute_data_col is set, default formulas will also be computed.
    include_self = col_obj.is_formula() or (col_obj.has_formula() and recompute_data_col)
    self.dep_graph.invalidate_deps(col_obj.node, row_ids, self.recompute_map,
                                   include_self=include_self)

  def prevent_recalc(self, node, row_ids, should_prevent):
    prevented = self._prevent_recompute_map.setdefault(node, set())
    if should_prevent:
      prevented.update(row_ids)
    else:
      prevented.difference_update(row_ids)

  def rebuild_usercode(self):
    """
    Compiles the usercode from the schema, and updates all tables and columns to match.
    """
    if not self._should_rebuild_usercode:
      return

    self.gencode.make_module(self.schema)

    # Re-populate self.tables, reusing existing tables whenever possible.
    old_tables = self.tables

    self.tables = {}
    sorted_tables = []
    for table_id, user_table in six.iteritems(self.gencode.usercode.__dict__):
      if not  isinstance(user_table, table_module.UserTable):
        continue
      self.tables[table_id] = table = (
          old_tables.get(table_id) or table_module.Table(table_id, self)
      )

      # Process non-summary tables first so that summary tables
      # can read correct metadata about their source tables
      key = (hasattr(user_table.Model, '_summarySourceTable'), table_id)
      sorted_tables.append((key, table, user_table))
    sorted_tables.sort()

    # Now update the table model for each table, and tie it to its UserTable object.
    for _, table, user_table in sorted_tables:
      self._update_table_model(table, user_table)
      user_table._set_table_impl(table)

    # For any tables that are gone, use self._update_table_model to clean them up.
    for table_id, table in six.iteritems(old_tables):
      if table_id not in self.tables:
        self._update_table_model(table, None)

    # Update docmodel with references to the updated metadata tables.
    self.docmodel.update_tables()

    # Set flag to rebuild dependencies of trigger columns after any potential renames, etc.
    self.trigger_columns_changed()

    # Clear the cached context used for autocompletions.
    # See the comment on _autocomplete_context in __init__.
    self._autocomplete_context = None

  def trigger_columns_changed(self):
    self._have_trigger_columns_changed = True

  def _update_table_model(self, table, user_table):
    """
    Updates the given Table object to match the given user_table (from usercode module). This
    builds new columns as needed, and cleans up. To clean up state for a table getting removed,
    pass in user_table of None.
    """
    # Save the dict of columns before the update.
    old_columns = table.all_columns.copy()

    if user_table is None:
      new_columns = {}
    else:
      # Update the table's model. This also builds new columns if needed.
      table._rebuild_model(user_table)
      new_columns = table.all_columns

    added_col_ids = six.viewkeys(new_columns) - six.viewkeys(old_columns)
    deleted_col_ids = six.viewkeys(old_columns) - six.viewkeys(new_columns)

    # Invalidate the columns that got added and anything that depends on them.
    if added_col_ids:
      self.invalidate_records(table.table_id, col_ids=added_col_ids)

    for col_id in deleted_col_ids:
      self.invalidate_column(old_columns[col_id])

    # Schedule deleted columns for clean-up.
    for c in deleted_col_ids:
      self.delete_column(old_columns[c])

    if user_table is None:
      for c in table.get_helper_columns():
        self.delete_column(c)

  def _maybe_update_trigger_dependencies(self):
    if not self._have_trigger_columns_changed:
      return
    self._have_trigger_columns_changed = False

    # Without being very smart, if trigger-formula dependencies change for any columns, rebuild
    # them for all columns. Specifically, we will create nodes and edges in the dependency graph.
    for table_id, table in six.iteritems(self.tables):
      if table_id.startswith('_grist_'):
        # We can skip metadata tables, there are no trigger-formulas there.
        continue
      for col_id, col_obj in six.iteritems(table.all_columns):
        if col_obj.is_formula() or not col_obj.has_formula():
          continue
        col_rec = self.docmodel.columns.lookupOne(tableId=table_id, colId=col_id)

        out_node = depend.Node(table_id, col_id)
        rel = SingleRowsIdentityRelation(table_id)
        self.dep_graph.clear_dependencies(out_node)

        # When we have explicit dependencies, add them to dep_graph.
        if col_rec.recalcWhen == RecalcWhen.DEFAULT:
          for dc in col_rec.recalcDeps:
            in_node = depend.Node(table_id, dc.colId)
            edge = depend.Edge(out_node, in_node, rel)
            if edge not in self._recompute_edge_set:
              self._recompute_edge_set.add(edge)
              self.dep_graph.add_edge(*edge)


  def delete_column(self, col_obj):
    # Remove the column from its table.
    if col_obj.table_id in self.tables:
      self.tables[col_obj.table_id].delete_column(col_obj)

    # Invalidate anything that depends on the column being deleted. The column may be gone from
    # the table itself, so we use invalidate_column directly.
    self.invalidate_column(col_obj)
    # Remove reference to the column from the dependency graph and the recompute_map.
    self.dep_graph.clear_dependencies(col_obj.node)
    self.recompute_map.pop(col_obj.node, None)
    # Mark the column to be destroyed at the end of applying this docaction.
    self._gone_columns.append(col_obj)


  def new_column_name(self, table):
    """
    Invalidate anything that referenced unknown columns, in case the newly-added name fixes the
    broken reference.
    """
    self.dep_graph.invalidate_deps(table._new_columns_node, depend.ALL_ROWS, self.recompute_map,
                                   include_self=False)

  def update_current_time(self):
    self.dep_graph.invalidate_deps(self._current_time_node, depend.ALL_ROWS, self.recompute_map,
                                   include_self=False)

  def use_current_time(self):
    """
    Add a dependency on the current time to the current evaluating node,
    so that calling update_current_time() will invalidate the node and cause its reevaluation.
    """
    if not self._current_node:
      return
    table_id = self._current_node[0]
    table = self.tables[table_id]
    self._use_node(self._current_time_node, table._identity_relation)

  _current_time_node = ("#now", None)

  def mark_lookupmap_for_cleanup(self, lookup_map_column):
    """
    Once a LookupMapColumn seems no longer used, it's added here. We'll check after recomputing
    everything, and if still unused, will clean it up.
    """
    self._unused_lookups.add(lookup_map_column)

  def count_rows(self):
    result = {"total": 0}
    for table_rec in self.docmodel.tables.all:
      if useractions.is_user_table(table_rec.tableId):
        count = self.tables[table_rec.tableId]._num_rows()
        result[table_rec.id] = count
        result["total"] += count
    return result

  def apply_user_actions(self, user_actions, user=None):
    """
    Applies the list of user_actions. Returns an ActionGroup.
    """
    # We currently recompute everything and send all calc actions back on every change. If clients
    # only need a subset of data loaded, it would be better to filter calc actions, and
    # include only those the clients care about. For side-effects, we might want to recompute
    # everything, and only filter what we send.

    self.out_actions = action_obj.ActionGroup()
    self._user = User(user, self.tables) if user else None

    # These should usually be empty, but may be populated by the RespondToRequests action.
    self._request_responses = {}
    self._cached_request_keys = set()

    checkpoint = self._get_undo_checkpoint()
    try:
      for user_action in user_actions:
        self._schema_updated = False

        # At the start of each useraction, clear exemptions. These are used to avoid recalcs of
        # trigger-formula columns for which the same useractions sets an explicit value.
        self._prevent_recompute_map.clear()

        self.out_actions.retValues.append(self._apply_one_user_action(user_action))

        # If the UserAction touched the schema, check that it is now consistent with metadata.
        if self._schema_updated:
          self.assert_schema_consistent()

    except Exception as e:
      # Save full exception info, so that we can rethrow accurately even if undo also fails.
      exc_info = sys.exc_info()
      # If we get an exception, we should revert all changes applied so far, to keep things
      # consistent internally as well as with the clients and database outside of the sandbox
      # (which won't see any changes in case of an error).
      log.info("Failed to apply useractions; reverting: %r", e)
      self._undo_to_checkpoint(checkpoint)

      # Check schema consistency again. If this fails, something is really wrong (we tried to go
      # back to a good state but failed). We'll just report it loudly.
      try:
        if self._schema_updated:
          self.assert_schema_consistent()
      except Exception:
        log.error("Inconsistent schema after revert on failure: %s", traceback.format_exc())

      # Re-raise the original exception
      # In Python 2, 'raise' raises the most recent exception,
      # which may come from the try/except just above
      # Python 3 keeps track of nested exceptions better
      if six.PY2:
        six.reraise(*exc_info)
      else:
        raise

    # If needed, rebuild dependencies for trigger formulas.
    self._maybe_update_trigger_dependencies()

    # Note that recalculations and auto-removals get included after processing all useractions.
    self._bring_all_up_to_date()

    # Apply any triggered record removals. If anything does get removed, recalculate what's needed.
    while self.docmodel.apply_auto_removes():
      self._bring_all_up_to_date()

    self.out_actions.flush_calc_changes()
    self.out_actions.check_sanity()
    self._user = None
    self._request_responses = {}
    self._cached_request_keys = set()
    return self.out_actions

  def acl_split(self, action_group):
    """
    Splits ActionGroups, as returned e.g. from apply_user_actions, by permissions. Returns a
    single ActionBundle containing of all of the original action_groups.
    """
    # pylint:disable=no-self-use
    return acl.acl_read_split(action_group)

  def _apply_one_user_action(self, user_action):
    """
    Applies a single user action to the document, without running any triggered updates.
    A UserAction is a tuple whose first element is the name of the action.
    """
    log.debug("applying user_action %s", user_action)
    return getattr(self.user_actions, user_action.__class__.__name__)(*user_action)

  def apply_doc_action(self, doc_action):
    """
    Applies a doc action, which is a step of a user action. It is represented by an Action object
    as defined in actions.py.
    """
    self._gone_columns = []

    action_name = doc_action.__class__.__name__
    saved_schema = None
    if action_name in actions.schema_actions:
      self._schema_updated = True
      # Make a copy of the schema. If a bug causes a docaction to fail after modifying schema, we
      # restore it, or we'll end up with mismatching schema and metadata.
      saved_schema = schema.clone_schema(self.schema)

    try:
      getattr(self.doc_actions, action_name)(*doc_action)
    except Exception:
      # Save full exception info, so that we can rethrow accurately even if this clause also fails.
      exc_info = sys.exc_info()
      if saved_schema:
        log.info("Restoring schema and usercode on exception")
        self.schema = saved_schema
        self._should_rebuild_usercode = True
        try:
          self.rebuild_usercode()
        except Exception:
          log.error("Error rebuilding usercode after restoring schema: %s", traceback.format_exc())

      # Re-raise the original exception
      # In Python 2, 'raise' raises the most recent exception,
      # which may come from the try/except just above
      # Python 3 keeps track of nested exceptions better
      if six.PY2:
        six.reraise(*exc_info)
      else:
        raise

    # If any columns got deleted, destroy them to clear _back_references in other tables, and to
    # force errors if anything still uses them. Also clear them from calc actions if needed.
    for col in self._gone_columns:
      # Calc actions may already be generated if the column deletion was triggered by auto-removal.
      actions.prune_actions(self.out_actions.calc, col.table_id, col.col_id)
      col.destroy()

    # We normally recompute formulas before returning to the user; but some formulas are also used
    # internally in-between applying doc actions. We have this workaround to ensure that those are
    # up-to-date after each doc action. See more in comments for _bring_mlookups_up_to_date.
    # We check _in_update_loop to avoid a recursive call (happens when a formula produces an
    # action, as for derived/summary tables).
    if not self._in_update_loop:
      self._bring_mlookups_up_to_date(doc_action)

  def autocomplete(self, txt, table_id, column_id, row_id, user):
    """
    Return a list of suggested completions of the python fragment supplied.
    """
    table = self.tables[table_id]

    # Table.lookup methods are special to suggest arguments after '('
    match = re.match(r"(\w+)\.(lookupRecords|lookupOne)\($", txt)
    if match:
      # Get the 'Table1' in 'Table1.lookupRecords('
      lookup_table_id = match.group(1)
      if lookup_table_id in self.tables:
        lookup_table = self.tables[lookup_table_id]
        # Add a keyword argument with no value for each column name in the lookup table.
        result = [
          txt + col_id + "="
          for col_id in lookup_table.all_columns
          if column.is_visible_column(col_id) or col_id == 'id'
        ]
        # Add specific complete lookups involving reference columns.
        result += [
          txt + option
          for option in lookup_autocomplete_options(lookup_table, table, reverse_only=False)
        ]
        # Add a dummy empty example value for each result to produce the correct shape.
        result = [(r, None) for r in result]
        return sorted(result)

    # replace $ with rec. and add a dummy rec object
    tweaked_txt = DOLLAR_REGEX.sub(r'rec.', txt)
    # convert a bare $ with nothing after it also
    if txt == '$':
      tweaked_txt = 'rec.'

    autocomplete_context = self.autocomplete_context
    context = autocomplete_context.get_context()
    context['rec'] = table.sample_record

    # Remove values from the context that need to be recomputed.
    context.pop('value', None)
    context.pop('user', None)

    col = table.get_column(column_id) if table.has_column(column_id) else None
    if col and not col.is_formula():
      # Add trigger formula completions.
      context['value'] = col.sample_value()
      context['user'] = User(user, self.tables, is_sample=True)

    completer = rlcompleter.Completer(context)
    results = []
    at = 0
    while True:
      # Get a possible completion.  Result will be None or "<tweaked_txt><extra suggestion>"
      result = completer.complete(tweaked_txt, at)
      at += 1
      if not result:
        break
      if skipped_completions.search(result):
        continue
      result = autocomplete_context.process_result(result)
      results.append(result)
      funcname = result[0]
      # Suggest reverse reference lookups, specifically only for .lookupRecords(),
      # not for .lookupOne().
      if isinstance(result, tuple) and funcname.endswith(".lookupRecords"):
        lookup_table_id = funcname.split(".")[0]
        if lookup_table_id in self.tables:
          lookup_table = self.tables[lookup_table_id]
          results += [
            funcname + "(" + option
            for option in lookup_autocomplete_options(lookup_table, table, reverse_only=True)
          ]

    ### Add example values to all results where possible.
    if row_id == "new":
      row_id = table.row_ids.max()
    rec = table.Record(row_id)
    # Don't use the same user object as above because we don't want is_sample=True,
    # which is only needed for the sake of suggesting completions.
    # Here we want to show actual values.
    user_obj = User(user, self.tables)
    results = [
      (result, eval_suggestion(result, rec, user_obj))
      for result in results
    ]

    # If we changed the prefix (expanding the $ symbol) we now need to change it back.
    if tweaked_txt != txt:
      results = [(txt + result[len(tweaked_txt):], value) for result, value in results]
    # pylint:disable=unidiomatic-typecheck
    results.sort(key=lambda r: r[0][0] if type(r[0]) == tuple else r[0])
    return results

  def _get_undo_checkpoint(self):
    """
    You may call _get_undo_checkpoint() and pass its result into _undo_to_checkpoint() to undo
    DocActions saved since the first call; but only while in a single apply_user_actions() call.
    """
    # We produce a tuple of lengths: one for each of the properties of out_actions ActionObj.
    aobj = self.out_actions
    return (len(aobj.calc), len(aobj.stored), len(aobj.undo), len(aobj.retValues))

  def _undo_to_checkpoint(self, checkpoint):
    """
    See _get_undo_checkpoint() above.
    """
    # Check if out_actions ActionObj grew at all since _get_undo_checkpoint(). If yes, revert by
    # applying any undo actions, and trim it back to original state (if we don't trim it, it will
    # only grow further, with undo actions themselves getting applied as new doc actions).
    new_checkpoint = self._get_undo_checkpoint()
    if new_checkpoint != checkpoint:
      (len_calc, len_stored, len_undo, len_ret) = checkpoint
      undo_actions = self.out_actions.undo[len_undo:]
      log.info("Reverting %d doc actions", len(undo_actions))
      self.user_actions.ApplyUndoActions([actions.get_action_repr(a) for a in undo_actions])
      del self.out_actions.calc[len_calc:]
      del self.out_actions.stored[len_stored:]
      del self.out_actions.direct[len_stored:]
      del self.out_actions.undo[len_undo:]
      del self.out_actions.retValues[len_ret:]


# end
