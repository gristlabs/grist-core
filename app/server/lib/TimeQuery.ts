import { ITimeData } from 'app/common/TimeQuery';
import { ISQLiteDB, quoteIdent, ResultRow } from 'app/server/lib/SQLiteDB';

export class SQLiteTimeData implements ITimeData {
  public constructor(public db: ISQLiteDB) {
  }

  public async getColIds(tableId: string): Promise<string[]> {
    const columns = await this.db.all(`PRAGMA table_info(${quoteIdent(tableId)})`);
    return columns.map(column => column.name);
  }

  public async fetch(tableId: string, colIds: string[], rowIds?: number[]): Promise<ResultRow[]> {
    if (rowIds) { throw new Error('not yet'); }
    return this.db.all(
      `select ${colIds.map(quoteIdent).join(',')} from ${quoteIdent(tableId)}`);
  }
}
