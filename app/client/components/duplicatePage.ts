import { duplicateWidgets } from "app/client/components/duplicateWidget";
import { GristDoc } from "app/client/components/GristDoc";
import { onceAttached } from "app/client/lib/domUtils";
import { makeT } from "app/client/lib/localization";
import { logTelemetryEvent } from "app/client/lib/telemetry";
import { cssInput } from "app/client/ui/cssInput";
import { cssField, cssLabel } from "app/client/ui/MakeCopyMenu";
import { confirmModal } from "app/client/ui2018/modals";

import { dom } from "grainjs";

const t = makeT("duplicatePage");

// Duplicate page with pageId. Starts by prompting user for a new name.
export async function buildDuplicatePageDialog(gristDoc: GristDoc, pageId: number) {
  const pagesTable = gristDoc.docModel.pages;
  const pageName = pagesTable.rowModels[pageId].view.peek().name.peek();
  const inputEl = cssInput({ value: pageName + " (copy)" });
  // The suggested name is meant to be typed over, so it has to arrive selected.
  onceAttached(inputEl, () => { inputEl.focus(); inputEl.select(); });

  confirmModal("Duplicate page", "Save", () => duplicatePage(gristDoc, pageId, inputEl.value), {
    explanation: dom("div", [
      cssField(
        cssLabel("Name"),
        inputEl,
      ),
      t("Note that this does not copy data, but creates another view of the same data."),
    ]),
  });
}

/**
 * Duplicates page recreating all sections that are on it.
 */
async function duplicatePage(gristDoc: GristDoc, pageId: number, pageName: string = "") {
  const sourceView = gristDoc.docModel.pages.rowModels[pageId].view.peek();
  pageName = pageName || `${sourceView.name.peek()} (copy)`;
  const viewSections = sourceView.viewSections.peek().peek();
  let viewRef = 0;
  await gristDoc.docData.bundleActions(
    t("Duplicate page {{pageName}}", { pageName }),
    async () => {
      logTelemetryEvent("addedPage", { full: { docIdDigest: gristDoc.docId() } });

      const duplicateWidgetsResult = await duplicateWidgets(
        gristDoc,
        viewSections.map(viewSection => viewSection.id.peek()),
        viewRef,
      );

      // Update viewRef to the newly created page.
      viewRef = duplicateWidgetsResult.viewId;

      // give it a better name
      await gristDoc.docModel.views.rowModels[viewRef].name.saveOnly(pageName);
    });

  // Give copy focus
  await gristDoc.openDocPage(viewRef);
}
