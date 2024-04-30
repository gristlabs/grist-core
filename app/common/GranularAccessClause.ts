import {PartialPermissionSet} from 'app/common/ACLPermissions';
import {CellValue, RowRecord} from 'app/common/DocActions';
import {CompiledPredicateFormula} from 'app/common/PredicateFormula';
import {Role} from 'app/common/roles';
import {MetaRowRecord} from 'app/common/TableData';

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
  matchFunc?: CompiledPredicateFormula;

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

export interface UserAttributeRule {
  origRecord?: RowRecord;         // Original record used to create this UserAttributeRule.
  name: string;       // Should be unique among UserAttributeRules.
  tableId: string;    // Table in which to look up an existing attribute.
  lookupColId: string;  // Column in tableId in which to do the lookup.
  charId: string;     // Attribute to look up, possibly a path. E.g. 'Email' or 'office.city'.
}
