import { GristDoc } from "app/client/components/GristDoc";
import { copyToClipboard } from "app/client/lib/clipboardUtils";
import { makeT } from "app/client/lib/localization";
import { reportError } from "app/client/models/AppModel";
import { connectReferenceWithLink, previewReferenceConnection } from "app/client/ui/ReferenceConnection";
import { ReferenceFilterEditor } from "app/client/ui/ReferenceFilterEditor";
import { referenceStatusLabel } from "app/client/ui/ReferenceTableStatus";
import { SectionCard } from "app/client/ui/SettingsLayout";
import { basicButton, primaryButton } from "app/client/ui2018/buttons";
import { theme } from "app/client/ui2018/cssVars";
import { confirmModal, saveModal } from "app/client/ui2018/modals";
import {
  PublishedReference, ReferenceAuthorization, ReferenceConnectionLinkInfo, ReferenceSubscriptionInfo, ReferenceTableAPI,
} from "app/common/ReferenceTableAPI";
import { REFERENCE_TYPES, ReferencePublicationSpec } from "app/common/ReferenceTables";

import { Computed, Disposable, dom, input, Observable, styled } from "grainjs";
import isEqual from "lodash/isEqual";
const t = makeT("ReferenceTablesSettings");
/** Owner-only management of explicit publications and destination authorizations. */
export class ReferenceTablesSettings extends Disposable {
  private _api = new ReferenceTableAPI(this._doc.docApi);
  private _publications = Observable.create<PublishedReference[]>(this, []);
  private _available = Observable.create<ReferenceAuthorization[]>(this, []);
  private _subscriptions = Observable.create<ReferenceSubscriptionInfo[]>(this, []);
  private _busy = Observable.create(this, false);
  constructor(private _doc: GristDoc) {
    super();
    void this._refresh().catch(reportError);
    const timer = setInterval(() => void this._refresh().catch(reportError), 15_000);
    this.onDispose(() => clearInterval(timer));
  }

