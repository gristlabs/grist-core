/**
 * An implementation of daff (tabular diff tool) to apply changes.
 * Incomplete and naive.
 *
 * A patch lands as a single applyUserActions call, so a proposal either
 * applies fully or not at all. Rows it adds carry negative temporary ids
 * that the engine replaces with real ones as the bundle applies.
 *
 * The rule that shapes everything below: temp ids resolve as rows land, so
 * a reference may only name a row added earlier in the same bundle. A
 * forward reference is rejected, taking the whole bundle with it.
 */

import { TableDelta } from "app/common/ActionSummary";
import { PatchItem, PatchLog } from "app/common/ActiveDocAPI";
import { BulkColValues, CellValue, getColValues, UserAction } from "app/common/DocActions";
import { DocStateComparisonDetails } from "app/common/DocState";
import { isHiddenCol } from "app/common/gristTypes";
import { getSetMapValue } from "app/common/gutil";
import { MetaRowRecord, MetaTableData } from "app/common/TableData";
import { CellDelta } from "app/common/TabularDiff";
import { ActiveDoc } from "app/server/lib/ActiveDoc";
import { OptDocSession } from "app/server/lib/DocSession";
import { IsAddedRow, RefInfo, refInfoFromType, translateRefValue } from "app/server/lib/RefTranslator";

import groupBy from "lodash/groupBy";

// Cells to write to one row, before grouping into a BulkUpdateRecord.
interface RowCells {
  rowId: number;
  cells: Record<string, CellValue>;
}

// One row an Add contributes, with the columns the source actually touched.
interface RowAdd {
  sourceRowId: number;
  tempRowId: number;
  cols: string[];
}

export class Patch {
  private _columnsByTableIdAndColId: Record<string, Record<string, MetaRowRecord<"_grist_Tables_column">>> = {};
  private _refInfoByTableAndCol = new Map<string, Map<string, RefInfo>>();
  private _columns: MetaTableData<"_grist_Tables_column">;
  private _tables: MetaTableData<"_grist_Tables">;

  public constructor(private _activeDoc: ActiveDoc, private _docSession: OptDocSession) {
    const columns = this._activeDoc.docData?.getMetaTable("_grist_Tables_column");
    const tables = this._activeDoc.docData?.getMetaTable("_grist_Tables");
    if (!columns || !tables) {
      throw new Error("Attempt to patch before document is initialized");
    }
    this._columns = columns;
    this._tables = tables;
  }

  /**
   * Apply the given comparison as a patch. Returns a note per engine action
   * built, or a single error note if nothing was built and nothing applied.
   */
  public async applyChanges(details: DocStateComparisonDetails): Promise<PatchLog> {
    const changes: PatchItem[] = [];
    try {
      const summary = details.leftChanges;

      if (summary.tableRenames.length > 0) {
        throw new Error("table-level changes cannot be handled yet");
      }

      // Ignore metadata for now. Filtered before the guards below, so they
      // cannot refuse a patch over a table nothing here would touch.
      const userTables: [string, TableDelta][] = Object.entries(summary.tableDeltas)
        .filter(([tableId]) => !tableId.startsWith("_grist_"));

      for (const [tableId, delta] of userTables) {
        if (delta.columnRenames.length > 0) {
          throw new Error("column-level changes cannot be handled yet");
        }
        // A summary truncated under a row cap reads its dropped cells as
        // "?", which would apply as nulls over real data. Callers must
        // summarize with maximumInlineRows: null.
        if (delta.mayBeIncomplete) {
          throw new Error(`summary for table ${tableId} may be incomplete; refusing to apply`);
        }
      }

      const actions = this._buildActions(userTables);
      // Describe before writing, so an action we cannot account for is
      // caught while the document is still untouched.
      const described = actions.map(describeAction);

      if (actions.length > 0) {
        // The one and only write.
        await this._activeDoc.applyUserActions(this._docSession, actions);
      }
      changes.push(...described);
    } catch (e) {
      changes.push({ kind: "error", msg: String(e) });
    }
    // An empty patch counts as applied. Calling it unapplied would leave
    // the proposal open with nothing left to accept.
    const applied = !changes.some(change => change.kind === "error");
    return { changes, applied };
  }

