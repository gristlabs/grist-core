import time
import logging
import testutil
import test_engine

log = logging.getLogger(__name__)

class TestDefaultFormulas(test_engine.EngineTestCase):
  sample = testutil.parse_test_sample({
    "SCHEMA": [
      [1, "Customers", [
        [1, "Name",       "Text",           False, "", "", ""],
        [2, "Region",     "Ref:Regions",    False, "", "", ""],
        [3, "RegName",    "Text",           True,  "$Region.Region", "", ""],
        [4, "SalesRep",   "Text",           False, "$Region.Rep", "", ""],
        [5, "CID",        "Int",            False, "$id + 1000", "", ""],
      ]],
      [2, "Regions", [
        [11, "Region",    "Text",           False, "", "", ""],
        [12, "Rep",       "Text",           False, "", "", ""]
      ]],
    ],
    "DATA": {
      "Customers": [
        ["id","Name",     "Region",   "SalesRep", "CID"],
        [1,   "Dolphin",  2,          "Neptune",  0 ],
      ],
      "Regions": [
        ["id",  "Region",     "Rep"],
        [1,     "Pacific",    "Watatsumi"],
        [2,     "Atlantic",   "Poseidon"],
        [3,     "Indian",     "Neptune"],
        [4,     "Arctic",     "Poseidon"],
      ],
    }
  })

  def test_default_formula_plain(self):
    self.load_sample(self.sample)

    # The defaults don't affect data that's loaded
    self.assertTableData("Customers", data=[
      ["id","Name",     "Region", "RegName",    "SalesRep", "CID" ],
      [1,   "Dolphin",  2,        "Atlantic",   "Neptune",         0],
    ])

    # Defaults affect new records
    self.add_record("Customers", Name="Shark", Region=2)
    self.add_record("Customers", Name="Squid", Region=1)
    self.assertTableData("Customers", data=[
      ["id","Name",     "Region", "RegName",    "SalesRep", "CID"],
      [1,   "Dolphin",  2,        "Atlantic",   "Neptune",  0],
      [2,   "Shark",    2,        "Atlantic",   "Poseidon", 1002],    # New record
      [3,   "Squid",    1,        "Pacific",    "Watatsumi",1003],    # New record
    ])

    # Changed defaults don't affect previously-added records
    self.modify_column('Customers', 'CID', formula='$id + 2000')
    self.add_record("Customers", Name="Hammerhead", Region=3)
    self.assertTableData("Customers", data=[
      ["id","Name",     "Region", "RegName",    "SalesRep", "CID"],
      [1,   "Dolphin",  2,        "Atlantic",   "Neptune",  0],
      [2,   "Shark",    2,        "Atlantic",   "Poseidon", 1002],
      [3,   "Squid",    1,        "Pacific",    "Watatsumi",1003],
      [4,   "Hammerhead", 3,      "Indian",     "Neptune",  2004],    # New record
    ])

    # Defaults don't affect changes to existing records
    self.update_record("Customers", 2, Region=3)
    self.assertTableData("Customers", data=[
      ["id","Name",     "Region", "RegName",    "SalesRep", "CID"],
      [1,   "Dolphin",  2,        "Atlantic",   "Neptune",  0],
      [2,   "Shark",    3,        "Indian",     "Poseidon", 1002],    # Region changed
      [3,   "Squid",    1,        "Pacific",    "Watatsumi",1003],
      [4,   "Hammerhead", 3,      "Indian",     "Neptune",  2004],
    ])


  def test_default_formula_with_lookups(self):
    self.load_sample(self.sample)
    self.modify_column('Customers', 'RegName', isFormula=False, formula="")
    self.modify_column('Customers', 'Region', isFormula=False,
        formula="Regions.lookupOne(Region=$RegName)")
    self.assertTableData("Customers", data=[
      ["id","Name",     "Region", "RegName",    "SalesRep", "CID" ],
      [1,   "Dolphin",  2,        "Atlantic",   "Neptune",  0],
    ])

    # Lookup-based defaults work.
    self.add_record("Customers", Name="Shark", RegName="Atlantic")
    self.add_record("Customers", Name="Squid", RegName="Pacific")
    self.assertTableData("Customers", data=[
      ["id","Name",     "Region", "RegName",    "SalesRep", "CID"],
      [1,   "Dolphin",  2,        "Atlantic",   "Neptune",  0],
      [2,   "Shark",    2,        "Atlantic",   "Poseidon", 1002],    # New record
      [3,   "Squid",    1,        "Pacific",    "Watatsumi",1003],    # New record
    ])

  def test_time_defaults(self):
    self.load_sample(self.sample)
    self.add_column('Customers', 'AddTime',
        type="DateTime:America/Los_Angeles", isFormula=False, formula="NOW()")
    self.add_column('Customers', 'AddDate',
        type="Date", isFormula=False, formula="TODAY()")

    self.assertTableData("Customers", data=[
      ["id","Name",     "Region", "RegName",    "SalesRep", "CID",  "AddTime",  "AddDate" ],
      [1,   "Dolphin",  2,        "Atlantic",   "Neptune",  0,      None,       None      ],
    ])
    self.add_record("Customers", Name="Shark", Region=2)
    self.add_record("Customers", Name="Squid", Region=1)

    now = time.time()
    midnight = now - (now % (24*60*60))

    # Check columns except AddTime, which we check separately below.
    self.assertTableData("Customers", cols="subset", data=[
      ["id","Name",     "Region", "RegName",    "SalesRep", "CID",  "AddDate"],
      [1,   "Dolphin",  2,        "Atlantic",   "Neptune",  0,      None],
      [2,   "Shark",    2,        "Atlantic",   "Poseidon", 1002,   midnight],    # New record
      [3,   "Squid",    1,        "Pacific",    "Watatsumi",1003,   midnight],    # New record
    ])

    # AddTime column is hard to be precise about, check it separately. Note that the timestamp
    # does not depend on timezone, and should not change based on the timezone in the column type.
    observed_data = self.engine.fetch_table('Customers')
    self.assertEqual(observed_data.columns['AddTime'][0], None)
    self.assertLessEqual(abs(observed_data.columns['AddTime'][1] - now), 2)
    self.assertLessEqual(abs(observed_data.columns['AddTime'][2] - now), 2)
