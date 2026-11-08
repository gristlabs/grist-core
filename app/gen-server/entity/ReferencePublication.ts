import { ReferencePublicationSpec } from "app/common/ReferenceTables";

import { BaseEntity, Column, Entity, PrimaryColumn } from "typeorm";
@Entity({ name: "reference_publications" })
export class ReferencePublication extends BaseEntity {
  @PrimaryColumn({ type: String }) public id: string;
  @Column({ name: "source_doc_id", type: String }) public sourceDocId: string;
  @Column({ name: "source_org_id", type: Number }) public sourceOrgId: number;
  @Column({ name: "contract_version", type: Number, default: 1 }) public contractVersion: number;
  @Column({ type: "simple-json" }) public spec: ReferencePublicationSpec;
  @Column({ type: "simple-json" }) public columnEpochs: Record<string, string>;
  @Column({ type: "simple-json" }) public identities: Record<string, string>;
  @Column({ type: String }) public generation: string;
  @Column({ type: Boolean, default: false }) public paused: boolean;
}
