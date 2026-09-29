import { ApplyUAOptions, ApplyUAResult } from "app/common/ActiveDocAPI";
import { UserAction } from "app/common/DocActions";
import { DocData } from "app/common/DocData";
import { isHiddenCol } from "app/common/gristTypes";
import { isNonNullish } from "app/common/gutil";
import { isTableCensored } from "app/common/isHiddenTable";
import { SchemaTypes } from "app/common/schema";
import { ActiveDoc } from "app/server/lib/ActiveDoc";
import { OptDocSession } from "app/server/lib/DocSession";

/**
 * The document's own metadata, not filtered by access rules. Suitable for
 * resolving refs while applying actions, but not for building a response.
 */
export function getRawMeta(doc: ActiveDoc): DocData {
  if (!doc.docData) {
    throw new Error("Document not ready");
  }

  return doc.docData;
}

/**
 * Metadata as `docSession` is allowed to see it, the same as the browser
 * client receives. It may be a copy, so re-read it after applying actions.
 */
export async function getCensoredMeta(docSession: OptDocSession, doc: ActiveDoc): Promise<DocData> {
  if (await doc.canReadEverything(docSession)) { return getRawMeta(doc); }
  const metaTables = await doc.fetchMetaTables(docSession);
  return new DocData(() => { throw new Error("Unexpected DocData fetch"); }, metaTables);
}

// Censoring blanks a widget's tableRef to 0.
function isCensoredWidget(widget: { tableRef: number }) {
  return widget.tableRef === 0;
}

export function getTableById(docData: DocData, id: number) {
  return getRecordById(docData, "_grist_Tables", id);
}

export function getTableColumnById(docData: DocData, id: number) {
  return getRecordById(docData, "_grist_Tables_column", id);
}

export function getTableColumnsByTableId(docData: DocData, tableId: number) {
  const table = getTableById(docData, tableId);
  return docData.getMetaTable("_grist_Tables_column").filterRecords({ parentId: table.id });
}

/**
 * Whether the session can see a widget. The table's id is checked too, as
 * censoring leaves the raw section of a denied table intact when a summary of
 * it is readable.
 */
export function isVisibleWidget(docData: DocData, widget: { tableRef: number }) {
  return !isCensoredWidget(widget) && !isTableCensored(docData.getMetaTable("_grist_Tables"), widget.tableRef);
}

/**
 * Throws "not found" for a widget the session cannot see.
 */
export function getWidgetById(docData: DocData, id: number) {
  const widget = docData.getMetaTable("_grist_Views_section").getRecord(id);
  if (!widget || !isVisibleWidget(docData, widget)) {
    throw new Error(`Widget ${id} not found`);
  }

  return widget;
}

/**
 * Whether the session can see a page. Censoring blanks a page's name when any
 * of its widgets is denied; a page with some visible widget still counts.
 * The browser hides such a page, but tools keep it so its visible widgets
 * stay reachable.
 */
export function isVisiblePage(docData: DocData, page: { id: number, name: string }) {
  return Boolean(page.name) || docData.getMetaTable("_grist_Views_section")
    .filterRecords({ parentId: page.id })
    .some(widget => isVisibleWidget(docData, widget));
}

/**
 * Throws "not found" for a page the session cannot see.
 */
export function getPageById(docData: DocData, id: number) {
  const page = getRecordById(docData, "_grist_Views", id);
  if (!isVisiblePage(docData, page)) {
    throw new Error(`Page ${id} not found`);
  }

  return page;
}

export interface WidgetField {
  field_id: number;
  column_id: string;
  label: string;
  width: number | null;
}

/**
 * The columns a widget shows, in display order, without helper columns.
 */
export function getWidgetFields(docData: DocData, widgetId: number): WidgetField[] {
  // An unknown widget would otherwise read as one with no fields.
  getWidgetById(docData, widgetId);
  const cols = docData.getMetaTable("_grist_Tables_column");
  return docData.getMetaTable("_grist_Views_section_field")
    .filterRecords({ parentId: widgetId })
    .map((field) => {
      const col = cols.getRecord(field.colRef);
      return col ? { field, col } : null;
    })
    .filter(isNonNullish)
    .filter(({ col }) => !isHiddenCol(col.colId))
    .sort((a, b) => a.field.parentPos - b.field.parentPos)
    .map(({ field, col }) => ({
      field_id: field.id,
      column_id: col.colId,
      label: col.label || col.colId,
      // Grist stores 0 (or nothing) for a column that takes the widget's default width.
      width: typeof field.width === "number" && field.width > 0 ? field.width : null,
    }));
}

