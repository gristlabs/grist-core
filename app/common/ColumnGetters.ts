/**
 *
 * An interface for accessing the columns of a table by their
 * ID in _grist_Tables_column, which is the ID used in sort specifications.
 * Implementations of this interface can be supplied to SortFunc to
 * sort the rows of a table according to such a specification.
 *
 */
export interface ColumnGetters {

  /**
   *
   * Takes a _grist_Tables_column ID and returns a function that maps
   * rowIds to values for that column.  Those values should be display
   * values if available, drawn from a corresponding display column.
   *
   */
  getColGetter(colRef: number): ((rowId: number) => any) | null;

  /**
   *
   * Returns a getter for the manual sort column if it is available.
   *
   */
  getManualSortGetter(): ((rowId: number) => any) | null;
}
