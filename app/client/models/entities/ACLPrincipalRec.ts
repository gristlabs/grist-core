import {KoArray} from 'app/client/lib/koArray';
import {ACLMembershipRec, DocModel, IRowModel, recordSet} from 'app/client/models/DocModel';
import {KoSaveableObservable} from 'app/client/models/modelUtil';
import * as ko from 'knockout';

// A principals used by ACL rules, including users, groups, and instances.
export interface ACLPrincipalRec extends IRowModel<"_grist_ACLPrincipals"> {
  // Declare a more specific type for 'type' than what's set automatically from schema.ts.
  type: KoSaveableObservable<'user'|'instance'|'group'>;

  // KoArray of ACLMembership row models which contain this principal as a child.
  parentMemberships: ko.Computed<KoArray<ACLMembershipRec>>;

  // Gives an array of ACLPrincipal parents to this row model.
  parents: ko.Computed<ACLPrincipalRec[]>;

  // KoArray of ACLMembership row models which contain this principal as a parent.
  childMemberships: ko.Computed<KoArray<ACLMembershipRec>>;

  // Gives an array of ACLPrincipal children of this row model.
  children: ko.Computed<ACLPrincipalRec[]>;
}

export function createACLPrincipalRec(this: ACLPrincipalRec, docModel: DocModel): void {
  this.parentMemberships = recordSet(this, docModel.aclMemberships, 'child');
  this.childMemberships = recordSet(this, docModel.aclMemberships, 'parent');
  this.parents = ko.pureComputed(() => this.parentMemberships().all().map(m => m.parentRec()));
  this.children = ko.pureComputed(() => this.childMemberships().all().map(m => m.childRec()));
}
