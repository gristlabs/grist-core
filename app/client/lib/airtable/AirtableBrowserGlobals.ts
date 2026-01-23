import { get as getBrowserGlobals } from "app/client/lib/browserGlobals";

const G = getBrowserGlobals("window");

export const runAirtableMigrationWithDynamicImport: Window["runAirtableMigration"] =
  async (...args) => {
    const module = await import("app/client/lib/airtable/AirtableImporter");
    return module.runAirtableMigration(...args);
  };

export function addAirtableMigrationBrowserGlobal() {
  G.window.runAirtableMigration = runAirtableMigrationWithDynamicImport;
}
