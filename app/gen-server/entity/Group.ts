import {BaseEntity, BeforeInsert, BeforeUpdate, Column, Entity, JoinTable, ManyToMany,
  OneToOne, PrimaryGeneratedColumn} from "typeorm";

import {AclRule} from "app/gen-server/entity/AclRule";
import {User} from "app/gen-server/entity/User";
import { ApiError } from "app/common/ApiError";

@Entity({name: 'groups'})
export class Group extends BaseEntity {
  public static readonly ROLE_TYPE = 'role';
  public static readonly TEAM_TYPE = 'team';

  @PrimaryGeneratedColumn()
  public id: number;

  @Column({type: String})
  public name: string;

  @ManyToMany(type => User)
  @JoinTable({
    name: 'group_users',
    joinColumn: {name: 'group_id'},
    inverseJoinColumn: {name: 'user_id'}
  })
  public memberUsers: User[];

  @ManyToMany(type => Group)
  @JoinTable({
    name: 'group_groups',
    joinColumn: {name: 'group_id'},
    inverseJoinColumn: {name: 'subgroup_id'},
  })
  public memberGroups: Group[];

  @OneToOne(type => AclRule, aclRule => aclRule.group)
  public aclRule: AclRule;


  @Column({type: String, enum: [Group.ROLE_TYPE, Group.TEAM_TYPE], default: Group.ROLE_TYPE,
    // Disabling nullable and select is necessary for the code to be run with older versions of the database.
    // Especially it is required for testing the migrations.
    nullable: true,
    // We must set select to false because of older migrations (like 1556726945436-Billing.ts)
    // which does not expect a type column at this moment.
    select: false})
  public type: typeof Group.ROLE_TYPE | typeof Group.TEAM_TYPE;

  @BeforeUpdate()
  @BeforeInsert()
  public checkGroupMembers() {
    const memberGroups = this.memberGroups ?? [];

    if (this.type === Group.TEAM_TYPE && memberGroups.length > 0) {
      throw new ApiError(`Groups of type "${Group.TEAM_TYPE}" cannot contain groups.`, 400);
    }
    const containItself = memberGroups.some(group => group.id === this.id);
    if (containItself) {
      throw new ApiError('A group cannot contain itself.', 400);
    }
  }
}


