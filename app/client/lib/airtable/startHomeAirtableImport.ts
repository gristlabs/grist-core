import { loadAirtableImportUI } from "app/client/lib/imports";
import { makeT } from "app/client/lib/localization";
import { AppModel } from "app/client/models/AppModel";
import { urlState } from "app/client/models/gristUrlState";
import { cssModalTitle, cssModalWidth, modal } from "app/client/ui2018/modals";

import { styled } from "grainjs";

import type { AirtableImportResult } from "app/client/lib/airtable/AirtableImporter";

const t = makeT("AirtableImport");

export async function startHomeAirtableImport(app: AppModel) {
  const { AirtableImport } = await loadAirtableImportUI();

  return modal((ctl, owner) => {
    const airtableImport = AirtableImport.create(owner, {
      api: app.api,
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
