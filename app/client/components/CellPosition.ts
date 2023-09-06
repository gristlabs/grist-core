import { DocModel, ViewFieldRec } from "app/client/models/DocModel";
import { CursorPos } from 'app/plugin/GristAPI';
import BaseRowModel = require("app/client/models/BaseRowModel");

/**
 * Absolute position of a cell in a document
 */
export abstract class CellPosition {
  public static equals(a: CellPosition, b: CellPosition) {
    return a && b && a.colRef == b.colRef &&
      a.sectionId == b.sectionId &&
      a.rowId == b.rowId;
  }
  public static create(row: BaseRowModel, field: ViewFieldRec): CellPosition {
    const rowId = row.id.peek();
    const colRef = field.colRef.peek();
    const sectionId = field.viewSection.peek().id.peek();
    return { rowId, colRef, sectionId };
  }
  public sectionId: number;
  public rowId: number | string;
  public colRef: number;
}

/**
 * Converts cursor position to cell absolute positions. Return null if the conversion is not
 * possible (if cursor position doesn't have enough information)
 * @param position Cursor position
 * @param docModel Document model
 */
export function fromCursor(position: CursorPos, docModel: DocModel): CellPosition | null {
  if (!position.sectionId || !position.rowId || position.fieldIndex == null) {
    return null;
  }

  const section = docModel.viewSections.getRowModel(position.sectionId);
  const colRef = section.viewFields().peek()[position.fieldIndex]?.colRef.peek();

  const cursorPosition = {
    rowId: position.rowId as (string | number), // TODO: cursor position is wrongly typed
    colRef,
    sectionId: position.sectionId,
  };

  return cursorPosition;
}

/**
 * Converts cell's absolute position to current cursor position.
 * @param position Cell's absolute position
 * @param docModel DocModel
 */
export function toCursor(position: CellPosition, docModel: DocModel): CursorPos {

  // translate colRef to fieldIndex
  const fieldIndex = docModel.viewSections.getRowModel(position.sectionId)
    .viewFields().peek()
    .findIndex(x => x.colRef.peek() == position.colRef);

  const cursorPosition = {
    rowId: position.rowId as number, // this is hack, as cursor position can accept string
    fieldIndex,
    sectionId: position.sectionId
  };

  return cursorPosition;
}
