"""
Memory benchmark for the data-engine lookup machinery, exercising the lookup kinds optimized on
this branch: reverse-reference lookups, the 'all'-records lookup, sorted lookups, and many small
lookup sets. Builds a document driving one such lookup pattern over N rows and reports memory via
tracemalloc (see mem_bench_util). Run the same scenario+N on two checkouts to measure savings.

Run from a grist checkout root:
    sandbox_venv3/bin/python core/sandbox/grist/bench/mem_bench_lookup.py [scenario] [n_rows]
    scenario in {revref, all, sorted, manysmall}; default runs all. n_rows default 50000.
"""
import sys
from mem_bench_util import load_engine, report


def revref(n):
  # Each Child references one of ~n/10 Parents; each Parent computes the reverse lookup, keyed by
  # a Ref column -- the reverse-reference optimization.
  n_parents = max(1, n // 10)
  schema = [
    [1, "Parent", [
      [11, "kids", "RefList:Child", True, "Child.lookupRecords(parent=$id)", "", ""],
    ]],
    [2, "Child", [
      [21, "parent", "Ref:Parent", False, "", "", ""],
    ]],
  ]
  data = {
    "Parent": [["id"]] + [[i] for i in range(1, n_parents + 1)],
    "Child": [["id", "parent"]] + [[i, (i % n_parents) + 1] for i in range(1, n + 1)],
  }
  return schema, data


def all_records(n):
  # Every row looks up all records (no key) -- the 'all'-lookup optimization.
  schema = [[1, "T", [
    [11, "val", "Int", False, "", "", ""],
    [12, "cnt", "Int", True, "len(T.lookupRecords())", "", ""],
  ]]]
  data = {"T": [["id", "val"]] + [[i, i % 100] for i in range(1, n + 1)]}
  return schema, data


def sorted_lookup(n):
  # Each row finds its successor within a group, ordered by a column -- a sorted lookup (and its
  # cached sorted result).
  n_groups = max(1, n // 50)
  schema = [[1, "T", [
    [11, "grp", "Int", False, "", "", ""],
    [12, "sortv", "Int", False, "", "", ""],
    [13, "nxt", "Ref:T", True, "NEXT(rec, group_by='grp', order_by='sortv')", "", ""],
  ]]]
  data = {"T": [["id", "grp", "sortv"]] + [[i, i % n_groups, (i * 7) % n] for i in range(1, n + 1)]}
  return schema, data


def manysmall(n):
  # A high-cardinality key yields many tiny LookupSets (~3 rows each) -- the small-LookupSet
  # memory optimization.
  n_keys = max(1, n // 3)
  schema = [[1, "T", [
    [11, "key", "Int", False, "", "", ""],
    [12, "peers", "RefList:T", True, "T.lookupRecords(key=$key)", "", ""],
  ]]]
  data = {"T": [["id", "key"]] + [[i, i % n_keys] for i in range(1, n + 1)]}
  return schema, data


SCENARIOS = {"revref": revref, "all": all_records, "sorted": sorted_lookup, "manysmall": manysmall}


def main():
  args = sys.argv[1:]
  chosen = [a for a in args if a in SCENARIOS] or list(SCENARIOS)
  nums = [int(a) for a in args if a.isdigit()]
  n_rows = nums[0] if nums else 50000
  for name in chosen:
    schema, data = SCENARIOS[name](n_rows)        # build input before measuring
    report(name, n_rows, lambda s=schema, d=data: load_engine(s, d))


if __name__ == "__main__":
  main()
