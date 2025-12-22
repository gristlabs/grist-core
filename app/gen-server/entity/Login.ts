import {
  BaseEntity,
  BeforeInsert,
  BeforeUpdate,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from "typeorm";

import { User } from "app/gen-server/entity/User";

@Entity({ name: 'logins' })
export class Login extends BaseEntity {
  public static readonly SERVICE_ACCOUNTS_TLD = 'serviceaccounts.invalid';

  @PrimaryColumn({ type: Number })
  public id: number;

  // This is the normalized email address we use for equality and indexing.
  @Index()
  @Column({ type: String })
  public email: string;

  // This is how the user's email address should be displayed.
  @Column({ name: 'display_email', type: String })
  public displayEmail: string;

  @Column({ name: 'user_id', type: Number })
  public userId: number;

  @ManyToOne(type => User)
  @JoinColumn({ name: 'user_id' })
  public user: User;

  @BeforeInsert()
  @BeforeUpdate()
  public checkServiceAccountMailAreInvalid(){
    if (this.user?.type === "service" && !this.email.endsWith(Login.SERVICE_ACCOUNTS_TLD)) {
      throw new Error(`Users of type service must have email like XXXXXX@${Login.SERVICE_ACCOUNTS_TLD}`);
    }
  }
}
