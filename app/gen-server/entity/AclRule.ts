import {BaseEntity, ChildEntity, Column, Entity, JoinColumn, ManyToOne, OneToOne,
        PrimaryGeneratedColumn, RelationId, TableInheritance} from "typeorm";

import {Document} from "./Document";
import {Group} from "./Group";
import {Organization} from "./Organization";
import {Workspace} from "./Workspace";

@Entity('acl_rules')
@TableInheritance({ column: { type: "int", name: "type" } })
export class AclRule extends BaseEntity {

  @PrimaryGeneratedColumn()
  public id: number;

  @Column({type: Number})
  public permissions: number;

  @OneToOne(type => Group, group => group.aclRule)
  @JoinColumn({name: "group_id"})
  public group: Group;
}


@ChildEntity()
export class AclRuleWs extends AclRule {

  @ManyToOne(type => Workspace, workspace => workspace.aclRules)
  @JoinColumn({name: "workspace_id"})
  public workspace: Workspace;

  @RelationId((aclRule: AclRuleWs) => aclRule.workspace)
  public workspaceId: number;
}


@ChildEntity()
export class AclRuleOrg extends AclRule {

  @ManyToOne(type => Organization, organization => organization.aclRules)
  @JoinColumn({name: "org_id"})
  public organization: Organization;

  @RelationId((aclRule: AclRuleOrg) => aclRule.organization)
  public orgId: number;
}


@ChildEntity()
export class AclRuleDoc extends AclRule {

  @ManyToOne(type => Document, document => document.aclRules)
  @JoinColumn({name: "doc_id"})
  public document: Document;

  @RelationId((aclRule: AclRuleDoc) => aclRule.document)
  public docId: string;
}
