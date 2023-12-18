import {RowList, RowListener, RowSource} from 'app/client/models/rowset';
import {UIRowId} from "app/plugin/GristAPI";

export class UnionRowSource extends RowListener implements RowSource {
  protected _allRows = new Map<UIRowId, Set<RowSource>>();

  constructor(parentRowSources: RowSource[]) {
    super();
    for (const p of parentRowSources) {
      this.subscribeTo(p);
    }
  }

  public getAllRows(): RowList {
    return this._allRows.keys();
  }

  public getNumRows(): number {
    return this._allRows.size;
  }

  public onAddRows(rows: RowList, rowSource: RowSource) {
    const outputRows = [];
    for (const r of rows) {
      let sources = this._allRows.get(r);
      if (!sources) {
        sources = new Set();
        this._allRows.set(r, sources);
        outputRows.push(r);
      }
      sources.add(rowSource);
    }
    if (outputRows.length > 0) {
      this.trigger('rowChange', 'add', outputRows);
    }
  }

  public onRemoveRows(rows: RowList, rowSource: RowSource) {
    const outputRows = [];
    for (const r of rows) {
      const sources = this._allRows.get(r);
      if (!sources) {
        continue;
      }
      sources.delete(rowSource);
      if (sources.size === 0) {
        outputRows.push(r);
        this._allRows.delete(r);
      }
    }
    if (outputRows.length > 0) {
      this.trigger('rowChange', 'remove', outputRows);
    }
  }

  public onUpdateRows(rows: RowList) {
    this.trigger('rowChange', 'update', rows);
  }
}
