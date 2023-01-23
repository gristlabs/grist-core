import {BaseEntity, Column, Entity, JoinTable, ManyToMany, OneToOne, PrimaryGeneratedColumn} from "typeorm";

import {AclRule} from "./AclRule";
import {User} from "./User";

@Entity({name: 'groups'})
export class Group extends BaseEntity {

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
    inverseJoinColumn: {name: 'subgroup_id'}
  })
  public memberGroups: Group[];

  @OneToOne(type => AclRule, aclRule => aclRule.group)
  public aclRule: AclRule;
}
