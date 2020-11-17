import { MixedPermissionSet, PartialPermissionSet, TablePermissionSet } from 'app/common/ACLPermissions';
import { makePartialPermissions, mergePartialPermissions, mergePermissions } from 'app/common/ACLPermissions';
import { emptyPermissionSet, parsePermissions, toMixed } from 'app/common/ACLPermissions';
import { ActionGroup } from 'app/common/ActionGroup';
import { createEmptyActionSummary } from 'app/common/ActionSummary';
import { Query } from 'app/common/ActiveDocAPI';
import { BulkColValues, CellValue, ColValues, DocAction } from 'app/common/DocActions';
import { TableDataAction, UserAction } from 'app/common/DocActions';
import { DocData } from 'app/common/DocData';
import { ErrorWithCode } from 'app/common/ErrorWithCode';
import { AclMatchInput, InfoView } from 'app/common/GranularAccessClause';
import { readAclRules, RuleSet, UserAttributeRule, UserInfo } from 'app/common/GranularAccessClause';
import { getSetMapValue } from 'app/common/gutil';
import { canView } from 'app/common/roles';
import { compileAclFormula } from 'app/server/lib/ACLFormula';
import { getDocSessionAccess, getDocSessionUser, OptDocSession } from 'app/server/lib/DocSession';
import * as log from 'app/server/lib/log';
import cloneDeep = require('lodash/cloneDeep');
import get = require('lodash/get');
import pullAt = require('lodash/pullAt');

// tslint:disable:no-bitwise

// Actions that may be allowed for a user with nuanced access to a document, depending
// on what table they refer to.
const ACTION_WITH_TABLE_ID = new Set(['AddRecord', 'BulkAddRecord', 'UpdateRecord', 'BulkUpdateRecord',
                                      'RemoveRecord', 'BulkRemoveRecord',
                                      'ReplaceTableData', 'TableData',
                                    ]);

// Actions that won't be allowed (yet) for a user with nuanced access to a document.
// A few may be innocuous, but generally I've put them in this list if there are problems
// tracking down what table the refer to, or they could allow creation/modification of a
// formula.
const SPECIAL_ACTIONS = new Set(['InitNewDoc',
                                 'EvalCode',
                                 'SetDisplayFormula',
                                 'CreateViewSection',
                                 'UpdateSummaryViewSection',
                                 'DetachSummaryViewSection',
                                 'GenImporterView',
                                 'TransformAndFinishImport',
                                 'AddColumn', 'RemoveColumn', 'RenameColumn', 'ModifyColumn',
                                 'AddTable', 'RemoveTable', 'RenameTable',
                                 'AddView',
                                 'CopyFromColumn',
                                 'AddHiddenColumn',
                                 'RemoveViewSection'
                                ]);

// Odd-ball actions marked as deprecated or which seem unlikely to be used.
const SURPRISING_ACTIONS = new Set([
                                    'RemoveView',
                                    'AddViewSection',
                                   ]);

// Actions we'll allow unconditionally for now.
const OK_ACTIONS = new Set(['Calculate', 'AddEmptyTable']);

// This is the hard-coded default RuleSet that's added to any user-created default rule.
const DEFAULT_RULE_SET: RuleSet = {
  tableId: '*',
  colIds: '*',
  body: [{
    aclFormula: "user.Role in ['editors', 'owners']",
    matchFunc:  (input) => ['editors', 'owners'].includes(String(input.user.Access)),
    permissions: parsePermissions('all'),
    permissionsText: 'all',
  }, {
    aclFormula: "user.Role in ['viewers']",
    matchFunc:  (input) => ['viewers'].includes(String(input.user.Access)),
    permissions: parsePermissions('+R'),
    permissionsText: 'none',
  }],
  defaultPermissions: parsePermissions('none'),
};

/**
 *
 * Manage granular access to a document.  This allows nuances other than the coarse
 * owners/editors/viewers distinctions.  As a placeholder for a future representation,
 * nuances are stored in the _grist_ACLResources table.
 *
 */
export class GranularAccess {
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

  // Cache any tables that we need to look-up for access control decisions.
  // This is an unoptimized implementation that is adequate if the tables
  // are not large and don't change all that often.
  private _characteristicTables = new Map<string, CharacteristicTable>();

