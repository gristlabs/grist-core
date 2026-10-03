import test_engine


class TestFindColDependents(test_engine.EngineTestCase):
  def setUp(self):
    super(TestFindColDependents, self).setUp()
    self.apply_user_action(["AddTable", "People", [
      {"id": "name", "type": "Text"},
    ]])
    self.apply_user_action(["AddTable", "Games", [
      {"id": "name", "type": "Text"},
    ]])
    self.add_records("People", ["name"], [["Bob"], ["Alice"]])
    self.add_records("Games", ["name"], [["Chess"]])

  def test_direct_dollar_reference(self):
    self.add_column("People", "greeting", formula="'Hi ' + $name")
    self.assertEqual(
        self.engine.find_col_dependents("People", "name"),
        [{"tableId": "People", "colId": "greeting"}])

  def test_rec_attribute_reference(self):
    self.add_column("People", "greeting", formula="'Hi ' + rec.name")
    self.assertEqual(
        self.engine.find_col_dependents("People", "name"),
        [{"tableId": "People", "colId": "greeting"}])

  def test_lookup_reference(self):
    self.add_column("Games", "winner", formula="People.lookupOne(name=$name).name")
    self.assertEqual(
        self.engine.find_col_dependents("People", "name"),
        [{"tableId": "Games", "colId": "winner"}])

  def test_no_false_positive_on_same_named_column_in_other_table(self):
    # "name" also exists on Games, but nothing references People.name.
    self.assertEqual(self.engine.find_col_dependents("People", "name"), [])

  def test_dedupes_multiple_references_in_one_formula(self):
    self.add_column("People", "greeting", formula="($name + $name).upper()")
    self.assertEqual(
        self.engine.find_col_dependents("People", "name"),
        [{"tableId": "People", "colId": "greeting"}])

  def test_no_self_reference(self):
    # A column referencing itself (e.g. via rec.name in a trigger formula) shouldn't
    # be reported as its own dependent.
    self.add_column("People", "name2", formula="rec.name2 or ''", isFormula=False)
    self.assertEqual(self.engine.find_col_dependents("People", "name2"), [])

  def test_skips_hidden_display_helper_column(self):
    # Auto-generated "gristHelper_Display" should be ignored because they are not user
    # created formlas
    self.apply_user_action(["AddTable", "Fans", [
      {"id": "favorite", "type": "Ref:People"},
    ]])
    favorite_ref = self.engine.docmodel.get_column_rec("Fans", "favorite").id
    self.apply_user_action(["SetDisplayFormula", "Fans", None, favorite_ref, "$favorite.name"])
    self.assertEqual(self.engine.find_col_dependents("People", "name"), [])
