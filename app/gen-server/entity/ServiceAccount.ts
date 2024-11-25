import {BaseEntity, Column, Entity, PrimaryGeneratedColumn} from "typeorm";

@Entity({name: 'service_accounts'})
export class ServiceAccount extends BaseEntity {

  @PrimaryGeneratedColumn()
  public id: number;

  @Column({type: Number})
  public owner_id: number;

  @Column({type: Number})
  public service_user_id: number;

  @Column({type: String})
  public description: string;

  @Column({type: Date, nullable: false})
  public endOfLife: string;
}
