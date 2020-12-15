import test_engine
import testsamples
import useractions

class TestTempRowIds(test_engine.EngineTestCase):

  def test_temp_row_ids(self):
    self.load_sample(testsamples.sample_students)

    out_actions = self.engine.apply_user_actions([useractions.from_repr(ua) for ua in (
      # Add a mix of records with or without temp rowIds.
      ['AddRecord', 'Address', None, {'city': 'A'}],
      ['AddRecord', 'Address', -1, {'city': 'B'}],
      ['BulkAddRecord', 'Address', [-3, None, -7, -10], {'city': ['C', 'D', 'E', 'F']}],

      # -3 translates to C; the new record of -1 applies to a different table, so doesn't affect
      # its translation to city A.
      ['AddRecord', 'Schools', -1, {'address': -3, 'name': 'SUNY C'}],

      # Add a mix of records referring to new, existing, or null rows.
      ['BulkAddRecord', 'Schools', [None, None, None, None, None], {
        'address': [-1, 11, 0, -3, -7],
        'name': ['SUNY A', 'NYU', 'Xavier', 'Suny C2', 'Suny E'],
        }
      ],

      # Try a few updates too.
      ['UpdateRecord', 'Schools', 1, {'address': -7}],
      ['BulkUpdateRecord', 'Schools', [2, 3, 4], {'address': [-3, -1, 11]}],

      # Later temp rowIds override previous one. Here, -3 was already used.
      ['AddRecord', 'Address', -3, {'city': 'G'}],
      ['AddRecord', 'Schools', None, {'address': -3, 'name': 'SUNY G'}],
    )])

    # Test that we get the correct resulting data.
    self.assertTableData('Address', cols="subset", data=[
      ["id",  "city"       ],
      [11,    "New York"   ],
      [12,    "Colombia"   ],
      [13,    "New Haven"  ],
      [14,    "West Haven" ],
      [15,    "A"],
      [16,    "B"],   # was -1
      [17,    "C"],   # was -3
      [18,    "D"],
      [19,    "E"],   # was -7
      [20,    "F"],   # was -10
      [21,    "G"],   # was -3
    ])
    self.assertTableData('Schools', cols="subset", data=[
      ["id",  "name",     "address"],
      [1, "Columbia",     19],
      [2, "Columbia",     17],
      [3, "Yale",         16],
      [4, "Yale",         11],
      [5, "SUNY C",       17],
      [6, "SUNY A",       16],
      [7, "NYU",          11],
      [8, "Xavier",       0],
      [9, "Suny C2",      17],
      [10, "Suny E",      19],
      [11, "SUNY G",      21],
    ])

    # Test that the actions above got properly translated.
    # These are same as above, except for the translated rowIds.
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ['AddRecord', 'Address', 15, {'city': 'A'}],
        ['AddRecord', 'Address', 16, {'city': 'B'}],
        ['BulkAddRecord', 'Address', [17, 18, 19, 20], {'city': ['C', 'D', 'E', 'F']}],
        ['AddRecord', 'Schools', 5, {'address': 17, 'name': 'SUNY C'}],
        ['BulkAddRecord', 'Schools', [6, 7, 8, 9, 10], {
          'address': [16, 11, 0, 17, 19],
          'name': ['SUNY A', 'NYU', 'Xavier', 'Suny C2', 'Suny E'],
          }
        ],
        ['UpdateRecord', 'Schools', 1, {'address': 19}],
        ['BulkUpdateRecord', 'Schools', [2, 3, 4], {'address': [17, 16, 11]}],
        ['AddRecord', 'Address', 21, {'city': 'G'}],
        ['AddRecord', 'Schools', 11, {'address': 21, 'name': 'SUNY G'}],

        # Calculated values (for Students; lookups on schools named "Columbia" and "Yale")
        ["BulkUpdateRecord", "Students", [1, 2, 3, 4, 6], {
          "schoolCities": ["E:C", "B:New York", "E:C", "B:New York", "B:New York"]}],
      ]
    })
