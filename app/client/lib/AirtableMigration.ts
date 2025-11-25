import { AirtableMigrator } from 'app/common/AirtableMigration';
import { AirtableAPI } from 'app/common/AirtableAPI';

window.runAirtableMigration = async function (apiKey, base) {
  const api = new AirtableAPI({ apiKey });

  // We can try using a custom DocComm inside a FlowRunner here if needed.
  const userApi = window.gristApp?.topAppModel?.api;
  if (!userApi) {
    throw new Error("No user API available");
  }

  const workspaces = await userApi.getOrgWorkspaces('current');
  const docId = await userApi.newDoc({ name: base }, workspaces[0].id);
  const docApi = userApi.getDocAPI(docId);

  const migrator = new AirtableMigrator(api, (actions) => docApi.applyUserActions(actions));
  await migrator.run(base);
  console.log(migrator);
  console.log(docId);
};
