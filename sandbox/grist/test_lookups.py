import logging
import actions

import testsamples
import testutil
import test_engine

log = logging.getLogger(__name__)

def _bulk_update(table_name, col_names, row_data):
  return actions.BulkUpdateRecord(
    *testutil.table_data_from_rows(table_name, col_names, row_data))

class TestLookups(test_engine.EngineTestCase):

  def test_verify_sample(self):
    self.load_sample(testsamples.sample_students)
    self.assertPartialData("Students", ["id", "schoolIds", "schoolCities" ], [
      [1,   "1:2",  "New York:Colombia" ],
      [2,   "3:4",  "New Haven:West Haven" ],
      [3,   "1:2",  "New York:Colombia" ],
      [4,   "3:4",  "New Haven:West Haven" ],
      [5,   "",     ""],
      [6,   "3:4",  "New Haven:West Haven" ]
    ])


  #----------------------------------------
  def test_lookup_dependencies(self, pre_loaded=False):
    """
    Test changes to records accessed via lookup.
    """
    if not pre_loaded:
      self.load_sample(testsamples.sample_students)

    out_actions = self.update_record("Address", 14, city="Bedford")
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.UpdateRecord("Address", 14, {"city": "Bedford"}),
        _bulk_update("Students", ["id", "schoolCities" ], [
          [2,   "New Haven:Bedford" ],
          [4,   "New Haven:Bedford" ],
          [6,   "New Haven:Bedford" ]]
        )
      ],
      "calls": {"Students": {"schoolCities": 3}}
    })

    out_actions = self.update_record("Schools", 4, address=13)
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.UpdateRecord("Schools", 4, {"address": 13}),
        _bulk_update("Students", ["id", "schoolCities" ], [
          [2,   "New Haven:New Haven" ],
          [4,   "New Haven:New Haven" ],
          [6,   "New Haven:New Haven" ]]
        )
      ],
      "calls": {"Students": {"schoolCities": 3}}
    })

    out_actions = self.update_record("Address", 14, city="Hartford")
    # No schoolCities need to be recalculatd here, since nothing depends on Address 14 any more.
    self.assertPartialOutActions(out_actions, {
      "calls": {}
    })

    # Confirm the final result.
    self.assertPartialData("Students", ["id", "schoolIds", "schoolCities" ], [
      [1,   "1:2",  "New York:Colombia" ],
      [2,   "3:4",  "New Haven:New Haven" ],
      [3,   "1:2",  "New York:Colombia" ],
      [4,   "3:4",  "New Haven:New Haven" ],
      [5,   "",     ""],
      [6,   "3:4",  "New Haven:New Haven" ]
    ])

  #----------------------------------------
  def test_dependency_reset(self, pre_loaded=False):
    """
    A somewhat tricky case. We know that Student 2 depends on Schools 3,4 and on Address 13,14.
    If we change Student 2 to depend on nothing, then changing Address 13 should not cause it to
    recompute.
    """
    if not pre_loaded:
      self.load_sample(testsamples.sample_students)

    out_actions = self.update_record("Address", 13, city="AAA")
    self.assertPartialOutActions(out_actions, {
      "calls": {"Students": {"schoolCities": 3}}    # Initially 3 students depend on Address 13.
    })

    out_actions = self.update_record("Students", 2, schoolName="Invalid")

    out_actions = self.update_record("Address", 13, city="BBB")
    # If the count below is 3, then the engine forgot to reset the dependencies of Students 2.
    self.assertPartialOutActions(out_actions, {
      "calls": {"Students": {"schoolCities": 2}}    # Now only 2 Students depend on Address 13.
    })

  #----------------------------------------
  def test_lookup_key_changes(self, pre_loaded=False):
    """
    Test changes to lookup values in the target table. Note that student #3 does not depend on
    any records, but depends on the value "Eureka", so gets updated when this value appears.
    """
    if not pre_loaded:
      self.load_sample(testsamples.sample_students)

    out_actions = self.update_record("Schools", 2, name="Eureka")
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.UpdateRecord("Schools", 2, {"name": "Eureka"}),
        actions.BulkUpdateRecord("Students", [1,3,5], {
          'schoolCities': ["New York", "New York", "Colombia"]
        }),
        actions.BulkUpdateRecord("Students", [1,3,5], {
          'schoolIds': ["1", "1","2"]
        }),
      ],
      "calls": {"Students": { 'schoolCities': 3, 'schoolIds': 3 },
                "Schools": {'#lookup#name': 1} },
    })

    # Test changes to lookup values in the table doing the lookup.
    out_actions = self.update_records("Students", ["id", "schoolName"], [
      [3, ""],
      [5, "Yale"]
    ])
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.BulkUpdateRecord("Students", [3,5], {'schoolName': ["", "Yale"]}),
        actions.BulkUpdateRecord("Students", [3,5], {'schoolCities': ["", "New Haven:West Haven"]}),
        actions.BulkUpdateRecord("Students", [3,5], {'schoolIds': ["", "3:4"]}),
      ],
      "calls": { "Students": { 'schoolCities': 2, 'schoolIds': 2 } },
    })

    # Confirm the final result.
    self.assertPartialData("Students", ["id", "schoolIds", "schoolCities" ], [
      [1,   "1",    "New York" ],
      [2,   "3:4",  "New Haven:West Haven" ],
      [3,   "",     "" ],
      [4,   "3:4",  "New Haven:West Haven" ],
      [5,   "3:4",  "New Haven:West Haven" ],
      [6,   "3:4",  "New Haven:West Haven" ]
    ])


  #----------------------------------------
  def test_lookup_formula_after_schema_change(self):
    self.load_sample(testsamples.sample_students)
    self.add_column("Schools", "state", type="Text")

    # Make a change that causes recomputation of a lookup formula after a schema change.
    # We should NOT get attribute errors in the values.
    out_actions = self.update_record("Schools", 4, address=13)
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.UpdateRecord("Schools", 4, {"address": 13}),
        _bulk_update("Students", ["id", "schoolCities" ], [
          [2,   "New Haven:New Haven" ],
          [4,   "New Haven:New Haven" ],
          [6,   "New Haven:New Haven" ]]
        )
      ],
      "calls": { "Students": { 'schoolCities': 3 } }
    })


  #----------------------------------------
  def test_lookup_formula_changes(self):
    self.load_sample(testsamples.sample_students)

    self.add_column("Schools", "state", type="Text")
    self.update_records("Schools", ["id", "state"], [
      [1, "NY"],
      [2, "MO"],
      [3, "CT"],
      [4, "CT"]
    ])

    # Verify that when we change a formula, we get appropriate changes.
    out_actions = self.modify_column("Students", "schoolCities", formula=(
      "','.join(Schools.lookupRecords(name=$schoolName).state)"))
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.ModifyColumn("Students", "schoolCities", {
          "formula": "','.join(Schools.lookupRecords(name=$schoolName).state)",
        }),
        actions.UpdateRecord("_grist_Tables_column", 6, {
          "formula": "','.join(Schools.lookupRecords(name=$schoolName).state)",
        }),
        _bulk_update("Students", ["id", "schoolCities" ], [
          [1,   "NY,MO" ],
          [2,   "CT,CT" ],
          [3,   "NY,MO" ],
          [4,   "CT,CT" ],
          [6,   "CT,CT" ]]
        )
      ],
      # Note that it got computed 6 times (once for each record), but one value remained unchanged
      # (because no schools matched).
      "calls": { "Students": { 'schoolCities': 6 } }
    })

    # Check that we've created new dependencies, and removed old ones.
    out_actions = self.update_record("Schools", 4, address=13)
    self.assertPartialOutActions(out_actions, {
      "calls": {}
    })

    out_actions = self.update_record("Schools", 4, state="MA")
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.UpdateRecord("Schools", 4, {"state": "MA"}),
        _bulk_update("Students", ["id", "schoolCities" ], [
          [2,   "CT,MA" ],
          [4,   "CT,MA" ],
          [6,   "CT,MA" ]]
        )
      ],
      "calls": { "Students": { 'schoolCities': 3 } }
    })

    # If we change to look up uppercase values, we shouldn't find anything.
    out_actions = self.modify_column("Students", "schoolCities", formula=(
      "','.join(Schools.lookupRecords(name=$schoolName.upper()).state)"))
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.ModifyColumn("Students", "schoolCities", {
          "formula": "','.join(Schools.lookupRecords(name=$schoolName.upper()).state)"
        }),
        actions.UpdateRecord("_grist_Tables_column", 6, {
          "formula": "','.join(Schools.lookupRecords(name=$schoolName.upper()).state)"
        }),
        actions.BulkUpdateRecord("Students", [1,2,3,4,6],
                                        {'schoolCities': ["","","","",""]})
      ],
      "calls": { "Students": { 'schoolCities': 6 } }
    })

    # Changes to dependencies should cause appropriate recalculations.
    out_actions = self.update_record("Schools", 4, state="KY", name="EUREKA")
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.UpdateRecord("Schools", 4, {"state": "KY", "name": "EUREKA"}),
        actions.UpdateRecord("Students", 5, {'schoolCities': "KY"}),
        actions.BulkUpdateRecord("Students", [2,4,6], {'schoolIds': ["3","3","3"]}),
      ],
      "calls": {"Students": { 'schoolCities': 1, 'schoolIds': 3 },
                'Schools': {'#lookup#name': 1 } }
    })

    self.assertPartialData("Students", ["id", "schoolIds", "schoolCities" ], [
      # schoolCities aren't found here because we changed formula to lookup uppercase names.
      [1,   "1:2",  "" ],
      [2,   "3",    "" ],
      [3,   "1:2",  "" ],
      [4,   "3",    "" ],
      [5,   "",     "KY" ],
      [6,   "3",    "" ]
    ])

  def test_add_remove_lookup(self):
    # Verify that when we add or remove a lookup formula, we get appropriate changes.
    self.load_sample(testsamples.sample_students)

    # Add another lookup formula.
    out_actions = self.add_column("Schools", "lastNames", formula=(
      "','.join(Students.lookupRecords(schoolName=$name).lastName)"))
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.AddColumn("Schools", "lastNames", {
          "formula": "','.join(Students.lookupRecords(schoolName=$name).lastName)",
          "isFormula": True, "type": "Any"
        }),
        actions.AddRecord("_grist_Tables_column", 22, {
          "colId": "lastNames",
          "formula": "','.join(Students.lookupRecords(schoolName=$name).lastName)",
          "isFormula": True, "label": "lastNames", "parentId": 2, "parentPos": 6.0,
          "type": "Any", "widgetOptions": ""
        }),
        _bulk_update("Schools", ["id", "lastNames"], [
          [1, "Obama,Clinton"],
          [2, "Obama,Clinton"],
          [3, "Bush,Bush,Ford"],
          [4, "Bush,Bush,Ford"]
        ]),
      ],
      "calls": {"Schools": {"lastNames": 4}, "Students": {"#lookup#schoolName": 6}},
    })

    # Make sure it responds to changes.
    out_actions = self.update_record("Students", 5, schoolName="Columbia")
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.UpdateRecord("Students", 5, {"schoolName": "Columbia"}),
        _bulk_update("Schools", ["id", "lastNames"], [
          [1, "Obama,Clinton,Reagan"],
          [2, "Obama,Clinton,Reagan"]]
        ),
        actions.UpdateRecord("Students", 5, {"schoolCities": "New York:Colombia"}),
        actions.UpdateRecord("Students", 5, {"schoolIds": "1:2"}),
      ],
      "calls": {"Students": {'schoolCities': 1, 'schoolIds': 1, '#lookup#schoolName': 1},
                "Schools": { 'lastNames': 2 }},
    })

    # Modify the column: in the process, the LookupMapColumn on Students.schoolName becomes unused
    # while the old formula column is removed, but used again when it's added. It should not have
    # to be rebuilt (so there should be no calls to recalculate the LookupMapColumn.
    out_actions = self.modify_column("Schools", "lastNames", formula=(
      "','.join(Students.lookupRecords(schoolName=$name).firstName)"))
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.ModifyColumn("Schools", "lastNames", {
          "formula": "','.join(Students.lookupRecords(schoolName=$name).firstName)"
        }),
        actions.UpdateRecord("_grist_Tables_column", 22, {
          "formula": "','.join(Students.lookupRecords(schoolName=$name).firstName)"
        }),
        _bulk_update("Schools", ["id", "lastNames"], [
          [1, "Barack,Bill,Ronald"],
          [2, "Barack,Bill,Ronald"],
          [3, "George W,George H,Gerald"],
          [4, "George W,George H,Gerald"]]
        )
      ],
      "calls": {"Schools": {"lastNames": 4}}
    })

    # Remove the new lookup formula.
    out_actions = self.remove_column("Schools", "lastNames")
    self.assertPartialOutActions(out_actions, {})    # No calc actions

    # Make sure that changes still work without errors.
    out_actions = self.update_record("Students", 5, schoolName="Eureka")
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.UpdateRecord("Students", 5, {"schoolName": "Eureka"}),
        actions.UpdateRecord("Students", 5, {"schoolCities": ""}),
        actions.UpdateRecord("Students", 5, {"schoolIds": ""}),
      ],
      # This should NOT have '#lookup#schoolName' recalculation because there are no longer any
      # formulas which do such a lookup.
      "calls": { "Students": {'schoolCities': 1, 'schoolIds': 1}}
    })


  def test_multi_column_lookups(self):
    """
    Check that we can do lookups by multiple columns.
    """
    self.load_sample(testsamples.sample_students)

    # Add a lookup formula which looks up a student matching on both first and last names.
    self.add_column("Schools", "bestStudent", type="Text")
    self.update_record("Schools", 1, bestStudent="Bush,George W")
    self.add_column("Schools", "bestStudentId", formula=("""
if not $bestStudent: return ""
ln, fn = $bestStudent.split(",")
return ",".join(str(r.id) for r in Students.lookupRecords(firstName=fn, lastName=ln))
"""))

    # Check data so far: only one record is filled.
    self.assertPartialData("Schools", ["id", "bestStudent", "bestStudentId" ], [
      [1,   "Bush,George W",  "2" ],
      [2,   "",  "" ],
      [3,   "",  "" ],
      [4,   "",  "" ],
    ])

    # Fill a few more records and check that we find records we should, and don't find those we
    # shouldn't.
    out_actions = self.update_records("Schools", ["id", "bestStudent"], [
      [2, "Clinton,Bill"],
      [3, "Norris,Chuck"],
      [4, "Bush,George H"],
    ])
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.BulkUpdateRecord("Schools", [2,3,4], {
          "bestStudent": ["Clinton,Bill", "Norris,Chuck", "Bush,George H"]
        }),
        actions.BulkUpdateRecord("Schools", [2, 4], {"bestStudentId": ["3", "4"]})
      ],
      "calls": {"Schools": {"bestStudentId": 3}}
    })
    self.assertPartialData("Schools", ["id", "bestStudent", "bestStudentId" ], [
      [1,   "Bush,George W",  "2" ],
      [2,   "Clinton,Bill",   "3" ],
      [3,   "Norris,Chuck",   "" ],
      [4,   "Bush,George H",  "4" ],
    ])

    # Now add more records, first matching only some of the lookup fields.
    out_actions = self.add_record("Students", firstName="Chuck", lastName="Morris")
    self.assertPartialOutActions(out_actions, {
      "calls": {
        # No calculations of anything Schools because nothing depends on the incomplete value.
        "Students": {
          "#lookup#firstName:lastName": 1, "schoolIds": 1, "schoolCities": 1, "#lookup#": 1
        }
      },
      "retValues": [7],
    })

    # If we add a matching record, then we get a calculation of a record in Schools
    out_actions = self.add_record("Students", firstName="Chuck", lastName="Norris")
    self.assertPartialOutActions(out_actions, {
      "calls": {
        "Students": {
          "#lookup#firstName:lastName": 1, "schoolIds": 1, "schoolCities": 1, "#lookup#": 1
        },
        "Schools": {"bestStudentId": 1}
      },
      "retValues": [8],
    })

    # And the data should be correct.
    self.assertPartialData("Schools", ["id", "bestStudent", "bestStudentId" ], [
      [1,   "Bush,George W",  "2" ],
      [2,   "Clinton,Bill",   "3" ],
      [3,   "Norris,Chuck",   "8" ],
      [4,   "Bush,George H",  "4" ],
    ])

  def test_record_removal(self):
    # Remove a record, make sure that lookup maps get updated.
    self.load_sample(testsamples.sample_students)

    out_actions = self.remove_record("Schools", 3)
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.RemoveRecord("Schools", 3),
        actions.BulkUpdateRecord("Students", [2,4,6], {
          "schoolCities": ["West Haven","West Haven","West Haven"]}),
        actions.BulkUpdateRecord("Students", [2,4,6], {
          "schoolIds": ["4","4","4"]}),
      ],
      "calls": {
        "Students": {"schoolIds": 3, "schoolCities": 3},
        # LookupMapColumn is also updated but via a different path (unset() vs method() call), so
        # it's not included in the count of formula calls.
      }
    })

    self.assertPartialData("Students", ["id", "schoolIds", "schoolCities" ], [
      [1,   "1:2",  "New York:Colombia" ],
      [2,   "4",    "West Haven" ],
      [3,   "1:2",  "New York:Colombia" ],
      [4,   "4",    "West Haven" ],
      [5,   "",     ""],
      [6,   "4",    "West Haven" ]
    ])

  def test_empty_relation(self):
    # Make sure that when a relation becomes empty, it doesn't get messed up.
    self.load_sample(testsamples.sample_students)

    # Clear out dependencies.
    self.update_records("Students", ["id", "schoolName"],
                        [ [i, ""] for i in [1,2,3,4,5,6] ])
    self.assertPartialData("Students", ["id", "schoolIds", "schoolCities" ],
                           [ [i, "", ""] for i in [1,2,3,4,5,6] ])

    # Make a number of changeas, to ensure they reuse rather than re-create _LookupRelations.
    self.update_record("Students", 2, schoolName="Yale")
    self.update_record("Students", 2, schoolName="Columbia")
    self.update_record("Students", 3, schoolName="Columbia")
    self.assertPartialData("Students", ["id", "schoolIds", "schoolCities" ], [
      [1,   "",     ""],
      [2,   "1:2",  "New York:Colombia" ],
      [3,   "1:2",  "New York:Colombia" ],
      [4,   "",     ""],
      [5,   "",     ""],
      [6,   "",     ""],
    ])

    # When we messed up the dependencies, this change didn't cause a corresponding update. Check
    # that it now does.
    self.remove_record("Schools", 2)
    self.assertPartialData("Students", ["id", "schoolIds", "schoolCities" ], [
      [1,   "",     ""],
      [2,   "1",    "New York" ],
      [3,   "1",    "New York" ],
      [4,   "",     ""],
      [5,   "",     ""],
      [6,   "",     ""],
    ])

  def test_lookups_of_computed_values(self):
    """
    Make sure that lookups get updated when the value getting looked up is a formula result.
    """
    self.load_sample(testsamples.sample_students)

    # Add a column like Schools.name, but computed, and change schoolIds to use that one instead.
    self.add_column("Schools", "cname", formula="$name")
    self.modify_column("Students", "schoolIds", formula=
                       "':'.join(str(id) for id in Schools.lookupRecords(cname=$schoolName).id)")

    self.assertPartialData("Students", ["id", "schoolIds" ], [
      [1,   "1:2"   ],
      [2,   "3:4"   ],
      [3,   "1:2"   ],
      [4,   "3:4"   ],
      [5,   ""      ],
      [6,   "3:4"   ],
    ])

    # Check that a change to School.name, which triggers a change to School.cname, causes a change
    # to the looked-up ids. The changes here should be the same as in test_lookup_key_changes
    # test, even though schoolIds depends on name indirectly.
    out_actions = self.update_record("Schools", 2, name="Eureka")
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.UpdateRecord("Schools", 2, {"name": "Eureka"}),
        actions.UpdateRecord("Schools", 2, {"cname": "Eureka"}),
        actions.BulkUpdateRecord("Students", [1,3,5], {
          'schoolCities': ["New York", "New York", "Colombia"]
        }),
        actions.BulkUpdateRecord("Students", [1,3,5], {
          'schoolIds': ["1", "1","2"]
        }),
      ],
      "calls": {"Students": { 'schoolCities': 3, 'schoolIds': 3 },
                "Schools": {'#lookup#name': 1, '#lookup#cname': 1, "cname": 1} },
    })

  def use_saved_lookup_results(self):
    """
    This sets up data so that lookupRecord results are stored in a column and used in another. Key
    tests that check lookup dependencies should work unchanged with this setup.
    """
    self.load_sample(testsamples.sample_students)

    # Split up Students.schoolCities into Students.schools and Students.schoolCities.
    self.add_column("Students", "schools", formula="Schools.lookupRecords(name=$schoolName)",
                    type="RefList:Schools")
    self.modify_column("Students", "schoolCities",
                       formula="':'.join(r.address.city for r in $schools)")

  # The following tests check correctness of dependencies when lookupResults are stored in one
  # column and used in another. They reuse existing test cases with modified data.
  def test_lookup_dependencies_reflist(self):
    self.use_saved_lookup_results()
    self.test_lookup_dependencies(pre_loaded=True)

    # Confirm the final result including the additional 'schools' column.
    self.assertPartialData("Students", ["id", "schools", "schoolIds", "schoolCities" ], [
      [1,   [1,2],  "1:2",  "New York:Colombia" ],
      [2,   [3,4],  "3:4",  "New Haven:New Haven" ],
      [3,   [1,2],  "1:2",  "New York:Colombia" ],
      [4,   [3,4],  "3:4",  "New Haven:New Haven" ],
      [5,   [],     "",     ""],
      [6,   [3,4],  "3:4",  "New Haven:New Haven" ]
    ])

  def test_dependency_reset_reflist(self):
    self.use_saved_lookup_results()
    self.test_dependency_reset(pre_loaded=True)

  def test_lookup_key_changes_reflist(self):
    # We can't run this test case unchanged since our new column changes too in this test.
    self.use_saved_lookup_results()
    out_actions = self.update_record("Schools", 2, name="Eureka")
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.UpdateRecord('Schools', 2, {'name': "Eureka"}),
        actions.BulkUpdateRecord("Students", [1,3,5], {
          'schoolCities': ["New York", "New York", "Colombia"]
        }),
        actions.BulkUpdateRecord("Students", [1,3,5], {
          'schoolIds': ["1", "1","2"]
        }),
        actions.BulkUpdateRecord('Students', [1,3,5], {'schools': [[1],[1],[2]]}),
      ],
      "calls": {"Students": { 'schools': 3, 'schoolCities': 3, 'schoolIds': 3 },
                "Schools": {'#lookup#name': 1} },
    })

    # Test changes to lookup values in the table doing the lookup.
    out_actions = self.update_records("Students", ["id", "schoolName"], [
      [3, ""],
      [5, "Yale"]
    ])
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.BulkUpdateRecord("Students", [3,5], {'schoolName': ["", "Yale"]}),
        actions.BulkUpdateRecord("Students", [3,5], {'schoolCities': ["", "New Haven:West Haven"]}),
        actions.BulkUpdateRecord("Students", [3,5], {'schoolIds': ["", "3:4"]}),
        actions.BulkUpdateRecord("Students", [3,5], {'schools': [[], [3,4]]}),
      ],
      "calls": { "Students": { 'schools': 2, 'schoolCities': 2, 'schoolIds': 2 } },
    })

    # Confirm the final result.
    self.assertPartialData("Students", ["id", "schools", "schoolIds", "schoolCities" ], [
      [1,   [1],    "1",    "New York" ],
      [2,   [3,4],  "3:4",  "New Haven:West Haven" ],
      [3,   [],     "",     "" ],
      [4,   [3,4],  "3:4",  "New Haven:West Haven" ],
      [5,   [3,4],  "3:4",  "New Haven:West Haven" ],
      [6,   [3,4],  "3:4",  "New Haven:West Haven" ]
    ])

  def test_dependencies_relations_bug(self):
    # We had a serious bug with dependencies, for which this test verifies a fix. Imagine Table2
    # has a formula a=Table1.lookupOne(A=$A), and b=$a.foo. When col A changes in Table1, columns
    # a and b in Table2 get recomputed. Each recompute triggers reset_rows() which is there to
    # clear lookup relations (it actually triggers reset_dependencies() which resets rows for the
    # relation on each dependency edge).
    #
    # The first recompute (of a) triggers reset_rows() on the LookupRelation, then recomputes the
    # lookup formula which re-populates the relation correctly. The second recompute (of b) also
    # triggers reset_rows(). The bug was that it was triggering it in the same LookupRelation, but
    # since it doesn't get followed with recomputing the lookup formula, the relation remains
    # incomplete.
    #
    # It's important that a formula like "b=$a.foo" doesn't reuse the LookupRelation by itself on
    # the edge between b and $a, but a composition of IdentityRelation and LookupRelation. The
    # composition will correctly forward reset_rows() to only the first half of the relation.

    # Set up two tables with a situation as described above. Here, the role of column Table2.a
    # above is taken by "Students.schools=Schools.lookupRecords(name=$schoolName)".
    self.use_saved_lookup_results()

    # We intentionally try behavior with type Any formulas too, without converting to a reference
    # type, in case that affects relations.
    self.modify_column("Students", "schools", type="Any")
    self.add_column("Students", "schoolsCount", formula="len($schools.name)")
    self.add_column("Students", "oneSchool", formula="Schools.lookupOne(name=$schoolName)")
    self.add_column("Students", "oneSchoolName", formula="$oneSchool.name")

    # A helper for comparing Record objects below.
    schools_table = self.engine.tables['Schools']
    def SchoolsRec(row_id):
      return schools_table.Record(row_id, None)

    # We'll play with schools "Columbia" and "Eureka", which are rows 1,3,5 in the Students table.
    self.assertTableData("Students", cols="subset", rows="subset", data=[
      ["id",  "schoolName", "schoolsCount", "oneSchool",    "oneSchoolName"],
      [1,     "Columbia",   2,              SchoolsRec(1),  "Columbia"],
      [3,     "Columbia",   2,              SchoolsRec(1),  "Columbia"],
      [5,     "Eureka",     0,              SchoolsRec(0),  ""],
    ])

    # Now change Schools.schoolName which should trigger recomputations.
    self.update_record("Schools", 1, name="Eureka")
    self.assertTableData("Students", cols="subset", rows="subset", data=[
      ["id",  "schoolName", "schoolsCount", "oneSchool",    "oneSchoolName"],
      [1,     "Columbia",   1,              SchoolsRec(2),  "Columbia"],
      [3,     "Columbia",   1,              SchoolsRec(2),  "Columbia"],
      [5,     "Eureka",     1,              SchoolsRec(1),  "Eureka"],
    ])

    # The first change is expected to work. The important check is that the relations don't get
    # corrupted afterwards. So we do a second change to see if that still updates.
    self.update_record("Schools", 1, name="Columbia")
    self.assertTableData("Students", cols="subset", rows="subset", data=[
      ["id",  "schoolName", "schoolsCount", "oneSchool",    "oneSchoolName"],
      [1,     "Columbia",   2,              SchoolsRec(1),  "Columbia"],
      [3,     "Columbia",   2,              SchoolsRec(1),  "Columbia"],
      [5,     "Eureka",     0,              SchoolsRec(0),  ""],
    ])

    # One more time, for good measure.
    self.update_record("Schools", 1, name="Eureka")
    self.assertTableData("Students", cols="subset", rows="subset", data=[
      ["id",  "schoolName", "schoolsCount", "oneSchool",    "oneSchoolName"],
      [1,     "Columbia",   1,              SchoolsRec(2),  "Columbia"],
      [3,     "Columbia",   1,              SchoolsRec(2),  "Columbia"],
      [5,     "Eureka",     1,              SchoolsRec(1),  "Eureka"],
    ])

  def test_vlookup(self):
    self.load_sample(testsamples.sample_students)
    self.add_column("Students", "school", formula="VLOOKUP(Schools, name=$schoolName)")
    self.add_column("Students", "schoolCity",
        formula="VLOOKUP(Schools, name=$schoolName).address.city")

    # A helper for comparing Record objects below.
    schools_table = self.engine.tables['Schools']
    def SchoolsRec(row_id):
      return schools_table.Record(row_id, None)

    # We'll play with schools "Columbia" and "Eureka", which are rows 1,3,5 in the Students table.
    self.assertTableData("Students", cols="subset", rows="all", data=[
      ["id",  "schoolName", "school",       "schoolCity"],
      [1,     "Columbia",   SchoolsRec(1),  "New York"  ],
      [2,     "Yale",       SchoolsRec(3),  "New Haven" ],
      [3,     "Columbia",   SchoolsRec(1),  "New York"  ],
      [4,     "Yale",       SchoolsRec(3),  "New Haven" ],
      [5,     "Eureka",     SchoolsRec(0),  ""          ],
      [6,     "Yale",       SchoolsRec(3),  "New Haven" ],
    ])

    # Now change some values which should trigger recomputations.
    self.update_record("Schools", 1, name="Eureka")
    self.update_record("Students", 2, schoolName="Unknown")

    self.assertTableData("Students", cols="subset", rows="all", data=[
      ["id",  "schoolName", "school",       "schoolCity"],
      [1,     "Columbia",   SchoolsRec(2),  "Colombia"  ],
      [2,     "Unknown",    SchoolsRec(0),  ""          ],
      [3,     "Columbia",   SchoolsRec(2),  "Colombia"  ],
      [4,     "Yale",       SchoolsRec(3),  "New Haven" ],
      [5,     "Eureka",     SchoolsRec(1),  "New York"  ],
      [6,     "Yale",       SchoolsRec(3),  "New Haven" ],
    ])

  def test_contains(self):
    sample = testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Source", [
          [11, "choicelist1", "ChoiceList", False, "", "choicelist1", ""],
          [12, "choicelist2", "ChoiceList", False, "", "choicelist2", ""],
          [13, "text1",       "Text",       False, "", "text1",       ""],
          [14, "text2",       "Text",       False, "", "text1",       ""],
          [15, "contains1", "RefList:Source", True,
           "Source.lookupRecords(choicelist1=CONTAINS($text1))",
           "contains1", ""],
          [16, "contains2", "RefList:Source", True,
           "Source.lookupRecords(choicelist2=CONTAINS($text2))",
           "contains2", ""],
          [17, "contains_both", "RefList:Source", True,
           "Source.lookupRecords(choicelist1=CONTAINS($text1), choicelist2=CONTAINS($text2))",
           "contains_both", ""],
          [17, "combined", "RefList:Source", True,
           "Source.lookupRecords(choicelist1=CONTAINS($text1), text2='x')",
           "combined", ""],
        ]]
      ],
      "DATA": {
        "Source": [
          ["id", "choicelist1", "text1", "choicelist2", "text2"],
          [101,  ["a"],         "a",     ["x"],         "y"],
          [102,  ["b"],         "b",     ["y"],         "x"],
          [103,  ["a", "b"],    "c",     ["x", "y"],    "c"],
        ]
      }
    })
    self.load_sample(sample)

    self.assertTableData("Source", cols="subset", data=[
          ["id", "contains1", "contains2", "contains_both", "combined"],
          [101,  [101, 103],  [102, 103],  [103],           []],
          [102,  [102, 103],  [101, 103],  [103],           [102]],
          [103,  [],          [],          [],              []],
    ])

  def test_sort_by(self):
    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Table1", [
          [1, "num", "Numeric", False, "", "", ""],
          [4, "is_num", "Any", True,
           "isinstance($num, float)", "", ""],
          [2, "lookup", "Any", True,
           "Table1.lookupRecords(sort_by='num').num", "", ""],
          [3, "lookup_reverse", "Any", True,
           "Table1.lookupRecords(sort_by='-num').num", "", ""],
          [5, "lookup_first", "Any", True,
           "Table1.lookupOne().num", "", ""],
          [6, "lookup_min", "Any", True,
           "Table1.lookupOne(sort_by='num').num", "", ""],
          [7, "lookup_min_num", "Any", True,
           "Table1.lookupOne(is_num=True, sort_by='num').num", "", ""],
          [8, "lookup_max", "Any", True,
           "Table1.lookupOne(sort_by='-num').num", "", ""],
          [9, "lookup_max_num",
           "Any", True,
           "Table1.lookupOne(is_num=True, sort_by='-num').num", "", ""],
        ]]
      ],
      "DATA": {
        "Table1": [
          ["id", "num"],
          [1, 2],
          [2, 1],
          [3, 'foo'],
          [4, 3],
          [5, None],
          [6, 0],
        ]
      }
    }))

    self.assertTableData(
      "Table1", cols="subset", rows="subset", data=[
        ["id",
         "lookup",
         "lookup_reverse",
         "lookup_first",
         "lookup_min", "lookup_min_num",
         "lookup_max", "lookup_max_num"],
        [1,
         [None, 0, 1, 2, 3, 'foo'],
         ['foo', 3, 2, 1, 0, None],
         2,  # lookup_first: first record (by id)
         None, 0,  # lookup_min[_num]
         'foo', 3],  # lookup_max[_num]
      ])

  def test_conversion(self):
    # Test that values are converted to the type of the column when looking up
    # i.e. '123' is converted to 123
    # and 'foo' is converted to AltText('foo')
    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Table1", [
          [1, "num", "Numeric", False, "", "", ""],
          [2, "lookup1", "RefList:Table1", True, "Table1.lookupRecords(num='123')", "", ""],
          [3, "lookup2", "RefList:Table1", True, "Table1.lookupRecords(num='foo')", "", ""],
        ]]
      ],
      "DATA": {
        "Table1": [
          ["id", "num"],
          [1,    123],
          [2,    'foo'],
        ]
      }
    }))

    self.assertTableData(
      "Table1", data=[
        ["id", "num", "lookup1", "lookup2"],
        [1,    123,   [1],       [2]],
        [2,    'foo', [1],       [2]],
      ])
