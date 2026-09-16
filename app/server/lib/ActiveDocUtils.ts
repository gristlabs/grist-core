import { ApplyUAOptions, ApplyUAResult } from "app/common/ActiveDocAPI";
import { UserAction } from "app/common/DocActions";
import { isHiddenCol } from "app/common/gristTypes";
import { isNonNullish } from "app/common/gutil";
import { SchemaTypes } from "app/common/schema";
import { ActiveDoc } from "app/server/lib/ActiveDoc";
import { OptDocSession } from "app/server/lib/DocSession";

export function getTableById(doc: ActiveDoc, id: number) {
  return getRecordById(doc, "_grist_Tables", id);
}

export function getTableColumnById(doc: ActiveDoc, id: number) {
  return getRecordById(doc, "_grist_Tables_column", id);
}

export function getTableColumnsByTableId(doc: ActiveDoc, tableId: number) {
  const table = getTableById(doc, tableId);
  return getDocDataOrThrow(doc)
    .getMetaTable("_grist_Tables_column")
    .filterRecords({
      parentId: table.id,
    });
}

export function getWidgetById(doc: ActiveDoc, id: number) {
  return getRecordById(doc, "_grist_Views_section", id);
}

export function getPageById(doc: ActiveDoc, id: number) {
  return getRecordById(doc, "_grist_Views", id);
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
export function getWidgetFields(doc: ActiveDoc, widgetId: number): WidgetField[] {
  // An unknown widget would otherwise read as one with no fields.
  getWidgetById(doc, widgetId);
  const docData = getDocDataOrThrow(doc);
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

export function getWidgetsByPageId(doc: ActiveDoc, pageId: number) {
  const page = getPageById(doc, pageId);
  return getDocDataOrThrow(doc)
    .getMetaTable("_grist_Views_section")
    .filterRecords({ parentId: page.id });
}

export function getDocDataOrThrow(doc: ActiveDoc) {
  const docData = doc.docData;
  if (!docData) {
    throw new Error("Document not ready");
  }

  return docData;
}

function getRecordById<TableId extends keyof SchemaTypes>(
  doc: ActiveDoc,
  tableId: TableId,
  id: number,
) {
  const record = getDocDataOrThrow(doc).getMetaTable(tableId).getRecord(id);
  if (!record) {
    throw new Error(`${getRecordName(tableId)} ${id} not found`);
  }

  return record;
}

function getRecordName(tableId: keyof SchemaTypes) {
  switch (tableId) {
    case "_grist_Tables": {
      return "Table";
    }
    case "_grist_Tables_column": {
      return "Column";
    }
    case "_grist_Views_section": {
      return "Widget";
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
