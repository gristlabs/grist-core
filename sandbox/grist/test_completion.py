import datetime
import sys

import test_engine
import testsamples
from autocomplete_context import repr_example, eval_suggestion
from schema import RecalcWhen


class TestCompletion(test_engine.EngineTestCase):
  user = {
    'Name': 'Foo',
    'UserID': 1,
    'UserRef': '1',
    'StudentInfo': ['Students', 1],
    'LinkKey': {},
    'Origin': None,
    'Email': 'foo@example.com',
    'Access': 'owners',
    'SessionID': 'u1',
    'IsLoggedIn': True,
    'ShareRef': None
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
    self.update_record('Schools', 3, budget='123.45', yearFounded='2010', lastModified='2018-01-01')
    self.update_record('Students', 1, homeAddress=11, school=1)
    # Create a summary table of Students grouped by school
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [22], None])

  def test_keyword(self):
    self.assertEqual(self.autocomplete("for", "Address", "city"),
                     ["for", "format("])

  def test_grist(self):
    self.assertEqual(self.autocomplete("gri", "Address", "city"),
                     ["grist"])

  def test_value(self):
    # Should only appear if column exists and is a trigger formula.
    self.assertEqual(
      self.autocomplete("val", "Schools", "lastModified"),
      ["value"]
    )
    self.assertEqual(
      self.autocomplete("val", "Students", "schoolCities"),
      []
    )
    self.assertEqual(
      self.autocomplete("val", "Students", "nonexistentColumn"),
      []
    )
    self.assertEqual(self.autocomplete("valu", "Schools", "lastModifier"),
                     ["value"])
    # Should have same type as column.
    self.assert_autocomplete_includes("value.", "Schools", "lastModifier",
      {'value.startswith(', 'value.replace(', 'value.title('}
    )
    self.assert_autocomplete_includes("value.", "Schools", "lastModified",
      {'value.month', 'value.strftime(', 'value.replace('}
    )
    self.assert_autocomplete_includes("value.m", "Schools", "lastModified",
      {'value.month', 'value.minute'}
    )

  def test_user(self):
    # Should only appear if column exists and is a trigger formula.
    self.assertEqual(self.autocomplete("use", "Schools", "lastModified"),
                     ["user"])
    self.assertEqual(self.autocomplete("use", "Students", "schoolCities"),
                     [])
    self.assertEqual(self.autocomplete("use", "Students", "nonexistentColumn"),
                     [])
    self.assertEqual(self.autocomplete("user", "Schools", "lastModifier"),
                     ["user"])
    self.assertEqual(
      self.autocomplete("user.", "Schools", "lastModified", row_id=2),
      [
        ('user.Access', "'owners'"),
        ('user.Email', "'foo@example.com'"),
        ('user.IsLoggedIn', 'True'),
        ('user.LinkKey', None),
        ('user.Name', "'Foo'"),
        ('user.Origin', 'None'),
        ('user.SessionID', "'u1'"),
        ('user.ShareRef', 'None'),
        ('user.StudentInfo', 'Students[1]'),
        ('user.UserID', '1'),
        ('user.UserRef', "'1'")
      ]
    )
    # Should follow user attribute references and autocomplete those types.
    self.assertEqual(
      self.autocomplete("user.StudentInfo.", "Schools", "lastModified", row_id=2),
      [
        ('user.StudentInfo.birthDate', 'None'),
        ('user.StudentInfo.firstName', "'Barack'"),
        ('user.StudentInfo.homeAddress', 'Address[11]'),
        ('user.StudentInfo.homeAddress.city', "'New York'"),
        ('user.StudentInfo.id', '1'),
        ('user.StudentInfo.lastName', "'Obama'"),
        ('user.StudentInfo.lastVisit', 'None'),
        ('user.StudentInfo.school', 'Schools[1]'),
        ('user.StudentInfo.school.name', "'Columbia'"),
        ('user.StudentInfo.schoolCities', repr(u'New York:Colombia')),
        ('user.StudentInfo.schoolIds', repr(u'1:2')),
        ('user.StudentInfo.schoolName', "'Columbia'"),
      ]
    )
    # Should not show user attribute completions if user doesn't have attribute.
    user2 = {
      'Name': 'Bar',
      'Origin': None,
      'Email': 'baro@example.com',
      'LinkKey': {},
      'UserID': 2,
      'UserRef': '2',
      'Access': 'owners',
      'SessionID': 'u2',
      'IsLoggedIn': True,
      'ShareRef': None
    }
    self.assertEqual(
      self.autocomplete("user.", "Schools", "lastModified", user2, row_id=2),
      [
        ('user.Access', "'owners'"),
        ('user.Email', "'baro@example.com'"),
        ('user.IsLoggedIn', 'True'),
        ('user.LinkKey', None),
        ('user.Name', "'Bar'"),
        ('user.Origin', 'None'),
        ('user.SessionID', "'u2'"),
        ('user.ShareRef', 'None'),
        ('user.UserID', '2'),
        ('user.UserRef', "'2'"),
      ]
    )
    self.assertEqual(
      self.autocomplete("user.StudentInfo.", "Schools", "schoolCities", user2),
      []
    )

  def test_function(self):
    self.assertEqual(self.autocomplete("MEDI", "Address", "city"),
                     [('MEDIAN', '(value, *more_values)', True)])
    self.assert_autocomplete_includes("ma", "Address", "city", {
      ('MAX', '(value, *more_values)', True),
      ('MAXA', '(value, *more_values)', True),
      'map(',
      'math',
      'max(',
    })

  def test_member(self):
    self.assertEqual(self.autocomplete("datetime.tz", "Address", "city"),
                     ["datetime.tzinfo("])

  def test_case_insensitive(self):
    self.assertEqual(self.autocomplete("medi", "Address", "city"),
        [('MEDIAN', '(value, *more_values)', True)])
    self.assertEqual(self.autocomplete("std", "Address", "city"), [
      ('STDEV', '(value, *more_values)', True),
      ('STDEVA', '(value, *more_values)', True),
      ('STDEVP', '(value, *more_values)', True),
      ('STDEVPA', '(value, *more_values)', True)
    ])
    self.assertEqual(
      self.autocomplete("stu", "Address", "city"),
      [
        'Students',
        ('Students.lookupOne', '(colName=<value>, ...)', True),
        ('Students.lookupRecords', '(colName=<value>, ...)', True),
        'Students.lookupRecords(homeAddress=$id)',
        'Students_summary_school',
        ('Students_summary_school.lookupOne', '(colName=<value>, ...)', True),
        ('Students_summary_school.lookupRecords', '(colName=<value>, ...)', True)
      ],
    )

    # Add a table name whose lowercase version conflicts with a builtin.
    self.apply_user_action(['AddTable', 'Max', []])
    self.assertEqual(self.autocomplete("max", "Address", "city"), [
      ('MAX', '(value, *more_values)', True),
      ('MAXA', '(value, *more_values)', True),
      'Max',
      ('Max.lookupOne', '(colName=<value>, ...)', True),
      ('Max.lookupRecords', '(colName=<value>, ...)', True),
      'max(',
    ])
    self.assertEqual(self.autocomplete("MAX", "Address", "city"), [
      ('MAX', '(value, *more_values)', True),
      ('MAXA', '(value, *more_values)', True),
    ])


  def test_suggest_globals_and_tables(self):
    # Should suggest globals and table names.
    self.assertEqual(self.autocomplete("ME", "Address", "city"),
        [('MEDIAN', '(value, *more_values)', True)])
    self.assertEqual(
      self.autocomplete("Ad", "Address", "city"),
      [
        'Address',
        ('Address.lookupOne', '(colName=<value>, ...)', True),
        ('Address.lookupRecords', '(colName=<value>, ...)', True),
      ],
    )
    self.assertGreaterEqual(set(self.autocomplete("S", "Address", "city")), {
      'Schools',
      'Students',
      ('SUM', '(value1, *more_values)', True),
      ('STDEV', '(value, *more_values)', True),
    })
    self.assertGreaterEqual(set(self.autocomplete("s", "Address", "city")), {
      'Schools',
      'Students',
      'sum(',
      ('SUM', '(value1, *more_values)', True),
      ('STDEV', '(value, *more_values)', True),
    })
    self.assertEqual(
      self.autocomplete("Addr", "Schools", "budget"),
      [
        'Address',
        ('Address.lookupOne', '(colName=<value>, ...)', True),
        ('Address.lookupRecords', '(colName=<value>, ...)', True),
      ],
    )

  def test_suggest_columns(self):
    self.assertEqual(self.autocomplete("$ci", "Address", "city"),
                     ["$city"])
    self.assertEqual(self.autocomplete("rec.i", "Address", "city"),
                     ["rec.id"])
    self.assertEqual(len(self.autocomplete("$", "Address", "city")),
                     2)

    # A few more detailed examples.
    self.assertEqual(self.autocomplete("$", "Students", "school"),
                     ['$birthDate', '$firstName', '$homeAddress', '$homeAddress.city',
                      '$id', '$lastName', '$lastVisit',
                      '$school', '$school.name', '$schoolCities', '$schoolIds', '$schoolName'])
    self.assertEqual(self.autocomplete("$fi", "Students", "birthDate"),
                     ['$firstName'])
    self.assertEqual(self.autocomplete("$school", "Students", "lastVisit"),
        ['$school', '$school.name', '$schoolCities', '$schoolIds', '$schoolName'])

  def test_suggest_lookup_methods(self):
    # Should suggest lookup formulas for tables.
    address_dot_completion = self.autocomplete("Address.", "Students", "firstName")
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
      self.autocomplete("Address.lookup", "Students", "lastName"),
      [
        ('Address.lookupOne', '(colName=<value>, ...)', True),
        ('Address.lookupRecords', '(colName=<value>, ...)', True),
      ]
    )

    self.assertEqual(
      self.autocomplete("address.look", "Students", "schoolName"),
      [
        ('Address.lookupOne', '(colName=<value>, ...)', True),
        ('Address.lookupRecords', '(colName=<value>, ...)', True),
      ]
    )

  def test_suggest_column_type_methods(self):
    # Should treat columns as correct types.
    self.assert_autocomplete_includes("$firstName.", "Students", "firstName",
      {'$firstName.startswith(', '$firstName.replace(', '$firstName.title('}
    )
    self.assert_autocomplete_includes("$birthDate.", "Students", "lastName",
      {'$birthDate.month', '$birthDate.strftime(', '$birthDate.replace('}
    )
    self.assert_autocomplete_includes("$lastVisit.m", "Students", "firstName",
      {'$lastVisit.month', '$lastVisit.minute'}
    )
    self.assert_autocomplete_includes("$school.", "Students", "firstName",
      {'$school.address', '$school.name', '$school.yearFounded', '$school.budget'}
    )
    self.assertEqual(self.autocomplete("$school.year", "Students", "lastName"),
                     ['$school.yearFounded'])
    self.assert_autocomplete_includes("$yearFounded.", "Schools", "budget",
      {
        '$yearFounded.denominator',    # Only integers have this
        '$yearFounded.bit_length(',    # and this
        '$yearFounded.real'
      }
    )
    self.assert_autocomplete_includes("$budget.", "Schools", "budget",
      {'$budget.is_integer(', '$budget.real'}    # Only floats have this
    )

  def test_suggest_follows_references(self):
    # Should follow references and autocomplete those types.
    self.assertEqual(
      self.autocomplete("$school.name.st", "Students", "firstName"),
      ['$school.name.startswith(', '$school.name.strip(']
    )
    self.assert_autocomplete_includes("$school.yearFounded.","Students", "firstName",
      {
        '$school.yearFounded.denominator',
        '$school.yearFounded.bit_length(',
        '$school.yearFounded.real'
      }
    )

    self.assertEqual(
      self.autocomplete("$school.address.", "Students", "lastName"),
      ['$school.address.city', '$school.address.id']
    )
    self.assertEqual(
      self.autocomplete("$school.address.city.st", "Students", "lastName"),
      ['$school.address.city.startswith(', '$school.address.city.strip(']
    )

  def test_suggest_lookup_early(self):
    # For part of a table name, suggest lookup methods early,
    # including a 'reverse reference' lookup, i.e. `<refcol to current table>=$id`,
    # but only for `lookupRecords`, not `lookupOne`.
    self.assertEqual(
      self.autocomplete("stu", "Schools", "name"),
      [
        'Students',
        ('Students.lookupOne', '(colName=<value>, ...)', True),
        ('Students.lookupRecords', '(colName=<value>, ...)', True),
        # i.e. Students.school is a reference to Schools
        'Students.lookupRecords(school=$id)',
        'Students_summary_school',
        ('Students_summary_school.lookupOne', '(colName=<value>, ...)', True),
        ('Students_summary_school.lookupRecords', '(colName=<value>, ...)', True),
        'Students_summary_school.lookupRecords(school=$id)',
      ],
    )
    self.assertEqual(
      self.autocomplete("scho", "Address", "city"),
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
      self.autocomplete("scho", "Students", "firstName"),
      [
        'Schools',
        ('Schools.lookupOne', '(colName=<value>, ...)', True),
        ('Schools.lookupRecords', '(colName=<value>, ...)', True),
      ],
    )

    # Test from within a summary table
    self.assertEqual(
      self.autocomplete("stu", "Students_summary_school", "count"),
      [
        'Students',
        ('Students.lookupOne', '(colName=<value>, ...)', True),
        ('Students.lookupRecords', '(colName=<value>, ...)', True),
        'Students_summary_school',
        ('Students_summary_school.lookupOne', '(colName=<value>, ...)', True),
        ('Students_summary_school.lookupRecords', '(colName=<value>, ...)', True),
      ],
    )

  def test_suggest_lookup_arguments(self):
    # Typing in the full `.lookupRecords(` should suggest keyword argument (i.e. column) names,
    # in addition to reference lookups, including the reverse reference lookups above.
    self.assertEqual(
      self.autocomplete("Schools.lookupRecords(", "Address", "city"),
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
      self.autocomplete("Schools.lookupRecords(", "Students", "firstName"),
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
      self.autocomplete("Students.lookupRecords(", "Schools", "name"),
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
      self.autocomplete("Students.lookupRecords(", "Schools", "name"),
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

  def autocomplete(self, formula, table, column, user=None, row_id=None):
    """
    Mild convenience over self.engine.autocomplete.
    Only returns suggestions without example values, unless row_id is specified.
    """
    user = user or self.user
    results = self.engine.autocomplete(formula, table, column, row_id or 1, user)
    if row_id is None:
      return [result for result, value in results]
    else:
      return results

  def assert_autocomplete_includes(self, formula, table, column, expected, user=None, row_id=None):
    completions = self.autocomplete(formula, table, column, user=user, row_id=row_id)

    def replace_completion(completion):
      if isinstance(completion, str) and completion.endswith('()'):
        # Python 3.10+ autocompletes the closing paren for methods with no arguments.
        # This allows the test to check for `somestring.title(` and work across Python versions.
        assert sys.version_info >= (3, 10)
        return completion[:-1]
      return completion

    completions = set(replace_completion(completion) for completion in completions)
    self.assertGreaterEqual(completions, expected)

  def test_example_values(self):
    self.assertEqual(
      self.autocomplete("$", "Schools", "name", row_id=1),
      [
        ('$address', 'Address[11]'),
        ('$budget', '0.0'),
        ('$id', '1'),
        ('$lastModified', 'None'),
        ('$lastModifier', repr(u'')),
        ('$name', "'Columbia'"),
        ('$yearFounded', '0'),
      ],
    )

    self.assertEqual(
      self.autocomplete("$", "Schools", "name", row_id=3),
      [
        ('$address', 'Address[13]'),
        ('$budget', '123.45'),
        ('$id', '3'),
        ('$lastModified', '2018-01-01 12:00am'),
        ('$lastModifier', None),
        ('$name', "'Yale'"),
        ('$yearFounded', '2010'),
      ],
    )

    self.assertEqual(
      self.autocomplete("$", "Address", "name", row_id=1),
      [
        ('$city', repr(u'')),  # for Python 2/3 compatibility
        ('$id', '0'),  # row_id 1 doesn't exist!
      ],
    )
    self.assertEqual(
      self.autocomplete("$", "Address", "name", row_id=11),
      [
        ('$city', "'New York'"),
        ('$id', '11'),
      ],
    )
    self.assertEqual(
      self.autocomplete("$", "Address", "name", row_id='new'),
      [
        ('$city', "'West Haven'"),
        ('$id', '14'),  # row_id 'new' gets replaced with the maximum row ID in the table
      ],
    )

    self.assertEqual(
      self.autocomplete("$", "Students", "name", row_id=1),
      [
        ('$birthDate', 'None'),
        ('$firstName', "'Barack'"),
        ('$homeAddress', 'Address[11]'),
        ('$homeAddress.city', "'New York'"),
        ('$id', '1'),
        ('$lastName', "'Obama'"),
        ('$lastVisit', 'None'),
        ('$school', 'Schools[1]'),
        ('$school.name', "'Columbia'"),
        ('$schoolCities', repr(u'New York:Colombia')),
        ('$schoolIds', repr(u'1:2')),
        ('$schoolName', "'Columbia'"),
      ],
    )

    self.assertEqual(
      self.autocomplete("rec", "Students", "name", row_id=1),
      [
        # Mixture of suggestions with and without values
        (('RECORD', '(record_or_list, dates_as_iso=False, expand_refs=0)', True), None),
        ('rec', 'Students[1]'),
      ],
    )

  def test_repr(self):
    date = datetime.date(2019, 12, 31)
    dtime = datetime.datetime(2019, 12, 31, 13, 23)
    self.assertEqual(repr_example(date), "2019-12-31")
    self.assertEqual(repr_example(dtime), "2019-12-31 1:23pm")
    self.assertEqual(repr_example([1, 'a', dtime, date]),
                     "[1, 'a', 2019-12-31 1:23pm, 2019-12-31]")

    prefix = "<BadRepr instance at 0x"
    self.assertEqual(repr_example(BadRepr())[:len(prefix)], prefix)

    big_list = [9] * 100000
    self.assertEqual(len(big_list), 100000)
    big_list_repr = repr_example(big_list)
    self.assertEqual(len(big_list_repr), 605)
    self.assertEqual(big_list_repr, "[%s...]" % ("9, " * 200))

  def test_eval_suggestion(self):
    class Record(object):
      def __init__(self, name):
        self.name = name

      def __repr__(self):
        return "Record(%s)" % self.name

      @property
      def bad(self):
        raise Exception("bad")

    rec = Record('rec')
    rec.subrec = Record('subrec')
    rec.subrec.meaning = 42
    rec.bad_repr = BadRepr()
    rec.big = "a" * 100000
    user = Record('user')
    user.email = 'my_email'
    user.LinkKey = Record('LinkKey')
    user.LinkKey.id = 123

    self.assertEqual(eval_suggestion('rec', rec, user), 'Record(rec)')
    self.assertEqual(eval_suggestion('rec.subrec', rec, user), 'Record(subrec)')
    self.assertEqual(eval_suggestion('rec.subrec.meaning', rec, user), '42')

    self.assertEqual(eval_suggestion('rec.spam', rec, user), None)  # doesn't exist
    self.assertEqual(eval_suggestion('rec.bad', rec, user), None)  # property raises an error

    # attribute exists, but repr() raises an error
    prefix = "<BadRepr instance at 0x"
    self.assertEqual(eval_suggestion('rec.bad_repr', rec, user)[:len(prefix)], prefix)

    # attribute exists, but repr() is too long and gets truncated
    big_repr = repr_example(rec.big)
    self.assertEqual(eval_suggestion('rec.big', rec, user), big_repr)
    self.assertEqual(len(big_repr), 200)

    # No string representations for these two
    self.assertEqual(eval_suggestion('user', rec, user), None)
    self.assertEqual(eval_suggestion('user.LinkKey', rec, user), None)

    self.assertEqual(eval_suggestion('user.email', rec, user), "'my_email'")
    self.assertEqual(eval_suggestion('user.LinkKey.id', rec, user), '123')

    self.assertEqual(eval_suggestion('user.spam', rec, user), None)  # doesn't exist
    self.assertEqual(eval_suggestion('user.bad', rec, user), None)  # property raises an error

    self.assertEqual(eval_suggestion('subrec', rec, user), None)  # other variables not supported


class BadRepr(object):
  def __repr__(self):
    raise Exception("Bad repr")
