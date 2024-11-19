import {BaseEntity, Column, Entity, JoinTable, ManyToOne, PrimaryGeneratedColumn} from "typeorm";
import { User } from './User';

@Entity({name: 'service_accounts'})
export class ServiceAccount extends BaseEntity {

  @PrimaryGeneratedColumn()
  public id: number;


  @Column({type: String})
  public description: string;

  @Column({type: Date, default: Date.now()})
  public endOfLife: string;

  @ManyToOne(type => User)
  @JoinTable({
    name: 'service_account_user',
    joinColumn: {name: 'service_account_id'},
    inverseJoinColumn: {name: 'user_id'}
  })
  public service_account_owner: User;
}
