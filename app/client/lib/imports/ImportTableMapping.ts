import { cssIncludeColumn } from "app/client/lib/imports/ImportCss";
import { Indeterminate, squareCheckbox, TriState } from "app/client/ui2018/checkbox";

import { Computed, dom, DomArg, IDisposableOwner, Observable } from "grainjs";

/**
 * One row of the mapping step: a source table and where to import it.
 *
 * `Destination` varies by importer, but is some combination of {@link NewTable} and
 * {@link ExistingTable}.
 */
export interface ImportTableMapping<Destination> {
  tableId: string;
  /**
   * The table's destination, or null when it is skipped (equivalently, unchecked).
   */
  destination: Observable<Destination | null>;
  /**
   * The destination to restore when the table is checked again, so that unchecking and
   * rechecking preserves a "structure only" or existing-table choice.
   */
  lastDestination: Destination;
}

export interface NewTable {
  type: "new-table";
  structureOnly: boolean;
}

/** A table that is already in the destination document, to import into. */
export interface ExistingTable {
  type: "existing-table";
  tableId: string;
}

export const IMPORT_TABLE_AND_DATA: NewTable = { type: "new-table", structureOnly: false };

/**
 * The mappings whose table is included in the import (i.e. not skipped).
 */
export function includedTablesComputed<M extends ImportTableMapping<any>>(
  owner: IDisposableOwner, mappings: Observable<M[]>,
): Computed<M[]> {
  return Computed.create(owner, use => use(mappings).filter(m => use(m.destination) !== null));
}

/**
 * Drives the header checkbox: ticked when every table is included, unticked when none
 * is, and indeterminate in between. Writing to it includes or skips them all.
 */
export function allTablesIncludedComputed<M extends ImportTableMapping<any>>(
  owner: IDisposableOwner, mappings: Observable<M[]>, includedTables: Observable<M[]>,
): Computed<TriState> {
  return Computed.create<TriState>(owner, (use) => {
    const total = use(mappings).length;
    const included = use(includedTables).length;
    if (included === 0) { return false; }
    return included === total ? true : Indeterminate;
  }).onWrite((include) => {
    for (const mapping of mappings.get()) {
      mapping.destination.set(include ? mapping.lastDestination : null);
    }
  });
}

/**
 * The include checkbox of one mapping row. Unchecking is the same thing as choosing
 * "Skip" in the destination menu, so the two stay in sync automatically.
 */
export function includeTableCheckbox<D>(
  mapping: ImportTableMapping<D>, ...domArgs: DomArg<HTMLInputElement>[]
) {
  return cssIncludeColumn(
    dom.create((owner) => {
      const included = Computed.create(owner, use => use(mapping.destination) !== null)
        .onWrite(include => mapping.destination.set(include ? mapping.lastDestination : null));
      return squareCheckbox(included, ...domArgs);
    }),
  );
}
