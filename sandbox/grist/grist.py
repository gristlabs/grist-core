"""
This file packages together other modules needed for usercode in order to create
a consistent API accessible with only "import grist".
"""
# pylint: disable=unused-import

# These imports are used in processing generated usercode.
from usertypes import Any, Text, Blob, Int, Bool, Date, DateTime, \
Numeric, Choice, Id, Attachments, AltText, ifError
from usertypes import PositionNumber, ManualSortPos, Reference, ReferenceList, formulaType
from table import UserTable
from records import Record, RecordSet

DOCS = [(__name__, (Record, RecordSet, UserTable)),
        ('lookup', (UserTable.lookupOne, UserTable.lookupRecords))]
