# -*- coding: utf-8 -*-
import unittest

import six
from asttokens.util import fstring_positions_work

import codebuilder
import test_engine

unicode_prefix = 'u' if six.PY2 else ''

def make_body(formula, default=None):
  return codebuilder.make_formula_body(formula, default).get_text()

class TestCodeBuilder(test_engine.EngineTestCase):
  def test_make_formula_body(self):
    # Test simple usage.
    self.assertEqual(make_body(""), "return None")
    self.assertEqual(make_body("", 0.0), "return 0.0")
    self.assertEqual(make_body("", ""), "return ''")
    self.assertEqual(make_body("  "), "return None")
    self.assertEqual(make_body("  ", "-"), "return '-'")
    self.assertEqual(make_body("\n\t"), "return None")
    self.assertEqual(make_body("$foo"), "return rec.foo")
    self.assertEqual(make_body("rec.foo"), "return rec.foo")
    self.assertEqual(make_body("return $foo"), "return rec.foo")
    self.assertEqual(make_body("return $f123"), "return rec.f123")
    self.assertEqual(make_body("return rec.foo"), "return rec.foo")
    self.assertEqual(make_body("$foo if $bar else max($foo.bar.baz)"),
                     "return rec.foo if rec.bar else max(rec.foo.bar.baz)")

    # Check that we don't mistake our temporary representation of "$" for the real thing.
    self.assertEqual(make_body("return DOLLARfoo"), "return DOLLARfoo")

    # Test that we don't translate $foo inside string literals or comments.
    self.assertEqual(make_body("$foo or '$foo'"), "return rec.foo or '$foo'")
    self.assertEqual(make_body("$foo * 2 # $foo"), "return rec.foo * 2 # $foo")
    self.assertEqual(make_body("$foo * 2 # $foo\n$bar"), "rec.foo * 2 # $foo\nreturn rec.bar")
    self.assertEqual(make_body("$foo or '\\'$foo\\''"), "return rec.foo or '\\'$foo\\''")
    self.assertEqual(make_body('$foo or """$foo"""'), 'return rec.foo or """$foo"""')
    self.assertEqual(make_body('$foo or """Some "$foos" stay"""'),
                     'return rec.foo or """Some "$foos" stay"""')

    # Check that we only insert a return appropriately.
    self.assertEqual(make_body('if $foo:\n  return 1\nelse:\n  return 2\n'),
                                    'if rec.foo:\n  return 1\nelse:\n  return 2\n')
    self.assertEqual(make_body('a = $foo\nmax(a, a*2)'), 'a = rec.foo\nreturn max(a, a*2)')

    # Check that return gets inserted correctly when there is a multi-line expression.
    self.assertEqual(make_body('($foo or\n $bar)'), 'return (rec.foo or\n rec.bar)')
    self.assertEqual(make_body('return ($foo or\n  $bar)'), 'return (rec.foo or\n  rec.bar)')
    self.assertEqual(make_body('if $foo: return 17'), 'if rec.foo: return 17')
    self.assertEqual(make_body('$foo\n# return $bar'), 'return rec.foo\n# return $bar')

    # Test that formulas with a single string literal work, including multi-line string literals.
    self.assertEqual(make_body('"test"'), 'return "test"')
    self.assertEqual(make_body('("""test1\ntest2\ntest3""")'), 'return ("""test1\ntest2\ntest3""")')
    self.assertEqual(make_body('"""test1\ntest2\ntest3"""'), 'return """test1\ntest2\ntest3"""')
    self.assertEqual(make_body('"""test1\\ntest2\\ntest3"""'), 'return """test1\\ntest2\\ntest3"""')

    # Same, with single quotes.
    self.assertEqual(make_body("'test'"), "return 'test'")
    self.assertEqual(make_body("('''test1\ntest2\ntest3''')"), "return ('''test1\ntest2\ntest3''')")
    self.assertEqual(make_body("'''test1\ntest2\ntest3'''"), "return '''test1\ntest2\ntest3'''")
    self.assertEqual(make_body("'''test1\\ntest2\\ntest3'''"), "return '''test1\\ntest2\\ntest3'''")

    # And with mixing quotes
    self.assertEqual(make_body("'''test1\"\"\" +\\\n  \"\"\"test2'''"),
                     "return '''test1\"\"\" +\\\n  \"\"\"test2'''")
    self.assertEqual(make_body("'''test1''' +\\\n  \"\"\"test2\"\"\""),
                     "return '''test1''' +\\\n  \"\"\"test2\"\"\"")
    self.assertEqual(make_body("'''test1\"\"\"\n\"\"\"test2'''"),
                     "return '''test1\"\"\"\n\"\"\"test2'''")
    self.assertEqual(make_body("'''test1'''\n\"\"\"test2\"\"\""),
                     "'''test1'''\nreturn \"\"\"test2\"\"\"")

    if fstring_positions_work():
      self.assertEqual(
        make_body("f'{$foo + 1 + $bar} 2 {3 + $baz}' + $foo2 + f'{4 + $bar2}!'"),
        "return f'{rec.foo + 1 + rec.bar} 2 {3 + rec.baz}' + rec.foo2 + f'{4 + rec.bar2}!'"
      )

    # Test that we produce valid code when "$foo" occurs in invalid places.
    if six.PY2:
      raise_code = "raise SyntaxError('invalid syntax', ('usercode', 1, 5, u'foo($bar=1)'))"
    else:
      raise_code = ("raise SyntaxError('invalid syntax\\n\\n"
                    "A `SyntaxError` occurs when Python cannot understand your code.\\n\\n', "
                    "('usercode', 1, 5, 'foo($bar=1)'))")
    self.assertEqual(make_body('foo($bar=1)'),
                     "# foo($bar=1)\n" + raise_code)

    if six.PY2:
      raise_code = ("raise SyntaxError('invalid syntax', "
                    "('usercode', 1, 5, u'def $bar(): return 3'))")
    else:
      raise_code = ("raise SyntaxError('invalid syntax\\n\\n"
                    "A `SyntaxError` occurs when Python cannot understand your code.\\n\\n', "
                    "('usercode', 1, 5, 'def $bar(): return 3'))")
    self.assertEqual(make_body('def $bar(): return 3'),
                     "# def $bar(): return 3\n" + raise_code)

    # If $ is a syntax error, we don't want to turn it into a different syntax error.
    if six.PY2:
      raise_code = ("raise SyntaxError('invalid syntax', "
                    "('usercode', 1, 17, u'$foo + (\"$%.2f\" $ ($17.5))'))")
    else:
      raise_code = ("raise SyntaxError('invalid syntax\\n\\n"
                    "A `SyntaxError` occurs when Python cannot understand your code.\\n\\n', "
                    "('usercode', 1, 17, '$foo + (\"$%.2f\" $ ($17.5))'))")
    self.assertEqual(make_body('$foo + ("$%.2f" $ ($17.5))'),
                     '# $foo + ("$%.2f" $ ($17.5))\n' + raise_code)

    if six.PY2:
      raise_code = "raise SyntaxError('invalid syntax', ('usercode', 4, 10, u'  return $ bar'))"
    else:
      raise_code = ("raise SyntaxError('invalid syntax\\n\\n"
                    "A `SyntaxError` occurs when Python cannot understand your code.\\n\\n"
                    "I am guessing that you wrote `$` by mistake.\\n"
                    "Removing it and writing `return  bar` seems to fix the error.\\n\\n', "
                    "('usercode', 4, 10, '  return $ bar'))")
    self.assertEqual(make_body('if $foo:\n' +
                               '  return $foo\n' +
                               'else:\n' +
                               '  return $ bar\n'),
                     '# if $foo:\n' +
                     '#   return $foo\n' +
                     '# else:\n' +
                     '#   return $ bar\n' +
                     raise_code)

    # Check for reasonable behaviour with non-empty text and no statements.
    self.assertEqual(make_body('# comment'), '# comment\npass')

    self.assertEqual(make_body('rec = 1; rec'), "# rec = 1; rec\n" +
                     "raise SyntaxError('Grist disallows assignment " +
                     "to the special variable \"rec\"', ('usercode', 1, 1, %s'rec = 1; rec'))"
                     % unicode_prefix)
    self.assertEqual(make_body('for rec in []: return rec'), "# for rec in []: return rec\n" +
                     "raise SyntaxError('Grist disallows assignment " +
                     "to the special variable \"rec\"', "
                     "('usercode', 1, 4, %s'for rec in []: return rec'))"
                     % unicode_prefix)

    # some legitimates use of rec
    body = ("""
foo = rec
[rec for x in rec]
for a in rec:
  t = a
[rec for x in rec]
return rec
""")
    self.assertEqual(make_body(body), body)

    # mostly legitimate use of rec but one failing
    body = ("""
foo = rec
[1 for rec in []]
for a in rec:
  t = a
[rec for x in rec]
return rec
""")

    self.assertRegex(make_body(body),
                     r"raise SyntaxError\('Grist disallows assignment" +
                     r" to the special variable \"rec\"', "
                     r"\('usercode', 3, 7, %s'\[1 for rec in \[\]\]'\)\)"
                     % unicode_prefix)

    self.assertEqual(make_body('rec.foo = 1; rec'), "# rec.foo = 1; rec\n" +
                     "raise SyntaxError(\"You can't assign a value to a column with `=`. "
                     "If you mean to check for equality, use `==` instead.\", "
                     "('usercode', 1, 1, %s'rec.foo = 1; rec'))"
                     % unicode_prefix)

    self.assertEqual(make_body('$foo = 1; rec'), "# $foo = 1; rec\n" +
                     "raise SyntaxError(\"You can't assign a value to a column with `=`. "
                     "If you mean to check for equality, use `==` instead.\", "
                     "('usercode', 1, 1, %s'$foo = 1; rec'))"
                     % unicode_prefix)

    self.assertEqual(make_body('assert foo'), "# assert foo\n" +
                     'raise SyntaxError("No `return` statement, '
                     "and the last line isn't an expression.\", "
                     "('usercode', 1, 1, %s'assert foo'))"
                     % unicode_prefix)

    self.assertEqual(make_body('foo = 1'), "# foo = 1\n" +
                     'raise SyntaxError("No `return` statement, '
                     "and the last line isn't an expression."
                     " If you want to check for equality, use `==` instead of `=`.\", "
                     "('usercode', 1, 1, %s'foo = 1'))"
                     % unicode_prefix)

  def test_make_formula_body_unicode(self):
    # Test that we don't fail when strings include unicode characters
    self.assertEqual(make_body("'résumé' + $foo"), u"return 'résumé' + rec.foo")

    # Or when a unicode object is passed in, rather than a byte string
    self.assertEqual(make_body(u"'résumé' + $foo"), u"return 'résumé' + rec.foo")

    # Check the return type of make_body()
    self.assertEqual(type(make_body("foo")), six.text_type)
    self.assertEqual(type(make_body(u"foo")), six.text_type)

  @unittest.skipUnless(six.PY3, "Only Python 3 supports non-ascii variable names")
  def test_make_formula_body_unicode_token_bug(self):
    # Python < 3.12 has a bug in tokenizing certain unicode characters in variable names.
    # This was worked around in https://github.com/gristlabs/asttokens/pull/82
    # Surprisingly this test passes either way, but keeping it as a potentially tricky case.
    self.assertEqual(
      make_body(
        "℘℘··℘℘2=℘℘··℘℘2($foo+℘℘··℘℘2*℘℘··℘℘2+$bar)\n"
        "℘℘··℘℘2=1+a℘℘··℘℘b+a℘℘··℘℘2b\n"
        "℘℘··℘℘2==℘℘··℘℘2($foo+℘℘··℘℘2*℘℘··℘℘2+$bar)"
      ),
      (
        "℘℘··℘℘2=℘℘··℘℘2(rec.foo+℘℘··℘℘2*℘℘··℘℘2+rec.bar)\n"
        "℘℘··℘℘2=1+a℘℘··℘℘b+a℘℘··℘℘2b\n"
        "return ℘℘··℘℘2==℘℘··℘℘2(rec.foo+℘℘··℘℘2*℘℘··℘℘2+rec.bar)"
      ),
    )

  def test_wrap_logical(self):
    self.assertEqual(make_body("IF($foo, $bar, $baz)"),
        "return IF(rec.foo, lambda: (rec.bar), lambda: (rec.baz))")
    self.assertEqual(make_body("return IF(FOO(x,y), BAR(x,y) * 2, BAZ(x,y) + 5)"),
        "return IF(FOO(x,y), lambda: (BAR(x,y) * 2), lambda: (BAZ(x,y) + 5))")
    self.assertEqual(make_body("""
y = $Test
x = IF( FOO(x,y) or 6,
  BAR($x,y).blahh ,
  Foo.lookupRecords(foo=$foo.bar,
    bar=True
  ).baz
 )
return x or y
"""), """
y = rec.Test
x = IF( FOO(x,y) or 6,
  lambda: (BAR(rec.x,y).blahh) ,
  lambda: (Foo.lookupRecords(foo=rec.foo.bar,
    bar=True
  ).baz)
 )
return x or y
""")
    self.assertEqual(make_body("IF($A == 0, IF($B > 5, 'Test1'), IF($C < 10, 'Test2', 'Test3'))"),
        "return IF(rec.A == 0, " +
          "lambda: (IF(rec.B > 5, lambda: ('Test1'))), " +
          "lambda: (IF(rec.C < 10, lambda: ('Test2'), lambda: ('Test3'))))"
    )

  def test_wrap_error(self):
    self.assertEqual(make_body("ISERR($foo.bar)"), "return ISERR(lambda: (rec.foo.bar))")
    self.assertEqual(make_body("ISERROR(1 / 0)"), "return ISERROR(lambda: (1 / 0))")
    self.assertEqual(make_body("IFERROR($foo + #\n  1 / 0, 'XX')"),
        "return IFERROR(lambda: (rec.foo + #\n  1 / 0), 'XX')")

    # Check that extra parentheses are OK.
    self.assertEqual(make_body("IFERROR((($foo + 1) / 0))"),
        "return IFERROR((lambda: ((rec.foo + 1) / 0)))")

    # Check that missing arguments is OK
    self.assertEqual(make_body("ISERR()"), "return ISERR()")


  def test_leading_whitespace(self):
    self.assertEqual(make_body(" $A + 1"), "return rec.A + 1")

    self.assertEqual(make_body("""
  if $A:
    return $A

  $B
"""), """
if rec.A:
  return rec.A

return rec.B
""")
