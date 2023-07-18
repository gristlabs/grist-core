"""
gencode.py is the module that generates a python module based on the schema in a grist document.
An example of the module it generates is available in usercode.py.

The schema for grist data is:
  <schema> = [ <table_info> ]
  <table_info> = {
    "tableId": <string>,
    "columns": [ <column_info> ],
  }
  <column_info> = {
    "id": <string>,
    "type": <string>
    "isFormula": <boolean>,
    "formula": <opt_string>,
  }
"""
import logging
import re
import imp
from collections import OrderedDict

import six

import codebuilder
from column import is_visible_column
import summary
import table
import textbuilder
from usertypes import get_type_default
log = logging.getLogger(__name__)

indent_str = "  "

# Matches newlines that are followed by a non-empty line.
indent_line_re = re.compile(r'^(?=.*\S)', re.M)

def indent(body, levels=1):
  """Indents all lines in body (which should be a textbuilder.Builder), except empty ones."""
  patches = textbuilder.make_regexp_patches(body.get_text(), indent_line_re, indent_str * levels)
  return textbuilder.Replacer(body, patches)

#----------------------------------------------------------------------

def get_grist_type(col_type):
  """Returns code for a grist usertype object given a column type string."""
  col_type_split = col_type.split(':', 1)
  typename = col_type_split[0]
  if typename == 'Ref':
    typename = 'Reference'
  elif typename == 'RefList':
    typename = 'ReferenceList'

  arg = col_type_split[1] if len(col_type_split) > 1 else ''
  arg = arg.strip().replace("'", "\\'")

  return "grist.%s(%s)" % (typename, ("'%s'" % arg) if arg else '')


