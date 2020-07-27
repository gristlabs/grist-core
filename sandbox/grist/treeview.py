"""
Grist supports organizing a list of records as a tree view which allows for grouping records as
children of some other record.

On the client, the .indentation is used to measure the distance between the left margin of the
container and where we want the record to be. The variation of .indentation gives the parent-child
relationship between consecutive records. For instance in ["A0", "B1", "C1"] (where "A0" stands for
the record {'id': "A", 'indentation': 0}), "B" and "C" are children of "A". In ["A0", "B1", "C2"],
"C" is a child of "B", which is a child of "A".

The order for the records is typically handled using a field of type "PositionNumber", ie: .pagePos
in _grist_Pages table.

Because user can remove records that invalidate the tree, the module exposes fix_indents. For
example if user removes "C" from ["A0", "B1", "C0", "D1"] the resulting table holds ["A0", "B1",
"D1"] and "D" became child of "A", which is unfortunate because we'd rather have "C" become a
sibling of "A" instead. Using fix_indents helps with keeping the tree consistent by returning [("D",
0)] which indicate that the indentation of row "D" needs to be set to 0.
"""

# Items is an array of items with .id and .indentation properties. Returns a list of (item_id,
# new_indent) pairs.
def fix_indents(items, deleted_ids):
  max_next_indent = 0
  adjustments = []
  for item in items:
    indent = min(max_next_indent, item.indentation)
    is_deleted = item.id in deleted_ids
    if indent != item.indentation and not is_deleted:
      adjustments.append((item.id, indent))
    max_next_indent = indent if is_deleted else indent + 1
  return adjustments
