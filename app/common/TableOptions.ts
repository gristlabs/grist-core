import { safeJsonParse } from "app/common/gutil";
import { CellValue } from "app/plugin/GristData";

/**
 * Options on a _grist_Tables record.
 */
export interface TableOptions {
  allowSyncing?: boolean;
}

export function parseTableOptions(value: string | CellValue | undefined): TableOptions {
  return value ? safeJsonParse(String(value), {}) : {};
}