  public buildDom() {
    return SectionCard(t("Shared reference tables"), [cssBody(
      dom("p",
        t(
          "Publish selected data or connect read-only tables from another document. Formulas update automatically.",
        )),
      dom("p", t(
        "Published data follows destination permissions. Revoking access keeps the last synchronized copy.",
      )),
      primaryButton(t("Publish tables"), dom.on("click", () => this._publish()), dom.prop("disabled", this._busy)),
      primaryButton(t("Connect with a link"),
        dom.on("click", () => connectReferenceWithLink(this._api, () => this._refresh())),
        dom.prop("disabled", this._busy)),
      basicButton(t("Reference audit"), dom.on("click", () => void this._audit().catch(reportError))),
      dom("h4", t("Publications")),
      dom.forEach(this._publications, pub => cssRow(
        dom("strong", pub.spec.name), dom("span", t("Contract version"), ": ", String(pub.contractVersion)),
        pub.paused ? t("Paused") : t("Active"),
        basicButton(pub.paused ? t("Resume") : t("Pause"),
          dom.on("click", () => this._run(() => this._api.pause(pub.id, !pub.paused)))),
        basicButton(t("Edit publication"), dom.on("click", () => this._publish(pub))),
        basicButton(t("Connection links"), dom.on("click", () => void this._links(pub).catch(reportError))),
        basicButton(t("Connected documents"), dom.on("click", () => void this._consumers(pub).catch(reportError))),
      )),
      dom("h4", t("Available references")),
      dom.forEach(this._available, ref => cssRow(dom("strong", ref.name),
        basicButton(t("Connect"), dom.prop("disabled", use => use(this._busy) || ref.paused ||
          use(this._subscriptions).some(s => s.id === ref.authorizationId && s.status !== "AUTHORIZED")),
        dom.on("click", () => void this._connect(ref).catch(reportError))),
      )),
      dom("h4", t("Connected references")),
      dom.forEach(this._subscriptions, sub => sub.status === "AUTHORIZED" && !sub.connectedAt ? null : cssEntry(
        dom("strong", this._available.get().find(a => a.id === sub.publicationId)?.name || t("Reference")),
        dom("div", referenceStatusLabel(sub.status), { role: "status" }),
        dom("div", t("Synchronization mode"), ": ", this._modeLabel(sub.syncMode)),
        sub.syncMode === "scheduled" && sub.nextSyncAt ? dom("div", t("Next synchronization"), ": ",
          new Date(sub.nextSyncAt).toLocaleString()) : null,
        sub.appliedAt ?
          dom("div", t("Last synchronization"), ": ", new Date(sub.appliedAt).toLocaleString()) : null,
        sub.sourcePaused ? dom("div", t("Paused by the source")) : null,
        sub.error === "ALIAS_CONFLICT" ? cssEntry(
          dom("p", t("A local table already uses this name. Choose another name to finish connecting.")),
          basicButton(t("Change local table names"),
            dom.on("click", () => void this._repairAliases(sub).catch(reportError)))) : null,
        sub.status === "SCHEMA_BLOCKED" ? dom("p", t(
          "If a published column was deleted, its owner must update the publication before previewing.")) : null,
        sub.status === "RETRYING" && sub.error !== "ALIAS_CONFLICT" ? dom("p", t(
          "Synchronization failed. Grist will retry; you can also reconcile now.")) : null,
        sub.status === "ACCESS_REVOKED" ? dom("p", t(
          "Ask the source owner to reauthorize this document. Your local data remains available.")) : null,
        sub.status === "AUTHORIZED" ? dom("div", t("Awaiting your acceptance after reauthorization")) : null,
        dom("div", t("Accepted version"), ": ", String(sub.acceptedContractVersion || 0),
          " · ", t("Applied version"), ": ", String(sub.appliedContractVersion || 0)),
        this._contractChanged(sub) ? basicButton(t("Review publication changes"),
          dom.prop("disabled", sub.sourcePaused || sub.destinationPaused),
          dom.on("click", () => void this._reviewContract(sub).catch(reportError))) : null,
        cssRow(
          basicButton(t("Synchronization mode"), dom.prop("disabled", sub.revoked || sub.status === "DETACHED" ||
          sub.status === "AUTHORIZED"),
          dom.on("click", () => this._syncSettings(sub))),
          basicButton(t("Preview synchronization"),
            dom.prop("disabled", sub.revoked || sub.status === "DETACHED" || sub.status === "AUTHORIZED" ||
            sub.sourcePaused || sub.destinationPaused || this._contractChanged(sub)),
            dom.on("click", () => void this._updatePreview(sub).catch(reportError))),
          basicButton(sub.destinationPaused ? t("Resume synchronization") : t("Pause synchronization"),
            dom.prop("disabled", sub.revoked || sub.status === "DETACHED"),
            dom.on("click", () => this._run(() => this._api.pauseSubscription(sub.id, !sub.destinationPaused)))),
          basicButton(t("Reconcile"),
            dom.prop("disabled", sub.revoked || sub.status === "DETACHED" || sub.status === "AUTHORIZED" ||
            sub.sourcePaused || sub.destinationPaused || this._contractChanged(sub)),
            dom.on("click", () => this._run(() => this._api.reconcile(sub.id)))),
          basicButton(t("Detach"), dom.prop("disabled", sub.status === "DETACHED"), dom.on("click", () => {
            confirmModal(t("Detach this reference?"), t("Detach"), () => this._run(() => this._api.detach(sub.id)), {
              explanation: t("The tables will become editable local copies and will no longer synchronize."),
            });
          })),
        ),
      )),
      basicButton(t("Refresh"), dom.on("click", () => this._run(() => this._refresh()))),
    )]);
  }

