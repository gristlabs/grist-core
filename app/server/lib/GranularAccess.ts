import { ActionGroup } from 'app/common/ActionGroup';
import { createEmptyActionSummary } from 'app/common/ActionSummary';
import { Query } from 'app/common/ActiveDocAPI';
import { BulkColValues, DocAction, TableDataAction, UserAction, CellValue } from 'app/common/DocActions';
import { DocData } from 'app/common/DocData';
import { ErrorWithCode } from 'app/common/ErrorWithCode';
import { decodeClause, GranularAccessCharacteristicsClause, GranularAccessClause, MatchSpec } from 'app/common/GranularAccessClause';
import { canView } from 'app/common/roles';
import { TableData } from 'app/common/TableData';
import { Permissions } from 'app/gen-server/lib/Permissions';
import { getDocSessionAccess, getDocSessionUser, OptDocSession } from 'app/server/lib/DocSession';
import pullAt = require('lodash/pullAt');

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
    return docActions.filter(action => this.canApplyUserAction(docSession, action, 'out'));
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
   * Check if user can apply a given action.
   * When the direction is 'in', we are checking if it is ok for user to apply the
   * action on the document.  When the direction is 'out', we are checking if it
   * is ok to send the action to the user's client.
   */
  public canApplyUserAction(docSession: OptDocSession, a: UserAction|DocAction,
                            direction: 'in' | 'out' = 'in'): boolean {
    const name = a[0] as string;
    if (OK_ACTIONS.has(name)) { return true; }
    if (SPECIAL_ACTIONS.has(name)) {
      // When broadcasting to client, allow renames etc for now.
      // This is a bit weak, since it leaks changes to private table schemas.
      // TODO: tighten up.
      if (direction === 'out') { return true; }
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
      // Allow _grist_ table info to be broadcast to client unconditionally.
      // This is a bit weak, since it leaks changes to private table schemas.
      // TODO: tighten up.
      if (tableId.startsWith('_grist_') && direction === 'in') {
        return !this.hasNuancedAccess(docSession);
      }
      const tableAccess = this.getTableAccess(docSession, tableId);
      // For now, if there are any row restrictions, forbid editing.
      // To allow editing, we'll need something that has access to full row,
      // e.g. data engine (and then an equivalent for ondemand tables), or
      // to fetch rows at this point.
      if (tableAccess.rowPermissionFunctions.length > 0) {
        // If sending to client, for now just get it to reload from scratch,
        // we don't have the information we need to filter updates.  Reloads
        // would be very annoying if user is working on something, but at least
        // data won't be stale.  TODO: improve!
        if (direction === 'out') { throw new ErrorWithCode('NEED_RELOAD', 'document needs reload'); }
        return false;
      }
      return Boolean(tableAccess.permission & Permissions.VIEW);
    }
    return false;
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
      if (!(tableData.permission & Permissions.VIEW) || tableData.rowPermissionFunctions.length > 0) {
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
    for (const tableId of this.getTablesInClauses()) {
      if (this.hasTableAccess(docSession, tableId)) { continue; }
      const tableRef = this._docData.getTable('_grist_Tables')?.findRow('tableId', tableId);
      if (tableRef) { censoredTables.add(tableRef); }
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
      if (!censoredTables.has(column.parentId as number)) { continue; }
      censoredColumns.add(column.id);
    }
    // Collect a list of all fields from sections to which the user has no access.
    const censoredFields: Set<number> = new Set();
    for (const field of this._docData.getTable('_grist_Views_section_field')?.getRecords() || []) {
      if (!censoredSections.has(field.parentId as number)) { continue; }
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
    const tableAccess: TableAccess = { permission: 0, rowPermissionFunctions: [] };
    let canChangeSchema: boolean = true;
    let canView: boolean = true;
    // Don't apply access control to system requests (important to load characteristic
    // tables).
    if (docSession.mode !== 'system') {
      for (const clause of this._clauses) {
        if (clause.kind === 'doc') {
          const match = getMatchFunc(clause.match);
          if (!match({ ch })) {
            canChangeSchema = false;
          }
        }
        if (clause.kind === 'table' && clause.tableId === tableId) {
          const match = getMatchFunc(clause.match);
          if (!match({ ch })) {
            canView = false;
          }
        }
        if (clause.kind === 'row' && clause.tableId === tableId) {
          const scope = clause.scope ? getMatchFunc(clause.scope) : () => true;
          if (scope({ ch })) {
            const match = getMatchFunc(clause.match);
            tableAccess.rowPermissionFunctions.push((rec) => {
              return match({ ch, rec }) ? Permissions.OWNER : 0;
            });
          }
        }
        if (clause.kind === 'character') {
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
   * Modify table data in place, removing any rows to which access
   * is not granted.
   */
  public filterData(data: TableDataAction, tableAccess: TableAccess) {
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
