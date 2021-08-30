import copy
import time
import logger
import objtypes
import testutil
import test_engine
from schema import RecalcWhen

# pylint: disable=line-too-long

log = logger.Logger(__name__, logger.INFO)

attr_error = objtypes.RaisedException(AttributeError())

class TestTriggerFormulas(test_engine.EngineTestCase):
  col = testutil.col_schema_row
  sample_desc = {
    "SCHEMA": [
      [1, "Creatures", [
        col(1, "Name",       "Text",       False),
        col(2, "Ocean",      "Ref:Oceans", False),
        col(3, "OceanName",  "Text",       True,  "$Ocean.Name"),
        col(4, "BossDef",    "Text",       False, "$Ocean.Head"),
        col(5, "BossNvr",    "Text",       False, "$Ocean.Head", recalcWhen=RecalcWhen.NEVER),
        col(6, "BossUpd",    "Text",       False, "$Ocean.Head", recalcDeps=[2]),
        col(7, "BossAll",    "Text",       False, "$Ocean.Head", recalcWhen=RecalcWhen.MANUAL_UPDATES),
      ]],
      [2, "Oceans", [
        col(11, "Name",     "Text",        False),
        col(12, "Head",     "Text",        False)
      ]],
    ],
    "DATA": {
      "Creatures": [
        ["id","Name",    "Ocean", "BossDef", "BossNvr", "BossUpd", "BossAll"],
        [1,   "Dolphin", 2,       "Arthur",  "Arthur",  "Arthur",  "Arthur"],
      ],
      "Oceans": [
        ["id",  "Name",     "Head"],
        [1,     "Pacific",    "Watatsumi"],
        [2,     "Atlantic",   "Poseidon"],
        [3,     "Indian",     "Neptune"],
        [4,     "Arctic",     "Poseidon"],
      ],
    }
  }
  sample = testutil.parse_test_sample(sample_desc)

  def test_no_recalc_on_load(self):
    # Trigger formulas don't affect data that's loaded.
    self.load_sample(self.sample)
    self.assertTableData("Creatures", data=[
      ["id","Name",    "Ocean", "BossDef", "BossNvr", "BossUpd", "BossAll", "OceanName"],
      [1,   "Dolphin", 2,       "Arthur",  "Arthur",  "Arthur",  "Arthur",  "Atlantic" ],
    ])

  def test_recalc_on_new_records(self):
    # Trigger formulas affect new records.
    self.load_sample(self.sample)
    self.add_record("Creatures", Name="Shark", Ocean=2)
    self.add_record("Creatures", Name="Squid", Ocean=1)

    # Check that BossNvr ("never") wasn't affected by the default formula, but the rest were.
    self.assertTableData("Creatures", data=[
      ["id","Name",    "Ocean", "BossDef",   "BossNvr", "BossUpd",   "BossAll",   "OceanName"],
      [1,   "Dolphin", 2,       "Arthur",    "Arthur",  "Arthur",    "Arthur",    "Atlantic" ],
      [2,   "Shark",   2,       "Poseidon",  "",        "Poseidon",  "Poseidon",  "Atlantic" ],
      [3,   "Squid",   1,       "Watatsumi", "",        "Watatsumi", "Watatsumi", "Pacific"  ],
    ])

  def test_no_recalc_on_noop_change(self):
    # A no-op change shouldn't trigger any updates.
    self.load_sample(self.sample)
    self.update_record("Creatures", 1, Ocean=2)
    self.assertTableData("Creatures", data=[
      ["id","Name",    "Ocean", "BossDef", "BossNvr", "BossUpd", "BossAll", "OceanName"],
      [1,   "Dolphin", 2,       "Arthur",  "Arthur",  "Arthur",  "Arthur",  "Atlantic" ],
    ])

  def test_recalc_on_update(self):
    # Changes should trigger recalc of certain trigger formulas.
    self.load_sample(self.sample)
    self.add_record("Creatures", Name="Shark", Ocean=2)
    self.add_record("Creatures", Name="Squid", Ocean=1)
    self.assertTableData("Creatures", data=[
      ["id","Name",    "Ocean", "BossDef",   "BossNvr", "BossUpd",   "BossAll",   "OceanName"],
      [1,   "Dolphin", 2,       "Arthur",    "Arthur",  "Arthur",    "Arthur",    "Atlantic" ],
      [2,   "Shark",   2,       "Poseidon",  "",        "Poseidon",  "Poseidon",  "Atlantic" ],
      [3,   "Squid",   1,       "Watatsumi", "",        "Watatsumi", "Watatsumi", "Pacific"  ],
    ])
    self.update_records("Creatures", ["id", "Ocean"], [
      [1, 3],   # Ocean for 1: Atlantic -> Indian
      [3, 4],   # Ocean for 3: Pacific -> Arctic
    ])
    # Only BossUpd and BossAll columns should be affected, not BossDef or BossNvr
    self.assertTableData("Creatures", data=[
      ["id","Name",    "Ocean", "BossDef",   "BossNvr", "BossUpd",   "BossAll",   "OceanName"],
      [1,   "Dolphin", 3,       "Arthur",    "Arthur",  "Neptune",   "Neptune",    "Indian"  ],
      [2,   "Shark",   2,       "Poseidon",  "",        "Poseidon",  "Poseidon",   "Atlantic"],
      [3,   "Squid",   4,       "Watatsumi", "",        "Poseidon",  "Poseidon",   "Arctic"  ],
    ])

  def test_recalc_with_direct_update(self):
    # Check that an update that changes both a dependency and the trigger-formula column itself
    # respects the latter value.
    self.load_sample(self.sample)

    out_actions = self.update_record("Creatures", 1, Ocean=3, BossUpd="Bob")
    self.assertTableData("Creatures", rows="subset", data=[
      ["id","Name",    "Ocean", "BossDef",   "BossNvr", "BossUpd",   "BossAll",   "OceanName"],
      [1,   "Dolphin", 3,       "Arthur",    "Arthur",  "Bob",       "Neptune",    "Indian"  ],
    ])
    # Check that the needed recalcs are the only ones that happened.
    self.assertPartialOutActions(out_actions, {
      "calls": {"Creatures": {"BossAll": 1, "OceanName": 1}}
    })

    out_actions = self.update_record("Creatures", 1, Ocean=4, BossUpd="", BossAll="Chuck")
    self.assertTableData("Creatures", rows="subset", data=[
      ["id","Name",    "Ocean", "BossDef",   "BossNvr", "BossUpd",   "BossAll",   "OceanName"],
      [1,   "Dolphin", 4,       "Arthur",    "Arthur",  "",          "Chuck",     "Arctic"  ],
    ])
    # Check that the needed recalcs are the only ones that happened.
    self.assertPartialOutActions(out_actions, {
      "calls": {"Creatures": {"OceanName": 1}}
    })

  def test_no_recalc_on_reopen(self):
    # Change that a reopen does not recalc at all.

    # Load a sample with a few more rows. Only the one true formula should be calculated
    sample_desc = copy.deepcopy(self.sample_desc)
    sample_desc["DATA"]["Creatures"] = [
      ["id","Name",    "Ocean", "BossDef",  "BossNvr", "BossUpd",  "BossAll" ],
      [1,   "Dolphin", 2,       "Arthur",   "Arthur",  "Arthur",   "Arthur"  ],
      [2,   "Shark",   2,       "",  "",               "Poseidon", "Poseidon"],
      [3,   "Squid",   4,       "Watatsumi", "",       "Poseidon", ""        ],
    ]
    sample = testutil.parse_test_sample(sample_desc)

    self.assertEqual(self.call_counts, {})
    self.load_sample(sample)
    self.assertEqual(self.call_counts, {'Creatures': {'OceanName': 3}})


  def test_recalc_undo(self):
    self.load_sample(self.sample)
    data0 = [
      ["id","Name",    "Ocean", "BossDef", "BossNvr", "BossUpd", "BossAll", "OceanName"],
      [1,   "Dolphin", 2,       "Arthur",  "Arthur",  "Arthur",  "Arthur",  "Atlantic" ],
    ]
    self.assertTableData("Creatures", data=data0)

    # Plain update
    out_actions1 = self.update_record("Creatures", 1, Ocean=1)
    data1 = [
      ["id","Name",    "Ocean", "BossDef",   "BossNvr", "BossUpd",   "BossAll",   "OceanName"],
      [1,   "Dolphin", 1,       "Arthur",    "Arthur",  "Watatsumi", "Watatsumi", "Pacific"  ],
    ]
    self.assertTableData("Creatures", data=data1)
    self.assertEqual(out_actions1.calls, {"Creatures": {"BossUpd": 1, "BossAll": 1, "OceanName": 1}})

    # Update with a manual update to one of the trigger columns
    out_actions2 = self.update_record("Creatures", 1, Ocean=3, BossUpd="Bob")
    data2 = [
      ["id","Name",    "Ocean", "BossDef",   "BossNvr", "BossUpd",   "BossAll",   "OceanName"],
      [1,   "Dolphin", 3,       "Arthur",    "Arthur",  "Bob",       "Neptune",   "Indian"  ],
    ]
    self.assertTableData("Creatures", rows="subset", data=data2)
    self.assertEqual(out_actions2.calls, {"Creatures": {"BossAll": 1, "OceanName": 1}})

    # Undo, one at a time. It should not cause recalc of trigger columns, because an undo sets
    # those explicitly.
    out_actions2_undo = self.apply_undo_actions(out_actions2.undo)
    self.assertTableData("Creatures", data=data1)
    self.assertEqual(out_actions2_undo.calls, {"Creatures": {"OceanName": 1}})

    out_actions1_undo = self.apply_undo_actions(out_actions1.undo)
    self.assertTableData("Creatures", data=data0)
    self.assertEqual(out_actions1_undo.calls, {"Creatures": {"OceanName": 1}})


  def test_recalc_triggers(self):
    # A trigger that depends on some columns should not be triggered by other ones.
    self.load_sample(self.sample)

    # BossUpd and BossAll both depend on the "Ocean" column, so both get updated.
    out_actions = self.update_record("Creatures", 1, Ocean=3)
    self.assertTableData("Creatures", data=[
      ["id","Name",    "Ocean", "BossDef", "BossNvr", "BossUpd", "BossAll", "OceanName"],
      [1,   "Dolphin", 3,       "Arthur",  "Arthur",  "Neptune", "Neptune", "Indian" ],
    ])
    self.assertEqual(out_actions.calls, {"Creatures": {"BossUpd": 1, "BossAll": 1, "OceanName": 1}})

    # Undo, then check that a change that doesn't touch Ocean only triggers BossAll recalc.
    self.apply_undo_actions(out_actions.undo)
    out_actions = self.update_record("Creatures", 1, Name="Whale")
    self.assertTableData("Creatures", data=[
      ["id","Name",  "Ocean", "BossDef", "BossNvr", "BossUpd", "BossAll",  "OceanName"],
      [1,   "Whale", 2,       "Arthur",  "Arthur",  "Arthur",  "Poseidon", "Atlantic" ],
    ])
    self.assertEqual(out_actions.calls, {"Creatures": {"BossAll": 1}})


  def test_recalc_trigger_changes(self):
    # After changing a trigger formula dependencies, changes to the old dependency should no
    # longer cause a recalc.
    self.load_sample(self.sample)

    # Change column BossUpd to depend on column Name rather than on column Ocean.
    self.update_record("_grist_Tables_column", 6, recalcDeps=['L', 1])

    # Make a change to Ocean. It should not cause an update to BossUpd, only BossAll.
    out_actions = self.update_record("Creatures", 1, Ocean=3)
    self.assertTableData("Creatures", data=[
      ["id","Name",    "Ocean", "BossDef", "BossNvr", "BossUpd", "BossAll", "OceanName"],
      [1,   "Dolphin", 3,       "Arthur",  "Arthur",  "Arthur",  "Neptune", "Indian" ],
    ])
    self.assertEqual(out_actions.calls, {"Creatures": {"BossAll": 1, "OceanName": 1}})

    # But changes to the new dependency should trigger recalc.
    out_actions = self.update_record("Creatures", 1, Name="Whale")
    self.assertTableData("Creatures", data=[
      ["id","Name",  "Ocean", "BossDef", "BossNvr", "BossUpd", "BossAll", "OceanName"],
      [1,   "Whale", 3,       "Arthur",  "Arthur",  "Neptune", "Neptune", "Indian" ],
    ])
    self.assertEqual(out_actions.calls, {"Creatures": {"BossUpd": 1, "BossAll": 1}})

    # If dependencies are changed to empty, only new records should cause BossUpd recalc.
    self.update_record("_grist_Tables_column", 6, recalcDeps=['L'])
    out_actions = self.update_record("Creatures", 1, Name="Porpoise", Ocean=2)
    self.assertTableData("Creatures", data=[
      ["id","Name",     "Ocean", "BossDef", "BossNvr", "BossUpd", "BossAll",  "OceanName"],
      [1,   "Porpoise", 2,       "Arthur",  "Arthur",  "Neptune", "Poseidon", "Atlantic" ],
    ])
    self.assertEqual(out_actions.calls, {"Creatures": {"BossAll": 1, "OceanName": 1}})

    out_actions = self.add_record("Creatures", None, Name="Manatee", Ocean=2)
    self.assertTableData("Creatures", data=[
      ["id","Name",     "Ocean", "BossDef", "BossNvr", "BossUpd",  "BossAll",  "OceanName"],
      [1,   "Porpoise", 2,       "Arthur",  "Arthur",  "Neptune",  "Poseidon", "Atlantic" ],
      [2,   "Manatee",  2,       "Poseidon", "",       "Poseidon", "Poseidon", "Atlantic" ],
    ])
    self.assertEqual(out_actions.calls,
        {"Creatures": {"BossDef": 1, "BossUpd": 1, "BossAll": 1, "OceanName": 1}})


  def test_recalc_trigger_off(self):
    # Change BossUpd dependency to never, and check that neither changes nor new records cause
    # recalc.
    self.load_sample(self.sample)
    self.update_record("_grist_Tables_column", 6, recalcWhen=RecalcWhen.NEVER)

    # Check a change
    out_actions = self.update_record("Creatures", 1, Name="Whale", Ocean=3)
    self.assertTableData("Creatures", data=[
      ["id","Name",  "Ocean", "BossDef", "BossNvr", "BossUpd", "BossAll", "OceanName"],
      [1,   "Whale", 3,       "Arthur",  "Arthur",  "Arthur",  "Neptune", "Indian" ],
    ])
    self.assertEqual(out_actions.calls, {"Creatures": {"BossAll": 1, "OceanName": 1}})

    # Check a new record -- doesn't affect BossUpd any more.
    out_actions = self.add_record("Creatures", None, Name="Manatee", Ocean=2)
    self.assertTableData("Creatures", data=[
      ["id","Name",     "Ocean", "BossDef", "BossNvr", "BossUpd", "BossAll",  "OceanName"],
      [1,   "Whale",    3,       "Arthur",  "Arthur",  "Arthur",  "Neptune",  "Indian" ],
      [2,   "Manatee",  2,       "Poseidon", "",       "",        "Poseidon", "Atlantic" ],
    ])
    self.assertEqual(out_actions.calls,
        {"Creatures": {"BossDef": 1, "BossAll": 1, "OceanName": 1}})


  def test_renames(self):
    # After renaming tables or columns, trigger formulas should still be triggered the same way.
    self.load_sample(self.sample)

    # Do some renamings: they shouldn't trigger updates to trigger formulas.
    self.apply_user_action(["RenameColumn", "Creatures", "Ocean", "Sea"])
    self.assertTableData("Creatures", data=[
      ["id","Name",    "Sea", "BossDef", "BossNvr", "BossUpd", "BossAll", "OceanName"],
      [1,   "Dolphin", 2,     "Arthur",  "Arthur",  "Arthur",  "Arthur",  "Atlantic" ],
    ])

    self.apply_user_action(["RenameColumn", "Creatures", "BossUpd", "foo"])
    self.assertTableData("Creatures", data=[
      ["id","Name",    "Sea", "BossDef", "BossNvr", "foo",     "BossAll", "OceanName"],
      [1,   "Dolphin", 2,     "Arthur",  "Arthur",  "Arthur",  "Arthur",  "Atlantic" ],
    ])

    self.apply_user_action(["RenameTable", "Creatures", "Critters"])
    self.assertTableData("Critters", data=[
      ["id","Name",    "Sea", "BossDef", "BossNvr", "foo",     "BossAll", "OceanName"],
      [1,   "Dolphin", 2,     "Arthur",  "Arthur",  "Arthur",  "Arthur",  "Atlantic" ],
    ])

    self.apply_user_action(["RenameColumn", "Critters", "BossAll", "bar"])
    self.assertTableData("Critters", data=[
      ["id","Name",    "Sea", "BossDef", "BossNvr", "foo",     "bar",     "OceanName"],
      [1,   "Dolphin", 2,     "Arthur",  "Arthur",  "Arthur",  "Arthur",  "Atlantic" ],
    ])

    # After renames, correct trigger formulas continue getting triggered.
    out_actions = self.update_record("Critters", 1, Sea=3)
    self.assertTableData("Critters", data=[
      ["id","Name",    "Sea",   "BossDef", "BossNvr", "foo",     "bar",     "OceanName"],
      [1,   "Dolphin", 3,       "Arthur",  "Arthur",  "Neptune", "Neptune", "Indian" ],
    ])
    self.assertEqual(out_actions.calls, {"Critters": {"foo": 1, "bar": 1, "OceanName": 1}})

    # After renames, changes shouldn't trigger unnecessary recalcs (foo, formerly BossUpd, should
    # not be triggered by a change to Name).
    out_actions = self.update_record("Critters", 1, Name="Whale")
    self.assertTableData("Critters", data=[
      ["id","Name",  "Sea",   "BossDef", "BossNvr", "foo",      "bar",     "OceanName"],
      [1,   "Whale", 3,       "Arthur",  "Arthur",  "Neptune",  "Neptune", "Indian" ],
    ])
    self.assertEqual(out_actions.calls, {"Critters": {"bar": 1}})


  def test_schema_changes(self):
    # Schema changes like add/modify column should not cause trigger-formulas to recalculate.
    self.load_sample(self.sample)

    # Adding a column doesn't trigger recalcs.
    out_actions = self.apply_user_action(["AddColumn", "Creatures", "Size", {"type": "Text", "isFormula": False}])
    self.assertTableData("Creatures", data=[
      ["id","Name",    "Ocean", "BossDef", "BossNvr", "BossUpd", "BossAll", "OceanName", "Size"],
      [1,   "Dolphin", 2,       "Arthur",  "Arthur",  "Arthur",  "Arthur",  "Atlantic",  ""],
    ])
    self.assertEqual(out_actions.calls, {})

    # Only BossAll should recalc since the record changed.
    out_actions = self.update_record("Creatures", 1, Size="Big")
    self.assertTableData("Creatures", data=[
      ["id","Name",    "Ocean", "BossDef", "BossNvr", "BossUpd", "BossAll",  "OceanName", "Size"],
      [1,   "Dolphin", 2,       "Arthur",  "Arthur",  "Arthur",  "Poseidon", "Atlantic",  "Big"],
    ])
    self.assertEqual(out_actions.calls, {"Creatures": {"BossAll": 1}})

    # New records trigger recalc as usual.
    out_actions = self.add_record("Creatures", None, Name="Manatee", Ocean=2)
    self.assertTableData("Creatures", data=[
      ["id","Name",    "Ocean", "BossDef",  "BossNvr", "BossUpd",  "BossAll",  "OceanName", "Size"],
      [1,   "Dolphin", 2,       "Arthur",   "Arthur",  "Arthur",   "Poseidon", "Atlantic",  "Big"],
      [2,   "Manatee", 2,       "Poseidon", "",        "Poseidon", "Poseidon", "Atlantic",  ""],
    ])

    # ModifyColumn doesn't trigger recalcs.
    out_actions = self.apply_user_action(["ModifyColumn", "Creatures", "Size", {type: 'Numeric'}])
    self.assertEqual(out_actions.calls, {})


  def test_changing_trigger_formula(self):
    self.load_sample(self.sample)

    # Modifying trigger formula doesn't trigger recalc.
    out_actions = self.apply_user_action(["ModifyColumn", "Creatures", "BossAll", {"formula": 'UPPER($Ocean.Head)'}])
    self.assertEqual(out_actions.calls, {})

    # But when it runs, recalc uses the new formula.
    out_actions = self.update_record("Creatures", 1, Name="Whale")
    self.assertTableData("Creatures", data=[
      ["id","Name",  "Ocean", "BossDef", "BossNvr", "BossUpd", "BossAll",  "OceanName"],
      [1,   "Whale", 2,       "Arthur",  "Arthur",  "Arthur",  "POSEIDON", "Atlantic" ],
    ])


  def test_remove_dependency(self):
    # Remove a dependency column, and check that recalcDeps list is updated.
    self.load_sample(self.sample)

    def get_recalc_deps(col_ref):
      data = self.engine.fetch_table('_grist_Tables_column', col_ref, query={'id': [col_ref]})
      return data.columns['recalcDeps'][0]

    self.assertEqual(get_recalc_deps(6), [2])

    # Add another dependency, so that we can test partial removal.
    self.update_record("_grist_Tables_column", 6, recalcDeps=['L', 2, 3])
    self.assertEqual(get_recalc_deps(6), [2, 3])

    # Remove a column that it's a Dependency of BossUpd
    self.apply_user_action(["RemoveColumn", "Creatures", "Ocean"])
    self.assertEqual(get_recalc_deps(6), [3])
    self.apply_user_action(["RemoveColumn", "Creatures", "OceanName"])
    self.assertEqual(get_recalc_deps(6), None)

    # None of these operations should have changed trigger-formula columns.
    self.assertTableData("Creatures", data=[
      ["id","Name",    "BossDef", "BossNvr", "BossUpd", "BossAll"],
      [1,   "Dolphin", "Arthur",  "Arthur",  "Arthur",  "Arthur" ],
    ])

    # Check that it still responds to suitable triggers.
    # Make a change to some other column. BossUpd doesn't get updated.
    out_actions = self.update_record("Creatures", 1, Name="Whale")
    self.assertTableData("Creatures", data=[
      ["id","Name",  "BossDef", "BossNvr", "BossUpd", "BossAll" ],
      [1,   "Whale", "Arthur",  "Arthur",  "Arthur",  attr_error],
    ])

    # Add a record. BossUpd's formula still runs, though with an error.
    out_actions = self.add_record("Creatures", None, Name="Manatee")
    self.assertTableData("Creatures", data=[
      ["id","Name",    "BossDef",  "BossNvr", "BossUpd",  "BossAll" ],
      [1,   "Whale",   "Arthur",   "Arthur",  "Arthur",   attr_error],
      [2,   "Manatee", attr_error, "",        attr_error, attr_error],
    ])


  def test_no_trigger_by_formulas(self):
    # A column that depends on any record update ("allupdates") should not be affected by formula
    # recalculations.
    self.load_sample(self.sample)

    # Name of Ocean affects a formula column; Head affects calculation; neither triggers recalc.
    self.update_record('Oceans', 2, Head="POSEIDON", Name="ATLANTIC")
    self.assertTableData("Creatures", data=[
      ["id","Name",    "Ocean", "BossDef", "BossNvr", "BossUpd", "BossAll", "OceanName"],
      [1,   "Dolphin", 2,       "Arthur",  "Arthur",  "Arthur",  "Arthur",  "ATLANTIC" ],
    ])
    self.add_record("Creatures", None, Name="Manatee", Ocean=2)
    self.assertTableData("Creatures", data=[
      ["id","Name",    "Ocean", "BossDef", "BossNvr", "BossUpd", "BossAll", "OceanName"],
      [1,   "Dolphin", 2,       "Arthur",  "Arthur",  "Arthur",  "Arthur",  "ATLANTIC" ],
      [2,   "Manatee", 2,       "POSEIDON",  "",  "POSEIDON",  "POSEIDON",  "ATLANTIC" ],
    ])

    # On the other hand, an explicit dependency on a formula column WILL be triggered.
    self.update_record("_grist_Tables_column", 6, recalcDeps=['L', 2, 3])
    self.update_record('Oceans', 2, Name="atlantic")

    self.assertTableData("Creatures", data=[
      ["id","Name",    "Ocean", "BossDef", "BossNvr", "BossUpd", "BossAll",    "OceanName"],
      [1,   "Dolphin", 2,       "Arthur",  "Arthur",  "POSEIDON",  "Arthur",   "atlantic" ],
      [2,   "Manatee", 2,       "POSEIDON",  "",      "POSEIDON",  "POSEIDON", "atlantic" ],
    ])


  def test_no_auto_dependencies(self):
    # Evaluating a trigger formula should not create dependencies on cells used during
    # evaluation.
    self.load_sample(self.sample)
    self.update_record("Creatures", 1, Ocean=3)
    self.assertTableData("Creatures", data=[
      ["id","Name",    "Ocean", "BossDef",   "BossNvr", "BossUpd",   "BossAll", "OceanName"],
      [1,   "Dolphin", 3,       "Arthur",    "Arthur",  "Neptune",   "Neptune", "Indian"  ],
    ])
    # Update a value that trigger-cells used during calculation; it should not cause a recalc.
    self.update_record('Oceans', 3, Head="NEPTUNE")
    self.assertTableData("Creatures", data=[
      ["id","Name",    "Ocean", "BossDef",   "BossNvr", "BossUpd",   "BossAll", "OceanName"],
      [1,   "Dolphin", 3,       "Arthur",    "Arthur",  "Neptune",   "Neptune", "Indian"  ],
    ])


  def test_self_trigger(self):
    # A trigger formula may be triggered by changes to the column itself.
    # Check that it gets recalculated.
    sample_desc = copy.deepcopy(self.sample_desc)
    creatures_table = sample_desc["SCHEMA"][0]
    creatures_columns = creatures_table[-1]

    # Set BossUpd column to depend on Ocean and itself.
    # Append something to ensure we are testing a case without a fixed point, to ensure
    # that doesn't cause an infinite update loop.
    self.assertEqual(creatures_columns[5][1], "BossUpd")
    creatures_columns[5] = testutil.col_schema_row(
      6, "BossUpd", "Text", False, "UPPER(value or $Ocean.Head) + '+'", recalcDeps=[2, 6]
    )

    # Previously there was a bug that meant that columns involved in lookups
    # did not recalculate their trigger formulas after changes to themselves
    creatures_columns.append(testutil.col_schema_row(
      21, "Lookup", "Any", True, "Creatures.lookupRecords(BossUpd='')"
    ))

    sample = testutil.parse_test_sample(sample_desc)
    self.load_sample(sample)

    self.assertTableData("Creatures", cols="subset", data=[
      ["id","Name",    "Ocean", "BossDef",   "BossNvr", "BossUpd",  "BossAll", "OceanName"],
      [1,   "Dolphin", 2,       "Arthur",    "Arthur",  "Arthur",   "Arthur",  "Atlantic"  ],
    ])

    self.update_record('Creatures', 1, Ocean=3)
    self.assertTableData("Creatures", cols="subset", data=[
      ["id","Name",    "Ocean", "BossDef",   "BossNvr", "BossUpd",  "BossAll", "OceanName"],
      [1,   "Dolphin", 3,       "Arthur",    "Arthur",  "ARTHUR+",   "Neptune", "Indian"  ],
    ])
    self.update_record('Creatures', 1, BossUpd="None")
    self.assertTableData("Creatures", cols="subset", data=[
      ["id","Name",    "Ocean", "BossDef",   "BossNvr", "BossUpd",  "BossAll", "OceanName"],
      [1,   "Dolphin", 3,       "Arthur",    "Arthur",  "NONE+",     "Neptune", "Indian"  ],
    ])
    self.update_record('Creatures', 1, BossUpd="")
    self.assertTableData("Creatures", cols="subset", data=[
      ["id","Name",    "Ocean", "BossDef",   "BossNvr", "BossUpd",  "BossAll", "OceanName"],
      [1,   "Dolphin", 3,       "Arthur",    "Arthur",  "NEPTUNE+",  "Neptune", "Indian"  ],
    ])

  def test_last_update_recipe(self):
    # Use a formula to store time of last-update. Check that it works as expected.
    # Check that times don't update on reload.
    self.load_sample(self.sample)
    self.add_column('Creatures', 'LastChange',
      type='DateTime:UTC', isFormula=False, formula="NOW()", recalcWhen=RecalcWhen.MANUAL_UPDATES)

    # To compare times, use actual times after checking approximately.
    now = time.time()
    self.assertTableData("Creatures", data=[
      ["id","Name",    "Ocean", "BossDef",   "BossNvr", "BossUpd", "BossAll", "OceanName", "LastChange"],
      [1,   "Dolphin", 2,       "Arthur",    "Arthur",  "Arthur",  "Arthur",  "Atlantic",  None],
    ])

    self.add_record("Creatures", None, Name="Manatee", Ocean=2)
    self.update_record("Creatures", 1, Ocean=3)

    now = time.time()
    [time1, time2] = self.engine.fetch_table('Creatures').columns['LastChange']
    self.assertTableData("Creatures", data=[
      ["id","Name",    "Ocean", "BossDef",   "BossNvr", "BossUpd",  "BossAll",  "OceanName", "LastChange"],
      [1,   "Dolphin", 3,       "Arthur",    "Arthur",  "Neptune",  "Neptune",  "Indian",    time1],
      [2,   "Manatee", 2,       "Poseidon",  "",        "Poseidon", "Poseidon", "Atlantic",  time2],
    ])
    self.assertLessEqual(abs(time1 - now), 1)
    self.assertLessEqual(abs(time2 - now), 1)

    # An indirect change doesn't affect the time, but a direct change does.
    self.update_record("Oceans", 2, Name="ATLANTIC")
    self.update_record("Creatures", 1, Name="Whale")
    [time3, time4] = self.engine.fetch_table('Creatures').columns['LastChange']
    self.assertGreater(time3, time1)
    self.assertEqual(time4, time2)
    self.assertTableData("Creatures", data=[
      ["id","Name",    "Ocean", "BossDef",   "BossNvr", "BossUpd",  "BossAll",  "OceanName", "LastChange"],
      [1,   "Whale",   3,       "Arthur",    "Arthur",  "Neptune",  "Neptune",  "Indian",    time3],
      [2,   "Manatee", 2,       "Poseidon",  "",        "Poseidon", "Poseidon", "ATLANTIC",  time2],
    ])

  def test_last_modified_by_recipe(self):
    user1 = {
      'Name': 'Foo Bar',
      'UserID': 1,
      'StudentInfo': ['Students', 1],
      'LinkKey': {},
      'Origin': None,
      'Email': 'foo.bar@getgrist.com',
      'Access': 'owners'
    }
    user2 = {
      'Name': 'Baz Qux',
      'UserID': 2,
      'StudentInfo': ['Students', 1],
      'LinkKey': {},
      'Origin': None,
      'Email': 'baz.qux@getgrist.com',
      'Access': 'owners'
    }
    # Use formula to store last modified by data (user name and email). Check that it works as expected.
    self.load_sample(self.sample)
    self.add_column('Creatures', 'LastModifiedBy', type='Text', isFormula=False,
      formula="user.Name + ' <' + user.Email + '>'", recalcWhen=RecalcWhen.MANUAL_UPDATES
    )
    self.assertTableData("Creatures", data=[
      ["id","Name",    "Ocean", "BossDef",   "BossNvr", "BossUpd", "BossAll", "OceanName", "LastModifiedBy"],
      [1,   "Dolphin", 2,       "Arthur",    "Arthur",  "Arthur",  "Arthur",  "Atlantic",  ""],
    ])

    self.apply_user_action(
      ['AddRecord', "Creatures", None, {"Name": "Manatee", "Ocean": 2}],
      user=user1
    )
    self.apply_user_action(
      ['UpdateRecord', "Creatures", 1, {"Ocean": 3}],
      user=user2
    )

    self.assertTableData("Creatures", data=[
      ["id","Name",    "Ocean", "BossDef",   "BossNvr", "BossUpd",  "BossAll",  "OceanName", "LastModifiedBy"],
      [1,   "Dolphin", 3,       "Arthur",    "Arthur",  "Neptune",  "Neptune",  "Indian",    "Baz Qux <baz.qux@getgrist.com>"],
      [2,   "Manatee", 2,       "Poseidon",  "",        "Poseidon", "Poseidon", "Atlantic",  "Foo Bar <foo.bar@getgrist.com>"],
    ])

    # An indirect change doesn't affect the user, but a direct change does.
    self.apply_user_action(
      ['UpdateRecord', "Oceans", 2, {"Name": "ATLANTIC"}],
      user=user2
    )
    self.apply_user_action(
      ['UpdateRecord', "Creatures", 1, {"Name": "Whale"}],
      user=user1
    )
    self.assertTableData("Creatures", data=[
      ["id","Name",    "Ocean", "BossDef",   "BossNvr", "BossUpd",  "BossAll",  "OceanName", "LastModifiedBy"],
      [1,   "Whale",   3,       "Arthur",    "Arthur",  "Neptune",  "Neptune",  "Indian",    "Foo Bar <foo.bar@getgrist.com>"],
      [2,   "Manatee", 2,       "Poseidon",  "",        "Poseidon", "Poseidon", "ATLANTIC",  "Foo Bar <foo.bar@getgrist.com>"],
    ])
