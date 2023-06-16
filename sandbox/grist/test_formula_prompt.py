import unittest
import six

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
    ]), "List[Table1]")
    self.assertEqual(values_type([
      fake_table.RecordSet(None),
      fake_table.RecordSet(None),
      None,
    ]), "Optional[List[Table1]]")

    self.assertEqual(values_type([[1, 2, 3]]), "List[int]")
    self.assertEqual(values_type([[1, 2, 3], None]), "Optional[List[int]]")
    self.assertEqual(values_type([[1, 2, None]]), "List[Optional[int]]")
    self.assertEqual(values_type([[1, 2, None], None]), "Optional[List[Optional[int]]]")
    self.assertEqual(values_type([[1, 2, "3"]]), "List[Any]")

    self.assertEqual(values_type([{1, 2, 3}]), "Set[int]")
    self.assertEqual(values_type([(1, 2, 3)]), "Tuple[int, ...]")
    self.assertEqual(values_type([{1: ["2"]}]), "Dict[int, List[str]]")

  def assert_column_type(self, col_id, expected_type):
    self.assertEqual(column_type(self.engine, "Table2", col_id), expected_type)

  def assert_prompt(self, table_name, col_id, expected_prompt):
    prompt = get_formula_prompt(self.engine, table_name, col_id, "description here",
                                include_all_tables=False, lookups=False)
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
    self.assert_column_type("reflist", "List[Table2]")
    self.assert_column_type("choice", "Literal['a', 'b', 'c']")
    self.assert_column_type("choicelist", "Tuple[Literal['x', 'y', 'z'], ...]")
    self.assert_column_type("ref_formula", "Optional[Table2]")
    self.assert_column_type("numeric_formula", "float")

    self.assertEqual(referenced_tables(self.engine, "Table2"), set())

    self.assert_prompt("Table2", "new_formula",
      '''\
@dataclass
class Table2:
    text: str
    numeric: float
    int: int
    bool: bool
    date: datetime.date
    datetime: datetime.datetime
    attachments: Any
    ref: Table2
    reflist: List[Table2]
    choice: Literal['a', 'b', 'c']
    choicelist: Tuple[Literal['x', 'y', 'z'], ...]
    ref_formula: Optional[Table2]
    numeric_formula: float

    @property
    # rec is alias for self
    def new_formula(rec) -> float:
        """
        description here
        """
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
@dataclass
class Table1:

    @property
    # rec is alias for self
    def text(rec) -> str:
        """
        description here
        """
''')

    self.assert_prompt("Table2", "ref", '''\
@dataclass
class Table1:
    text: str

@dataclass
class Table2:

    @property
    # rec is alias for self
    def ref(rec) -> Table1:
        """
        description here
        """
''')

    self.assert_prompt("Table3", "reflist", '''\
@dataclass
class Table1:
    text: str

@dataclass
class Table2:
    ref: Table1

@dataclass
class Table3:

    @property
    # rec is alias for self
    def reflist(rec) -> List[Table2]:
        """
        description here
        """
''')

  def test_convert_completion(self):
    completion = """
Here's some code:

```python
import os
from x import (
  y,
  z,
)

@property
def foo():
    '''This is a docstring'''
    x = 5
    return 1
```

Hope you like it!
"""
    self.assertEqual(convert_completion(completion), """\
import os
from x import (
  y,
  z,
)

x = 5
return 1""")
