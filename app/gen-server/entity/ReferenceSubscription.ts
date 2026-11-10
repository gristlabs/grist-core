import { ReferenceSyncMode } from "app/common/ReferenceSynchronization";
import { ReferencePublicationSpec, ReferenceStatus } from "app/common/ReferenceTables";

import { BaseEntity, Column, Entity, Index, PrimaryColumn } from "typeorm";
@Entity({ name: "reference_subscriptions" })
@Index("reference_subscription_destination", ["publicationId", "destinationDocId"], { unique: true })
export class ReferenceSubscription extends BaseEntity {
  @Column({ name: "sync_mode", type: String, default: "live" }) public syncMode: ReferenceSyncMode;
  @Column({ name: "sync_interval_minutes", type: Number, default: 60 }) public syncIntervalMinutes: number;
  @Column({ name: "next_sync_at", type: String, default: "" }) public nextSyncAt: string;
  @Column({ name: "accepted_contract", type: "simple-json", nullable: true })
  public acceptedContract: ReferencePublicationSpec | null;

  @PrimaryColumn({ type: String }) public id: string;
  @Column({ name: "publication_id", type: String }) public publicationId: string;
  @Column({ name: "destination_doc_id", type: String }) public destinationDocId: string;
  @Column({ name: "destination_org_id", type: Number }) public destinationOrgId: number;
  @Column({ name: "connection_link_id", type: String, default: "" }) public connectionLinkId: string;
  @Column({ name: "connected_at", type: String, default: "" }) public connectedAt: string;
  @Column({ name: "checked_at", type: String, default: "" }) public checkedAt: string;
  @Column({ name: "accepted_contract_version", type: Number, default: 0 }) public acceptedContractVersion: number;
  @Column({ name: "applied_contract_version", type: Number, default: 0 }) public appliedContractVersion: number;
  @Column({ type: String }) public status: ReferenceStatus | "AUTHORIZED";
  @Column({ type: "simple-json" }) public aliases: Record<string, string>;
  @Column({ type: Boolean, default: false }) public revoked: boolean;
  @Column({ name: "source_paused", type: Boolean, default: false }) public sourcePaused: boolean;
  @Column({ name: "destination_paused", type: Boolean, default: false }) public destinationPaused: boolean;
  @Column({ name: "authorization_version", type: Number, default: 0 }) public authorizationVersion: number;
  @Column({ name: "applied_at", type: String, default: "" }) public appliedAt: string;
  @Column({ type: String, default: "" }) public error: string;
}