  // Cache of PermissionInfo associated with the given docSession. It's a WeakMap, so should allow
  // both to be garbage-collected once docSession is no longer in use.
  private _permissionInfoMap = new WeakMap<OptDocSession, PermissionInfo>();


  public constructor(private _docData: DocData, private _fetchQuery: (query: Query) => Promise<TableDataAction>) {
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

  /**
   * Update granular access from DocData.
   */
  public async update() {
    const {ruleSets, userAttributes} = readAclRules(this._docData, {log, compile: compileAclFormula});

    // Build a map of user characteristics rules.
    const userAttributeMap = new Map<string, UserAttributeRule>();
    for (const userAttr of userAttributes) {
      userAttributeMap.set(userAttr.name, userAttr);
    }

    // Build maps of ACL rules.
    const colRuleSets = new Map<string, RuleSet[]>();
    const tableColMap = new Map<string, RuleSet>();
    const tableRuleSets = new Map<string, RuleSet>();
    let defaultRuleSet: RuleSet = DEFAULT_RULE_SET;

    this._haveRules = (ruleSets.length > 0);
    for (const ruleSet of ruleSets) {
      if (ruleSet.tableId === '*') {
        if (ruleSet.colIds === '*') {
          defaultRuleSet = {
            ...ruleSet,
            body: [...ruleSet.body, ...DEFAULT_RULE_SET.body],
            defaultPermissions: DEFAULT_RULE_SET.defaultPermissions,
          };
        } else {
          // tableId of '*' cannot list particular columns.
          throw new Error(`Invalid rule for tableId ${ruleSet.tableId}, colIds ${ruleSet.colIds}`);
        }
      } else if (ruleSet.colIds === '*') {
        if (tableRuleSets.has(ruleSet.tableId)) {
          throw new Error(`Invalid duplicate default rule for ${ruleSet.tableId}`);
        }
        tableRuleSets.set(ruleSet.tableId, ruleSet);
      } else {
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
    this._tableIds = [...new Set([...colRuleSets.keys(), ...tableRuleSets.keys()])];
    this._userAttributeRules = userAttributeMap;
    // Also clear the per-docSession cache of rule evaluations.
    this._permissionInfoMap = new WeakMap();
    // TODO: optimize this.
    await this._updateCharacteristicTables();
  }

  /**
   * Check whether user can carry out query.
   */
  public hasQueryAccess(docSession: OptDocSession, query: Query) {
    return this.hasTableAccess(docSession, query.tableId);
  }

  /**
   * Check whether user has any access to table.
   */
  public hasTableAccess(docSession: OptDocSession, tableId: string) {
    const pset = this.getTableAccess(docSession, tableId);
    return pset.read !== 'deny';
  }

  /**
   * Filter DocActions to be sent to a client.
   */
  public filterOutgoingDocActions(docSession: OptDocSession, docActions: DocAction[]): DocAction[] {
    return docActions.map(action => this.pruneOutgoingDocAction(docSession, action))
      .filter(_docActions => _docActions !== null) as DocAction[];
  }

  /**
   * Filter an ActionGroup to be sent to a client.
   */
  public filterActionGroup(docSession: OptDocSession, actionGroup: ActionGroup): ActionGroup {
    // TODO This seems a mistake -- should this check be negated?
    if (!this.allowActionGroup(docSession, actionGroup)) { return actionGroup; }
    // For now, if there's any nuance at all, suppress the summary and description.
    // TODO: create an empty action summary, to be sure not to leak anything important.
    const result: ActionGroup = { ...actionGroup };
    result.actionSummary = createEmptyActionSummary();
    result.desc = '';
    return result;
  }

  /**
   * Check whether an ActionGroup can be sent to the client.  TODO: in future, we'll want
   * to filter acceptible parts of ActionGroup, rather than denying entirely.
   */
  public allowActionGroup(docSession: OptDocSession, actionGroup: ActionGroup): boolean {
    return this.canReadEverything(docSession);
  }

  /**
   * Check if user can apply a list of actions.
   */
  public canApplyUserActions(docSession: OptDocSession, actions: UserAction[]): boolean {
    return actions.every(action => this.canApplyUserAction(docSession, action));
  }

  /**
   * Check if user can apply a given action to the document.
   */
  public canApplyUserAction(docSession: OptDocSession, a: UserAction|DocAction): boolean {
    const name = a[0] as string;
    if (OK_ACTIONS.has(name)) { return true; }
    if (SPECIAL_ACTIONS.has(name)) {
      return !this.hasNuancedAccess(docSession);
    }
    if (SURPRISING_ACTIONS.has(name)) {
      return this.hasFullAccess(docSession);
    }
    const isTableAction = ACTION_WITH_TABLE_ID.has(name);
    if (a[0] === 'ApplyUndoActions') {
      return this.canApplyUserActions(docSession, a[1] as UserAction[]);
    } else if (a[0] === 'ApplyDocActions') {
      return this.canApplyUserActions(docSession, a[1] as UserAction[]);
    } else if (isTableAction) {
      const tableId = a[1] as string;
      // If there are any access control nuances, deny _grist_* tables.
      // TODO: this is very crude, loosen this up appropriately.
      if (tableId.startsWith('_grist_')) {
        return !this.hasNuancedAccess(docSession);
      }
      const tableAccess = this.getTableAccess(docSession, tableId);
      // For now, if there are any row restrictions, forbid editing.
      // To allow editing, we'll need something that has access to full row,
      // e.g. data engine (and then an equivalent for ondemand tables), or
      // to fetch rows at this point.
      // TODO We can now look properly at the create/update/delete/schemaEdit permissions in pset.
      return tableAccess.read === 'allow';
    }
    return false;
  }

  /**
   * Cut out any rows/columns not accessible to the user.  May throw a NEED_RELOAD
   * exception if the information needed to achieve the desired pruning is not available.
   * Returns null if the action is entirely pruned.  The action passed in is never modified.
   */
  public pruneOutgoingDocAction(docSession: OptDocSession, a: DocAction): DocAction|null {
    const tableId = a[1] as string;
    const permInfo = this._getAccess(docSession);
    const tableAccess = permInfo.getTableAccess(tableId);
    if (tableAccess.read === 'deny') { return null; }
    if (tableAccess.read === 'allow') { return a; }

    if (tableAccess.read === 'mixed') {
      // For now, trigger a reload, since we don't have the
      // information we need to filter rows.  Reloads would be very
      // annoying if user is working on something, but at least data
      // won't be stale.  TODO: improve!
      throw new ErrorWithCode('NEED_RELOAD', 'document needs reload');
    }

    if (a[0] === 'RemoveRecord' || a[0] === 'BulkRemoveRecord') {
      return a;
    } else if (a[0] === 'AddRecord' || a[0] === 'BulkAddRecord' || a[0] === 'UpdateRecord' ||
               a[0] === 'BulkUpdateRecord' || a[0] === 'ReplaceTableData' || a[0] === 'TableData') {
      const na = cloneDeep(a);
      this._filterColumns(na[3], (colId) => permInfo.getColumnAccess(tableId, colId).read !== 'deny');
      if (Object.keys(na[3]).length === 0) { return null; }
      return na;
    } else if (a[0] === 'AddColumn' || a[0] === 'RemoveColumn' || a[0] === 'RenameColumn' ||
               a[0] === 'ModifyColumn') {
      const na = cloneDeep(a);
      const colId: string = na[2];
      if (permInfo.getColumnAccess(tableId, colId).read === 'deny') { return null; }
      throw new ErrorWithCode('NEED_RELOAD', 'document needs reload');
    } else {
      // Remaining cases of AddTable, RemoveTable, RenameTable should have
      // been handled at the table level.
    }
    // TODO: handle access to changes in metadata (trigger a reload at least, if
    // all else fails).
    return a;
  }

  /**
   * Check whether access is simple, or there are granular nuances that need to be
   * worked through.  Currently if there are no owner-only tables, then everyone's
   * access is simple and without nuance.
   */
  public hasNuancedAccess(docSession: OptDocSession): boolean {
    if (!this._haveRules) { return false; }
    return !this.hasFullAccess(docSession);
  }

  /**
   * Check whether user can read everything in document.
   */
  public canReadEverything(docSession: OptDocSession): boolean {
    const permInfo = this._getAccess(docSession);
    return permInfo.getFullAccess().read === 'allow';
  }

  /**
   * Check whether user has owner-level access to the document.
   */
  public hasFullAccess(docSession: OptDocSession): boolean {
    const access = getDocSessionAccess(docSession);
    return access === 'owners';
  }

  /**
   * Check for view access to the document.  For most code paths, a request or message
   * won't even be considered if there isn't view access, but there's no harm in double
   * checking.
   */
  public hasViewAccess(docSession: OptDocSession): boolean {
    const access = getDocSessionAccess(docSession);
    return canView(access);
  }

  /**
   *
   * If the user does not have access to the full document, we need to filter out
   * parts of the document metadata.  For simplicity, we overwrite rather than
   * filter for now, so that the overall structure remains consistent.  We overwrite:
   *
   *   - names, textual ids, formulas, and other textual options
   *   - foreign keys linking columns/views/sections back to a forbidden table
   *
   * On the client, a page with a blank name will be marked gracefully as unavailable.
   *
   * Some information leaks, for example the existence of private tables and how
   * many columns they had, and something of the relationships between them. Long term,
   * it could be better to zap rows entirely, and do the work of cleaning up any cross
   * references to them.
   *
   */
  public filterMetaTables(docSession: OptDocSession,
                          tables: {[key: string]: TableDataAction}): {[key: string]: TableDataAction} {
    // If user has right to read everything, return immediately.
    if (this.canReadEverything(docSession)) { return tables; }
    // If we are going to modify metadata, make a copy.
    tables = JSON.parse(JSON.stringify(tables));
    // Collect a list of all tables (by tableRef) to which the user has no access.
    const censoredTables: Set<number> = new Set();
    // Collect a list of censored columns (by "<tableRef> <colId>").
    const columnCode = (tableRef: number, colId: string) => `${tableRef} ${colId}`;
    const censoredColumnCodes: Set<string> = new Set();
    const permInfo = this._getAccess(docSession);
    for (const tableId of this.getAllTableIds()) {
      const tableAccess = permInfo.getTableAccess(tableId);
      let tableRef: number|undefined = 0;
      if (tableAccess.read === 'deny') {
        tableRef = this._docData.getTable('_grist_Tables')?.findRow('tableId', tableId);
        if (tableRef) { censoredTables.add(tableRef); }
      }
      for (const ruleSet of this.getAllColumnRuleSets(tableId)) {
        if (Array.isArray(ruleSet.colIds)) {
          for (const colId of ruleSet.colIds) {
            if (permInfo.getColumnAccess(tableId, colId).read === 'deny') {
              if (!tableRef) {
                tableRef = this._docData.getTable('_grist_Tables')?.findRow('tableId', tableId);
              }
              if (tableRef) { censoredColumnCodes.add(columnCode(tableRef, colId)); }
            }
          }
        }
      }
    }
    // Collect a list of all sections and views containing a table to which the user has no access.
    const censoredSections: Set<number> = new Set();
    const censoredViews: Set<number> = new Set();
    for (const section of this._docData.getTable('_grist_Views_section')?.getRecords() || []) {
      if (!censoredTables.has(section.tableRef as number)) { continue; }
      if (section.parentId) { censoredViews.add(section.parentId as number); }
      censoredSections.add(section.id);
    }
    // Collect a list of all columns from tables to which the user has no access.
    const censoredColumns: Set<number> = new Set();
    for (const column of this._docData.getTable('_grist_Tables_column')?.getRecords() || []) {
      if (censoredTables.has(column.parentId as number) ||
          censoredColumnCodes.has(columnCode(column.parentId as number, column.colId as string))) {
        censoredColumns.add(column.id);
      }
    }
    // Collect a list of all fields from sections to which the user has no access.
    const censoredFields: Set<number> = new Set();
    for (const field of this._docData.getTable('_grist_Views_section_field')?.getRecords() || []) {
      if (!censoredSections.has(field.parentId as number) &&
          !censoredColumns.has(field.colRef as number)) { continue; }
      censoredFields.add(field.id);
    }
    // Clear the tableId for any tables the user does not have access to.  This is just
    // to keep the name of the table private, in case its name itself is sensitive.
    // TODO: tableId may appear elsewhere, such as in _grist_ACLResources - user with
    // nuanced rights probably should not receive that table.
    this._censor(tables._grist_Tables, censoredTables, (idx, cols) => {
      cols.tableId[idx] = '';
    });
    // Clear the name of private views, in case the name itself is sensitive.
    this._censor(tables._grist_Views, censoredViews, (idx, cols) => {
      cols.name[idx] = '';
    });
    // Clear the title of private sections, and break the connection with the private
    // table as extra grit in the way of snooping.
    this._censor(tables._grist_Views_section, censoredSections, (idx, cols) => {
      cols.title[idx] = '';
      cols.tableRef[idx] = 0;
    });
    // Clear text metadata from private columns, and break the connection with the
    // private table.
    this._censor(tables._grist_Tables_column, censoredColumns, (idx, cols) => {
      cols.label[idx] = cols.colId[idx] = '';
      cols.widgetOptions[idx] = cols.formula[idx] = '';
      cols.type[idx] = 'Any';
      cols.parentId[idx] = 0;
    });
    // Clear text metadata from private fields, and break the connection with the
    // private table.
    this._censor(tables._grist_Views_section_field, censoredFields, (idx, cols) => {
      cols.widgetOptions[idx] = cols.filter[idx] = '';
      cols.parentId[idx] = 0;
    });
    return tables;
  }

  /**
   * Distill the clauses for the given session and table, to figure out the
   * access level and any row-level access functions needed.
   */
  public getTableAccess(docSession: OptDocSession, tableId: string): TablePermissionSet {
    return this._getAccess(docSession).getTableAccess(tableId);
  }

  /**
   * Modify table data in place, removing any rows or columns to which access
   * is not granted.
   */
  public filterData(docSession: OptDocSession, data: TableDataAction) {
    const permInfo = this._getAccess(docSession);
    const tableId = data[1] as string;
    if (permInfo.getTableAccess(tableId).read === 'mixed') {
      this.filterRows(docSession, data);
    }

    // Filter columns, omitting any to which the user has no access, regardless of rows.
    this._filterColumns(data[3], (colId) => permInfo.getColumnAccess(tableId, colId).read !== 'deny');
  }

  /**
   * Modify table data in place, removing any rows and scrubbing any cells to which access
   * is not granted.
   */
  public filterRows(docSession: OptDocSession, data: TableDataAction) {
    const rowCursor = new RecordView(data, 0);
    const input: AclMatchInput = {user: this._getUser(docSession), rec: rowCursor};

    const [, tableId, rowIds, colValues] = data;
    const toRemove: number[] = [];
    for (let idx = 0; idx < rowIds.length; idx++) {
      rowCursor.index = idx;

      const rowPermInfo = new PermissionInfo(this, input);
      // getTableAccess() evaluates all column rules for THIS record. So it's really rowAccess.
      const rowAccess = rowPermInfo.getTableAccess(tableId);
      if (rowAccess.read === 'deny') {
        toRemove.push(idx);
      } else if (rowAccess.read !== 'allow') {
        // Go over column rules.
        for (const colId of Object.keys(colValues)) {
          const colAccess = rowPermInfo.getColumnAccess(tableId, colId);
          if (colAccess.read !== 'allow') {
            colValues[colId][idx] = 'CENSORED';   // TODO Pick a suitable value
          }
        }
      }
    }

    if (toRemove.length > 0) {
      pullAt(rowIds, toRemove);
      for (const values of Object.values(colValues)) {
        pullAt(values, toRemove);
      }
    }
  }

  /**
   * Remove columns from a ColumnValues parameter of certain DocActions, using a predicate for
   * which columns to keep.
   */
  private _filterColumns(data: BulkColValues|ColValues, shouldInclude: (colId: string) => boolean) {
    for (const colId of Object.keys(data)) {
      if (!shouldInclude(colId)) {
        delete data[colId];
      }
    }
  }

  /**
   * Modify the given TableDataAction in place by calling the supplied operation with
   * the indexes of any ids supplied and the columns in that TableDataAction.
   */
  private _censor(table: TableDataAction, ids: Set<number>,
                  op: (idx: number, cols: BulkColValues) => unknown) {
    const availableIds = table[2];
    const cols = table[3];
    for (let idx = 0; idx < availableIds.length; idx++) {
      if (ids.has(availableIds[idx])) { op(idx, cols); }
    }
  }

  /**
   * When comparing user characteristics, we lowercase for the sake of email comparison.
   * This is a bit weak.
   */
  private _normalizeValue(value: CellValue|InfoView): string {
    // If we get a record, e.g. `user.office`, interpret it as `user.office.id` (rather than try
    // to use stringification of the full record).
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      value = value.get('id');
    }
    return JSON.stringify(value).toLowerCase();
  }

  /**
   * Load any tables needed for look-ups.
   */
  private async _updateCharacteristicTables() {
    this._characteristicTables.clear();
    for (const userChar of this._userAttributeRules.values()) {
      await this._updateCharacteristicTable(userChar);
    }
  }

  /**
   * Load a table needed for look-up.
   */
  private async _updateCharacteristicTable(clause: UserAttributeRule) {
    if (this._characteristicTables.get(clause.name)) {
      throw new Error(`User attribute ${clause.name} ignored: duplicate name`);
    }
    const data = await this._fetchQuery({tableId: clause.tableId, filters: {}});
    const rowNums = new Map<string, number>();
    const matches = data[3][clause.lookupColId];
    for (let i = 0; i < matches.length; i++) {
      rowNums.set(this._normalizeValue(matches[i]), i);
    }
    const result: CharacteristicTable = {
      tableId: clause.tableId,
      colId: clause.lookupColId,
      rowNums,
      data
    };
    this._characteristicTables.set(clause.name, result);
  }

  /**
   * Get PermissionInfo for the user represented by the given docSession. The returned object
   * allows evaluating access level as far as possible without considering specific records.
   *
   * The result is cached in a WeakMap, and PermissionInfo does its own caching, so multiple calls
   * to this._getAccess(docSession).someMethod() will reuse already-evaluated results.
   */
  private _getAccess(docSession: OptDocSession): PermissionInfo {
    // TODO The intent of caching is to avoid duplicating rule evaluations while processing a
    // single request. Caching based on docSession is riskier since those persist across requests.
    return getSetMapValue(this._permissionInfoMap as Map<OptDocSession, PermissionInfo>, docSession,
      () => new PermissionInfo(this, {user: this._getUser(docSession)}));
  }

  /**
   * Construct the UserInfo needed for evaluating rules. This also enriches the user with values
   * created by user-attribute rules.
   */
  private _getUser(docSession: OptDocSession): UserInfo {
    const access = getDocSessionAccess(docSession);
    const fullUser = getDocSessionUser(docSession);
    const user: UserInfo = {};
    user.Access = access;
    user.UserID = fullUser?.id || null;
    user.Email = fullUser?.email || null;
    user.Name = fullUser?.name || null;

    for (const clause of this._userAttributeRules.values()) {
      if (clause.name in user) {
        log.warn(`User attribute ${clause.name} ignored; conflicts with an existing one`);
        continue;
      }
      user[clause.name] = new EmptyRecordView();
      const characteristicTable = this._characteristicTables.get(clause.name);
      if (characteristicTable) {
        // User lodash's get() that supports paths, e.g. charId of 'a.b' would look up `user.a.b`.
        const character = this._normalizeValue(get(user, clause.charId) as CellValue);
        const rowNum = characteristicTable.rowNums.get(character);
        if (rowNum !== undefined) {
          user[clause.name] = new RecordView(characteristicTable.data, rowNum);
        }
      }
    }
    return user;
  }
}

/**
 * Evaluate a RuleSet on a given input (user and optionally record). If a record is needed but not
 * included, the result may include permission values like 'allowSome', 'denySome'.
 */
function evaluateRule(ruleSet: RuleSet, input: AclMatchInput): PartialPermissionSet {
  let pset: PartialPermissionSet = emptyPermissionSet();
  for (const rule of ruleSet.body) {
    try {
      if (rule.matchFunc!(input)) {
        pset = mergePartialPermissions(pset, rule.permissions);
      }
    } catch (e) {
      if (e.code === 'NEED_ROW_DATA') {
        pset = mergePartialPermissions(pset, makePartialPermissions(rule.permissions));
      } else {
        // For other errors, assume the rule is invalid, and treat as a non-match.
        // TODO An appropriate user should be alerted that a clause is not being honored.
        log.warn("ACLRule for %s failed: %s", ruleSet.tableId, e.message);
      }
    }
  }
  pset = mergePartialPermissions(pset, ruleSet.defaultPermissions);
  return pset;
}

/**
 * Helper for evaluating rules given a particular user and optionally a record. It evaluates rules
 * for a column, table, or document, with caching to avoid evaluating the same rule multiple times.
 */
class PermissionInfo {
  private _ruleResults = new Map<RuleSet, MixedPermissionSet>();

  // Construct a PermissionInfo for a particular input, which is a combination of user and
  // optionally a record.
  constructor(private _acls: GranularAccess, private _input: AclMatchInput) {}

  // Get permissions for "tableId:colId", defaulting to "tableId:*" and "*:*" as needed.
  // If 'mixed' is returned, different rows may have different permissions. It should never return
  // 'mixed' if the input includes `rec`.
  public getColumnAccess(tableId: string, colId: string): MixedPermissionSet {
    const ruleSet: RuleSet|undefined = this._acls.getColumnRuleSet(tableId, colId);
    return ruleSet ? this._processColumnRule(ruleSet) : this._getTableDefaultAccess(tableId);
  }

  // Combine permissions from all rules for the given table.
  // If 'mixedColumns' is returned, different columns have different permissions, but they do NOT
  // depend on rows. If 'mixed' is returned, some permissions depend on rows.
  public getTableAccess(tableId: string): TablePermissionSet {
    const columnAccess = this._acls.getAllColumnRuleSets(tableId).map(rs => this._processColumnRule(rs));
    columnAccess.push(this._getTableDefaultAccess(tableId));

    return mergePermissions(columnAccess, (bits) => (
      bits.every(b => b === 'allow') ? 'allow' :
      bits.every(b => b === 'deny') ? 'deny' :
      bits.every(b => b === 'allow' || b === 'deny') ? 'mixedColumns' :
      'mixed'
    ));
  }

  // Combine permissions from all rules throughout.
  // If 'mixed' is returned, then different tables, rows, or columns have different permissions.
  public getFullAccess(): MixedPermissionSet {
    const tableAccess = this._acls.getAllTableIds().map(tableId => this.getTableAccess(tableId));
    tableAccess.push(this._getDocDefaultAccess());

    return mergePermissions(tableAccess, (bits) => (
      bits.every(b => b === 'allow') ? 'allow' :
      bits.every(b => b === 'deny') ? 'deny' :
      'mixed'
    ));
  }

  // Get permissions for "tableId:*", defaulting to "*:*" as needed.
  // If 'mixed' is returned, different rows may have different permissions.
  private _getTableDefaultAccess(tableId: string): MixedPermissionSet {
    const ruleSet: RuleSet|undefined = this._acls.getTableDefaultRuleSet(tableId);
    return ruleSet ? this._processRule(ruleSet, () => this._getDocDefaultAccess()) :
      this._getDocDefaultAccess();
  }

  // Get permissions for "*:*".
  private _getDocDefaultAccess(): MixedPermissionSet {
    return this._processRule(this._acls.getDocDefaultRuleSet());
  }

  // Evaluate and cache the given column rule, falling back to the corresponding table default.
  private _processColumnRule(ruleSet: RuleSet): MixedPermissionSet {
    return this._processRule(ruleSet, () => this._getTableDefaultAccess(ruleSet.tableId));
  }

  // Evaluate the given rule, with the default fallback, and cache the result.
  private _processRule(ruleSet: RuleSet, defaultAccess?: () => MixedPermissionSet): MixedPermissionSet {
    return getSetMapValue(this._ruleResults, ruleSet, () => {
      const pset = evaluateRule(ruleSet, this._input);
      return toMixed(defaultAccess ? mergePartialPermissions(pset, defaultAccess()) : pset);
    });
  }
}

// A row-like view of TableDataAction, which is columnar in nature.
export class RecordView implements InfoView {
  public constructor(public data: TableDataAction, public index: number) {
  }

  public get(colId: string): CellValue {
    if (colId === 'id') {
      return this.data[2][this.index];
    }
    return this.data[3][colId][this.index];
  }

  public toJSON() {
    const results: {[key: string]: any} = {};
    for (const key of Object.keys(this.data[3])) {
      results[key] = this.data[3][key][this.index];
    }
    return results;
  }
}

class EmptyRecordView implements InfoView {
  public get(colId: string): CellValue { return null; }
  public toJSON() { return {}; }
}

/**
 * A cache of a table needed for look-ups, including a map from keys to
 * row numbers. Keys are produced by _getCharacteristicTableKey().
 */
interface CharacteristicTable {
  tableId: string;
  colId: string;
  rowNums: Map<string, number>;
  data: TableDataAction;
}
