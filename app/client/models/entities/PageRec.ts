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
    const isTableHidden = () => {
      const viewId = this.view().id();
      const tables = docModel.rawDataTables.all();
      const primaryTable = tables.find(t => t.primaryViewId() === viewId);
      return !!primaryTable && primaryTable.isHidden();
    };
    // Page is hidden when any of this is true:
    // - It has an empty name (or no name at all)
    // - It is GristDocTour (unless user wants to see it)
    // - It is a page generated for a hidden table TODO: Follow up - don't create
    //   pages for hidden tables.
    // This is used currently only the left panel, to hide pages from the user.
    return !name || (name === 'GristDocTour' && !docModel.showDocTourTable) || isTableHidden();
  });
}
