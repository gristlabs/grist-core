import { DocData } from 'app/client/models/DocData';
import { ColumnRec } from 'app/client/models/entities/ColumnRec';
import { ViewFieldRec } from 'app/client/models/entities/ViewFieldRec';
import { SearchFunc, TableData } from 'app/client/models/TableData';
import { getReferencedTableId } from 'app/common/gristTypes';
import { BaseFormatter } from 'app/common/ValueFormatter';
import isEqual = require('lodash/isEqual');

/**
 * Utilities for common operations involving Ref[List] fields.
 */
export class ReferenceUtils {
  public readonly refTableId: string;
  public readonly tableData: TableData;
  public readonly formatter: BaseFormatter;
  public readonly visibleColModel: ColumnRec;
  public readonly visibleColId: string;

  constructor(public readonly field: ViewFieldRec, docData: DocData) {
    // Note that this constructor is called inside ViewFieldRec.valueParser, a ko.pureComputed,
    // and there are several observables here which get used and become dependencies.

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

    this.formatter = field.createVisibleColFormatter();
    this.visibleColModel = field.visibleColModel();
    this.visibleColId = this.visibleColModel.colId() || 'id';
  }

  public parseValue(value: any): number | string {
    if (!value) {
      return 0;   // This is the default value for a reference column.
    }

    if (this.visibleColId === 'id') {
      const n = Number(value);
      if (
        n > 0 &&
        Number.isInteger(n) &&
        !(
          this.tableData.isLoaded &&
          !this.tableData.hasRowId(n)
        )
      ) {
        return n;
      }
      return String(value);
    }

    let searchFunc: SearchFunc;
    if (typeof value === 'string') {
      searchFunc = (v: any) => {
        const formatted = this.formatter.formatAny(v);
        return nocaseEqual(formatted, value);
      };
    } else {
      searchFunc = (v: any) => isEqual(v, value);
    }
    const matches = this.tableData.columnSearch(this.visibleColId, searchFunc, 1);
    if (matches.length > 0) {
      return matches[0];
    } else {
      // There's no matching value in the visible column, i.e. this is not a valid reference.
      // We need to return a string which will become AltText.
      // Can't return `value` directly because it may be a number (if visibleCol is a numeric or date column)
      // which would be interpreted as a row ID, i.e. a valid reference.
      // So instead we format the parsed value in the style of visibleCol.
      return this.formatter.formatAny(value);
    }
  }

  public idToText(value: unknown) {
    if (typeof value === 'number') {
      return this.formatter.formatAny(this.tableData.getValue(value, this.visibleColId));
    }
    return String(value || '');
  }

  public autocompleteSearch(text: string) {
    const acIndex = this.tableData.columnACIndexes.getColACIndex(this.visibleColId, this.formatter);
    return acIndex.search(text);
  }
}

export function nocaseEqual(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
