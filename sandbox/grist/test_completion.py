import testsamples
import test_engine
from schema import RecalcWhen

class TestCompletion(test_engine.EngineTestCase):
  user = {
    'Name': 'Foo',
    'UserID': 1,
    'StudentInfo': ['Students', 1],
    'LinkKey': {},
    'Origin': None,
    'Email': 'foo@example.com',
    'Access': 'owners',
    'SessionID': 'u1',
    'IsLoggedIn': True
  }

  def setUp(self):
    super(TestCompletion, self).setUp()
    self.load_sample(testsamples.sample_students)

    # To test different column types, we add some differently-typed columns to the sample.
    self.add_column('Students', 'school', type='Ref:Schools')
    self.add_column('Students', 'birthDate', type='Date')
    self.add_column('Students', 'lastVisit', type='DateTime:America/New_York')
    self.add_column('Schools', 'yearFounded', type='Int')
    self.add_column('Schools', 'budget', type='Numeric')
    self.add_column('Schools', 'lastModified',
      type="DateTime:America/Los_Angeles", isFormula=False, formula="NOW()",
      recalcWhen=RecalcWhen.MANUAL_UPDATES
    )
    self.add_column('Schools', 'lastModifier',
      type="Text", isFormula=False, formula="foo@getgrist.com",
      recalcWhen=RecalcWhen.MANUAL_UPDATES
    )

  def test_keyword(self):
    self.assertEqual(self.engine.autocomplete("for", "Address", "city", self.user),
                     ["for", "format("])

  def test_grist(self):
    self.assertEqual(self.engine.autocomplete("gri", "Address", "city", self.user),
                     ["grist"])

  def test_value(self):
    # Should only appear if column exists and is a trigger formula.
    self.assertEqual(
      self.engine.autocomplete("val", "Schools", "lastModified", self.user),
      ["value"]
    )
    self.assertEqual(
      self.engine.autocomplete("val", "Students", "schoolCities", self.user),
      []
    )
    self.assertEqual(
      self.engine.autocomplete("val", "Students", "nonexistentColumn", self.user),
      []
    )
    self.assertEqual(self.engine.autocomplete("valu", "Schools", "lastModifier", self.user),
                     ["value"])
    # Should have same type as column.
    self.assertGreaterEqual(
      set(self.engine.autocomplete("value.", "Schools", "lastModifier", self.user)),
      {'value.startswith(', 'value.replace(', 'value.title('}
    )
    self.assertGreaterEqual(
      set(self.engine.autocomplete("value.", "Schools", "lastModified", self.user)),
      {'value.month', 'value.strftime(', 'value.replace('}
    )
    self.assertGreaterEqual(
      set(self.engine.autocomplete("value.m", "Schools", "lastModified", self.user)),
      {'value.month', 'value.minute'}
    )

  def test_user(self):
    # Should only appear if column exists and is a trigger formula.
    self.assertEqual(self.engine.autocomplete("use", "Schools", "lastModified", self.user),
                     ["user"])
    self.assertEqual(self.engine.autocomplete("use", "Students", "schoolCities", self.user),
                     [])
    self.assertEqual(self.engine.autocomplete("use", "Students", "nonexistentColumn", self.user),
                     [])
    self.assertEqual(self.engine.autocomplete("user", "Schools", "lastModifier", self.user),
                     ["user"])
    self.assertEqual(
      self.engine.autocomplete("user.", "Schools", "lastModified", self.user),
      [
        'user.Access',
        'user.Email',
        'user.IsLoggedIn',
        'user.LinkKey',
        'user.Name',
        'user.Origin',
        'user.SessionID',
        'user.StudentInfo',
        'user.UserID'
      ]
    )
    # Should follow user attribute references and autocomplete those types.
    self.assertEqual(
      self.engine.autocomplete("user.StudentInfo.", "Schools", "lastModified", self.user),
      [
        'user.StudentInfo.birthDate',
        'user.StudentInfo.firstName',
        'user.StudentInfo.id',
        'user.StudentInfo.lastName',
        'user.StudentInfo.lastVisit',
        'user.StudentInfo.school',
        'user.StudentInfo.schoolCities',
        'user.StudentInfo.schoolIds',
        'user.StudentInfo.schoolName'
      ]
    )
    # Should not show user attribute completions if user doesn't have attribute.
    user2 = {
      'Name': 'Bar',
      'Origin': None,
      'Email': 'baro@example.com',
      'LinkKey': {},
      'UserID': 2,
      'Access': 'owners',
      'SessionID': 'u2',
      'IsLoggedIn': True
    }
    self.assertEqual(
      self.engine.autocomplete("user.", "Schools", "lastModified", user2),
      [
        'user.Access',
        'user.Email',
        'user.IsLoggedIn',
        'user.LinkKey',
        'user.Name',
        'user.Origin',
        'user.SessionID',
        'user.UserID'
      ]
    )
    self.assertEqual(
      self.engine.autocomplete("user.StudentInfo.", "Schools", "schoolCities", user2),
      []
    )

  def test_function(self):
    self.assertEqual(self.engine.autocomplete("MEDI", "Address", "city", self.user),
        [('MEDIAN', '(value, *more_values)', True)])
    self.assertEqual(self.engine.autocomplete("ma", "Address", "city", self.user), [
      ('MAX', '(value, *more_values)', True),
      ('MAXA', '(value, *more_values)', True),
      'map(',
      'math',
      'max(',
    ])

  def test_member(self):
    self.assertEqual(self.engine.autocomplete("datetime.tz", "Address", "city", self.user),
                     ["datetime.tzinfo("])

  def test_case_insensitive(self):
    self.assertEqual(self.engine.autocomplete("medi", "Address", "city", self.user),
        [('MEDIAN', '(value, *more_values)', True)])
    self.assertEqual(self.engine.autocomplete("std", "Address", "city", self.user), [
      ('STDEV', '(value, *more_values)', True),
      ('STDEVA', '(value, *more_values)', True),
      ('STDEVP', '(value, *more_values)', True),
      ('STDEVPA', '(value, *more_values)', True)
    ])
    self.assertEqual(self.engine.autocomplete("stu", "Address", "city", self.user),
        ["Students"])

    # Add a table name whose lowercase version conflicts with a builtin.
    self.apply_user_action(['AddTable', 'Max', []])
    self.assertEqual(self.engine.autocomplete("max", "Address", "city", self.user), [
      ('MAX', '(value, *more_values)', True),
      ('MAXA', '(value, *more_values)', True),
      'Max',
      'max(',
    ])
    self.assertEqual(self.engine.autocomplete("MAX", "Address", "city", self.user), [
      ('MAX', '(value, *more_values)', True),
      ('MAXA', '(value, *more_values)', True),
    ])


  def test_suggest_globals_and_tables(self):
    # Should suggest globals and table names.
    self.assertEqual(self.engine.autocomplete("ME", "Address", "city", self.user),
        [('MEDIAN', '(value, *more_values)', True)])
    self.assertEqual(self.engine.autocomplete("Ad", "Address", "city", self.user), ['Address'])
    self.assertGreaterEqual(set(self.engine.autocomplete("S", "Address", "city", self.user)), {
      'Schools',
      'Students',
      ('SUM', '(value1, *more_values)', True),
      ('STDEV', '(value, *more_values)', True),
    })
    self.assertGreaterEqual(set(self.engine.autocomplete("s", "Address", "city", self.user)), {
      'Schools',
      'Students',
      'sum(',
      ('SUM', '(value1, *more_values)', True),
      ('STDEV', '(value, *more_values)', True),
    })
    self.assertEqual(self.engine.autocomplete("Addr", "Schools", "budget", self.user), ['Address'])

  def test_suggest_columns(self):
    self.assertEqual(self.engine.autocomplete("$ci", "Address", "city", self.user),
                     ["$city"])
    self.assertEqual(self.engine.autocomplete("rec.i", "Address", "city", self.user),
                     ["rec.id"])
    self.assertEqual(len(self.engine.autocomplete("$", "Address", "city", self.user)),
                     2)

    # A few more detailed examples.
    self.assertEqual(self.engine.autocomplete("$", "Students", "school", self.user),
                     ['$birthDate', '$firstName', '$id', '$lastName', '$lastVisit',
                      '$school', '$schoolCities', '$schoolIds', '$schoolName'])
    self.assertEqual(self.engine.autocomplete("$fi", "Students", "birthDate", self.user),
                     ['$firstName'])
    self.assertEqual(self.engine.autocomplete("$school", "Students", "lastVisit", self.user),
        ['$school', '$schoolCities', '$schoolIds', '$schoolName'])

  def test_suggest_lookup_methods(self):
    # Should suggest lookup formulas for tables.
    address_dot_completion = self.engine.autocomplete("Address.", "Students", "firstName", self.user)
    # In python 3.9.7, rlcompleter stops adding parens for property attributes,
    # see https://bugs.python.org/issue44752 - seems like a minor issue, so leave test
    # tolerant.
    property_aware_completer = address_dot_completion[0] == 'Address.Record'
    self.assertEqual(address_dot_completion, [
      'Address.Record' if property_aware_completer else ('Address.Record', '', True),
      'Address.RecordSet' if property_aware_completer else ('Address.RecordSet', '', True),
      'Address.all',
      ('Address.lookupOne', '(colName=<value>, ...)', True),
      ('Address.lookupRecords', '(colName=<value>, ...)', True),
    ])

    self.assertEqual(
      self.engine.autocomplete("Address.lookup", "Students", "lastName", self.user),
      [
        ('Address.lookupOne', '(colName=<value>, ...)', True),
        ('Address.lookupRecords', '(colName=<value>, ...)', True),
      ]
    )

    self.assertEqual(
      self.engine.autocomplete("address.look", "Students", "schoolName", self.user),
      [
        ('Address.lookupOne', '(colName=<value>, ...)', True),
        ('Address.lookupRecords', '(colName=<value>, ...)', True),
      ]
    )

  def test_suggest_column_type_methods(self):
    # Should treat columns as correct types.
    self.assertGreaterEqual(
      set(self.engine.autocomplete("$firstName.", "Students", "firstName", self.user)),
      {'$firstName.startswith(', '$firstName.replace(', '$firstName.title('}
    )
    self.assertGreaterEqual(
      set(self.engine.autocomplete("$birthDate.", "Students", "lastName", self.user)),
      {'$birthDate.month', '$birthDate.strftime(', '$birthDate.replace('}
    )
    self.assertGreaterEqual(
      set(self.engine.autocomplete("$lastVisit.m", "Students", "firstName", self.user)),
      {'$lastVisit.month', '$lastVisit.minute'}
    )
    self.assertGreaterEqual(
      set(self.engine.autocomplete("$school.", "Students", "firstName", self.user)),
      {'$school.address', '$school.name', '$school.yearFounded', '$school.budget'}
    )
    self.assertEqual(self.engine.autocomplete("$school.year", "Students", "lastName", self.user),
                     ['$school.yearFounded'])
    self.assertGreaterEqual(
      set(self.engine.autocomplete("$yearFounded.", "Schools", "budget", self.user)),
      {
        '$yearFounded.denominator',    # Only integers have this
        '$yearFounded.bit_length(',    # and this
        '$yearFounded.real'
      }
    )
    self.assertGreaterEqual(
      set(self.engine.autocomplete("$budget.", "Schools", "budget", self.user)),
      {'$budget.is_integer(', '$budget.real'}    # Only floats have this
    )

  def test_suggest_follows_references(self):
    # Should follow references and autocomplete those types.
    self.assertEqual(
      self.engine.autocomplete("$school.name.st", "Students", "firstName", self.user),
      ['$school.name.startswith(', '$school.name.strip(']
    )
    self.assertGreaterEqual(
      set(self.engine.autocomplete("$school.yearFounded.","Students", "firstName", self.user)),
      {
        '$school.yearFounded.denominator',
        '$school.yearFounded.bit_length(',
        '$school.yearFounded.real'
      }
    )

    self.assertEqual(
      self.engine.autocomplete("$school.address.", "Students", "lastName", self.user),
      ['$school.address.city', '$school.address.id']
    )
    self.assertEqual(
      self.engine.autocomplete("$school.address.city.st", "Students", "lastName", self.user),
      ['$school.address.city.startswith(', '$school.address.city.strip(']
    )
