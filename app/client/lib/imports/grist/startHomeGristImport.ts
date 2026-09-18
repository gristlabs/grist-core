import { GristImport } from "app/client/lib/imports/grist/GristImportUI";
import { cssImportModal, cssImportModalCloseButton } from "app/client/lib/imports/ImportCss";
import { makeT } from "app/client/lib/localization";
import { reportError } from "app/client/models/errors";
import { urlState } from "app/client/models/gristUrlState";
import { HomeModel } from "app/client/models/HomeModel";
import { testId } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { cssModalTitle, modal } from "app/client/ui2018/modals";

import { dom } from "grainjs";

import type { GristImportResult } from "app/client/lib/imports/grist/GristImporterTypes";

const t = makeT("startHomeGristImport");

export async function startHomeGristImport(home: HomeModel) {
  const workspace = home.newDocWorkspace.get();
  if (typeof workspace !== "object" || workspace === null) {
    throw new Error(t("Data can't be copied to the current workspace."));
  }

  return modal((ctl, owner) => {
    const gristImport = GristImport.create(owner, {
      appModel: home.app,
      destination: {
        type: "new-doc",
        workspaceId: workspace.id,
      },
      onSuccess: async ({ docId }: GristImportResult) => {
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
