import { loadAirtableImportUI } from "app/client/lib/imports";
import { makeT } from "app/client/lib/localization";
import { urlState } from "app/client/models/gristUrlState";
import { HomeModel } from "app/client/models/HomeModel";
import { cssModalTitle, cssModalWidth, modal } from "app/client/ui2018/modals";

import { styled } from "grainjs";

import type { AirtableImportResult } from "app/client/lib/airtable/AirtableImporter";

const t = makeT("AirtableImport");

export async function startHomeAirtableImport(home: HomeModel) {
  const { AirtableImport } = await loadAirtableImportUI();

  const getNewDocWorkspace = () => {
    const workspace = home.newDocWorkspace.get();
    if (typeof workspace !== "object" || workspace === null) {
      throw new Error(t("The current workspace can't be imported to."))
    }
    return workspace.id;
  }

  return modal((ctl, owner) => {
    const airtableImport = AirtableImport.create(owner, {
      api: home.app.api,
      destination: {
        getNewDocWorkspace,
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
      cssModalStyle.cls(""),
      cssModalWidth("fixed-wide"),
      cssModalTitle(t("Import from Airtable")),
      airtableImport.buildDom(),
    ];
  });
}

const cssModalStyle = styled("div", `
  max-height: 90vh;
  display: flex;
  flex-direction: column;
`);
