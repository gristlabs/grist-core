import { formatDocSchemaSqlResult, GET_DOC_SCHEMA_SQL } from "app/common/DocSchemaImport";
import { DocSchemaSqlResultChecker, ExistingDocSchema } from "app/common/DocSchemaImportTypes";
import { DocAPI } from "app/common/UserAPI";

export async function getExistingDocSchema(docApi: DocAPI): Promise<ExistingDocSchema> {
  const result = await docApi.sql(GET_DOC_SCHEMA_SQL);
  const formattedResult = result.records.map(record => record.fields);
  if (DocSchemaSqlResultChecker.test(formattedResult)) {
    return formatDocSchemaSqlResult(formattedResult);
  }
  // This should always throw, but typescript doesn't know that.
  DocSchemaSqlResultChecker.check(formattedResult);
  throw new Error("Invalid schema format - this error should not be hit");
}
