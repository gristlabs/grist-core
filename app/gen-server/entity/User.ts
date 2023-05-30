import {UserOptions} from 'app/common/UserAPI';
import {nativeValues} from 'app/gen-server/lib/values';
import {makeId} from 'app/server/lib/idUtils';
import {BaseEntity, BeforeInsert, Column, Entity, JoinTable, ManyToMany, OneToMany, OneToOne,
        PrimaryGeneratedColumn} from "typeorm";

import {Group} from "./Group";
import {Login} from "./Login";
import {Organization} from "./Organization";
import {Pref} from './Pref';

@Entity({name: 'users'})
export class User extends BaseEntity {

  @PrimaryGeneratedColumn()
  public id: number;

  @Column({type: String})
  public name: string;

  @Column({name: 'api_key', type: String, nullable: true})
  // Found how to make a type nullable in this discussion: https://github.com/typeorm/typeorm/issues/2567
  // todo: adds constraint for api_key not to equal ''
  public apiKey: string | null;

  @Column({name: 'picture', type: String, nullable: true})
  public picture: string | null;

  @Column({name: 'first_login_at', type: Date, nullable: true})
  public firstLoginAt: Date | null;

  @OneToOne(type => Organization, organization => organization.owner)
  public personalOrg: Organization;

  @OneToMany(type => Login, login => login.user)
  public logins: Login[];

  @OneToMany(type => Pref, pref => pref.user)
  public prefs: Pref[];

  @ManyToMany(type => Group)
  @JoinTable({
    name: 'group_users',
    joinColumn: {name: 'user_id'},
    inverseJoinColumn: {name: 'group_id'}
  })
  public groups: Group[];

  @Column({name: 'is_first_time_user', type: Boolean, default: false})
  public isFirstTimeUser: boolean;

  @Column({name: 'options', type: nativeValues.jsonEntityType, nullable: true})
  public options: UserOptions | null;

  @Column({name: 'connect_id', type: String, nullable: true})
  public connectId: string | null;

  /**
   * Unique reference for this user. Primarily used as an ownership key in a cell metadata (comments).
   */
  @Column({name: 'ref', type: String, nullable: false})
  public ref: string;

  @BeforeInsert()
  public async beforeInsert() {
    if (!this.ref) {
      this.ref = makeId();
    }
  }

  /**
   * Get user's email.  Returns undefined if logins has not been joined, or no login
   * is available
   */
  public get loginEmail(): string|undefined {
    const login = this.logins && this.logins[0];
    if (!login) { return undefined; }
    return login.email;
  }
}