  private _syncSettings(sub: ReferenceSubscriptionInfo) {
    saveModal((_ctl, owner) => {
      const mode = Observable.create(owner, sub.syncMode || "live");
      const minutes = Observable.create(owner, String(sub.syncIntervalMinutes || 60));
      return {
        title: t("Synchronization mode"),
        body: cssBody(dom("select", { "aria-label": t("Synchronization mode") },
          ["live", "manual", "scheduled"].map(value => dom("option", { value },
            this._modeLabel(value as ReferenceSubscriptionInfo["syncMode"]))),
          dom.prop("value", mode), dom.on("change", (_ev,
            el) => mode.set(el.value as "live" | "manual" | "scheduled"))),
        dom.domComputed(mode, value => value === "scheduled" ? dom("label", t("Interval in minutes"),
          input(minutes, {}, { type: "number", min: "1", max: "43200" })) : null),
        dom("p", t(
          "Manual updates run on request; scheduled updates follow the interval, with about 15 seconds tolerance.",
        ))),
        saveFunc: async () => {
          await this._api.syncSettings(sub.id, { syncMode: mode.get(), syncIntervalMinutes: Number(minutes.get()) });
          await this._refresh();
        },
      };
    });
  }

  private _modeLabel(mode: ReferenceSubscriptionInfo["syncMode"]) {
    return mode === "manual" ? t("Manual") : mode === "scheduled" ? t("Scheduled") : t("Live");
  }

  private async _updatePreview(sub: ReferenceSubscriptionInfo) {
    const preview = await this._api.updatePreview(sub.id);
    saveModal((_ctl, owner) => {
      const accepted = Observable.create(owner, false);
      return {
        title: t("Preview synchronization"),
        body: cssBody(
          dom("p", t("Source revision"), ": ", String(preview.revision), " · ",
            t("Expires"), ": ", new Date(preview.expiresAt).toLocaleString()),
          dom("p", t(
            "Applies this snapshot. Later source edits wait for the next update; local edits invalidate the preview.",
          )),
          preview.tables.map(table => cssEntry(dom("strong", table.tableId),
            dom("div", t("Added"), ": ", String(table.added), " · ", t("Modified"), ": ", String(table.updated),
              " · ", t("Removed"), ": ", String(table.removed)),
            dom("details", dom("summary", t("Row samples (up to 20 per table)")),
              table.samples.map(row => dom("pre", { style: "white-space:pre-wrap;overflow-wrap:anywhere" },
                JSON.stringify({ before: row.before, after: row.after }, null, 2)))))),
          dom("h4", t("Formula simulation")),
          dom("p", t("Changed cells"), ": ", String(preview.formulas.changed), " · ",
            t("New errors"), ": ", String(preview.formulas.newErrors)),
          dom("p", t(
            "Simulation is isolated. Volatile formulas and user context may differ; external requests are not sent.",
          )),
          preview.formulas.externalRequests ? dom("p", t("External results are pending in this simulation.")) : null,
          dom("details", dom("summary", t("Formula samples (up to 100 cells)")),
            preview.formulas.samples.map(cell => dom("pre", { style: "white-space:pre-wrap;overflow-wrap:anywhere" },
              `${cell.tableId}.${cell.colId}[${cell.rowId}]: ${JSON.stringify(cell.before)} → ${JSON.stringify(cell.after)}`))),
          preview.schema.length ? cssEntry(dom("h4", t("Incompatible structure changes")),
            preview.schema.map(change => dom("p",
              `${change.tableId}.${change.column}: ${change.before} → ${change.after || t("Removed")}`)),
            dom("p", t(
              "Removed columns lose their values. Review errors before applying, or cancel and detach the copy.",
            )),
            dom("label", dom("input", { type: "checkbox" }, dom.prop("checked", accepted),
              dom.on("change", (_ev, el) => accepted.set(el.checked))), t("I accept these structure changes"))) : null,
        ),
        saveLabel: t("Apply reviewed snapshot"),
        saveDisabled: Computed.create(owner, use => Boolean(preview.schema.length) && !use(accepted)),
        saveFunc: async () => {
          try {
            await this._api.applyPreview(sub.id, preview.token, accepted.get());
            await this._refresh();
          } catch (e) {
            if (String(e.message).includes("PREVIEW_STALE")) {
              throw new Error(t("Preview expired or document changed. Close this dialog and create a new preview."));
            }
            throw e;
          }
        },
      };
    });
  }

