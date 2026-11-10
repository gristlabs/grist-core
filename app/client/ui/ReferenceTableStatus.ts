import { GristDoc } from "app/client/components/GristDoc";
import { makeT } from "app/client/lib/localization";
import { ReferenceSubscriptionInfo, ReferenceTableAPI } from "app/common/ReferenceTableAPI";

import { Disposable, dom, Observable, styled } from "grainjs";

const t = makeT("ReferenceTableStatus");
const models = new WeakMap<GristDoc, ReferenceStatuses>();

// Share one status request per document, even when several widgets display the same mirror.
class ReferenceStatuses extends Disposable {
  public statuses = Observable.create<Pick<ReferenceSubscriptionInfo, "id" | "status" | "appliedAt">[]>(this, []);
  private _api: ReferenceTableAPI;
  constructor(doc: GristDoc) {
    super();
    this._api = new ReferenceTableAPI(doc.docApi);
    void this._refresh();
    const timer = setInterval(() => void this._refresh(), 15_000);
    this.onDispose(() => clearInterval(timer));
  }

  private async _refresh() {
    try {
      const statuses = await this._api.status();
      if (!this.isDisposed()) { this.statuses.set(statuses); }
    } catch {
      if (!this.isDisposed()) {
        this.statuses.set(this.statuses.get().map(s => ({ ...s, status: "RETRYING" })));
      }
    }
  }
}

export function referenceTableStatus(doc: GristDoc, id: string) {
  let model = models.get(doc);
  if (!model) {
    model = ReferenceStatuses.create(doc, doc);
    models.set(doc, model);
  }
  return cssStatus({ role: "status" }, dom.text((use) => {
    const sub = use(model.statuses).find(s => s.id === id);
    return t("Read only") + " · " + referenceStatusLabel(sub?.status || "REAUTH_REQUIRED");
  }));
}

export function referenceStatusLabel(status: ReferenceSubscriptionInfo["status"]): string {
  switch (status) {
    case "AUTHORIZED": return t("Available");
    case "INITIALIZING": return t("Initializing");
    case "WAITING": return t("Local snapshot — updates on request or schedule");
    case "UP_TO_DATE": return t("Up to date");
    case "PAUSED": return t("Paused — local data retained");
    case "ACCESS_REVOKED": return t("Access revoked — local data retained");
    case "CONTRACT_CHANGED": return t("Publication changed — acceptance required");
    case "SCHEMA_BLOCKED": return t("Source schema changed — review required");
    case "REAUTH_REQUIRED": return t("New authorization required");
    case "DETACHED": return t("Detached — local copy");
    case "RETRYING": return t("Synchronization interrupted — retrying automatically");
  }
}

const cssStatus = styled("span", `font-size: 11px; padding: 0 8px; white-space: nowrap;`);
