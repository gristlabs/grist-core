import { formatGetTablesResult } from "app/common/DocSchemaImport";
import { ExistingDocSchema } from "app/common/DocSchemaImportTypes";
import { DocAPI } from "app/common/UserAPI";

export async function getExistingDocSchema(docApi: DocAPI): Promise<ExistingDocSchema> {
  const result = await docApi.getTables(["column"]);
  return formatGetTablesResult(result);
}
