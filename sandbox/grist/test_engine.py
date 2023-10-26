import difflib
import functools
import json
import logging
import sys
import unittest
from collections import namedtuple
from pprint import pprint

import six

import actions
import column
import engine
import useractions
import testutil
import objtypes

log = logging.getLogger(__name__)

# These are for use in verifying metadata using assertTables/assertViews methods. E.g.
#   self.assertViews([View(1, sections=[Section(1, parentKey="record", tableRef=1, fields=[
#         Field(1, colRef=11) ]) ]) ])
Table = namedtuple('Table', ('id tableId primaryViewId summarySourceTable columns'))
Column = namedtuple('Column', ('id colId type isFormula formula summarySourceCol'))
View = namedtuple('View', 'id sections')
Section = namedtuple('Section', 'id parentKey tableRef fields')
Field = namedtuple('Field', 'id colRef')

if six.PY2:
  unittest.TestCase.assertRaisesRegex = unittest.TestCase.assertRaisesRegexp
  unittest.TestCase.assertRegex = unittest.TestCase.assertRegexpMatches

class EngineTestCase(unittest.TestCase):
  """
  Provides functionality for verifying engine actions and data, which is general enough to be
  useful for other tests. It is also used by TestEngine below.
  """
  @classmethod
  def setUpClass(cls):
    cls._orig_log_level = logging.root.level
    logging.root.setLevel(logging.WARNING)

  @classmethod
  def tearDownClass(cls):
    logging.root.setLevel(cls._orig_log_level)


  def setUp(self):
    """
    Initial setup for each test case.
    """
    self.engine = engine.Engine()
    self.engine.load_empty()

    # Set up call tracing to count calls (formula evaluations) for each column for each table.
    self.call_counts = {}
    def trace_call(col_obj, _rec):
      # Ignore formulas in metadata tables for simplicity. Such formulas are mostly private, and
      # it would be annoying to fix tests every time we change them.
      if not col_obj.table_id.startswith("_grist_"):
        tmap = self.call_counts.setdefault(col_obj.table_id, {})
        tmap[col_obj.col_id] = tmap.get(col_obj.col_id, 0) + 1
    self.engine.formula_tracer = trace_call

    # This is set when a test case is wrapped by `test_engine.test_undo`.
    self._undo_state_tracker = None


  @classmethod
  def _getEngineDataLines(cls, engine_data, col_names=[]):
    """
    Helper for assertEqualEngineData, which returns engine data represented as lines of text
    suitable for diffing. If col_names is given, it determines the order of columns (columns not
    found in this list are included in the end and sorted by name).
    """
    sort_keys = {c: i for i, c in enumerate(col_names)}
    ret = []
    for table_id, table_data in sorted(engine_data.items()):
      ret.append("TABLE %s\n" % table_id)
      col_items = sorted(table_data.columns.items(),
                         key=lambda c: (sort_keys.get(c[0], float('inf')), c))
      col_items.insert(0, ('id', table_data.row_ids))
      table_rows = zip(*[[col_id] + values for (col_id, values) in col_items])
      ret.extend(json.dumps(row) + "\n" for row in table_rows)
    return ret

  def assertEqualDocData(self, observed, expected, col_names=[]):
    """
    Compare full engine data, as a mapping of table_ids to TableData objects, and reporting
    differences with a customized diff (similar to the JSON representation in the test script).
    """
    enc_observed = actions.encode_objects(observed)
    enc_expected = actions.encode_objects(expected)
    if enc_observed != enc_expected:
      o_lines = self._getEngineDataLines(enc_observed, col_names)
      e_lines = self._getEngineDataLines(enc_expected, col_names)
      self.fail("Observed data not as expected:\n" +
                "".join(difflib.unified_diff(e_lines, o_lines,
                                             fromfile="expected", tofile="observed")))

  def assertCorrectEngineData(self, expected_data):
    """
    Verifies that the data engine contains the same data as the given expected data,
    which should be a dictionary mapping table names to TableData objects.
    """
    expected_output = actions.decode_objects(expected_data)

    meta_tables = self.engine.fetch_table("_grist_Tables")
    output = {t: self.engine.fetch_table(t) for t in meta_tables.columns["tableId"]}
    output = testutil.replace_nans(output)

    self.assertEqualDocData(output, expected_output)

  def getFullEngineData(self):
    return testutil.replace_nans({t: self.engine.fetch_table(t) for t in self.engine.tables})

  def assertPartialData(self, table_name, col_names, row_data):
    """
    Verifies that the data engine contains the right data for the given col_names (ignoring any
    other columns).
    """
    expected = testutil.table_data_from_rows(table_name, col_names, row_data)
    observed = self.engine.fetch_table(table_name, private=True)
    ignore = set(observed.columns) - set(expected.columns)
    for col_id in ignore:
      del observed.columns[col_id]
    self.assertEqualDocData({table_name: observed}, {table_name: expected})


  action_group_action_fields = ("stored", "undo", "calc", "direct")

  @classmethod
  def _formatActionGroup(cls, action_group, use_repr=False):
    """
    Helper for assertEqualActionGroups below.
    """
    lines = ["{"]
    for (k, action_list) in sorted(action_group.items()):
      if k in cls.action_group_action_fields:
        for a in action_list:
          rep = repr(a) if use_repr else json.dumps(a, sort_keys=True)
          lines.append("%s: %s," % (k, rep))
      else:
        lines.append("%s: %s," % (k, json.dumps(action_list)))
    lines.append("}")
    return lines

  def assertEqualActionGroups(self, observed, expected):
    """
    Compare grouped doc actions, reporting differences with a customized diff
    (a bit more readable than unittest's usual diff).
    """
    # Do some clean up on the observed data.
    observed = testutil.replace_nans(observed)

    # Convert observed and expected actions into a comparable form.
    for k in self.action_group_action_fields:
      if k in observed:
        observed[k] = [get_comparable_repr(v) for v in observed[k]]
      if k in expected:
        expected[k] = [get_comparable_repr(v) for v in expected[k]]

    if observed != expected:
      o_lines = self._formatActionGroup(observed)
      e_lines = self._formatActionGroup(expected)
      self.fail(("Observed out actions not as expected:\n") +
                "\n".join(difflib.unified_diff(e_lines, o_lines, n=3, lineterm="",
                                               fromfile="expected", tofile="observed")))

  def assertOutActions(self, out_action_group, expected_group):
    """
    Compares action group returned from engine.apply_user_actions() to expected actions as listed
    in testscript. The array of retValues is only checked if present in expected_group.
    """
    for k in self.action_group_action_fields:
      # For comparing full actions, treat omitted groups (e.g. "calc") as expected to be empty.
      expected_group.setdefault(k, [])

    observed = {k: getattr(out_action_group, k) for k in self.action_group_action_fields }
    if "retValue" in expected_group:
      observed["retValue"] = out_action_group.retValues
    self.assertEqualActionGroups(observed, expected_group)

  def assertPartialOutActions(self, out_action_group, expected_group):
    """
    Compares a single action group as returned from engine.apply_user_actions() to expected
    actions, checking only those fields that are included in the expected_group dict.
    """
    observed = {k: getattr(out_action_group, k) for k in expected_group}
    self.assertEqualActionGroups(observed, expected_group)

  def dump_data(self):
    """
    Prints a dump of all engine data, for help in writing / debugging tests.
    """
    output = {t: self.engine.fetch_table(t) for t in self.engine.schema}
    output = testutil.replace_nans(output)
    output = actions.encode_objects(output)
    print(''.join(self._getEngineDataLines(output)))

  def dump_actions(self, out_actions):
    """
    Prints out_actions in human-readable format, for help in writing / debugging tets.
    """
    pprint({
      k: [get_comparable_repr(action) for action in getattr(out_actions, k)]
      for k in self.action_group_action_fields
    })

  def assertTableData(self, table_name, data=[], cols="all", rows="all", sort=None):
    """
    Verify some or all of the data in the table named `table_name`.
    - data: an array of rows, with first row containing column names starting with "id", and
      other rows also all starting with row_id.
    - cols: may be "all" (default) to match all columns, or "subset" to match only those listed.
    - rows: may be "all" (default) to match all rows, or "subset" to match only those listed,
      or a function called with a Record to return whether to include it.
    - sort: optionally a key function called with a Record, for sorting observed rows.
    """
    assert data[0][0] == 'id', "assertRecords requires 'id' as the first column"
    col_names = data[0]
    row_data = data[1:]
    expected = testutil.table_data_from_rows(table_name, col_names, row_data)

    table = self.engine.tables[table_name]
    columns = [c for c in table.all_columns.values()
               if c.col_id != "id" and not column.is_virtual_column(c.col_id)]
    if cols == "all":
      pass
    elif cols == "subset":
      columns = [c for c in columns if c.col_id in col_names]
    else:
      raise ValueError("assertRecords: invalid value for cols: %s" % (cols,))

    if rows == "all":
      row_ids = list(table.row_ids)
    elif rows == "subset":
      row_ids = [row[0] for row in row_data]
    elif callable(rows):
      row_ids = [r.id for r in table.user_table.all if rows(r)]
    else:
      raise ValueError("assertRecords: invalid value for rows: %s" % (rows,))

    if sort:
      row_ids.sort(key=lambda r: sort(table.get_record(r)))

    observed_col_data = {
      c.col_id: [c.raw_get(r) for r in row_ids]
      for c in columns if c.col_id != "id"
    }
    observed = actions.TableData(table_name, row_ids, observed_col_data)
    self.assertEqualDocData({table_name: observed}, {table_name: expected},
                            col_names=col_names)

  def assertTables(self, list_of_tables):
    """
    Verifies that the given Table test-records correspond to the metadata for tables/columns.
    """
    self.assertPartialData('_grist_Tables',
                           ["id", "tableId", "primaryViewId", "summarySourceTable"],
                           sorted((tbl.id, tbl.tableId, tbl.primaryViewId, tbl.summarySourceTable)
                                  for tbl in list_of_tables))
    self.assertPartialData('_grist_Tables_column',
                           ["id", "parentId", "colId", "type",
                            "isFormula", "formula", "summarySourceCol"],
                           sorted((col.id, tbl.id, col.colId, col.type,
                                   col.isFormula, col.formula, col.summarySourceCol)
                                  for tbl in list_of_tables
                                  for col in tbl.columns))

  def assertFormulaError(self, exc, type_, message, tracebackRegexp=None):
    self.assertIsInstance(exc, objtypes.RaisedException)
    self.assertIsInstance(exc.error, type_)
    self.assertEqual(exc._message, message)
    if tracebackRegexp:
      traceback_string = exc.details
      if sys.version_info >= (3, 11) and type_ != SyntaxError:
        # Python 3.11+ adds lines with only spaces and ^ to indicate the location of the error.
        # We remove those lines to make the test work with both old and new versions.
        # This doesn't apply to SyntaxError, which has those lines in all versions.
        traceback_string = "\n".join(
          line for line in traceback_string.splitlines()
          if set(line) != {" ", "^"}
        )
      self.assertRegex(traceback_string.strip(), tracebackRegexp.strip())

  def assertViews(self, list_of_views):
    """
    Verifies that the given View test-records correspond to the metadata for views/sections/fields.
    """
    self.assertPartialData('_grist_Views', ["id"],
                           [[view.id] for view in list_of_views])
    self.assertTableData('_grist_Views_section',
                         rows=lambda r: r.parentId,
                         cols="subset",
                         data=[["id", "parentId", "parentKey", "tableRef"]] + sorted(
                           (sec.id, view.id, sec.parentKey, sec.tableRef)
                           for view in list_of_views
                           for sec in view.sections))
    self.assertTableData('_grist_Views_section_field', sort=(lambda r: r.parentPos),
                         rows=lambda r: r.parentId.parentId,
                         cols="subset",
                         data=[["id", "parentId", "colRef"]] + sorted(
                           ((field.id, sec.id, field.colRef)
                            for view in list_of_views
                            for sec in view.sections
                            for field in sec.fields), key=lambda t: t[1])
                        )


  def load_sample(self, sample):
    """
    Load the data engine with given sample data. The sample is a dict with keys "SCHEMA" and
    "DATA", each a dictionary mapping table names to actions.TableData objects. "SCHEMA" contains
    "_grist_Tables" and "_grist_Tables_column" tables.
    """
    schema = sample["SCHEMA"]
    self.engine.load_meta_tables(schema['_grist_Tables'], schema['_grist_Tables_column'])
    for data in six.itervalues(sample["DATA"]):
      self.engine.load_table(data)
    # We used to call load_done() at the end; in practice, Grist's ActiveDoc does not call
    # load_done, but applies the "Calculate" user action. Do that for more realistic tests.
    self.apply_user_action(['Calculate'])

  # The following are convenience methods for tests deriving from EngineTestCase.
  def add_column(self, table_name, col_name, **kwargs):
    return self.apply_user_action(['AddColumn', table_name, col_name, kwargs])

  def modify_column(self, table_name, col_name, **kwargs):
    return self.apply_user_action(['ModifyColumn', table_name, col_name, kwargs])

  def remove_column(self, table_name, col_name):
    return self.apply_user_action(['RemoveColumn', table_name, col_name])

  def update_record(self, table_name, row_id, **kwargs):
    return self.apply_user_action(['UpdateRecord', table_name, row_id, kwargs])

  def add_record(self, table_name, row_id=None, **kwargs):
    return self.apply_user_action(['AddRecord', table_name, row_id, kwargs])

  def remove_record(self, table_name, row_id):
    return self.apply_user_action(['RemoveRecord', table_name, row_id])

  def update_records(self, table_name, col_names, row_data):
    return self.apply_user_action(
      ('BulkUpdateRecord',) + testutil.table_data_from_rows(table_name, col_names, row_data))

  @classmethod
  def add_records_action(cls, table_name, data):
    """
    Creates a BulkAddRecord action; data should be an array of rows, with first row containing
    column names, with "id" column optional.
    """
    col_names, row_data = data[0], data[1:]
    if "id" not in col_names:
      col_names = ["id"] + col_names
      row_data = [[None] + r for r in row_data]
    return ('BulkAddRecord',) + testutil.table_data_from_rows(table_name, col_names, row_data)

  def add_records(self, table_name, col_names, row_data):
    return self.apply_user_action(self.add_records_action(table_name, [col_names] + row_data))

  def apply_user_action(self, user_action_repr, is_undo=False, user=None):
    if not is_undo:
      log.debug("Applying user action %r", user_action_repr)
      if self._undo_state_tracker is not None:
        doc_state = self.getFullEngineData()

    self.call_counts.clear()
    out_actions = self.engine.apply_user_actions([useractions.from_repr(user_action_repr)], user)
    out_actions.calls = self.call_counts.copy()

    if not is_undo and self._undo_state_tracker is not None:
      self._undo_state_tracker.append((doc_state, out_actions.undo[:]))
    return out_actions

  def apply_undo_actions(self, undo_actions):
    """
    Applies all doc_actions together (as happens e.g. for undo).
    """
    action = ["ApplyUndoActions", [actions.get_action_repr(a) for a in undo_actions]]
    return self.apply_user_action(action, is_undo=True)


