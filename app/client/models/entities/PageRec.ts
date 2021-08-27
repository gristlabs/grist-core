import {DocModel, IRowModel, refRecord, ViewRec} from 'app/client/models/DocModel';
import * as ko from 'knockout';

// Represents a page entry in the tree of pages.
export interface PageRec extends IRowModel<"_grist_Pages"> {
  view: ko.Computed<ViewRec>;
  isHidden: ko.Computed<boolean>;
}

export function createPageRec(this: PageRec, docModel: DocModel): void {
  this.view = refRecord(docModel.views, this.viewRef);
  this.isHidden = ko.pureComputed(() => {
    const name = this.view().name();
    return !name || (name === 'GristDocTour' && !docModel.showDocTourTable);
  });
}
