import {
  GristImportDestination,
  GristImportResult,
  GristImportTableMapping,
} from "app/client/lib/imports/grist/GristImporterTypes";
import {
  DocSchema,
  DocSchemaImportWarning,
  ImportSchemaTransformParams,
} from "app/common/DocSchemaImport";
import { UserAPI } from "app/common/UserAPI";

export function runGristImport(_params: {
  sourceDocId: string,
  userApi: UserAPI,
  tables: GristImportTableMapping[],
  destination: GristImportDestination,
}): Promise<GristImportResult> {
  throw new Error("Importing tables from another document is not available in grist-core");
}

export function validateGristSchemaImport(
  _sourceSchema: DocSchema,
  _transformations?: ImportSchemaTransformParams,
  _destDocSchema?: DocSchema,
): DocSchemaImportWarning[] {
  return [];
}
