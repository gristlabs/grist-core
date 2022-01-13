import {DocData} from 'app/client/models/DocData';
import {ColumnRec} from 'app/client/models/entities/ColumnRec';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {TableData} from 'app/client/models/TableData';
import {getReferencedTableId, isRefListType} from 'app/common/gristTypes';
import {BaseFormatter} from 'app/common/ValueFormatter';

/**
 * Utilities for common operations involving Ref[List] fields.
 */
export class ReferenceUtils {
  public readonly refTableId: string;
  public readonly tableData: TableData;
  public readonly visibleColFormatter: BaseFormatter;
  public readonly visibleColModel: ColumnRec;
  public readonly visibleColId: string;
  public readonly isRefList: boolean;

  constructor(public readonly field: ViewFieldRec, docData: DocData) {
    const colType = field.column().type();
    const refTableId = getReferencedTableId(colType);
    if (!refTableId) {
      throw new Error("Non-Reference column of type " + colType);
    }
    this.refTableId = refTableId;

    const tableData = docData.getTable(refTableId);
    if (!tableData) {
      throw new Error("Invalid referenced table " + refTableId);
    }
    this.tableData = tableData;

    this.visibleColFormatter = field.visibleColFormatter();
    this.visibleColModel = field.visibleColModel();
    this.visibleColId = this.visibleColModel.colId() || 'id';
    this.isRefList = isRefListType(colType);
  }

  public idToText(value: unknown) {
    if (typeof value === 'number') {
      return this.visibleColFormatter.formatAny(this.tableData.getValue(value, this.visibleColId));
    }
    return String(value || '');
  }

  public autocompleteSearch(text: string) {
    const acIndex = this.tableData.columnACIndexes.getColACIndex(this.visibleColId, this.visibleColFormatter);
    return acIndex.search(text);
  }
}

export function nocaseEqual(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
