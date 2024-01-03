from user import User
import test_engine
import testsamples

class TestUser(test_engine.EngineTestCase):
  # pylint: disable=no-member
  def setUp(self):
    super(TestUser, self).setUp()
    self.load_sample(testsamples.sample_students)

  def test_constructor_sets_user_attributes(self):
    data = {
      'Access': 'owners',
      'Name': 'Foo Bar',
      'Email': 'email@example.com',
      'UserID': 1,
      'UserRef': '1',
      'LinkKey': {
        'Param1': 'Param1Value',
        'Param2': 'Param2Value'
      },
      'Origin': 'https://getgrist.com',
      'StudentInfo': ['Students', 1],
      'SessionID': 'u1',
      'IsLoggedIn': True,
      'ShareRef': None
    }
    u = User(data, self.engine.tables)
    self.assertEqual(u.Name, 'Foo Bar')
    self.assertEqual(u.Email, 'email@example.com')
    self.assertEqual(u.UserID, 1)
    self.assertEqual(u.LinkKey.Param1, 'Param1Value')
    self.assertEqual(u.LinkKey.Param2, 'Param2Value')
    self.assertEqual(u.Access, 'owners')
    self.assertEqual(u.Origin, 'https://getgrist.com')
    self.assertEqual(u.StudentInfo.id, 1)
    self.assertEqual(u.StudentInfo.firstName, 'Barack')
    self.assertEqual(u.StudentInfo.lastName, 'Obama')
    self.assertEqual(u.StudentInfo.schoolName, 'Columbia')

  def test_setting_is_sample_substitutes_attributes_with_samples(self):
    data = {
      'Access': 'owners',
      'Name': None,
      'Email': 'email@getgrist.com',
      'UserID': 1,
      'UserRef': '1',
      'LinkKey': {
        'Param1': 'Param1Value',
        'Param2': 'Param2Value'
      },
      'Origin': 'https://getgrist.com',
      'StudentInfo': ['Students', 1],
      'SessionID': 'u1',
      'IsLoggedIn': True,
      'ShareRef': None
    }
    u = User(data, self.engine.tables, is_sample=True)
    self.assertEqual(u.StudentInfo.id, 0)
    self.assertEqual(u.StudentInfo.firstName, '')
    self.assertEqual(u.StudentInfo.lastName, '')
    self.assertEqual(u.StudentInfo.schoolName, '')
