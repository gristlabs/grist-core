import { Document } from "app/gen-server/entity/Document";
import { User } from "app/gen-server/entity/User";
import { nativeValues } from "app/gen-server/lib/values";

import { BaseEntity, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";

import type { SyncStatus } from "app/common/ActiveDocAPI";

export interface SyncHomeConfig {
  /** The source tableIds whose fetch the sync's owner authorized */
  authorizedTableIds: string[];
}

/**
 * The home database's record of a sync into a document.
 *
 * Authorizes the access between documents as a specific user and mirrors any document sync state
 * that needs to be accessible without waking up all downstream documents.
 *
 * Syncs are uniquely identified by the (dest_doc_id, sync_id) pair. A sync_id is only unique within a document due to
 * doc copying.
 *
 * Authorization fields (e.g. ownerId) should only be modified via endpoints that apply the right authorization, never
 * mirrored from the document.
 */
@Entity({ name: "syncs" })
export class Sync extends BaseEntity {
  /**
   * A simple integer auto-incrementing identifier for a sync.
   * Suitable for use in within-database references.
   */
  @PrimaryColumn({ name: "id", type: Number })
  public id: number;

  /**
   * The sync's identifier, used to connect this sync with the destination document that owns it.
   * Not a secret, and unique only within that doc:
   * globally, the sync is uniquely identified by its (destDocId, syncId) pair.
   */
  @Column({ name: "sync_id", type: String })
  public syncId: string;

  /**
   * The document which owns this sync and to which data is written.
   */
  @Column({ name: "dest_doc_id", type: String })
  public destDocId: string;

  @ManyToOne(_type => Document, { onDelete: "CASCADE" })
  @JoinColumn({ name: "dest_doc_id" })
  public destDoc: Document;

  /**
   * The document the sync reads from. A missing value prevents the sync running.
   */
  @Column({ name: "source_doc_id", type: String, nullable: true })
  public sourceDocId: string | null;

  @ManyToOne(_type => Document, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "source_doc_id" })
  public sourceDoc: Document | null;

  /**
   * The user whose access to the source document the sync reads with. A missing value prevents the sync running.
   */
  @Column({ name: "owner_id", type: Number, nullable: true })
  public ownerId: number | null;

  @ManyToOne(_type => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "owner_id" })
  public owner: User | null;

  /**
   * Configuration for the sync that's only in the HomeDB, and therefore immune to document
   * changes (editing, replace, snapshot restore, etc).
   */
  @Column({ name: "options", type: nativeValues.jsonEntityType, nullable: true })
  public options: SyncHomeConfig | null;

  /**
   * The destination document's view of how the sync's runs have gone, mirrored here.
   */
  @Column({ name: "status", type: nativeValues.jsonEntityType, nullable: true })
  public status: SyncStatus | null;
}
