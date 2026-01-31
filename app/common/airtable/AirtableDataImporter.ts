import {
  AirtableBaseSchema,
  AirtableFieldName,
  AirtableFieldSchema,
  AirtableTableId,
  AirtableTableSchema,
} from "app/common/airtable/AirtableAPI";
import { AirtableIdColumnLabel } from "app/common/airtable/AirtableSchemaImporter";
import {
  ExistingColumnSchema,
  ExistingDocSchema,
  ExistingTableSchema,
} from "app/common/DocSchemaImportTypes";
import { BulkColValues, CellValue } from "app/plugin/GristData";

import { AirtableBase } from "airtable/lib/airtable_base";
import { chain } from "lodash";

interface AirtableDataImportParams {
  base: AirtableBase,
  addRows: (tableId: GristTableId, rows: BulkColValues) => Promise<unknown>,
  schemaCrosswalk: AirtableBaseSchemaCrosswalk,
}

export async function importDataFromAirtableBase({ base, addRows, schemaCrosswalk }: AirtableDataImportParams) {
  // Build or receive a lookup table for references from the existing Grist doc.
  // Could build a lookup table for the second one?
  // Lookup tables are invalidated if *any* new rows are created

  const addRowsPromises: Promise<any>[] = [];

  for (const [tableId, tableCrosswalk] of schemaCrosswalk.tables.entries()) {
    console.log(`Migrating ${tableId} to ${tableCrosswalk.gristTable.id}`);
    console.log(tableCrosswalk);
    // Filter out any formula columns early - Grist will error on any write to formula columns.
    const fieldMappings = Array.from(tableCrosswalk.fields.values()).filter(mapping => !mapping.gristColumn.isFormula);
    const gristColumnIds = fieldMappings.map(mapping => mapping.gristColumn.id);

    // Airtable ID needs to be handled separately to fields, as it's not stored as a field in Airtable
    if (tableCrosswalk.airtableIdColumn) {
      gristColumnIds.push(tableCrosswalk.airtableIdColumn.id);
    }
    const createBulkColValues = () => chain(gristColumnIds).keyBy().mapValues(() => []).value();

    // Used to re-throw outside of the eachPage iterator.
    let eachPageError: any = undefined;

    // TODO - This can throw various errors from Airtable's API
    await base.table(tableId).select().eachPage((records, nextPage) => {
      // Try-catch needed as Airtable's eachPage handler catches any error thrown here, and emits
      // an entirely different, unrelated error instead (looks like a bug in their library)
      try {
        const debugFields: any[] = [];
        const colValues: BulkColValues = createBulkColValues();
        for (const record of records) {
          debugFields.push(record.fields);
          for (const fieldMapping of fieldMappings) {
            const convert =
              AirtableFieldValueConverters[fieldMapping.airtableField.type] ?? AirtableFieldValueConverters.identity;

            const value = convert(fieldMapping.airtableField, record.fields[fieldMapping.airtableField.name]);

            // Always push, even if the value is undefined, so that row values are always at the right index.
            colValues[fieldMapping.gristColumn.id].push(value ?? null);
          }

          if (tableCrosswalk.airtableIdColumn) {
            colValues[tableCrosswalk.airtableIdColumn.id].push(record.id);
          }
        }

        console.log(debugFields);
        console.log(colValues);

        addRowsPromises.push(addRows(tableCrosswalk.gristTable.id, colValues));

        nextPage();
      }
      catch (e) {
        eachPageError = e;
      }
    });

    // TODO - Throw this for now, but we might want to ignore anything recoverable (partial import?)
    if (eachPageError) {
      throw eachPageError;
    }
  }

  // TODO - Handle errors from any addRows promise
  await Promise.all(addRowsPromises);

  // Fetch Airtable data - one page at a time
  // Convert fields to Grist fields
  // Resolve references
  //   - Add mapping for received row
  //   - Resolve any references
  //   - Mark any unresolved references for later
}

type AirtableFieldValueConverter = (fieldSchema: AirtableFieldSchema, value: any) => CellValue | undefined;
// TODO - Make these values easier to use by typing their parameters. It won't be type safe, but might help.
const AirtableFieldValueConverters: Record<string, AirtableFieldValueConverter> = {
  identity(fieldSchema, value) {
    return value;
  },
  aiText(fieldSchema, aiTextState) {
    return aiTextState?.value;
  },
  createdBy(fieldSchema, collaborator) {
    return formatCollaborator(collaborator);
  },
  formula(fieldSchema, collaborator) {
    // Generated column - should be a formula in Grist, no value needed
    return null;
  },
  lastModifiedBy(fieldSchema, collaborator) {
    return formatCollaborator(collaborator);
  },
  multipleCollaborators(fieldSchema, collaborators) {
    return collaborators?.map(formatCollaborator);
  },
  singleCollaborator(fieldSchema, collaborator) {
    return formatCollaborator(collaborator);
  },
  rollup(fieldSchema, collaborator) {
    // Generated column - should be a formula in Grist, no value needed
    return null;
  },
};

const formatCollaborator = (collaborator: any) => collaborator?.name;

type GristTableId = string;

interface AirtableBaseSchemaCrosswalk {
  tables: Map<AirtableTableId, AirtableTableCrosswalk>
}

interface AirtableTableCrosswalk {
  airtableTable: AirtableTableSchema;
  gristTable: ExistingTableSchema;
  fields: Map<AirtableFieldName, AirtableFieldMappingInfo>
  // Special case - ID isn't a field in Airtable, but it's useful to have a mapping if it exists.
  airtableIdColumn?: ExistingColumnSchema;
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
): { schemaCrosswalk: AirtableBaseSchemaCrosswalk, warnings: AirtableDataImportWarning[] } {
  const schemaCrosswalk: AirtableBaseSchemaCrosswalk = {
    tables: new Map(),
  };
  const warnings: AirtableDataImportWarning[] = [];

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
