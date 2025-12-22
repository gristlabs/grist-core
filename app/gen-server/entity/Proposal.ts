import { ProposalComparison, ProposalStatus } from 'app/common/UserAPI';
import { Document } from 'app/gen-server/entity/Document';
import { nativeValues } from 'app/gen-server/lib/values';
import { BaseEntity, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

/**
 *
 * A table for tracking proposed changes to documents.
 *
 * For a "githubby" feal, proposals are identified with a document and a
 * short incrementing integer that is unique for that document, like the PR
 * number associated with repositories.
 *
 * The "comparison" column contains changes in the format used by the
 * /compare endpoint. This could be tweaked in future. That format represents
 * an overall diff, but doesn't give details of individual steps.
 *
 * The "comparison" column shouldn't be allowed to get too big, ideally.
 * Any large changes should be externalized - either computed on demand,
 * or placed in an S3-like store.
 *
 * Each proposal has a source and destination document. They are assumed to
 * share a common ancestor. The source contains the proposed changes.
 * Users of the destination document will be offered those changes, and there
 * should be a way to merge them into the destination document.
 *
 * Currently, only a single proposal is permitted between a given
 * source/destination pair. This should perhaps be relaxed, to be
 * future proof, although the UI would be likely to still be
 * constrained in this way for now.
 *
 * The 'status' of the proposal is a bit simplistic for now. Here are some
 * states of proposals:
 *   - dismissed
 *   - retracted
 *   - applied
 * If this feature were to grow, probably status would need to be events
 * in a full timeline, but it doesn't make sense to invest in that now, and
 * some kind of summary state would be needed anyway.
 *
 * There's at least one security problem with proposals. The source
 * document id may be a "secret" if it was created by an anonymous
 * user, in the sense that anyone who knows the id could edit
 * it. Something to bear in mind. Some proposal endpoints do some
 * censoring but may not be the right way to go.
 *
 */

@Entity({ name: 'proposals' })
export class Proposal extends BaseEntity {
  @Column({ name: 'short_id', type: Number })
  public shortId: number;

  @Column({ name: 'comparison', type: nativeValues.jsonEntityType, nullable: true })
  public comparison: ProposalComparison;

  @Column({ name: 'status', type: nativeValues.jsonEntityType, nullable: true })
  public status: ProposalStatus;

  @PrimaryColumn({ name: 'src_doc_id', type: String })
  public srcDocId: string;

  @ManyToOne(_type => Document, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'src_doc_id' })
  public srcDoc: Document;

  @PrimaryColumn({ name: 'dest_doc_id', type: String })
  public destDocId: string;

  @ManyToOne(_type => Document, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dest_doc_id' })
  public destDoc: Document;

  @Column({ name: 'created_at', type: Date, default: () => "CURRENT_TIMESTAMP" })
  public createdAt: Date;

  @Column({ name: 'updated_at', type: Date, default: () => "CURRENT_TIMESTAMP" })
  public updatedAt: Date;

  @Column({ name: 'applied_at', type: Date })
  public appliedAt: Date | null;
}
