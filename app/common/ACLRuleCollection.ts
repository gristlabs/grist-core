import {parsePermissions, permissionSetToText, splitSchemaEditPermissionSet} from 'app/common/ACLPermissions';
import {AVAILABLE_BITS_COLUMNS, AVAILABLE_BITS_TABLES, trimPermissions} from 'app/common/ACLPermissions';
import {ACLShareRules, TableWithOverlay} from 'app/common/ACLShareRules';
import {AclRuleProblem} from 'app/common/ActiveDocAPI';
import {DocData} from 'app/common/DocData';
import {AclMatchFunc, ParsedAclFormula, RulePart, RuleSet, UserAttributeRule} from 'app/common/GranularAccessClause';
import {getSetMapValue, isNonNullish} from 'app/common/gutil';
import {ShareOptions} from 'app/common/ShareOptions';
import {MetaRowRecord} from 'app/common/TableData';
import {decodeObject} from 'app/plugin/objtypes';
import sortBy = require('lodash/sortBy');

export type ILogger = Pick<Console, 'log'|'debug'|'info'|'warn'|'error'>;

const defaultMatchFunc: AclMatchFunc = () => true;

export const SPECIAL_RULES_TABLE_ID = '*SPECIAL';

// This is the hard-coded default RuleSet that's added to any user-created default rule.
const DEFAULT_RULE_SET: RuleSet = {
  tableId: '*',
  colIds: '*',
  body: [{
    aclFormula: "user.Access in [EDITOR, OWNER]",
    matchFunc:  (input) => ['editors', 'owners'].includes(String(input.user.Access)),
    permissions: parsePermissions('all'),
    permissionsText: 'all',
  }, {
    aclFormula: "user.Access in [VIEWER]",
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

// Check if the given resource is the special "SchemaEdit" resource, which only exists as a
// frontend representation.
export function isSchemaEditResource(resource: {tableId: string, colIds: string}): boolean {
  return resource.tableId === SPECIAL_RULES_TABLE_ID && resource.colIds === 'SchemaEdit';
}

const SPECIAL_RULE_SETS: Record<string, RuleSet> = {
  SchemaEdit: {
    tableId: SPECIAL_RULES_TABLE_ID,
    colIds: ['SchemaEdit'],
    body: [{
      aclFormula: "user.Access in [EDITOR, OWNER]",
      matchFunc:  (input) => ['editors', 'owners'].includes(String(input.user.Access)),
      permissions: parsePermissions('+S'),
      permissionsText: '+S',
    }, {
      aclFormula: "",
      matchFunc: defaultMatchFunc,
      permissions: parsePermissions('-S'),
      permissionsText: '-S',
    }],
  },
  AccessRules: {
    tableId: SPECIAL_RULES_TABLE_ID,
    colIds: ['AccessRules'],
    body: [{
      aclFormula: "user.Access in [OWNER]",
      matchFunc:  (input) => ['owners'].includes(String(input.user.Access)),
      permissions: parsePermissions('+R'),
      permissionsText: '+R',
    }, {
      aclFormula: "",
      matchFunc: defaultMatchFunc,
      permissions: parsePermissions('-R'),
      permissionsText: '-R',
    }],
  },
  FullCopies: {
    tableId: SPECIAL_RULES_TABLE_ID,
    colIds: ['FullCopies'],
    body: [{
      aclFormula: "user.Access in [OWNER]",
      matchFunc:  (input) => ['owners'].includes(String(input.user.Access)),
      permissions: parsePermissions('+R'),
      permissionsText: '+R',
    }, {
      aclFormula: "",
      matchFunc: defaultMatchFunc,
      permissions: parsePermissions('-R'),
      permissionsText: '-R',
    }],
  },
  SeedRule: {
    tableId: SPECIAL_RULES_TABLE_ID,
    colIds: ['SeedRule'],
    body: [],
  }
};

// If the user-created rules become dysfunctional, we can swap in this emergency set.
// It grants full access to owners, and no access to anyone else.
const EMERGENCY_RULE_SET: RuleSet = {
  tableId: '*',
  colIds: '*',
  body: [{
    aclFormula: "user.Access in [OWNER]",
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
  // Includes also SPECIAL_RULES_TABLE_ID.
  private _columnRuleSets = new Map<string, RuleSet[]>();

  // Maps 'tableId:colId' to one of the RuleSets in the list _columnRuleSets.get(tableId).
  private _tableColumnMap = new Map<string, RuleSet>();

  // Rules for SPECIAL_RULES_TABLE_ID "columns".
  private _specialRuleSets = new Map<string, RuleSet>();

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
    if (tableId === SPECIAL_RULES_TABLE_ID) { return this._specialRuleSets.get(colId); }
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

    // Collect special rules, combining them with corresponding defaults.
    const specialRuleSets = new Map<string, RuleSet>(Object.entries(SPECIAL_RULE_SETS));
    for (const ruleSet of ruleSets) {
      if (ruleSet.tableId === SPECIAL_RULES_TABLE_ID) {
        const specialType = String(ruleSet.colIds);
        const specialDefault = specialRuleSets.get(specialType);
        if (!specialDefault) {
          // Log that we are seeing an invalid rule, but don't fail.
          // (Historically, older versions of the Grist app will attempt to
          // open newer documents).
          options.log.error(`Invalid rule for ${ruleSet.tableId}:${ruleSet.colIds}`);
        } else {
          specialRuleSets.set(specialType, {...ruleSet, body: [...ruleSet.body, ...specialDefault.body]});
        }
      } else if (options.pullOutSchemaEdit && ruleSet.tableId === '*' && ruleSet.colIds === '*') {
        // If pullOutSchemaEdit is requested, we move out rules with SchemaEdit permissions from
        // the default resource into the ficticious "*SPECIAL:SchemaEdit" resource. This is used
        // in the frontend only, to present those rules in a separate section.
        const schemaParts = ruleSet.body.map(part => splitSchemaEditRulePart(part).schemaEdit).filter(isNonNullish);

        if (schemaParts.length > 0) {
          const specialType = 'SchemaEdit';
          const specialDefault = specialRuleSets.get(specialType)!;
          specialRuleSets.set(specialType, {
            tableId: SPECIAL_RULES_TABLE_ID,
            colIds: ['SchemaEdit'],
            body: [...schemaParts, ...specialDefault.body]
          });
        }
      }
    }

    // Insert the special rule sets into colRuleSets.
    for (const ruleSet of specialRuleSets.values()) {
      getSetMapValue(colRuleSets, SPECIAL_RULES_TABLE_ID, () => []).push(ruleSet);
    }

    this._haveRules = (ruleSets.length > 0);
    for (const ruleSet of ruleSets) {
      if (ruleSet.tableId === '*') {
        if (ruleSet.colIds === '*') {
          // If pullOutSchemaEdit is requested, skip the SchemaEdit rules for the default resource;
          // those got pulled out earlier into the fictitious "*SPECIAL:SchemaEdit" resource.
          const body = options.pullOutSchemaEdit ?
            ruleSet.body.map(part => splitSchemaEditRulePart(part).nonSchemaEdit).filter(isNonNullish) :
            ruleSet.body;

          defaultRuleSet = {
            ...ruleSet,
            body: [...body, ...DEFAULT_RULE_SET.body],
          };
        } else {
          // tableId of '*' cannot list particular columns.
          throw new Error(`Invalid rule for tableId ${ruleSet.tableId}, colIds ${ruleSet.colIds}`);
        }
      } else if (ruleSet.tableId === SPECIAL_RULES_TABLE_ID) {
        // Skip, since we handled these separately earlier.
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
    this._specialRuleSets = specialRuleSets;
  }

  /**
   * Check that all references to table and column IDs in ACL rules are valid.
   */
  public checkDocEntities(docData: DocData) {
    const problems = this.findRuleProblems(docData);
    if (problems.length === 0) { return; }
    throw new Error(problems[0].comment);
  }

  /**
   * Enumerate rule problems caused by table and column IDs that are not valid.
   * Problems include:
   *   - Rules for a table that does not exist
   *   - Rules for columns that include a column that does not exist
   *   - User attributes links to a column that does not exist
   */
  public findRuleProblems(docData: DocData): AclRuleProblem[] {
    const problems: AclRuleProblem[] = [];
    const tablesTable = docData.getMetaTable('_grist_Tables');
    const columnsTable = docData.getMetaTable('_grist_Tables_column');

    // Collect valid tableIds and check rules against those.
    const validTableIds = new Set(tablesTable.getColValues('tableId'));
    const invalidTables = this.getAllTableIds().filter(t => !validTableIds.has(t));
    if (invalidTables.length > 0) {
      problems.push({
        tables: {
          tableIds: invalidTables,
        },
        comment: `Invalid tables in rules: ${invalidTables.join(', ')}`,
      });
    }

    // Collect valid columns, grouped by tableRef (rowId of table record).
    const validColumns = new Map<number, Set<string>>();   // Map from tableRef to set of colIds.
    const colTableRefs = columnsTable.getColValues('parentId');
    for (const [i, colId] of columnsTable.getColValues('colId').entries()) {
      getSetMapValue(validColumns, colTableRefs[i], () => new Set()).add(colId);
    }

    // For each valid table, check that any explicitly mentioned columns are valid.
    for (const tableId of this.getAllTableIds()) {
      if (!validTableIds.has(tableId)) { continue; }
      const tableRef = tablesTable.findRow('tableId', tableId);
      const validTableCols = validColumns.get(tableRef);
      for (const ruleSet of this.getAllColumnRuleSets(tableId)) {
        if (Array.isArray(ruleSet.colIds)) {
          const invalidColIds = ruleSet.colIds.filter(c => !validTableCols?.has(c));
          if (invalidColIds.length > 0) {
            problems.push({
              columns: {
                tableId,
                colIds: invalidColIds,
              },
              comment: `Invalid columns in rules for table ${tableId}: ${invalidColIds.join(', ')}`,
            });
          }
        }
      }
    }

    // Check for valid tableId/lookupColId combinations in UserAttribute rules.
    const invalidUAColumns: string[] = [];
    const names: string[] = [];
    for (const rule of this.getUserAttributeRules().values()) {
      const tableRef = tablesTable.findRow('tableId', rule.tableId);
      const colRef = columnsTable.findMatchingRowId({
        parentId: tableRef, colId: rule.lookupColId,
      });
      if (!colRef) {
        invalidUAColumns.push(`${rule.tableId}.${rule.lookupColId}`);
        names.push(rule.name);
      }
    }
    if (invalidUAColumns.length > 0) {
      problems.push({
        userAttributes: {
          invalidUAColumns,
          names,
        },
        comment: `Invalid columns in User Attribute rules: ${invalidUAColumns.join(', ')}`,
      });
    }
    return problems;
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
  // If true, add and modify access rules in some special ways.
  // Specifically, call addHelperCols to add helper columns of restricted columns to rule sets,
  // and use ACLShareRules to implement any special shares as access rules.
  // Used in the server, but not in the client, because of at least the following:
  // 1. Rules would show in the UI
  // 2. Rules would be saved back after editing, causing them to accumulate
  enrichRulesForImplementation?: boolean;

  // If true, rules with 'schemaEdit' permission are moved out of the '*:*' resource into a
  // fictitious '*SPECIAL:SchemaEdit' resource. This is used only on the client, to present
  // schemaEdit as a separate checkbox. Such rules are saved back to the '*:*' resource.
  pullOutSchemaEdit?: boolean;
}

export interface ReadAclResults {
  ruleSets: RuleSet[];
  userAttributes: UserAttributeRule[];
}

/**
 * For each column in colIds, return the colIds of any hidden helper columns it has,
 * i.e. display columns of references, and conditional formatting rule columns.
 */
function getHelperCols(docData: DocData, tableId: string, colIds: string[], log: ILogger): string[] {
  const tablesTable = docData.getMetaTable('_grist_Tables');
  const columnsTable = docData.getMetaTable('_grist_Tables_column');
  const fieldsTable = docData.getMetaTable('_grist_Views_section_field');

  const tableRef = tablesTable.findRow('tableId', tableId);
  if (!tableRef) {
    return [];
  }

  const result: string[] = [];
  for (const colId of colIds) {
    const [column] = columnsTable.filterRecords({parentId: tableRef, colId});
    if (!column) {
      continue;
    }

    function addColsFromRefs(colRefs: unknown) {
      if (!Array.isArray(colRefs)) {
        return;
      }
      for (const colRef of colRefs) {
        if (typeof colRef !== 'number') {
          continue;
        }
        const extraCol = columnsTable.getRecord(colRef);
        if (!extraCol) {
          continue;
        }
        if (extraCol.colId.startsWith("gristHelper_") && extraCol.parentId === tableRef) {
          result.push(extraCol.colId);
        } else {
          log.error(`Invalid helper column ${extraCol.colId} of ${tableId}:${colId}`);
        }
      }
    }

    function addColsFromMetaRecord(rec: MetaRowRecord<'_grist_Tables_column' | '_grist_Views_section_field'>) {
      addColsFromRefs([rec.displayCol]);
      addColsFromRefs(decodeObject(rec.rules));
    }

    addColsFromMetaRecord(column);
    for (const field of fieldsTable.filterRecords({colRef: column.id})) {
      addColsFromMetaRecord(field);
    }
  }
  return result;
}


/**
 * Parse all ACL rules in the document from DocData into a list of RuleSets and of
 * UserAttributeRules. This is used by both client-side code and server-side.
 */
function readAclRules(docData: DocData, {log, compile, enrichRulesForImplementation}: ReadAclOptions): ReadAclResults {
  // Wrap resources and rules tables so we can have "virtual" rules
  // to implement special shares.
  const resourcesTable = new TableWithOverlay(docData.getMetaTable('_grist_ACLResources'));
  const rulesTable = new TableWithOverlay(docData.getMetaTable('_grist_ACLRules'));
  const sharesTable = docData.getMetaTable('_grist_Shares');

  const ruleSets: RuleSet[] = [];
  const userAttributes: UserAttributeRule[] = [];

  let hasShares: boolean = false;
  const shares = sharesTable.getRecords();
  // ACLShareRules is used to edit resourcesTable and rulesTable in place.
  const shareRules = new ACLShareRules(docData, resourcesTable, rulesTable);
  // Add virtual rules to implement shares, if there are any.
  // Add the virtual rules only when implementing/interpreting them, as
  // opposed to accessing them for presentation or manipulation in the UI.
  if (enrichRulesForImplementation && shares.length > 0) {
    for (const share of shares) {
      const options: ShareOptions = JSON.parse(share.options || '{}');
      shareRules.addRulesForShare(share.id, options);
    }
    shareRules.addDefaultRulesForShares();
    hasShares = true;
  }

  // Group rules by resource first, ordering by rulePos. Each group will become a RuleSet.
  const rulesByResource = new Map<number, Array<MetaRowRecord<'_grist_ACLRules'>>>();
  for (const ruleRecord of sortBy(rulesTable.getRecords(), 'rulePos')) {
    getSetMapValue(rulesByResource, ruleRecord.resource, () => []).push(ruleRecord);
  }

  for (const [resourceId, rules] of rulesByResource.entries()) {
    const resourceRec = resourcesTable.getRecord(resourceId);
    if (!resourceRec) {
      throw new Error(`ACLRule ${rules[0].id} refers to an invalid ACLResource ${resourceId}`);
    }
    if (!resourceRec.tableId || !resourceRec.colIds) {
      // This should only be the case for the old-style default rule/resource, which we
      // intentionally ignore and skip.
      continue;
    }
    const tableId = resourceRec.tableId;
    const colIds = resourceRec.colIds === '*' ? '*' : resourceRec.colIds.split(',');

    if (enrichRulesForImplementation && Array.isArray(colIds)) {
      colIds.push(...getHelperCols(docData, tableId, colIds, log));
    }

    const body: RulePart[] = [];
    for (const rule of rules) {
      if (rule.userAttributes) {
        if (tableId !== '*' || colIds !== '*') {
          throw new Error(`ACLRule ${rule.id} invalid; user attributes must be on the default resource`);
        }
        const parsed = JSON.parse(String(rule.userAttributes));
        // TODO: could perhaps use ts-interface-checker here.
        if (!(parsed && typeof parsed === 'object' &&
          [parsed.name, parsed.tableId, parsed.lookupColId, parsed.charId]
          .every(p => p && typeof p === 'string'))) {
          throw new Error(`User attribute rule ${rule.id} is invalid`);
        }
        parsed.origRecord = rule;
        userAttributes.push(parsed as UserAttributeRule);
      } else if (body.length > 0 && !body[body.length - 1].aclFormula) {
        throw new Error(`ACLRule ${rule.id} invalid because listed after default rule`);
      } else if (rule.aclFormula && !rule.aclFormulaParsed) {
        throw new Error(`ACLRule ${rule.id} invalid because missing its parsed formula`);
      } else {
        let aclFormulaParsed = rule.aclFormula && JSON.parse(String(rule.aclFormulaParsed));
        // If we have "virtual" rules to implement shares, then regular
        // rules need to be tweaked so that they don't apply when the
        // share is active.
        if (hasShares && rule.id >= 0) {
          aclFormulaParsed = shareRules.transformNonShareRules({rule, aclFormulaParsed});
        }
        let permissions = parsePermissions(String(rule.permissionsText));
        if (tableId !== '*' && tableId !== SPECIAL_RULES_TABLE_ID) {
          const availableBits = (colIds === '*') ? AVAILABLE_BITS_TABLES : AVAILABLE_BITS_COLUMNS;
          permissions = trimPermissions(permissions, availableBits);
        }
        body.push({
          origRecord: rule,
          aclFormula: String(rule.aclFormula),
          matchFunc: rule.aclFormula ? compile?.(aclFormulaParsed) : defaultMatchFunc,
          memo: rule.memo,
          permissions,
          permissionsText: permissionSetToText(permissions)
        });
      }
    }
    const ruleSet: RuleSet = {tableId, colIds, body};
    ruleSets.push(ruleSet);
  }
  return {ruleSets, userAttributes};
}


/**
 * In the UI, we present SchemaEdit rules in a separate section, even though in reality they live
 * as schemaEdit permission bits among the rules for the default resource. This function splits a
 * RulePart into two: one containing the schemaEdit permission bit, and the other containing the
 * other bits. If either part is empty, it will be returned as undefined, but if both are empty,
 * nonSchemaEdit will be included as a rule with empty permission bits.
 *
 * It's possible for both parts to be non-empty (for rules created before the updated UI), in
 * which case the schemaEdit one will have a fake origRecord, to cause it to be saved as a new
 * record when saving.
 */
function splitSchemaEditRulePart(rulePart: RulePart): {schemaEdit?: RulePart, nonSchemaEdit?: RulePart} {
  const p = splitSchemaEditPermissionSet(rulePart.permissions);
  let schemaEdit: RulePart|undefined;
  let nonSchemaEdit: RulePart|undefined;
  if (p.schemaEdit) {
    schemaEdit = {...rulePart,
      permissions: p.schemaEdit,
      permissionsText: permissionSetToText(p.schemaEdit),
    };
  }
  if (p.nonSchemaEdit) {
    nonSchemaEdit = {...rulePart,
      permissions: p.nonSchemaEdit,
      permissionsText: permissionSetToText(p.nonSchemaEdit),
    };
  }
  if (schemaEdit && nonSchemaEdit) {
    schemaEdit.origRecord = {id: -1} as MetaRowRecord<'_grist_ACLRules'>;
  }
  return {schemaEdit, nonSchemaEdit};
}
