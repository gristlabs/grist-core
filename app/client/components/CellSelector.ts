import ko from 'knockout';
import type BaseView from 'app/client/components/BaseView';
import type {DataRowModel} from 'app/client/models/DataRowModel';
import {between} from 'app/common/gutil';
import {Disposable} from 'grainjs';

export const ROW = 'row';
export const COL = 'col';
export const CELL = 'cell';
export const NONE = '';

export type ElemType = 'row' | 'col' | 'cell' | '';

interface GridView extends BaseView {
  domToRowModel(elem: Element, elemType: ElemType): DataRowModel;
  domToColModel(elem: Element, elemType: ElemType): DataRowModel;
}

export class CellSelector extends Disposable {
  // row or col.start denotes the anchor/initial index of the select range.
  // start is not necessarily smaller than end.
  // IE: clicking on col 10 and dragging until the mouse is on col 5 will yield: start = 10, end = 5
  public row = {
    start: ko.observable(0),
    end: ko.observable(0),
    linePos: ko.observable('0px'),    // Used by GridView for dragging rows
    dropIndex: ko.observable(-1),     // Used by GridView for dragging rows
  };
  public col =  {
    start: ko.observable(0),
    end: ko.observable(0),
    linePos: ko.observable('0px'),    // Used by GridView for dragging columns
    dropIndex: ko.observable(-1),     // Used by GridView for dragging columns
  };
  public currentSelectType = ko.observable<ElemType>(NONE);
  public currentDragType = ko.observable<ElemType>(NONE);

  constructor(public readonly view: GridView) {
    super();
    this.autoDispose(this.view.cursor.rowIndex.subscribe(() => this.setToCursor()));
    this.autoDispose(this.view.cursor.fieldIndex.subscribe(() => this.setToCursor()));
    const fieldsLength = this.autoDispose(ko.pureComputed(() => this.view.viewSection.viewFields().all().length));
    this.autoDispose(fieldsLength.subscribe((length) => {
      this.col.end(Math.min(this.col.end.peek(), length - 1));
    }));
    this.setToCursor();
  }

  public setToCursor(elemType: ElemType = NONE) {
    // Must check that the view contains cursor.rowIndex/cursor.fieldIndex
    // in case it has changed.
    if (this.view.cursor.rowIndex) {
      this.row.start(this.view.cursor.rowIndex()!);
      this.row.end(this.view.cursor.rowIndex()!);
    }
    if (this.view.cursor.fieldIndex) {
      this.col.start(this.view.cursor.fieldIndex());
      this.col.end(this.view.cursor.fieldIndex());
    }
    this.currentSelectType(elemType);
  }

  public containsCell(rowIndex: number, colIndex: number): boolean {
    return this.containsCol(colIndex) && this.containsRow(rowIndex);
  }

  public containsRow(rowIndex: number): boolean {
    return between(rowIndex, this.row.start(), this.row.end());
  }

  public containsCol(colIndex: number): boolean {
    return between(colIndex, this.col.start(), this.col.end());
  }

  public isSelected(elem: Element, handlerName: ElemType) {
    if (handlerName !== this.currentSelectType()) {
      return false;
    }

    // TODO: this only works with view: GridView.
    // But it seems like we only ever use selectors with gridview anyway
    const row = this.view.domToRowModel(elem, handlerName);
    const col = this.view.domToColModel(elem, handlerName);
    switch (handlerName) {
      case ROW:
        return this.containsRow(row._index()!);
      case COL:
        return this.containsCol(col._index()!);
      case CELL:
        return this.containsCell(row._index()!, col._index()!);
      default:
        console.error('Given element is not a row, cell or column');
        return false;
    }
  }

  public isRowSelected(rowIndex: number): boolean {
    return this.isCurrentSelectType(COL) || this.containsRow(rowIndex);
  }

  public isColSelected(colIndex: number): boolean {
    return this.isCurrentSelectType(ROW) || this.containsCol(colIndex);
  }

  public isCellSelected(rowIndex: number, colIndex: number): boolean {
    return this.isColSelected(colIndex) && this.isRowSelected(rowIndex);
  }

  public onlyCellSelected(rowIndex: number, colIndex: number): boolean {
    return (this.row.start() === rowIndex && this.row.end() === rowIndex) &&
      (this.col.start() === colIndex && this.col.end() === colIndex);
  }

  public isCurrentSelectType(elemType: ElemType): boolean {
    return this._isCurrentType(this.currentSelectType(), elemType);
  }

  public isCurrentDragType(elemType: ElemType): boolean {
    return this._isCurrentType(this.currentDragType(), elemType);
  }

  public colLower(): number {
    return Math.min(this.col.start(), this.col.end());
  }

  public colUpper(): number {
    return Math.max(this.col.start(), this.col.end());
  }

  public rowLower(): number {
    return Math.min(this.row.start(), this.row.end());
  }

  public rowUpper(): number {
    return Math.max(this.row.start(), this.row.end());
  }

  public colCount(): number {
    return this.colUpper() - this.colLower() + 1;
  }

  public rowCount(): number {
    return this.rowUpper() - this.rowLower() + 1;
  }

  public selectArea(rowStartIdx: number, colStartIdx: number, rowEndIdx: number, colEndIdx: number): void {
    this.row.start(rowStartIdx);
    this.col.start(colStartIdx);
    this.row.end(rowEndIdx);
    this.col.end(colEndIdx);
    // Only select the area if it's not a single cell
    if (this.colCount() > 1 || this.rowCount() > 1) {
      this.currentSelectType(CELL);
    }
  }

  private _isCurrentType(currentType: ElemType, elemType: ElemType): boolean {
    console.assert([ROW, COL, CELL, NONE].indexOf(elemType) !== -1);
    return currentType === elemType;
  }
}
