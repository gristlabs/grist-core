"""
Memory benchmark for the data engine, focused on the cost of summary tables (and the lookup
indexes they build). Builds a source table of N rows with several group-by summary tables and
reports retained/peak Python-heap memory via tracemalloc (see mem_bench_util).

Run from a grist checkout root, e.g.:
    sandbox_venv3/bin/python core/sandbox/grist/bench/mem_bench_summary.py            # default N, all summaries
    sandbox_venv3/bin/python core/sandbox/grist/bench/mem_bench_summary.py 100000 0   # baseline, no summaries
    sandbox_venv3/bin/python core/sandbox/grist/bench/mem_bench_summary.py 100000 4   # N rows, first 4 summaries

Run with summaries=0 vs N to size the summary cost on one checkout; run the same args on two
checkouts to measure what a branch saves.
"""
import sys
from mem_bench_util import load_engine, report
import useractions

# Source columns by metadata colref; distinct-value counts span coarse and fine grouping.
SCHEMA = [[1, "Source", [
  [11, "Cat", "Text", False, "", "Cat", ""],        # ~50 groups
  [12, "Sub", "Text", False, "", "Sub", ""],        # ~1000 groups
  [13, "Day", "Int", False, "", "Day", ""],         # ~365 groups
  [14, "Amount", "Numeric", False, "", "Amount", ""],
]]]

SUMMARIES = [[11], [11, 12], [13], [12]]   # group-by colrefs handed to CreateViewSection


def build_data(n_rows):
  cols = ["id", "Cat", "Sub", "Day", "Amount"]
  rows = [[i, "C%d" % (i % 50), "S%d" % (i % 1000), i % 365, float(i % 100)]
          for i in range(1, n_rows + 1)]
  return {"Source": [cols] + rows}


def build_engine(data, n_summaries):
  eng = load_engine(SCHEMA, data)
  for groupby in SUMMARIES[:n_summaries]:
    eng.apply_user_actions(
      [useractions.from_repr(["CreateViewSection", 1, 0, "record", groupby, None])])
  return eng


def main():
  n_rows = int(sys.argv[1]) if len(sys.argv) > 1 else 100000
  n_summaries = int(sys.argv[2]) if len(sys.argv) > 2 else len(SUMMARIES)
  data = build_data(n_rows)        # build input before measuring
  report("summaries=%d" % n_summaries, n_rows, lambda: build_engine(data, n_summaries))


if __name__ == "__main__":
  main()
