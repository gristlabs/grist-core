import {DocModel, IRowModel} from 'app/client/models/DocModel';

// Record of input code and output text and error info for REPL.
export type REPLRec = IRowModel<"_grist_REPL_Hist">

export function createREPLRec(this: REPLRec, docModel: DocModel): void {
  // no extra fields
}
