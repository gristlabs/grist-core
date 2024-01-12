import {DocModel, IRowModel, refRecord, ViewRec} from 'app/client/models/DocModel';
import {ShareRec} from 'app/client/models/entities/ShareRec';
import * as ko from 'knockout';

// Represents a page entry in the tree of pages.
export interface PageRec extends IRowModel<"_grist_Pages"> {
  view: ko.Computed<ViewRec>;
  isHidden: ko.Computed<boolean>;
  isCensored: ko.Computed<boolean>;
  isSpecial: ko.Computed<boolean>;
  share: ko.Computed<ShareRec>;
}

export function createPageRec(this: PageRec, docModel: DocModel): void {
  this.view = refRecord(docModel.views, this.viewRef);
  // Page is hidden when any of this is true:
  // - It has an empty name (or no name at all)
  // - It is GristDocTour (unless user wants to see it)
  // - It is GristDocTutorial (unless user should see it)
  // - It is a page generated for a hidden table TODO: Follow up - don't create
  //   pages for hidden tables.
  // This is used currently only the left panel, to hide pages from the user.
  this.isCensored = ko.pureComputed(() => !this.view().name());
  this.isSpecial = ko.pureComputed(() => {
    const name = this.view().name();
    const isTableHidden = () => {
      const viewId = this.view().id();
      const tables = docModel.rawDataTables.all();
      const primaryTable = tables.find(t => t.primaryViewId() === viewId);
      return !!primaryTable && primaryTable.tableId()?.startsWith("GristHidden_");
    };
    return (
      (name === 'GristDocTour' && !docModel.showDocTourTable) ||
      (name === 'GristDocTutorial' && !docModel.showDocTutorialTable) ||
      isTableHidden()
    );
  });
  this.isHidden = ko.pureComputed(() => {
    return this.isCensored() || this.isSpecial();
  });
  this.share = refRecord(docModel.shares, this.shareRef);
}
