import {ACLPrincipalRec, DocModel, IRowModel, refRecord} from 'app/client/models/DocModel';
import * as ko from 'knockout';

// Table for containment relationships between Principals, e.g. user contains multiple
// instances, group contains multiple users, and groups may contain other groups.
export interface ACLMembershipRec extends IRowModel<"_grist_ACLMemberships"> {
  parentRec: ko.Computed<ACLPrincipalRec>;
  childRec: ko.Computed<ACLPrincipalRec>;
}

export function createACLMembershipRec(this: ACLMembershipRec, docModel: DocModel): void {
  this.parentRec = refRecord(docModel.aclPrincipals, this.parent);
  this.childRec = refRecord(docModel.aclPrincipals, this.child);
}
