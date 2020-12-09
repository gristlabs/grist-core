import { PartialPermissionSet } from 'app/common/ACLPermissions';
import { CellValue, RowRecord } from 'app/common/DocActions';

export interface RuleSet {
  tableId: '*' | string;
  colIds: '*' | string[];
  // The default permissions for this resource, if set, are represented by a RulePart with
  // aclFormula of "", which must be the last element of body.
  body: RulePart[];
}

export interface RulePart {
  origRecord?: RowRecord;         // Original record used to create this RulePart.
  aclFormula: string;
  permissions: PartialPermissionSet;
  permissionsText: string;        // The text version of PermissionSet, as stored.

  // Compiled version of aclFormula.
  matchFunc?: AclMatchFunc;
}

// Light wrapper around characteristics or records.
export interface InfoView {
  get(key: string): CellValue;
  toJSON(): {[key: string]: any};
}

// Represents user info, which may include properties which are themselves RowRecords.
export type UserInfo = Record<string, CellValue|InfoView|Record<string, string>>;

/**
 * Input into the AclMatchFunc. Compiled formulas evaluate AclMatchInput to produce a boolean.
 */
export interface AclMatchInput {
  user: UserInfo;
  rec?: InfoView;
  newRec?: InfoView;
}

/**
 * The actual boolean function that can evaluate a request. The result of compiling ParsedAclFormula.
 */
export type AclMatchFunc = (input: AclMatchInput) => boolean;

/**
 * Representation of a parsed ACL formula.
 */
export type ParsedAclFormula = [string, ...Array<ParsedAclFormula|CellValue>];

export interface UserAttributeRule {
  origRecord?: RowRecord;         // Original record used to create this UserAttributeRule.
  name: string;       // Should be unique among UserAttributeRules.
  tableId: string;    // Table in which to look up an existing attribute.
  lookupColId: string;  // Column in tableId in which to do the lookup.
  charId: string;     // Attribute to look up, possibly a path. E.g. 'Email' or 'office.city'.
}
