import { ColumnRec, DocModel, IRowModel, refListRecords, refRecord, TableRec } from "app/client/models/DocModel";
import * as modelUtil from "app/client/models/modelUtil";
import { ConditionType, TriggerAction } from "app/common/Triggers";

import * as ko from "knockout";

export interface TriggerRec extends IRowModel<"_grist_Triggers"> {
  table: ko.Computed<TableRec>;
  isReadyCol: ko.Computed<ColumnRec>;
  watchedCols: ko.Computed<ColumnRec[]>;

  actionsJson: modelUtil.ObjObservable<TriggerAction[]>;
  conditionJson: modelUtil.ObjObservable<ConditionType>;
}

export function createTriggerRec(this: TriggerRec, docModel: DocModel): void {
  this.table = refRecord(docModel.tables, this.tableRef);
  this.isReadyCol = refRecord(docModel.columns, this.isReadyColRef);
  this.watchedCols = refListRecords(docModel.columns, ko.pureComputed(() => this.watchedColRefList()));

  this.actionsJson = modelUtil.jsonObservable(this.actions);
  this.conditionJson = modelUtil.jsonObservable(this.condition);
}
