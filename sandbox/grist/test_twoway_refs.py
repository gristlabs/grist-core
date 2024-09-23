# pylint:disable=too-many-lines
import unittest
import test_engine
from test_engine import Table, Column
import useractions

# Ids for project sample
apps = None
backend = None
alice = None
bob = None

# Ids for pets sample
Rex = 1
Pluto = 2
Azor = 3
Empty = 0
Alice = 1
Bob = 2
Penny = 3
EmptyList = None

def uniqueReferences(rec):
  return rec.reverseCol and rec.reverseCol.type.startswith('Ref:')

class TestTwoWayReferences(test_engine.EngineTestCase):

  def get_col_rec(self, tableId, colId):
    # Do simple lookup without creating any dependencies
    t = self.engine.docmodel.columns.table
    return t.get_record(t.get(tableId=tableId, colId=colId))

  def loadSample(self):
    self.apply_user_action(["AddTable", "People", [
      {"id": "Name", "type": "Text"},
    ]])
    people_name_col = self.get_col_rec(tableId="People", colId="Name")
    self.apply_user_action(["AddTable", "Projects", [
      {"id": "Name",  "type": "Text"},
      {"id": "Owner", "type": "Ref:People", "visibleCol":people_name_col.id},
    ]])
    owner_col = self.get_col_rec(tableId="Projects", colId="Owner")
    self.apply_user_action(["SetDisplayFormula", "Projects", owner_col.id, None, "$Owner.Name"])

    global apps, backend, alice, bob # pylint: disable=global-statement
    alice = self.add_record("People", Name="Alice").retValues[0]
    bob = self.add_record("People", Name="Bob").retValues[0]
    apps = self.add_record("Projects", Name="Apps", Owner=alice).retValues[0]
    backend = self.add_record("Projects", Name="Backend", Owner=bob).retValues[0]

    self.assertTableData("Projects", cols="subset", data=[
      ["id", "Name", "Owner"],
      [1, "Apps", alice],
      [2, "Backend", bob],
    ])

    self.assertTableData("People", cols="subset", data=[
      ["id", "Name"],
      [1, "Alice"],
      [2, "Bob"],
    ])


  def loadReverseSample(self):
    self.loadSample()
    self.apply_user_action(["AddReverseColumn", 'Projects', 'Owner'])

    self.assertTables([
      Table(1, "People", 1, 0, columns=[
        Column(1, "manualSort", "ManualSortPos", False, "", 0),
        Column(2, "Name", "Text", False, "", 0),
        Column(7, "Projects", "RefList:Projects", False, "", 0),
        Column(8, "gristHelper_Display", "Any", True, "$Projects.Name", 0),
      ]),
      Table(2, "Projects", 2, 0, columns=[
        Column(3, "manualSort", "ManualSortPos", False, "", 0),
        Column(4, "Name", "Text", False, "", 0),
        Column(5, "Owner", "Ref:People", False, "", 0),
        Column(6, "gristHelper_Display", "Any", True, "$Owner.Name", 0),
      ]),
    ])



    self.assertTableData("Projects", cols="subset", data=[
      ["id", "Name", "Owner"],
      [apps, "Apps", alice],
      [backend, "Backend", bob],
    ])
    self.assertTableData("People", cols="subset", data=[
      ["id", "Name", "Projects"],
      [alice, "Alice", [apps]],
      [bob, "Bob", [backend]],
    ])


  def add_people_ref(self, name, project_table="Projects"):
    # Add tester column
    people_name_col = self.get_col_rec(tableId="People", colId="Name")
    self.apply_user_action([
      "AddColumn", project_table, name, {
        "type": "Ref:People",
        "visibleCol": people_name_col.id,
        "isFormula": False
      }
    ])
    new_col = self.get_col_rec(tableId=project_table, colId=name)
    self.apply_user_action(["SetDisplayFormula",
                            project_table, None, new_col.id, "$%s.Name" % name])
    self.apply_user_action(["AddReverseColumn", project_table, new_col.colId])

  def test_simple_updates_work(self):
    self.loadReverseSample()

    # Remove Alice as owner of Apps project
    self.update_record("Projects", apps, Owner=None)

    self.assertTableData("Projects", cols="subset", data=[
      ["id", "Name", "Owner"],
      [apps, "Apps", 0],
      [backend, "Backend", bob],
    ])
    self.assertTableData("People", cols="subset", data=[
      ["id", "Name", "Projects"],
      [alice, "Alice", None],
      [bob, "Bob", [backend]],
    ])

    # Now remove Bob as owner of Backend project
    self.update_record("Projects", backend, Owner=None)
    self.assertTableData("Projects", cols="subset", data=[
      ["id", "Name", "Owner"],
      [apps, "Apps", 0],
      [backend, "Backend", 0],
    ])
    self.assertTableData("People", cols="subset", data=[
      ["id", "Name", "Projects"],
      [alice, "Alice", None],
      [bob, "Bob", None],
    ])

    # Now add Alice as owner of both projects via People table.
    self.update_record("People", alice, Projects=["L", apps, backend])
    self.assertTableData("Projects", cols="subset", data=[
      ["id", "Name", "Owner"],
      [apps, "Apps", alice],
      [backend, "Backend", alice],
    ])
    self.assertTableData("People", cols="subset", data=[
      ["id", "Name", "Projects"],
      [alice, "Alice", [apps, backend]],
      [bob, "Bob", None],
    ])


  def test_failes_to_update_unique_reflist(self):
    self.loadReverseSample()

    with self.assertRaises(Exception):
      self.update_record("People", bob, Projects=["L", apps])

  def test_clear_from_single_ref(self):
    self.loadReverseSample()

    # Remove owner from apps project
    self.update_record("Projects", apps, Owner=0)

    self.assertTableData("Projects", cols="subset", data=[
      ["id", "Name", "Owner"],
      [apps, "Apps", 0],
      [backend, "Backend", bob],
    ])

    self.assertTableData("People", cols="subset", data=[
      ["id", "Name", "Projects"],
      [alice, "Alice", None],
      [bob, "Bob", [backend]],
    ])

  def test_clear_ref_list(self):
    self.loadReverseSample()

    # Remove owner from apps project
    self.update_record("People", alice, Projects=None)

    self.assertTableData("Projects", cols="subset", data=[
      ["id", "Name", "Owner"],
      [apps, "Apps", 0],
      [backend, "Backend", bob],
    ])
    self.assertTableData("People", cols="subset", data=[
      ["id", "Name", "Projects"],
      [alice, "Alice", None],
      [bob, "Bob", [backend]],
    ])

  def test_creates_proper_names(self):
    self.loadReverseSample()
    self.add_people_ref("Tester")

    self.assertTables([
      Table(1, "People", 1, 0, columns=[
        Column(1, "manualSort", "ManualSortPos", False, "", 0),
        Column(2, "Name", "Text", False, "", 0),
        Column(7, "Projects", "RefList:Projects", False, "", 0),
        Column(8, "gristHelper_Display", "Any", True, "$Projects.Name", 0),
        Column(11, "Projects_Tester", "RefList:Projects", False, "", 0),
        Column(12, "gristHelper_Display2", "Any", True, "$Projects_Tester.Name", 0),
      ]),
      Table(2, "Projects", 2, 0, columns=[
        Column(3, "manualSort", "ManualSortPos", False, "", 0),
        Column(4, "Name", "Text", False, "", 0),
        Column(5, "Owner", "Ref:People", False, "", 0),
        Column(6, "gristHelper_Display", "Any", True, "$Owner.Name", 0),
        Column(9, "Tester", "Ref:People", False, "", 0),
        Column(10, "gristHelper_Display2", "Any", True, "$Tester.Name", 0),
      ]),
    ])

    # Now change the name of a table (by adding a title to the rav view section)
    projects_table = self.engine.docmodel.tables.table.get_record(2)
    self.engine.docmodel.update([projects_table.rawViewSectionRef], title="Tasks")
    self.add_people_ref("PM", "Tasks")

    self.assertTables([
      Table(1, "People", 1, 0, columns=[
        Column(1, "manualSort", "ManualSortPos", False, "", 0),
        Column(2, "Name", "Text", False, "", 0),
        Column(7, "Projects", "RefList:Tasks", False, "", 0),
        Column(8, "gristHelper_Display", "Any", True, "$Projects.Name", 0),
        Column(11, "Projects_Tester", "RefList:Tasks", False, "", 0),
        Column(12, "gristHelper_Display2", "Any", True, "$Projects_Tester.Name", 0),
        Column(15, "Tasks", "RefList:Tasks", False, "", 0),
        Column(16, "gristHelper_Display3", "Any", True, "$Tasks.Name", 0),
      ]),
      Table(2, "Tasks", 2, 0, columns=[
        Column(3, "manualSort", "ManualSortPos", False, "", 0),
        Column(4, "Name", "Text", False, "", 0),
        Column(5, "Owner", "Ref:People", False, "", 0),
        Column(6, "gristHelper_Display", "Any", True, "$Owner.Name", 0),
        Column(9, "Tester", "Ref:People", False, "", 0),
        Column(10, "gristHelper_Display2", "Any", True, "$Tester.Name", 0),
        Column(13, "PM", "Ref:People", False, "", 0),
        Column(14, "gristHelper_Display3", "Any", True, "$PM.Name", 0),
      ]),
    ])


  def test_checking_unique_values(self):
    self.loadReverseSample()

    # Unique values is turned on only on the People table in the Projects column.
    projects = self.get_col_rec(tableId="People", colId="Projects")
    owner = self.get_col_rec(tableId="Projects", colId="Owner")
    self.assertTrue(uniqueReferences(projects))
    self.assertFalse(uniqueReferences(owner))

    # Owner is of type Ref and Projects of type RefList.
    self.assertEqual(owner.type, "Ref:People")
    self.assertEqual(projects.type, "RefList:Projects")

    # Try moving all projects to Bob
    with self.assertRaises(Exception):
      self.update_record("People", bob, Projects=["L", apps, backend])

    # We can't that, we need to first clear projects from Alice.
    self.update_record("People", alice, Projects=None)
    self.update_record("People", bob, Projects=["L", apps, backend])

    self.assertTableData("People", cols="subset", data=[
      ["id", "Name", "Projects"],
      [alice, "Alice", None],
      [bob, "Bob", [apps, backend]],
    ])
    self.assertTableData("Projects", cols="subset", data=[
      ["id", "Name", "Owner"],
      [apps, "Apps", bob],
      [backend, "Backend", bob],
    ])

    # Now change the type of Projects in People to be Ref, this will destroy data, a little bit
    # as Bob will only have the frist project.
    self.apply_user_action(["ModifyColumn", "People", "Projects", {"type": "Ref:Projects"}])

    projects = self.get_col_rec(tableId="People", colId="Projects")
    owner = self.get_col_rec(tableId="Projects", colId="Owner")
    # Make sure type was changed to Ref
    self.assertEqual(owner.type, "Ref:People")
    self.assertEqual(projects.type, "Ref:Projects")
    self.assertEqual(uniqueReferences(projects), True)
    self.assertEqual(uniqueReferences(owner), True)

    # And data was updated, bob is no longer owner of Tests project.
    # and the Projects column in the People table is now of type Ref
    self.assertTableData("Projects", cols="subset", data=[
      ["id", "Name", "Owner"],
      [apps, "Apps", bob],
      [backend, "Backend", 0],
    ])

    self.assertTableData("People", cols="subset", data=[
      ["id", "Name", "Projects"],
      [alice, "Alice", 0],
      [bob, "Bob", apps],
    ])

  def load_pets(self):
    self.apply_user_action(["AddTable", "Owners", [
      {"id": "Name", "type": "Text"},
    ]])

    # Add owner named Alice
    self.apply_user_action(["AddRecord", "Owners", 1, {"Name": "Alice"}])
    self.apply_user_action(["AddRecord", "Owners", 2, {"Name": "Bob"}])

    # Add pets table with owner ref
    self.apply_user_action(["AddTable", "Pets", [
      {"id": "Name", "type": "Text"},
      {"id": "Owner", "type": "Ref:Owners"},
    ]])

    # Add a pet named Rex with Bob as owner
    self.apply_user_action(["AddRecord", "Pets", 1, {"Name": "Rex", "Owner": Bob}])

    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name"],
      [Alice, "Alice"],
      [Bob, "Bob"],
    ])
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [Rex, "Rex", Bob],
    ])


  def test_uniques(self):
    self.load_pets()

    # Add another dog
    self.apply_user_action(["AddRecord", "Pets", Pluto, {"Name": "Pluto", "Owner": Bob}])
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [Rex, "Rex", Bob],
      [Pluto, "Pluto", Bob],
    ])

    # Now set unique constraint on Owner column, by adding reverse column of type Ref.
    self.apply_user_action(["AddReverseColumn", 'Pets', 'Owner'])
    self.apply_user_action(["ModifyColumn", "Owners", "Pets", {"type": "Ref:Pets"}])

    # Make sure that pluto has no owner now.
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [Rex, "Rex", Bob],
      [Pluto, "Pluto", Empty],
    ])

    # Now try to set Pluto to Bob, it should fail as Rex is in Bob.
    with self.assertRaises(Exception):
      self.apply_user_action(["UpdateRecord", "Pets", Pluto, {"Owner": Bob}])

    # So repeat it, but first remove Bob from Rex.
    self.apply_user_action(["UpdateRecord", "Pets", Rex, {"Owner": None}])
    self.apply_user_action(["UpdateRecord", "Pets", Pluto, {"Owner": Bob}])

    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [Rex, "Rex", Empty],
      [Pluto, "Pluto", Bob],
    ])

    # Convert Owners to RefList (but first remove data).
    self.apply_user_action(["UpdateRecord", "Pets", Pluto, {"Owner": None}])
    self.apply_user_action(["ModifyColumn", "Pets", "Owner", {"type": "RefList:Owners"}])
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [Rex, "Rex", EmptyList],
      [Pluto, "Pluto", EmptyList],
    ])

    # Now move Alice, Bob to Rex and make sure that works
    self.apply_user_action(["UpdateRecord", "Pets", Rex, {"Owner": ['L', Alice, Bob]}])
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [Rex, "Rex", [Alice, Bob]],
      [Pluto, "Pluto", EmptyList],
    ])

    # Now move Pluto to Bob, it should fail as Bob has Rex.
    with self.assertRaises(Exception):
      self.apply_user_action(["UpdateRecord", "Pets", Pluto, {"Owner": ['L', Bob]}])

    # So repeat it, but first remove Bob from Rex.
    self.apply_user_action(["UpdateRecord", "Pets", Rex, {"Owner": ['L', Alice]}])
    self.apply_user_action(["UpdateRecord", "Pets", Pluto, {"Owner": ['L', Bob]}])

    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name"],
      [1, "Alice"],
      [2, "Bob"],
    ])

    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [Rex, "Rex", [Alice]],
      [Pluto, "Pluto", [Bob]],
    ])

    # Now remove the unique constraint, by removing the reverse column.
    self.apply_user_action(["RemoveColumn", 'Owners', 'Pets'])
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [Rex, "Rex", [Alice]],
      [Pluto, "Pluto", [Bob]],
    ])

    # Both Alice and Bob will own Rex.
    self.apply_user_action(["UpdateRecord", "Pets", Rex, {"Owner": ['L', Alice, Bob]}])
    # Same for Pluto but in opposite order.
    self.apply_user_action(["UpdateRecord", "Pets", Pluto, {"Owner": ['L', Bob, Alice]}])
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [Rex, "Rex", [Alice, Bob]],
      [Pluto, "Pluto", [Bob, Alice]],
    ])
    # Now make it unique again (using reverse column) and see if it will clear the column properly.
    self.apply_user_action(["AddReverseColumn", 'Pets', 'Owner'])
    self.apply_user_action(["ModifyColumn", "Owners", "Pets", {"type": "Ref:Pets"}])

    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [Rex, "Rex", [Alice, Bob]],
      [Pluto, "Pluto", EmptyList],
    ])


  def test_removes(self):
    self.load_pets()
    owner_col = self.get_col_rec(tableId="Pets", colId="Owner")
    self.apply_user_action(["AddReverseColumn", 'Pets', 'Owner'])
    pets_col = self.get_col_rec(tableId="Owners", colId="Pets")
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Pets"],
      [1, "Alice", EmptyList],
      [2, "Bob", [Rex]],
    ])
    # Try to remove it
    self.apply_user_action(["BulkRemoveRecord", "_grist_Tables_column", [pets_col.id]])
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name"],
      [1, "Alice"],
      [2, "Bob"],
    ])

    # Now add it back
    self.apply_user_action(["AddReverseColumn", 'Pets', 'Owner'])
    pets_col = self.get_col_rec(tableId="Owners", colId="Pets")

    # And try to remove original column.
    self.apply_user_action(["BulkRemoveRecord", "_grist_Tables_column", [owner_col.id]])


  def test_designs(self):
    self.load_pets()

    Rex = 1
    Empty = 0
    Alice = 1
    Bob = 2
    EmptyList = None

    self.apply_user_action(["AddReverseColumn", 'Pets', 'Owner'])

    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Pets"],
      [1, "Alice", EmptyList],
      [2, "Bob", [Rex]],
    ])

    # Now move Rex to Bob
    self.apply_user_action(["UpdateRecord", "Pets", Rex, {"Owner": Alice}])

    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Pets"],
      [1, "Alice", [Rex]],
      [2, "Bob", EmptyList],
    ])
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [1, "Rex", Alice],
    ])

    # Now move Rex back to Bob, but by using Owners table, but first remove Alice from Rex.
    self.apply_user_action(["UpdateRecord", "Pets", Rex, {"Owner": None}])
    self.apply_user_action(["UpdateRecord", "Owners", Bob, {"Pets": ['L', Rex]}])
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Pets"],
      [1, "Alice", EmptyList],
      [2, "Bob", [Rex]],
    ])
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [1, "Rex", Bob],
    ])

    # Now remove Rex from Bob using Owners table.
    self.apply_user_action(["UpdateRecord", "Owners", Bob, {"Pets": None}])
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Pets"],
      [1, "Alice", EmptyList],
      [2, "Bob", EmptyList],
    ])
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [1, "Rex", Empty],
    ])

    # Now convert Owners to RefList.
    self.apply_user_action(["ModifyColumn", "Pets", "Owner", {"type": "RefList:Owners"}])
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [1, "Rex", EmptyList],
    ])

    # Set two owners for Rex.
    self.apply_user_action(["UpdateRecord", "Pets", Rex, {"Owner": ['L', Alice, Bob]}])
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [1, "Rex", [Alice, Bob]],
    ])
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Pets"],
      [1, "Alice", [Rex]],
      [2, "Bob", [Rex]],
    ])

    # Now clear Rex from Alice.
    self.apply_user_action(["UpdateRecord", "Owners", Alice, {"Pets": None}])
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [1, "Rex", [Bob]],
    ])
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Pets"],
      [1, "Alice", EmptyList],
      [2, "Bob", [Rex]],
    ])


  def test_reverse_uniqueness(self):
    self.load_pets()

    # First modify Owner column to RefList
    self.apply_user_action(["ModifyColumn", "Pets", "Owner", {"type": "RefList:Owners"}])
    self.apply_user_action(['RenameColumn', 'Pets', 'Owner', 'Owners'])
    # Add Pluto with Alice as an owner
    self.apply_user_action(["AddRecord", "Pets", Pluto, {"Name": "Pluto", "Owners": ['L', Alice]}])
    # Move Rex to both Alice and Bob.
    self.apply_user_action(["UpdateRecord", "Pets", Rex, {"Owners": ['L', Alice, Bob]}])

    # Now do the reverse magic
    self.apply_user_action(["AddReverseColumn", 'Pets', 'Owners'])

    # Now make sure we see the data
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owners"],
      [Rex, "Rex", [Alice, Bob]],
      [Pluto, "Pluto", [Alice]],
    ])
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Pets"],
      [1, "Alice", [Rex, Pluto]],
      [2, "Bob", [Rex]],
    ])

    # Now make Pets.Owners column unique (Owners is a source column), by setting Owners.Pets to Ref.
    out_actions = self.apply_user_action(["ModifyColumn", "Owners", "Pets", {"type": "Ref:Pets"}])
    owner_col = self.get_col_rec(tableId="Pets", colId="Owners")
    self.assertTrue(uniqueReferences(owner_col))

    # It should clean data nicely.
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owners"],
      [Rex, "Rex", [Alice, Bob]],
      [Pluto, "Pluto", EmptyList],
    ])
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Pets"],
      [1, "Alice", Rex],
      [2, "Bob", Rex],
    ])

    undo_actions = out_actions.get_repr()["undo"]
    out_actions = self.apply_user_action(['ApplyUndoActions', undo_actions])

    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owners"],
      [Rex, "Rex", [Alice, Bob]],
      [Pluto, "Pluto", [Alice]],
    ])
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Pets"],
      [1, "Alice", [Rex, Pluto]],
      [2, "Bob", [Rex]],
    ])

    # Now do the same for the target column, we will convert it to Ref.
    self.apply_user_action(["ModifyColumn", "Pets", "Owners", {"type": "Ref:Owners"}])
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owners"],
      [Rex, "Rex", Alice],
      [Pluto, "Pluto", Alice],
    ])
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Pets"],
      [1, "Alice", [Rex, Pluto]],
      [2, "Bob", EmptyList],
    ])

  def test_unlink_connection(self):
    """
    This is somehow hidden feature. From the UI we can't unlink a connection, (we can only
    remove one of the columns). But it is possible to do it via API. It was much easier to implement
    then to prevent it, so it is allowed.
    """
    self.load_pets()

    # Create reverse column for Pets.Owner
    self.apply_user_action(["AddReverseColumn", 'Pets', 'Owner'])
    # Now unlink it immediately and allow duplicates on target column
    self.apply_user_action(['ModifyColumn', 'Owners', 'Pets', {
      'reverseCol': 0
    }])
    # Now move Rex to both Alice and Bob using Onwers table
    self.apply_user_action(["UpdateRecord", "Owners", Alice, {"Pets": ['L', Rex]}])
    # Make sure we see the data
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Pets"],
      [1, "Alice", [Rex]],
      [2, "Bob", [Rex]],
    ])
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [Rex, "Rex", Bob],
    ])
    # Now change Rex to Alice using Pets table
    self.apply_user_action(["UpdateRecord", "Pets", Rex, {"Owner": Alice}])
    # Make sure we see the data
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Pets"],
      [1, "Alice", [Rex]],
      [2, "Bob", [Rex]],
    ])
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [Rex, "Rex", Alice],
    ])

  def test_reflist_to_ref_conversion(self):
    self.apply_user_action(["AddTable", "Employees", [
      {"id": "Name",    "type": "Text"},
      {"id": "Supervisor",   "type": "RefList:Employees"},
    ]])
    # Add display column
    supervisor_col = self.get_col_rec(tableId="Employees", colId="Supervisor")
    self.apply_user_action(["SetDisplayFormula",
                            "Employees", None, supervisor_col.id, "$Supervisor.Name"])
    name_col = self.get_col_rec(tableId="Employees", colId="Name")
    # Update visibleCol
    self.engine.docmodel.update([supervisor_col], visibleCol=name_col.id)

    Alice = 1
    Bob = 2
    Charlie = 3

    # Add Alice and Bob and then make Bob a supervisor of Alice (one of)
    self.apply_user_action(["AddRecord", "Employees", None, {"Name": "Alice"}])
    self.apply_user_action(["AddRecord", "Employees", None, {"Name": "Bob"}])
    self.apply_user_action(["UpdateRecord", "Employees", Alice, {"Supervisor": ['L', Bob]}])
    self.apply_user_action(["UpdateRecord", "Employees", Bob, {"Supervisor": ['L']}])
    self.apply_user_action(["AddRecord", "Employees", None, {"Name": "Charlie",
      "Supervisor": ['L', Alice, Bob]}])

    # Make sure we see the data
    self.assertTableData("Employees", cols="subset", data=[
      ["id", "Name", "Supervisor"],
      [Alice, "Alice", [Bob]],
      [Bob, "Bob", EmptyList],
      [Charlie, "Charlie", [Alice, Bob]],
    ])

    # Now change Supervisor to Ref, it shouldn't trim anything as we don't have 2-way references
    self.apply_user_action(["ModifyColumn", "Employees", "Supervisor", {"type": "Ref:Employees"}])
    self.assertTableData("Employees", cols="subset", data=[
      ["id", "Name", "Supervisor"],
      [Alice, "Alice", Bob],
      [Bob, "Bob", Empty],
      [Charlie, "Charlie", Alice],    # TODO: is this what we want???
    ])

  def test_reassign_references(self):
    self.load_pets()
    # Add pluto
    self.apply_user_action(["AddRecord", "Pets", Pluto, {"Name": "Pluto"}])

    # Make reverse column
    self.apply_user_action(["AddReverseColumn", 'Pets', 'Owner'])

    # Add pluto to bob, using Owners table
    self.apply_user_action(["UpdateRecord", "Owners", Bob, {"Pets": ['L', Rex, Pluto]}])


  def test_renames_of_reverse_cols(self):
    self.load_pets()

    # Add a reverse column
    out_actions = self.apply_user_action(["AddReverseColumn", 'Pets', 'Owner'])

    # Rename one column to check there are no errorrs. (Use a UserAction as from the frontend.)
    pets_col = out_actions.retValues[0]['colRef']
    self.apply_user_action(["UpdateRecord", "_grist_Tables_column", pets_col, {"label": "Bots"}])

    # Rename the other column.
    owner_col = self.get_col_rec(tableId="Pets", colId="Owner")
    self.apply_user_action(["UpdateRecord", "_grist_Tables_column", owner_col.id, {"label": "Man"}])

    # This is our initial data.
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Man"],
      [1, "Rex", Bob],
    ])
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Bots"],
      [1, "Alice", EmptyList],
      [2, "Bob", [Rex]],
    ])

    # Update a reference, and check that the resulting data respected reverse references.
    self.apply_user_action(["UpdateRecord", "Pets", 1, {"Name": "Rex", "Man": Alice}])
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Man"],
      [1, "Rex", Alice],
    ])
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Bots"],
      [1, "Alice", [Rex]],
      [2, "Bob", EmptyList],
    ])


  def test_honors_uniqueness(self):
    self.load_pets()
    # Add reverse column right away
    self.apply_user_action(["AddReverseColumn", 'Pets', 'Owner'])
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Pets"],
      [1, "Alice", EmptyList],
      [2, "Bob", [Rex]],
    ])
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [Rex, "Rex", Bob],
    ])
    # Now take Rex away from Bob (using Owners table)
    self.apply_user_action(["UpdateRecord", "Owners", Bob, {"Pets": EmptyList}])
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Pets"],
      [1, "Alice", EmptyList],
      [2, "Bob", EmptyList],
    ])
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [Rex, "Rex", Empty],
    ])
    # And give Rex to Alice, also using Owners table
    self.apply_user_action(["UpdateRecord", "Owners", Alice, {"Pets": ['L', Rex]}])
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Pets"],
      [1, "Alice", [Rex]],
      [2, "Bob", EmptyList],
    ])
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [Rex, "Rex", Alice],
    ])
    # Now try to fail, give Rex also to Bob
    with self.assertRaises(Exception):
      self.apply_user_action(["UpdateRecord", "Owners", Bob, {"Pets": ['L', Rex]}])


  def test_checks_source_column_for_uniqueness(self):
    self.load_pets()
    self.apply_user_action(["AddReverseColumn", 'Pets', 'Owner'])

    # Now move Rex to Alice using Owners table but first clear Bob's record, it should work
    # as engine will check source column not target column for uniqueness.
    self.engine.apply_user_actions([useractions.from_repr(ua) for ua in [
      ['UpdateRecord', 'Owners', Bob, {'Pets': None}],
      ['UpdateRecord', 'Owners', Alice, {'Pets': ['L', Rex]}],
    ]])
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Pets"],
      [1, "Alice", [Rex]],
      [2, "Bob", EmptyList],
    ])
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [Rex, "Rex", Alice],
    ])

  def test_uses_new_column_after_modify(self):
    self.load_pets()
    self.apply_user_action(["AddReverseColumn", 'Pets', 'Owner'])

    # The reverse column is RefList:Pets, change it to Ref:Pets and back to RefList:Pets
    self.apply_user_action(["ModifyColumn", "Owners", "Pets", {"type": "Ref:Pets"}])
    self.apply_user_action(["ModifyColumn", "Owners", "Pets", {"type": "RefList:Pets"}])

    # Make sure data is still valid
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Pets"],
      [1, "Alice", EmptyList],
      [2, "Bob", [Rex]],
    ])
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [Rex, "Rex", Bob],
    ])

    # Now clear Bob from Rex via Pets table.
    self.apply_user_action(["UpdateRecord", "Pets", Rex, {"Owner": None}])

    # Make sure data is still valid
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Pets"],
      [1, "Alice", EmptyList],
      [2, "Bob", EmptyList],
    ])
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [Rex, "Rex", Empty],
    ])


  def test_clears_flags_after_removal(self):
    self.load_pets()
    self.apply_user_action(["AddReverseColumn", 'Pets', 'Owner'])

    # The reverse column is RefList:Owner with a unique flag set on it.
    pets_col = self.get_col_rec(tableId="Owners", colId="Pets")
    self.assertTrue(uniqueReferences(pets_col))
    self.assertEqual(pets_col.type, "RefList:Pets")

    # Now remove the original column.
    self.apply_user_action(["RemoveColumn", 'Pets', 'Owner'])
    pets_col = self.get_col_rec(tableId="Owners", colId="Pets")

    # Unique flag should be cleared.
    self.assertEqual(pets_col.type, "RefList:Pets")
    self.assertFalse(uniqueReferences(pets_col), "Flag is not cleared")

    # And add it back, but through Owners table
    self.apply_user_action(["AddReverseColumn", 'Owners', 'Pets'])
    owner_col = self.get_col_rec(tableId="Pets", colId="Owners")

    # It should be RefList:Owners and unique flag should be cleared.
    self.assertEqual(owner_col.type, "RefList:Owners")
    self.assertFalse(uniqueReferences(owner_col))


  def test_break_connection_when_type_is_changed_in_source(self):
    self.load_pets()
    self.apply_user_action(["AddReverseColumn", 'Pets', 'Owner'])

    # Now change the type of source column to point to a different table.
    with self.assertRaises(ValueError):
      self.apply_user_action(["ModifyColumn", "Pets", "Owner", {"type": "Ref:Pets"}])
    self.assertEqual(self.get_col_rec(tableId="Pets", colId="Owner").type, "Ref:Owners")

    # To change type, have to break the reference explicitly.
    self.apply_user_action(["ModifyColumn", "Pets", "Owner", {"type": "Ref:Pets", "reverseCol": 0}])

    # And make sure that the connection is broken.
    owner_col = self.get_col_rec(tableId="Pets", colId="Owner")
    pets_col = self.get_col_rec(tableId="Owners", colId="Pets")

    self.assertEqual(owner_col.type, "Ref:Pets")
    self.assertFalse(pets_col.reverseCol)
    self.assertFalse(owner_col.reverseCol)

  def test_break_connection_when_type_is_changed_in_target(self):
    self.load_pets()
    self.apply_user_action(["AddReverseColumn", 'Pets', 'Owner'])

    # Now change the type of target column to point to a different table.
    with self.assertRaises(ValueError):
      self.apply_user_action(["ModifyColumn", "Owners", "Pets", {"type": "Ref:Owners"}])

    # To change type, have to break the reference explicitly.
    self.apply_user_action(
        ["ModifyColumn", "Owners", "Pets", {"type": "Ref:Owners", "reverseCol": 0}])

    # And make sure that the connection is broken.
    owner_col = self.get_col_rec(tableId="Pets", colId="Owner")
    pets_col = self.get_col_rec(tableId="Owners", colId="Pets")

    self.assertEqual(pets_col.type, "Ref:Owners")
    self.assertFalse(pets_col.reverseCol)
    self.assertFalse(owner_col.reverseCol)

  def test_can_delete_target_table(self):
    self.load_pets()
    self.apply_user_action(["AddReverseColumn", 'Pets', 'Owner'])

    # Remove visible column, to avoid convertions
    self.apply_user_action(["ModifyColumn", "Pets", "Owner",
                            {"visibleCol": None, "displayCol": None}])
    # Same for the reverse
    self.apply_user_action(["ModifyColumn", "Owners", "Pets",
                            {"visibleCol": None, "displayCol": None}])

    # Now remove the Owners table
    self.apply_user_action(["RemoveTable", 'Owners'])

    # And make sure that the reverse column is removed.
    pets_col = self.get_col_rec(tableId="Pets", colId="Owner")
    self.assertFalse(pets_col.reverseCol)

  def test_can_delete_source_table(self):
    self.load_pets()
    self.apply_user_action(["AddReverseColumn", 'Pets', 'Owner'])

    # Remove visible column, to avoid convertions
    self.apply_user_action(["ModifyColumn", "Pets", "Owner",
                            {"visibleCol": None, "displayCol": None}])
    # Same for the reverse
    self.apply_user_action(["ModifyColumn", "Owners", "Pets",
                            {"visibleCol": None, "displayCol": None}])

    # Now remove the Pets table
    self.apply_user_action(["RemoveTable", 'Pets'])

    # And make sure that the reverse column is removed.
    owners_col = self.get_col_rec(tableId="Owners", colId="Pets")
    self.assertFalse(owners_col.reverseCol)
    self.assertEqual(owners_col.type, "Text")

  def test_keeps_user_order_for_ref_list(self):
    self.load_pets()
    self.apply_user_action(["AddReverseColumn", 'Pets', 'Owner'])

    # Add Azor and Pluto
    self.apply_user_action(["AddRecord", "Pets", Azor, {"Name": "Azor"}])
    self.apply_user_action(["AddRecord", "Pets", Pluto, {"Name": "Pluto"}])

    # Remove Rex from Bob, using Pets table
    self.apply_user_action(["UpdateRecord", "Pets", Rex, {"Owner": None}])

    # Now move all pets to Alice but in different order
    self.apply_user_action(["UpdateRecord", "Owners", Alice, {"Pets": ['L', Pluto, Azor, Rex]}])

    # Make sure we see the data
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Pets"],
      [1, "Alice", [Pluto, Azor, Rex]],
      [2, "Bob", EmptyList],
    ])

  def test_track_changes_after_type_undo(self):
    self.load_pets()
    self.apply_user_action(["AddReverseColumn", 'Pets', 'Owner'])

    # And now move Rex to Alice using Pets table
    self.apply_user_action(["UpdateRecord", "Pets", Rex, {"Owner": Alice}])

    # And check owners table
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Pets"],
      [1, "Alice", [Rex]],
      [2, "Bob", EmptyList],
    ])

    # Now change this column to Text and then undo it, this will break the connection
    out_actions = self.apply_user_action(["ModifyColumn", "Owners", "Pets", {"type": "Text",
      "reverseCol": 0}])

    # Do the undo.
    undo_actions = out_actions.get_repr()["undo"]
    self.apply_user_action(['ApplyUndoActions', undo_actions])

    # And now move Rex to Bob using Pets table
    self.apply_user_action(["UpdateRecord", "Pets", Rex, {"Owner": Bob}])

    # And check owners table
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Pets"],
      [1, "Alice", EmptyList],
      [2, "Bob", [Rex]],
    ])

  def test_reverse_of_invalid_refs(self):
    self.load_pets()

    # Check that if we have an invalid value in the Ref column, it's handled on adding a reverse.
    self.apply_user_action(["UpdateRecord", "Pets", Rex, {"Owner": "invalid"}])
    self.apply_user_action(["AddRecord", "Pets", Pluto, {"Name": "Pluto", "Owner": Bob}])
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [Rex, "Rex", "invalid"],
      [Pluto, "Pluto", Bob],
    ])
    self.apply_user_action(["AddReverseColumn", 'Pets', 'Owner'])
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Pets"],
      [1, "Alice", EmptyList],
      [2, "Bob", [Pluto]],
    ])

    # Check that setting an invalid value is handled in the presence of a reverse column.
    self.apply_user_action(["UpdateRecord", "Pets", Pluto, {"Owner": "invalid2"}])
    self.apply_user_action(["UpdateRecord", "Pets", Rex, {"Owner": Alice}])
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [Rex, "Rex", Alice],
      [Pluto, "Pluto", "invalid2"],
    ])
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Pets"],
      [1, "Alice", [Rex]],
      [2, "Bob", EmptyList],
    ])

    # Check that setting an invalid value on a ReferenceList is handled.
    self.apply_user_action(["UpdateRecord", "Owners", Bob, {"Pets": ['L', Pluto]}])
    self.apply_user_action(["UpdateRecord", "Owners", Alice, {"Pets": "invalid3"}])
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Pets"],
      [1, "Alice", "invalid3"],
      [2, "Bob", [Pluto]],
    ])
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [Rex, "Rex", Empty],
      [Pluto, "Pluto", Bob],
    ])

  def test_display_cols_for_type_changes(self):
    self.load_pets()

    # Initially no displayCol.
    owner_col = self.get_col_rec(tableId="Pets", colId="Owner")
    self._check_display_col(owner_col, "Ref:Owners", None, None)

    # A reverseCol has a displayCol by default.
    self.apply_user_action(["AddReverseColumn", 'Pets', 'Owner'])
    pets_col = self.get_col_rec(tableId="Owners", colId="Pets")
    self._check_display_col(pets_col, "RefList:Pets", "Name", "$Pets.Name")

    # Change to single Ref, check that displayCol is unchanged.
    self.apply_user_action(["ModifyColumn", 'Owners', 'Pets', {"type": "Ref:Pets"}])
    self._check_display_col(pets_col, "Ref:Pets", "Name", "$Pets.Name")

    # Change to wrong Ref; check that displayCol is unset.
    out_actions = self.apply_user_action(
        ["ModifyColumn", 'Owners', 'Pets', {"type": "Ref:Owners", "reverseCol": 0}])
    self._check_display_col(pets_col, "Ref:Owners", None, None)

    # Undo.
    undo_actions = out_actions.get_repr()["undo"]
    out_actions = self.apply_user_action(['ApplyUndoActions', undo_actions])
    self._check_display_col(pets_col, "Ref:Pets", "Name", "$Pets.Name")

    # Change to different type; again displayCol should get unset.
    out_actions = self.apply_user_action(
        ["ModifyColumn", 'Owners', 'Pets', {"type": "Numeric", "reverseCol": 0}])
    self._check_display_col(pets_col, "Numeric", None, None)


  def _check_display_col(self, ref_col, expect_type, expect_visible_col_id, expect_display_formula):
    t = self.engine.docmodel.columns.table
    self.assertEqual(ref_col.type, expect_type)
    visible_col_id = t.get_record(ref_col.visibleCol.id).colId if ref_col.visibleCol else None
    display_formula = t.get_record(ref_col.displayCol.id).formula if ref_col.displayCol else None
    self.assertEqual(visible_col_id, expect_visible_col_id)
    self.assertEqual(display_formula, expect_display_formula)



  def test_convert_column(self):
    # There was a bug with changing RefList to Ref using the CopyFromColumn action. In case of an
    # error in column, the reverse column wasn't updated properly.
    self.load_pets()

    # Rename Bob to Roger and add Penny
    Roger = Bob
    self.apply_user_action(["UpdateRecord", "Owners", Roger, {"Name": "Roger"}])
    self.apply_user_action(["AddRecord", "Owners", Penny, {"Name": "Penny"}])

    # Add Pluto owned by Penny and Azor owned by Alice
    self.apply_user_action(["AddRecord", "Pets", Pluto, {"Name": "Pluto", "Owner": Penny}])
    self.apply_user_action(["AddRecord", "Pets", Azor, {"Name": "Azor", "Owner": Alice}])

    # Now add reverse column Pets to table Owners (by using Owner column in Pets table)
    self.apply_user_action(["AddReverseColumn", 'Pets', 'Owner'])

    # Assert table data
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name"],
      [1, "Alice", [Azor]],
      [2, "Roger", [Rex]],
      [3, "Penny", [Pluto]],
    ])

    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [Rex, "Rex", Roger],
      [Pluto, "Pluto", Penny],
      [Azor, "Azor", Alice],
    ])

    # Now remove Pluto from Penny and add it to Roger.
    self.apply_user_action(["UpdateRecord", "Owners", Penny, {"Pets": None}])
    self.apply_user_action(["UpdateRecord", "Owners", Roger, {"Pets": ['L', Rex, Pluto]}])

    # Take snapshot of data.
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name"],
      [1, "Alice", [Azor]],
      [2, "Roger", [Rex, Pluto]],
      [3, "Penny", EmptyList],
    ])
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [Rex, "Rex", Roger],
      [Pluto, "Pluto", Roger],
      [Azor, "Azor", Alice],
    ])

    # Now generate errors using CopyFromColumn action. We won't reproduce the full flow of type
    # conversion (as it requires node engine), so we will add dummy column and convert it from it.

    # Add dummy column with semi valid values.
    self.apply_user_action(["AddColumn", "Owners", "Dummy", {"type": "Ref:Pets"}])

    # Generate almost good data, trim list with single value, and add strings for list with
    # multiple values.
    self.apply_user_action(["BulkUpdateRecord", "Owners", [1, 2, 3], {
      "Dummy": [Azor, 'Rex, Pluto', Empty]
    }])

    # And than use CopyFromColumn to copy that from Dummy column to Pets column transforming
    # it in the process. There was a bug here, this action was modifying data directly, bypassing
    # two way references.
    pets_col = self.get_col_rec(tableId="Pets", colId="Owner")
    self.apply_user_action(
      ["CopyFromColumn", "Owners", "Dummy", "Pets", None]
    )

    # And make sure we see the breakage.
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name"],
      [1, "Alice", [Azor]],
      [2, "Roger", "Rex, Pluto"],
      [3, "Penny", EmptyList],
    ])
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [Rex, "Rex", Empty],
      [Pluto, "Pluto", Empty],
      [Azor, "Azor", Alice],
    ])

  def test_back_update_empty_column(self):
    """
    There was a bug. When user cretes a reverse column for an empty column, and then updates the
    reverse column first, the empty column wasn't updated (as it was seen as empty).
    """

    # Load pets sample
    self.load_pets()

    # Remove owner and add it back as empty column.
    self.apply_user_action(["RemoveColumn", "Pets", "Owner"])
    self.apply_user_action(["AddColumn", "Pets", "Owner", {
      "type": "Ref:Owners",
      "isFormula": True,
      "formula": '',
    }])

    # Now add reverse column for Owner
    self.apply_user_action(["AddReverseColumn", 'Pets', 'Owner'])

    # And now add Rex with Alice as an owner using Owners table
    self.apply_user_action(["UpdateRecord", "Owners", Alice, {"Pets": ['L', Rex]}])

    # Make sure we see the data
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Pets"],
      [1, "Alice", [Rex]],
      [2, "Bob", EmptyList],
    ])

    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [Rex, "Rex", Alice],
    ])

  def test_back_loop(self):
    """
    Test that updating reverse column doesn't cause infinite loop.
    """

    # Load pets sample.
    self.load_pets()

    # Add reverse column for Owner.
    self.apply_user_action(["AddReverseColumn", 'Pets', 'Owner'])

    # Convert Pets to Ref:Owners.
    self.apply_user_action(["ModifyColumn", "Owners", "Pets", {"type": "Ref:Pets"}])

    # Check the data.
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [1, "Rex", Bob],
    ])

    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Pets"],
      [1, "Alice", Empty],
      [2, "Bob", Rex],
    ])

    # Now move Rex to Alice using Pets table.
    self.apply_user_action(["UpdateRecord", "Pets", Rex, {"Owner": Alice}])


  def test_remove_in_bulk(self):
    """
    Test that we can remove many rows at the same time. PReviously it ended up in an error,
    as the reverse column was trying to update the removed row.
    """

    # Load pets sample.
    self.load_pets()

    # Add another dog.
    self.apply_user_action(["AddRecord", "Pets", Pluto, {"Name": "Pluto"}])

    # Add reverse column for Owner.
    self.apply_user_action(["AddReverseColumn", 'Pets', 'Owner'])

    # Add Pluto to Bob.
    self.apply_user_action(["UpdateRecord", "Pets", Pluto, {"Owner": Alice}])

    # Test the data.
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
      [Rex, "Rex", Bob],
      [Pluto, "Pluto", Alice],
    ])
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Pets"],
      [1, "Alice", [Pluto]],
      [2, "Bob", [Rex]],
    ])

    # Now remove both dogs.
    self.apply_user_action(["BulkRemoveRecord", "Pets", [Rex, Pluto]])

    # Make sure we see the data.
    self.assertTableData("Pets", cols="subset", data=[
      ["id", "Name", "Owner"],
    ])
    self.assertTableData("Owners", cols="subset", data=[
      ["id", "Name", "Pets"],
      [1, "Alice", EmptyList],
      [2, "Bob", EmptyList],
    ])


if __name__ == "__main__":
  unittest.main()
