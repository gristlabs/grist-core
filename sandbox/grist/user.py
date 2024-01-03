"""
This module contains a class for creating a User containing
basic user info and optional, user-defined attributes that reference
user attribute tables.

A User has the same API as the 'user' variable from
access rules. Currently, its primary purpose is to expose
user info to trigger formulas, so that they can reference info
about the current user.

The 'data' parameter represents a dictionary containing at least
the following fields:

 - Access: string or None
 - UserID: integer or None
 - UserRef: string or None
 - Email: string or None
 - Name: string or None
 - Origin: string or None
 - LinkKey: dictionary
 - SessionID: string or None
 - IsLoggedIn: boolean
 - ShareRef: integer or None

Additional keys may be included, which may have a value that is
either None or of type tuple with the following shape:

 [table_id, row_id]

The first element is the id (name) of the user attribute table, and the
second element is the id of the row that matched based on the
user attribute definition.

See 'GranularAccess.ts' for the Node equivalent that
serializes the user information found in 'data'.
"""
import six

class User(object):
  """
  User containing user info and optional attributes.

  Setting 'is_sample' will substitute user attributes with
  typed equivalents, for use by autocompletion.
  """
  def __init__(self, data, tables, is_sample=False):
    for attr in ('Access', 'UserID', 'Email', 'Name', 'Origin', 'SessionID',
                 'IsLoggedIn', 'UserRef', 'ShareRef'):
      setattr(self, attr, data[attr])

    self.LinkKey = LinkKey(data['LinkKey'])

    for name, value in six.iteritems(data):
      if hasattr(self, name) or not value:
        continue
      table_name, row_id = value
      table = tables.get(table_name)
      if not table:
        continue
      # TODO: Investigate use of __dir__ in Record for type information
      record = table.sample_record if is_sample else table.get_record(row_id)
      setattr(self, name, record)

class LinkKey(object):
  def __init__(self, data):
    for name, value in six.iteritems(data):
      setattr(self, name, value)
