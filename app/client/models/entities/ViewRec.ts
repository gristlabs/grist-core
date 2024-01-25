import {BoxSpec} from 'app/client/components/Layout';
import {KoArray} from 'app/client/lib/koArray';
import * as koUtil from 'app/client/lib/koUtil';
import {DocModel, IRowModel, PageRec, recordSet, refRecord} from 'app/client/models/DocModel';
import {TabBarRec, ViewSectionRec} from 'app/client/models/DocModel';
import * as modelUtil from 'app/client/models/modelUtil';
import * as ko from 'knockout';

// Represents a view (now also referred to as a "page") containing one or more view sections.
export interface ViewRec extends IRowModel<"_grist_Views"> {
  viewSections: ko.Computed<KoArray<ViewSectionRec>>;
  tabBarItem: ko.Computed<KoArray<TabBarRec>>;

  layoutSpecObj: modelUtil.SaveableObjObservable<BoxSpec>;

  // An observable for the ref of the section last selected by the user.
  activeSectionId: ko.Computed<number>;

  // This is active collapsed section id. Set when the widget is clicked.
  activeCollapsedSectionId: ko.Observable<number>;

  // Saved collapsed sections.
  collapsedSections: ko.Computed<number[]>;

  // Active collapsed sections, changed by the user, can be different from the
  // saved collapsed sections, for a brief moment (editor is buffering changes).
  activeCollapsedSections: ko.Observable<number[]>;

  activeSection: ko.Computed<ViewSectionRec>;

  // If the active section is removed, set the next active section to be the default.
  _isActiveSectionGone: ko.Computed<boolean>;

  page: ko.Computed<PageRec|null>;
}

export function createViewRec(this: ViewRec, docModel: DocModel): void {
  this.viewSections = recordSet(this, docModel.viewSections, 'parentId');
  this.tabBarItem = recordSet(this, docModel.tabBar, 'viewRef');

  this.layoutSpecObj = modelUtil.jsonObservable(this.layoutSpec);

  this.activeCollapsedSectionId = ko.observable(0);

  this.collapsedSections = this.autoDispose(ko.pureComputed(() => {
    const allSections = new Set(this.viewSections().all().map(x => x.id()));
    const collapsed: number[] = (this.layoutSpecObj().collapsed || []).map(x => x.leaf as number);
    return collapsed.filter(x => allSections.has(x));
  }));
  this.activeCollapsedSections = ko.observable(this.collapsedSections.peek());

  // An observable for the ref of the section last selected by the user.
  this.activeSectionId = koUtil.observableWithDefault(ko.observable(), () => {
    // The default function which is used when the conditional case is true.
    // Read may occur for recently disposed sections, must check condition first.
    // `!this.getRowId()` implies that this is an empty (non-existent) view record
    // which happens when viewing the raw data tables, in which case the default is no active view section.

    if (this.isDisposed() || !this.getRowId()) { return 0; }
    const all = this.viewSections().all();
    const collapsed = new Set(this.activeCollapsedSections());
    const visible = all.filter(x => !collapsed.has(x.id()));

    // Default to the first leaf from layoutSpec (which corresponds to the top-left section), or
    // fall back to the first item in the list if anything goes wrong (previous behavior).
    const firstLeaf = getFirstLeaf(this.layoutSpecObj.peek());
    const result = visible.find(s => s.id() === firstLeaf) ? firstLeaf as number :
      (visible[0]?.id() || 0);
    return result;
  });

  this.activeSection = refRecord(docModel.viewSections, this.activeSectionId);

  // If the active section is removed, set the next active section to be the default.
  this._isActiveSectionGone = this.autoDispose(ko.computed(() => this.activeSection()._isDeleted()));
  this.autoDispose(this._isActiveSectionGone.subscribe(gone => {
    if (gone) {
      this.activeSectionId(0);
    }
  }));

  this.page = this.autoDispose(ko.pureComputed(() => {
    const viewRef = this.id();
    return docModel.allPages().find(p => p.viewRef() === viewRef) ?? null;
  }));
}

function getFirstLeaf(layoutSpec: BoxSpec|undefined): BoxSpec['leaf'] {
  while (layoutSpec?.children?.length) {
    layoutSpec = layoutSpec.children[0];
  }
  return layoutSpec?.leaf;
}
