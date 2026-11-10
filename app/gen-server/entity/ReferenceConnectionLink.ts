import { BaseEntity, Column, Entity, Index, PrimaryColumn } from "typeorm";

/** An admission capability. Established subscriptions never need the link secret again. */
@Entity({ name: "reference_connection_links" })
export class ReferenceConnectionLink extends BaseEntity {
  @Column({ name: "settings_version", type: Number, default: 1 }) public settingsVersion: number;
  @PrimaryColumn({ type: String }) public id: string;
  @Index("reference_connection_links_publication")
  @Column({ name: "publication_id", type: String }) public publicationId: string;

  @Column({ type: String }) public name: string;
  @Column({ name: "secret_hash", type: String, select: false }) public secretHash: string;
  @Column({ name: "created_at", type: String }) public createdAt: string;
  @Column({ name: "created_by", type: Number }) public createdBy: number;
  @Column({ name: "expires_at", type: String, default: "" }) public expiresAt: string;
  @Column({ type: Boolean, default: false }) public disabled: boolean;
  @Column({ name: "allowed_org_ids", type: "simple-json" }) public allowedOrgIds: number[];
  @Column({ name: "max_admissions", type: Number, default: 0 }) public maxAdmissions: number;
  @Column({ type: Number, default: 0 }) public admissions: number;
}
