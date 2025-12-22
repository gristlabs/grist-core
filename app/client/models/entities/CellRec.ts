import { isCensored } from "app/common/gristTypes";
import * as ko from "knockout";
import { KoArray } from "app/client/lib/koArray";
import { jsonObservable } from "app/client/models/modelUtil";
import * as modelUtil from "app/client/models/modelUtil";
import { ColumnRec, DocModel, IRowModel, recordSet, refRecord, TableRec } from "app/client/models/DocModel";

export interface CellRec extends IRowModel<"_grist_Cells"> {
  column: ko.Computed<ColumnRec>;
  table: ko.Computed<TableRec>;
  children: ko.Computed<KoArray<CellRec>>;
  hidden: ko.Computed<boolean>;
  parent: ko.Computed<CellRec>;

  text: modelUtil.KoSaveableObservable<string|undefined>;
  userName: modelUtil.KoSaveableObservable<string|undefined>;
  mentions: modelUtil.KoSaveableObservable<string[]|undefined>;
  sectionId: modelUtil.KoSaveableObservable<number|undefined>;
}

export function createCellRec(this: CellRec, docModel: DocModel): void {
  this.hidden = ko.pureComputed(() => isCensored(this.content()));
  this.column = refRecord(docModel.columns, this.colRef);
  this.table = refRecord(docModel.tables, this.tableRef);
  this.parent = refRecord(docModel.cells, this.parentId);
  this.children = recordSet(this, docModel.cells, "parentId");
  const properContent = modelUtil.savingComputed({
    read: () => this.hidden() ? "{}" : this.content(),
    write: (setter, val) => setter(this.content, val),
  });
  const optionJson = jsonObservable(properContent);

  // Comments:
  this.text = optionJson.prop('text');
  this.userName = optionJson.prop('userName');
  this.mentions = optionJson.prop('mentions');
  this.sectionId = optionJson.prop('sectionId');
}
