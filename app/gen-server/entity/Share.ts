import {ShareOptions} from 'app/common/ShareOptions';
import {Document} from 'app/gen-server/entity/Document';
import {nativeValues} from 'app/gen-server/lib/values';
import {BaseEntity, Column, Entity, JoinColumn, ManyToOne,
        PrimaryColumn} from 'typeorm';

@Entity({name: 'shares'})
export class Share extends BaseEntity {
  /**
   * A simple integer auto-incrementing identifier for a share.
   * Suitable for use in within-database references.
   */
  @PrimaryColumn({name: 'id', type: Number})
  public id: number;

  /**
   * A long string secret to identify the share. Suitable for URLs.
   * Unique across the database / installation.
   */
  @Column({name: 'key', type: String})
  public key: string;

  /**
   * A string to identify the share. This identifier is common to the home
   * database and the document specified by docId. It need only be unique
   * within that document, and is not a secret. These two properties are
   * important when you imagine handling documents that are transferred
   * between installations, or copied, etc.
   */
  @Column({name: 'link_id', type: String})
  public linkId: string;

  /**
   * The document to which the share belongs.
   */
  @Column({name: 'doc_id', type: String})
  public docId: string;

  /**
   * Any overall qualifiers on the share.
   */
  @Column({name: 'options', type: nativeValues.jsonEntityType})
  public options: ShareOptions;

  @ManyToOne(type => Document)
  @JoinColumn({name: 'doc_id'})
  public doc: Document;
}