def test_undo(test_method):
  """
  If a test method is decorated with `@test_engine.test_undo`, then we will store the state before
  each apply_user_action() call, and at the end of the test, undo each user-action and compare the
  state. This makes for a fairly comprehensive test of undo.
  """
  @functools.wraps(test_method)
  def wrapped(self):
    self._undo_state_tracker = []
    test_method(self)
    for (expected_engine_data, undo_actions) in reversed(self._undo_state_tracker):
      log.debug("Applying undo actions %r", undo_actions)
      self.apply_undo_actions(undo_actions)
      self.assertEqualDocData(self.getFullEngineData(), expected_engine_data)
  return wrapped

test_undo.__test__ = False  # tells pytest that this isn't a test


class TestEngine(EngineTestCase):
  samples = {}

  #----------------------------------------------------------------------
  # Implementations of the actual script steps.
  #----------------------------------------------------------------------
  def process_apply_step(self, data):
    """
    Processes the "APPLY" step of a test script, applying a user action, and checking the
    resulting action group's return value (if present)
    """
    if "USER_ACTION" in data:
      user_actions = [useractions.from_repr(data.pop("USER_ACTION"))]
    else:
      user_actions = [useractions.from_repr(u) for u in data.pop("USER_ACTIONS")]

    expected_call_counts = data.pop("CHECK_CALL_COUNTS", None)
    expected_actions = data.pop("ACTIONS", {})
    expected_actions.setdefault("stored", [])
    expected_actions.setdefault("calc", [])
    expected_actions.setdefault("undo", [])

    if data:
      raise ValueError("Unrecognized key %s in APPLY step" % data.popitem()[0])

    self.call_counts.clear()
    out_actions = self.engine.apply_user_actions(user_actions)

    self.assertOutActions(out_actions, expected_actions)
    if expected_call_counts:
      self.assertEqual(self.call_counts, expected_call_counts)
    return out_actions

  #----------------------------------------------------------------------
  # The runner for scripted test cases.
  #----------------------------------------------------------------------
  def _run_test_body(self, _name, body):
    """
    Runs the actual script defined in the JSON test-script file.
    """
    undo_actions = []
    loaded_sample = None
    for line, step, data in body:
      try:
        if step == "LOAD_SAMPLE":
          if loaded_sample:
            # pylint: disable=unsubscriptable-object
            self._verify_undo_all(undo_actions, loaded_sample["DATA"])
          loaded_sample = self.samples[data]
          self.load_sample(loaded_sample)
        elif step == "APPLY":
          action_group = self.process_apply_step(data)
          undo_actions.extend(action_group.undo)
        elif step == "CHECK_OUTPUT":
          expected_data = {}
          if "USE_SAMPLE" in data:
            sample = self.samples[data.pop("USE_SAMPLE")]
            expected_data = sample["DATA"].copy()
          expected_data.update({t: testutil.table_data_from_rows(t, tdata[0], tdata[1:])
                                for (t, tdata) in six.iteritems(data)})
          self.assertCorrectEngineData(expected_data)
        else:
          raise ValueError("Unrecognized step %s in test script" % step)
      except Exception as e:
        prefix = "LINE %s: " % line
        e.args = (prefix + e.args[0],) + e.args[1:] if e.args else (prefix,)
        raise

    self._verify_undo_all(undo_actions, loaded_sample["DATA"])

  def _verify_undo_all(self, undo_actions, expected_data):
    """
    At the end of each test, undo all and verify we get back to the originally loaded sample.
    """
    self.apply_undo_actions(undo_actions)
    del undo_actions[:]
    self.assertCorrectEngineData(expected_data)

    # TODO We need several more tests.
    # 1. After a bunch of schema actions, create a new engine from the resulting schema, ensure that
    #    modified engine and new engine produce the same results AND the same dep_graph.
    # 2. Build up a table by adding one column at a time, in "good" order and in "bad" order (with
    #    references to columns that will be added later)
    # 3. Tear down a table in both of the orders above.
    # 4. At each intermediate state of 2 and 3, new engine should produce same results as the
    #    modified engine (and have the same state such as dep_graph).

  sample1 = {
    "SCHEMA": [
      [1, "Address", [
        [11, "city",        "Text",       False, "", "", ""],
        [12, "state",       "Text",       False, "", "", ""],
        [13, "amount",      "Numeric",    False, "", "", ""],
      ]]
    ],
    "DATA": {
      "Address": [
        ["id",  "city",     "state", "amount" ],
        [ 21,   "New York", "NY"   , 1        ],
        [ 22,   "Albany",   "NY"   , 2        ],
      ]
    }
  }

  def test_no_private_fields(self):
    self.load_sample(testutil.parse_test_sample(self.sample1))

    data = self.engine.fetch_table("_grist_Tables", private=True)
    self.assertIn('tableId', data.columns)
    self.assertIn('columns', data.columns)
    self.assertIn('viewSections', data.columns)

    data = self.engine.fetch_table("_grist_Tables")
    self.assertIn('tableId', data.columns)
    self.assertNotIn('columns', data.columns)
    self.assertNotIn('viewSections', data.columns)

  def test_fetch_table_query(self):
    self.load_sample(testutil.parse_test_sample(self.sample1))

    col_names = ["id",  "city",     "state", "amount" ]
    data = self.engine.fetch_table('Address', query={'state': ['NY']})
    self.assertEqualDocData({'Address': data},
        {'Address': testutil.table_data_from_rows('Address', col_names, [
          [ 21,   "New York", "NY"   , 1        ],
          [ 22,   "Albany",   "NY"   , 2        ],
        ])})

    data = self.engine.fetch_table('Address', query={'city': ['New York'], 'state': ['NY']})
    self.assertEqualDocData({'Address': data},
        {'Address': testutil.table_data_from_rows('Address', col_names, [
          [ 21,   "New York", "NY"   , 1        ],
        ])})

    data = self.engine.fetch_table('Address', query={'amount': [2.0]})
    self.assertEqualDocData({'Address': data},
        {'Address': testutil.table_data_from_rows('Address', col_names, [
          [ 22,   "Albany",   "NY"   , 2        ],
        ])})

    data = self.engine.fetch_table('Address', query={'city': ['New York'], 'amount': [2.0]})
    self.assertEqualDocData({'Address': data},
        {'Address': testutil.table_data_from_rows('Address', col_names, [])})

    data = self.engine.fetch_table('Address', query={'city': ['New York'], 'amount': [1.0, 2.0]})
    self.assertEqualDocData({'Address': data},
        {'Address': testutil.table_data_from_rows('Address', col_names, [
          [ 21,   "New York", "NY"   , 1        ],
        ])})

    # Ensure empty filter list works too.
    data = self.engine.fetch_table('Address', query={'city': ['New York'], 'amount': []})
    self.assertEqualDocData({'Address': data},
        {'Address': testutil.table_data_from_rows('Address', col_names, [])})

    # Test unhashable values in the column and in the query
    self.add_column('Address', 'list', type='Any', isFormula=True,
                    formula='[1] if $id == 21 else 2')
    col_names.append('list')

    data = self.engine.fetch_table('Address', query={'list': [[1]]})
    self.assertEqualDocData({'Address': data},
        {'Address': testutil.table_data_from_rows('Address', col_names, [
          [ 21,   "New York", "NY"   , 1, [1]],
        ])})

    data = self.engine.fetch_table('Address', query={'list': [2]})
    self.assertEqualDocData({'Address': data},
        {'Address': testutil.table_data_from_rows('Address', col_names, [
          [ 22,   "Albany",   "NY"   , 2, 2],
        ])})

    data = self.engine.fetch_table('Address', query={'list': [[1], 2]})
    self.assertEqualDocData({'Address': data},
        {'Address': testutil.table_data_from_rows('Address', col_names, [
          [ 21,   "New York", "NY"   , 1, [1]],
          [ 22,   "Albany",   "NY"   , 2, 2],
        ])})

  def test_schema_restore_on_error(self):
    # Simulate an error inside a DocAction, and make sure we restore the schema (don't leave it in
    # inconsistent with metadata).
    self.load_sample(testutil.parse_test_sample(self.sample1))
    with self.assertRaisesRegex(AttributeError, r"'BAD'"):
      self.add_column('Address', 'bad', isFormula=False, type="BAD")
    self.engine.assert_schema_consistent()


def create_tests_from_script(samples, test_cases):
  """
  Dynamically create tests from a file containing a JSON spec for test cases. The reason for doing
  it this way is because the same JSON spec is used to test Python and JS code.

  Tests are created as methods to a TestCase. It's done on import, so that python unittest feature
  to run only particular test cases can apply to these cases too.
  """
  TestEngine.samples = samples
  for case in test_cases:
    create_test_case("test_" + case["TEST_CASE"], case["BODY"])

def create_test_case(name, body):
  """
  Helper for create_tests_from_script, which creates a single test case.
  """
  def run(self):
    self._run_test_body(name, body)
  setattr(TestEngine, name, run)

 # Convert observed/expected action into a comparable form.
def get_comparable_repr(a):
  if isinstance(a, (list, int)):
    return a
  return actions.get_action_repr(a)

# Parse and create test cases on module load. This way the python unittest feature to run only
# particular test cases can apply to these cases too.
create_tests_from_script(*testutil.parse_testscript())


if __name__ == "__main__":
  unittest.main()
