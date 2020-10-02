import {DocModel, IRowModel, refRecord, ViewRec} from 'app/client/models/DocModel';
import * as ko from 'knockout';

// Represents a page entry in the tree of pages.
export interface TabBarRec extends IRowModel<"_grist_TabBar"> {
  view: ko.Computed<ViewRec>;
}

export function createTabBarRec(this: TabBarRec, docModel: DocModel): void {
  this.view = refRecord(docModel.views, this.viewRef);
}
