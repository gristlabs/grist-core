/**
 * Shared layout constants for grid-based views (GridView, SpreadsheetView).
 * Centralised here so that a dimension change propagates to all renderers.
 */

export const CELL_WIDTH = 100;
export const MIN_COL_WIDTH = 30;
export const CELL_HEIGHT = 28;
export const ROW_HEADER_WIDTH = 52;
export const HEADER_HEIGHT = 24;
export const CURSOR_OUTLINE_WIDTH = 2;
export const CELL_PADDING = 4;          // horizontal padding inside cells and headers
export const PLUS_COL_WIDTH = 40;       // width of the "+" add-column button in GridView

/** Sticky header z-index layering (higher = on top). */
export const Z_CORNER = 3;
export const Z_COL_HEADER = 2;
export const Z_ROW_HEADER = 1;