  private _auditOperation(operation: string): string {
    const labels: Record<string, string> = {
      "publication.create": t("Publication created"),
      "publication.update": t("Publication updated"),
      "publication.bulk_revoke": t("Consumers revoked"),
      "subscription.authorize": t("Document authorized"),
      "subscription.connect": t("Document connected"),
      "subscription.revoke": t("Access revoked"),
      "subscription.reauthorize": t("Document reauthorized"),
      "subscription.activate": t("Connection reactivated"),
      "subscription.source_pause": t("Source synchronization control changed"),
      "subscription.destination_pause": t("Destination synchronization control changed"),
      "subscription.accept_contract": t("Publication changes accepted"),
      "subscription.repair_aliases": t("Local table names repaired"),
      "subscription.sync_settings": t("Synchronization mode changed"),
      "subscription.synchronized": t("Snapshot synchronized"),
      "subscription.apply_preview": t("Reviewed snapshot applied"),
      "link.create": t("Connection link created"),
      "link.update": t("Connection link updated"),
      "link.disable": t("Connection link disabled"),
    };
    if (operation.endsWith("/reconcile")) { return t("Manual synchronization requested"); }
    if (operation.endsWith("/detach") || operation === "subscription.detach" ||
      operation === "subscription.detach_mirror") { return t("Local copy detached"); }
    return labels[operation] || t("Reference operation");
  }

  private async _audit(cursor = "") {
    const page = await this._api.audit(cursor);
    saveModal(ctl => ({
      title: t("Reference audit"),
      body: cssBody(dom("p", t(
        "Owner-only history starts with this version. Row values and link secrets are not recorded.",
      )),
      page.events.length ? page.events.map(event => cssEntry(
        dom("strong", this._auditOperation(event.operation)),
        dom("div", new Date(event.createdAt).toLocaleString(), " · ",
          t("Actor ID"), ": ", String(event.actorId ?? "—")),
        dom("details", dom("summary", t("Details")),
          dom("pre", { style: "white-space:pre-wrap;overflow-wrap:anywhere" }, JSON.stringify(event.details,
            null, 2))))) :
        dom("p", t("No events")),
      page.nextCursor ? basicButton(t("Older events"), dom.on("click", () => {
        ctl.close(); void this._audit(page.nextCursor!).catch(reportError);
      })) : null),
      saveLabel: t("Done"), saveFunc: async () => {},
    }));
  }

  private async _refresh() {
    const [pubs, refs, subs] = await Promise.all([
      this._api.publications(), this._api.available(), this._api.subscriptions(),
    ]);
    if (!this.isDisposed()) {
      if (!isEqual(this._publications.get(), pubs)) { this._publications.set(pubs); }
      if (!isEqual(this._available.get(), refs)) { this._available.set(refs); }
      if (!isEqual(this._subscriptions.get(), subs)) { this._subscriptions.set(subs); }
    }
  }

  private async _run(fn: () => Promise<unknown>) {
    this._busy.set(true);
    try {
      await fn();
      await this._refresh();
    } catch (e) {
      reportError(e);
    } finally {
      if (!this.isDisposed()) { this._busy.set(false); }
    }
  }

