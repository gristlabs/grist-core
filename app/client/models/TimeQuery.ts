import { DocData } from "app/client/models/DocData";
import { getActionColValues, getRowIdsFromDocAction } from "app/common/DocActions";
import { ITimeData, ResultRow } from "app/common/TimeQuery";

/**
 * A client-side implementation of ITimeData, so we can do a
 * TimeQuery to get context for actions in the action log.
 */
export class ClientTimeData implements ITimeData {
  public constructor(public db: DocData) {
  }

  public async getColIds(tableId: string): Promise<string[]> {
    const table = this.db.getTable(tableId);
    return table?.getColIds() || [];
  }

  public async fetch(tableId: string, colIds: string[], rowIds?: number[]): Promise<ResultRow[]> {
    await this.db.fetchTable(tableId);
    const table = this.db.getTable(tableId);
    const data = table?.getTableDataAction(rowIds, colIds);
    if (!data) { return []; }
    const records = getRowIdsFromDocAction(data).map((rowId, i) => {
      const rec: Record<string, any> = { id: rowId };
      for (const [colId, values] of Object.entries(getActionColValues(data))) {
        if (colId !== "id") {
          rec[colId] = values[i];
        }
      }
      return rec;
    });
    return records;
  }
}
