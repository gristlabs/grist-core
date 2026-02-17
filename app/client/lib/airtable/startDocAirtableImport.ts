import { GristDoc } from "app/client/components/GristDoc";
import { loadAirtableImportUI } from "app/client/lib/imports";
import { makeT } from "app/client/lib/localization";
import { cssModalTitle, cssModalWidth, modal } from "app/client/ui2018/modals";
import { ExistingDocSchema } from "app/common/DocSchemaImportTypes";

import { Computed, styled } from "grainjs";

const t = makeT("AirtableImport");

export async function startDocAirtableImport(gristDoc: GristDoc) {
  const { AirtableImport } = await loadAirtableImportUI();

  return modal((ctl, owner) => {
    const existingDocSchema: Computed<ExistingDocSchema> = Computed.create(owner, (use) => {
      const tables = use(gristDoc.docModel.visibleTables.getObservable());
      return {
        tables: tables.map(t => ({
          id: use(t.tableId),
          name: use(t.tableName),
          columns: use(t.visibleColumns).map(c => ({
            id: use(c.colId),
            ref: use(c.id),
            label: use(c.label),
            isFormula: use(c.isFormula),
          })),
        })),
      };
    });

    const airtableImport = AirtableImport.create(owner, {
      api: gristDoc.docPageModel.appModel.api,
      existingDocId: gristDoc.docId(),
      existingDocSchema,
      onSuccess: () => ctl.close(),
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
