import unittest
import six
from asttokens.util import fstring_positions_work

import test_engine
import testutil

from formula_prompt import (
  values_type, column_type, referenced_tables, get_formula_prompt, convert_completion,
)
from objtypes import RaisedException
from records import Record as BaseRecord, RecordSet as BaseRecordSet


class FakeTable(object):

  def __init__(self):
    class Record(BaseRecord):
      _table = self
    class RecordSet(BaseRecordSet):
      _table = self
    self.Record = Record
    self.RecordSet = RecordSet

  table_id = "Table1"
  _identity_relation = None


fake_table = FakeTable()


@unittest.skipUnless(six.PY3, "Python 3 only")
class TestFormulaPrompt(test_engine.EngineTestCase):
  def test_values_type(self):
    self.assertEqual(values_type([1, 2, 3]), "int")
    self.assertEqual(values_type([1.0, 2.0, 3.0]), "float")
    self.assertEqual(values_type([1, 2, 3.0]), "float")

    self.assertEqual(values_type([1, 2, None]), "Optional[int]")
    self.assertEqual(values_type([1, 2, 3.0, None]), "Optional[float]")

    self.assertEqual(values_type([1, RaisedException(None), 3]), "int")
    self.assertEqual(values_type([1, RaisedException(None), None]), "Optional[int]")

    self.assertEqual(values_type(["1", "2", "3"]), "str")
    self.assertEqual(values_type([1, 2, "3"]), "Any")
    self.assertEqual(values_type([1, 2, "3", None]), "Any")

    self.assertEqual(values_type([
      fake_table.Record(None),
      fake_table.Record(None),
    ]), "Table1")
    self.assertEqual(values_type([
      fake_table.Record(None),
      fake_table.Record(None),
      None,
    ]), "Optional[Table1]")

    self.assertEqual(values_type([
      fake_table.RecordSet(None),
      fake_table.RecordSet(None),
    ]), "list[Table1]")
    self.assertEqual(values_type([
      fake_table.RecordSet(None),
      fake_table.RecordSet(None),
      None,
    ]), "Optional[list[Table1]]")

    self.assertEqual(values_type([[1, 2, 3]]), "list[int]")
    self.assertEqual(values_type([[1, 2, 3], None]), "Optional[list[int]]")
    self.assertEqual(values_type([[1, 2, None]]), "list[Optional[int]]")
    self.assertEqual(values_type([[1, 2, None], None]), "Optional[list[Optional[int]]]")
    self.assertEqual(values_type([[1, 2, "3"]]), "list[Any]")

    self.assertEqual(values_type([{1, 2, 3}]), "set[int]")
    self.assertEqual(values_type([(1, 2, 3)]), "tuple[int, ...]")
    self.assertEqual(values_type([{1: ["2"]}]), "dict[int, list[str]]")

  def assert_column_type(self, col_id, expected_type):
    self.assertEqual(column_type(self.engine, "Table2", col_id), expected_type)

  def assert_prompt(self, table_name, col_id, expected_prompt, lookups=False):
    prompt = get_formula_prompt(self.engine, table_name, col_id, "description here",
                                include_all_tables=False, lookups=lookups)
    # print(prompt)
    self.assertEqual(prompt, expected_prompt)

  def test_column_type(self):
    sample = testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Table2", [
          [1, "text", "Text", False, "", "", ""],
          [2, "numeric", "Numeric", False, "", "", ""],
          [3, "int", "Int", False, "", "", ""],
          [4, "bool", "Bool", False, "", "", ""],
          [5, "date", "Date", False, "", "", ""],
          [6, "datetime", "DateTime", False, "", "", ""],
          [7, "attachments", "Attachments", False, "", "", ""],
          [8, "ref", "Ref:Table2", False, "", "", ""],
          [9, "reflist", "RefList:Table2", False, "", "", ""],
          [10, "choice", "Choice", False, "", "", '{"choices": ["a", "b", "c"]}'],
          [11, "choicelist", "ChoiceList", False, "", "", '{"choices": ["x", "y", "z"]}'],
          [12, "ref_formula", "Any", True, "$ref or None", "", ""],
          [13, "numeric_formula", "Any", True, "1 / $numeric", "", ""],
          [14, "new_formula", "Numeric", True, "'to be generated...'", "", ""],
        ]],
      ],
      "DATA": {
        "Table2": [
          ["id", "numeric", "ref"],
          [1, 0, 0],
          [2, 1, 1],
        ],
      },
    })
    self.load_sample(sample)

    self.assert_column_type("text", "str")
    self.assert_column_type("numeric", "float")
    self.assert_column_type("int", "int")
    self.assert_column_type("bool", "bool")
    self.assert_column_type("date", "datetime.date")
    self.assert_column_type("datetime", "datetime.datetime")
    self.assert_column_type("attachments", "Any")
    self.assert_column_type("ref", "Table2")
    self.assert_column_type("reflist", "list[Table2]")
    self.assert_column_type("choice", "Literal['a', 'b', 'c']")
    self.assert_column_type("choicelist", "tuple[Literal['x', 'y', 'z'], ...]")
    self.assert_column_type("ref_formula", "Optional[Table2]")
    self.assert_column_type("numeric_formula", "float")

    self.assertEqual(referenced_tables(self.engine, "Table2"), set())

    self.assert_prompt("Table2", "new_formula",
      '''\
class Table2:
    text: str
    numeric: float
    int: int
    bool: bool
    date: datetime.date
    datetime: datetime.datetime
    attachments: Any
    ref: Table2
    reflist: list[Table2]
    choice: Literal['a', 'b', 'c']
    choicelist: tuple[Literal['x', 'y', 'z'], ...]
    ref_formula: Optional[Table2]
    numeric_formula: float

def new_formula(rec: Table2) -> float:
''')

  def test_get_formula_prompt(self):
    sample = testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Table1", [
          [1, "text", "Text", False, "", "", ""],
        ]],
        [2, "Table2", [
          [2, "ref", "Ref:Table1", False, "", "", ""],
        ]],
        [3, "Table3", [
          [3, "reflist", "RefList:Table2", False, "", "", ""],
        ]],
      ],
      "DATA": {},
    })
    self.load_sample(sample)
    self.assertEqual(referenced_tables(self.engine, "Table3"), {"Table1", "Table2"})
    self.assertEqual(referenced_tables(self.engine, "Table2"), {"Table1"})
    self.assertEqual(referenced_tables(self.engine, "Table1"), set())

    self.assert_prompt("Table1", "text", '''\
class Table1:

def text(rec: Table1) -> str:
''')

    # Test the same thing but include the lookup methods as in a real case,
    # just to show that the table class would never actually be empty
    # (which would be invalid Python and might confuse the model).
    self.assert_prompt("Table1", "text", """\
class Table1:
    def __len__(self):
        return len(Table1.lookupRecords())
    @staticmethod
    def lookupRecords(sort_by=None) -> list[Table1]:
       ...
    @staticmethod
    def lookupOne(sort_by=None) -> Table1:
       '''
       Filter for one result matching the keys provided.
       To control order, use e.g. `sort_by='Key' or `sort_by='-Key'`.
       '''
       return Table1.lookupRecords(sort_by=sort_by)[0]


def text(rec: Table1) -> str:
""", lookups=True)

    self.assert_prompt("Table2", "ref", '''\
class Table1:
    text: str

class Table2:

def ref(rec: Table2) -> Table1:
''')

    self.assert_prompt("Table3", "reflist", '''\
class Table1:
    text: str

class Table2:
    ref: Table1

class Table3:

def reflist(rec: Table3) -> list[Table2]:
''')

  @unittest.skipUnless(fstring_positions_work(), "Needs Python 3.10+")
  def test_convert_completion(self):
    completion = """
Here's some code:

```python
import os
from x import (
  y,
  z,
)

class Foo:
    bar: Bar

@property
def foo(rec):
    '''This is a docstring'''
    x = f"hello {rec.name} " + rec.name + "!"
    if rec.bar.spam:
      return 0
    return rec.a * rec.b
```

Hope you like it!
"""
    self.assertEqual(convert_completion(completion), """\
import os
from x import (
  y,
  z,
)

x = f"hello {$name} " + $name + "!"
if $bar.spam:
  return 0
$a * $b""")
