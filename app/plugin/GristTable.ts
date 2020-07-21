/**
 * Common definitions for Grist plugin APIs.
 */

/**
 *
 * Metadata and data for a table.  This is documenting what is currently returned by the
 * core plugins.  Could be worth reconciling with:
 *   https://phab.getgrist.com/w/grist_data_format/
 * Capitalization is python-style.
 *
 */
export interface GristTable {
  table_name: string | null;  // currently allow names to be null
  column_metadata: GristColumn[];
  table_data: any[][];
}

export interface GristTables {
  tables: GristTable[];
}

/**
 *
 * Metadata about a single column.
 *
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
