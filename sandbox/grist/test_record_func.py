# pylint: disable=line-too-long
import datetime
import logging
import actions
import moment
import objtypes
from objtypes import RecordStub

import testsamples
import testutil
import test_engine

log = logging.getLogger(__name__)

def _bulk_update(table_name, col_names, row_data):
  return actions.BulkUpdateRecord(
    *testutil.table_data_from_rows(table_name, col_names, row_data))

class TestRecordFunc(test_engine.EngineTestCase):

  def test_record_self(self):
    self.load_sample(testsamples.sample_students)
    self.add_column("Schools", "Foo", formula='RECORD(rec)')
    self.assertPartialData("Schools", ["id", "Foo"], [
      [1,     {'address': RecordStub('Address', 11), 'id': 1, 'name': 'Columbia'}],
      [2,     {'address': RecordStub('Address', 12), 'id': 2, 'name': 'Columbia'}],
      [3,     {'address': RecordStub('Address', 13), 'id': 3, 'name': 'Yale'}],
      [4,     {'address': RecordStub('Address', 14), 'id': 4, 'name': 'Yale'}],
    ])

    # A change to data is reflected
    self.update_record("Schools", 3, name="UConn")
    self.assertPartialData("Schools", ["id", "Foo"], [
      [1,     {'address': RecordStub('Address', 11), 'id': 1, 'name': 'Columbia'}],
      [2,     {'address': RecordStub('Address', 12), 'id': 2, 'name': 'Columbia'}],
      [3,     {'address': RecordStub('Address', 13), 'id': 3, 'name': 'UConn'}],
      [4,     {'address': RecordStub('Address', 14), 'id': 4, 'name': 'Yale'}],
    ])

    # A column addition is reflected
    self.add_column("Schools", "Bar", formula='len($name)')
    self.assertPartialData("Schools", ["id", "Foo"], [
      [1,     {'address': RecordStub('Address', 11), 'Bar': 8, 'id': 1, 'name': 'Columbia'}],
      [2,     {'address': RecordStub('Address', 12), 'Bar': 8, 'id': 2, 'name': 'Columbia'}],
      [3,     {'address': RecordStub('Address', 13), 'Bar': 5, 'id': 3, 'name': 'UConn'}],
      [4,     {'address': RecordStub('Address', 14), 'Bar': 4, 'id': 4, 'name': 'Yale'}],
    ])

  def test_reference(self):
    self.load_sample(testsamples.sample_students)
    self.add_column("Schools", "Foo", formula='RECORD($address)')
    self.assertPartialData("Schools", ["id", "Foo"], [
      [1,     {'city': 'New York', 'id': 11}],
      [2,     {'city': 'Colombia', 'id': 12}],
      [3,     {'city': 'New Haven', 'id': 13}],
      [4,     {'city': 'West Haven', 'id': 14}],
    ])

    # A change to referenced data is still reflected; try a different kind of change here
    self.apply_user_action(["RenameColumn", "Address", "city", "ciudad"])
    self.assertPartialData("Schools", ["id", "Foo"], [
      [1,     {'ciudad': 'New York', 'id': 11}],
      [2,     {'ciudad': 'Colombia', 'id': 12}],
      [3,     {'ciudad': 'New Haven', 'id': 13}],
      [4,     {'ciudad': 'West Haven', 'id': 14}],
    ])

  def test_record_expand_refs(self):
    self.load_sample(testsamples.sample_students)
    self.add_column("Schools", "Foo", formula='RECORD(rec, expand_refs=1)')
    self.add_column("Address", "student", type="Ref:Students")
    self.update_record("Address", 12, student=6)
    self.assertPartialData("Schools", ["id", "Foo"], [
      [1, {'address': {'city': 'New York', 'id': 11, 'student': RecordStub("Students", 0)},
        'id': 1, 'name': 'Columbia'}],
      [2, {'address': {'city': 'Colombia', 'id': 12, 'student': RecordStub("Students", 6)},
        'id': 2, 'name': 'Columbia'}],
      [3, {'address': {'city': 'New Haven', 'id': 13, 'student': RecordStub("Students", 0)},
        'id': 3, 'name': 'Yale'}],
      [4, {'address': {'city': 'West Haven', 'id': 14, 'student': RecordStub("Students", 0)},
        'id': 4, 'name': 'Yale'}],
    ])

    self.modify_column("Schools", "Foo", formula='RECORD(rec, expand_refs=2)')
    self.assertPartialData("Schools", ["id", "Foo"], [
      [1, {'address': {'city': 'New York', 'id': 11, 'student': None},
        'id': 1, 'name': 'Columbia'}],
      [2, {'address': {'city': 'Colombia', 'id': 12,
        'student': {'firstName': 'Gerald', 'schoolName': 'Yale', 'lastName': 'Ford',
        'schoolCities': 'New Haven:West Haven', 'schoolIds': '3:4', 'id': 6}},
        'id': 2, 'name': 'Columbia'}],
      [3, {'address': {'city': 'New Haven', 'id': 13, 'student': None},
        'id': 3, 'name': 'Yale'}],
      [4, {'address': {'city': 'West Haven', 'id': 14, 'student': None},
        'id': 4, 'name': 'Yale'}],
    ])

  def test_record_date_options(self):
    self.load_sample(testsamples.sample_students)
    self.add_column("Schools", "Foo", formula='RECORD(rec, expand_refs=1)')
    self.add_column("Address", "DT", type='DateTime')
    self.add_column("Address", "D", type='Date', formula="$DT and $DT.date()")
    self.update_records("Address", ['id', 'DT'], [
      [11, 1600000000],
      [13, 1500000000],
    ])

    d1 = datetime.datetime(2020, 9, 13, 8, 26, 40, tzinfo=moment.tzinfo('America/New_York'))
    d2 = datetime.datetime(2017, 7, 13, 22, 40, tzinfo=moment.tzinfo('America/New_York'))
    self.assertPartialData("Schools", ["id", "Foo"], [
      [1, {'address': {'city': 'New York', 'DT': d1, 'id': 11, 'D': d1.date()},
          'id': 1, 'name': 'Columbia'}],
      [2, {'address': {'city': 'Colombia', 'DT': None, 'id': 12, 'D': None},
          'id': 2, 'name': 'Columbia'}],
      [3, {'address': {'city': 'New Haven', 'DT': d2, 'id': 13, 'D': d2.date()},
          'id': 3, 'name': 'Yale'}],
      [4, {'address': {'city': 'West Haven', 'DT': None, 'id': 14, 'D': None},
          'id': 4, 'name': 'Yale'}],
    ])

    self.modify_column("Schools", "Foo",
        formula='RECORD(rec, expand_refs=1, dates_as_iso=True)')
    self.assertPartialData("Schools", ["id", "Foo"], [
      [1, {'address': {'city': 'New York', 'DT': d1.isoformat(), 'id': 11, 'D': d1.date().isoformat()},
          'id': 1, 'name': 'Columbia'}],
      [2, {'address': {'city': 'Colombia', 'DT': None, 'id': 12, 'D': None},
          'id': 2, 'name': 'Columbia'}],
      [3, {'address': {'city': 'New Haven', 'DT': d2.isoformat(), 'id': 13, 'D': d2.date().isoformat()},
          'id': 3, 'name': 'Yale'}],
      [4, {'address': {'city': 'West Haven', 'DT': None, 'id': 14, 'D': None},
          'id': 4, 'name': 'Yale'}],
    ])

  def test_record_set(self):
    self.load_sample(testsamples.sample_students)
    self.add_column("Students", "schools", formula='Schools.lookupRecords(name=$schoolName)')
    self.add_column("Students", "Foo", formula='RECORD($schools)')
    self.assertPartialData("Students", ["id", "Foo"], [
      [1, [{'address': RecordStub('Address', 11), 'id': 1, 'name': 'Columbia'},
           {'address': RecordStub('Address', 12), 'id': 2, 'name': 'Columbia'}]],
      [2, [{'address': RecordStub('Address', 13), 'id': 3, 'name': 'Yale'},
           {'address': RecordStub('Address', 14), 'id': 4, 'name': 'Yale'}]],
      [3, [{'address': RecordStub('Address', 11), 'id': 1, 'name': 'Columbia'},
           {'address': RecordStub('Address', 12), 'id': 2, 'name': 'Columbia'}]],
      [4, [{'address': RecordStub('Address', 13), 'id': 3, 'name': 'Yale'},
           {'address': RecordStub('Address', 14), 'id': 4, 'name': 'Yale'}]],
      [5, []],
      [6, [{'address': RecordStub('Address', 13), 'id': 3, 'name': 'Yale'},
           {'address': RecordStub('Address', 14), 'id': 4, 'name': 'Yale'}]],
    ])

    # Try a field with filtered lookupRecords result, as an iterable.
    self.modify_column("Students", "Foo",
        formula='RECORD(s for s in $schools if s.address.city.startswith("New"))')
    self.assertPartialData("Students", ["id", "Foo"], [
      [1, [{'address': RecordStub('Address', 11), 'id': 1, 'name': 'Columbia'}]],
      [2, [{'address': RecordStub('Address', 13), 'id': 3, 'name': 'Yale'}]],
      [3, [{'address': RecordStub('Address', 11), 'id': 1, 'name': 'Columbia'}]],
      [4, [{'address': RecordStub('Address', 13), 'id': 3, 'name': 'Yale'}]],
      [5, []],
      [6, [{'address': RecordStub('Address', 13), 'id': 3, 'name': 'Yale'}]],
    ])

  def test_record_bad_calls(self):
    self.load_sample(testsamples.sample_students)
    self.add_column("Schools", "Foo", formula='repr(RECORD($name))')
    self.assertPartialData("Schools", ["id", "Foo"], [
      [1, objtypes.RaisedException(ValueError())],
      [2, objtypes.RaisedException(ValueError())],
      [3, objtypes.RaisedException(ValueError())],
      [4, objtypes.RaisedException(ValueError())],
    ])
    self.modify_column("Schools", "Foo", formula='repr(sorted(RECORD(rec if $id == 2 else $id).items()))')
    self.assertPartialData("Schools", ["id", "Foo"], [
      [1, objtypes.RaisedException(ValueError())],
      [2, "[('address', Address[12]), ('id', 2), ('name', 'Columbia')]"],
      [3, objtypes.RaisedException(ValueError())],
      [4, objtypes.RaisedException(ValueError())],
    ])
    self.assertEqual(str(self.engine.get_formula_error('Schools', 'Foo', 1).error),
        'RECORD() requires a Record or an iterable of Records')

  def test_record_error_cells(self):
    self.load_sample(testsamples.sample_students)
    self.add_column("Schools", "Foo", formula='RECORD($address)')
    self.add_column("Address", "Bar", formula='$id//($id%2)')
    self.assertPartialData("Schools", ["id", "Foo"], [
      [1,     {'city': 'New York', 'Bar': 11, 'id': 11}],
      [2,     {'city': 'Colombia', 'Bar': None, 'id': 12,
              '_error_': {'Bar': 'ZeroDivisionError: integer division or modulo by zero'}}],
      [3,     {'city': 'New Haven', 'Bar': 13, 'id': 13}],
      [4,     {'city': 'West Haven', 'Bar': None, 'id': 14,
              '_error_': {'Bar': 'ZeroDivisionError: integer division or modulo by zero'}}],
    ])
