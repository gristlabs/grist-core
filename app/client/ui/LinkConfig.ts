import { ColumnRec, ViewSectionRec } from "app/client/models/DocModel";
import { getReferencedTableId } from "app/common/gristTypes";
import assert from "assert";

export class LinkConfig {
  public readonly srcSection: ViewSectionRec;
  public readonly tgtSection: ViewSectionRec;
  // Note that srcCol and tgtCol may be the empty column records if that column is not used.
  public readonly srcCol: ColumnRec;
  public readonly tgtCol: ColumnRec;
  public readonly srcColId: string|undefined;
  public readonly tgtColId: string|undefined;

  // The constructor throws an exception if settings are invalid. When used from inside a knockout
  // computed, the constructor subscribes to all parts relevant for linking.
  constructor(tgtSection: ViewSectionRec) {
    this.tgtCol = tgtSection.linkTargetCol();
    this.srcCol = tgtSection.linkSrcCol();
    this.srcSection = tgtSection.linkSrcSection();
    this.tgtSection = tgtSection;
    this.srcColId = this.srcCol.colId();
    this.tgtColId = this.tgtCol.colId();
    this._assertValid();
  }

  // Check if section-linking configuration is valid, and throw exception if not.
  private _assertValid(): void {
    // Use null for unset cols (rather than an empty ColumnRec) for easier comparisons below.
    const srcCol = this.srcCol?.getRowId() ? this.srcCol : null;
    const tgtCol = this.tgtCol?.getRowId() ? this.tgtCol : null;
    const srcTableId = (srcCol ? getReferencedTableId(srcCol.type()) :
      this.srcSection.table().primaryTableId());
    const tgtTableId = (tgtCol ? getReferencedTableId(tgtCol.type()) :
      this.tgtSection.table().primaryTableId());
    const srcTableSummarySourceTable = this.srcSection.table().summarySourceTable();
    const tgtTableSummarySourceTable = this.tgtSection.table().summarySourceTable();
    try {
      assert(Boolean(this.srcSection.getRowId()), "srcSection was disposed");
      assert(!tgtCol || tgtCol.parentId() === this.tgtSection.tableRef(), "tgtCol belongs to wrong table");
      assert(!srcCol || srcCol.parentId() === this.srcSection.tableRef(), "srcCol belongs to wrong table");
      assert(this.srcSection.getRowId() !== this.tgtSection.getRowId(), "srcSection links to itself");

      // We usually expect srcTableId and tgtTableId to be non-empty, but there's one exception:
      // when linking two summary tables that share a source table (which we can check directly)
      // and the source table is hidden by ACL, so its tableId is empty from our perspective.
      if (!(srcTableSummarySourceTable !== 0 && srcTableSummarySourceTable === tgtTableSummarySourceTable)) {
        assert(tgtTableId, "tgtCol not a valid reference");
        assert(srcTableId, "srcCol not a valid reference");
      }
      assert(srcTableId === tgtTableId, "mismatched tableIds");

      // If this section has a custom link filter, it can't create cycles.
      if (this.tgtSection.selectedRowsActive()) {
        // Make sure we don't have a cycle.
        let src = this.tgtSection.linkSrcSection();
        while (!src.isDisposed() && src.getRowId()) {
          assert(src.getRowId() !== this.srcSection.getRowId(),
            "Sections with filter linking can't be part of a cycle (same record linking)'");
          src = src.linkSrcSection();
        }
      }

    } catch (e) {
      throw new Error(`LinkConfig invalid: ` +
        `${this.srcSection.getRowId()}:${this.srcCol?.getRowId()}[${srcTableId}] -> ` +
        `${this.tgtSection.getRowId()}:${this.tgtCol?.getRowId()}[${tgtTableId}]: ${e}`);
    }
  }
}
