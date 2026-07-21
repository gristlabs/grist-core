/**
 * Pure utility for 2D grid navigation with bounds clamping.
 * Tracks a (col, row) cursor position within a fixed grid and provides
 * movement with boundary enforcement.
 */

export interface GridBounds {
  numCols: number;
  numRows: number;
}

export interface GridPosition {
  col: number;
  row: number;
}

/**
 * Computes a new position after applying a delta, clamped to grid bounds.
 * Returns the clamped position without mutating the input.
 */
export function moveInGrid(pos: GridPosition, dc: number, dr: number, bounds: GridBounds): GridPosition {
  return {
    col: clamp(pos.col + dc, 0, bounds.numCols - 1),
    row: clamp(pos.row + dr, 0, bounds.numRows - 1),
  };
}

/**
 * Returns true if the position is at a boundary in the given direction.
 * Useful for deciding whether to trigger edge-scrolling.
 */
export function isAtBoundary(
  pos: GridPosition, direction: "left" | "right" | "up" | "down", bounds: GridBounds,
): boolean {
  switch (direction) {
    case "left": return pos.col === 0;
    case "right": return pos.col === bounds.numCols - 1;
    case "up": return pos.row === 0;
    case "down": return pos.row === bounds.numRows - 1;
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
