import { GristDoc } from "app/client/components/GristDoc";
import { startDocGristImport } from "app/client/lib/imports/grist/startDocGristImport";
import { startHomeGristImport } from "app/client/lib/imports/grist/startHomeGristImport";
import { makeT } from "app/client/lib/localization";
import { getLoginOrSignupUrl } from "app/client/lib/urlUtils";
import { urlState } from "app/client/models/gristUrlState";
import { HomeModel } from "app/client/models/HomeModel";
import { getGristImportStatus } from "app/client/ui/FeatureStatus";
import { menuIcon, menuItem } from "app/client/ui2018/menus";
import { isFeatureEnabled } from "app/common/gristUrls";

import { dom, DomContents } from "grainjs";

const t = makeT("GristImportEntryPoints");

function isGristImportVisible(): boolean {
  return isFeatureEnabled("importFromGrist") && getGristImportStatus() !== "hidden";
}

/**
 * The "Copy data from another document" entries in the two Add New menus: the home page's
 * (HomeLeftPane.ts) and an open document's (DocPageModel.ts).
 */

/** The Add New menu item on the home page, importing into a new document. */
export function buildHomeGristImportMenuItem(home: HomeModel): DomContents {
  return menuItem(
    async () => {
      if (home.app.currentValidUser) {
        await startHomeGristImport(home);
      } else {
        window.location.href = getLoginOrSignupUrl();
      }
    },
    menuIcon("Import"), t("Copy data from another document"),
    dom.show(isGristImportVisible()),
    dom.cls("disabled", !home.newDocWorkspace.get()),
  );
}

/** The Add New menu item in an open document, importing into that document. */
export function buildDocGristImportMenuItem(gristDoc: GristDoc, isReadonly: boolean): DomContents {
  const { appModel } = gristDoc.docPageModel;

  return menuItem(
    async () => {
      if (appModel.currentValidUser) {
        await startDocGristImport(gristDoc);
      } else {
        // Don't show the modal about unsaved changes; saving a document requires an
        // account, and the redirect below should automatically save the document upon
        // sign-up.
        gristDoc.docPageModel.clearUnsavedChanges();
        window.location.href = getLoginOrSignupUrl({ srcDocId: urlState().state.get().doc });
      }
    },
    menuIcon("Import"), t("Copy data from another document"),
    dom.show(isGristImportVisible()),
    dom.cls("disabled", isReadonly),
  );
}
