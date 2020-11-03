import { ActionGroup } from 'app/common/ActionGroup';
import { createEmptyActionSummary } from 'app/common/ActionSummary';
import { Query } from 'app/common/ActiveDocAPI';
import { BulkColValues, CellValue, ColValues, DocAction, TableDataAction, UserAction } from 'app/common/DocActions';
import { DocData } from 'app/common/DocData';
import { ErrorWithCode } from 'app/common/ErrorWithCode';
import { AccessPermissions, decodeClause, GranularAccessCharacteristicsClause,
  GranularAccessClause, GranularAccessColumnClause, MatchSpec } from 'app/common/GranularAccessClause';
import { canView } from 'app/common/roles';
import { TableData } from 'app/common/TableData';
import { Permissions } from 'app/gen-server/lib/Permissions';
import { getDocSessionAccess, getDocSessionUser, OptDocSession } from 'app/server/lib/DocSession';
import * as log from 'app/server/lib/log';
import pullAt = require('lodash/pullAt');
import cloneDeep = require('lodash/cloneDeep');

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
const SURPRISING_ACTIONS = new Set(['AddUser',
                                    'RemoveUser',
                                    'AddInstance',
                                    'RemoveInstance',
                                    'RemoveView',
                                    'AddViewSection',
                                   ]);

// Actions we'll allow unconditionally for now.
const OK_ACTIONS = new Set(['Calculate', 'AddEmptyTable']);

/**
 *
 * Manage granular access to a document.  This allows nuances other than the coarse
 * owners/editors/viewers distinctions.  As a placeholder for a future representation,
 * nuances are stored in the _grist_ACLResources table.
 *
 */
export class GranularAccess {
  private _resources: TableData;
  private _clauses = new Array<GranularAccessClause>();
  // Cache any tables that we need to look-up for access control decisions.
  // This is an unoptimized implementation that is adequate if the tables
  // are not large and don't change all that often.
  private _characteristicTables = new Map<string, CharacteristicTable>();

  public constructor(private _docData: DocData, private _fetchQuery: (query: Query) => Promise<TableDataAction>) {
  }

  /**
   * Update granular access from DocData.
   */
  public async update() {
    this._resources = this._docData.getTable('_grist_ACLResources')!;
    this._clauses.length = 0;
    for (const res of this._resources.getRecords()) {
      const clause = decodeClause(String(res.colIds));
      if (clause) { this._clauses.push(clause); }
    }
    if (this._clauses.length > 0) {
      // TODO: optimize this.
      await this._updateCharacteristicTables();
    }
  }

  /**
   * Check whether user can carry out query.
   */
  public hasQueryAccess(docSession: OptDocSession, query: Query) {
    return this.hasTableAccess(docSession, query.tableId);
  }

  /**
   * Check whether user has access to table.
   */
  public hasTableAccess(docSession: OptDocSession, tableId: string) {
    return Boolean(this.getTableAccess(docSession, tableId).permission & Permissions.VIEW);
  }

  /**
   * Filter DocActions to be sent to a client.
   */
  public filterOutgoingDocActions(docSession: OptDocSession, docActions: DocAction[]): DocAction[] {
    return docActions.map(action => this.pruneOutgoingDocAction(docSession, action))
      .filter(docActions => docActions !== null) as DocAction[];
  }

