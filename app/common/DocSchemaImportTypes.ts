// Minimal information needed from the existing document for the import to work.
import typeSuite from "app/common/DocSchemaImportTypes-ti";

import { CheckerT, createCheckers } from "ts-interface-checker";

export interface ExistingDocSchema {
  tables: ExistingTableSchema[];
}

export interface ExistingTableSchema {
  id: string;
  ref?: number;
  columns: ExistingColumnSchema[];
}

export interface ExistingColumnSchema {
  id: string;
  ref: number;
  // Label is required for column matching to work correctly.
  label?: string;
  // Useful to import tools to know if a column is writable.
  isFormula: boolean;
}

export type DocSchemaSqlResult = {
  tableRef: number,
  tableId: string,
  colRef: number,
  colId: string,
  colLabel: string,
  colIsFormula: number,
}[];

const Checkers = createCheckers(typeSuite);
export const ExistingDocSchemaChecker = Checkers.ExistingDocSchema as CheckerT<ExistingDocSchema>;
export const ExistingTableSchemaChecker = Checkers.ExistingTableSchema as CheckerT<ExistingTableSchema>;
export const ExistingColumnSchemaChecker = Checkers.ExistingColumnSchema as CheckerT<ExistingColumnSchema>;
export const DocSchemaSqlResultChecker = Checkers.DocSchemaSqlResult as CheckerT<DocSchemaSqlResult>;