/**
 * The widgets on a page that the session can see.
 */
export function getWidgetsByPageId(docData: DocData, pageId: number) {
  const page = getPageById(docData, pageId);
  return docData.getMetaTable("_grist_Views_section").filterRecords({ parentId: page.id })
    .filter(widget => isVisibleWidget(docData, widget));
}

function getRecordById<TableId extends keyof SchemaTypes>(
  docData: DocData,
  tableId: TableId,
  id: number,
) {
  const record = docData.getMetaTable(tableId).getRecord(id);
  if (!record || isCensoredRecord(tableId, record)) {
    throw new Error(`${getRecordName(tableId)} ${id} not found`);
  }

  return record;
}

// Censoring blanks a record rather than removing it, so a censored record
// reads as missing. Pages and widgets have their own checks.
function isCensoredRecord(tableId: keyof SchemaTypes, record: any): boolean {
  switch (tableId) {
    case "_grist_Tables": return !record.tableId;
    case "_grist_Tables_column": return !record.parentId;
    default: return false;
  }
}

function getRecordName(tableId: keyof SchemaTypes) {
  switch (tableId) {
    case "_grist_Tables": {
      return "Table";
    }
    case "_grist_Tables_column": {
      return "Column";
    }
    case "_grist_Views": {
      return "Page";
    }
    default: {
      return "Record";
    }
  }
}

/**
 * A poor man's transaction over a doc session. Actions applied through the block
 * are bundled into a single undo unit, so rollback() can undo them all if something
 * goes wrong. Unlike a real DB transaction, applied actions are committed and visible
 * immediately; rollback() issues compensating undo actions rather than discarding
 * uncommitted work.
 *
 * Usage: apply through block.applyUserActions(); on success call commit() (stops
 * bundling), on failure call rollback() (undoes what was applied, then stops bundling).
 * Most callers should use runInUndoBlock() instead, which handles commit/rollback.
 */
export interface UndoBlock {
  applyUserActions(actions: UserAction[], options?: ApplyUAOptions): Promise<ApplyUAResult>;
  rollback(): Promise<void>;
  commit(): void;
}

export function startUndoBlock(doc: ActiveDoc, docSession: OptDocSession): UndoBlock {
  doc.startBundleUserActions(docSession);
  const applied: ApplyUAResult[] = [];
  // stopBundleUserActions always clears linkId, so guard against calling it twice
  // (e.g. commit() after rollback()).
  let bundling = true;
  const stopBundling = () => {
    if (bundling) {
      bundling = false;
      doc.stopBundleUserActions(docSession);
    }
  };
  return {
    async applyUserActions(actions, options) {
      const result = await doc.applyUserActions(docSession, actions, options);
      applied.push(result);
      return result;
    },
    async rollback() {
      try {
        // Actions without a hash (e.g. no-op meta updates) can't be undone; skip them.
        const undoable = applied.filter(a => a.actionHash);
        if (undoable.length > 0) {
          await doc.applyUserActionsById(
            docSession,
            undoable.map(a => a.actionNum),
            undoable.map(a => a.actionHash!),
            true,
          );
        }
      } finally {
        stopBundling();
      }
    },
    commit() {
      stopBundling();
    },
  };
}

/**
 * Runs a callback inside an undo block (see startUndoBlock): the block is committed
 * if the callback resolves, or rolled back (and the error rethrown) if it throws.
 * Apply actions through the `tx` passed to the callback so they get bundled.
 */
export async function runInUndoBlock<T>(
  doc: ActiveDoc,
  docSession: OptDocSession,
  callback: (tx: UndoBlock) => Promise<T>,
): Promise<T> {
  const tx = startUndoBlock(doc, docSession);
  try {
    const result = await callback(tx);
    tx.commit();
    return result;
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}
