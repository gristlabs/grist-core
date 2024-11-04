import type {ISortedRowSet} from 'app/client/models/rowset';
import type {DataRowModel} from 'app/client/models/DataRowModel';
import type {GristWSConnection} from 'app/client/components/GristWSConnection';
import type {TableData} from 'app/common/TableData';
import type {IDisposableOwner} from 'grainjs';

export abstract class MegaDocModel {
  public static isEnabled(engine?: string): boolean { return false; }
  public static maybeCreate(conn: GristWSConnection, engine?: string): MegaDocModel|null { return null; }

  public abstract createSortedRowSet(owner: IDisposableOwner, tableData: TableData, columns: TableData): ISortedRowSet;
  public abstract getRowModelClass(rowSet: ISortedRowSet): typeof DataRowModel;
}
