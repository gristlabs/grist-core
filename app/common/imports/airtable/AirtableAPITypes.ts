// Aliases for the various Airtable IDs makes various Map type definitions clearer.
export type AirtableBaseId = string;
export type AirtableTableId = string;
export type AirtableFieldId = string;
export type AirtableFieldName = string;

// Airtable schema response. Limit this to only needed fields to minimise chance of breakage.
export interface AirtableBaseSchema {
  tables: AirtableTableSchema[];
}

export interface AirtableTableSchema {
  id: AirtableTableId;
  name: string;
  primaryFieldId: string;
  fields: AirtableFieldSchema[];
}

export interface AirtableFieldSchema {
  id: AirtableFieldId;
  name: AirtableFieldName;
  type: string;
  options?: { [key: string]: any };
}

export interface AirtableChoiceValue {
  id: string;
  name: string;
  color: string;
}

export interface AirtableListBasesResponse {
  bases: {
    id: string,
    name: string,
    permissionLevel: ("none" | "read" | "comment" | "edit" | "create")[],
  }[],
  offset?: string,
}
