import { DocStateComparison } from "app/common/UserAPI";
import { BaseEntity, Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { nativeValues } from "../lib/values";
import {Document} from "./Document";

export class OfferOptions {
  comparison?: DocStateComparison;
}

@Entity({name: 'offers'})
export class Offer extends BaseEntity {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({name: 'offer', type: nativeValues.jsonEntityType, nullable: true})
  public offer: OfferOptions | null;

  @Column({name: 'doc_id', type: String})
  public docId: string;

  @ManyToOne(_type => Document, { onDelete: 'CASCADE' })
  @JoinColumn({name: 'doc_id'})
  public doc: Document;

}
