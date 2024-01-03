import {PartialPermissionSet} from 'app/common/ACLPermissions';
import {CellValue, RowRecord} from 'app/common/DocActions';
import {MetaRowRecord} from 'app/common/TableData';
import {Role} from './roles';

export interface RuleSet {
  tableId: '*' | string;
  colIds: '*' | string[];
  // The default permissions for this resource, if set, are represented by a RulePart with
  // aclFormula of "", which must be the last element of body.
  body: RulePart[];
}

export interface RulePart {
  origRecord?: MetaRowRecord<'_grist_ACLRules'>;  // Original record used to create this RulePart.
  aclFormula: string;
  permissions: PartialPermissionSet;
  permissionsText: string;        // The text version of PermissionSet, as stored.

  // Compiled version of aclFormula.
  matchFunc?: AclMatchFunc;

  // Optional memo, currently extracted from comment in formula.
  memo?: string;
}

// Light wrapper for reading records or user attributes.
export interface InfoView {
  get(key: string): CellValue;
  toJSON(): {[key: string]: any};
}

// As InfoView, but also supporting writing.
export interface InfoEditor {
  get(key: string): CellValue;
  set(key: string, val: CellValue): this;
  toJSON(): {[key: string]: any};
}

// Represents user info, which may include properties which are themselves RowRecords.
export interface UserInfo {
  Name: string | null;
  Email: string | null;
  Access: Role | null;
  Origin: string | null;
  LinkKey: Record<string, string | undefined>;
  UserID: number | null;
  UserRef: string | null;
  SessionID: string | null;
  ShareRef: number | null;   // This is a rowId in the _grist_Shares table, if the user
                             // is accessing a document via a share. Otherwise null.
  [attributes: string]: unknown;
  toJSON(): {[key: string]: any};
}

/**
 * Input into the AclMatchFunc. Compiled formulas evaluate AclMatchInput to produce a boolean.
 */
export interface AclMatchInput {
  user: UserInfo;
  rec?: InfoView;
  newRec?: InfoView;
  docId?: string;
}

/**
 * The actual boolean function that can evaluate a request. The result of compiling ParsedAclFormula.
 */
export type AclMatchFunc = (input: AclMatchInput) => boolean;

/**
 * Representation of a parsed ACL formula.
 */
type PrimitiveCellValue = number|string|boolean|null;
export type ParsedAclFormula = [string, ...(ParsedAclFormula|PrimitiveCellValue)[]];

/**
 * Observations about a formula.
 */
export interface FormulaProperties {
  hasRecOrNewRec?: boolean;
  usedColIds?: string[];
}

export interface UserAttributeRule {
  origRecord?: RowRecord;         // Original record used to create this UserAttributeRule.
  name: string;       // Should be unique among UserAttributeRules.
  tableId: string;    // Table in which to look up an existing attribute.
  lookupColId: string;  // Column in tableId in which to do the lookup.
  charId: string;     // Attribute to look up, possibly a path. E.g. 'Email' or 'office.city'.
}

/**
 * Check some key facts about the formula.
 */
export function getFormulaProperties(formula: ParsedAclFormula) {
  const result: FormulaProperties = {};
  if (usesRec(formula)) { result.hasRecOrNewRec = true; }
  const colIds = new Set<string>();
  collectRecColIds(formula, colIds);
  result.usedColIds = Array.from(colIds);
  return result;
}

/**
 * Check whether a formula mentions `rec` or `newRec`.
 */
export function usesRec(formula: ParsedAclFormula): boolean {
  if (!Array.isArray(formula)) { throw new Error('expected a list'); }
  if (isRecOrNewRec(formula)) {
    return true;
  }
  return formula.some(el => {
    if (!Array.isArray(el)) { return false; }
    return usesRec(el);
  });
}

function isRecOrNewRec(formula: ParsedAclFormula|PrimitiveCellValue): boolean {
  return Array.isArray(formula) &&
    formula[0] === 'Name' &&
    (formula[1] === 'rec' || formula[1] === 'newRec');
}

function collectRecColIds(formula: ParsedAclFormula, colIds: Set<string>): void {
  if (!Array.isArray(formula)) { throw new Error('expected a list'); }
  if (formula[0] === 'Attr' && isRecOrNewRec(formula[1])) {
    const colId = formula[2];
    colIds.add(String(colId));
    return;
  }
  formula.forEach(el => Array.isArray(el) && collectRecColIds(el, colIds));
}
