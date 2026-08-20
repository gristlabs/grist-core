import * as commands from "app/client/components/commands";
import { GristDoc } from "app/client/components/GristDoc";
import { ColumnRec, TableRec } from "app/client/models/DocModel";
import { urlState } from "app/client/models/gristUrlState";

import { Observable } from "grainjs";

/**
 * A single column elsewhere in the document whose formula references a given column.
 */
export interface ColumnReferenceEntry {
  tableId: string;
  colId: string;
  // Display labels, for showing to the user.
  tableLabel: string;
  colLabel: string;
}

function findTable(gristDoc: GristDoc, tableId: string): TableRec | undefined {
  return gristDoc.docModel.tables.rowModels.find(t => t.tableId.peek() === tableId);
}

function findColumn(table: TableRec | undefined, colId: string): ColumnRec | undefined {
  return table?.columns().all().find(c => c.colId.peek() === colId);
}

/**
 * Returns every column elsewhere in the document whose formula statically references
 * `tableId.colId`, based on a sandbox-side scan of formula source (see
 * Engine.find_col_dependents in sandbox/grist/engine.py).
 */
export async function fetchColumnReferences(
  gristDoc: GristDoc, tableId: string, colId: string,
): Promise<ColumnReferenceEntry[]> {
  const dependents = await gristDoc.docComm.findColDependents(tableId, colId);
  return dependents.map(({ tableId: depTableId, colId: depColId }) => {
    const table = findTable(gristDoc, depTableId);
    const column = findColumn(table, depColId);
    return {
      tableId: depTableId,
      colId: depColId,
      tableLabel: table?.tableNameDef.peek() ?? depTableId,
      colLabel: column?.label.peek() ?? depColId,
    };
  });
}

/**
 * Shows the given column: same-page columns move the cursor, columns on another page open as
 * an anchor-link popup so the user keeps their place.
 * 
 * Using only one approach for both cases is buggy.
 */
export async function navigateToColumn(gristDoc: GristDoc, tableId: string, colId: string): Promise<void> {
  const table = findTable(gristDoc, tableId);
  const column = findColumn(table, colId);
  if (!table || !column) { return; }

  const shownFields = column.viewFields().all().filter(f => !f.viewSection().isRaw.peek());
  const section = shownFields.length ? shownFields[0].viewSection() : table.rawViewSection();
  const sectionId = section.getRowId();

  const isOnCurrentPage = gristDoc.viewModel.viewSections.peek().peek()
    .some(s => s.id.peek() === sectionId);

  if (isOnCurrentPage) {
    const colRef = column.getRowId();
    const fieldIndex = section.viewFields.peek().all().findIndex(f => f.colRef.peek() === colRef);
    await gristDoc.moveToCursorPos({
      sectionId,
      fieldIndex: fieldIndex >= 0 ? fieldIndex : undefined,
    });
  } else {
    await urlState().pushUrl({
      hash: { sectionId, colRef: column.getRowId(), popup: true },
    });
  }
}

/**
 * Expand, scroll to, and highlight the "Formula references" section for * a specific column.
 * Consumed and cleared by buildReferencesConfig (FieldConfig.ts) once it acts on it, so it
 * doesn't fire again on a later, unrelated column selection.
 */
export const pendingReferencesReveal = Observable.create<{ tableId: string, colId: string } | null>(null, null);

/**
 * Selects a column, opens its config, and reveals its references section. Used by the
 * delete-confirmation dialog.
 */
export async function revealColumnReferences(gristDoc: GristDoc, tableId: string, colId: string): Promise<void> {
  pendingReferencesReveal.set({ tableId, colId });
  await navigateToColumn(gristDoc, tableId, colId);
  commands.allCommands.fieldTabOpen.run();
}
