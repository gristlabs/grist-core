import { parsePermissions } from 'app/common/ACLPermissions';
import { ILogger } from 'app/common/BaseAPI';
import { CellValue, RowRecord } from 'app/common/DocActions';
import { DocData } from 'app/common/DocData';
import { AclMatchFunc, ParsedAclFormula, RulePart, RuleSet, UserAttributeRule } from 'app/common/GranularAccessClause';
import { getSetMapValue } from 'app/common/gutil';
import sortBy = require('lodash/sortBy');

const defaultMatchFunc: AclMatchFunc = () => true;

// This is the hard-coded default RuleSet that's added to any user-created default rule.
const DEFAULT_RULE_SET: RuleSet = {
  tableId: '*',
  colIds: '*',
  body: [{
    aclFormula: "user.Access in ['editors', 'owners']",
    matchFunc:  (input) => ['editors', 'owners'].includes(String(input.user.Access)),
    permissions: parsePermissions('all'),
    permissionsText: 'all',
  }, {
    aclFormula: "user.Access in ['viewers']",
    matchFunc:  (input) => ['viewers'].includes(String(input.user.Access)),
    permissions: parsePermissions('+R-CUDS'),
    permissionsText: '+R',
  }, {
    aclFormula: "",
    matchFunc: defaultMatchFunc,
    permissions: parsePermissions('none'),
    permissionsText: 'none',
  }],
};

// If the user-created rules become dysfunctional, we can swap in this emergency set.
// It grants full access to owners, and no access to anyone else.
const EMERGENCY_RULE_SET: RuleSet = {
  tableId: '*',
  colIds: '*',
  body: [{
    aclFormula: "user.Access in ['owners']",
    matchFunc:  (input) => ['owners'].includes(String(input.user.Access)),
    permissions: parsePermissions('all'),
    permissionsText: 'all',
  }, {
    aclFormula: "",
    matchFunc: defaultMatchFunc,
    permissions: parsePermissions('none'),
    permissionsText: 'none',
  }],
};

export class ACLRuleCollection {
  // Store error if one occurs while reading rules.  Rules are replaced with emergency rules
  // in this case.
  public ruleError: Error|undefined;

  // In the absence of rules, some checks are skipped. For now this is important to maintain all
  // existing behavior. TODO should make sure checking access against default rules is equivalent
  // and efficient.
  private _haveRules = false;

  // Map of tableId to list of column RuleSets (those with colIds other than '*')
  private _columnRuleSets = new Map<string, RuleSet[]>();

  // Maps 'tableId:colId' to one of the RuleSets in the list _columnRuleSets.get(tableId).
  private _tableColumnMap = new Map<string, RuleSet>();

  // Map of tableId to the single default RuleSet for the table (colIds of '*')
  private _tableRuleSets = new Map<string, RuleSet>();

  // The default RuleSet (tableId '*', colIds '*')
  private _defaultRuleSet: RuleSet = DEFAULT_RULE_SET;

  // List of all tableIds mentioned in rules.
  private _tableIds: string[] = [];

  // Maps name to the corresponding UserAttributeRule.
  private _userAttributeRules = new Map<string, UserAttributeRule>();

  // Whether there are ANY user-defined rules.
  public haveRules(): boolean {
    return this._haveRules;
  }

  // Return the RuleSet for "tableId:colId", or undefined if there isn't one for this column.
  public getColumnRuleSet(tableId: string, colId: string): RuleSet|undefined {
    return this._tableColumnMap.get(`${tableId}:${colId}`);
  }

  // Return all RuleSets for "tableId:<any colId>", not including "tableId:*".
  public getAllColumnRuleSets(tableId: string): RuleSet[] {
    return this._columnRuleSets.get(tableId) || [];
  }

  // Return the RuleSet for "tableId:*".
  public getTableDefaultRuleSet(tableId: string): RuleSet|undefined {
    return this._tableRuleSets.get(tableId);
  }

  // Return the RuleSet for "*:*".
  public getDocDefaultRuleSet(): RuleSet {
    return this._defaultRuleSet;
  }

  // Return the list of all tableId mentions in ACL rules.
  public getAllTableIds(): string[] {
    return this._tableIds;
  }

  // Returns a Map of user attribute name to the corresponding UserAttributeRule.
  public getUserAttributeRules(): Map<string, UserAttributeRule> {
    return this._userAttributeRules;
  }

  /**
   * Update granular access from DocData.
   */
  public async update(docData: DocData, options: ReadAclOptions) {
    const {ruleSets, userAttributes} = this._safeReadAclRules(docData, options);

    // Build a map of user characteristics rules.
    const userAttributeMap = new Map<string, UserAttributeRule>();
    for (const userAttr of userAttributes) {
      userAttributeMap.set(userAttr.name, userAttr);
    }

    // Build maps of ACL rules.
    const colRuleSets = new Map<string, RuleSet[]>();
    const tableColMap = new Map<string, RuleSet>();
    const tableRuleSets = new Map<string, RuleSet>();
    const tableIds = new Set<string>();
    let defaultRuleSet: RuleSet = DEFAULT_RULE_SET;

    this._haveRules = (ruleSets.length > 0);
    for (const ruleSet of ruleSets) {
      if (ruleSet.tableId === '*') {
        if (ruleSet.colIds === '*') {
          defaultRuleSet = {
            ...ruleSet,
            body: [...ruleSet.body, ...DEFAULT_RULE_SET.body],
          };
        } else {
          // tableId of '*' cannot list particular columns.
          throw new Error(`Invalid rule for tableId ${ruleSet.tableId}, colIds ${ruleSet.colIds}`);
        }
      } else if (ruleSet.colIds === '*') {
        tableIds.add(ruleSet.tableId);
        if (tableRuleSets.has(ruleSet.tableId)) {
          throw new Error(`Invalid duplicate default rule for ${ruleSet.tableId}`);
        }
        tableRuleSets.set(ruleSet.tableId, ruleSet);
      } else {
        tableIds.add(ruleSet.tableId);
        getSetMapValue(colRuleSets, ruleSet.tableId, () => []).push(ruleSet);
        for (const colId of ruleSet.colIds) {
          tableColMap.set(`${ruleSet.tableId}:${colId}`, ruleSet);
        }
      }
    }

    // Update GranularAccess state.
    this._columnRuleSets = colRuleSets;
    this._tableColumnMap = tableColMap;
    this._tableRuleSets = tableRuleSets;
    this._defaultRuleSet = defaultRuleSet;
    this._tableIds = [...tableIds];
    this._userAttributeRules = userAttributeMap;
  }

