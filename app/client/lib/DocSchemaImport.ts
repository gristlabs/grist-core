import { tablesToSchema } from "app/common/DocSchemaImport";
import { ExistingDocSchema } from "app/common/DocSchemaImportTypes";
import { DocAPI } from "app/common/UserAPI";

export async function getExistingDocSchema(docApi: DocAPI): Promise<ExistingDocSchema> {
  const { tables } = await docApi.getTables({ expand: ["column"] });
  return tablesToSchema(tables);
}
