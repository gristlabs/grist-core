"""
This module defines what sandbox functions are made available to the Node controller,
and starts the grist sandbox. See engine.py for the API documentation.
"""
import os
import random
import sys
import time

from timing import DummyTiming, Timing
sys.path.append('thirdparty')
# pylint: disable=wrong-import-position

import logging
import marshal
import functools

import actions
import engine
import formula_prompt
import migrations
import schema
import useractions
import objtypes
from predicate_formula import parse_predicate_formula
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
  if t is bytes:
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
            for (table_id, table_data) in eng.fetch_meta_tables(formulas).items()}

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
      {t: table_data_from_db(t, data) for t, data in all_tables.items()}, metadata_only)
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
  def get_formula_prompt(table_id, col_id, include_all_tables=True, lookups=True):
    return formula_prompt.get_formula_prompt(eng, table_id, col_id, include_all_tables, lookups)

  @export
  def convert_formula_completion(completion):
    return formula_prompt.convert_completion(completion)

  @export
  def evaluate_formula(table_id, col_id, row_id):
    return formula_prompt.evaluate_formula(eng, table_id, col_id, row_id)

  @export
  def start_timing():
    eng._timing = Timing()

  @export
  def stop_timing():
    stats = eng._timing.get()
    eng._timing = DummyTiming()
    return stats

  @export
  def get_timings():
    return eng._timing.get(False)

  # Echo input for testing
  @export
  def test_echo(msg):
    return msg

  # Throw an expection for testing
  @export
  def test_fail(msg):
    raise Exception(msg)

  # File read/write methods for testing
  @export
  def test_write_file(filename, contents):
    with open(filename, "a") as f:
      f.write(contents)

  @export
  def test_read_file(filename):
    with open(filename) as f:
      return f.read()

  @export
  def test_get_sandbox_root():
    return os.path.realpath(os.path.join(__file__, '..'))

  @export
  def test_list_files(path, include_files=True):
    paths = []
    for root, _, fnames in os.walk(path):
      paths.append(root)
      if include_files:
        for fname in sorted(fnames):
          paths.append(fname)
    return paths

  # Some sundry operations for tests only
  @export
  def test_operation(delay, operation, *inputs):
    if delay != 0:
      # We don't have time.sleep() available in the sandbox, so wait with a busy loop.
      end = time.time() + delay
      while time.time() < end:
        pass
    if operation == 'uppercase':
      return inputs[0].upper()
    if operation == 'triple':
      return inputs[0] * 3
    if operation == 'bigToSmall':
      return len(inputs[0])
    if operation == 'smallToBig':
      return '*' * inputs[0]
    raise Exception('unrecognized operation')

  @export
  def test_fork(nb):
    return [ os.fork() for _ in range(0, nb or 1) ]

  @export
  def test_tz_data():
    import moment   # pylint: disable=import-outside-toplevel
    return moment.read_tz_raw_data()

  export(parse_predicate_formula)
  export(eng.load_empty)
  export(eng.load_done)

  register_import_parsers(sandbox)

  log.info("Ready")  # This log message is significant for checkpointing.
  sandbox.run()

def main():
  run(get_default_sandbox())

if __name__ == "__main__":
  main()