  private _publish(publication?: PublishedReference) {
    saveModal((_ctl, owner) => {
      const name = Observable.create(owner, publication?.spec.name || "");
      const description = Observable.create(owner, publication?.spec.description || "");
      const selections = this._doc.docModel.visibleTables.all()
        .filter(table => !table.referenceSource() && !table.summarySourceTable() && !table.onDemand())
        .map(table => ({ table, columns: table.columns().all()
          .filter(col => !col.isHiddenCol() && col.colId() !== "manualSort" &&
            REFERENCE_TYPES.has(col.type().split(":")[0]))
          .map(col => ({ col, checked: Observable.create(owner, Boolean(publication?.spec.tables
            .find(t => t.tableRef === table.id())?.colRefs.includes(col.id()))) })),
        filters: ReferenceFilterEditor.create(owner,
          table.columns().all().filter(c => !c.isHiddenCol() && c.colId() !== "manualSort" &&
            ["Text", "Choice", "Int", "Numeric", "Bool", "Date", "DateTime"].includes(c.type().split(":")[0]))
            .map(c => ({ id: c.id(), label: c.label(), type: c.type() })),
          publication?.spec.tables.find(t => t.tableRef === table.id())?.filters || []),
        })).filter(s => s.columns.length > 0);
      return {
        title: t("Publish tables"),
        body: cssBody(
          dom("label", t("Publication name"), input(name, {}, { placeholder: t("Publication name") })),
          dom("label", t("Description"), input(description, {})),
          dom("p", t("Select the columns to publish. Include target tables for every selected reference column.")),
          selections.map(s => dom("fieldset", dom("legend", s.table.tableNameDef()),
            s.columns.map(({ col, checked }) => dom("label",
              dom("input", { type: "checkbox" }, dom.prop("checked", checked),
                dom.on("change", (_ev, el) => checked.set(el.checked))), col.label(), " ")),
            s.filters.buildDom(),
          )),
        ),
        saveLabel: t("Publish"),
        saveDisabled: Computed.create(owner, use => !use(name).trim() ||
          !selections.some(s => s.columns.some(c => use(c.checked)))),
        saveFunc: async () => {
          const spec: ReferencePublicationSpec = { name: name.get(), description: description.get(), tables: [] };
          for (const s of selections) {
            const colRefs = s.columns.filter(c => c.checked.get()).map(c => c.col.id());
            if (!colRefs.length) { continue; }
            const filters = s.filters.read();
            spec.tables.push({ tableRef: s.table.id(), colRefs, filters });
          }
          if (publication) {
            await this._api.update(publication.id, spec, publication.contractVersion);
          } else { await this._api.publish(spec); }
          await this._refresh();
        },
      };
    });
  }

  private async _connect(ref: ReferenceAuthorization) {
    const preview = await this._api.preview(ref.authorizationId);
    if (this._subscriptions.get().find(s => s.id === ref.authorizationId)?.connectedAt) {
      confirmModal(t("Accept reauthorization"), t("Resume synchronization"),
        () => this._run(() => this._api.activate(ref.authorizationId, preview.contractVersion)), {
          explanation: cssBody(
            dom("p", t("Accepting resumes updates in the existing read-only tables and recalculates their formulas.")),
            ...preview.tables.map(table => dom("p", table.tableId, ": ", table.columns.join(", ")))),
        });
      return;
    }
    previewReferenceConnection(ref.name, preview, async (aliases) => {
      await this._api.subscribe(ref.authorizationId, aliases, preview.contractVersion);
      await this._refresh();
    });
  }

  private _contractChanged(sub: ReferenceSubscriptionInfo): boolean {
    return !sub.revoked && !["AUTHORIZED", "DETACHED"].includes(sub.status) &&
      Boolean(sub.contractVersion && sub.contractVersion !== sub.acceptedContractVersion);
  }

