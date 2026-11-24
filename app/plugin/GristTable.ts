/**
 * Common definitions for Grist plugin APIs.
 */

/**
 * Metadata and data for a table.
 */
export interface GristTable {
  // This is documenting what is currently returned by the core plugins. Capitalization
  // is python-style.
  //
  // TODO: could be worth reconciling with: /documentation/grist-data-format.md.
  table_name: string | null;  // currently allow names to be null
  column_metadata: GristColumn[];
  table_data: any[][];
  // Set when the source lays the table out right-to-left or left-to-right by an explicit choice
  // (as an Excel sheet marked right-to-left); grids of a table created from it are given it.
  sheet_orientation?: "rtl" | "ltr";
}

export interface GristTables {
  tables: GristTable[];
}

/**
 * Metadata about a single column.
 */
export interface GristColumn {
  id: string;
  type: string;
}

export enum APIType {
  ImportSourceAPI,
  ImportProcessorAPI,
  ParseOptionsAPI,
  ParseFileAPI,
}
