"""
Shared helpers for the data-engine memory benchmarks: mem_bench_summary.py (summary tables) and
mem_bench_lookup.py (lookups). Each builds a representative document and reports retained/peak
Python-heap memory via tracemalloc. Importing this module puts the parent directory (holding the
engine modules) on sys.path, so a benchmark can be run directly.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
# pylint: disable=wrong-import-position

import gc
import os
import tracemalloc

import engine
import testutil
import useractions


def load_engine(schema, data):
  """Build an Engine from a SCHEMA/DATA sample (see testutil.parse_test_sample) and run the
  initial Calculate, as Grist's ActiveDoc does when opening a document."""
  sample = testutil.parse_test_sample({"SCHEMA": schema, "DATA": data})
  eng = engine.Engine()
  eng.load_empty()
  meta = sample["SCHEMA"]
  eng.load_meta_tables(meta["_grist_Tables"], meta["_grist_Tables_column"])
  for table_data in sample["DATA"].values():
    eng.load_table(table_data)
  eng.apply_user_actions([useractions.from_repr(["Calculate"])])
  return eng


def report(label, n_rows, build_fn):
  """Run build_fn() (which returns an Engine) under tracemalloc and print retained/peak memory and
  the top allocation sites. Build any large input data BEFORE calling, so the report reflects the
  engine's own structures, not the input. tracemalloc counts Python allocations only; the numbers
  are most meaningful compared across branches -- the input is identical, so deltas isolate the
  structures being optimized."""
  gc.collect()
  tracemalloc.start(1)   # depth 1: we report only the top frame; deeper capture is slow at scale
  eng = build_fn()
  gc.collect()
  retained, peak = tracemalloc.get_traced_memory()
  snapshot = tracemalloc.take_snapshot()
  tracemalloc.stop()
  mb = 1024 * 1024
  print("%-16s rows=%-7d retained=%6.1f MB  peak=%6.1f MB  (%.0f bytes/row)"
        % (label, n_rows, retained / mb, peak / mb, retained / max(n_rows, 1)))
  for stat in snapshot.statistics("lineno")[:5]:
    frame = stat.traceback[0]
    print("    %6.1f MB  %s:%d" % (stat.size / mb, os.path.basename(frame.filename), frame.lineno))
  return retained
