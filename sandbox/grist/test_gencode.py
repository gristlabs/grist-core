import ast

import unittest
import difflib
import re
import gencode
import identifiers
import schema
import table
import testutil

schema_data = [
  [1, "Students", [
    [1, "firstName",   "Text",        False, '', "firstName", ''],
    [2, "lastName",    "Text",        False, '', "lastName", ''],
    [3, "fullName",    "Any",         True,
      "rec.firstName + ' ' + rec.lastName", "fullName", ''],
    [4, "fullNameLen", "Any",         True, "len(rec.fullName)", "fullNameLen", ''],
    [5, "school",      "Ref:Schools", False, '', "school", ''],
    [6, "schoolShort",  "Any",        True, "rec.school.name.split(' ')[0]", "schoolShort", ''],
    [9, "schoolRegion", "Any",        True,
      "addr = $school.address\naddr.state if addr.country == 'US' else addr.region",
      "schoolRegion", ''],
    [8, "school2",     "Ref:Schools", True, "Schools.lookupFirst(name=rec.school.name)", "", ""]
  ]],
  [2, "Schools", [
    [10, "name",        "Text",       False, '', "name", ''],
    [12, "address",     "Ref:Address",False, '', "address", '']
  ]],
  [3, "Address", [
    [21, "city",        "Text",       False, '', "city", ''],
    [27, "state",       "Text",       False, '', "state", ''],
    [28, "country",     "Text",       False, "'US'", "country", ''],
    [29, "region",      "Any",        True,
          "{'US': 'North America', 'UK': 'Europe'}.get(rec.country, 'N/A')", "region", ''],
    [30, "badSyntax",   "Any",        True, "for a in\n10", "", ""],
  ]]
]

