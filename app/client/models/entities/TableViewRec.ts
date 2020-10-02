import {DocModel, IRowModel, refRecord, TableRec, ViewRec} from 'app/client/models/DocModel';
import * as ko from 'knockout';

// Used in old-style list of views grouped by table.
export interface TableViewRec extends IRowModel<"_grist_TableViews"> {
  table: ko.Computed<TableRec>;
  view: ko.Computed<ViewRec>;
}

export function createTableViewRec(this: TableViewRec, docModel: DocModel): void {
  this.table = refRecord(docModel.tables, this.tableRef);
  this.view = refRecord(docModel.views, this.viewRef);
}
