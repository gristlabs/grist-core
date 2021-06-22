import six

import actions
import schema
import table_data_set
import testutil

import difflib
import json
import unittest

class TestTableDataSet(unittest.TestCase):
  """
  Tests functionality of TableDataSet by running through all the test cases in testscript.json.
  """
  @classmethod
  def init_test_cases(cls):
    # Create a test_* method for each case in testscript, which runs `self._run_test_body()`.
    cls.samples, test_cases = testutil.parse_testscript()
    for case in test_cases:
      cls._create_test_case(case["TEST_CASE"], case["BODY"])

  @classmethod
  def _create_test_case(cls, name, body):
    setattr(cls, "test_" + name, lambda self: self._run_test_body(body))


  def setUp(self):
    self._table_data_set = None

  def load_sample(self, sample):
    """
    Load _table_data_set with given sample data. The sample is a dict with keys "SCHEMA" and
    "DATA", each a dictionary mapping table names to actions.TableData objects. "SCHEMA" contains
    "_grist_Tables" and "_grist_Tables_column" tables.
    """
    self._table_data_set = table_data_set.TableDataSet()
    for a in schema.schema_create_actions():
      if a.table_id not in self._table_data_set.all_tables:
        self._table_data_set.apply_doc_action(a)

    for a in six.itervalues(sample["SCHEMA"]):
      self._table_data_set.BulkAddRecord(*a)

    # Create AddTable actions for each table described in the metadata.
    meta_tables = self._table_data_set.all_tables['_grist_Tables']
    meta_columns = self._table_data_set.all_tables['_grist_Tables_column']

    add_tables = {}   # maps the row_id of the table to the schema object for the table.
    for rec in actions.transpose_bulk_action(meta_tables):
      add_tables[rec.id] = actions.AddTable(rec.tableId, [])

    # Go through all columns, adding them to the appropriate tables.
    for rec in actions.transpose_bulk_action(meta_columns):
      add_tables[rec.parentId].columns.append({
        "id": rec.colId,
        "type": rec.type,
        "widgetOptions": rec.widgetOptions,
        "isFormula": rec.isFormula,
        "formula": rec.formula,
        "label"  : rec.label,
        "parentPos": rec.parentPos,
      })

    # Sort the columns in the schema according to the parentPos field from the column records.
    for action in six.itervalues(add_tables):
      action.columns.sort(key=lambda r: r["parentPos"])
      self._table_data_set.AddTable(*action)

    for a in six.itervalues(sample["DATA"]):
      self._table_data_set.ReplaceTableData(*a)


  def _run_test_body(self, body):
    """Runs the actual script defined in the JSON test-script file."""
    undo_actions = []
    loaded_sample = None
    for line, step, data in body:
      try:
        if step == "LOAD_SAMPLE":
          if loaded_sample:
            # Pylint's type checking gives a false positive for loaded_sample.
            # pylint: disable=unsubscriptable-object
            self._verify_undo_all(undo_actions, loaded_sample["DATA"])
          loaded_sample = self.samples[data]
          self.load_sample(loaded_sample)
        elif step == "APPLY":
          self._apply_stored_actions(data['ACTIONS']['stored'])
          if 'calc' in data['ACTIONS']:
            self._apply_stored_actions(data['ACTIONS']['calc'])
          undo_actions.extend(data['ACTIONS']['undo'])
        elif step == "CHECK_OUTPUT":
          expected_data = {}
          if "USE_SAMPLE" in data:
            expected_data = self.samples[data.pop("USE_SAMPLE")]["DATA"].copy()
          expected_data.update({t: testutil.table_data_from_rows(t, tdata[0], tdata[1:])
                                for (t, tdata) in six.iteritems(data)})
          self._verify_data(expected_data)
        else:
          raise ValueError("Unrecognized step %s in test script" % step)
      except Exception as e:
        new_args0 = "LINE %s: %s" % (line, e.args[0])
        e.args = (new_args0,) + e.args[1:]
        raise

    self._verify_undo_all(undo_actions, loaded_sample["DATA"])

  def _apply_stored_actions(self, stored_actions):
    for action in stored_actions:
      self._table_data_set.apply_doc_action(actions.action_from_repr(action))

  def _verify_undo_all(self, undo_actions, expected_data):
    """
    At the end of each test, undo all and verify we get back to the originally loaded sample.
    """
    self._apply_stored_actions(reversed(undo_actions))
    del undo_actions[:]
    self._verify_data(expected_data, ignore_formulas=True)

  def _verify_data(self, expected_data, ignore_formulas=False):
    observed_data = {t: self._prep_data(*data)
                     for t, data in six.iteritems(self._table_data_set.all_tables)
                     if not t.startswith("_grist_")}
    if ignore_formulas:
      observed_data = self._strip_formulas(observed_data)
      expected_data = self._strip_formulas(expected_data)

    if observed_data != expected_data:
      lines = []
      for table in sorted(six.viewkeys(observed_data) | six.viewkeys(expected_data)):
        if table not in expected_data:
          lines.append("*** Table %s observed but not expected\n" % table)
        elif table not in observed_data:
          lines.append("*** Table %s not observed but was expected\n" % table)
        else:
          obs, exp = observed_data[table], expected_data[table]
          if obs != exp:
            o_lines = self._get_text_lines(obs)
            e_lines = self._get_text_lines(exp)
            lines.append("*** Table %s differs\n" % table)
            lines.extend(difflib.unified_diff(e_lines, o_lines,
                                              fromfile="expected", tofile="observed"))
      self.fail("\n" + "".join(lines))

  def _strip_formulas(self, all_data):
    return {t: self._strip_formulas_table(*data) for t, data in six.iteritems(all_data)}

  def _strip_formulas_table(self, table_id, row_ids, columns):
    return actions.TableData(table_id, row_ids, {
      col_id: col for col_id, col in six.iteritems(columns)
      if not self._table_data_set.get_col_info(table_id, col_id)["isFormula"]
    })

  @classmethod
  def _prep_data(cls, table_id, row_ids, columns):
    def sort(col):
      return [v for r, v in sorted(zip(row_ids, col))]

    sorted_data = actions.TableData(table_id, sorted(row_ids),
                                    {c: sort(col) for c, col in six.iteritems(columns)})
    return actions.encode_objects(testutil.replace_nans(sorted_data))

  @classmethod
  def _get_text_lines(cls, table_data):
    col_items = sorted(table_data.columns.items())
    col_items.insert(0, ('id', table_data.row_ids))
    table_rows = zip(*[[col_id] + values for (col_id, values) in col_items])
    return [json.dumps(row) + "\n" for row in table_rows]


# Parse and create test cases on module load. This way the python unittest feature to run only
# particular test cases can apply to these cases too.
TestTableDataSet.init_test_cases()

if __name__ == "__main__":
  unittest.main()
