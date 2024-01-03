import {ApiError} from 'app/common/ApiError';
import {DocumentUsage} from 'app/common/DocUsage';
import {Role} from 'app/common/roles';
import {DocumentOptions, DocumentProperties, documentPropertyKeys, DocumentType,
        NEW_DOCUMENT_CODE} from "app/common/UserAPI";
import {nativeValues} from 'app/gen-server/lib/values';
import {Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryColumn} from "typeorm";
import {AclRuleDoc} from "./AclRule";
import {Alias} from "./Alias";
import {Resource} from "./Resource";
import {Secret} from "./Secret";
import {Workspace} from "./Workspace";

// Acceptable ids for use in document urls.
const urlIdRegex = /^[-a-z0-9]+$/i;

function isValidUrlId(urlId: string) {
  if (urlId === NEW_DOCUMENT_CODE) { return false; }
  return urlIdRegex.exec(urlId);
}

@Entity({name: 'docs'})
export class Document extends Resource {

  @PrimaryColumn({type: String})
  public id: string;

  @ManyToOne(type => Workspace)
  @JoinColumn({name: 'workspace_id'})
  public workspace: Workspace;

  @OneToMany(type => AclRuleDoc, aclRule => aclRule.document)
  public aclRules: AclRuleDoc[];

  // Indicates whether the doc is pinned to the org it lives in.
  @Column({name: 'is_pinned', type: Boolean, default: false})
  public isPinned: boolean;

  // Property that may be returned when the doc is fetched to indicate the access the
  // fetching user has on the doc, i.e. 'owners', 'editors', 'viewers'
  public access: Role|null;

  // Property that may be returned when the doc is fetched to indicate the share it
  // is being accessed with. The identifier used is the linkId, which is the share
  // identifier that is the same between the home database and the document.
  // The linkId is not a secret, and need only be unique within a document.
  public linkId?: string|null;

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

  @Column({name: 'grace_period_start', type: nativeValues.dateTimeType, nullable: true})
  public gracePeriodStart: Date|null;

  @OneToMany(type => Alias, alias => alias.doc)
  public aliases: Alias[];

  @Column({name: 'options', type: nativeValues.jsonEntityType, nullable: true})
  public options: DocumentOptions | null;

  @OneToMany(_type => Secret, secret => secret.doc)
  public secrets: Secret[];

  @Column({name: 'usage', type: nativeValues.jsonEntityType, nullable: true})
  public usage: DocumentUsage | null;

  @Column({name: 'created_by', type: 'integer', nullable: true})
  public createdBy: number|null;

  @Column({name: 'trunk_id', type: 'text', nullable: true})
  public trunkId: string|null;

  @ManyToOne(_type => Document, document => document.forks)
  @JoinColumn({name: 'trunk_id'})
  public trunk: Document|null;

  @OneToMany(_type => Document, document => document.trunk)
  public forks: Document[];

  @Column({name: 'type', type: 'text', nullable: true})
  public type: DocumentType|null;

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
    if (props.type !== undefined) { this.type = props.type; }
    if (props.options !== undefined) {
      // Options are merged over the existing state - unless options
      // object is set to "null", in which case the state is wiped
      // completely.
      if (props.options === null) {
        this.options = null;
      } else {
        this.options = this.options || {};
        if (props.options.description !== undefined) {
          this.options.description = props.options.description;
        }
        if (props.options.openMode !== undefined) {
          this.options.openMode = props.options.openMode;
        }
        if (props.options.icon !== undefined) {
          this.options.icon = sanitizeIcon(props.options.icon);
        }
        if (props.options.externalId !== undefined) {
          this.options.externalId = props.options.externalId;
        }
        if (props.options.tutorial !== undefined) {
          // Tutorial metadata is merged over the existing state - unless
          // metadata is set to "null", in which case the state is wiped
          // completely.
          if (props.options.tutorial === null) {
            this.options.tutorial = null;
          } else {
            this.options.tutorial = this.options.tutorial || {};
            if (props.options.tutorial.numSlides !== undefined) {
              this.options.tutorial.numSlides = props.options.tutorial.numSlides;
            }
            if (props.options.tutorial.lastSlideIndex !== undefined) {
              this.options.tutorial.lastSlideIndex = props.options.tutorial.lastSlideIndex;
            }
          }
        }
        // Normalize so that null equates with absence.
        for (const key of Object.keys(this.options) as Array<keyof DocumentOptions>) {
          if (this.options[key] === null) {
            delete this.options[key];
          }
        }
        // Normalize so that no options set equates with absense.
        if (Object.keys(this.options).length === 0) {
          this.options = null;
        }
      }
    }
  }
}

// Check that icon points to an expected location.  This will definitely
// need changing, it is just a placeholder as the icon feature is developed.
function sanitizeIcon(icon: string|null) {
  if (icon === null) { return icon; }
  const url = new URL(icon);
  if (url.protocol !== 'https:' || url.host !== 'grist-static.com' || !url.pathname.startsWith('/icons/')) {
    throw new ApiError('invalid document icon', 400);
  }
  return url.href;
}
