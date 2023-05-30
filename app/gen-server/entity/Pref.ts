import {Prefs} from 'app/common/Prefs';
import {Organization} from 'app/gen-server/entity/Organization';
import {User} from 'app/gen-server/entity/User';
import {nativeValues} from 'app/gen-server/lib/values';
import {Column, Entity, JoinColumn, ManyToOne, PrimaryColumn} from 'typeorm';

@Entity({name: 'prefs'})
export class Pref {
  // This table may refer to users and/or orgs.
  // We pretend userId/orgId are the primary key since TypeORM insists on having
  // one, but we haven't marked them as so in the DB since the SQL standard frowns
  // on nullable primary keys (and Postgres doesn't support them).  We could add
  // another primary key, but we don't actually need one.
  @PrimaryColumn({name: 'user_id', type: Number})
  public userId: number|null;

  @PrimaryColumn({name: 'org_id', type: Number})
  public orgId: number|null;

  @ManyToOne(type => User)
  @JoinColumn({name: 'user_id'})
  public user?: User;

  @ManyToOne(type => Organization)
  @JoinColumn({name: 'org_id'})
  public org?: Organization;

  // Finally, the actual preferences, in JSON.
  @Column({type: nativeValues.jsonEntityType})
  public prefs: Prefs;
}
