import {ApiError} from 'app/common/ApiError';
import {Role} from 'app/common/roles';
import {DocumentProperties, documentPropertyKeys, NEW_DOCUMENT_CODE} from "app/common/UserAPI";
import {nativeValues} from 'app/gen-server/lib/values';
import {Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryColumn} from "typeorm";
import {AclRuleDoc} from "./AclRule";
import {Alias} from "./Alias";
import {Resource} from "./Resource";
import {Workspace} from "./Workspace";

// Acceptable ids for use in document urls.
const urlIdRegex = /^[-a-z0-9]+$/i;

function isValidUrlId(urlId: string) {
  if (urlId === NEW_DOCUMENT_CODE) { return false; }
  return urlIdRegex.exec(urlId);
}

@Entity({name: 'docs'})
export class Document extends Resource {

  @PrimaryColumn()
  public id: string;

  @ManyToOne(type => Workspace)
  @JoinColumn({name: 'workspace_id'})
  public workspace: Workspace;

  @OneToMany(type => AclRuleDoc, aclRule => aclRule.document)
  public aclRules: AclRuleDoc[];

  // Indicates whether the doc is pinned to the org it lives in.
  @Column({name: 'is_pinned', default: false})
  public isPinned: boolean;

  // Property that may be returned when the doc is fetched to indicate the access the
  // fetching user has on the doc, i.e. 'owners', 'editors', 'viewers'
  public access: Role|null;

  // Property set for forks, containing access the fetching user has on the trunk.
  public trunkAccess?: Role|null;

  // a computed column with permissions.
  // {insert: false} makes sure typeorm doesn't try to put values into such
  // a column when creating documents.
  @Column({name: 'permissions', type: 'text', select: false, insert: false, update: false})
  public permissions?: any;

  @Column({name: 'url_id', type: 'text', nullable: true})
  public urlId: string|null;

  @Column({name: 'removed_at', type: nativeValues.dateTimeType, nullable: true})
  public removedAt: Date|null;

  @OneToMany(type => Alias, alias => alias.doc)
  public aliases: Alias[];

  public checkProperties(props: any): props is Partial<DocumentProperties> {
    return super.checkProperties(props, documentPropertyKeys);
  }

  public updateFromProperties(props: Partial<DocumentProperties>) {
    super.updateFromProperties(props);
    if (props.isPinned !== undefined) { this.isPinned = props.isPinned; }
    if (props.urlId !== undefined) {
      if (props.urlId !== null && !isValidUrlId(props.urlId)) {
        throw new ApiError('invalid urlId', 400);
      }
      this.urlId = props.urlId;
    }
  }
}