  private async _reviewContract(sub: ReferenceSubscriptionInfo) {
    const preview = await this._api.preview(sub.id);
    confirmModal(t("Review publication changes"), t("Accept new version"), async () => {
      await this._api.acceptContract(sub.id, preview.contractVersion);
      await this._refresh();
    }, {
      explanation: cssBody(
        dom("p", t("Accepted version"), ": ", String(sub.acceptedContractVersion || 0),
          " → ", t("Contract version"), ": ", String(preview.contractVersion)),
        dom("p", t(
          "Accepting applies the current published columns and row filters. Local formulas will recalculate.")),
        dom("p", t("Until you accept, the last synchronized data remains available without further updates.")),
        dom("p", t("Incompatible schema changes still require a new publication.")),
        preview.previousContractKnown ? null : dom("p",
          t("The previous contract is unavailable; review the current scope.")),
        ...(preview.changes || []).map(change => cssEntry(
          dom("strong", preview.tables.find(table => table.key === String(change.tableRef))?.tableId ||
          String(change.tableRef)),
          change.addedColumns.length ? dom("div", t("Added columns"), ": ",
            change.addedColumns.map(c => preview.columnLabels?.[c] || String(c)).join(", ")) : null,
          change.removedColumns.length ? dom("div", t("Removed columns"), ": ",
            change.removedColumns.map(c => preview.columnLabels?.[c] || String(c)).join(", ")) : null,
          change.filtersChanged ? dom("div",
            dom("div", t("Previous filters"), ": ",
              this._filterDescription(change.previousFilters, preview.columnLabels)),
            dom("div", t("New filters"), ": ", this._filterDescription(change.filters, preview.columnLabels))) : null)),
        ...preview.tables.map(table => cssEntry(
          dom("div", table.tableId, ` (${table.rowCount})`, ": ", table.columns.join(", ")),
          preview.previousContractKnown ? null : dom("div", t("New filters"), ": ", this._filterDescription(
            preview.contract?.tables.find(t => String(t.tableRef) === table.key)?.filters || [],
            preview.columnLabels))))),
    });
  }

  private _filterDescription(filters: import("app/common/ReferenceTables").ReferenceFilter[],
    labels: Record<string, string> = {}) {
    const operators = { in: "=", notIn: "≠", gt: ">", gte: "≥", lt: "<", lte: "≤" };
    return filters.length ? filters.map(f =>
      `${labels[f.colRef] || f.colRef} ${operators[f.op]} ${f.values.map(v => JSON.stringify(v)).join(", ")}`).join(" ∧ ") : t("All rows");
  }

  private async _revokeAll(pub: PublishedReference, linkId?: string) {
    const preview = await this._api.previewRevocation(pub.id, linkId);
    confirmModal(t("Revoke consumers"), t("Revoke"), async () => {
      await this._api.revokeConsumers(pub.id, preview.token, linkId);
      await this._refresh();
    }, { explanation: cssBody(
      dom("p", t("Consumers affected"), ": ", String(preview.count)),
      dom("p", t("Links to disable"), ": ", String(preview.linksToDisable)),
      dom("p", t("Revoking access stops updates. Data already copied into destination documents is retained."))) });
  }

  private async _repairAliases(sub: ReferenceSubscriptionInfo) {
    const preview = await this._api.preview(sub.id);
    previewReferenceConnection(t("Choose unused local table names"), preview, async (aliases) => {
      await this._api.repairAliases(sub.id, aliases);
      await this._refresh();
    });
  }