class GenCode(object):
  """
  GenCode generates the Python code for a Grist document, including converting formulas to Python
  functions and producing a Python specification of all the tables with data and formula fields.

  To save the costly work of generating formula code, it maintains a formula cache. It is a
  dictionary mapping (table_id, col_id, formula) to a textbuilder.Builder. On each run of
  make_module(), it will use the previously cached values for lookups, and replace the contents
  of the cache with current values. If ever we need to generate code for unrelated schemas, to
  benefit from the cache, a separate GenCode object should be used for each schema.
  """
  def __init__(self):
    self._formula_cache = {}
    self._new_formula_cache = {}
    self._full_builder = None
    self._user_builder = None
    self._usercode = None

  def _make_formula_field(self, col_info, table_id, name=None, include_type=True,
      additional_params=()):
    """Returns the code for a formula field."""
    # If the caller didn't specify a special name, use the colId
    name = name or col_info.colId

    decl = "def %s(%s):\n" % (
      name,
      ', '.join(['rec', 'table'] + list(additional_params))
    )

    # This is where we get to use the formula cache, and save the work of rebuilding formulas.
    key = (table_id, col_info.colId, col_info.formula)
    body = self._formula_cache.get(key)
    if body is None:
      default = get_type_default(col_info.type)
      # If we have a table_id like `Table._Summary`, then we don't want to actually associate
      # this field with any real table/column.
      assoc_value = None if table_id.endswith("._Summary") else (table_id, col_info.colId)
      body = codebuilder.make_formula_body(col_info.formula, default, assoc_value)
    self._new_formula_cache[key] = body

    decorator = ''
    if include_type and col_info.type != 'Any':
      decorator = '@grist.formulaType(%s)\n' % get_grist_type(col_info.type)
    return textbuilder.Combiner(['\n' + decorator + decl, indent(body), '\n'])


  def _make_data_field(self, col_info, table_id):
    """Returns the code for a data field."""
    parts = []
    if col_info.formula:
      parts.append(self._make_formula_field(col_info, table_id,
                                            name=table.get_default_func_name(col_info.colId),
                                            include_type=False,
                                            additional_params=['value', 'user']))
    parts.append("%s = %s\n" % (col_info.colId, get_grist_type(col_info.type)))
    return textbuilder.Combiner(parts)


  def _make_field(self, col_info, table_id):
    """Returns the code for a field."""
    assert not col_info.colId.startswith("_")
    if col_info.isFormula:
      return self._make_formula_field(col_info, table_id)
    else:
      return self._make_data_field(col_info, table_id)


  def _make_table_model(self, table_info, summary_tables, filter_for_user=False):
    """
    Returns the code for a table model.
    If filter_for_user is True, includes only user-visible columns.
    """
    table_id = table_info.tableId
    source_table_id = summary.decode_summary_table_name(table_info)

    # Sort columns by "isFormula" to output all data columns before all formula columns.
    columns = sorted(six.itervalues(table_info.columns), key=lambda c: c.isFormula)
    if filter_for_user:
      columns = [c for c in columns if is_visible_column(c.colId)]
    parts = ["@grist.UserTable\nclass %s:\n" % table_id]
    if source_table_id:
      parts.append(indent(textbuilder.Text("_summarySourceTable = %r\n" % source_table_id)))

    for col_info in columns:
      parts.append(indent(self._make_field(col_info, table_id)))

    if summary_tables:
      # Include summary formulas, for the user's information.
      formulas = OrderedDict((c.colId, c) for s in summary_tables
                             for c in six.itervalues(s.columns) if c.isFormula)
      parts.append(indent(textbuilder.Text("\nclass _Summary:\n")))
      for col_info in six.itervalues(formulas):
        # Associate this field with the fake table `table_id + "._Summary"`.
        # We don't know which summary table each formula belongs to, there might be several,
        # and we don't care here because this is just for display in the code view.
        # The real formula will be associated with the real summary table elsewhere.
        # Previously this field was accidentally associated with the source table, causing bugs.
        parts.append(indent(self._make_field(col_info, table_id + "._Summary"), levels=2))

    return textbuilder.Combiner(parts)

  def make_module(self, schema):
    """Regenerates the code text and usercode module from updated document schema."""
    # Collect summary tables to group them by source table.
    summary_tables = {}
    for table_info in six.itervalues(schema):
      source_table_id = summary.decode_summary_table_name(table_info)
      if source_table_id:
        summary_tables.setdefault(source_table_id, []).append(table_info)

    fullparts = ["import grist\n" +
                 "from functions import *       # global uppercase functions\n" +
                 "import datetime, math, re     # modules commonly needed in formulas\n"]
    userparts = fullparts[:]
    for table_info in six.itervalues(schema):
      fullparts.append("\n\n")
      fullparts.append(self._make_table_model(table_info, summary_tables.get(table_info.tableId)))
      if not (
          _is_special_table(table_info.tableId) or
          summary.decode_summary_table_name(table_info)
      ):
        userparts.append("\n\n")
        userparts.append(self._make_table_model(table_info, summary_tables.get(table_info.tableId),
          filter_for_user=True))

    # Once all formulas are generated, replace the formula cache with the newly-populated version.
    self._formula_cache = self._new_formula_cache
    self._new_formula_cache = {}
    self._full_builder = textbuilder.Combiner(fullparts)
    self._user_builder = textbuilder.Combiner(userparts)
    self._usercode = exec_module_text(self._full_builder.get_text())

  def get_user_text(self):
    """Returns the text of the user-facing part of the generated code."""
    return self._user_builder.get_text()

  @property
  def usercode(self):
    """Returns the generated usercode module."""
    return self._usercode

  def grist_names(self):
    return codebuilder.parse_grist_names(self._full_builder)


def _is_special_table(table_id):
  return table_id.startswith("_grist_")


def exec_module_text(module_text):
  mod = imp.new_module(codebuilder.code_filename)
  codebuilder.save_to_linecache(module_text)
  code_obj = compile(module_text, codebuilder.code_filename, "exec")
  # pylint: disable=exec-used
  exec(code_obj, mod.__dict__)
  return mod
