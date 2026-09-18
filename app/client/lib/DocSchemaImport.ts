import { DocModel } from "app/client/models/DocModel";
import { ColumnRec } from "app/client/models/entities/ColumnRec";
import { buildDocSchema, DocSchema } from "app/common/DocSchemaImport";
import { DocAPI } from "app/common/UserAPI";
import { ColumnMetadata } from "app/plugin/DocApiTypes";

import { UseCB } from "grainjs";

export async function getDocSchema(docApi: DocAPI): Promise<DocSchema> {
  const { tables } = await docApi.getTables({ expand: ["column"], hidden: true });
  return buildDocSchema(tables);
}

export function docSchemaFromDocModel(use: UseCB, docModel: DocModel): DocSchema {
  const tables = use(docModel.visibleTables.getObservable());
  return {
    tables: tables.map(table => ({
      id: use(table.tableId),
      name: use(table.tableName),
      columns: use(table.visibleColumns).map(column => columnMetadataFromDocModel(use, column)),
    })),
  };
}

function columnMetadataFromDocModel(use: UseCB, column: ColumnRec): ColumnMetadata {
  return {
    id: use(column.colId),
    fields: {
      colRef: use(column.id),
      label: use(column.label),
      isFormula: use(column.isFormula),
      type: use(column.type),
      formula: use(column.formula),
      description: use(column.description),
      widgetOptions: use(column.widgetOptions),
      displayCol: use(column.displayCol),
      visibleCol: use(column.visibleCol),
    },
  };
}
