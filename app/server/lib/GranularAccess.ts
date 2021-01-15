import { MixedPermissionSet, PartialPermissionSet, PermissionSet, TablePermissionSet } from 'app/common/ACLPermissions';
import { makePartialPermissions, mergePartialPermissions, mergePermissions } from 'app/common/ACLPermissions';
import { emptyPermissionSet, toMixed } from 'app/common/ACLPermissions';
import { ACLRuleCollection } from 'app/common/ACLRuleCollection';
import { ActionGroup } from 'app/common/ActionGroup';
import { createEmptyActionSummary } from 'app/common/ActionSummary';
import { Query } from 'app/common/ActiveDocAPI';
import { ApiError } from 'app/common/ApiError';
import { AsyncCreate } from 'app/common/AsyncCreate';
import { AddRecord, BulkAddRecord, BulkColValues, BulkRemoveRecord, BulkUpdateRecord } from 'app/common/DocActions';
import { RemoveRecord, ReplaceTableData, UpdateRecord } from 'app/common/DocActions';
import { CellValue, ColValues, DocAction, getTableId, isSchemaAction } from 'app/common/DocActions';
import { TableDataAction, UserAction } from 'app/common/DocActions';
import { DocData } from 'app/common/DocData';
import { UserOverride } from 'app/common/DocListAPI';
import { ErrorWithCode } from 'app/common/ErrorWithCode';
import { AclMatchInput, InfoView } from 'app/common/GranularAccessClause';
import { RuleSet, UserInfo } from 'app/common/GranularAccessClause';
import { getSetMapValue, isObject } from 'app/common/gutil';
import { canView, Role } from 'app/common/roles';
import { FullUser } from 'app/common/UserAPI';
import { HomeDBManager } from 'app/gen-server/lib/HomeDBManager';
import { compileAclFormula } from 'app/server/lib/ACLFormula';
import { getDocSessionAccess, getDocSessionUser, OptDocSession } from 'app/server/lib/DocSession';
import * as log from 'app/server/lib/log';
import { integerParam } from 'app/server/lib/requestUtils';
import { getRelatedRows, getRowIdsFromDocAction } from 'app/server/lib/RowAccess';
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

// Check if action has a tableId.
function isTableAction(a: UserAction): a is AddRecord | BulkAddRecord | UpdateRecord | BulkUpdateRecord |
    RemoveRecord | BulkRemoveRecord | ReplaceTableData | TableDataAction {
  return ACTION_WITH_TABLE_ID.has(String(a[0]));
}

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

/**
 *
 * Manage granular access to a document.  This allows nuances other than the coarse
 * owners/editors/viewers distinctions.  Nuances are stored in the _grist_ACLResources
 * and _grist_ACLRules tables.
 *
 * When the document is being modified, the object's GranularAccess is called at various
 * steps of the process to check access rights.  The GranularAccess object stores some
 * state for an in-progress modification, to allow some caching of calculations across
 * steps and clients.  We expect modifications to be serialized, and the following
 * pattern of calls for modifications:
 *
 *  - canMaybeApplyUserActions(), called with UserActions for an initial access check.
 *    Since not all checks can be done without analyzing UserActions into DocActions,
 *    it is ok for this call to pass even if a more definitive test later will fail.
 *  - canApplyDocActions(), called when DocActions have been produced from UserActions,
 *    but before those DocActions have been applied to the DB.  If fails, the modification
 *    will be abandoned.
 *  - appliedActions(), called when DocActions have been applied to the DB, but before
 *    those changes have been sent to clients.
 *  - filterActionGroup() and filterOutgoingDocActions() are called for each client.
 *  - finishedActions(), called when completely done with modification and any needed
 *    client notifications, whether successful or failed.
 *
 */
export class GranularAccess {
  // The collection of all rules, with helpful accessors.
  private _ruleCollection = new ACLRuleCollection();

  // Cache of PermissionInfo associated with the given docSession. It's a WeakMap, so should allow
  // both to be garbage-collected once docSession is no longer in use.
  private _permissionInfoMap = new WeakMap<OptDocSession, Promise<PermissionInfo>>();
  private _userAttributesMap = new WeakMap<OptDocSession, UserAttributes>();
  private _prevUserAttributesMap: WeakMap<OptDocSession, UserAttributes>|undefined;

  // When broadcasting a sequence of DocAction[]s, this contains the state of
  // affected rows for the relevant table before and after each DocAction.  It
  // may contain some unaffected rows as well.
  private _rowSnapshots: AsyncCreate<Array<[TableDataAction, TableDataAction]>>|null = null;
  // Flag tracking whether a set of actions have been applied to the database or not.
  private _applied: boolean = false;

  public constructor(
    private _docData: DocData,
    private _fetchQueryFromDB: (query: Query) => Promise<TableDataAction>,
    private _recoveryMode: boolean,
    private _homeDbManager: HomeDBManager | null,
    private _docId: string) {
  }

