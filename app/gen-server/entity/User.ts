import {UserOptions, UserProfile} from 'app/common/UserAPI';
import {UserType} from 'app/common/User';
import {nativeValues} from 'app/gen-server/lib/values';
import {makeId} from 'app/server/lib/idUtils';
import {BaseEntity, BeforeInsert, Column, Entity, JoinTable, ManyToMany, OneToMany, OneToOne,
        PrimaryGeneratedColumn} from "typeorm";

import {Group} from "app/gen-server/entity/Group";
import {Login} from "app/gen-server/entity/Login";
import {Organization} from "app/gen-server/entity/Organization";
import {Pref} from 'app/gen-server/entity/Pref';
import {ServiceAccount} from 'app/gen-server/entity/ServiceAccount';

@Entity({name: 'users'})
export class User extends BaseEntity {
  public static readonly LOGIN_TYPE: UserType = 'login';
  public static readonly SERVICE_TYPE: UserType = 'service';

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

  @Column({name: 'first_login_at', type: nativeValues.dateTimeType, nullable: true})
  public firstLoginAt: Date | null;

  @Column({name: 'last_connection_at', type: nativeValues.dateTimeType, nullable: true})
  public lastConnectionAt: Date | null;

  @Column({name: 'disabled_at', type: nativeValues.dateTimeType, nullable: true})
  public disabledAt: Date | null;

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

  @OneToOne(() => ServiceAccount, sa => sa.serviceUser)
  public serviceAccount?: ServiceAccount;
  /**
   * Unique reference for this user. Primarily used as an ownership key in a cell metadata (comments).
   */
  @Column({name: 'ref', type: String, nullable: false})
  public ref: string;

  @Column({name: 'created_at', default: () => 'CURRENT_TIMESTAMP'})
  public createdAt: Date;

  // A random public key that can be used to manage document preferences without authentication.
  @Column({name: 'unsubscribe_key', type: String, nullable: true})
  public unsubscribeKey: string|null;

  @Column({name: 'type', type: String, enum: [User.LOGIN_TYPE, User.SERVICE_TYPE], default: User.LOGIN_TYPE,
    // Must be null for migrations testing purpose
    nullable: true,
  })
  public type: UserType;

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

  /**
   * As above, but using the display email.
   */
  public get displayEmail(): string|undefined {
    const login = this.logins && this.logins[0];
    if (!login) { return undefined; }
    return login.displayEmail;
  }

  public toUserProfile(): UserProfile {
    return {
      name: this.name,
      email: this.displayEmail || '',
      loginEmail: this.loginEmail || '',
      picture: this.picture,
    };
  }
}
