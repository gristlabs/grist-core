import { safeJsonParse } from "app/common/gutil";
import { CellValue } from "app/plugin/GristData";

/**
 * Options on a _grist_Tables record.
 */
export interface TableOptions {
  /** Is the table allowed to be included in a sync to another document? **/
  allowSyncing?: boolean;
  /** If the table is mirrored via syncing from another document, this is the id of the source table it mirrors */
  syncSrcTableId?: string;
}

export function parseTableOptions(value: string | CellValue | undefined): TableOptions {
  return value ? safeJsonParse(String(value), {}) : {};
}
