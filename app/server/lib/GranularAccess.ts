import { ActionGroup } from 'app/common/ActionGroup';
import { createEmptyActionSummary } from 'app/common/ActionSummary';
import { Query } from 'app/common/ActiveDocAPI';
import { BulkColValues, DocAction, TableDataAction, UserAction } from 'app/common/DocActions';
import { DocData } from 'app/common/DocData';
import { canView } from 'app/common/roles';
import { TableData } from 'app/common/TableData';
import { getDocSessionAccess, OptDocSession } from 'app/server/lib/DocSession';

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
 * nuances are stored in the _grist_ACLResources table.  Supported nauances:
 *
 *   - {tableId, colIds: '~o'}: mark specified table as accessible by owners only.
 *   - {tableId: '', colIds: '~o structure'}: mark doc structure as editable by owners only.
 *
 */
export class GranularAccess {
  private _resources: TableData;

  // Tables marked as accessible only by owners.
  private _ownerOnlyTableIds = new Set<string>();

  // Document structure modifiable only by owners?
  private _onlyOwnersCanModifyStructure: boolean = false;

  public constructor(private _docData: DocData) {
    this.update();
  }

  /**
   * Update granular access from DocData.
   */
  public update() {
    this._resources = this._docData.getTable('_grist_ACLResources')!;
    this._ownerOnlyTableIds.clear();
    this._onlyOwnersCanModifyStructure = false;
    for (const res of this._resources.getRecords()) {
      const code = String(res.colIds);
      if (res.tableId && code === '~o') {
        this._ownerOnlyTableIds.add(String(res.tableId));
      }
      if (!res.tableId && code === '~o structure') {
        this._onlyOwnersCanModifyStructure = true;
      }
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
    return !this._ownerOnlyTableIds.has(tableId) || this.hasFullAccess(docSession);
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
      return this.hasTableAccess(docSession, tableId);
    }
    return false;
  }

  /**
   * Check whether access is simple, or there are granular nuances that need to be
   * worked through.  Currently if there are no owner-only tables, then everyone's
   * access is simple and without nuance.
   */
  public hasNuancedAccess(docSession: OptDocSession): boolean {
    if (this._ownerOnlyTableIds.size === 0 && !this._onlyOwnersCanModifyStructure) {
      return false;
    }
    return !this.hasFullAccess(docSession);
  }

  /**
   * Check whether user can read everything in document.
   */
  public canReadEverything(docSession: OptDocSession): boolean {
    if (this._ownerOnlyTableIds.size === 0) { return true; }
    return this.hasFullAccess(docSession);
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
    for (const tableId of this._ownerOnlyTableIds) {
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
   * Modify the given TableDataAction in place by calling the supplied operation with
   * the indexes of any ids supplied and the columns in that TableDataAction.
   */
  public _censor(table: TableDataAction, ids: Set<number>,
                 op: (idx: number, cols: BulkColValues) => unknown) {
    const availableIds = table[2];
    const cols = table[3];
    for (let idx = 0; idx < availableIds.length; idx++) {
      if (ids.has(availableIds[idx])) { op(idx, cols); }
    }
  }
}