  /**
   * Update granular access from DocData.
   */
  public async update() {
    await this._ruleCollection.update(this._docData, {log, compile: compileAclFormula});

    // Also clear the per-docSession cache of rule evaluations and user attributes.
    this._permissionInfoMap = new WeakMap();
    this._userAttributesMap = new WeakMap();
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
  public async hasTableAccess(docSession: OptDocSession, tableId: string) {
    const pset = await this.getTableAccess(docSession, tableId);
    return pset.read !== 'deny';
  }

  /**
   * Called after UserAction[]s have been applied in the sandbox, and DocAction[]s have been
   * computed, but before we have committed those DocAction[]s to the database.  If this
   * throws an exception, the sandbox changes will be reverted.
   */
  public async canApplyDocActions(docSession: OptDocSession, docActions: DocAction[], undo: DocAction[]) {
    this._applied = false;
    if (this._ruleCollection.haveRules()) {
      this._prepareRowSnapshots(docActions, undo);
      await Promise.all(
        docActions.map((action, idx) => this._checkIncomingDocAction(docSession, action, idx)));
    }

    if (this._recoveryMode) {
      // Don't do any further checking in recovery mode.
      return;
    }

    // If the actions change any rules, verify that we'll be able to handle the changed rules. If
    // they are to cause an error, reject the action to avoid forcing user into recovery mode.
    if (docActions.some(docAction => ['_grist_ACLRules', '_grist_ACLResources'].includes(getTableId(docAction)))) {
      // Create a tmpDocData with just the tables we care about, then update docActions to it.
      const tmpDocData: DocData = new DocData(
        (tableId) => { throw new Error("Unexpected DocData fetch"); }, {
          _grist_Tables: this._docData.getTable('_grist_Tables')!.getTableDataAction(),
          _grist_Tables_column: this._docData.getTable('_grist_Tables_column')!.getTableDataAction(),
          _grist_ACLResources: this._docData.getTable('_grist_ACLResources')!.getTableDataAction(),
          _grist_ACLRules: this._docData.getTable('_grist_ACLRules')!.getTableDataAction(),
        });
      for (const da of docActions) {
        tmpDocData.receiveAction(da);
      }

      // Use the post-actions data to process the rules collection, and throw error if that fails.
      const ruleCollection = new ACLRuleCollection();
      await ruleCollection.update(tmpDocData, {log, compile: compileAclFormula});
      if (ruleCollection.ruleError) {
        throw new ApiError(ruleCollection.ruleError.message, 400);
      }
      try {
        ruleCollection.checkDocEntities(tmpDocData);
      } catch (err) {
        throw new ApiError(err.message, 400);
      }
    }
  }

  /**
   * This should be called after each action bundle has been applied to the database,
   * but before the actions are broadcast to clients.  It will set us up to be able
   * to efficiently filter those broadcasts.
   *
   * We expect actions bundles for a document to be applied+broadcast serially (the
   * broadcasts can be parallelized, but should complete before moving on to further
   * document mutation).
   */
  public async appliedActions(docActions: DocAction[], undo: DocAction[]) {
    this._applied = true;
    // If there is a rule change, redo from scratch for now.
    // TODO: this is placeholder code. Should deal with connected clients.
    if (docActions.some(docAction => getTableId(docAction) === '_grist_ACLRules' ||
        getTableId(docAction) === '_grist_Resources')) {
      await this.update();
      return;
    }
    if (!this._ruleCollection.haveRules()) { return; }
    // If there is a schema change, redo from scratch for now.
    // TODO: this is placeholder code. Should deal with connected clients.
    if (docActions.some(docAction => isSchemaAction(docAction))) {
      await this.update();
      return;
    }
    // Check if a table that affects user attributes has changed.  If so, put current
    // attributes aside for later comparison, and clear caches.
    const attrs = new Set([...this._ruleCollection.getUserAttributeRules().values()].map(r => r.tableId));
    if (docActions.some(docAction => attrs.has(getTableId(docAction)))) {
      this._prevUserAttributesMap = this._userAttributesMap;
      this._permissionInfoMap = new WeakMap();
      this._userAttributesMap = new WeakMap();
      return;
    }
  }

  /**
   * This should be called once an action bundle has been broadcast to all clients.
   * It will clean up any temporary state cached for filtering those broadcasts.
   */
  public async finishedActions() {
    this._applied = false;
    if (this._rowSnapshots) { this._rowSnapshots.clear(); }
    this._rowSnapshots = null;
    this._prevUserAttributesMap = undefined;
  }

  /**
   * Filter DocActions to be sent to a client.
   */
  public async filterOutgoingDocActions(docSession: OptDocSession, docActions: DocAction[]): Promise<DocAction[]> {
    await this._checkUserAttributes(docSession);
    const actions = await Promise.all(
      docActions.map((action, idx) => this._pruneOutgoingDocAction(docSession, action, idx)));
    return ([] as DocAction[]).concat(...actions);
  }

  /**
   * Filter an ActionGroup to be sent to a client.
   */
  public async filterActionGroup(docSession: OptDocSession, actionGroup: ActionGroup): Promise<ActionGroup> {
    if (await this.allowActionGroup(docSession, actionGroup)) { return actionGroup; }
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
  public async allowActionGroup(docSession: OptDocSession, actionGroup: ActionGroup): Promise<boolean> {
    return this.canReadEverything(docSession);
  }

  /**
   * Check if user may be able to apply a list of actions.  If it fails, the user cannot
   * apply the actions.  If it succeeds, the actions will need examination in more detail.
   * TODO: not smart about intermediate states, if there is a table or column rename it will
   * have trouble, and might forbid something that should be allowed.
   */
  public async canMaybeApplyUserActions(docSession: OptDocSession, actions: UserAction[]): Promise<boolean> {
    for (const action of actions) {
      if (!await this.canMaybeApplyUserAction(docSession, action)) { return false; }
    }
    return true;
  }

  /**
   * Check if user can apply a given action to the document.
   */
  public async canMaybeApplyUserAction(docSession: OptDocSession, a: UserAction|DocAction): Promise<boolean> {
    const name = a[0] as string;
    if (OK_ACTIONS.has(name)) { return true; }
    if (SPECIAL_ACTIONS.has(name)) {
      return !this.hasNuancedAccess(docSession);
    }
    if (SURPRISING_ACTIONS.has(name)) {
      return this.hasFullAccess(docSession);
    }
    if (a[0] === 'ApplyUndoActions') {
      return this.canMaybeApplyUserActions(docSession, a[1] as UserAction[]);
    } else if (a[0] === 'ApplyDocActions') {
      return this.canMaybeApplyUserActions(docSession, a[1] as UserAction[]);
    } else if (isTableAction(a)) {
      const tableId = getTableId(a);
      // If there are any access control nuances, deny _grist_* tables.
      // TODO: this is very crude, loosen this up appropriately.
      if (tableId.startsWith('_grist_')) {
        return !this.hasNuancedAccess(docSession);
      }
      const tableAccess = await this.getTableAccess(docSession, tableId);
      const accessFn = getAccessForActionType(a);
      const access = accessFn(tableAccess);
      // if access is mixed, leave this to be checked in detail later.
      return access === 'allow' || access === 'mixed' || access === 'mixedColumns';
    }
    return false;
  }

  /**
   * Check whether access is simple, or there are granular nuances that need to be
   * worked through.  Currently if there are no owner-only tables, then everyone's
   * access is simple and without nuance.
   */
  public hasNuancedAccess(docSession: OptDocSession): boolean {
    if (!this._ruleCollection.haveRules()) { return false; }
    return !this.hasFullAccess(docSession);
  }

  /**
   * Check whether user can read everything in document.  Checks both home-level and doc-level
   * permissions.
   */
  public async canReadEverything(docSession: OptDocSession): Promise<boolean> {
    const access = getDocSessionAccess(docSession);
    if (!canView(access)) { return false; }
    const permInfo = await this._getAccess(docSession);
    return permInfo.getFullAccess().read === 'allow';
  }

  /**
   * Check whether user can copy everything in document.  Owners can always copy
   * everything, even if there are rules that specify they cannot.
   */
  public async canCopyEverything(docSession: OptDocSession): Promise<boolean> {
    return this.isOwner(docSession) || this.canReadEverything(docSession);
  }

  /**
   * Check whether user has full access to the document.  Currently that is interpreted
   * as equivalent owner-level access to the document.
   * TODO: uses of this method should be checked to see if they can be fleshed out
   * now we have more of the ACL implementation done.
   */
  public hasFullAccess(docSession: OptDocSession): boolean {
    return this.isOwner(docSession);
  }

  /**
   * Check whether user has owner-level access to the document.
   */
  public isOwner(docSession: OptDocSession): boolean {
    const access = getDocSessionAccess(docSession);
    return access === 'owners';
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
  public async filterMetaTables(docSession: OptDocSession,
                                tables: {[key: string]: TableDataAction}): Promise<{[key: string]: TableDataAction}> {
    // If user has right to read everything, return immediately.
    if (await this.canReadEverything(docSession)) { return tables; }
    // If we are going to modify metadata, make a copy.
    tables = JSON.parse(JSON.stringify(tables));
    // Collect a list of all tables (by tableRef) to which the user has no access.
    const censoredTables: Set<number> = new Set();
    // Collect a list of censored columns (by "<tableRef> <colId>").
    const columnCode = (tableRef: number, colId: string) => `${tableRef} ${colId}`;
    const censoredColumnCodes: Set<string> = new Set();
    const permInfo = await this._getAccess(docSession);
    for (const rec of this._docData.getTable('_grist_Tables')!.getRecords()) {
      const tableId = rec.tableId as string;
      const tableRef = rec.id;
      const tableAccess = permInfo.getTableAccess(tableId);
      if (tableAccess.read === 'deny') {
        censoredTables.add(tableRef);
      }
      // TODO If some columns are allowed and the rest (*) are denied, we need to be able to
      // censor all columns outside a set.
      for (const ruleSet of this._ruleCollection.getAllColumnRuleSets(tableId)) {
        if (Array.isArray(ruleSet.colIds)) {
          for (const colId of ruleSet.colIds) {
            if (permInfo.getColumnAccess(tableId, colId).read === 'deny') {
              censoredColumnCodes.add(columnCode(tableRef, colId));
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
  public async getTableAccess(docSession: OptDocSession, tableId: string): Promise<TablePermissionSet> {
    return (await this._getAccess(docSession)).getTableAccess(tableId);
  }

  /**
   * Modify table data in place, removing any rows or columns to which access
   * is not granted.
   */
  public async filterData(docSession: OptDocSession, data: TableDataAction) {
    const permInfo = await this._getAccess(docSession);
    const tableId = getTableId(data);
    if (permInfo.getTableAccess(tableId).read === 'mixed') {
      await this._filterRowsAndCells(docSession, data, data, data, canRead);
    }

    // Filter columns, omitting any to which the user has no access, regardless of rows.
    this._filterColumns(data[3], (colId) => permInfo.getColumnAccess(tableId, colId).read !== 'deny');
  }

  public async getUserOverride(docSession: OptDocSession): Promise<UserOverride|undefined> {
    await this._getUser(docSession);
    return this._getUserAttributes(docSession).override;
  }

  /**
   * Strip out any denied columns from an action.  Returns null if nothing is left.
   * accessFn may throw if denials are fatal.
   */
  private _pruneColumns(a: DocAction, permInfo: PermissionInfo, tableId: string,
                        accessFn: AccessFn): DocAction|null {
    if (a[0] === 'RemoveRecord' || a[0] === 'BulkRemoveRecord') {
      return a;
    } else if (a[0] === 'AddRecord' || a[0] === 'BulkAddRecord' || a[0] === 'UpdateRecord' ||
               a[0] === 'BulkUpdateRecord' || a[0] === 'ReplaceTableData' || a[0] === 'TableData') {
      const na = cloneDeep(a);
      this._filterColumns(na[3], (colId) => accessFn(permInfo.getColumnAccess(tableId, colId)) !== 'deny');
      if (Object.keys(na[3]).length === 0) { return null; }
      return na;
    } else if (a[0] === 'AddColumn' || a[0] === 'RemoveColumn' || a[0] === 'RenameColumn' ||
               a[0] === 'ModifyColumn') {
      const na = cloneDeep(a);
      const colId: string = na[2];
      if (accessFn(permInfo.getColumnAccess(tableId, colId)) === 'deny') { return null; }
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
   * Strip out any denied rows from an action.  The action may be rewritten if rows
   * become allowed or denied during the action.  An action to add newly-allowed
   * rows may be included, or an action to remove newly-forbidden rows.  The result
   * is a list rather than a single action.  It may be the empty list.
   */
  private async _pruneRows(docSession: OptDocSession, a: DocAction, idx: number): Promise<DocAction[]> {
    // For the moment, only deal with Record-related actions.
    // TODO: process table/column schema changes more carefully.
    if (isSchemaAction(a)) { return [a]; }

    // Get before/after state for this action.  Broadcasts to other users can make use of the
    // same state, so we share it (and only compute it if needed).
    if (!this._rowSnapshots) { throw new Error('Actions not available'); }
    const allRowSnapshots = await this._rowSnapshots.get();
    const [rowsBefore, rowsAfter] = allRowSnapshots[idx];

    // Figure out which rows were forbidden to this session before this action vs
    // after this action.  We need to know both so that we can infer the state of the
    // client and send the correct change.
    const ids = new Set(getRowIdsFromDocAction(a));
    const forbiddenBefores = new Set(await this._getForbiddenRows(docSession, rowsBefore, ids));
    const forbiddenAfters = new Set(await this._getForbiddenRows(docSession, rowsAfter, ids));

    /**
     * For rows forbidden before and after: just remove them.
     * For rows allowed before and after: just leave them unchanged.
     * For rows that were allowed before and are now forbidden:
     *   - strip them from the current action.
     *   - add a BulkRemoveRecord for them.
     * For rows that were forbidden before and are now allowed:
     *   - remove them from the current action.
     *   - add a BulkAddRecord for them.
     */

    const removals = new Set<number>();      // rows to remove from current action.
    const forceAdds = new Set<number>();     // rows to add, that were previously stripped.
    const forceRemoves = new Set<number>();  // rows to remove, that have become forbidden.
    for (const id of ids) {
      const forbiddenBefore = forbiddenBefores.has(id);
      const forbiddenAfter = forbiddenAfters.has(id);
      if (!forbiddenBefore && !forbiddenAfter) { continue; }
      if (forbiddenBefore && forbiddenAfter) {
        removals.add(id);
        continue;
      }
      // If we reach here, then access right to the row changed and we have fancy footwork to do.
      if (forbiddenBefore) {
        // The row was forbidden and now is allowed.  That's trivial if the row was just added.
        if (a[0] === 'AddRecord' || a[0] === 'BulkAddRecord' ||
            a[0] === 'ReplaceTableData' || a[0] === 'TableData') {
          continue;
        }
        // Otherwise, strip the row from the current action.
        removals.add(id);
        if (a[0] === 'UpdateRecord' || a[0] === 'BulkUpdateRecord') {
          // For updates, we need to send the entire row as an add, since the client
          // doesn't know anything about it yet.
          forceAdds.add(id);
        } else {
          // Remaining cases are [Bulk]RemoveRecord.
        }
      } else {
        // The row was allowed and now is forbidden.
        // If the action is a removal, that is just right.
        if (a[0] === 'RemoveRecord' || a[0] === 'BulkRemoveRecord') { continue; }
        // Otherwise, strip the row from the current action.
        removals.add(id);
        if (a[0] === 'UpdateRecord' || a[0] === 'BulkUpdateRecord') {
          // For updates, we need to remove the entire row.
          forceRemoves.add(id);
        } else {
          // Remaining cases are add-like actions.
        }
      }
    }

    // Execute our cunning plans for DocAction revisions.
    const revisedDocActions = [
      this._makeAdditions(rowsAfter, forceAdds),
      this._removeRows(a, removals),
      this._makeRemovals(rowsAfter, forceRemoves),
    ].filter(isObject);

    // Return the results, also applying any cell-level access control.
    for (const docAction of revisedDocActions) {
      await this._filterRowsAndCells(docSession, rowsAfter, rowsAfter, docAction, canRead);
    }
    return revisedDocActions;
  }

  /**
   * Like _pruneRows, but fails immediately if access to any row is forbidden.
   * The accessFn supplied should throw an error on denial.
   */
  private async _checkRows(docSession: OptDocSession, a: DocAction, idx: number,
                           accessFn: AccessFn): Promise<void> {
    // For the moment, only deal with Record-related actions.
    // TODO: process table/column schema changes more carefully.
    if (isSchemaAction(a)) { return; }
    if (!this._rowSnapshots) { throw new Error('Logic error: actions not available'); }
    const allRowSnapshots = await this._rowSnapshots.get();
    const [rowsBefore, rowsAfter] = allRowSnapshots[idx];
    await this._filterRowsAndCells(docSession, rowsBefore, rowsAfter, a, accessFn);
  }

  /**
   * Modify action in place, scrubbing any rows and cells to which access is not granted.
   */
  private async _filterRowsAndCells(docSession: OptDocSession, rowsBefore: TableDataAction, rowsAfter: TableDataAction,
                                    docAction: DocAction, accessFn: AccessFn) {
    if (docAction && isSchemaAction(docAction)) {
      // TODO should filter out metadata about an unavailable column, probably.
      return [];
    }

    const rec = new RecordView(rowsBefore, undefined);
    const newRec = new RecordView(rowsAfter, undefined);
    const input: AclMatchInput = {user: await this._getUser(docSession), rec, newRec};

    const [, tableId, , colValues] = docAction;
    const rowIds = getRowIdsFromDocAction(docAction);
    const toRemove: number[] = [];

    let censorAt: (colId: string, idx: number) => void;
    if (colValues === undefined) {
      censorAt = () => 1;
    } else if (Array.isArray(docAction[2])) {
      censorAt = (colId, idx) => (colValues as BulkColValues)[colId][idx] = 'CENSORED';  // TODO Pick a suitable value
    } else {
      censorAt = (colId) => (colValues as ColValues)[colId] = 'CENSORED';  // TODO Pick a suitable value
    }

    // These map an index of a row in docAction to its index in rowsBefore and in rowsAfter.
    let getRecIndex: (idx: number) => number|undefined = (idx) => idx;
    let getNewRecIndex: (idx: number) => number|undefined = (idx) => idx;
    if (docAction !== rowsBefore) {
      const recIndexes = new Map(rowsBefore[2].map((rowId, idx) => [rowId, idx]));
      getRecIndex = (idx) => recIndexes.get(rowIds[idx]);
      const newRecIndexes = new Map(rowsAfter[2].map((rowId, idx) => [rowId, idx]));
      getNewRecIndex = (idx) => newRecIndexes.get(rowIds[idx]);
    }

    for (let idx = 0; idx < rowIds.length; idx++) {
      rec.index = getRecIndex(idx);
      newRec.index = getNewRecIndex(idx);

      const rowPermInfo = new PermissionInfo(this._ruleCollection, input);
      // getTableAccess() evaluates all column rules for THIS record. So it's really rowAccess.
      const rowAccess = rowPermInfo.getTableAccess(tableId);
      const access = accessFn(rowAccess);
      if (access === 'deny') {
        toRemove.push(idx);
      } else if (access !== 'allow' && colValues) {
        // Go over column rules.
        for (const colId of Object.keys(colValues)) {
          const colAccess = rowPermInfo.getColumnAccess(tableId, colId);
          if (accessFn(colAccess) === 'deny') {
            censorAt(colId, idx);
          }
        }
      }
    }

    if (toRemove.length > 0) {
      if (rowsBefore === docAction) {
        this._removeRowsAt(toRemove, rowsBefore[2], rowsBefore[3]);
      } else {
        // Artificially introduced removals are ok, otherwise this is suspect.
        if (docAction[0] !== 'RemoveRecord' && docAction[0] !== 'BulkRemoveRecord') {
          throw new Error('Unexpected row removal');
        }
      }
    }
  }

  // Compute which of the row ids supplied are for rows forbidden for this session.
  private async _getForbiddenRows(docSession: OptDocSession, data: TableDataAction, ids: Set<number>):
      Promise<number[]> {
    const rec = new RecordView(data, undefined);
    const input: AclMatchInput = {user: await this._getUser(docSession), rec};

    const [, tableId, rowIds] = data;
    const toRemove: number[] = [];
    for (let idx = 0; idx < rowIds.length; idx++) {
      rec.index = idx;
      if (!ids.has(rowIds[idx])) { continue; }

      const rowPermInfo = new PermissionInfo(this._ruleCollection, input);
      // getTableAccess() evaluates all column rules for THIS record. So it's really rowAccess.
      const rowAccess = rowPermInfo.getTableAccess(tableId);
      if (canRead(rowAccess) === 'deny') {
        toRemove.push(rowIds[idx]);
      }
    }
    return toRemove;
  }

  /**
   * Removes the toRemove rows (indexes, not row ids) from the rowIds list and from
   * the colValues structure.
   */
  private _removeRowsAt(toRemove: number[], rowIds: number[], colValues: BulkColValues|undefined) {
    if (toRemove.length > 0) {
      pullAt(rowIds, toRemove);
      if (colValues) {
        for (const values of Object.values(colValues)) {
          pullAt(values, toRemove);
        }
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
   * Get PermissionInfo for the user represented by the given docSession. The returned object
   * allows evaluating access level as far as possible without considering specific records.
   *
   * The result is cached in a WeakMap, and PermissionInfo does its own caching, so multiple calls
   * to this._getAccess(docSession).someMethod() will reuse already-evaluated results.
   */
  private async _getAccess(docSession: OptDocSession): Promise<PermissionInfo> {
    // TODO The intent of caching is to avoid duplicating rule evaluations while processing a
    // single request. Caching based on docSession is riskier since those persist across requests.
    return getSetMapValue(this._permissionInfoMap as Map<OptDocSession, Promise<PermissionInfo>>, docSession,
      async () => new PermissionInfo(this._ruleCollection, {user: await this._getUser(docSession)}));
  }

  private _getUserAttributes(docSession: OptDocSession): UserAttributes {
    // TODO Same caching intent and caveat as for _getAccess
    return getSetMapValue(this._userAttributesMap as Map<OptDocSession, UserAttributes>, docSession,
                          () => new UserAttributes());
  }

  /**
   * Check whether user attributes have changed.  If so, prompt client
   * to reload the document, since we aren't sophisticated enough to
   * figure out the changes to send.
   */
  private async _checkUserAttributes(docSession: OptDocSession) {
    if (!this._prevUserAttributesMap) { return; }
    const userAttrBefore = this._prevUserAttributesMap.get(docSession);
    if (!userAttrBefore) { return; }
    await this._getAccess(docSession);  // Makes sure user attrs have actually been computed.
    const userAttrAfter = this._getUserAttributes(docSession);
    for (const [tableId, rec] of Object.entries(userAttrAfter.rows)) {
      const prev = userAttrBefore.rows[tableId];
      if (!prev || JSON.stringify(prev.toJSON()) !== JSON.stringify(rec.toJSON())) {
        throw new ErrorWithCode('NEED_RELOAD', 'document needs reload, user attributes changed');
      }
    }
  }

  /**
   * Construct the UserInfo needed for evaluating rules. This also enriches the user with values
   * created by user-attribute rules.
   */
  private async _getUser(docSession: OptDocSession): Promise<UserInfo> {
    const linkParameters = docSession.authorizer?.getLinkParameters() || {};
    let access: Role | null;
    let fullUser: FullUser | null;
    const attrs = this._getUserAttributes(docSession);
    access = getDocSessionAccess(docSession);

    // If aclAsUserId/aclAsUser is set, then override user for acl purposes.
    if (linkParameters.aclAsUserId || linkParameters.aclAsUser) {
      if (!this.isOwner(docSession)) { throw new Error('only an owner can override user'); }
      if (attrs.override) {
        // Used cached properties.
        access = attrs.override.access;
        fullUser = attrs.override.user;
      } else {
        // Look up user information in database.
        if (!this._homeDbManager) { throw new Error('database required'); }
        const user = linkParameters.aclAsUserId ?
          (await this._homeDbManager.getUser(integerParam(linkParameters.aclAsUserId))) :
          (await this._homeDbManager.getUserByLogin(linkParameters.aclAsUser));
        const docAuth = user && await this._homeDbManager.getDocAuthCached({
          urlId: this._docId,
          userId: user.id
        });
        access = docAuth?.access || null;
        fullUser = user && this._homeDbManager.makeFullUser(user) || null;
        attrs.override = { access, user: fullUser };
      }
    } else {
      fullUser = getDocSessionUser(docSession);
    }
    const user: UserInfo = {};
    user.Access = access;
    user.UserID = fullUser?.id || null;
    user.Email = fullUser?.email || null;
    user.Name = fullUser?.name || null;
    // If viewed from a websocket, collect any link parameters included.
    // TODO: could also get this from rest api access, just via a different route.
    user.Link = linkParameters;
    // Include origin info if accessed via the rest api.
    // TODO: could also get this for websocket access, just via a different route.
    user.Origin = docSession.req?.get('origin') || null;

    if (this._ruleCollection.ruleError && !this._recoveryMode) {
      // It is important to signal that the doc is in an unexpected state,
      // and prevent it opening.
      throw this._ruleCollection.ruleError;
    }

    for (const clause of this._ruleCollection.getUserAttributeRules().values()) {
      if (clause.name in user) {
        log.warn(`User attribute ${clause.name} ignored; conflicts with an existing one`);
        continue;
      }
      if (attrs.rows[clause.name]) {
        user[clause.name] = attrs.rows[clause.name];
        continue;
      }
      let rec = new EmptyRecordView();
      let rows: TableDataAction|undefined;
      try {
        // Use lodash's get() that supports paths, e.g. charId of 'a.b' would look up `user.a.b`.
        // TODO: add indexes to db.
        rows = await this._fetchQueryFromDB({
          tableId: clause.tableId,
          filters: { [clause.lookupColId]: [get(user, clause.charId)] }
        });
      } catch (e) {
        log.warn(`User attribute ${clause.name} failed`, e);
      }
      if (rows && rows[2].length > 0) { rec = new RecordView(rows, 0); }
      user[clause.name] = rec;
      attrs.rows[clause.name] = rec;
    }
    return user;
  }

  /**
   * Remove a set of rows from a DocAction.  If the DocAction ends up empty, null is returned.
   * If the DocAction needs modification, it is copied first - the original is never
   * changed.
   */
  private _removeRows(a: DocAction, rowIds: Set<number>): DocAction|null {
    // If there are no rows, there's nothing to do.
    if (isSchemaAction(a)) { return a; }
    if (a[0] === 'AddRecord' || a[0] === 'UpdateRecord' || a[0] === 'RemoveRecord') {
      return rowIds.has(a[2]) ? null : a;
    }
    const na = cloneDeep(a);
    const [, , oldIds, bulkColValues] = na;
    const mask = oldIds.map((id, idx) => rowIds.has(id) && idx || -1).filter(v => v !== -1);
    this._removeRowsAt(mask, oldIds, bulkColValues);
    if (oldIds.length === 0) { return null; }
    return na;
  }

  /**
   * Make a BulkAddRecord for a set of rows.
   */
  private _makeAdditions(data: TableDataAction, rowIds: Set<number>): BulkAddRecord|null {
    if (rowIds.size === 0) { return null; }
    // TODO: optimize implementation, this does an unnecessary clone.
    const notAdded = data[2].filter(id => !rowIds.has(id));
    const partialData = this._removeRows(data, new Set(notAdded)) as TableDataAction|null;
    if (partialData === null) { return partialData; }
    return ['BulkAddRecord', partialData[1], partialData[2], partialData[3]];
  }

  /**
   * Make a BulkRemoveRecord for a set of rows.
   */
  private _makeRemovals(data: TableDataAction, rowIds: Set<number>): BulkRemoveRecord|null {
    if (rowIds.size === 0) { return null; }
    return ['BulkRemoveRecord', getTableId(data), [...rowIds]];
  }

  /**
   * Prepare to compute intermediate states of rows, as
   * this._rowSnapshots.  The computation should happen only if
   * needed, which depends on the rules and actions.  The computation
   * uses the state of the database, and so depends on whether the
   * docActions have already been applied to the database or not, as
   * determined by the this._applied flag, which should never be
   * changed during any possible use of this._rowSnapshots.
   */
  private _prepareRowSnapshots(docActions: DocAction[], undo: DocAction[]) {
    // Prepare to compute row snapshots if it turns out we need them.
    // If we never need them, they will never be computed.
    this._rowSnapshots = new AsyncCreate(async () => {
      // For row access work, we'll need to know the state of affected rows before and
      // after the actions.
      // First figure out what rows in which tables are touched during the actions.
      const rows = new Map(getRelatedRows(this._applied ? [...undo].reverse() : docActions));
      // Populate a minimal in-memory version of the database with these rows.
      const docData = new DocData(
        (tableId) => this._fetchQueryFromDB({tableId, filters: {id: [...rows.get(tableId)!]}}),
        null,
      );
      await Promise.all([...rows.keys()].map(tableId => docData.syncTable(tableId)));
      if (this._applied) {
        // Apply the undo actions, since the docActions have already been applied to the db.
        for (const docAction of [...undo].reverse()) { docData.receiveAction(docAction); }
      }

      // Now step forward, storing the before and after state for the table
      // involved in each action.  We'll use this to compute row access changes.
      // For simple changes, the rows will be just the minimal set needed.
      // This could definitely be optimized.  E.g. for pure table updates, these
      // states could be extracted while applying undo actions, with no need for
      // a forward pass.  And for a series of updates to the same table, there'll
      // be duplicated before/after states that could be optimized.
      const rowSnapshots = new Array<[TableDataAction, TableDataAction]>();
      for (const docAction of docActions) {
        const tableId = getTableId(docAction);
        const tableData = docData.getTable(tableId)!;
        const before = cloneDeep(tableData.getTableDataAction());
        docData.receiveAction(docAction);
        // If table is deleted, state afterwards doesn't matter.
        const after = docData.getTable(tableId) ? cloneDeep(tableData.getTableDataAction()) : before;
        rowSnapshots.push([before, after]);
      }
      return rowSnapshots;
    });
  }

  /**
   * Cut out any rows/columns not accessible to the user.  May throw a NEED_RELOAD
   * exception if the information needed to achieve the desired pruning is not available.
   * Returns null if the action is entirely pruned.  The action passed in is never modified.
   * The idx parameter is a record of which action in the bundle this action is, and can
   * be used to access information in this._rowSnapshots if needed.
   */
  private async _pruneOutgoingDocAction(docSession: OptDocSession, a: DocAction, idx: number): Promise<DocAction[]> {
    const tableId = getTableId(a);
    const permInfo = await this._getAccess(docSession);
    const tableAccess = permInfo.getTableAccess(tableId);
    const access = tableAccess.read;
    if (access === 'deny') { return []; }
    if (access === 'allow') { return [a]; }
    if (access === 'mixedColumns') {
      return [this._pruneColumns(a, permInfo, tableId, canRead)].filter(isObject);
    }
    // The remainder is the mixed condition.
    const revisedDocActions = await this._pruneRows(docSession, a, idx);
    const result = revisedDocActions.map(na => this._pruneColumns(na, permInfo, tableId,
                                                                  canRead)).filter(isObject);
    return result;
  }

  private async _checkIncomingDocAction(docSession: OptDocSession, a: DocAction, idx: number): Promise<void> {
    const accessFn = denyIsFatal(getAccessForActionType(a));
    const tableId = getTableId(a);
    const permInfo = await this._getAccess(docSession);
    const tableAccess = permInfo.getTableAccess(tableId);
    const access = accessFn(tableAccess);
    if (access === 'allow') { return; }
    if (access === 'mixedColumns') {
      // Somewhat abusing prune method by calling it with an access function that
      // throws on denial.
      this._pruneColumns(a, permInfo, tableId, accessFn);
    }
    // The remainder is the mixed condition.
    await this._checkRows(docSession, a, idx, accessFn);
    // Somewhat abusing prune method by calling it with an access function that
    // throws on denial.
    this._pruneColumns(a, permInfo, tableId, accessFn);
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
  constructor(private _acls: ACLRuleCollection, private _input: AclMatchInput) {}

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

/**
 * A row-like view of TableDataAction, which is columnar in nature.  If index value
 * is undefined, acts as an EmptyRecordRow.
 */
export class RecordView implements InfoView {
  public constructor(public data: TableDataAction, public index: number|undefined) {
  }

  public get(colId: string): CellValue {
    if (this.index === undefined) { return null; }
    if (colId === 'id') {
      return this.data[2][this.index];
    }
    return this.data[3][colId]?.[this.index];
  }

  public toJSON() {
    if (this.index === undefined) { return {}; }
    const results: {[key: string]: any} = {};
    for (const key of Object.keys(this.data[3])) {
      results[key] = this.data[3][key]?.[this.index];
    }
    return results;
  }
}

class EmptyRecordView implements InfoView {
  public get(colId: string): CellValue { return null; }
  public toJSON() { return {}; }
}

/**
 * Cache information about user attributes.
 */
class UserAttributes {
  public rows: {[clauseName: string]: InfoView} = {};
  public override?: UserOverride;
}

// A function for extracting one of the create/read/update/delete/schemaEdit permissions
// from a permission set.
type AccessFn = (ps: PermissionSet<string>) => string;

// Get an AccessFn appropriate for the specific action.
// TODO: deal with ReplaceTableData, which both deletes and creates rows.
function getAccessForActionType(a: DocAction): AccessFn {
  if (a[0] === 'UpdateRecord' || a[0] === 'BulkUpdateRecord') {
    return (ps) => ps.update;
  } else if (a[0] === 'RemoveRecord' || a[0] === 'BulkRemoveRecord') {
    return (ps) => ps.delete;
  } else if (a[0] === 'AddRecord' || a[0] === 'BulkAddRecord') {
    return (ps) => ps.create;
  } else {
    return (ps) => ps.schemaEdit;
  }
}

// Tweak an AccessFn so that it throws an exception if access is denied.
function denyIsFatal(fn: AccessFn): AccessFn {
  return (ps) => {
    const result = fn(ps);
    if (result === 'deny') { throw new Error('access denied'); }
    return result;
  };
}

// A simple access function that returns the "read" permission.
function canRead(ps: PermissionSet<string>) {
  return ps.read;
}
