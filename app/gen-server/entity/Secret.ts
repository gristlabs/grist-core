import {BaseEntity, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn} from "typeorm";
import {Document} from "./Document";

@Entity({name: 'secrets'})
export class Secret extends BaseEntity {
  @PrimaryColumn({type: String})
  public id: string;  // generally a UUID

  @Column({name: 'value', type: String})
  public value: string;

  @ManyToOne(_type => Document, { onDelete: 'CASCADE' })
  @JoinColumn({name: 'doc_id'})
  public doc: Document;

}
