import testsamples
import test_engine

class TestFindCol(test_engine.EngineTestCase):
  def test_find_col_from_values(self):
    # Test basic functionality.
    self.load_sample(testsamples.sample_students)
    self.assertEqual(self.engine.find_col_from_values(("Columbia", "Yale", "Eureka"), 0),
        [4, 10])
    self.assertEqual(self.engine.find_col_from_values(("Columbia", "Yale", "Eureka"), 1),
        [4])
    self.assertEqual(self.engine.find_col_from_values(["Yale"], 2),
        [10, 4])
    self.assertEqual(self.engine.find_col_from_values(("Columbia", "Yale", "Eureka"), 0, "Schools"),
        [10])

  def test_find_col_with_nonhashable(self):
    self.load_sample(testsamples.sample_students)
    # Add a couple of columns returning list, which is not hashable. There used to be a bug where
    # non-hashable values would cause an exception.
    self.add_column("Students", "foo", formula="list(Schools.lookupRecords(name=$schoolName))")

    # This column returns a non-hashable value, but is otherwise the best match.
    self.add_column("Students", "bar", formula=
        "[1,2,3] if $firstName == 'Bill' else $schoolName.lower()")

    # Check the columns are added with expected colRefs
    self.assertTableData('_grist_Tables_column', cols="subset", rows="subset", data=[
      ["id",  "colId", "type",  "isFormula" ],
      [22,    "foo",   "Any",   True        ],
      [23,    "bar",   "Any",   True        ],
      ])
    self.assertTableData("Students", cols="subset", data=[
      ["id","firstName","lastName", "schoolName", "bar",      ],
      [1,   "Barack",   "Obama",    "Columbia",   "columbia"  ],
      [2,   "George W", "Bush",     "Yale",       "yale"      ],
      [3,   "Bill",     "Clinton",  "Columbia",   [1,2,3]     ],
      [4,   "George H", "Bush",     "Yale",       "yale"      ],
      [5,   "Ronald",   "Reagan",   "Eureka",     "eureka"    ],
      [6,   "Gerald",   "Ford",     "Yale",       "yale"      ],
    ])

    self.assertEqual(self.engine.find_col_from_values(("Columbia", "Yale", "Eureka"), 0), [4, 10])
    self.assertEqual(self.engine.find_col_from_values(("columbia", "yale", "Eureka"), 0), [23, 4])

    # Test that it's safe to include a non-hashable value in the request.
    self.assertEqual(self.engine.find_col_from_values(("columbia", "yale", ["Eureka"]), 0), [23])
