import {BaseEntity, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn} from "typeorm";

import {User} from "./User";

@Entity({name: 'logins'})
export class Login extends BaseEntity {

  @PrimaryColumn({type: Number})
  public id: number;

  // This is the normalized email address we use for equality and indexing.
  @Column({type: String})
  public email: string;

  // This is how the user's email address should be displayed.
  @Column({name: 'display_email', type: String})
  public displayEmail: string;

  @Column({name: 'user_id', type: Number})
  public userId: number;

  @ManyToOne(type => User)
  @JoinColumn({name: 'user_id'})
  public user: User;
}
