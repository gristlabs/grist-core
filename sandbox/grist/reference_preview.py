"""Evaluate reference changes in a disposable engine; never mutate the live engine or dispatch REQUESTs."""
import actions
import engine
import docmodel
import objtypes
import useractions


def preview(eng, action_reprs):
  # Defensive for direct callers/tests; production runs this in a separate disposable sandbox.
  original = docmodel.global_docmodel
  try:
    return _preview(eng, action_reprs)
  finally:
    docmodel.global_docmodel = original


def _preview(eng, action_reprs):
  # Bound the extra memory needed for a second engine. The caller may still synchronize without a preview.
  row_counts = {tid: sum(1 for _ in table.row_ids) for tid, table in eng.tables.items()}
  cells = sum(row_counts[tid] * len(t.all_columns) for tid, t in eng.tables.items())
  for action in action_reprs:
    if action[0] in ('AddRecord', 'BulkAddRecord') and action[1] in eng.tables:
      rows = len(action[2]) if action[0] == 'BulkAddRecord' else 1
      cells += rows * len(eng.tables[action[1]].all_columns)
    elif action[0] == 'AddColumn' and action[1] in eng.tables:
      cells += row_counts[action[1]]
  if cells > 500000:
    raise ValueError("Reference preview is limited to 500000 document cells")
  clone = engine.Engine()
  # Encode/decode values so no Record/RecordSet retains a reference to the live engine.
  def copy_table(tid):
    return actions.action_from_repr(actions.get_action_repr(eng.fetch_table(tid, private=True)))
  names = clone.load_meta_tables(copy_table('_grist_Tables'), copy_table('_grist_Tables_column'))
  for tid in names:
    clone.load_table(copy_table(tid))
  baseline = clone.apply_user_actions([useractions.from_repr(['Calculate'])])
  result = clone.apply_user_actions([useractions.from_repr(a) for a in action_reprs])
  changed = 0
  new_errors = 0
  samples = []
  for tid, table in clone.tables.items():
    if tid.startswith('_grist_') or tid not in eng.tables:
      continue
    before = eng.fetch_table(tid)
    after = clone.fetch_table(tid)
    positions = {rid: i for i, rid in enumerate(before.row_ids)}
    after_positions = {rid: i for i, rid in enumerate(after.row_ids)}
    for cid, column in table.all_columns.items():
      if not column.is_formula() or cid not in after.columns or cid not in before.columns:
        continue
      for rid in sorted(set(before.row_ids) | set(after.row_ids)):
        a = objtypes.encode_object(before.columns[cid][positions[rid]]) if rid in positions else None
        b = objtypes.encode_object(after.columns[cid][after_positions[rid]]) if rid in after_positions else None
        if a == b:
          continue
        changed += 1
        if isinstance(b, (list, tuple)) and b and b[0] == 'E' and not (
            isinstance(a, (list, tuple)) and a and a[0] == 'E'):
          new_errors += 1
        if len(samples) < 100:
          samples.append(dict(tableId=tid, colId=cid, rowId=rid, before=a, after=b))
  return dict(changed=changed, newErrors=new_errors, samples=samples,
              externalRequests=bool(baseline.requests or result.requests))