class TestGenCode(unittest.TestCase):
  def setUp(self):
    # Convert the meta tables to appropriate table representations for loading.
    meta_tables = testutil.table_data_from_rows(
      '_grist_Tables',
      ("id", "tableId"),
      [(table_row_id, table_id) for (table_row_id, table_id, _) in schema_data])

    meta_columns = testutil.table_data_from_rows(
      '_grist_Tables_column',
      ("parentId", "parentPos", "id", "colId", "type",
        "isFormula", "formula", "label", "widgetOptions"),
      [[table_row_id, i] + e for (table_row_id, _, entries) in schema_data
       for (i, e) in enumerate(entries)])

    self.schema = schema.build_schema(meta_tables, meta_columns, include_builtin=False)

  def test_make_module_text(self):
    """
    Test that make_module_text produces the exact sample output that we have stored
    in the docstring of usercode.py.
    """
    import usercode
    usercode_sample_re = re.compile(r'^==========*\n', re.M)
    saved_sample = usercode_sample_re.split(usercode.__doc__)[1]

    gcode = gencode.GenCode()
    gcode.make_module(self.schema)
    generated = gcode.get_user_text()
    saved_sample = saved_sample.replace(
        "raise SyntaxError('invalid syntax', ('usercode', 1, 9, u'for a in'))",
        "raise SyntaxError('invalid syntax\\n\\n"
        "A `SyntaxError` occurs when Python cannot understand your code.\\n\\n', "
        "('usercode', 1, 9, 'for a in'))"
    )
    self.assertEqual(generated, saved_sample, "Generated code doesn't match sample:\n" +
                     "".join(difflib.unified_diff(generated.splitlines(True),
                                                  saved_sample.splitlines(True),
                                                  fromfile="generated",
                                                  tofile="usercode.py")))

  def test_make_module(self):
    """
    Test that the generated module has the classes and nested classes we expect.
    """
    gcode = gencode.GenCode()
    gcode.make_module(self.schema)
    module = gcode.usercode
    # pylint: disable=E1101
    self.assertTrue(isinstance(module.Students, table.UserTable))

  def test_multiline_string_indent(self):
    """
    Test that multiline strings don't get affected by formula indentations.
    """
    def get_built_formula(formula):
      # We rebuild the entire doc with the given formula (for the "Students.fullName" column), and
      # return the AST node for the formula's function. This goes through the entire module
      # compilation, so includes all formula transformations including indentation changes.
      updated_schema = self.schema.copy()
      updated_columns = updated_schema['Students'].columns.copy()
      updated_columns['fullName'] = updated_columns['fullName']._replace(formula=formula)
      updated_schema['Students'] = updated_schema['Students']._replace(columns=updated_columns)

      gcode = gencode.GenCode()
      gcode.make_module(updated_schema)
      # Find the ast node for the "fullName" function which has our formula.
      tree = ast.parse(gcode.get_user_text())
      for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == 'fullName':
          return node
      return None

    def assert_correct_formula(formula, expected_compiled_formula):
      actual_formula_body = get_built_formula(formula).body
      expected_formula_body = ast.parse(expected_compiled_formula).body
      self.assertEqual(
          [ast.dump(n, indent=2) for n in actual_formula_body],
          [ast.dump(n, indent=2) for n in expected_formula_body])

    # The original simple one-line formula.
    assert_correct_formula(
        "rec.firstName + ' ' + rec.lastName",
        "return rec.firstName + ' ' + rec.lastName")

    # Same, but with $. We are just testing normal behavior, and that test checks work.
    assert_correct_formula(
        "$firstName + ' ' + $lastName",
        "return rec.firstName + ' ' + rec.lastName")

    # Try a formulas with multiple lines and indents.
    assert_correct_formula(
        "if rec.a:\n  return 1\nelse:\n  return 2\nreturn unreachable",
        "if rec.a:\n  return 1\nelse:\n  return 2\nreturn unreachable")

    # Test multiline strings
    assert_correct_formula(
        "$firstName\n'''\nMultiline\n''' + 'Not\\nactually\\nmultiline'",
        "rec.firstName\nreturn '''\nMultiline\n''' + 'Not\\nactually\\nmultiline'")
    assert_correct_formula(
        "a = '''\nMultiline\n'''\nreturn a",
        "a = '''\nMultiline\n'''\nreturn a")
    assert_correct_formula(
        "r'''    foo\nMultiline\n\n  bar''' + 'Not\\nactually\\nmultiline'",
        "return r'''    foo\nMultiline\n\n  bar''' + 'Not\\nactually\\nmultiline'")
    # Multi-line f-string.
    assert_correct_formula(
        "rf'''\nMulti{\n1 + $fullNameLen}line\n''' + 'Not\\nactually\\nmultiline'",
        "return rf'''\nMulti{\n1 + rec.fullNameLen}line\n''' + 'Not\\nactually\\nmultiline'")


  def test_ident_combining_chars(self):
    def check(label, ident):
      self.assertEqual(ident, identifiers.pick_table_ident(label))
      self.assertEqual(ident, identifiers.pick_col_ident(label))
      self.assertEqual(ident.lower(), identifiers.pick_col_ident(label.lower()))

    # Actual example table name from a user
    # unicodedata.normalize can separate accents but doesn't help with Đ
    check(
      u"Bảng_Đặc_Thù",
      u"Bang__ac_Thu",
    )

    check(
      u"Noëlle",
      u"Noelle",
    )
    check(
      u"Séamus",
      u"Seamus",
    )
    check(
      u"Hélène",
      u"Helene",
    )
    check(
      u"Dilâçar",
      u"Dilacar",
    )
    check(
      u"Erdoğan",
      u"Erdogan",
    )
    check(
      u"Ñwalme",
      u"Nwalme",
    )
    check(
      u"Árvíztűrő tükörfúrógép",
      u"Arvizturo_tukorfurogep",
    )

  def test_pick_col_ident(self):
    self.assertEqual(identifiers.pick_col_ident("asdf"), "asdf")
    self.assertEqual(identifiers.pick_col_ident(" a s==d!~@#$%^f"), "a_s_d_f")
    self.assertEqual(identifiers.pick_col_ident("123asdf"), "c123asdf")
    self.assertEqual(identifiers.pick_col_ident("!@#"), "A")
    self.assertEqual(identifiers.pick_col_ident("!@#1"), "c1")
    self.assertEqual(identifiers.pick_col_ident("heLLO world"), "heLLO_world")
    self.assertEqual(identifiers.pick_col_ident("!@#", avoid={"A"}), "B")

    self.assertEqual(identifiers.pick_col_ident("foo", avoid={"bar"}), "foo")
    self.assertEqual(identifiers.pick_col_ident("foo", avoid={"foo"}), "foo2")
    self.assertEqual(identifiers.pick_col_ident("foo", avoid={"foo", "foo2", "foo3"}), "foo4")
    self.assertEqual(identifiers.pick_col_ident("foo1", avoid={"foo1", "foo2", "foo1_2"}), "foo1_3")
    self.assertEqual(identifiers.pick_col_ident(""), "A")
    self.assertEqual(identifiers.pick_table_ident(""), "Table1")
    self.assertEqual(identifiers.pick_col_ident("", avoid={"A"}), "B")
    self.assertEqual(identifiers.pick_col_ident("", avoid={"A","B"}), "C")
    self.assertEqual(identifiers.pick_col_ident(None, avoid={"A","B"}), "C")
    self.assertEqual(identifiers.pick_col_ident("", avoid={'a','b','c','d','E'}), 'F')
    self.assertEqual(identifiers.pick_col_ident(2, avoid={"c2"}), "c2_2")

    large_set = set()
    for i in range(730):
      large_set.add(identifiers._gen_ident(large_set))
    self.assertEqual(identifiers.pick_col_ident("", avoid=large_set), "ABC")

  def test_pick_table_ident(self):
    self.assertEqual(identifiers.pick_table_ident("123asdf"), "T123asdf")
    self.assertEqual(identifiers.pick_table_ident("!@#"), "Table1")
    self.assertEqual(identifiers.pick_table_ident("!@#1"), "T1")

    self.assertEqual(identifiers.pick_table_ident("heLLO world"), "HeLLO_world")
    self.assertEqual(identifiers.pick_table_ident("foo", avoid={"Foo"}), "Foo2")
    self.assertEqual(identifiers.pick_table_ident("foo", avoid={"Foo", "Foo2"}), "Foo3")
    self.assertEqual(identifiers.pick_table_ident("FOO", avoid={"foo", "foo2"}), "FOO3")

    self.assertEqual(identifiers.pick_table_ident(None, avoid={"Table"}), "Table1")
    self.assertEqual(identifiers.pick_table_ident(None, avoid={"Table1"}), "Table2")
    self.assertEqual(identifiers.pick_table_ident("!@#", avoid={"Table1"}), "Table2")
    self.assertEqual(identifiers.pick_table_ident(None, avoid={"Table1", "Table2"}), "Table3")

    large_set = set()
    for i in range(730):
      large_set.add("Table%d" % i)
    self.assertEqual(identifiers.pick_table_ident("", avoid=large_set), "Table730")

  def test_pick_col_ident_list(self):
    self.assertEqual(identifiers.pick_col_ident_list(["foo", "bar"], avoid={"bar"}),
                     ["foo", "bar2"])
    self.assertEqual(identifiers.pick_col_ident_list(["bar", "bar"], avoid={"foo"}),
                     ["bar", "bar2"])
    self.assertEqual(identifiers.pick_col_ident_list(["bar", "bar"], avoid={"bar"}),
                     ["bar2", "bar3"])
    self.assertEqual(identifiers.pick_col_ident_list(["bAr", "BAR"], avoid={"bar"}),
                     ["bAr2", "BAR3"])

  def test_gen_ident(self):
    self.assertEqual(identifiers._gen_ident(set()), 'A')
    self.assertEqual(identifiers._gen_ident({'A'}), 'B')
    self.assertEqual(identifiers._gen_ident({'foo','E','F','H'}), 'A')
    self.assertEqual(identifiers._gen_ident({'a','b','c','d','E'}), 'F')

  def test_get_grist_type(self):
    self.assertEqual(gencode.get_grist_type("Ref:Foo"), "grist.Reference('Foo')")
    self.assertEqual(gencode.get_grist_type("RefList:Foo"), "grist.ReferenceList('Foo')")
    self.assertEqual(gencode.get_grist_type("Int"), "grist.Int()")
    self.assertEqual(gencode.get_grist_type("DateTime:America/NewYork"),
                     "grist.DateTime('America/NewYork')")
    self.assertEqual(gencode.get_grist_type("DateTime:"), "grist.DateTime()")
    self.assertEqual(gencode.get_grist_type("DateTime"), "grist.DateTime()")
    self.assertEqual(gencode.get_grist_type("DateTime: foo bar "), "grist.DateTime('foo bar')")
    self.assertEqual(gencode.get_grist_type("DateTime: "), "grist.DateTime()")
    self.assertEqual(gencode.get_grist_type("RefList:\n ~!@#$%^&*'\":;,\t"),
                     "grist.ReferenceList('~!@#$%^&*\\'\":;,')")

  def test_grist_names(self):
    # Verifies that we can correctly extract the names of Grist objects that occur in formulas.
    # This is used by automatic formula adjustments when columns or tables get renamed.
    gcode = gencode.GenCode()
    gcode.make_module(self.schema)
    # The output of grist_names is described in codebuilder.py, and copied here:
    # col_info:   (table_id, col_id) for the formula the name is found in. It is the value passed
    #             in by gencode.py to codebuilder.make_formula_body().
    # start_pos:  Index of the start character of the name in the text of the formula.
    # table_id:   Parsed name when the tuple is for a table name; the name of the column's table
    #             when the tuple is for a column name.
    # col_id:     None when tuple is for a table name; col_id when the tuple is for a column name.
    expected_names = [
      (('Address', 'region'), 48, 'Address', 'country'),
      (('Students', 'fullName'), 4, 'Students', 'firstName'),
      (('Students', 'fullName'), 26, 'Students', 'lastName'),
      (('Students', 'fullNameLen'), 8, 'Students', 'fullName'),
      (('Students', 'schoolShort'), 11, 'Schools', 'name'),
      (('Students', 'schoolShort'), 4, 'Students', 'school'),
      (('Students', 'schoolRegion'), 15, 'Schools', 'address'),
      (('Students', 'schoolRegion'), 8, 'Students', 'school'),
      (('Students', 'schoolRegion'), 42, 'Address', 'country'),
      (('Students', 'schoolRegion'), 28, 'Address', 'state'),
      (('Students', 'schoolRegion'), 68, 'Address', 'region'),
      (('Students', 'school2'), 0, 'Schools', None),
      (('Students', 'school2'), 36, 'Schools', 'name'),
      (('Students', 'school2'), 29, 'Students', 'school'),
    ]
    self.assertEqual(gcode.grist_names(), expected_names)

    # Test the case of a bare-word function with a keyword argument appearing in a formula. This
    # case had a bug with code parsing.
    self.schema['Address'].columns['testcol'] = schema.SchemaColumn(
      'testcol', 'Any', True, 'foo(bar=$region) or max(Students.all, key=lambda n: -n)', None)
    gcode.make_module(self.schema)
    self.assertEqual(gcode.grist_names(), [expected_names[0]] + [
      (('Address', 'testcol'), 9, 'Address', 'region'),
      (('Address', 'testcol'), 24, 'Students', None),
    ] + expected_names[1:])


if __name__ == "__main__":
  unittest.main()
