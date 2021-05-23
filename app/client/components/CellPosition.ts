import { CursorPos } from "app/client/components/Cursor";
import { DocModel } from "app/client/models/DocModel";

/**
 * Absolute position of a cell in a document
 */
export interface CellPosition {
  sectionId: number;
  rowId: number;
  colRef: number;
}

/**
 * Checks if two positions are equal.
 * @param a First position
 * @param b Second position
 */
export function samePosition(a: CellPosition, b: CellPosition) {
  return a && b && a.colRef == b.colRef &&
    a.sectionId == b.sectionId &&
    a.rowId == b.rowId;
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
    rowId: position.rowId,
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
    rowId: position.rowId,
    fieldIndex,
    sectionId: position.sectionId
  };

  return cursorPosition;
}
