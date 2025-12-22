import {
  AddRecord,
  BulkAddRecord,
  BulkRemoveRecord,
  BulkUpdateRecord,
  DataAction,
  DocAction,
  getActionColValues,
  getRowIds,
  getRowIdsFromDocAction,
  getSingleAction,
  getTableId,
  isAddRecord,
  isBulkAction,
  isBulkRemoveRecord,
  isBulkUpdateRecord,
  isDataAction,
  isRemoveRecord,
  isSomeAddRecordAction,
  isSomeRemoveRecordAction,
  isUpdateRecord,
  UpdateRecord,
} from 'app/common/DocActions';
import { CommentContent } from 'app/common/DocComments';
import { DocData } from 'app/common/DocData';
import { ErrorWithCode } from 'app/common/ErrorWithCode';
import { isCensored } from 'app/common/gristTypes';
import { getSetMapValue, safeJsonParse } from 'app/common/gutil';
import { MetaRowRecord, SingleCell } from 'app/common/TableData';
import { GristObjCode } from 'app/plugin/GristData';
import { isEqual } from 'lodash';


/**
 * Tests if the user can modify cell's data. Will modify the docData
 * to reflect the changes that are done by actions (without reverting if one of the actions fails).
 *
 * If user can't modify the cell, it will throw an error.
 */
export async function applyAndCheckActionsForCells(
  docData: DocData,
  docActions: DocAction[],
  directActions: boolean[],
  userIsOwner: boolean,
  haveRules: boolean,
  userRef: string,
  hasAccess: (cell: SingleCellInfo, state: DocData) => Promise<boolean>
) {
  // First check if we even have actions that modify cell's data.
  const cellsActions = docActions.filter(isCellDataAction);

  // If we don't have any actions, we are good to go.
  if (cellsActions.length === 0) { return; }
  const fail = () => {
    throw new ErrorWithCode('ACL_DENY', 'Cannot access cell');
  };

  // In nutshell we will just test action one by one, and see if user
  // can apply it. To do it, we need to keep track of a database state after
  // each action (just like regular access is done). Unfortunately, cells' info
  // can be partially updated, so we won't be able to determine what cells they
  // are attached to. We will assume that bundle has a complete set of information, and
  // with this assumption we will skip such actions, and wait for the whole cell to form.


  // Create a view for current state.
  const cellData = new CellData(docData);

  // Some cells meta data will be added before rows (for example, when undoing). We will
  // postpone checking of such actions until we have a full set of information.
  let postponed: Array<number> = [];
  // Now one by one apply all actions to the snapshot recording all changes
  // to the cell table.

  const zipped = docActions.map((a, i) => ({docAction: a, isDirect: directActions[i]}));
  for(const {docAction, isDirect} of zipped) {
    if (!isDirect || !isCellDataAction(docAction)) {
      docData.receiveAction(docAction);
      continue;
    }
    // Convert any bulk actions to normal actions
    for(const single of getSingleAction(docAction)) {
      const id = getRowIdsFromDocAction(single)[0];
      if (isAddRecord(single)) {
        // Apply this action, as it might not have full information yet.
        docData.receiveAction(single);
        if (haveRules) {
          const cell = cellData.getCell(id);
          if (cell && cellData.isAttached(cell)) {
            // If this is undo, action cell might not yet exist, so we need to check for that.
            const haveRecord = docData.getTable(cell.tableId)?.hasRowId(cell.rowId);
            if (!haveRecord) {
              postponed.push(id);
            }
 else if (!await hasAccess(cell, docData)) {
              fail();
            }
          }
 else {
            postponed.push(id);
          }
        }
      }
 else if (isRemoveRecord(single)) {
        // See if we can remove this cell.
        const cell = cellData.getCell(id);
        docData.receiveAction(single);
        if (cell) {
          // We can remove cell information for any row/column that was removed already.
          const record = docData.getTable(cell.tableId)?.getRecord(cell.rowId);
          if (!record || !cell.colId || !(cell.colId in record)) {
            continue;
          }
          // Document owner can remove anything.
          if (cell.userRef && cell.userRef !== (userRef || '') && !userIsOwner) {
            fail();
          }
        }
        postponed = postponed.filter(i => i !== id);
      }
 else {
        // We are updating a cell metadata. We will need to check if we can update it.
        let cell = cellData.getCell(id);
        if (!cell) {
          return fail();
        }

        // We can update any cell if the column or table for this cell was removed already.
        // In that case, cell is updated before being removed.
        if (!cell.colId || !cell.tableId || !cell.rowId) {
          docData.receiveAction(single);
          continue;
        }

        // And if the cell was attached before, we will need to check if we can access it.
        if (cellData.isAttached(cell) && haveRules && !await hasAccess(cell, docData)) {
          fail();
        }
        // Now receive the action, and test if we can still see the cell (as the info might be moved
        // to a different cell).
        const before = cellData.getCellRecord(id);
        docData.receiveAction(single);
        cell = cellData.getCell(id)!;
        const after = cellData.getCellRecord(id);

        if (cellData.isAttached(cell) && haveRules && !await hasAccess(cell, docData)) {
          fail();
        }

        // Anyone can toggle the parent property (as it is Ref field for the main thread which might be removed)
        // Grist data engine has something that resembles ON DELETE CASCADE, but the children (dependencies) are removed
        // after, not before, so there is a brief moment when references are invalid.
        if (before && after &&
            checkChangedIds(before, after, ['parentId']) &&
            wasToggled(before, after, 'parentId')
          ) {
          continue;
        }

        // We can't update cells, that are not ours, unless we are owner and we are resolving a root comment.
        if (cell.userRef && cell.userRef !== (userRef || '')) {
          // Check if this is owner resolving a root comment
          const isOwnerResolvingRoot =
            userIsOwner &&
            before && after &&
            after.root &&
            wasToggled(before, after, 'resolved') &&
            // Only resolved field changed (timeCreated and timeUpdated are automatic and not user-controlled)
            checkChangedIds(before, after, ['resolved', 'timeUpdated']);

          if (!isOwnerResolvingRoot) {
            fail();
          }
        }
      }
    }
  }
  // Now test every cell that was added before row (so we added it, but without
  // full information, like new rowId or tableId or colId).
  for(const id of postponed) {
    const cell = cellData.getCell(id);
    if (cell && !cellData.isAttached(cell)) {
      return fail();
    }
    if (haveRules && cell && !await hasAccess(cell, docData)) {
      fail();
    }
  }
}

