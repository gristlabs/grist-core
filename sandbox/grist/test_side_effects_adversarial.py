"""Adversarial stress tests for the eager-lookup-index fix (multiple lookupOrAddDerived per cell)."""
import objtypes
import test_engine
from schema import RecalcWhen


class TestSideEffectsAdversarial(test_engine.EngineTestCase):

  def _two_tables(self, make_formula):
    self.apply_user_action(['AddTable', 'Parent', [{'id': 'Name', 'type': 'Text'}]])
    self.apply_user_action(['AddTable', 'Child', [
      {'id': 'Name', 'type': 'Text'},
      {'id': 'Parent', 'type': 'Ref:Parent'},
    ]])
    self.add_column('Parent', 'make', formula=make_formula)

  def test_many_adds_one_cell(self):
    # Stress: 50 distinct adds to the same table from a single cell (loop).
    self._two_tables(
      'for i in range(50):\n'
      '    Child.lookupOrAddDerived(Parent=$id, Name="C%03d" % i)\n'
      'return None')
    self.add_record('Parent', Name="P1")
    names = sorted(r.Name for r in self.engine.docmodel.get_table('Child').lookupRecords())
    self.assertEqual(len(names), 50)
    self.assertEqual(names[0], "C000")
    self.assertEqual(names[-1], "C049")

  def test_multiple_adds_then_raise_rolls_back_all(self):
    # If a cell adds several rows and then errors, ALL of them must be rolled back.
    self._two_tables(
      'Child.lookupOrAddDerived(Parent=$id, Name="A")\n'
      'Child.lookupOrAddDerived(Parent=$id, Name="B")\n'
      'Child.lookupOrAddDerived(Parent=$id, Name="C")\n'
      'raise Exception("boom")')
    self.add_record('Parent', Name="P1")
    # No Child rows should survive the rollback.
    self.assertEqual(list(self.engine.docmodel.get_table('Child').lookupRecords()), [])
    # And the cell holds the error.
    val = self.engine.fetch_table('Parent').columns['make'][0]
    self.assertEqual(objtypes.decode_object(val).__class__, objtypes.RaisedException(Exception()).__class__)

  def test_conditional_partial_adds(self):
    # Mix of executed and skipped calls; only executed ones create rows.
    self._two_tables(
      'Child.lookupOrAddDerived(Parent=$id, Name="A")\n'
      '(Child.lookupOrAddDerived(Parent=$id, Name="B") if $Name == "yes" else None)\n'
      'Child.lookupOrAddDerived(Parent=$id, Name="C")\n'
      'return None')
    self.add_record('Parent', Name="no")
    self.add_record('Parent', Name="yes")
    got = sorted((r.Name, r.Parent.id) for r in self.engine.docmodel.get_table('Child').lookupRecords())
    self.assertEqual(got, [("A", 1), ("A", 2), ("B", 2), ("C", 1), ("C", 2)])

  def test_chain_across_three_tables(self):
    # A cell adds to Child; Child has a formula that adds to GrandChild: a chain of side effects
    # propagating across tables in one update pass.
    self.apply_user_action(['AddTable', 'Parent', [{'id': 'Name', 'type': 'Text'}]])
    self.apply_user_action(['AddTable', 'Child', [
      {'id': 'Name', 'type': 'Text'},
      {'id': 'Parent', 'type': 'Ref:Parent'},
    ]])
    self.apply_user_action(['AddTable', 'GrandChild', [
      {'id': 'Tag', 'type': 'Text'},
      {'id': 'Child', 'type': 'Ref:Child'},
    ]])
    # Child cell creates two grandchildren per child.
    self.add_column('Child', 'spawn', formula=(
      'GrandChild.lookupOrAddDerived(Child=$id, Tag=$Name + "-x")\n'
      'GrandChild.lookupOrAddDerived(Child=$id, Tag=$Name + "-y")\n'
      'return None'))
    self.add_column('Parent', 'make', formula=(
      'Child.lookupOrAddDerived(Parent=$id, Name="K")\n'
      'Child.lookupOrAddDerived(Parent=$id, Name="L")\n'
      'return None'))
    self.add_record('Parent', Name="P1")
    children = sorted(r.Name for r in self.engine.docmodel.get_table('Child').lookupRecords())
    grand = sorted(r.Tag for r in self.engine.docmodel.get_table('GrandChild').lookupRecords())
    self.assertEqual(children, ["K", "L"])
    self.assertEqual(grand, ["K-x", "K-y", "L-x", "L-y"])

  # --- Trigger formulas (data columns with recalcWhen) calling lookupOrAddDerived ----------------
  # A trigger column stores its formula's result, so the formula must return a value (unlike a
  # regular formula column, where a bare statement block is fine). Triggers fire on new records and
  # manual updates (RecalcWhen.MANUAL_UPDATES).

  def _trigger_setup(self, formula):
    self.apply_user_action(['AddTable', 'Parent', [
      {'id': 'Name', 'type': 'Text'},
      {'id': 'Txt', 'type': 'Text'},
    ]])
    self.apply_user_action(['AddTable', 'Child', [
      {'id': 'Name', 'type': 'Text'},
      {'id': 'Parent', 'type': 'Ref:Parent'},
    ]])
    self.add_column('Parent', 'make', type='Any', isFormula=False, formula=formula,
                    recalcWhen=RecalcWhen.MANUAL_UPDATES)

  def test_trigger_formula_multiple_adds(self):
    # A trigger formula that loops over a delimited field and creates one Child per line.
    self._trigger_setup(
      "for x in ($Txt or '').split(','):\n"
      "    x = x.strip()\n"
      "    if x:\n"
      "        Child.lookupOrAddDerived(Parent=$id, Name=x)\n"
      "return None")
    self.add_record('Parent', Name="P1", Txt="a, b, c")
    self.assertTableData('Child', cols="subset", data=[
      ["id", "Name", "Parent"],
      [1,    "a",    1],
      [2,    "b",    1],
      [3,    "c",    1],
    ])

  def test_trigger_formula_listcomp_value(self):
    # The returned-list form: the cell stores the list of created references.
    self._trigger_setup(
      "[Child.lookupOrAddDerived(Parent=$id, Name=x.strip())"
      " for x in ($Txt or '').split(',') if x.strip()]")
    self.add_record('Parent', Name="P1", Txt="a, b")
    self.assertTableData('Child', cols="subset", data=[
      ["id", "Name", "Parent"],
      [1,    "a",    1],
      [2,    "b",    1],
    ])

  def test_trigger_formula_refires_on_update(self):
    # A trigger with MANUAL_UPDATES fires again when the source field is edited; new lines get added
    # (lookupOrAddDerived is add-only, so previously-created rows remain).
    self._trigger_setup(
      "for x in ($Txt or '').split(','):\n"
      "    x = x.strip()\n"
      "    if x:\n"
      "        Child.lookupOrAddDerived(Parent=$id, Name=x)\n"
      "return None")
    self.add_record('Parent', Name="P1", Txt="a, b")
    self.update_record('Parent', 1, Txt="a, b, c")
    self.assertTableData('Child', cols="subset", data=[
      ["id", "Name", "Parent"],
      [1,    "a",    1],
      [2,    "b",    1],
      [3,    "c",    1],
    ])

  def test_trigger_formula_without_return_is_error(self):
    # A trigger formula that yields no value is a build error: the cell holds the error and no rows
    # are created (the side effect rolls back).
    self._trigger_setup(
      "for x in ($Txt or '').split(','):\n"
      "    if x.strip():\n"
      "        Child.lookupOrAddDerived(Parent=$id, Name=x.strip())")
    self.add_record('Parent', Name="P1", Txt="a, b, c")
    # No Child rows.
    self.assertTableData('Child', cols="subset", data=[["id", "Name", "Parent"]])
    # The cell holds an error value.
    val = self.engine.fetch_table('Parent').columns['make'][0]
    self.assertEqual(objtypes.decode_object(val).__class__,
                     objtypes.RaisedException(Exception()).__class__)

  # The supported shape is: ensure rows in one column, read them in a DOWNSTREAM column. A cell may
  # not both add to and read the same table (see test_same_cell_add_and_read_is_circular below).

  def test_downstream_orderby_formula(self):
    # Adder column ensures rows; a downstream column reads them ordered by a formula column (S=-Base).
    self.apply_user_action(['AddTable', 'Parent', [{'id': 'Name', 'type': 'Text'}]])
    self.apply_user_action(['AddTable', 'Child', [
      {'id': 'Name', 'type': 'Text'},
      {'id': 'Parent', 'type': 'Ref:Parent'},
      {'id': 'Base', 'type': 'Numeric'},
      {'id': 'S', 'type': 'Numeric', 'isFormula': True, 'formula': '-$Base'},
    ]])
    self.add_column('Parent', 'make', formula=(
      '[Child.lookupOrAddDerived(Parent=$id, Name=n, Base=b)'
      ' for n, b in [("A", 1), ("B", 3), ("C", 2)]]'))
    self.add_column('Parent', 'ordered', formula=(
      '",".join(r.Name for r in Child.lookupRecords(Parent=$id, order_by="S"))'))
    self.add_record('Parent', Name="P1")
    # Ordered by -Base: B(-3), C(-2), A(-1).
    self.assertEqual(self.engine.fetch_table('Parent').columns['ordered'][0], "B,C,A")

  def test_downstream_keyby_formula(self):
    # Downstream read keyed on a formula column (Tag = Name.lower()).
    self.apply_user_action(['AddTable', 'Parent', [{'id': 'Name', 'type': 'Text'}]])
    self.apply_user_action(['AddTable', 'Child', [
      {'id': 'Name', 'type': 'Text'},
      {'id': 'Parent', 'type': 'Ref:Parent'},
      {'id': 'Tag', 'type': 'Text', 'isFormula': True, 'formula': '($Name or "").lower()'},
    ]])
    self.add_column('Parent', 'make', formula='Child.lookupOrAddDerived(Parent=$id, Name="Hello")')
    self.add_column('Parent', 'found', formula='len(Child.lookupRecords(Tag="hello"))')
    self.add_record('Parent', Name="P1")
    self.assertEqual(self.engine.fetch_table('Parent').columns['found'][0], 1)

  def test_downstream_orderby_multi_column(self):
    # Downstream read ordered by a data column (Grp) and a formula column (S = -Base).
    self.apply_user_action(['AddTable', 'Parent', [{'id': 'Name', 'type': 'Text'}]])
    self.apply_user_action(['AddTable', 'Child', [
      {'id': 'Name', 'type': 'Text'}, {'id': 'Parent', 'type': 'Ref:Parent'},
      {'id': 'Grp', 'type': 'Text'}, {'id': 'Base', 'type': 'Numeric'},
      {'id': 'S', 'type': 'Numeric', 'isFormula': True, 'formula': '-$Base'},
    ]])
    self.add_column('Parent', 'make', formula=(
      '[Child.lookupOrAddDerived(Parent=$id, Name=n, Grp=g, Base=b)'
      ' for n, g, b in [("x", "a", 1), ("y", "a", 2), ("z", "b", 5)]]'))
    self.add_column('Parent', 'ordered', formula=(
      '",".join(r.Name for r in Child.lookupRecords(Parent=$id, order_by=("Grp", "S")))'))
    self.add_record('Parent', Name="P1")
    # Grp "a" sorted by S: y(-2), x(-1); then Grp "b": z.
    self.assertEqual(self.engine.fetch_table('Parent').columns['ordered'][0], "y,x,z")

  def test_downstream_multilevel_formula_sort(self):
    # Downstream read ordered by a formula that depends on another formula (A = B*10, B = -Base).
    self.apply_user_action(['AddTable', 'Parent', [{'id': 'Name', 'type': 'Text'}]])
    self.apply_user_action(['AddTable', 'Child', [
      {'id': 'Name', 'type': 'Text'}, {'id': 'Parent', 'type': 'Ref:Parent'},
      {'id': 'Base', 'type': 'Numeric'},
      {'id': 'B', 'type': 'Numeric', 'isFormula': True, 'formula': '-$Base'},
      {'id': 'A', 'type': 'Numeric', 'isFormula': True, 'formula': '$B * 10'},
    ]])
    self.add_column('Parent', 'make', formula=(
      '[Child.lookupOrAddDerived(Parent=$id, Name=n, Base=b) for n, b in [("x", 1), ("y", 2)]]'))
    self.add_column('Parent', 'ordered', formula=(
      '",".join(r.Name for r in Child.lookupRecords(Parent=$id, order_by="A"))'))
    self.add_record('Parent', Name="P1")
    # A = -Base*10: x -> -10, y -> -20. Ascending: y(-20), x(-10).
    self.assertEqual(self.engine.fetch_table('Parent').columns['ordered'][0], "y,x")

  def test_downstream_read_across_tables(self):
    # Two levels of derived tables: each level's adder ensures rows in the next, and a downstream
    # column reads them ordered by a formula column.
    self.apply_user_action(['AddTable', 'Parent', [{'id': 'Name', 'type': 'Text'}]])
    for lvl in (1, 2):
      self.apply_user_action(['AddTable', 'L%d' % lvl, [
        {'id': 'Name', 'type': 'Text'}, {'id': 'Up', 'type': 'Numeric'},
        {'id': 'Base', 'type': 'Numeric'},
        {'id': 'S', 'type': 'Numeric', 'isFormula': True, 'formula': '-$Base'}]])
    self.add_column('L1', 'make', formula=(
      '[L2.lookupOrAddDerived(Up=$id, Name=n, Base=b) for n, b in [("a", 1), ("b", 2)]]'))
    self.add_column('L1', 'kids', formula='",".join(r.Name for r in L2.lookupRecords(Up=$id, order_by="S"))')
    self.add_column('Parent', 'make', formula='L1.lookupOrAddDerived(Up=$id, Name="p", Base=1)')
    self.add_column('Parent', 'kids', formula='",".join(r.Name for r in L1.lookupRecords(Up=$id, order_by="S"))')
    self.add_record('Parent', Name="P1")
    self.assertEqual(self.engine.fetch_table('L1').columns['kids'][0], "b,a")
    self.assertEqual(self.engine.fetch_table('Parent').columns['kids'][0], "p")

  def test_same_cell_add_and_read_is_circular(self):
    # A cell that both adds to and reads the same table is a circular reference, not a value.
    # (Use a downstream column to read instead.)
    self.apply_user_action(['AddTable', 'Parent', [{'id': 'Name', 'type': 'Text'}]])
    self.apply_user_action(['AddTable', 'Child', [
      {'id': 'Name', 'type': 'Text'}, {'id': 'Parent', 'type': 'Ref:Parent'},
    ]])
    self.add_column('Parent', 'make', formula=(
      'Child.lookupOrAddDerived(Parent=$id, Name="x")\n'
      'return len(Child.lookupRecords(Parent=$id))'))
    self.add_record('Parent', Name="P1")
    val = self.engine.fetch_table('Parent').columns['make'][0]
    self.assertEqual(objtypes.decode_object(val).__class__,
                     objtypes.RaisedException(Exception()).__class__)

  def test_bounded_mutual_recursion_terminates(self):
    # Two tables whose formulas each add to the other, with fixed keys so only finitely many rows
    # are possible. Must settle to a stable state (asserted exactly), not hang.
    self.apply_user_action(['AddTable', 'A', [{'id': 'N', 'type': 'Text'}]])
    self.apply_user_action(['AddTable', 'B', [{'id': 'N', 'type': 'Text'}]])
    # Fixed keys: A always makes B "b", B always makes A "a". Finite rows.
    self.add_column('A', 'mk', formula='B.lookupOrAddDerived(N="b")\nreturn None')
    self.add_column('B', 'mk', formula='A.lookupOrAddDerived(N="a")\nreturn None')
    # Seed an A row: A "seed" -> B "b" -> A "a" -> B "b" (exists), so it settles here.
    self.add_record('A', N="seed")
    self.assertTableData('A', cols="subset", data=[
      ["id", "N"],
      [1,    "seed"],
      [2,    "a"],
    ])
    self.assertTableData('B', cols="subset", data=[
      ["id", "N"],
      [1,    "b"],
    ])

  def test_add_then_defer_retries_to_single_row(self):
    # A cell that adds a row and then reads a not-yet-computed value defers until that value is
    # ready. Deferring rolls back the add, so the retry must end with exactly one row, not two.
    # ("Aaa" sorts before "Zed", so Aaa.make runs first and reads Zed.uf while it is still dirty.)
    self.apply_user_action(['AddTable', 'Aaa', [{'id': 'make', 'type': 'Any', 'isFormula': True,
      'formula': 'Child.lookupOrAddDerived(Name="x")\nreturn Zed.lookupOne(seed=10).uf'}]])
    self.apply_user_action(['AddTable', 'Child', [{'id': 'Name', 'type': 'Text'}]])
    self.apply_user_action(['AddTable', 'Zed', [
      {'id': 'seed', 'type': 'Numeric'},
      {'id': 'uf', 'type': 'Numeric', 'isFormula': True, 'formula': '$seed * 2'},
    ]])
    self.add_record('Zed', seed=10)
    self.add_record('Aaa')
    # The cell succeeded on retry (uf = seed * 2), and the add ran exactly once.
    self.assertEqual(self.engine.fetch_table('Aaa').columns['make'][0], 20.0)
    self.assertTableData('Child', cols="subset", data=[["id", "Name"], [1, "x"]])