  private async _links(pub: PublishedReference) {
    const links = await this._api.connectionLinks(pub.id);
    saveModal((ctl) => {
      const disable = new Set<string>();
      return {
        title: t("Connection links") + " — " + pub.spec.name,
        body: cssBody(
          dom("p",
            t(
              "Anyone with a valid link can connect a document they own. Share links only with intended users.",
            )),
          primaryButton(t("Create connection link"), dom.on("click", () => { ctl.close(); this._createLink(pub); })),
          ...links.map(link => cssEntry(dom("strong", link.name),
            dom("div", link.disabled ? t("Disabled") : link.expiresAt && Date.parse(link.expiresAt) <= Date.now() ?
              t("Expired") : t("Active")),
            dom("div", t("Connections"), ": ", String(link.admissions),
              link.maxAdmissions ? ` / ${link.maxAdmissions}` : ""),
            link.expiresAt ? dom("div", t("Expires"), ": ", new Date(link.expiresAt).toLocaleString()) : null,
            cssRow(
              basicButton(t("Edit link"), dom.prop("disabled", link.disabled),
                dom.on("click", () => { ctl.close(); this._createLink(pub, link); })),
              basicButton(t("Revoke consumers of this link"), dom.on("click", () => {
                ctl.close(); void this._revokeAll(pub, link.id).catch(reportError);
              }))),
            dom("label", dom("input", { type: "checkbox", disabled: link.disabled },
              dom.on("change", (_ev, el) => el.checked ? disable.add(link.id) : disable.delete(link.id))),
            t("Disable link")))),
          dom("p", t("Disabling a link blocks new connections. Existing subscriptions keep synchronizing."))),
        saveFunc: async () => {
          for (const id of disable) { await this._api.disableConnectionLink(pub.id, id); }
          await this._refresh();
        },
      };
    });
  }

  private _createLink(pub: PublishedReference, link?: ReferenceConnectionLinkInfo) {
    saveModal((_ctl, owner) => {
      const name = Observable.create(owner, link?.name || pub.spec.name);
      const initialExpiry = link?.expiresAt ?
        new Date(Date.parse(link.expiresAt) - new Date(link.expiresAt).getTimezoneOffset() * 60_000)
          .toISOString().slice(0, 16) : "";
      const expires = Observable.create(owner, initialExpiry);
      const limit = Observable.create(owner, String(link?.maxAdmissions || 0));
      const orgs = Observable.create(owner, link?.allowedOrgIds.join(", ") || "");
      return {
        title: link ? t("Edit link") : t("Create connection link"),
        body: cssBody(dom("p", t("Restrictions affect new connections. Existing consumers keep their access.")),
          dom("label", t("Link name"), input(name, {})),
          dom("label", t("Expires (optional)"), input(expires, {}, { type: "datetime-local" })),
          dom("label", t("Maximum connections (0 = unlimited)"), input(limit, {}, { type: "number", min: "0" })),
          dom("label", t("Allowed site IDs (optional, comma separated)"), input(orgs, {})),
          dom("p",
            t(
              "A link only grants access to this publication. Other references in this document remain separate.",
            ))),
        saveLabel: link ? t("Save changes") : t("Create link"),
        saveFunc: async () => {
          const options = {
            name: name.get(), expiresAt: link && expires.get() === initialExpiry ? link.expiresAt :
              expires.get() ? new Date(expires.get()).toISOString() : "",
            maxAdmissions: Number(limit.get()),
            allowedOrgIds: orgs.get().trim() ? orgs.get().split(",").map(v => Number(v.trim())) : [],
          };
          if (link) {
            await this._api.updateConnectionLink(pub.id, link.id, options, link.settingsVersion);
            await this._refresh();
            return;
          }
          const result = await this._api.createConnectionLink(pub.id, options);
          setTimeout(() => saveModal(() => ({
            title: t("Connection link created"),
            body: cssBody(dom("p", t("Copy this link now. Its secret will not be shown again.")),
              dom("input", { "value": result.url, "readonly": true, "aria-label": t("Connection link") },
                dom.on("click", (_ev, el) => el.select())),
              primaryButton(t("Copy link"), dom.on("click", () => {
                void copyToClipboard(result.url).catch(reportError);
              }))),
            saveLabel: t("Done"), saveFunc: async () => {},
          })), 0);
        },
      };
    });
  }

