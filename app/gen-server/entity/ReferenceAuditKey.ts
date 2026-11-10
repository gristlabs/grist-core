import { BaseEntity, Column, Entity, PrimaryColumn } from "typeorm";

/** Server-only signing key. Never copied into documents or exposed through document APIs. */
@Entity({ name: "reference_audit_keys" })
export class ReferenceAuditKey extends BaseEntity {
  @PrimaryColumn({ type: Number }) public id: number;
  @Column({ type: String, select: false }) public secret: string;
}
