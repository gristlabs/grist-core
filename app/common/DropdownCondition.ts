import { CompiledPredicateFormula } from 'app/common/PredicateFormula';

export interface DropdownCondition {
  text: string;
  parsed: string;
}

export type DropdownConditionCompilationResult =
  | DropdownConditionCompilationSuccess
  | DropdownConditionCompilationFailure;

interface DropdownConditionCompilationSuccess {
  kind: 'success';
  result: CompiledPredicateFormula;
}

interface DropdownConditionCompilationFailure {
  kind: 'failure';
  error: string;
}
