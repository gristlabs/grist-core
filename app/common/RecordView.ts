import {CellValue, TableDataAction} from 'app/common/DocActions';

/** Light wrapper for reading records or user attributes. */
export interface InfoView {
  get(key: string): CellValue;
  toJSON(): {[key: string]: any};
}

/**
 * A row-like view of TableDataAction, which is columnar in nature.
 *
 * If index value is undefined, acts as an EmptyRecordRow.
 */
export class RecordView implements InfoView {
  public constructor(public data: TableDataAction, public index: number|undefined) {
  }

  public get(colId: string): CellValue {
    if (this.index === undefined) { return null; }
    if (colId === 'id') {
      return this.data[2][this.index];
    }
    return this.data[3][colId]?.[this.index];
  }

  public has(colId: string) {
    return colId === 'id' || colId in this.data[3];
  }

  public toJSON() {
    if (this.index === undefined) { return {}; }
    const results: {[key: string]: any} = {id: this.index};
    for (const key of Object.keys(this.data[3])) {
      results[key] = this.data[3][key]?.[this.index];
    }
    return results;
  }
}

export class EmptyRecordView implements InfoView {
  public get(_colId: string): CellValue { return null; }
  public toJSON() { return {}; }
}
