import {Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn} from "typeorm";
import {WorkspaceProperties, workspacePropertyKeys} from "app/common/UserAPI";
import {nativeValues} from 'app/gen-server/lib/values';
import {AclRuleWs} from "./AclRule";
import {Document} from "./Document";
import {Organization} from "./Organization";
import {Resource} from "./Resource";

@Entity({name: 'workspaces'})
export class Workspace extends Resource {

  @PrimaryGeneratedColumn()
  public id: number;

  @ManyToOne(type => Organization)
  @JoinColumn({name: 'org_id'})
  public org: Organization;

  @OneToMany(type => Document, document => document.workspace)
  public docs: Document[];

  @OneToMany(type => AclRuleWs, aclRule => aclRule.workspace)
  public aclRules: AclRuleWs[];

  // Property that may be returned when the workspace is fetched to indicate the access the
  // fetching user has on the workspace, i.e. 'owners', 'editors', 'viewers'
  public access: string;

  // A computed column that is true if the workspace is a support workspace.
  @Column({name: 'support', type: 'boolean', insert: false, select: false})
  public isSupportWorkspace?: boolean;

  // a computed column with permissions.
  // {insert: false} makes sure typeorm doesn't try to put values into such
  // a column when creating workspaces.
  @Column({name: 'permissions', type: 'text', select: false, insert: false})
  public permissions?: any;

  @Column({name: 'removed_at', type: nativeValues.dateTimeType, nullable: true})
  public removedAt: Date|null;

  public checkProperties(props: any): props is Partial<WorkspaceProperties> {
    return super.checkProperties(props, workspacePropertyKeys);
  }

  public updateFromProperties(props: Partial<WorkspaceProperties>) {
    super.updateFromProperties(props);
  }
}
