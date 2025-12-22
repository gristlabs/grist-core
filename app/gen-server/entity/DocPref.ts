import { DocPrefs } from 'app/common/Prefs';
import { Document } from 'app/gen-server/entity/Document';
import { User } from 'app/gen-server/entity/User';
import { nativeValues } from 'app/gen-server/lib/values';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

@Entity({ name: 'doc_prefs' })
export class DocPref {
  // This table stores per-document preferences that don't belong outside the document.
  // A record with userId of null contains the default preferences for the document.
  // A record with a set userId contains overrides for that user.

  @PrimaryColumn({ name: 'doc_id', type: String })
  public docId: string;

  @PrimaryColumn({ name: 'user_id', type: Number })
  public userId: number|null;

  @ManyToOne(type => Document)
  @JoinColumn({ name: 'doc_id' })
  public doc: Document;

  @ManyToOne(type => User)
  @JoinColumn({ name: 'user_id' })
  public user?: User;

  // Finally, the actual preferences, in JSON.
  @Column({ type: nativeValues.jsonEntityType })
  public prefs: DocPrefs;
}
