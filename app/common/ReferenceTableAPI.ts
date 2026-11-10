import { BaseAPI } from "app/common/BaseAPI";
import { ReferenceContractChange, ReferenceRevocationPreview } from "app/common/ReferenceManagement";
import { ReferenceSyncSettings, ReferenceUpdatePreview } from "app/common/ReferenceSynchronization";
import { ReferencePublicationSpec, ReferenceStatus } from "app/common/ReferenceTables";
import { DocAPI } from "app/common/UserAPI";
export interface PublishedReference {
  id: string;
  spec: ReferencePublicationSpec;
  contractVersion: number;
  paused: boolean;
}
export interface ReferenceAuthorization {
  id: string;
  name: string;
  authorizationId: string;
  paused: boolean;
}
export interface ReferenceSubscriptionInfo {
  syncMode?: ReferenceSyncSettings["syncMode"];
  syncIntervalMinutes?: number;
  nextSyncAt?: string;
  id: string;
  publicationId: string;
  destinationDocId: string;
  status: ReferenceStatus | "AUTHORIZED";
  revoked: boolean;
  contractVersion?: number;
  acceptedContractVersion?: number;
  appliedContractVersion?: number;
  sourcePaused?: boolean;
  destinationPaused?: boolean;
  appliedAt: string;
  checkedAt?: string;
  connectedAt?: string;
  connectionLinkId?: string;
  error: string;
}
export interface ReferencePreview {
  contract?: ReferencePublicationSpec;
  contractVersion: number;
  changes?: ReferenceContractChange[];
  previousContractKnown?: boolean;
  columnLabels?: Record<string, string>;
  tables: { key: string; tableId: string; columns: string[]; rowCount: number }[];
}
export interface ReferenceConnectionLinkInfo {
  settingsVersion: number;
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string;
  disabled: boolean;
  allowedOrgIds: number[];
  maxAdmissions: number;
  admissions: number;
}
export interface ReferenceLinkOptions {
  name: string;
  expiresAt?: string;
  allowedOrgIds?: number[];
  maxAdmissions?: number;
}
export interface ReferenceConnectionPreview extends ReferencePreview {
  name: string;
  description: string;
}
export interface ReferenceConsumer extends ReferenceSubscriptionInfo {
  destinationName: string;
  destinationOrgName: string;
}
export interface ReferenceConsumerPage {
  consumers: ReferenceConsumer[];
  total: number;
}
export interface ReferenceAuditPage {
  events: { id: string; createdAt: string; actorId: number | null; operation: string;
    details: Record<string, unknown> }[];
  nextCursor: string | null;
}
/** Shares authentication, org routing and view-as parameters with the document API. */
export class ReferenceTableAPI extends BaseAPI {
  constructor(private _doc: DocAPI) { super(_doc.options); }
  public status(): Promise<Pick<ReferenceSubscriptionInfo, "id" | "status" | "appliedAt">[]> {
    return this._call("reference-status");
  }

  public publications(): Promise<PublishedReference[]> { return this._call("reference-publications"); }
  public publish(spec: ReferencePublicationSpec): Promise<PublishedReference> {
    return this._call("reference-publications", "POST", spec);
  }

  public async update(id: string, spec: ReferencePublicationSpec, contractVersion?: number):
  Promise<PublishedReference> {
    contractVersion ??= (await this.publications()).find(p => p.id === id)?.contractVersion;
    return this._call(`reference-publications/${id}`, "PATCH", { spec, contractVersion });
  }

  public pause(id: string, paused: boolean): Promise<PublishedReference> {
    return this._call(`reference-publications/${id}`, "PATCH", { paused });
  }

  public grants(id: string): Promise<ReferenceSubscriptionInfo[]> {
    return this._call(`reference-publications/${id}/grants`);
  }

  public grant(id: string, destinationDocId: string): Promise<unknown> {
    return this._call(`reference-publications/${id}/grants`, "POST", { destinationDocId });
  }

  public revoke(id: string, grantId: string): Promise<unknown> {
    return this._call(`reference-publications/${id}/grants/${grantId}`, "DELETE");
  }

  public connectionLinks(id: string): Promise<ReferenceConnectionLinkInfo[]> {
    return this._call(`reference-publications/${id}/connection-links`);
  }

  public createConnectionLink(id: string, options: ReferenceLinkOptions):
  Promise<ReferenceConnectionLinkInfo & { url: string }> {
    return this._call(`reference-publications/${id}/connection-links`, "POST", options);
  }

