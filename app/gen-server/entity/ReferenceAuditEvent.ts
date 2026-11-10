import { BaseEntity, Column, Entity, PrimaryColumn } from "typeorm";
@Entity({ name: "reference_audit_events" })
export class ReferenceAuditEvent extends BaseEntity {
  @PrimaryColumn({ type: String }) public id: string;
  @Column({ name: "document_id", type: String }) public documentId: string;
  @Column({ name: "created_at", type: String }) public createdAt: string;
  @Column({ name: "actor_id", type: Number, nullable: true }) public actorId: number | null;
  @Column({ type: String }) public operation: string;
  @Column({ type: "simple-json" }) public details: Record<string, unknown>;
}