/**
 * Checks if the action is a data action that modifies a _grist_Cells table.
 */
export function isCellDataAction(a: DocAction): a is DataAction {
  return getTableId(a) === '_grist_Cells' && isDataAction(a);
}


interface SingleCellInfo extends SingleCell {
  userRef: string;
  id: number;
}

interface SingleCellInfoWithData extends SingleCellInfo {
  content: string;
  parentId: number | null;
}

/**
 * Helper class that extends DocData with cell specific functions.
 */
export class CellData {
  constructor(private _docData: DocData) {

  }

  /**
   * Finds if there are any new comments in the actions.
   */
  public hasNewComments(actions: DocAction[]): boolean {
    return actions.some((action) => {
      if (!isCellDataAction(action)) { return false; }
      if (isSomeAddRecordAction(action)) {
        return true;
      }
      return false;
    });
  }

  public getNewComments(actions: DocAction[]): MetaRowRecord<'_grist_Cells'>[] {
    const rows: MetaRowRecord<'_grist_Cells'>[] = [];
    for (const action of actions) {
      if (!isCellDataAction(action) || !isSomeAddRecordAction(action)) { continue; }
      for (const single of getSingleAction(action)) {
        const commentRow = getActionColValues(single as AddRecord);
        if (isCensored(commentRow.content)) {
          // If the content is censored, we don't want to return it.
          continue;
        }
        const id = getRowIds(single);
        rows.push({id, ...commentRow as any});
      }
    }
    return rows;
  }

