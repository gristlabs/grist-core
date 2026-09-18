import { loadAirtableImportUI } from "app/client/lib/imports";
import { cssImportModal } from "app/client/lib/imports/ImportCss";
import { makeT } from "app/client/lib/localization";
import { reportError } from "app/client/models/errors";
import { urlState } from "app/client/models/gristUrlState";
import { HomeModel } from "app/client/models/HomeModel";
import { cssModalTitle, modal } from "app/client/ui2018/modals";

import type { AirtableImportResult } from "app/client/lib/imports/airtable/AirtableImporter";

const t = makeT("startHomeAirtableImport");

export async function startHomeAirtableImport(home: HomeModel) {
  const { AirtableImport } = await loadAirtableImportUI();

  const workspace = home.newDocWorkspace.get();
  if (typeof workspace !== "object" || workspace === null) {
    throw new Error(t("The current workspace can't be imported to."));
  }

  return modal((ctl, owner) => {
    const airtableImport = AirtableImport.create(owner, {
      api: home.app.api,
      destination: {
        type: "new-doc",
        workspaceId: workspace.id,
      },
      onSuccess: async ({ docId }: AirtableImportResult) => {
        ctl.close();
        await urlState().pushUrl({ doc: docId });
      },
      onError: (error: unknown) => {
        ctl.close();
        reportError(error);
      },
      onCancel: () => ctl.close(),
    });

    return [
      cssImportModal.cls(""),
      cssModalTitle(t("Import from Airtable")),
      airtableImport.buildDom(),
    ];
  });
}
