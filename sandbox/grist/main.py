"""
This module defines what sandbox functions are made available to the Node controller,
and starts the grist sandbox. See engine.py for the API documentation.
"""
import os
import random
import sys
sys.path.append('thirdparty')
# pylint: disable=wrong-import-position

import logging
import marshal
import functools

import six

import actions
import engine
import formula_prompt
import migrations
import schema
import useractions
import objtypes
from acl_formula import parse_acl_formula
from sandbox import get_default_sandbox
from imports.register import register_import_parsers

# Handler for logging, which flushes each message.
class FlushingStreamHandler(logging.StreamHandler):
  def emit(self, record):
    super(FlushingStreamHandler, self).emit(record)
    self.flush()

# Configure logging module to produce messages with log level and logger name.
logging.basicConfig(format="[%(levelname)s] [%(name)s] %(message)s",
    handlers=[FlushingStreamHandler(sys.stderr)],
    level=logging.INFO)

# The default level is INFO. If a different level is desired, add a call like this:
#   log.setLevel(logging.WARNING)
log = logging.getLogger(__name__)

def table_data_from_db(table_name, table_data_repr):
  if table_data_repr is None:
    return actions.TableData(table_name, [], {})
  table_data_parsed = marshal.loads(table_data_repr)
  table_data_parsed = {key.decode("utf8"): value for key, value in table_data_parsed.items()}
  id_col = table_data_parsed.pop("id")
  return actions.TableData(table_name, id_col,
                           actions.decode_bulk_values(table_data_parsed, _decode_db_value))

def _decode_db_value(value):
  # Decode database values received from SQLite's allMarshal() call. These are encoded by
  # marshalling certain types and storing as BLOBs (received in Python as binary strings, as
  # opposed to text which is received as unicode). See also encodeValue() in DocStorage.js
  t = type(value)
  if t == six.binary_type:
    return objtypes.decode_object(marshal.loads(value))
  else:
    return value

def run(sandbox):
  eng = engine.Engine()

  def export(method):
    # Wrap each method so that it logs a message that it's being called.
    @functools.wraps(method)
    def wrapper(*args, **kwargs):
      log.debug("calling %s", method.__name__)
      return method(*args, **kwargs)

    sandbox.register(method.__name__, wrapper)

  def load_and_record_table_data(table_name, table_data_repr):
    result = table_data_from_db(table_name, table_data_repr)
    eng.record_table_stats(result, table_data_repr)
    return result

  @export
  def apply_user_actions(action_reprs, user=None):
    action_group = eng.apply_user_actions([useractions.from_repr(u) for u in action_reprs], user)
    result = dict(
      rowCount=eng.count_rows(),
      **eng.acl_split(action_group).to_json_obj()
    )
    if action_group.requests:
      result["requests"] = action_group.requests
    return result

  @export
  def fetch_table(table_id, formulas=True, query=None):
    return actions.get_action_repr(eng.fetch_table(table_id, formulas=formulas, query=query))

  @export
  def fetch_table_schema():
    return eng.fetch_table_schema()

  @export
  def autocomplete(txt, table_id, column_id, row_id, user):
    return eng.autocomplete(txt, table_id, column_id, row_id, user)

  @export
  def find_col_from_values(values, n, opt_table_id):
    return eng.find_col_from_values(values, n, opt_table_id)

  @export
  def fetch_meta_tables(formulas=True):
    return {table_id: actions.get_action_repr(table_data)
            for (table_id, table_data) in six.iteritems(eng.fetch_meta_tables(formulas))}

  @export
  def load_meta_tables(meta_tables, meta_columns):
    return eng.load_meta_tables(load_and_record_table_data("_grist_Tables", meta_tables),
                                load_and_record_table_data("_grist_Tables_column", meta_columns))

  @export
  def load_table(table_name, table_data):
    return eng.load_table(load_and_record_table_data(table_name, table_data))

  @export
  def get_table_stats():
    return eng.get_table_stats()

  @export
  def create_migrations(all_tables, metadata_only=False):
    doc_actions = migrations.create_migrations(
      {t: table_data_from_db(t, data) for t, data in six.iteritems(all_tables)}, metadata_only)
    return [actions.get_action_repr(action) for action in doc_actions]

  @export
  def get_version():
    return schema.SCHEMA_VERSION

  @export
  def initialize(doc_url):
    if os.environ.get("DETERMINISTIC_MODE"):
      random.seed(1)
    else:
      # Make sure we have randomness, even if we are being cloned from a checkpoint
      random.seed()
    if doc_url:
      os.environ['DOC_URL'] = doc_url

  @export
  def get_formula_error(table_id, col_id, row_id):
    return objtypes.encode_object(eng.get_formula_error(table_id, col_id, row_id))

  @export
  def get_formula_prompt(table_id, col_id, description, include_all_tables=True, lookups=True):
    return formula_prompt.get_formula_prompt(eng, table_id, col_id, description,
                                             include_all_tables, lookups)

  @export
  def convert_formula_completion(completion):
    return formula_prompt.convert_completion(completion)

  @export
  def evaluate_formula(table_id, col_id, row_id):
    return formula_prompt.evaluate_formula(eng, table_id, col_id, row_id)

  export(parse_acl_formula)
  export(eng.load_empty)
  export(eng.load_done)

  register_import_parsers(sandbox)

  log.info("Ready")  # This log message is significant for checkpointing.
  sandbox.run()

def main():
  run(get_default_sandbox())

if __name__ == "__main__":
  main()
