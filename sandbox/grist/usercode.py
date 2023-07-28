"""
usercode.py isn't a real module, but an example of a module produced by gencode.py from the
user-defined document schema.

It is the same code that's produced from the test schema in test_gencode.py. In fact, it is used
as part of that test.

User-defined Tables (i.e. classes that derive from grist.Table) automatically get some additional
members:

  Record - a class derived from grist.Record, with a property for each table column.
  RecordSet - a class derived from grist.Record, with a property for each table column.
  RecordSet.Record - a reference to the Record class above

======================================================================
import grist
from functions import *       # global uppercase functions
import datetime, math, re     # modules commonly needed in formulas


@grist.UserTable
class Students:
  firstName = grist.Text()
  lastName = grist.Text()
  school = grist.Reference('Schools')

  def fullName(rec, table):
    return rec.firstName + ' ' + rec.lastName

  def fullNameLen(rec, table):
    return len(rec.fullName)

  def schoolShort(rec, table):
    return rec.school.name.split(' ')[0]

  def schoolRegion(rec, table):
    addr = rec.school.address
    return addr.state if addr.country == 'US' else addr.region

  @grist.formulaType(grist.Reference('Schools'))
  def school2(rec, table):
    return Schools.lookupFirst(name=rec.school.name)


@grist.UserTable
class Schools:
  name = grist.Text()
  address = grist.Reference('Address')


@grist.UserTable
class Address:
  city = grist.Text()
  state = grist.Text()

  def _default_country(rec, table, value, user):
    return 'US'
  country = grist.Text()

  def region(rec, table):
    return {'US': 'North America', 'UK': 'Europe'}.get(rec.country, 'N/A')

  def badSyntax(rec, table):
    # for a in
    # 10
    raise SyntaxError('invalid syntax', ('usercode', 1, 9, u'for a in'))
======================================================================
"""