  private async _consumers(pub: PublishedReference, offset = 0) {
    const page = await this._api.consumers(pub.id, offset);
    saveModal((ctl) => {
      const revoke = new Set<string>();
      return {
        title: t("Connected documents") + " — " + pub.spec.name,
        body: cssBody(dom("p", t("Connections"), ": ", String(page.total)),
          basicButton(t("Revoke all consumers"), dom.on("click", () => {
            ctl.close(); void this._revokeAll(pub).catch(reportError);
          })),
          ...page.consumers.map(sub => cssEntry(
            dom("strong", sub.destinationName),
            dom("div", sub.destinationOrgName, " · ", sub.destinationDocId),
            dom("div", referenceStatusLabel(sub.status)),
            dom("div", t("Contract version"), ": ", String(sub.contractVersion || 0),
              " · ", t("Accepted version"), ": ", String(sub.acceptedContractVersion || 0),
              " · ", t("Applied version"), ": ", String(sub.appliedContractVersion || 0)),
            sub.sourcePaused ? dom("div", t("Paused by the source")) : null,
            sub.destinationPaused ? dom("div", t("Paused by the destination")) : null,
            sub.status === "AUTHORIZED" && sub.connectedAt ? dom("div", t("Awaiting destination acceptance")) : null,
            cssRow(
              basicButton(sub.sourcePaused ? t("Resume this consumer") : t("Pause this consumer"),
                dom.prop("disabled", sub.revoked || sub.status === "DETACHED"),
                dom.on("click", () => void this._api.pauseConsumer(pub.id, sub.id, !sub.sourcePaused).then(() => {
                  ctl.close(); return this._consumers(pub, offset);
                }).catch(reportError))),
              sub.revoked && sub.status !== "DETACHED" ? basicButton(t("Reauthorize"), dom.on("click", () => {
                ctl.close();
                confirmModal(t("Reauthorize this consumer?"), t("Reauthorize"), async () => {
                  await this._api.reauthorizeConsumer(pub.id, sub.id);
                  await this._refresh();
                }, { explanation: t("The destination owner must accept before synchronization resumes.") });
              })) : null),
            sub.connectedAt ? dom("div", t("Connected on"), ": ", new Date(sub.connectedAt).toLocaleString()) : null,
            dom("div", t("Synchronization mode"), ": ", this._modeLabel(sub.syncMode)),
            sub.syncMode === "scheduled" && sub.nextSyncAt ? dom("div", t("Next synchronization"), ": ",
              new Date(sub.nextSyncAt).toLocaleString()) : null,
            sub.appliedAt ?
              dom("div", t("Last synchronization"), ": ", new Date(sub.appliedAt).toLocaleString()) : null,
            sub.checkedAt ? dom("div", t("Last check"), ": ", new Date(sub.checkedAt).toLocaleString()) : null,
            dom("label", dom("input", { type: "checkbox", disabled: sub.revoked || sub.status === "DETACHED" },
              dom.on("change", (_ev, el) => el.checked ? revoke.add(sub.id) : revoke.delete(sub.id))), t("Revoke")))),
          page.total > offset + page.consumers.length ? basicButton(t("Next page"),
            dom.on("click", () => { ctl.close(); void this._consumers(pub, offset + 50).catch(reportError); })) : null,
          offset > 0 ? basicButton(t("Previous page"), dom.on("click", () => {
            ctl.close(); void this._consumers(pub, Math.max(0, offset - 50)).catch(reportError);
          })) : null,
          dom("p", t("Revoking access stops updates. Data already copied into destination documents is retained."))),
        saveFunc: async () => {
          for (const id of revoke) { await this._api.revoke(pub.id, id); }
          await this._refresh();
        },
      };
    });
  }
}
const cssBody = styled("div", `
  display: flex; flex-direction: column; gap: 12px; padding: 16px;
  & input:not([type=checkbox]), & select { margin: 4px; padding: 6px; max-width: 100%; }
  & fieldset { border: 1px solid ${theme.tableBodyBorder}; padding: 12px; }
`);
const cssRow = styled("div", `display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`);
const cssEntry = styled("div", `display: flex; flex-direction: column; gap: 6px; padding: 8px 0;`);
