import { ActionSummary, createEmptyTableDelta, LabelDelta, TableDelta } from "app/common/ActionSummary";

/** A TableDelta with the given fields overriding an empty one. */
export function td(o: Partial<TableDelta> = {}): TableDelta {
  return { ...createEmptyTableDelta(), ...o };
}

/** An ActionSummary from its renames and (optional) per-table deltas. */
export function S(tableRenames: LabelDelta[], tableDeltas: ActionSummary["tableDeltas"] = {}): ActionSummary {
  return { tableRenames, tableDeltas };
}
