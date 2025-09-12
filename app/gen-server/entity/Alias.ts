import {BaseEntity, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne,
        PrimaryColumn} from 'typeorm';
import {Document} from 'app/gen-server/entity/Document';
import {Organization} from 'app/gen-server/entity/Organization';

@Entity({name: 'aliases'})
export class Alias extends BaseEntity {
  @PrimaryColumn({name: 'org_id', type: Number})
  public orgId: number;

  @PrimaryColumn({name: 'url_id', type: String})
  public urlId: string;

  @Column({name: 'doc_id', type: String})
  public docId: string;

  @ManyToOne(type => Document)
  @JoinColumn({name: 'doc_id'})
  public doc: Document;

  @ManyToOne(type => Organization)
  @JoinColumn({name: 'org_id'})
  public org: Organization;

  @CreateDateColumn({name: 'created_at'})
  public createdAt: Date;
}