  /**
   * Retrieves the audience (participants) for a given set of cell IDs.
   *
   * @param rowIds - An array of cell info IDs from the `_grist_Cells` table.
   * @returns A map where the key is the cell ID and the value is an array of user references
   *          (participants) associated with the whole thread, so all comments of the table/column/row
   *          combination.
   */
  public getAudience(rowIds: number[]): Map<number, string[]> {
    const result = new Map<number, string[]>(); // Stores the final mapping of cell IDs to participants.
    const read = new Map<string, string[]>(); // Caches participants for specific table/column/row combinations.

    for (const cId of rowIds) {
      // Retrieve cell information for the given cell ID.
      const cell = this.getCell(cId);
      if (!cell) { continue; }
      // Create a unique key for caching based on table, column, and row.
      const tableId = cell.tableId;
      const colId = cell.colId;
      const rowId = cell.rowId;
      const key = `${tableId}:${colId}:${rowId}`;

      // If participants for this key are already cached, use them.
      if (read.has(key)) {
        result.set(cId, read.get(key) || []);
      }
 else {
        // Otherwise, compute participants for this table/column/row combination.
        const participants = new Set(
          this.readCells(tableId, new Set([rowId]), colId).flatMap((c) => {
            const parsed = safeJsonParse(c.content, {}) as CommentContent; // Parse the cell content.
            return [c.userRef, ...parsed.mentions || []]; // Include the user reference and any mentions.
          })
        );

        // Cache the computed participants for the key.
        read.set(key, Array.from(participants));
        // Add the participants to the result map for the current cell ID.
        result.set(cId, Array.from(participants));
      }
    }

    return result;
  }

  public getCell(cellId: number) {
    const row = this._docData.getMetaTable("_grist_Cells").getRecord(cellId);
    return row ? this.convertToCellInfo(row) : null;
  }

  public getCellRecord(cellId: number) {
    const row = this._docData.getMetaTable("_grist_Cells").getRecord(cellId);
    return row || null;
  }

  /**
   * Generates a patch for cell metadata. It assumes, that engine removes all
   * cell metadata when cell (table/column/row) is removed and the bundle contains,
   * all actions that are needed to remove the cell and cell metadata.
   */
  public generatePatch(actions: DocAction[]) {
    const removedCells: Set<number> = new Set();
    const addedCells: Set<number> = new Set();
    const updatedCells: Set<number> = new Set();
    function applyCellAction(action: DataAction) {
      if (isSomeAddRecordAction(action)) {
        for(const id of getRowIdsFromDocAction(action)) {
          if (removedCells.has(id)) {
            removedCells.delete(id);
            updatedCells.add(id);
          }
 else {
            addedCells.add(id);
          }
        }
      }
 else if (isRemoveRecord(action) || isBulkRemoveRecord(action)) {
        for(const id of getRowIdsFromDocAction(action)) {
          if (addedCells.has(id)) {
            addedCells.delete(id);
          }
 else {
            removedCells.add(id);
            updatedCells.delete(id);
          }
        }
      }
 else {
        for(const id of getRowIdsFromDocAction(action)) {
          if (addedCells.has(id)) {
            // ignore
          }
 else {
            updatedCells.add(id);
          }
        }
      }
    }

    // Scan all actions and collect all cell ids that are added, removed or updated.
    // When some rows are updated, include all cells for that row. Keep track of table
    // renames.
    const updatedRows: Map<string, Set<number>> = new Map();
    for(const action of actions) {
      if (action[0] === 'RenameTable') {
        updatedRows.set(action[2], updatedRows.get(action[1]) || new Set());
        continue;
      }
      if (action[0] === 'RemoveTable') {
        updatedRows.delete(action[1]);
        continue;
      }
      if (isDataAction(action) && isCellDataAction(action)) {
        applyCellAction(action);
        continue;
      }
      if (!isDataAction(action)) { continue; }
      // We don't care about new rows, as they don't have meta data at this moment.
      // If regular rows are removed, we also don't care about them, as they will
      // produce metadata removal.
      // We only care about updates, as it might change the metadata visibility.
      if (isUpdateRecord(action) || isBulkUpdateRecord(action)) {
        if (getTableId(action).startsWith("_grist")) { continue; }
        // Updating a row, for us means that all metadata for this row should be refreshed.
        for(const rowId of getRowIdsFromDocAction(action)) {
          getSetMapValue(updatedRows, getTableId(action), () => new Set()).add(rowId);
        }
      }
    }

    for(const [tableId, rowIds] of updatedRows) {
      for(const {id} of this.readCells(tableId, rowIds)) {
        if (addedCells.has(id) || updatedCells.has(id) || removedCells.has(id)) {
          // If we have this cell id in the list of added/updated/removed cells, ignore it.
        }
 else {
          updatedCells.add(id);
        }
      }
    }

    const insert = this.generateInsert([...addedCells]);
    const update = this.generateUpdate([...updatedCells]);
    const removes = this.generateRemovals([...removedCells]);
    const patch: DocAction[] = [insert, update, removes].filter(Boolean) as DocAction[];
    return patch.length ? patch : null;
  }

