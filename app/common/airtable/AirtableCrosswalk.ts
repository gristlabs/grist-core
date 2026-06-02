import {
  AirtableBaseSchema,
  AirtableFieldName, AirtableFieldSchema,
  AirtableTableId,
  AirtableTableSchema,
} from "app/common/airtable/AirtableAPITypes";
import { AirtableIdColumnLabel } from "app/common/airtable/AirtableSchemaImporter";
import {
  ExistingColumnSchema,
  ExistingDocSchema,
  ExistingTableSchema,
} from "app/common/DocSchemaImportTypes";

export type GristTableId = string;

export interface AirtableBaseSchemaCrosswalk {
  tables: Map<AirtableTableId, AirtableTableCrosswalk>
}

export interface AirtableTableCrosswalk {
  airtableTable: AirtableTableSchema;
  gristTable: ExistingTableSchema;
  fields: Map<AirtableFieldName, AirtableFieldMappingInfo>
  // Special case - ID isn't a field in Airtable, but it's useful to have a mapping if it exists.
  airtableIdColumn?: ExistingColumnSchema;
}

export interface AirtableFieldMappingInfo {
  airtableField: AirtableFieldSchema;
  gristColumn: ExistingColumnSchema;
}

/**
 * Creates a mapping from fields in an Airtable schema to fields in a Grist schema.
 * @param {AirtableBaseSchema} airtableSchema
 * @param {ExistingDocSchema} gristSchema
 * @param {Map<AirtableTableId, GristTableId>} tableMap
 * @returns {{schemaCrosswalk: AirtableBaseSchemaCrosswalk, warnings: DocSchemaImportWarning[]}}
 */
export function createAirtableBaseToGristDocCrosswalk(
  airtableSchema: AirtableBaseSchema, gristSchema: ExistingDocSchema, tableMap: Map<AirtableTableId, GristTableId>,
): { schemaCrosswalk: AirtableBaseSchemaCrosswalk, warnings: AirtableCrosswalkWarning[] } {
  const schemaCrosswalk: AirtableBaseSchemaCrosswalk = {
    tables: new Map(),
  };
  const warnings: AirtableCrosswalkWarning[] = [];

  for (const [airtableTableId, gristTableId] of tableMap.entries()) {
    const airtableTableSchema = airtableSchema.tables.find(table => table.id === airtableTableId);
    const gristTableSchema = gristSchema.tables.find(table => table.id === gristTableId);

    if (!airtableTableSchema) {
      // Implementation error - this shouldn't be possible if the parameters are passed correctly.
      throw new Error(`No airtable table found with id '${airtableTableId}' when building crosswalk`);
    }

    if (!gristTableSchema) {
      warnings.push(new MissingGristTableWarning(gristTableId));
      continue;
    }

    const { crosswalk: tableCrosswalk, warnings: tableWarnings } =
      createAirtableTableToGristTableCrosswalk(airtableTableSchema, gristTableSchema);

    warnings.push(...tableWarnings);

    schemaCrosswalk.tables.set(airtableTableId, tableCrosswalk);
  }

  return {
    schemaCrosswalk,
    warnings,
  };
}

function createAirtableTableToGristTableCrosswalk(
  airtableTableSchema: AirtableTableSchema, gristTableSchema: ExistingTableSchema,
) {
  const warnings: AirtableCrosswalkWarning[] = [];
  const crosswalk: AirtableTableCrosswalk = {
    airtableTable: airtableTableSchema,
    gristTable: gristTableSchema,
    fields: new Map(),
    airtableIdColumn: gristTableSchema.columns.find(column => column.label === AirtableIdColumnLabel),
  };

  for (const field of airtableTableSchema.fields) {
    // Match columns on label. It's the only reliable value we can automatically match on and the simplest to implement.
    const matchingColumn = findGristColumnForField(field, gristTableSchema);
    if (!matchingColumn) {
      warnings.push(new NoDestinationColumnWarning(gristTableSchema.id, field));
      continue;
    }
    // Airtable record queries list fields by name (not id), which is guaranteed to be unique.
    crosswalk.fields.set(field.name, {
      airtableField: field,
      gristColumn: matchingColumn,
    });
  }

  return { crosswalk, warnings };
}

function findGristColumnForField(field: AirtableFieldSchema, gristSchema: ExistingTableSchema) {
  return gristSchema.columns.find(column => column.label === field.name);
}

export interface AirtableCrosswalkWarning {
  message: string;
}

class MissingGristTableWarning implements AirtableCrosswalkWarning {
  public readonly message;

  constructor(public readonly tableId: AirtableTableId) {
    this.message = `No Grist table found with id '${tableId}'`;
  }
}

class NoDestinationColumnWarning implements AirtableCrosswalkWarning {
  public readonly message: string;

  constructor(public readonly gristTableId: string, public readonly field: AirtableFieldSchema) {
    this.message = `No destination column in the Grist table '${gristTableId}' could be found for field '${field.name}'. A column with a matching label is required.`;
  }
}
