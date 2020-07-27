"""
This module defines what sandbox functions are made available to the Node controller,
and starts the grist sandbox. See engine.py for the API documentation.
"""
import sys
sys.path.append('thirdparty')
# pylint: disable=wrong-import-position

import marshal
import functools

import actions
import sandbox
import engine
import migrations
import schema
import useractions
import objtypes

import logger
log = logger.Logger(__name__, logger.INFO)

def export(method):
  # Wrap each method so that it logs a message that it's being called.
  @functools.wraps(method)
  def wrapper(*args, **kwargs):
    log.debug("calling %s" % method.__name__)
    return method(*args, **kwargs)

  sandbox.register(method.__name__, wrapper)

def table_data_from_db(table_name, table_data_repr):
  if table_data_repr is None:
    return actions.TableData(table_name, [], {})
  table_data_parsed = marshal.loads(table_data_repr)
  id_col = table_data_parsed.pop("id")
  return actions.TableData(table_name, id_col,
                           actions.decode_bulk_values(table_data_parsed, _decode_db_value))

def _decode_db_value(value):
  # Decode database values received from SQLite's allMarshal() call. These are encoded by
  # marshalling certain types and storing as BLOBs (received in Python as binary strings, as
  # opposed to text which is received as unicode). See also encodeValue() in DocStorage.js

  # TODO For the moment, the sandbox uses binary strings throughout (with text in utf8 encoding).
  # We should switch to representing text with unicode instead. This requires care, at least in
  # fixing various occurrences of str() in our code, which may fail and which return wrong type.
  t = type(value)
  if t == unicode:
    return value.encode('utf8')
  elif t == str:
    return objtypes.decode_object(marshal.loads(value))
  else:
    return value

def main():
  eng = engine.Engine()

  @export
  def apply_user_actions(action_reprs):
    action_group = eng.apply_user_actions([useractions.from_repr(u) for u in action_reprs])
    return eng.acl_split(action_group).to_json_obj()

  @export
  def fetch_table(table_id, formulas=True, query=None):
    return actions.get_action_repr(eng.fetch_table(table_id, formulas=formulas, query=query))

  @export
  def fetch_table_schema():
    return eng.fetch_table_schema()

  @export
  def fetch_snapshot():
    action_group = eng.fetch_snapshot()
    return eng.acl_split(action_group).to_json_obj()

  @export
  def autocomplete(txt, table_id):
    return eng.autocomplete(txt, table_id)

  @export
  def find_col_from_values(values, n, opt_table_id):
    return eng.find_col_from_values(values, n, opt_table_id)

  @export
  def fetch_meta_tables(formulas=True):
    return {table_id: actions.get_action_repr(table_data)
            for (table_id, table_data) in eng.fetch_meta_tables(formulas).iteritems()}

  @export
  def load_meta_tables(meta_tables, meta_columns):
    return eng.load_meta_tables(table_data_from_db("_grist_Tables", meta_tables),
                                table_data_from_db("_grist_Tables_column", meta_columns))

  @export
  def load_table(table_name, table_data):
    return eng.load_table(table_data_from_db(table_name, table_data))

  @export
  def create_migrations(all_tables):
    doc_actions = migrations.create_migrations(
      {t: table_data_from_db(t, data) for t, data in all_tables.iteritems()})
    return map(actions.get_action_repr, doc_actions)

  @export
  def get_version():
    return schema.SCHEMA_VERSION

  @export
  def get_formula_error(table_id, col_id, row_id):
    return objtypes.encode_object(eng.get_formula_error(table_id, col_id, row_id))

  export(eng.load_empty)
  export(eng.load_done)

  sandbox.run()

if __name__ == "__main__":
  main()
