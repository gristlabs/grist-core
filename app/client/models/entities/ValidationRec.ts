import {DocModel, IRowModel} from 'app/client/models/DocModel';

// Represents a validation rule.
export type ValidationRec = IRowModel<"_grist_Validations">

export function createValidationRec(this: ValidationRec, docModel: DocModel): void {
  // no extra fields
}
