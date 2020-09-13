import testsamples
import test_engine

class TestCompletion(test_engine.EngineTestCase):
  def setUp(self):
    super(TestCompletion, self).setUp()
    self.load_sample(testsamples.sample_students)

    # To test different column types, we add some differently-typed columns to the sample.
    self.add_column('Students', 'school', type='Ref:Schools')
    self.add_column('Students', 'birthDate', type='Date')
    self.add_column('Students', 'lastVisit', type='DateTime:America/New_York')
    self.add_column('Schools', 'yearFounded', type='Int')
    self.add_column('Schools', 'budget', type='Numeric')

  def test_keyword(self):
    self.assertEqual(self.engine.autocomplete("for", "Address"),
                     ["for", "format("])

  def test_grist(self):
    self.assertEqual(self.engine.autocomplete("gri", "Address"),
                     ["grist"])

  def test_function(self):
    self.assertEqual(self.engine.autocomplete("MEDI", "Address"),
        [('MEDIAN', '(value, *more_values)', True)])
    self.assertEqual(self.engine.autocomplete("ma", "Address"), [
      ('MAX', '(value, *more_values)', True),
      ('MAXA', '(value, *more_values)', True),
      'map(',
      'math',
      'max(',
    ])

  def test_member(self):
    self.assertEqual(self.engine.autocomplete("datetime.tz", "Address"),
                     ["datetime.tzinfo("])

  def test_case_insensitive(self):
    self.assertEqual(self.engine.autocomplete("medi", "Address"),
        [('MEDIAN', '(value, *more_values)', True)])
    self.assertEqual(self.engine.autocomplete("std", "Address"), [
      ('STDEV', '(value, *more_values)', True),
      ('STDEVA', '(value, *more_values)', True),
      ('STDEVP', '(value, *more_values)', True),
      ('STDEVPA', '(value, *more_values)', True)
    ])
    self.assertEqual(self.engine.autocomplete("stu", "Address"),
        ["Students"])

    # Add a table name whose lowercase version conflicts with a builtin.
    self.apply_user_action(['AddTable', 'Max', []])
    self.assertEqual(self.engine.autocomplete("max", "Address"), [
      ('MAX', '(value, *more_values)', True),
      ('MAXA', '(value, *more_values)', True),
      'Max',
      'max(',
    ])
    self.assertEqual(self.engine.autocomplete("MAX", "Address"), [
      ('MAX', '(value, *more_values)', True),
      ('MAXA', '(value, *more_values)', True),
    ])


  def test_suggest_globals_and_tables(self):
    # Should suggest globals and table names.
    self.assertEqual(self.engine.autocomplete("ME", "Address"),
        [('MEDIAN', '(value, *more_values)', True)])
    self.assertEqual(self.engine.autocomplete("Ad", "Address"), ['Address'])
    self.assertGreaterEqual(set(self.engine.autocomplete("S", "Address")), {
      'Schools',
      'Students',
      ('SUM', '(value1, *more_values)', True),
      ('STDEV', '(value, *more_values)', True),
    })
    self.assertGreaterEqual(set(self.engine.autocomplete("s", "Address")), {
      'Schools',
      'Students',
      'sum(',
      ('SUM', '(value1, *more_values)', True),
      ('STDEV', '(value, *more_values)', True),
    })
    self.assertEqual(self.engine.autocomplete("Addr", "Schools"), ['Address'])

  def test_suggest_columns(self):
    self.assertEqual(self.engine.autocomplete("$ci", "Address"),
                     ["$city"])
    self.assertEqual(self.engine.autocomplete("rec.i", "Address"),
                     ["rec.id"])
    self.assertEqual(len(self.engine.autocomplete("$", "Address")),
                     2)

    # A few more detailed examples.
    self.assertEqual(self.engine.autocomplete("$", "Students"),
                     ['$birthDate', '$firstName', '$id', '$lastName', '$lastVisit',
                      '$school', '$schoolCities', '$schoolIds', '$schoolName'])
    self.assertEqual(self.engine.autocomplete("$fi", "Students"), ['$firstName'])
    self.assertEqual(self.engine.autocomplete("$school", "Students"),
        ['$school', '$schoolCities', '$schoolIds', '$schoolName'])

  def test_suggest_lookup_methods(self):
    # Should suggest lookup formulas for tables.
    self.assertEqual(self.engine.autocomplete("Address.", "Students"), [
      'Address.all',
      ('Address.lookupOne', '(colName=<value>, ...)', True),
      ('Address.lookupRecords', '(colName=<value>, ...)', True),
    ])

    self.assertEqual(self.engine.autocomplete("Address.lookup", "Students"), [
      ('Address.lookupOne', '(colName=<value>, ...)', True),
      ('Address.lookupRecords', '(colName=<value>, ...)', True),
    ])

    self.assertEqual(self.engine.autocomplete("address.look", "Students"), [
      ('Address.lookupOne', '(colName=<value>, ...)', True),
      ('Address.lookupRecords', '(colName=<value>, ...)', True),
    ])

  def test_suggest_column_type_methods(self):
    # Should treat columns as correct types.
    self.assertGreaterEqual(set(self.engine.autocomplete("$firstName.", "Students")),
                            {'$firstName.startswith(', '$firstName.replace(', '$firstName.title('})
    self.assertGreaterEqual(set(self.engine.autocomplete("$birthDate.", "Students")),
                            {'$birthDate.month', '$birthDate.strftime(', '$birthDate.replace('})
    self.assertGreaterEqual(set(self.engine.autocomplete("$lastVisit.m", "Students")),
                            {'$lastVisit.month', '$lastVisit.minute'})
    self.assertGreaterEqual(set(self.engine.autocomplete("$school.", "Students")),
                            {'$school.address', '$school.name',
                             '$school.yearFounded', '$school.budget'})
    self.assertEqual(self.engine.autocomplete("$school.year", "Students"),
                     ['$school.yearFounded'])
    self.assertGreaterEqual(set(self.engine.autocomplete("$yearFounded.", "Schools")),
                            {'$yearFounded.denominator',    # Only integers have this
                             '$yearFounded.bit_length(',    # and this
                             '$yearFounded.real'})
    self.assertGreaterEqual(set(self.engine.autocomplete("$budget.", "Schools")),
                            {'$budget.is_integer(',    # Only floats have this
                             '$budget.real'})

  def test_suggest_follows_references(self):
    # Should follow references and autocomplete those types.
    self.assertEqual(self.engine.autocomplete("$school.name.st", "Students"),
                     ['$school.name.startswith(', '$school.name.strip('])
    self.assertGreaterEqual(set(self.engine.autocomplete("$school.yearFounded.", "Students")),
                            {'$school.yearFounded.denominator',
                             '$school.yearFounded.bit_length(',
                             '$school.yearFounded.real'})

    self.assertEqual(self.engine.autocomplete("$school.address.", "Students"),
                     ['$school.address.city', '$school.address.id'])
    self.assertEqual(self.engine.autocomplete("$school.address.city.st", "Students"),
                     ['$school.address.city.startswith(', '$school.address.city.strip('])
