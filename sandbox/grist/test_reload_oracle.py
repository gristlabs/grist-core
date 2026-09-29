"""
Reload oracle: a differential invariant for the data engine, and its tests.

The incremental engine maintains lookup indexes, reference reverse-maps, LookupSets and summary
key-maps as user actions are applied. A *fresh* engine loaded with only the stored (non-formula)
data recomputes all of those from scratch. The two must agree -- if they don't, the incremental
path has a staleness or index-desync bug (or, rarely, the reload path itself is wrong).

Like test_engine.py, this module doubles as a test utility: regression tests across the lookup
and summary suites use ReloadOracleMixin, and the randomized fuzzer (kept out of core, in
test/data-engine-fuzz/) is built on build_fresh_engine + compare_engines.

The tests here check the oracle itself: it must report no differences on known-correct scenarios
(no false positives).
"""

import actions
import engine as engine_module
import testutil
import test_engine
import useractions


def build_fresh_engine(inc_engine):
  """
  Build a new Engine from the *data-only* (non-formula) columns of the given incrementally-evolved
  engine, and bring it fully up to date -- mimicking what Grist does on doc-open (load stored
  data, then Calculate). All lookup/summary machinery is rebuilt from scratch.
  """
  fresh = engine_module.Engine()
  fresh.load_meta_tables(inc_engine.fetch_table('_grist_Tables', formulas=False),
                         inc_engine.fetch_table('_grist_Tables_column', formulas=False))
  for tid in inc_engine.tables:
    if tid not in ('_grist_Tables', '_grist_Tables_column'):
      fresh.load_table(inc_engine.fetch_table(tid, formulas=False, private=True))
  fresh.apply_user_actions([useractions.from_repr(['Calculate'])])
  return fresh


def _user_tables(eng):
  return sorted(tid for tid in eng.tables if not tid.startswith('_grist_'))


def compare_engines(inc_engine, fresh_engine):
  """
  Compare all user tables (full data, including formulas) between two engines. Returns a list of
  human-readable difference strings (empty if none). Rows are compared by id (preserved on reload
  for data and summary tables, since summary group-by columns are stored).
  """
  diffs = []
  inc_tables = set(_user_tables(inc_engine))
  fresh_tables = set(_user_tables(fresh_engine))
  if inc_tables != fresh_tables:
    diffs.append("table sets differ: inc=%s fresh=%s" % (sorted(inc_tables), sorted(fresh_tables)))

  for tid in sorted(inc_tables & fresh_tables):
    obs = actions.encode_objects(inc_engine.fetch_table(tid, formulas=True, private=True))
    exp = actions.encode_objects(fresh_engine.fetch_table(tid, formulas=True, private=True))
    if obs.row_ids != exp.row_ids:
      diffs.append("%s: row_ids differ:\n  inc=%s\n  fresh=%s" % (tid, obs.row_ids, exp.row_ids))
      continue
    for col_id in sorted(set(obs.columns) | set(exp.columns)):
      ov = obs.columns.get(col_id)
      ev = exp.columns.get(col_id)
      if ov != ev:
        for rid, a, b in zip(obs.row_ids, ov or [], ev or []):
          if a != b:
            diffs.append("%s.%s row %s: inc=%r  fresh=%r" % (tid, col_id, rid, a, b))
  return diffs


class ReloadOracleMixin:
  """Mixin for EngineTestCase-derived tests, adding the reload-consistency assertion."""

  def assert_reload_consistent(self, msg=""):
    fresh = build_fresh_engine(self.engine)
    diffs = compare_engines(self.engine, fresh)
    if diffs:
      self.fail("Incremental engine disagrees with a fresh reload%s:\n%s"
                % (" (%s)" % msg if msg else "", "\n".join(diffs)))

class TestReloadOracle(ReloadOracleMixin, test_engine.EngineTestCase):
  sample = testutil.parse_test_sample({
    "SCHEMA": [
      [1, "Students", [
        [1, "Name",       "Text",             False, "", "", ""],
        [2, "MainClass",  "Ref:Classes",      False, "", "", ""],
        [3, "AllClasses", "RefList:Classes",  False, "", "", ""],
        [4, "Score",      "Numeric",          False, "", "", ""],
      ]],
      [2, "Classes", [
        [10, "ClassName",   "Text", False, "", "", ""],
        [11, "MainStudents", "RefList:Students", True,
          "Students.lookupRecords(MainClass=$id)", "", ""],
        [12, "AllStudents", "RefList:Students", True,
          "Students.lookupRecords(AllClasses=CONTAINS($id))", "", ""],
        [13, "ByScore", "Any", True,
          "','.join(Students.lookupRecords(MainClass=$id, order_by='Score').Name)", "", ""],
        [14, "Total", "Any", True, "len(Students.all)", "", ""],
      ]],
    ],
    "DATA": {
      "Students": [
        ["id", "Name",  "MainClass", "AllClasses", "Score"],
        [1, "Alice", 2, [2, 1], 10], [2, "Bob", 1, [1], 20],
        [3, "Cindy", 1, [1, 2], 15], [4, "Doug", 2, [2], 5],
      ],
      "Classes": [["id", "ClassName"], [1, "Lit"], [2, "Sci"]],
    },
  })

  def setUp(self):
    super().setUp()
    self.load_sample(self.sample)

  def test_oracle_clean_on_correct_mutations(self):
    # A few ordinary mutations across Ref/RefList/all/sorted lookups. The oracle must stay silent
    # throughout; if it ever flags one of these, it is either a false positive (fix the oracle) or
    # a genuine bug.
    self.assert_reload_consistent("initial load")
    steps = [
      lambda: self.update_record("Students", 2, Name="TED"),
      lambda: self.update_record("Students", 3, MainClass=2),
      lambda: self.update_record("Students", 1, AllClasses=['L', 2]),
      lambda: self.update_record("Students", 4, Score=99),
      lambda: self.add_record("Students", Name="EVE", MainClass=2, AllClasses=[1, 2], Score=50),
      lambda: self.remove_record("Students", 1),
      lambda: self.update_record("Students", 3, MainClass=0),
      lambda: self.update_record("Students", 2, AllClasses=None),
      lambda: self.add_record("Classes", ClassName="Hist"),
      lambda: self.update_record("Students", 4, MainClass=3),
      lambda: self.remove_record("Classes", 1),
    ]
    for i, step in enumerate(steps):
      step()
      self.assert_reload_consistent("after step %d" % i)