  /**
   * Build the whole bundle without touching the document. One part of this
   * order is load-bearing: every Add must precede anything carrying a temp
   * id, meaning the Updates, whose Refs may name added rows, and the Ref
   * cells held back from the Adds. Removes lead only for readability.
   */
  private _buildActions(userTables: [string, TableDelta][]): UserAction[] {
    // Source row ids this patch adds, per table. Local to the call, so
    // nothing about one patch is visible to the next.
    const addedRows = new Map<string, Set<number>>();
    for (const [tableId, delta] of userTables) {
      addedRows.set(tableId, new Set(delta.addRows));
    }
    const isAddedRow: IsAddedRow = (tableId, sourceRowId) =>
      Boolean(addedRows.get(tableId)?.has(sourceRowId));

    const actions: UserAction[] = [];
    const heldBack: { tableId: string, rows: RowCells[] }[] = [];
    for (const [tableId, delta] of userTables) {
      actions.push(...removeActions(tableId, delta));
    }
    for (const [tableId, delta] of userTables) {
      const added = this._addActions(tableId, delta, isAddedRow);
      actions.push(...added.actions);
      if (added.heldBack.length > 0) { heldBack.push({ tableId, rows: added.heldBack }); }
    }
    for (const [tableId, delta] of userTables) {
      actions.push(...this._updateActions(tableId, delta, isAddedRow));
    }
    // The Ref cells held out of the Adds. Temp ids appear here in both the
    // row-id position and the values, all resolved by the time the engine
    // reaches these actions.
    for (const { tableId, rows } of heldBack) {
      actions.push(...bulkUpdates(tableId, rows));
    }
    return actions;
  }

  /**
   * Build the Adds for one table, along with the Ref cells held out of them:
   * those name rows this patch adds, so they cannot go inline, and are set by
   * a later update instead. Holding them uniformly frees the patch from
   * ordering tables to suit its references, and resolves cycles both ways.
   */
  private _addActions(
    tableId: string, delta: TableDelta, isAddedRow: IsAddedRow,
  ): { actions: UserAction[], heldBack: RowCells[] } {
    const rows = delta.addRows;
    if (rows.length === 0) { return { actions: [], heldBack: [] }; }
    const columnDeltas = delta.columnDeltas;
    const colIds = Object.keys(columnDeltas).filter(colId => !this._shouldSkip(tableId, colId));

    const additions: RowAdd[] = rows.map(row => ({
      sourceRowId: row,
      // Negating the source id keeps temp ids distinct within the table,
      // which is all the engine asks of them.
      tempRowId: -row,
      cols: colIds.filter(colId => columnDeltas[colId][row]),
    }));

    const actions: UserAction[] = [];
    const heldBack: RowCells[] = [];
    for (const group of groupByColumnSet(additions, ra => ra.cols)) {
      const groupCols = group[0].cols;
      const colValues: Record<string, CellValue[]> = {};
      for (const colId of groupCols) { colValues[colId] = []; }
      for (const ra of group) {
        const cells: Record<string, CellValue> = {};
        for (const colId of groupCols) {
          const value = extractValue(columnDeltas[colId][ra.sourceRowId][1]);
          const translated = translateRefValue(this._getRefInfo(tableId, colId), value, isAddedRow);
          if (!translated) {
            colValues[colId].push(value);
          } else {
            cells[colId] = translated.value;
            colValues[colId].push(null);
          }
        }
        if (Object.keys(cells).length > 0) { heldBack.push({ rowId: ra.tempRowId, cells }); }
      }
      actions.push(["BulkAddRecord", tableId, group.map(ra => ra.tempRowId), colValues]);
    }
    return { actions, heldBack };
  }

  private _updateActions(tableId: string, delta: TableDelta, isAddedRow: IsAddedRow): UserAction[] {
    // Rows also being added got their final values in the add pass; rows
    // also being removed are gone by this point and updating them would
    // throw. Summaries do list rows in two buckets at once, so filter here
    // rather than trusting them not to.
    const excludedRows = new Set([...delta.addRows, ...delta.removeRows]);
    const rows = delta.updateRows.filter(r => !excludedRows.has(r));
    if (rows.length === 0) { return []; }
    const colEntries = Object.entries(delta.columnDeltas).filter(
      ([colId, _]) => !this._shouldSkip(tableId, colId));

    const rowChanges: RowCells[] = [];
    for (const row of rows) {
      const cells: Record<string, CellValue> = {};
      for (const [colId, columnDelta] of colEntries) {
        const cellDelta = columnDelta[row];
        if (!cellDelta) { continue; }
        const value = extractValue(cellDelta[1]);
        // Every Add is already in the bundle, so temp ids here resolve and
        // need no deferral.
        const translated = translateRefValue(this._getRefInfo(tableId, colId), value, isAddedRow);
        cells[colId] = translated ? translated.value : value;
      }
      if (Object.keys(cells).length > 0) { rowChanges.push({ rowId: row, cells }); }
    }

    return bulkUpdates(tableId, rowChanges);
  }

