# Test lookups in a Reference or ReferenceList columns, since those are implemented separately.

import actions
import objtypes
import testutil
import test_engine

class TestLookupsRefs(test_engine.EngineTestCase):
  # pylint: disable=line-too-long
  sample_data = testutil.parse_test_sample({
    "SCHEMA": [
      [1, "Students", [
        [1, "Name",   "Text",                 False, "", "", ""],
        [2, "MainClass",  "Ref:Classes",      False, "", "", ""],
        [3, "AllClasses", "RefList:Classes",  False, "", "", ""],
      ]],
      [2, "Classes", [
        [10, "ClassName",         "Text", False, "", "", ""],
        [11, "MainStudents",      "RefList:Students",
          True, "Students.lookupRecords(MainClass=$id)", "", ""],
        [12, "MainStudentNames",  "Any",
          True, "':'.join(Students.lookupRecords(MainClass=rec).Name)", "", ""],
        [13, "AllStudents",       "RefList:Students",
          True, "Students.lookupRecords(AllClasses=CONTAINS(rec))", "", ""],
        [14, "AllStudentNames",   "Any",
          True, "':'.join(Students.lookupRecords(AllClasses=CONTAINS($id)).Name)", "", ""],
      ]],
    ],
    "DATA": {
      "Students": [
        ["id","Name",   "MainClass", "AllClasses" ],
        [1,   "Alice",  2,           [2, 1],      ],
        [2,   "Bob",    1,           [1],         ],
        [3,   "Cindy",  1,           [1, 2],      ],
        [4,   "Doug",   2,           [2],         ],
      ],
      "Classes": [
        ["id",  "ClassName", ],
        [1,     "Lit",  ],
        [2,     "Sci",  ],
      ],
    }
  })

  def setUp(self):
    super().setUp()
    self.load_sample(self.sample_data)
    self.assertTableData('Classes', cols="subset", data=[
        ['id', 'ClassName', 'MainStudents', 'MainStudentNames', 'AllStudents', 'AllStudentNames'],
        [1,    'Lit',       [2, 3],         'Bob:Cindy',        [1, 2, 3],     'Alice:Bob:Cindy'],
        [2,    'Sci',       [1, 4],         'Alice:Doug',       [1, 3, 4],     'Alice:Cindy:Doug'],
    ])

  @test_engine.test_undo
  def test_update_value(self):
    # Update a record, and check that the correct ones are recalculated.
    out_actions = self.update_record("Students", 2, Name="TED")
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.UpdateRecord('Students', 2, {'Name': 'TED'}),
        # Only one row should get recalculated.
        actions.UpdateRecord('Classes', 1, {'AllStudentNames': 'Alice:TED:Cindy'}),
        actions.UpdateRecord('Classes', 1, {'MainStudentNames': 'TED:Cindy'}),
      ]
    })

    self.assertTableData('Classes', cols="subset", data=[
        ['id', 'ClassName', 'MainStudents', 'MainStudentNames', 'AllStudents', 'AllStudentNames'],
        [1,    'Lit',       [2, 3],         'TED:Cindy',        [1, 2, 3],     'Alice:TED:Cindy'],
        [2,    'Sci',       [1, 4],         'Alice:Doug',       [1, 3, 4],     'Alice:Cindy:Doug'],
    ])

  @test_engine.test_undo
  def test_bulk_update_value(self):
    self.update_records("Students", ['id', 'Name'], [[1, 'ALI'], [2, 'BART']])
    self.assertTableData('Classes', cols="subset", data=[
        ['id', 'ClassName', 'MainStudents', 'MainStudentNames', 'AllStudents', 'AllStudentNames'],
        [1,    'Lit',       [2, 3],         'BART:Cindy',       [1, 2, 3],     'ALI:BART:Cindy'],
        [2,    'Sci',       [1, 4],         'ALI:Doug',         [1, 3, 4],     'ALI:Cindy:Doug'],
    ])

  @test_engine.test_undo
  def test_add(self):
    out_actions = self.add_record("Students", Name="EVE", MainClass=2, AllClasses=['L', 2])
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.AddRecord('Students', 5, {'Name': 'EVE', 'MainClass': 2, 'AllClasses': [2]}),
        actions.UpdateRecord('Classes', 2, {'AllStudentNames': 'Alice:Cindy:Doug:EVE'}),
        actions.UpdateRecord('Classes', 2, {'AllStudents': [1, 3, 4, 5]}),
        actions.UpdateRecord('Classes', 2, {'MainStudentNames': 'Alice:Doug:EVE'}),
        actions.UpdateRecord('Classes', 2, {'MainStudents': [1, 4, 5]}),
      ]
    })
    self.assertTableData('Classes', cols="subset", data=[
        ['id', 'ClassName', 'MainStudents', 'MainStudentNames', 'AllStudents', 'AllStudentNames'],
        [1,    'Lit',       [2, 3],         'Bob:Cindy',        [1, 2, 3],     'Alice:Bob:Cindy'],
        [2,    'Sci',       [1, 4, 5],      'Alice:Doug:EVE',   [1, 3, 4, 5],  'Alice:Cindy:Doug:EVE'],
    ])

  @test_engine.test_undo
  def test_remove(self):
    self.remove_record("Students", 3)
    self.assertTableData('Classes', cols="subset", data=[
        ['id', 'ClassName', 'MainStudents', 'MainStudentNames', 'AllStudents', 'AllStudentNames'],
        [1,    'Lit',       [2],            'Bob',              [1, 2],        'Alice:Bob'],
        [2,    'Sci',       [1, 4],         'Alice:Doug',       [1, 4],        'Alice:Doug'],
    ])

  @test_engine.test_undo
  def test_change_ref(self):
    self.update_record("Students", 3, MainClass=2)
    self.assertTableData('Classes', cols="subset", data=[
        ['id', 'ClassName', 'MainStudents', 'MainStudentNames', 'AllStudents', 'AllStudentNames'],
        [1,    'Lit',       [2],            'Bob',              [1, 2, 3],     'Alice:Bob:Cindy'],
        [2,    'Sci',       [1, 3, 4],      'Alice:Cindy:Doug', [1, 3, 4],     'Alice:Cindy:Doug'],
    ])

  @test_engine.test_undo
  def test_change_reflist(self):
    self.update_record("Students", 3, AllClasses=['L', 2])
    self.assertTableData('Classes', cols="subset", data=[
        ['id', 'ClassName', 'MainStudents', 'MainStudentNames', 'AllStudents', 'AllStudentNames'],
        [1,    'Lit',       [2, 3],         'Bob:Cindy',        [1, 2],        'Alice:Bob'],
        [2,    'Sci',       [1, 4],         'Alice:Doug',       [1, 3, 4],     'Alice:Cindy:Doug'],
    ])

  @test_engine.test_undo
  def test_clear_ref(self):
    self.update_record("Students", 3, MainClass=0)
    self.assertTableData('Classes', cols="subset", data=[
        ['id', 'ClassName', 'MainStudents', 'MainStudentNames', 'AllStudents', 'AllStudentNames'],
        [1,    'Lit',       [2],            'Bob',              [1, 2, 3],     'Alice:Bob:Cindy'],
        [2,    'Sci',       [1, 4],         'Alice:Doug',       [1, 3, 4],     'Alice:Cindy:Doug'],
    ])

  @test_engine.test_undo
  def test_clear_reflist(self):
    self.update_record("Students", 3, AllClasses=None)
    self.assertTableData('Classes', cols="subset", data=[
        ['id', 'ClassName', 'MainStudents', 'MainStudentNames', 'AllStudents', 'AllStudentNames'],
        [1,    'Lit',       [2, 3],         'Bob:Cindy',        [1, 2],        'Alice:Bob'],
        [2,    'Sci',       [1, 4],         'Alice:Doug',       [1, 4],        'Alice:Doug'],
    ])

  @test_engine.test_undo
  def test_error_value(self):
    # Set an error value on a ref/reflist cell, as when it is a formula that returned an exception.
    self.update_record("Students", 2, MainClass=['E', 'ValueError'], AllClasses=['E', 'ValueError'])
    error = objtypes.RaisedException(ValueError())
    self.assertTableData('Students', cols="subset", data=[
        ["id","Name",   "MainClass", "AllClasses" ],
        [1,   "Alice",  2,           [2, 1],      ],
        [2,   "Bob",    error,       error        ],
        [3,   "Cindy",  1,           [1, 2],      ],
        [4,   "Doug",   2,           [2],         ],
    ])
    self.assertTableData('Classes', cols="subset", data=[
        ['id', 'ClassName', 'MainStudents', 'MainStudentNames', 'AllStudents', 'AllStudentNames'],
        [1,    'Lit',       [3],            'Cindy',            [1, 3],        'Alice:Cindy'],
        [2,    'Sci',       [1, 4],         'Alice:Doug',       [1, 3, 4],     'Alice:Cindy:Doug'],
    ])

  @test_engine.test_undo
  def test_alttext_value(self):
    # Set an alttext value on a ref/reflist cell.
    self.update_record("Students", 2, MainClass='Hello', AllClasses='World')
    self.assertTableData('Classes', cols="subset", data=[
        ['id', 'ClassName', 'MainStudents', 'MainStudentNames', 'AllStudents', 'AllStudentNames'],
        [1,    'Lit',       [3],            'Cindy',            [1, 3],        'Alice:Cindy'],
        [2,    'Sci',       [1, 4],         'Alice:Doug',       [1, 3, 4],     'Alice:Cindy:Doug'],
    ])

  @test_engine.test_undo
  def test_alttext_lookup(self):
    # In Ref or RefList
    self.modify_column('Classes', 'MainStudents',
        formula="Students.lookupRecords(MainClass='Hello')")
    self.modify_column('Classes', 'AllStudents',
        formula="Students.lookupRecords(AllClasses=CONTAINS('World'))")
    self.update_record("Students", 2, MainClass='Hello', AllClasses='World')
    self.assertTableData('Classes', cols="subset", data=[
        ['id', 'ClassName', 'MainStudents', 'AllStudents'],
        [1,    'Lit',       [2],            [],        ],
        [2,    'Sci',       [2],            [],        ],
    ])
    # The AltText entry must survive a table rebuild: RenameTable re-indexes the ref columns via
    # copy_from_column, which must index invalid (AltText) refs too, not just valid ones.
    self.apply_user_action(['RenameTable', 'Students', 'Pupils'])
    self.assertTableData('Classes', cols="subset", data=[
        ['id', 'ClassName', 'MainStudents', 'AllStudents'],
        [1,    'Lit',       [2],            [],        ],
        [2,    'Sci',       [2],            [],        ],
    ])

  @test_engine.test_undo
  def test_match_empty(self):
    # In Ref or RefList
    self.modify_column('Classes', 'MainStudents',
        formula="Students.lookupRecords(MainClass=0)")
    self.modify_column('Classes', 'AllStudents',
        formula="Students.lookupRecords(AllClasses=CONTAINS(0, match_empty=0))")
    self.assertTableData('Classes', cols="subset", data=[
        ['id', 'ClassName', 'MainStudents', 'MainStudentNames', 'AllStudents', 'AllStudentNames'],
        [1,    'Lit',       [],             'Bob:Cindy',        [],            'Alice:Bob:Cindy'],
        [2,    'Sci',       [],             'Alice:Doug',       [],            'Alice:Cindy:Doug'],
    ])
    out_actions = self.update_record("Students", 3, AllClasses=None)
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["UpdateRecord", "Students", 3, {"AllClasses": None}],
        ["BulkUpdateRecord", "Classes", [1, 2], {"AllStudentNames": ["Alice:Bob", "Alice:Doug"]}],
        ["BulkUpdateRecord", "Classes", [1, 2], {"AllStudents": [['L', 3], ['L', 3]]}],
      ]
    })
    self.update_record("Students", 2, MainClass=0)
    self.assertTableData('Students', cols="subset", data=[
        ["id","Name",   "MainClass", "AllClasses" ],
        [1,   "Alice",  2,           [2, 1],      ],
        [2,   "Bob",    0,           [1],         ],
        [3,   "Cindy",  1,           None,        ],
        [4,   "Doug",   2,           [2],         ],
    ])
    self.assertTableData('Classes', cols="subset", data=[
        ['id', 'ClassName', 'MainStudents', 'MainStudentNames', 'AllStudents', 'AllStudentNames'],
        [1,    'Lit',       [2],            'Cindy',            [3],           'Alice:Bob'],
        [2,    'Sci',       [2],            'Alice:Doug',       [3],           'Alice:Doug'],
    ])

    # Revert formulas.
    self.modify_column('Classes', 'MainStudents',
        formula="Students.lookupRecords(MainClass=$id)")
    self.modify_column('Classes', 'AllStudents',
        formula="Students.lookupRecords(AllClasses=CONTAINS(rec))")
    self.assertTableData('Classes', cols="subset", data=[
        ['id', 'ClassName', 'MainStudents', 'MainStudentNames', 'AllStudents', 'AllStudentNames'],
        [1,    'Lit',       [3],            'Cindy',            [1, 2],        'Alice:Bob'],
        [2,    'Sci',       [1, 4],         'Alice:Doug',       [1, 4],        'Alice:Doug'],
    ])

  @test_engine.test_undo
  def test_ref_contains(self):
    """
    CONTAINS(x) on a plain Ref column matches by equality: in CONTAINS lookups a Ref cell
    behaves as a single-element (or empty) RefList, so that converting a column between Ref and
    RefList keeps such formulas working unchanged.
    """
    self.modify_column('Classes', 'MainStudents',
        formula="Students.lookupRecords(MainClass=CONTAINS($id))")
    # Same results as the plain MainClass=$id lookup.
    self.assertTableData('Classes', cols="subset", data=[
        ['id', 'ClassName', 'MainStudents'],
        [1,    'Lit',       [2, 3]],
        [2,    'Sci',       [1, 4]],
    ])
    # Moving Bob to Sci updates the lookups.
    self.update_record("Students", 2, MainClass=2)
    self.assertTableData('Classes', cols="subset", data=[
        ['id', 'ClassName', 'MainStudents'],
        [1,    'Lit',       [3]],
        [2,    'Sci',       [1, 2, 4]],
    ])

  @test_engine.test_undo
  def test_ref_match_empty(self):
    """
    CONTAINS(0, match_empty=0) on a plain Ref column matches rows whose reference is empty --
    the same Ref-as-single-element-RefList rule as in test_ref_contains, applied to the empty
    value. (Mechanically, Ref and RefList columns index empty values differently -- 0 vs. the
    empty-list sentinel -- and the lookup must use the right key for each.)
    """
    self.modify_column('Classes', 'MainStudents',
        formula="Students.lookupRecords(MainClass=CONTAINS(0, match_empty=0))")
    # Every student has a main class, so nothing matches the empty key.
    self.assertTableData('Classes', cols="subset", data=[
        ['id', 'ClassName', 'MainStudents'],
        [1,    'Lit',       []],
        [2,    'Sci',       []],
    ])
    # Clearing Bob's main class makes him (and only him) match.
    self.update_record("Students", 2, MainClass=0)
    self.assertTableData('Classes', cols="subset", data=[
        ['id', 'ClassName', 'MainStudents'],
        [1,    'Lit',       [2]],
        [2,    'Sci',       [2]],
    ])

  def _setup_no_class_bucket(self):
    # Look up each class's students by a per-record key: Lit (id 1) uses its own id, while Sci is
    # repurposed as the "no main class" / "empty class list" bucket by looking up key 0.
    self.modify_column('Classes', 'MainStudents',
        formula="Students.lookupRecords(MainClass=($id if $id == 1 else 0))")
    self.modify_column('Classes', 'AllStudents',
        formula="Students.lookupRecords(AllClasses=CONTAINS(($id if $id == 1 else 0), match_empty=0))")
    # Every student has a class, so the "no class" bucket (Sci) starts empty.
    self.assertTableData('Classes', cols="subset", data=[
        ['id', 'ClassName', 'MainStudents', 'AllStudents'],
        [1,    'Lit',       [2, 3],         [1, 2, 3]    ],
        [2,    'Sci',       [],             []           ],
    ])
    # Clearing Bob's (2) main class and class list moves him out of Lit and into the "no class"
    # bucket -- the positive control: the empty-value lookups track that change and return him.
    self.update_record("Students", 2, MainClass=0, AllClasses=None)
    self.assertTableData('Classes', cols="subset", data=[
        ['id', 'ClassName', 'MainStudents', 'AllStudents'],
        [1,    'Lit',       [3],            [1, 3]       ],
        [2,    'Sci',       [2],            [2]          ],
    ])

  @test_engine.test_undo
  def test_remove_not_in_empty_lookup(self):
    # Removing a student resets its cell to the default (0 / empty list), which must not be indexed
    # under the empty keys (0 / the empty-list sentinel).
    self._setup_no_class_bucket()
    # Removing Cindy (3) drops her from Lit; she must NOT join Bob in Sci's empty-value bucket.
    self.remove_record("Students", 3)
    self.assertTableData('Classes', cols="subset", data=[
        ['id', 'ClassName', 'MainStudents', 'AllStudents'],
        [1,    'Lit',       [],             [1]          ],
        [2,    'Sci',       [2],            [2]          ],
    ])

  @test_engine.test_undo
  def test_rename_not_in_empty_lookup(self):
    # Renaming the referenced table rebuilds each ref column via copy_from_column, which scans the
    # raw data array -- including the blank record at row 0. That must not be indexed under the
    # empty keys, so nothing should change.
    self._setup_no_class_bucket()
    # Renaming the referenced table must not inject the blank record (row 0) into Sci's bucket.
    self.apply_user_action(['RenameTable', 'Students', 'Pupils'])
    self.assertTableData('Classes', cols="subset", data=[
        ['id', 'ClassName', 'MainStudents', 'AllStudents'],
        [1,    'Lit',       [3],            [1, 3]       ],
        [2,    'Sci',       [2],            [2]          ],
    ])

  @test_engine.test_undo
  def test_ordered_update_value(self):
    # Change all lookups to lookups with order_by.
    self.modify_column('Classes', "MainStudents",
          formula="Students.lookupRecords(MainClass=$id, order_by='Name')")
    self.modify_column('Classes', "MainStudentNames",
          formula="':'.join(Students.lookupRecords(MainClass=rec, order_by='Name').Name)")
    self.modify_column('Classes', "AllStudents",
          formula="Students.lookupRecords(AllClasses=CONTAINS(rec), order_by='-Name')")
    self.modify_column('Classes', "AllStudentNames",
          formula="':'.join(Students.lookupRecords(AllClasses=CONTAINS($id), order_by='-Name').Name)")

    self.assertTableData('Classes', cols="subset", data=[
        ['id', 'ClassName', 'MainStudents', 'MainStudentNames', 'AllStudents', 'AllStudentNames'],
        [1,    'Lit',       [2, 3],         'Bob:Cindy',        [3, 2, 1],     'Cindy:Bob:Alice'],
        [2,    'Sci',       [1, 4],         'Alice:Doug',       [4, 3, 1],     'Doug:Cindy:Alice'],
    ])

    # Update a record, and check that the correct ones are recalculated.
    self.update_record("Students", 2, Name="TED")
    self.assertTableData('Classes', cols="subset", data=[
        ['id', 'ClassName', 'MainStudents', 'MainStudentNames', 'AllStudents', 'AllStudentNames'],
        [1,    'Lit',       [3, 2],         'Cindy:TED',        [2, 3, 1],     'TED:Cindy:Alice'],
        [2,    'Sci',       [1, 4],         'Alice:Doug',       [4, 3, 1],     'Doug:Cindy:Alice'],
    ])

    # Update a reference.
    self.update_record("Students", 2, MainClass=2)
    self.assertTableData('Classes', cols="subset", data=[
        ['id', 'ClassName', 'MainStudents', 'MainStudentNames', 'AllStudents', 'AllStudentNames'],
        [1,    'Lit',       [3],            'Cindy',            [2, 3, 1],     'TED:Cindy:Alice'],
        [2,    'Sci',       [1, 4, 2],      'Alice:Doug:TED',   [4, 3, 1],     'Doug:Cindy:Alice'],
    ])

  # TODO add tests of relations:
  # When looking up a mix of T.lookupRecords(col=$id) and something other than $id, ensure that
  # invalidations are correct, both when col changes and when the lookup changes.
  # TODO a memory test similar to that in test_loookup_relations would be nice too.