  /**
   * Filter an ActionGroup to be sent to a client.
   */
  public filterActionGroup(docSession: OptDocSession, actionGroup: ActionGroup): ActionGroup {
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
      if (tableAccess.rowPermissionFunctions.length > 0) { return false; }
      return Boolean(tableAccess.permission & Permissions.VIEW);
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
    const tableAccess = this.getTableAccess(docSession, tableId);
    if (!(tableAccess.permission & Permissions.VIEW)) { return null; }
    if (tableAccess.rowPermissionFunctions.length > 0) {
      // For now, trigger a reload, since we don't have the
      // information we need to filter rows.  Reloads would be very
      // annoying if user is working on something, but at least data
      // won't be stale.  TODO: improve!
      throw new ErrorWithCode('NEED_RELOAD', 'document needs reload');
    }
    if (tableAccess.columnPermissions.size > 0) {
      if (a[0] === 'RemoveRecord' || a[0] === 'BulkRemoveRecord') {
        return a;
      } else if (a[0] === 'AddRecord' || a[0] === 'BulkAddRecord' || a[0] == 'UpdateRecord' ||
                 a[0] === 'BulkUpdateRecord' || a[0] === 'ReplaceTableData' || a[0] === 'TableData') {
        const na = cloneDeep(a);
        this.filterColumns(na[3], tableAccess);
        if (Object.keys(na[3]).length === 0) { return null; }
        return na;
      } else if (a[0] === 'AddColumn' || a[0] === 'RemoveColumn' || a[0] === 'RenameColumn' ||
                 a[0] === 'ModifyColumn') {
        const na = cloneDeep(a);
        const perms = tableAccess.columnPermissions.get(na[2]);
        if (perms && (perms.forbidden & Permissions.VIEW)) { return null; }
        throw new ErrorWithCode('NEED_RELOAD', 'document needs reload');
      } else {
        // Remaining cases of AddTable, RemoveTable, RenameTable should have
        // been handled at the table level.
      }
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
    if (this._clauses.length === 0) { return false; }
    return !this.hasFullAccess(docSession);
  }

  /**
   * Check whether user can read everything in document.
   */
  public canReadEverything(docSession: OptDocSession): boolean {
    for (const tableId of this.getTablesInClauses()) {
      const tableData = this.getTableAccess(docSession, tableId);
      if (!(tableData.permission & Permissions.VIEW) || tableData.rowPermissionFunctions.length > 0 || tableData.columnPermissions.size > 0) {
        return false;
      }
    }
    return true;
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
    for (const tableId of this.getTablesInClauses()) {
      const tableAccess = this.getTableAccess(docSession, tableId);
      let tableRef: number|undefined = 0;
      if (!(tableAccess.permission & Permissions.VIEW)) {
        tableRef = this._docData.getTable('_grist_Tables')?.findRow('tableId', tableId);
        if (tableRef) { censoredTables.add(tableRef); }
      }
      for (const [colId, perm] of tableAccess.columnPermissions) {
        if (perm.forbidden & Permissions.VIEW) {
          if (!tableRef) {
            tableRef = this._docData.getTable('_grist_Tables')?.findRow('tableId', tableId);
          }
          if (tableRef) { censoredColumnCodes.add(columnCode(tableRef, colId)); }
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
  public getTableAccess(docSession: OptDocSession, tableId: string): TableAccess {
    const access = getDocSessionAccess(docSession);
    const characteristics: {[key: string]: CellValue} = {};
    const user = getDocSessionUser(docSession);
    characteristics.Access = access;
    characteristics.UserID = user?.id || null;
    characteristics.Email = user?.email || null;
    characteristics.Name = user?.name || null;
    // Light wrapper around characteristics.
    const ch: InfoView = {
      get(key: string) { return characteristics[key]; },
      toJSON() { return characteristics; }
    };
    const tableAccess: TableAccess = { permission: 0, rowPermissionFunctions: [],
                                       columnPermissions: new Map() };
    let canChangeSchema: boolean = true;
    let canView: boolean = true;
    // Don't apply access control to system requests (important to load characteristic
    // tables).
    if (docSession.mode !== 'system') {
      for (const clause of this._clauses) {
        switch (clause.kind) {
          case 'doc':
            {
              const match = getMatchFunc(clause.match);
              if (!match({ ch })) {
                canChangeSchema = false;
              }
            }
            break;
          case 'table':
            if (clause.tableId === tableId) {
              const match = getMatchFunc(clause.match);
              if (!match({ ch })) {
                canView = false;
              }
            }
            break;
          case 'row':
            if (clause.tableId === tableId) {
              const scope = clause.scope ? getMatchFunc(clause.scope) : () => true;
              if (scope({ ch })) {
                const match = getMatchFunc(clause.match);
                tableAccess.rowPermissionFunctions.push((rec) => {
                  return match({ ch, rec }) ? Permissions.OWNER : 0;
                });
              }
            }
            break;
          case 'column':
            if (clause.tableId === tableId) {
              const isMatch = getMatchFunc(clause.match)({ ch });
              for (const colId of clause.colIds) {
                if (PermissionConstraint.needUpdate(isMatch, clause)) {
                  let perms = tableAccess.columnPermissions.get(colId);
                  if (!perms) {
                    perms = new PermissionConstraint();
                    tableAccess.columnPermissions.set(colId, perms);
                  }
                  perms.update(isMatch, clause);
                }
              }
            }
            break;
          case 'character':
            {
              const key = this._getCharacteristicTableKey(clause);
              const characteristicTable = this._characteristicTables.get(key);
              if (characteristicTable) {
                const character = this._normalizeValue(characteristics[clause.charId]);
                const rowNum = characteristicTable.rowNums.get(character);
                if (rowNum !== undefined) {
                  const rec = new RecordView(characteristicTable.data, rowNum);
                  for (const key of Object.keys(characteristicTable.data[3])) {
                    characteristics[key] = rec.get(key);
                  }
                }
              }
            }
            break;
          default:
            // Don't fail terminally if a clause is not understood, to preserve some
            // document access.
            // TODO: figure out a way to communicate problems to an appropriate user, so
            // they know if a clause is not being honored.
            log.error('problem clause: %s', clause);
            break;
        }
      }
    }
    tableAccess.permission = canView ? Permissions.OWNER : 0;
    if (!canChangeSchema) {
      tableAccess.permission = tableAccess.permission & ~Permissions.SCHEMA_EDIT;
    }
    return tableAccess;
  }

  /**
   * Get the set of all tables mentioned in access clauses.
   */
  public getTablesInClauses(): Set<string> {
    const tables = new Set<string>();
    for (const clause of this._clauses) {
      if ('tableId' in clause) { tables.add(clause.tableId); }
    }
    return tables;
  }

  /**
   * Modify table data in place, removing any rows or columns to which access
   * is not granted.
   */
  public filterData(data: TableDataAction, tableAccess: TableAccess) {
    this.filterRows(data, tableAccess);
    this.filterColumns(data[3], tableAccess);
  }

  /**
   * Modify table data in place, removing any rows to which access
   * is not granted.
   */
  public filterRows(data: TableDataAction, tableAccess: TableAccess) {
    const toRemove: number[] = [];
    const rec = new RecordView(data, 0);
    for (let idx = 0; idx < data[2].length; idx++) {
      rec.index = idx;
      let permission = Permissions.OWNER;
      for (const fn of tableAccess.rowPermissionFunctions) {
        permission = permission & fn(rec);
      }
      if (!(permission & Permissions.VIEW)) {
        toRemove.push(idx);
      }
    }
    if (toRemove.length > 0) {
      pullAt(data[2], toRemove);
      const cols = data[3];
      for (const [, values] of Object.entries(cols)) {
        pullAt(values, toRemove);
      }
    }
  }

  /**
   * Modify table data in place, removing any columns to which access
   * is not granted.
   */
  public filterColumns(data: BulkColValues|ColValues, tableAccess: TableAccess) {
    const colIds= [...tableAccess.columnPermissions.entries()].map(([colId, p]) => {
      return (p.forbidden & Permissions.VIEW) ? colId : null;
    }).filter(c => c !== null) as string[];
    for (const colId of colIds) {
      delete data[colId];
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
  private _normalizeValue(value: CellValue): string {
    return JSON.stringify(value).toLowerCase();
  }

  /**
   * Load any tables needed for look-ups.
   */
  private async _updateCharacteristicTables() {
    this._characteristicTables.clear();
    for (const clause of this._clauses) {
      if (clause.kind === 'character') {
        this._updateCharacteristicTable(clause);
      }
    }
  }

  /**
   * Load a table needed for look-up.
   */
  private async _updateCharacteristicTable(clause: GranularAccessCharacteristicsClause) {
    const key = this._getCharacteristicTableKey(clause);
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
    }
    this._characteristicTables.set(key, result);
  }

  private _getCharacteristicTableKey(clause: GranularAccessCharacteristicsClause): string {
    return JSON.stringify({ tableId: clause.tableId, colId: clause.lookupColId });
  }
}

// A function that computes permissions given a record.
export type PermissionFunction = (rec: RecordView) => number;

// A summary of table-level access information.
export interface TableAccess {
  permission: number;
  rowPermissionFunctions: Array<PermissionFunction>;
  columnPermissions: Map<string, PermissionConstraint>;
}

/**
 * This is a placeholder for accumulating permissions for a particular scope.
 */
export class PermissionConstraint {
  private _allowed: number = 0;
  private _forbidden: number = 0;

  // If a clause's condition matches the user, or fails to match the user,
  // check if the clause could modify permissions via onMatch/onFail.
  public static needUpdate(isMatch: boolean, clause: GranularAccessColumnClause) {
    return (isMatch && clause.onMatch) || (!isMatch && clause.onFail);
  }

  public constructor() {
    this._allowed = this._forbidden = 0;
  }

  public get allowed() {
    return this._allowed;
  }

  public get forbidden() {
    return this._forbidden;
  }

  public allow(p: number) {
    this._allowed = this._allowed | p;
    this._forbidden = this._forbidden & ~p;
  }

  public allowOnly(p: number) {
    this._allowed = p;
    this._forbidden = ~p;
  }

  public forbid(p: number) {
    this._forbidden = this._forbidden | p;
    this._allowed = this._allowed & ~p;
  }

  // Update this PermissionConstraint based on whether the user matched/did not match
  // a particular clause.
  public update(isMatch: boolean, clause: GranularAccessColumnClause) {
    const activeClause = (isMatch ? clause.onMatch : clause.onFail) || {};
    if (activeClause.allow) {
      this.allow(getPermission(activeClause.allow));
    }
    if (activeClause.allowOnly) {
      this.allowOnly(getPermission(activeClause.allowOnly));
    }
    if (activeClause.forbid) {
      this.forbid(getPermission(activeClause.forbid));
    }
  }
}

// Light wrapper around characteristics or records.
export interface InfoView {
  get(key: string): CellValue;
  toJSON(): {[key: string]: any};
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

// A function for matching characteristic and/or record information.
export type MatchFunc = (state: { ch?: InfoView, rec?: InfoView }) => boolean;

// Convert a match specification to a function.
export function getMatchFunc(spec: MatchSpec): MatchFunc {
  switch (spec.kind) {
    case 'not':
      {
        const core = getMatchFunc(spec.match);
        return (state) => !core(state);
      }
    case 'const':
      return (state) => state.ch?.get(spec.charId) === spec.value;
    case 'truthy':
      return (state) => Boolean(state.rec?.get(spec.colId));
    case 'pair':
      return (state) => state.ch?.get(spec.charId) === state.rec?.get(spec.colId);
    default:
      throw new Error('match spec not understood');
  }
}

/**
 * A cache of a table needed for look-ups, including a map from keys to
 * row numbers. Keys are produced by _getCharacteristicTableKey().
 */
export interface CharacteristicTable {
  tableId: string;
  colId: string;
  rowNums: Map<string, number>;
  data: TableDataAction;
}

export function getPermission(accessPermissions: AccessPermissions) {
  if (accessPermissions === 'all') { return 255; }
  let n: number = 0;
  for (const p of accessPermissions) {
    switch (p) {
      case 'read':
        n = n | Permissions.VIEW;
        break;
      case 'update':
        n = n | Permissions.UPDATE;
        break;
      case 'create':
        n = n | Permissions.ADD;
        break;
      case 'delete':
        n = n | Permissions.REMOVE;
        break;
      default:
        throw new Error(`unrecognized permission ${p}`);
    }
  }
  return n;
}