  public disableConnectionLink(id: string, linkId: string): Promise<unknown> {
    return this._call(`reference-publications/${id}/connection-links/${linkId}`, "PATCH", { disabled: true });
  }

  public updateConnectionLink(id: string, linkId: string, options: ReferenceLinkOptions, settingsVersion: number):
  Promise<ReferenceConnectionLinkInfo> {
    return this._call(`reference-publications/${id}/connection-links/${linkId}`, "PATCH", { ...options, settingsVersion });
  }

  public previewRevocation(id: string, linkId?: string): Promise<ReferenceRevocationPreview> {
    return this._call(`reference-publications/${id}/revoke-preview${linkId ? `?linkId=${encodeURIComponent(linkId)}` : ""}`);
  }

  public revokeConsumers(id: string, token: string, linkId?: string): Promise<{ revoked: number }> {
    return this._call(`reference-publications/${id}/revoke-consumers`, "POST", { token, linkId });
  }

  public repairAliases(id: string, aliases: Record<string, string>): Promise<unknown> {
    return this._call(`reference-subscriptions/${id}/aliases`, "PATCH", { aliases });
  }

  public previewConnection(url: string): Promise<ReferenceConnectionPreview> {
    return this._call("reference-connections/preview", "POST", { url });
  }

  public async connect(url: string, aliases: Record<string, string>, contractVersion?: number):
  Promise<ReferenceSubscriptionInfo> {
    contractVersion ??= (await this.previewConnection(url)).contractVersion;
    return this._call("reference-connections", "POST", { url, aliases, contractVersion });
  }

  public consumers(id: string, offset = 0): Promise<ReferenceConsumerPage> {
    return this._call(`reference-publications/${id}/consumers?offset=${offset}`);
  }

  public pauseConsumer(id: string, subscriptionId: string, paused: boolean): Promise<unknown> {
    return this._call(`reference-publications/${id}/consumers/${subscriptionId}`, "PATCH", { paused });
  }

  public reauthorizeConsumer(id: string, subscriptionId: string): Promise<unknown> {
    return this._call(`reference-publications/${id}/consumers/${subscriptionId}/reauthorize`, "POST");
  }

  public pauseSubscription(id: string, paused: boolean): Promise<unknown> {
    return this._call(`reference-subscriptions/${id}`, "PATCH", { paused });
  }

  public activate(id: string, contractVersion: number): Promise<unknown> {
    return this._call(`reference-subscriptions/${id}/activate`, "POST", { contractVersion });
  }

  public acceptContract(id: string, contractVersion: number): Promise<unknown> {
    return this._call(`reference-subscriptions/${id}/accept-contract`, "POST", { contractVersion });
  }

  public available(): Promise<ReferenceAuthorization[]> { return this._call("available-references"); }
  public subscriptions(): Promise<ReferenceSubscriptionInfo[]> { return this._call("reference-subscriptions"); }
  public preview(id: string): Promise<ReferencePreview> { return this._call(`reference-subscriptions/${id}/preview`); }
  public async subscribe(authorizationId: string, aliases: Record<string, string>, contractVersion?: number):
  Promise<ReferenceSubscriptionInfo> {
    contractVersion ??= (await this.preview(authorizationId)).contractVersion;
    return this._call("reference-subscriptions", "POST", { authorizationId, aliases, contractVersion });
  }

  public syncSettings(id: string, settings: ReferenceSyncSettings): Promise<ReferenceSubscriptionInfo> {
    return this._call(`reference-subscriptions/${id}/sync-settings`, "PATCH", settings);
  }

  public updatePreview(id: string): Promise<ReferenceUpdatePreview> {
    return this._call(`reference-subscriptions/${id}/update-preview`, "POST");
  }

  public applyPreview(id: string, token: string, acceptSchema = false): Promise<ReferenceSubscriptionInfo> {
    return this._call(`reference-subscriptions/${id}/apply-preview`, "POST", { token, acceptSchema });
  }

  public audit(cursor = ""): Promise<ReferenceAuditPage> {
    return this._call(`reference-audit${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
  }

  public reconcile(id: string): Promise<unknown> {
    return this._call(`reference-subscriptions/${id}/reconcile`, "POST");
  }

  public detach(id: string): Promise<unknown> { return this._call(`reference-subscriptions/${id}/detach`, "POST"); }
  private _call(path: string, method = "GET", body?: unknown): Promise<any> {
    return this.requestJson(`${this._doc.getBaseUrl()}/${path}`, { method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
}