  /**
   * Check that all references to table and column IDs in ACL rules are valid.
   */
  public checkDocEntities(docData: DocData) {
    const tablesTable = docData.getTable('_grist_Tables')!;
    const columnsTable = docData.getTable('_grist_Tables_column')!;

    // Collect valid tableIds and check rules against those.
    const validTableIds = new Set(tablesTable.getColValues('tableId'));
    const invalidTables = this.getAllTableIds().filter(t => !validTableIds.has(t));
    if (invalidTables.length > 0) {
      throw new Error(`Invalid tables in rules: ${invalidTables.join(', ')}`);
    }

    // Collect valid columns, grouped by tableRef (rowId of table record).
    const validColumns = new Map<number, Set<CellValue>>();   // Map from tableRef to set of colIds.
    const colTableRefs = columnsTable.getColValues('parentId')!;
    for (const [i, colId] of columnsTable.getColValues('colId')!.entries()) {
      getSetMapValue(validColumns, colTableRefs[i], () => new Set()).add(colId);
    }

    // For each table, check that any explicitly mentioned columns are valid.
    for (const tableId of this.getAllTableIds()) {
      const tableRef = tablesTable.findRow('tableId', tableId);
      const validTableCols = validColumns.get(tableRef);
      for (const ruleSet of this.getAllColumnRuleSets(tableId)) {
        if (Array.isArray(ruleSet.colIds)) {
          const invalidColIds = ruleSet.colIds.filter(c => !validTableCols?.has(c));
          if (invalidColIds.length > 0) {
            throw new Error(`Invalid columns in rules for table ${tableId}: ${invalidColIds.join(', ')}`);
          }
        }
      }
    }

    // Check for valid tableId/lookupColId combinations in UserAttribute rules.
    const invalidUAColumns: string[] = [];
    for (const rule of this.getUserAttributeRules().values()) {
      const tableRef = tablesTable.findRow('tableId', rule.tableId);
      const colRef = columnsTable.findMatchingRowId({parentId: tableRef, colId: rule.lookupColId});
      if (!colRef) {
        invalidUAColumns.push(`${rule.tableId}.${rule.lookupColId}`);
      }
    }
    if (invalidUAColumns.length > 0) {
      throw new Error(`Invalid columns in User Attribute rules: ${invalidUAColumns.join(', ')}`);
    }
  }

  private _safeReadAclRules(docData: DocData, options: ReadAclOptions): ReadAclResults {
    try {
      this.ruleError = undefined;
      return readAclRules(docData, options);
    } catch (e) {
      this.ruleError = e;  // Report the error indirectly.
      return {ruleSets: [EMERGENCY_RULE_SET], userAttributes: []};
    }
  }
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
function readAclRules(docData: DocData, {log, compile}: ReadAclOptions): ReadAclResults {
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
      throw new Error(`ACLRule ${rules[0].id} refers to an invalid ACLResource ${resourceId}`);
      continue;
    }
    if (!resourceRec.tableId || !resourceRec.colIds) {
      // This should only be the case for the old-style default rule/resource, which we
      // intentionally ignore and skip.
      continue;
    }
    const tableId = resourceRec.tableId as string;
    const colIds = resourceRec.colIds === '*' ? '*' : (resourceRec.colIds as string).split(',');

    const body: RulePart[] = [];
    for (const rule of rules) {
      if (rule.userAttributes) {
        if (tableId !== '*' || colIds !== '*') {
          throw new Error(`ACLRule ${rule.id} invalid; user attributes must be on the default resource`);
          continue;
        }
        const parsed = JSON.parse(String(rule.userAttributes));
        // TODO: could perhaps use ts-interface-checker here.
        if (!(parsed && typeof parsed === 'object' &&
          [parsed.name, parsed.tableId, parsed.lookupColId, parsed.charId]
          .every(p => p && typeof p === 'string'))) {
          throw new Error(`User attribute rule ${rule.id} is invalid`);
          continue;
        }
        parsed.origRecord = rule;
        userAttributes.push(parsed as UserAttributeRule);
      } else if (body.length > 0 && !body[body.length - 1].aclFormula) {
        throw new Error(`ACLRule ${rule.id} invalid because listed after default rule`);
      } else if (rule.aclFormula && !rule.aclFormulaParsed) {
        throw new Error(`ACLRule ${rule.id} invalid because missing its parsed formula`);
      } else {
        body.push({
          origRecord: rule,
          aclFormula: String(rule.aclFormula),
          matchFunc: rule.aclFormula ? compile?.(JSON.parse(String(rule.aclFormulaParsed))) : defaultMatchFunc,
          permissions: parsePermissions(String(rule.permissionsText)),
          permissionsText: String(rule.permissionsText),
        });
      }
    }
    const ruleSet: RuleSet = {tableId, colIds, body};
    ruleSets.push(ruleSet);
  }
  return {ruleSets, userAttributes};
}
