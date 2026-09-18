import { GristDoc } from "app/client/components/GristDoc";
import { docSchemaFromDocModel } from "app/client/lib/DocSchemaImport";
import { GristImport } from "app/client/lib/imports/grist/GristImportUI";
import { cssImportModal, cssImportModalCloseButton } from "app/client/lib/imports/ImportCss";
import { makeT } from "app/client/lib/localization";
import { reportError } from "app/client/models/errors";
import { testId } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { cssModalTitle, modal } from "app/client/ui2018/modals";
import { DocSchema } from "app/common/DocSchemaImport";

import { Computed, dom } from "grainjs";

const t = makeT("startDocGristImport");

export async function startDocGristImport(gristDoc: GristDoc) {
  return modal((ctl, owner) => {
    const destDocSchema: Computed<DocSchema> = Computed.create(owner, use =>
      docSchemaFromDocModel(use, gristDoc.docModel));

    const gristImport = GristImport.create(owner, {
      appModel: gristDoc.docPageModel.appModel,
      destination: {
        type: "existing-doc",
        docId: gristDoc.docId(),
        docSchema: destDocSchema,
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
      cssImportModalCloseButton(
        icon("CrossBig"),
        dom.on("click", () => ctl.close()),
        testId("import-grist-close"),
      ),
      cssModalTitle(t("Copy data from another document")),
      gristImport.buildDom(),
    ];
  });
}
