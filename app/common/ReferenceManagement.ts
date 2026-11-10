import { ReferenceFilter, ReferencePublicationSpec } from "app/common/ReferenceTables";

import isEqual from "lodash/isEqual";

export interface ReferenceContractChange {
  tableRef: number;
  addedColumns: number[];
  removedColumns: number[];
  previousFilters: ReferenceFilter[];
  filters: ReferenceFilter[];
  filtersChanged: boolean;
}
export function compareReferenceContracts(previous: ReferencePublicationSpec, current: ReferencePublicationSpec):
ReferenceContractChange[] {
  const refs = new Set([...previous.tables, ...current.tables].map(t => t.tableRef));
  return [...refs].map((tableRef) => {
    const before = previous.tables.find(t => t.tableRef === tableRef);
    const after = current.tables.find(t => t.tableRef === tableRef);
    return { tableRef,
      addedColumns: (after?.colRefs || []).filter(c => !before?.colRefs.includes(c)),
      removedColumns: (before?.colRefs || []).filter(c => !after?.colRefs.includes(c)),
      previousFilters: before?.filters || [], filters: after?.filters || [],
      filtersChanged: !isEqual(before?.filters || [], after?.filters || []),
    };
  }).filter(t => t.addedColumns.length || t.removedColumns.length || t.filtersChanged);
}
export interface ReferenceRevocationPreview {
  count: number;
  linksToDisable: number;
  token: string;
}
