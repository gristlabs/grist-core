import { ReferenceConnectionLink } from "app/gen-server/entity/ReferenceConnectionLink";
import { ReferencePublication } from "app/gen-server/entity/ReferencePublication";
import { ReferenceSubscription } from "app/gen-server/entity/ReferenceSubscription";

/** Explicit allowlist: never include capabilities, row values, filters, aliases or raw request bodies. */
export interface ReferenceAuditState {
  publication_id: string;
  sync_mode?: string;
  sync_interval_minutes?: number;
  subscription_id?: string;
  source_document_id?: string;
  destination_document_id?: string;
  connection_link_id?: string;
  contract_version?: number;
  accepted_contract_version?: number;
  applied_contract_version?: number;
  authorization_version?: number;
  status?: string;
  revoked?: boolean;
  paused?: boolean;
  disabled?: boolean;
  expires_at?: string;
  allowed_org_ids?: number[];
  max_admissions?: number;
  admissions?: number;
  source_paused?: boolean;
  destination_paused?: boolean;
}
export function referenceAuditState(entity: ReferencePublication | ReferenceSubscription | ReferenceConnectionLink):
ReferenceAuditState {
  if (entity instanceof ReferenceConnectionLink) {
    return { publication_id: entity.publicationId, connection_link_id: entity.id,
      disabled: entity.disabled, expires_at: entity.expiresAt, allowed_org_ids: [...entity.allowedOrgIds],
      max_admissions: entity.maxAdmissions, admissions: entity.admissions };
  }
  if (entity instanceof ReferencePublication) {
    return { publication_id: entity.id, source_document_id: entity.sourceDocId,
      contract_version: entity.contractVersion, paused: entity.paused };
  }
  return { sync_mode: entity.syncMode, sync_interval_minutes: entity.syncIntervalMinutes,
    publication_id: entity.publicationId, subscription_id: entity.id,
    destination_document_id: entity.destinationDocId, connection_link_id: entity.connectionLinkId || undefined,
    accepted_contract_version: entity.acceptedContractVersion, applied_contract_version: entity.appliedContractVersion,
    authorization_version: entity.authorizationVersion, status: entity.status, revoked: entity.revoked,
    source_paused: entity.sourcePaused, destination_paused: entity.destinationPaused };
}