  public async censorCells(
    docActions: DocAction[],
    hasAccess: (cell: SingleCellInfo) => Promise<boolean>
  ) {
    for (const action of docActions) {
      if (!isCellDataAction(action)) { continue; }
      if (isSomeRemoveRecordAction(action)) { continue; }
      if (!isBulkAction(action)) {
        const [, , rowId, colValues] = action;
        const cell = this.getCell(rowId);
        if (!cell || !await hasAccess(cell)) {
          colValues.content = [GristObjCode.Censored];
          colValues.userRef = '';
        }
      }
 else {
        const [, , rowIds, colValues] = action;
        for (let idx = 0; idx < rowIds.length; idx++) {
          const cell = this.getCell(rowIds[idx]);
          if (!cell || !await hasAccess(cell)) {
            colValues.content[idx] = [GristObjCode.Censored];
            colValues.userRef[idx] = '';
          }
        }
      }
    }
    return docActions;
  }

  public convertToCellInfo(cell: MetaRowRecord<'_grist_Cells'>): SingleCellInfoWithData {
    const singleCell = {
      id: cell.id,
      tableId: this.getTableId(cell.tableRef) as string,
      colId: this.getColId(cell.colRef) as string,
      rowId: cell.rowId,
      userRef: cell.userRef,
      parentId: cell.parentId,
      content: cell.content,
    };
    return singleCell;
  }

  public getColId(colRef: number) {
    return this._docData.getMetaTable("_grist_Tables_column").getValue(colRef, 'colId');
  }

  public getTableId(tableRef: number) {
    return this._docData.getMetaTable("_grist_Tables").getValue(tableRef, 'tableId');
  }

  public getTableRef(tableId: string) {
    return this._docData.getMetaTable("_grist_Tables").findRow('tableId', tableId) || undefined;
  }

  public getColRef(tableId: string, colId: string) {
    const parentId = this.getTableRef(tableId);
    if (!parentId) {
      throw new Error(`Table ${tableId} not found`);
    }
    const colRef = this._docData.getMetaTable("_grist_Tables_column").findMatchingRowId(
      {parentId, colId}
    );
    if (!colRef) {
      throw new Error(`Column ${colId} not found in table ${tableId}`);
    }
    return colRef;
  }

  /**
   * Returns all cells for a given table and row ids.
   */
  public readCells(tableId: string, rowIds: Set<number>, colId?: string) {
    const tableRef = this.getTableRef(tableId);
    const filter: Record<string, any> = {tableRef};
    if (colId) {
      filter.colRef = this.getColRef(tableId, colId);
    }
    const cells =  this._docData.getMetaTable("_grist_Cells").filterRecords(filter).filter(r => rowIds.has(r.rowId));
    return cells.map(this.convertToCellInfo.bind(this));
  }

  // Helper function that tells if a cell can be determined fully from the action itself.
  // Otherwise we need to look in the docData.
  public hasCellInfo(docAction: DocAction):
      docAction is UpdateRecord|BulkUpdateRecord|AddRecord|BulkAddRecord {
    if (!isDataAction(docAction)) { return false; }
    if (!isSomeRemoveRecordAction(docAction)) {
      const colValues = getActionColValues(docAction);
      if (colValues.tableRef && colValues.colRef && colValues.rowId && colValues.userRef) {
        return true;
      }
    }
    return false;
  }

  /**
   * Checks if cell is 'attached', i.e. it has a tableRef, colRef, rowId and userRef.
   */
  public isAttached(cell: SingleCellInfo) {
    return Boolean(cell.tableId && cell.rowId && cell.colId && cell.userRef);
  }

