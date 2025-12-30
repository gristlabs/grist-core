import { AirtableAPI } from "app/common/AirtableAPI";
import { AirtableImporter } from "app/common/AirtableImporter";
import { transformDocCreationSchema } from "app/common/DocSchemaImport";

window.runAirtableMigration = async function(apiKey, base) {
  const api = new AirtableAPI({ apiKey });

  // We can try using a custom DocComm inside a FlowRunner here if needed.
  const userApi = window.gristApp?.topAppModel?.api;
  if (!userApi) {
    throw new Error("No user API available");
  }

  const workspaces = await userApi.getOrgWorkspaces("current");
  const docId = await userApi.newDoc({ name: base }, workspaces[0].id);
  const docApi = userApi.getDocAPI(docId);

  const importer = new AirtableImporter(api);
  const schema = await importer.createDocSchema(base);
  const transformedSchema = transformDocCreationSchema(schema, {});
  return await importer.importSchema(actions => docApi.applyUserActions(actions), transformedSchema);
};
