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
    self.add_column('Students', 'school', type='Ref:Schools', visibleCol=10)
    self.add_column('Students', 'homeAddress', type='Ref:Address', visibleCol=21)
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
        'user.StudentInfo.homeAddress',
        'user.StudentInfo.homeAddress.city',
        'user.StudentInfo.id',
        'user.StudentInfo.lastName',
        'user.StudentInfo.lastVisit',
        'user.StudentInfo.school',
        'user.StudentInfo.school.name',
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
    self.assertEqual(
      self.engine.autocomplete("stu", "Address", "city", self.user),
      [
        'Students',
        ('Students.lookupOne', '(colName=<value>, ...)', True),
        ('Students.lookupRecords', '(colName=<value>, ...)', True),
        'Students.lookupRecords(homeAddress=$id)',
      ],
    )

    # Add a table name whose lowercase version conflicts with a builtin.
    self.apply_user_action(['AddTable', 'Max', []])
    self.assertEqual(self.engine.autocomplete("max", "Address", "city", self.user), [
      ('MAX', '(value, *more_values)', True),
      ('MAXA', '(value, *more_values)', True),
      'Max',
      ('Max.lookupOne', '(colName=<value>, ...)', True),
      ('Max.lookupRecords', '(colName=<value>, ...)', True),
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
    self.assertEqual(
      self.engine.autocomplete("Ad", "Address", "city", self.user),
      [
        'Address',
        ('Address.lookupOne', '(colName=<value>, ...)', True),
        ('Address.lookupRecords', '(colName=<value>, ...)', True),
      ],
    )
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
    self.assertEqual(
      self.engine.autocomplete("Addr", "Schools", "budget", self.user),
      [
        'Address',
        ('Address.lookupOne', '(colName=<value>, ...)', True),
        ('Address.lookupRecords', '(colName=<value>, ...)', True),
      ],
    )

  def test_suggest_columns(self):
    self.assertEqual(self.engine.autocomplete("$ci", "Address", "city", self.user),
                     ["$city"])
    self.assertEqual(self.engine.autocomplete("rec.i", "Address", "city", self.user),
                     ["rec.id"])
    self.assertEqual(len(self.engine.autocomplete("$", "Address", "city", self.user)),
                     2)

    # A few more detailed examples.
    self.assertEqual(self.engine.autocomplete("$", "Students", "school", self.user),
                     ['$birthDate', '$firstName', '$homeAddress', '$homeAddress.city',
                      '$id', '$lastName', '$lastVisit',
                      '$school', '$school.name', '$schoolCities', '$schoolIds', '$schoolName'])
    self.assertEqual(self.engine.autocomplete("$fi", "Students", "birthDate", self.user),
                     ['$firstName'])
    self.assertEqual(self.engine.autocomplete("$school", "Students", "lastVisit", self.user),
        ['$school', '$school.name', '$schoolCities', '$schoolIds', '$schoolName'])

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

  def test_suggest_lookup_early(self):
    # For part of a table name, suggest lookup methods early,
    # including a 'reverse reference' lookup, i.e. `<refcol to current table>=$id`,
    # but only for `lookupRecords`, not `lookupOne`.
    self.assertEqual(
      self.engine.autocomplete("stu", "Schools", "name", self.user),
      [
        'Students',
        ('Students.lookupOne', '(colName=<value>, ...)', True),
        ('Students.lookupRecords', '(colName=<value>, ...)', True),
        # i.e. Students.school is a reference to Schools
        'Students.lookupRecords(school=$id)',
      ],
    )
    self.assertEqual(
      self.engine.autocomplete("scho", "Address", "city", self.user),
      [
        'Schools',
        ('Schools.lookupOne', '(colName=<value>, ...)', True),
        ('Schools.lookupRecords', '(colName=<value>, ...)', True),
        # i.e. Schools.address is a reference to Address
        'Schools.lookupRecords(address=$id)',
      ],
    )

    # Same as above, but the formula is being entered in 'Students' instead of 'Address',
    # which means there's no reverse reference to suggest.
    self.assertEqual(
      self.engine.autocomplete("scho", "Students", "firstName", self.user),
      [
        'Schools',
        ('Schools.lookupOne', '(colName=<value>, ...)', True),
        ('Schools.lookupRecords', '(colName=<value>, ...)', True),
      ],
    )

  def test_suggest_lookup_arguments(self):
    # Typing in the full `.lookupRecords(` should suggest keyword argument (i.e. column) names,
    # in addition to reference lookups, including the reverse reference lookups above.
    self.assertEqual(
      self.engine.autocomplete("Schools.lookupRecords(", "Address", "city", self.user),
      [
        'Schools.lookupRecords(address=',
        'Schools.lookupRecords(address=$id)',
        'Schools.lookupRecords(budget=',
        'Schools.lookupRecords(id=',
        'Schools.lookupRecords(lastModified=',
        'Schools.lookupRecords(lastModifier=',
        'Schools.lookupRecords(name=',
        'Schools.lookupRecords(yearFounded=',
      ],
    )

    # In addition to reverse reference lookups, suggest other lookups involving two reference
    # columns (one from the looked up table, one from the current table) targeting the same table,
    # e.g. `address=$homeAddress` in the two cases below.
    self.assertEqual(
      self.engine.autocomplete("Schools.lookupRecords(", "Students", "firstName", self.user),
      [
        'Schools.lookupRecords(address=',
        'Schools.lookupRecords(address=$homeAddress)',
        'Schools.lookupRecords(budget=',
        'Schools.lookupRecords(id=',
        'Schools.lookupRecords(lastModified=',
        'Schools.lookupRecords(lastModifier=',
        'Schools.lookupRecords(name=',
        'Schools.lookupRecords(yearFounded=',
      ],
    )

    self.assertEqual(
      self.engine.autocomplete("Students.lookupRecords(", "Schools", "name", self.user),
      [
        'Students.lookupRecords(birthDate=',
        'Students.lookupRecords(firstName=',
        'Students.lookupRecords(homeAddress=',
        'Students.lookupRecords(homeAddress=$address)',
        'Students.lookupRecords(id=',
        'Students.lookupRecords(lastName=',
        'Students.lookupRecords(lastVisit=',
        'Students.lookupRecords(school=',
        'Students.lookupRecords(school=$id)',
        'Students.lookupRecords(schoolCities=',
        'Students.lookupRecords(schoolIds=',
        'Students.lookupRecords(schoolName=',
      ],
    )

    # Add some more reference columns to test that all combinations are offered
    self.add_column('Students', 'homeAddress2', type='Ref:Address')
    self.add_column('Schools', 'address2', type='Ref:Address')
    # This leads to `Students.lookupRecords(moreAddresses=CONTAINS($address[2]))`
    self.add_column('Students', 'moreAddresses', type='RefList:Address')
    # This doesn't affect anything, because there's no way to do the opposite of CONTAINS()
    self.add_column('Schools', 'otherAddresses', type='RefList:Address')
    self.assertEqual(
      self.engine.autocomplete("Students.lookupRecords(", "Schools", "name", self.user),
      [
        'Students.lookupRecords(birthDate=',
        'Students.lookupRecords(firstName=',
        'Students.lookupRecords(homeAddress2=',
        'Students.lookupRecords(homeAddress2=$address)',
        'Students.lookupRecords(homeAddress2=$address2)',
        'Students.lookupRecords(homeAddress=',
        'Students.lookupRecords(homeAddress=$address)',
        'Students.lookupRecords(homeAddress=$address2)',
        'Students.lookupRecords(id=',
        'Students.lookupRecords(lastName=',
        'Students.lookupRecords(lastVisit=',
        'Students.lookupRecords(moreAddresses=',
        'Students.lookupRecords(moreAddresses=CONTAINS($address))',
        'Students.lookupRecords(moreAddresses=CONTAINS($address2))',
        'Students.lookupRecords(school=',
        'Students.lookupRecords(school=$id)',
        'Students.lookupRecords(schoolCities=',
        'Students.lookupRecords(schoolIds=',
        'Students.lookupRecords(schoolName=',
      ],
    )
