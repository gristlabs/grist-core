import { safeJsonParse } from "app/common/gutil";
import { CellValue } from "app/plugin/GristData";

export interface ColumnOptions {
  /** If a column is mirrored via syncing from another document, this is the id of the source column it mirrors */
  syncSrcColId?: string;
}
export function parseColumnOptions(value: string | CellValue | undefined): ColumnOptions {
  return value ? safeJsonParse(String(value), {}) : {};
}
