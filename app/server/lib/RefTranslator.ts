/**
 * Translating Ref/RefList values across docs whose row id spaces have
 * diverged. A cross-doc Ref carries a source-side id that the target's
 * engine will reassign, so without rewriting it lands on the wrong row.
 *
 * Rows the diff adds become negative temporary ids for the engine to
 * resolve. Rows it does not add are taken to be shared with the common
 * ancestor, so their ids mean the same thing on both sides and pass
 * through untouched.
 */

import { CellValue } from "app/common/DocActions";
import { extractInfoFromColType, isList } from "app/common/gristTypes";
import { GristObjCode } from "app/plugin/GristData";

export type RefInfo =
  | { kind: "none" } |
  { kind: "ref"; refTableId: string } |
  { kind: "refList"; refTableId: string };

const NON_REF: RefInfo = { kind: "none" };

export function refInfoFromType(colType: string): RefInfo {
  // Attachments point into _grist_Attachments, which Patch never adds to,
  // so their ids must pass through.
  if (colType === "Attachments") { return NON_REF; }
  const info = extractInfoFromColType(colType);
  if (info.type === "Ref") { return { kind: "ref", refTableId: info.tableId }; }
  if (info.type === "RefList") { return { kind: "refList", refTableId: info.tableId }; }
  return NON_REF;
}

/**
 * Whether `sourceRowId` in `tableId` is a row the diff is adding.
 */
export type IsAddedRow = (tableId: string, sourceRowId: number) => boolean;

/**
 * Rewrite a cell value so refs to added rows become temp ids. Undefined
 * means no rewriting was needed, which also says the value is safe inline
 * in an Add: carrying no temp ids, it cannot name a row yet to land. The
 * result is wrapped because `CellValue` includes null, which would
 * otherwise be indistinguishable from "nothing to do".
 *
 * Known gap: an id this same diff removes, or a transient that only ever
 * existed on the source, is not an added row, so it passes through and
 * lands dangling (or on whatever row later reuses the id). Detecting those
 * needs information this function is not given; revisit if it bites.
 */
export function translateRefValue(
  refInfo: RefInfo, sourceValue: CellValue, isAddedRow: IsAddedRow,
): { value: CellValue } | undefined {
  if (refInfo.kind === "none") { return undefined; }
  if (refInfo.kind === "ref") {
    if (typeof sourceValue !== "number" || sourceValue === 0) { return undefined; }
    return isAddedRow(refInfo.refTableId, sourceValue) ? { value: -sourceValue } : undefined;
  }
  if (!isList(sourceValue)) { return undefined; }
  const items = sourceValue.slice(1);
  // Stay undefined unless something actually changes, so a RefList naming
  // only shared rows can still go inline in an Add.
  let translated: CellValue[] | null = null;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (typeof item === "number" && item !== 0 && isAddedRow(refInfo.refTableId, item)) {
      if (translated === null) { translated = items.slice(0, i); }
      translated.push(-item);
    } else if (translated !== null) {
      translated.push(item);
    }
  }
  return translated === null ? undefined : { value: [GristObjCode.List, ...translated] };
}
