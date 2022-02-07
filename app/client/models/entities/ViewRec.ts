import {KoArray} from 'app/client/lib/koArray';
import * as koUtil from 'app/client/lib/koUtil';
import {DocModel, IRowModel, recordSet, refRecord} from 'app/client/models/DocModel';
import {TabBarRec, ViewSectionRec} from 'app/client/models/DocModel';
import * as modelUtil from 'app/client/models/modelUtil';
import * as ko from 'knockout';

// Represents a view (now also referred to as a "page") containing one or more view sections.
export interface ViewRec extends IRowModel<"_grist_Views"> {
  viewSections: ko.Computed<KoArray<ViewSectionRec>>;
  tabBarItem: ko.Computed<KoArray<TabBarRec>>;

  layoutSpecObj: modelUtil.ObjObservable<any>;

  // An observable for the ref of the section last selected by the user.
  activeSectionId: ko.Computed<number>;

  activeSection: ko.Computed<ViewSectionRec>;

  // If the active section is removed, set the next active section to be the default.
  _isActiveSectionGone: ko.Computed<boolean>;
}

export function createViewRec(this: ViewRec, docModel: DocModel): void {
  this.viewSections = recordSet(this, docModel.viewSections, 'parentId');
  this.tabBarItem = recordSet(this, docModel.tabBar, 'viewRef');

  this.layoutSpecObj = modelUtil.jsonObservable(this.layoutSpec);

  // An observable for the ref of the section last selected by the user.
  this.activeSectionId = koUtil.observableWithDefault(ko.observable(), () => {
    // The default function which is used when the conditional case is true.
    // Read may occur for recently disposed sections, must check condition first.
    return !this.isDisposed() &&
      // `!this.getRowId()` implies that this is an empty (non-existent) view record
      // which happens when viewing the raw data tables, in which case the default is no active view section.
      this.getRowId() && this.viewSections().all().length > 0 ? this.viewSections().at(0)!.getRowId() : 0;
  });

  this.activeSection = refRecord(docModel.viewSections, this.activeSectionId);

  // If the active section is removed, set the next active section to be the default.
  this._isActiveSectionGone = this.autoDispose(ko.computed(() => this.activeSection()._isDeleted()));
  this.autoDispose(this._isActiveSectionGone.subscribe(gone => {
    if (gone) {
      this.activeSectionId(0);
    }
  }));
}
