import { makeT } from "app/client/lib/localization";
import { saveModal } from "app/client/ui2018/modals";
import { ReferencePreview, ReferenceTableAPI } from "app/common/ReferenceTableAPI";

import { Computed, dom, input, Observable, styled } from "grainjs";

const t = makeT("ReferenceConnection");

/** Same explicit preview/confirmation from settings, Add, and the public connection landing page. */
export function connectReferenceWithLink(api: ReferenceTableAPI, onConnected: () => Promise<unknown> = async () => {}) {
  saveModal((_ctl, owner) => {
    const url = Observable.create(owner, "");
    return {
      title: t("Connect with a link"),
      body: cssBody(dom("p", t("Paste the connection link supplied by the reference owner.")),
        input(url, { onInput: true }, { placeholder: t("Connection link"), autocomplete: "off" })),
      saveLabel: t("Preview"),
      saveDisabled: Computed.create(owner, use => !use(url).trim()),
      saveFunc: async () => {
        const value = url.get().trim();
        const preview = await api.previewConnection(value);
        url.set("");
        setTimeout(() => previewReferenceConnection(preview.name, preview, async (aliases) => {
          await api.connect(value, aliases, preview.contractVersion);
          await onConnected();
        }, preview.description), 0);
      },
    };
  });
}

export function previewReferenceConnection(name: string, preview: ReferencePreview,
  connect: (aliases: Record<string, string>) => Promise<unknown>, description = "") {
  saveModal((_ctl, owner) => {
    const tables = preview.tables.map(table => ({ table, alias: Observable.create(owner, `Ref_${table.tableId}`) }));
    return {
      title: name,
      body: cssBody(dom("p", t("Contract version"), ": ", String(preview.contractVersion)),
        description ? dom("p", description) : null,
        dom("p", t("Your document name and site will appear in the source owner's list of connected documents.")),
        dom("p",
          t("Published data follows destination permissions. Revoking access keeps the last synchronized copy.")),
        dom("p", t("Choose local table names. These tables will be read-only and available in formulas.")),
        tables.map(({ table, alias }) => dom("label", table.tableId, ` (${table.rowCount})`,
          dom("div", table.columns.join(", ")), input(alias, { onInput: true })))),
      saveLabel: t("Connect"),
      saveDisabled: Computed.create(owner, (use) => {
        const aliases = tables.map(({ alias }) => use(alias));
        return aliases.some(a => !/^[A-Za-z][A-Za-z0-9_]*$/.test(a)) || new Set(aliases).size !== aliases.length;
      }),
      saveFunc: () => connect(Object.fromEntries(tables.map(t => [t.table.key, t.alias.get()]))),
    };
  });
}

const cssBody = styled("div", `display: flex; flex-direction: column; gap: 12px;`);
