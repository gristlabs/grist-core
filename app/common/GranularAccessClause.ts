import { emptyPermissionSet, parsePermissions, PartialPermissionSet } from 'app/common/ACLPermissions';
import { ILogger } from 'app/common/BaseAPI';
import { CellValue, RowRecord } from 'app/common/DocActions';
import { DocData } from 'app/common/DocData';
import { getSetMapValue } from 'app/common/gutil';
import sortBy = require('lodash/sortBy');

export interface RuleSet {
  tableId: '*' | string;
  colIds: '*' | string[];
  body: RulePart[];
  defaultPermissions: PartialPermissionSet;
}

export interface RulePart {
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
export type UserInfo = Record<string, CellValue|InfoView>;

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
  name: string;       // Should be unique among UserAttributeRules.
  tableId: string;    // Table in which to look up an existing attribute.
  lookupColId: string;  // Column in tableId in which to do the lookup.
  charId: string;     // Attribute to look up, possibly a path. E.g. 'Email' or 'office.city'.
}

export interface ReadAclOptions {
  log: ILogger;     // For logging warnings during rule processing.
  compile?: (parsed: ParsedAclFormula) => AclMatchFunc;
}

export interface ReadAclResults {
  ruleSets: RuleSet[];
  userAttributes: UserAttributeRule[];
}

/**
 * Parse all ACL rules in the document from DocData into a list of RuleSets and of
 * UserAttributeRules. This is used by both client-side code and server-side.
 */
export function readAclRules(docData: DocData, {log, compile}: ReadAclOptions): ReadAclResults {
  const resourcesTable = docData.getTable('_grist_ACLResources')!;
  const rulesTable = docData.getTable('_grist_ACLRules')!;

  const ruleSets: RuleSet[] = [];
  const userAttributes: UserAttributeRule[] = [];

  // Group rules by resource first, ordering by rulePos. Each group will become a RuleSet.
  const rulesByResource = new Map<number, RowRecord[]>();
  for (const ruleRecord of sortBy(rulesTable.getRecords(), 'rulePos')) {
    getSetMapValue(rulesByResource, ruleRecord.resource, () => []).push(ruleRecord);
  }

  for (const [resourceId, rules] of rulesByResource.entries()) {
    const resourceRec = resourcesTable.getRecord(resourceId as number);
    if (!resourceRec) {
      log.error(`ACLRule ${rules[0].id} ignored; refers to an invalid ACLResource ${resourceId}`);
      continue;
    }
    if (!resourceRec.tableId || !resourceRec.colIds) {
      // This should only be the case for the old-style default rule/resource, which we
      // intentionally ignore and skip.
      continue;
    }
    const tableId = resourceRec.tableId as string;
    const colIds = resourceRec.colIds === '*' ? '*' : (resourceRec.colIds as string).split(',');

    let defaultPermissions: PartialPermissionSet|undefined;
    const body: RulePart[] = [];
    for (const rule of rules) {
      if (rule.userAttributes) {
        if (tableId !== '*' || colIds !== '*') {
          log.warn(`ACLRule ${rule.id} ignored; user attributes must be on the default resource`);
          continue;
        }
        const parsed = JSON.parse(String(rule.userAttributes));
        // TODO: could perhaps use ts-interface-checker here.
        if (!(parsed && typeof parsed === 'object' &&
          [parsed.name, parsed.tableId, parsed.lookupColId, parsed.charId]
          .every(p => p && typeof p === 'string'))) {
          throw new Error(`Invalid user attribute rule: ${parsed}`);
        }
        userAttributes.push(parsed as UserAttributeRule);
      } else if (rule.aclFormula === '') {
        defaultPermissions = parsePermissions(String(rule.permissionsText));
      } else if (defaultPermissions) {
        log.warn(`ACLRule ${rule.id} ignored because listed after default rule`);
      } else if (!rule.aclFormulaParsed) {
        log.warn(`ACLRule ${rule.id} ignored because missing its parsed formula`);
      } else {
        body.push({
          aclFormula: String(rule.aclFormula),
          matchFunc: compile?.(JSON.parse(String(rule.aclFormulaParsed))),
          permissions: parsePermissions(String(rule.permissionsText)),
          permissionsText: String(rule.permissionsText),
        });
      }
    }
    if (!defaultPermissions) {
      // Empty permissions allow falling through to the doc-default resource.
      defaultPermissions = emptyPermissionSet();
    }
    const ruleSet: RuleSet = {tableId, colIds, body, defaultPermissions};
    ruleSets.push(ruleSet);
  }
  return {ruleSets, userAttributes};
}