  /**
   * Reads all SingleCellInfo from docActions or from docData if action doesn't have enough information.
   */
  public convertToCells(action: DocAction): SingleCellInfo[] {
    if (!isDataAction(action)) { return []; }
    if (getTableId(action) !== '_grist_Cells') { return []; }
    const result: { tableId: string, rowId: number, colId: string, id: number, userRef: string}[] = [];
    if (isBulkAction(action)) {
      const rowIds = getRowIds(action);
      for (let idx = 0; idx < rowIds.length; idx++) {
        if (this.hasCellInfo(action)) {
          const colValues = getActionColValues(action);
          result.push({
            tableId: this.getTableId(colValues.tableRef[idx] as number) as string,
            colId: this.getColId(colValues.colRef[idx] as number) as string,
            rowId: colValues.rowId[idx] as number,
            userRef: (colValues.userRef[idx] ?? '') as string,
            id: rowIds[idx],
          });
        }
 else {
          const cellInfo = this.getCell(rowIds[idx]);
          if (cellInfo) {
            result.push(cellInfo);
          }
        }
      }
    }
 else {
      const rowId = getRowIds(action);
      if (this.hasCellInfo(action)) {
        const colValues = getActionColValues(action);
        result.push({
          tableId: this.getTableId(colValues.tableRef as number) as string,
          colId: this.getColId(colValues.colRef as number) as string,
          rowId: colValues.rowId as number,
          userRef: colValues.userRef as string,
          id: rowId,
        });
      }
 else {
        const cellInfo = this.getCell(rowId);
        if (cellInfo) {
          result.push(cellInfo);
        }
      }
    }
    return result;
  }

  public generateInsert(ids: number[]): DataAction | null {
    const action: BulkAddRecord = [
      'BulkAddRecord',
      '_grist_Cells',
      [],
      {
        tableRef: [],
        colRef: [],
        type: [],
        root: [],
        content: [],
        rowId: [],
        userRef: [],
        parentId: [],
      }
    ];
    for(const cell of ids) {
      const dataCell = this.getCellRecord(cell);
      if (!dataCell) { continue; }
      action[2].push(dataCell.id);
      action[3].content.push(dataCell.content);
      action[3].userRef.push(dataCell.userRef);
      action[3].tableRef.push(dataCell.tableRef);
      action[3].colRef.push(dataCell.colRef);
      action[3].type.push(dataCell.type);
      action[3].root.push(dataCell.root);
      action[3].rowId.push(dataCell.rowId);
      action[3].parentId.push(dataCell.parentId);
    }
    return action[2].length > 1 ? action :
           action[2].length == 1 ? [...getSingleAction(action)][0] : null;
  }

  public generateRemovals(ids: number[]) {
    const action: BulkRemoveRecord = [
      'BulkRemoveRecord',
      '_grist_Cells',
      ids
    ];
    return action[2].length > 1 ? action :
          action[2].length == 1 ? [...getSingleAction(action)][0] : null;
  }

  public generateUpdate(ids: number[]) {
    const action: BulkUpdateRecord = [
      'BulkUpdateRecord',
      '_grist_Cells',
      [],
      {
        content: [],
        userRef: [],
      }
    ];
    for(const cell of ids) {
      const dataCell = this.getCellRecord(cell);
      if (!dataCell) { continue; }
      action[2].push(dataCell.id);
      action[3].content.push(dataCell.content);
      action[3].userRef.push(dataCell.userRef);
    }
    return action[2].length > 1 ? action :
          action[2].length == 1 ? [...getSingleAction(action)][0] : null;
  }
}


type CellField = keyof MetaRowRecord<'_grist_Cells'>;

/**
 * Checks if only expected fields were changed between before and after.
 * @returns true if only allowed fields (or nothing) changed in the row.
 */
function checkChangedIds(
  before: MetaRowRecord<'_grist_Cells'>,
  after: MetaRowRecord<'_grist_Cells'>,
  allowed: Array<CellField>
) {
  // All columns except id, we assume after has same keys.
  const cols: CellField[] = Object.keys(before).filter(k => k !== 'id') as CellField[];
  const changed = cols.filter(c =>
    !isEqual(
      before[c],
      after[c]
    )
  );
  if (changed.length === 0) {
    return true;
  }
  const allowedSet = new Set(allowed);
  return changed.every(c => allowedSet.has(c));
}

/**
 * Checks if a field was toggled between before and after.
 */
function wasToggled(
  before: MetaRowRecord<'_grist_Cells'>,
  after: MetaRowRecord<'_grist_Cells'>,
  field: CellField) {
  return Boolean(before[field]) !== Boolean(after[field]);
}
