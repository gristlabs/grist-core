import {BaseEntity, Column, Entity, PrimaryColumn} from "typeorm";

@Entity({name: 'activations'})
export class Activation extends BaseEntity {

  @PrimaryColumn()
  public id: string;

  @Column({name: 'key', type: 'text', nullable: true})
  public key: string|null;

  @Column({name: 'created_at', default: () => "CURRENT_TIMESTAMP"})
  public createdAt: Date;

  @Column({name: 'updated_at', default: () => "CURRENT_TIMESTAMP"})
  public updatedAt: Date;
}
