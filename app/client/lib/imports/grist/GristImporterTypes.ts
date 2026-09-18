export interface ExistingDoc {
  type: "existing-doc";
  docId: string;
}

export interface NewDoc {
  type: "new-doc";
  workspaceId: number;
  name?: string;
}

export type GristImportDestination = NewDoc | ExistingDoc;

export interface GristImportResult {
  docId: string;
  warnings: string[];
}

export interface GristImportTableMapping {
  sourceTableId: string;
  destTableId?: string;
  structureOnly?: boolean;
}
