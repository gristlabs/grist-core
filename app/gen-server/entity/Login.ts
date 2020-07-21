import {BaseEntity, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn} from "typeorm";

import {User} from "./User";

@Entity({name: 'logins'})
export class Login extends BaseEntity {

  @PrimaryColumn()
  public id: number;

  // This is the normalized email address we use for equality and indexing.
  @Column()
  public email: string;

  // This is how the user's email address should be displayed.
  @Column({name: 'display_email'})
  public displayEmail: string;

  @Column({name: 'user_id'})
  public userId: number;

  @ManyToOne(type => User)
  @JoinColumn({name: 'user_id'})
  public user: User;
}
