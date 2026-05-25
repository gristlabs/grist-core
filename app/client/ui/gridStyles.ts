/**
 * Shared CSS mixins for grid-based views (GridView, SpreadsheetView).
 * These are plain CSS strings that can be interpolated into grainjs `styled()` calls.
 */

import { theme } from "app/client/ui2018/cssVars";
import {
  CELL_HEIGHT, CELL_PADDING, CELL_WIDTH, CURSOR_OUTLINE_WIDTH,
  HEADER_HEIGHT, ROW_HEADER_WIDTH,
  Z_COL_HEADER, Z_CORNER, Z_ROW_HEADER,
} from "app/client/ui/gridConstants";

/** Base CSS for a data cell (td). */
export const cellBaseCss = `
  width: ${CELL_WIDTH}px;
  min-width: ${CELL_WIDTH}px;
  max-width: ${CELL_WIDTH}px;
  height: ${CELL_HEIGHT}px;
  padding: 0 ${CELL_PADDING}px;
  border: 1px solid ${theme.tableBodyBorder};
  color: ${theme.cellFg};
  background: ${theme.cellBg};
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  position: relative;
  box-sizing: border-box;
`;

/** Shared header styling (background, font, no-select). Suitable for both column and row headers. */
export const headerBaseCss = `
  padding: 0 ${CELL_PADDING}px;
  background: ${theme.tableHeaderBg};
  border: 1px solid ${theme.tableBodyBorder};
  color: ${theme.tableHeaderFg};
  text-align: center;
  white-space: nowrap;
  user-select: none;
`;

/** Column header: sticky at top, fixed width. */
export const colHeaderCss = `
  ${headerBaseCss}
  position: sticky;
  top: 0;
  z-index: ${Z_COL_HEADER};
  width: ${CELL_WIDTH}px;
  min-width: ${CELL_WIDTH}px;
  max-width: ${CELL_WIDTH}px;
  height: ${HEADER_HEIGHT}px;
  font-weight: 600;
`;

/** Row header: sticky at left, fixed width. */
export const rowHeaderCss = `
  ${headerBaseCss}
  position: sticky;
  left: 0;
  z-index: ${Z_ROW_HEADER};
  width: ${ROW_HEADER_WIDTH}px;
  min-width: ${ROW_HEADER_WIDTH}px;
  max-width: ${ROW_HEADER_WIDTH}px;
  height: ${CELL_HEIGHT}px;
  font-weight: 500;
`;

/** Corner cell (top-left): sticky on both axes. */
export const cornerCellCss = `
  position: sticky;
  top: 0;
  left: 0;
  z-index: ${Z_CORNER};
  width: ${ROW_HEADER_WIDTH}px;
  min-width: ${ROW_HEADER_WIDTH}px;
  max-width: ${ROW_HEADER_WIDTH}px;
  height: ${HEADER_HEIGHT}px;
  background: ${theme.tableHeaderBg};
  border: 1px solid ${theme.tableBodyBorder};
`;

/** Cursor outline for the actively selected cell. */
export const cursorHighlightCss = `
  outline: ${CURSOR_OUTLINE_WIDTH}px solid ${theme.cursor};
  outline-offset: -${CURSOR_OUTLINE_WIDTH}px;
  z-index: 1;
`;
