import {
  AirtableBaseSchema,
  AirtableFieldSchema,
  AirtableTableId,
  AirtableTableSchema,
} from "app/common/airtable/AirtableAPI";
import { DocSchemaImportWarning } from "app/common/DocSchemaImport";
import {
  ExistingColumnSchema,
  ExistingDocSchema,
  ExistingTableSchema,
} from "app/common/DocSchemaImportTypes";
import { BulkColValues } from "app/plugin/GristData";

import { AirtableBase } from "airtable/lib/airtable_base";

interface AirtableDataImportParams {
  base: AirtableBase,
  addRows: (tableId: GristTableId, rows: BulkColValues) => Promise<unknown>,
  schemaCrosswalk: AirtableBaseSchemaCrosswalk,
}

export async function importDataFromAirtableBase({ base, addRows, schemaCrosswalk }: AirtableDataImportParams) {
  // Build or receive a lookup table for references from the existing Grist doc.
  // Could build a lookup table for the second one?
  // Lookup tables are invalidated if *any* new rows are created

  for (const [tableId, tableCrosswalk] of schemaCrosswalk.tables.entries()) {
    console.log(`Migrating ${tableId} to ${tableCrosswalk.gristTable.id}`);
    console.log(tableCrosswalk);
    await base.table(tableId).select().eachPage((records, nextPage) => {
      console.log(Array.from(tableCrosswalk.fields.keys()));
      console.log(records);
      nextPage();
    });
  }

  // Fetch Airtable data - one page at a time
  // Convert fields to Grist fields
  // Resolve references
  //   - Add mapping for received row
  //   - Resolve any references
  //   - Mark any unresolved references for later
}

type GristTableId = string;

interface AirtableBaseSchemaCrosswalk {
  tables: Map<AirtableTableId, AirtableTableCrosswalk>
}

interface AirtableTableCrosswalk {
  airtableTable: AirtableTableSchema;
  gristTable: ExistingTableSchema;
  fields: Map<AirtableFieldName, AirtableFieldMappingInfo>
}

interface AirtableFieldMappingInfo {
  airtableField: AirtableFieldSchema;
  gristColumn: ExistingColumnSchema;
}

// TODO - Consider moving Airtable -> Grist crosswalk to its own file.
/**
 * Creates a mapping from fields in an Airtable schema to fields in a Grist schema.
 * @param {AirtableBaseSchema} airtableSchema
 * @param {ExistingDocSchema} gristSchema
 * @param {Map<AirtableTableId, GristTableId>} tableMap
 * @returns {{schemaCrosswalk: AirtableBaseSchemaCrosswalk, warnings: DocSchemaImportWarning[]}}
 */
export function createAirtableBaseToGristDocCrosswalk(
  airtableSchema: AirtableBaseSchema, gristSchema: ExistingDocSchema, tableMap: Map<AirtableTableId, GristTableId>,
): { schemaCrosswalk: AirtableBaseSchemaCrosswalk, warnings: DocSchemaImportWarning[] } {
  const schemaCrosswalk: AirtableBaseSchemaCrosswalk = {
    tables: new Map(),
  };
  const warnings: DocSchemaImportWarning[] = [];

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
  const warnings: AirtableDataImportWarning[] = [];
  const crosswalk: AirtableTableCrosswalk = {
    airtableTable: airtableTableSchema,
    gristTable: gristTableSchema,
    fields: new Map(),
  };

  for (const field of airtableTableSchema.fields) {
    // Match columns on label. It's the only reliable value we can automatically match on and the simplest to implement.
    const matchingColumn = gristTableSchema.columns.find(column => column.label === field.name);
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

interface AirtableDataImportWarning {
  message: string;
}

class MissingGristTableWarning implements AirtableDataImportWarning {
  public readonly message;

  constructor(public readonly tableId: AirtableTableId) {
    this.message = `No Grist table found with id '${tableId}'`;
  }
}

class NoDestinationColumnWarning implements AirtableDataImportWarning {
  public readonly message: string;

  constructor(public readonly gristTableId: string, public readonly field: AirtableFieldSchema) {
    this.message = `No destination column in the Grist table '${gristTableId}' could be found for field '${field.name}'. A column with a matching label is required.`;
  }
}
