import { get as getBrowserGlobals } from "app/client/lib/browserGlobals";

const G = getBrowserGlobals("window");

export const runAirtableImportWithDynamicModuleLoad: Window["gristAirtableImport"] =
  async (...args) => {
    const module = await import("app/client/lib/airtable/AirtableImporter");
    return module.runAirtableImport(...args);
  };

export function addAirtableImportBrowserGlobal() {
  G.window.gristAirtableImport = runAirtableImportWithDynamicModuleLoad;
}
