import {DocModel, IRowModel} from 'app/client/models/DocModel';

export type ACLResourceRec = IRowModel<"_grist_ACLResources">;

export function createACLResourceRec(this: ACLResourceRec, docModel: DocModel): void {
  // no extra fields
}
