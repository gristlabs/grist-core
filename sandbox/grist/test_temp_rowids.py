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

  def test_reflist_temp_ids(self):
    self.load_sample(testsamples.sample_students)

    self.engine.apply_user_actions([useractions.from_repr(
      ['AddColumn', 'Schools', 'addresses', {'type': 'RefList:Address', 'isFormula': False}])])

    out_actions = self.engine.apply_user_actions([useractions.from_repr(ua) for ua in (
      ['BulkAddRecord', 'Address', [-1, -2], {'city': ['A', 'B']}],

      # A RefList mixing temp ids and an existing id, and one left unset.
      ['AddRecord', 'Schools', None, {'name': 'S1', 'addresses': ['L', -1, 11, -2]}],
      ['AddRecord', 'Schools', None, {'name': 'S2'}],

      # An update whose row id and RefList value both use temp ids.
      ['AddRecord', 'Schools', -5, {'name': 'S3'}],
      ['UpdateRecord', 'Schools', -5, {'addresses': ['L', -2]}],
    )])

    self.assertTableData('Schools', cols="subset", data=[
      ["id",  "name",       "addresses"],
      [1,     "Columbia",   None],
      [2,     "Columbia",   None],
      [3,     "Yale",       None],
      [4,     "Yale",       None],
      [5,     "S1",         [15, 11, 16]],
      [6,     "S2",         None],
      [7,     "S3",         [16]],
    ])

    # The actions above, with rowIds and RefList values translated.
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ['BulkAddRecord', 'Address', [15, 16], {'city': ['A', 'B']}],
        ['AddRecord', 'Schools', 5, {'addresses': ['L', 15, 11, 16], 'name': 'S1'}],
        ['AddRecord', 'Schools', 6, {'name': 'S2'}],
        ['AddRecord', 'Schools', 7, {'name': 'S3'}],
        ['UpdateRecord', 'Schools', 7, {'addresses': ['L', 16]}],
      ]
    })

  def test_reflist_same_action_temp_ids(self):
    self.load_sample(testsamples.sample_students)

    self.engine.apply_user_actions([useractions.from_repr(
      ['AddColumn', 'Schools', 'partners', {'type': 'RefList:Schools', 'isFormula': False}])])

    # Mutual references within a single bulk add: no processing order could
    # satisfy this cycle without temp ids.
    out_actions = self.engine.apply_user_actions([useractions.from_repr(
      ['BulkAddRecord', 'Schools', [-1, -2], {
        'name': ['P1', 'P2'],
        'partners': [['L', -2], ['L', -1, -2]],
      }])])

    self.assertTableData('Schools', cols="subset", data=[
      ["id",  "name",       "partners"],
      [1,     "Columbia",   None],
      [2,     "Columbia",   None],
      [3,     "Yale",       None],
      [4,     "Yale",       None],
      [5,     "P1",         [6]],
      [6,     "P2",         [5, 6]],
    ])

    self.assertPartialOutActions(out_actions, {
      "stored": [
        ['BulkAddRecord', 'Schools', [5, 6], {
          'name': ['P1', 'P2'],
          'partners': [['L', 6], ['L', 5, 6]],
        }],
      ]
    })

  def test_reflist_unusual_values(self):
    self.load_sample(testsamples.sample_students)

    # Unusual values should not break translation. Conversion runs first and turns any list
    # holding a non-int into alttext, so garbage lands as it would without temp ids.
    self.engine.apply_user_actions([useractions.from_repr(ua) for ua in (
      ['AddColumn', 'Schools', 'addresses', {'type': 'RefList:Address', 'isFormula': False}],
      ['AddRecord', 'Address', -1, {'city': 'A'}],
      ['BulkAddRecord', 'Schools', [None] * 7, {
        'name': ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'],
        'addresses': [
          'hello',                  # alttext, not a list
          None,
          0,
          ['L'],                    # empty list
          ['L', 11],                # existing ids only
          ['L', -99],               # temp id with no mapping
          ['L', -1.5],              # negative float, not an int
        ],
      }],
      # Odd elements mixed in with a real temp id.
      ['AddRecord', 'Schools', None, {'name': 'S8', 'addresses': ['L', -1, 'x']}],
      ['AddRecord', 'Schools', None, {'name': 'S9', 'addresses': ['L', -1, ['L', 11]]}],
    )])

    self.assertTableData('Schools', cols="subset", rows=lambda r: r.id > 4, data=[
      ["id",  "name",   "addresses"],
      [5,     "S1",     "hello"],
      [6,     "S2",     None],
      [7,     "S3",     None],
      [8,     "S4",     None],
      [9,     "S5",     [11]],
      [10,    "S6",     [-99]],
      [11,    "S7",     "[-1.5]"],
      [12,    "S8",     "[-1, 'x']"],
      [13,    "S9",     "[-1, [11]]"],
    ])

  def test_update_remove(self):
    self.load_sample(testsamples.sample_students)

    out_actions = self.engine.apply_user_actions([useractions.from_repr(ua) for ua in (
      ['AddRecord', 'Students', -1, {'firstName': 'A'}],
      ['UpdateRecord', 'Students', -1, {'lastName': 'A'}],
      ['BulkAddRecord', 'Students', [-2, None, -3], {'firstName': ['C', 'D', 'E']}],
      ['BulkUpdateRecord', 'Students', [-2, -3, -1], {'lastName': ['C', 'E', 'F']}],
      ['RemoveRecord', 'Students', -2],
    )])

    self.assertPartialOutActions(out_actions, {
      "stored": [
        ['AddRecord', 'Students', 7, {'firstName': 'A'}],
        ['UpdateRecord', 'Students', 7, {'lastName': 'A'}],
        ['BulkAddRecord', 'Students', [8, 9, 10], {'firstName': ['C', 'D', 'E']}],
        ['BulkUpdateRecord', 'Students', [8, 10, 7], {'lastName': ['C', 'E', 'F']}],
        ['RemoveRecord', 'Students', 8],
      ]
    })
