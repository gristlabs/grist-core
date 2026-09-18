import { GristDoc } from "app/client/components/GristDoc";
import { docSchemaFromDocModel } from "app/client/lib/DocSchemaImport";
import { loadAirtableImportUI } from "app/client/lib/imports";
import { cssImportModal } from "app/client/lib/imports/ImportCss";
import { makeT } from "app/client/lib/localization";
import { reportError } from "app/client/models/errors";
import { cssModalTitle, modal } from "app/client/ui2018/modals";
import { DocSchema } from "app/common/DocSchemaImport";

import { Computed } from "grainjs";

const t = makeT("startDocAirtableImport");

export async function startDocAirtableImport(gristDoc: GristDoc) {
  const { AirtableImport } = await loadAirtableImportUI();

  return modal((ctl, owner) => {
    const existingDocSchema: Computed<DocSchema> = Computed.create(owner, use =>
      docSchemaFromDocModel(use, gristDoc.docModel));

    const airtableImport = AirtableImport.create(owner, {
      api: gristDoc.docPageModel.appModel.api,
      destination: {
        type: "existing-doc",
        docId: gristDoc.docId(),
        docSchema: existingDocSchema,
      },
      onSuccess: () => ctl.close(),
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