  /**
   * Skip formula columns or certain special columns.
   */
  private _shouldSkip(tableId: string, colId: string): boolean {
    const prop = this._getTableColumn(tableId, colId);
    // Careful, isFormula set, with a blank formula, means
    // an empty column.
    // Hidden columns are currently gristHelper_ columns
    // (for conditional formatting, so formula columns in
    // any case, or manualSort. Changing manualSort is
    // complicated, let's not get into it yet.
    return (Boolean(prop.isFormula) && Boolean(prop.formula)) ||
      isHiddenCol(colId);
  }

  private _getTableColumn(tableId: string, colId: string) {
    const column = this._getTableColumns(tableId)[colId];
    if (!column) {
      throw new Error(`column not found: ${colId}`);
    }
    return column;
  }

  private _getTableColumns(tableId: string) {
    if (this._columnsByTableIdAndColId[tableId]) {
      return this._columnsByTableIdAndColId[tableId];
    }
    const table = this._tables.findRecord("tableId", tableId);
    if (!table) {
      throw new Error(`table not found: ${tableId}`);
    }
    const columns = this._columns.getRecords().filter(rec => rec.parentId === table.id);
    this._columnsByTableIdAndColId[tableId] = Object.fromEntries(columns.map(rec => [String(rec.colId), rec]));
    return this._columnsByTableIdAndColId[tableId];
  }

  private _getRefInfo(tableId: string, colId: string): RefInfo {
    const inner = getSetMapValue(this._refInfoByTableAndCol, tableId, () => new Map<string, RefInfo>());
    const cached = inner.get(colId);
    if (cached) { return cached; }
    const col = this._getTableColumn(tableId, colId);
    const result = refInfoFromType(String(col.type ?? ""));
    inner.set(colId, result);
    return result;
  }
}

function removeActions(tableId: string, delta: TableDelta): UserAction[] {
  const rows = delta.removeRows;
  return rows.length === 0 ? [] : [["BulkRemoveRecord", tableId, rows]];
}

/** Write the given rows, one BulkUpdateRecord per distinct column set. */
function bulkUpdates(tableId: string, rowChanges: RowCells[]): UserAction[] {
  return groupByColumnSet(rowChanges, rc => Object.keys(rc.cells)).map(
    group => ["BulkUpdateRecord", tableId, group.map(g => g.rowId),
      getColValues(group.map(g => g.cells))] as UserAction);
}

/**
 * Bucket items by the set of columns they write, one bucket per BulkAdd or
 * BulkUpdate. Mixing rows with different touched-column sets would force
 * null into columns the source left at their defaults.
 */
function groupByColumnSet<T>(items: T[], colsOf: (t: T) => string[]): T[][] {
  // ColIds can't contain NUL, so the joined sorted-cols string is unique.
  return Object.values(groupBy(items, item => colsOf(item).slice().sort().join("\0")));
}

// A CellDelta side is `[value]`, `"?"` (unknown), or `null` (cell didn't
// exist). The latter two collapse to null.
function extractValue(side: CellDelta[0]): CellValue {
  return Array.isArray(side) ? side[0] : null;
}

/**
 * Describe one action for the patch log. Deriving the log from the actions,
 * rather than accumulating it alongside them, keeps the two from drifting.
 */
function describeAction(action: UserAction): PatchItem {
  const [name, tableId, rowIds, colValues] =
    action as [string, string, number[], BulkColValues];
  switch (name) {
    case "BulkAddRecord": return { kind: "add", tableId, rowCount: rowIds.length };
    case "BulkRemoveRecord": return { kind: "remove", tableId, rowCount: rowIds.length };
    case "BulkUpdateRecord":
      return { kind: "update", tableId, cellCount: rowIds.length * Object.keys(colValues).length };
    default: throw new Error(`patch built an action it cannot describe: ${name}`);
  }
}
