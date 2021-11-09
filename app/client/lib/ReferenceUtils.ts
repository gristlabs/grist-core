import { DocData } from 'app/client/models/DocData';
import {ColumnRec} from 'app/client/models/entities/ColumnRec';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {SearchFunc, TableData} from 'app/client/models/TableData';
import {getReferencedTableId, isRefListType} from 'app/common/gristTypes';
import {BaseFormatter} from 'app/common/ValueFormatter';
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
  public readonly isRefList: boolean;

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
    this.isRefList = isRefListType(colType);
  }

  public parseReference(
    raw: string, value: unknown
  ): number | string | ['l', unknown, {raw?: string, column: string}] {
    if (!value || !raw) {
      return 0;  // default value for a reference column
    }

    if (this.visibleColId === 'id') {
      const n = Number(value);
      if (Number.isInteger(n)) {
        value = n;
      } else {
        return raw;
      }
    }

    if (!this.tableData.isLoaded) {
      const options: {column: string, raw?: string} = {column: this.visibleColId};
      if (value !== raw) {
        options.raw = raw;
      }
      return ['l', value, options];
    }

    const searchFunc: SearchFunc = (v: any) => isEqual(v, value);
    const matches = this.tableData.columnSearch(this.visibleColId, searchFunc, 1);
    if (matches.length > 0) {
      return matches[0];
    } else {
      // There's no matching value in the visible column, i.e. this is not a valid reference.
      // We need to return a string which will become AltText.
      return raw;
    }
  }

  public parseReferenceList(
    raw: string, values: unknown[]
  ): ['L', ...number[]] | null | string | ['l', unknown[], {raw?: string, column: string}] {
    if (!values.length || !raw) {
      return null;  // default value for a reference list column
    }

    if (this.visibleColId === 'id') {
      const numbers = values.map(Number);
      if (numbers.every(Number.isInteger)) {
        values = numbers;
      } else {
        return raw;
      }
    }

    if (!this.tableData.isLoaded) {
      const options: {column: string, raw?: string} = {column: this.visibleColId};
      if (!(values.length === 1 && values[0] === raw)) {
        options.raw = raw;
      }
      return ['l', values, options];
    }

    const rowIds: number[] = [];
    for (const value of values) {
      const searchFunc: SearchFunc = (v: any) => isEqual(v, value);
      const matches = this.tableData.columnSearch(this.visibleColId, searchFunc, 1);
      if (matches.length > 0) {
        rowIds.push(matches[0]);
      } else {
        // There's no matching value in the visible column, i.e. this is not a valid reference.
        // We need to return a string which will become AltText.
        return raw;
      }
    }
    return ['L', ...rowIds];
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
