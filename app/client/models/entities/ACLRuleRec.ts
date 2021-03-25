import {DocModel, IRowModel} from 'app/client/models/DocModel';

export type ACLRuleRec = IRowModel<"_grist_ACLRules">;

export function createACLRuleRec(this: ACLRuleRec, docModel: DocModel): void {
  // currently don't care much about content.
}
