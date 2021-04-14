import * as BaseView from 'app/client/components/BaseView';
import {CursorPos} from 'app/client/components/Cursor';
import {KoArray} from 'app/client/lib/koArray';
import {ColumnRec, TableRec, ViewFieldRec, ViewRec} from 'app/client/models/DocModel';
import {DocModel, IRowModel, recordSet, refRecord} from 'app/client/models/DocModel';
import * as modelUtil from 'app/client/models/modelUtil';
import {RowId} from 'app/client/models/rowset';
import {getWidgetTypes} from 'app/client/ui/widgetTypes';
import {Computed} from 'grainjs';
import * as ko from 'knockout';
import defaults = require('lodash/defaults');

// Represents a section of user views, now also known as a "page widget" (e.g. a view may contain
// a grid section and a chart section).
export interface ViewSectionRec extends IRowModel<"_grist_Views_section"> {
  viewFields: ko.Computed<KoArray<ViewFieldRec>>;

  optionsObj: modelUtil.SaveableObjObservable<any>;

  customDef: CustomViewSectionDef;

  themeDef: modelUtil.KoSaveableObservable<string>;
  chartTypeDef: modelUtil.KoSaveableObservable<string>;
  view: ko.Computed<ViewRec>;

  table: ko.Computed<TableRec>;

  tableTitle: ko.Computed<string>;
  titleDef: modelUtil.KoSaveableObservable<string>;

  borderWidthPx: ko.Computed<string>;

  layoutSpecObj: modelUtil.ObjObservable<any>;

  // Helper metadata item which indicates whether any of the section's fields have unsaved
  // changes to their filters. (True indicates unsaved changes)
  filterSpecChanged: Computed<boolean>;

  // Array of fields with an active filter
  filteredFields: Computed<ViewFieldRec[]>;

  // Customizable version of the JSON-stringified sort spec. It may diverge from the saved one.
  activeSortJson: modelUtil.CustomComputed<string>;

  // is an array (parsed from JSON) of colRefs (i.e. rowIds into the columns table), with a
  // twist: a rowId may be positive or negative, for ascending or descending respectively.
  activeSortSpec: modelUtil.ObjObservable<number[]>;

  // Modified sort spec to take into account any active display columns.
  activeDisplaySortSpec: ko.Computed<number[]>;

  // Evaluates to an array of column models, which are not referenced by anything in viewFields.
  hiddenColumns: ko.Computed<ColumnRec[]>;

  hasFocus: ko.Computed<boolean>;

  activeLinkSrcSectionRef: modelUtil.CustomComputed<number>;
  activeLinkSrcColRef: modelUtil.CustomComputed<number>;
  activeLinkTargetColRef: modelUtil.CustomComputed<number>;

  // Whether current linking state is as saved. It may be different during editing.
  isActiveLinkSaved: ko.Computed<boolean>;

  // Section-linking affects table if linkSrcSection is set. The controller value of the
  // link is the value of srcCol at activeRowId of linkSrcSection, or activeRowId itself when
  // srcCol is unset. If targetCol is set, we filter for all rows whose targetCol is equal to
  // the controller value. Otherwise, the controller value determines the rowId of the cursor.
  linkSrcSection: ko.Computed<ViewSectionRec>;
  linkSrcCol: ko.Computed<ColumnRec>;
  linkTargetCol: ko.Computed<ColumnRec>;

  activeRowId: ko.Observable<RowId|null>;     // May be null when there are no rows.

  // If the view instance for section is instantiated, it will be accessible here.
  viewInstance: ko.Observable<BaseView|null>;

  // Describes the most recent cursor position in the section. Only rowId and fieldIndex are used.
  lastCursorPos: CursorPos;

  // Describes the most recent scroll position.
  lastScrollPos: {
    rowIndex: number;   // Used for scrolly sections. Indicates the index of the first visible row.
    offset: number;     // Pixel distance past the top of row indicated by rowIndex.
    scrollLeft: number; // Used for grid sections. Indicates the scrollLeft value of the scroll pane.
  };

  disableAddRemoveRows: ko.Computed<boolean>;

  isSorted: ko.Computed<boolean>;
  disableDragRows: ko.Computed<boolean>;
  activeFilterBar: modelUtil.CustomComputed<boolean>;

  // Save all filters of fields in the section.
  saveFilters(): Promise<void>;

  // Revert all filters of fields in the section.
  revertFilters(): void;

  // Clear and save all filters of fields in the section.
  clearFilters(): void;
}

export interface CustomViewSectionDef {
  /**
   * The mode.
   */
  mode: ko.Observable<"url"|"plugin">;
  /**
   * The url.
   */
  url: ko.Observable<string>;
  /**
   * Access granted to url.
   */
  access: ko.Observable<string>;
  /**
   * The plugin id.
   */
  pluginId: ko.Observable<string>;
  /**
   * The section id.
   */
  sectionId: ko.Observable<string>;
}


export function createViewSectionRec(this: ViewSectionRec, docModel: DocModel): void {
  this.viewFields = recordSet(this, docModel.viewFields, 'parentId', {sortBy: 'parentPos'});

  const defaultOptions = {
    verticalGridlines: true,
    horizontalGridlines: true,
    zebraStripes: false,
    customView: '',
    filterBar: false,
  };
  this.optionsObj = modelUtil.jsonObservable(this.options,
    (obj: any) => defaults(obj || {}, defaultOptions));

  const customViewDefaults = {
    mode: 'url',
    url: '',
    access: '',
    pluginId: '',
    sectionId: ''
  };
  const customDefObj = modelUtil.jsonObservable(this.optionsObj.prop('customView'),
    (obj: any) => defaults(obj || {}, customViewDefaults));

  this.customDef = {
    mode: customDefObj.prop('mode'),
    url: customDefObj.prop('url'),
    access: customDefObj.prop('access'),
    pluginId: customDefObj.prop('pluginId'),
    sectionId: customDefObj.prop('sectionId')
  };

  this.themeDef = modelUtil.fieldWithDefault(this.theme, 'form');
  this.chartTypeDef = modelUtil.fieldWithDefault(this.chartType, 'bar');
  this.view = refRecord(docModel.views, this.parentId);

  this.table = refRecord(docModel.tables, this.tableRef);

  this.tableTitle = this.autoDispose(ko.pureComputed(() => this.table().tableTitle()));
  this.titleDef = modelUtil.fieldWithDefault(
    this.title,
    () => this.table().tableTitle() + (
      (this.parentKey() === 'record') ? '' : ` ${getWidgetTypes(this.parentKey.peek() as any).label}`
    )
  );

  this.borderWidthPx = ko.pureComputed(function() { return this.borderWidth() + 'px'; }, this);

  this.layoutSpecObj = modelUtil.jsonObservable(this.layoutSpec);

  // Helper metadata item which indicates whether any of the section's fields have unsaved
  // changes to their filters. (True indicates unsaved changes)
  this.filterSpecChanged = Computed.create(this, use =>
    use(use(this.viewFields).getObservable()).some(field => !use(field.activeFilter.isSaved)));

  this.filteredFields = Computed.create(this, use =>
    use(use(this.viewFields).getObservable()).filter(field => use(field.isFiltered)));

  // Save all filters of fields in the section.
  this.saveFilters = () => {
    return docModel.docData.bundleActions(`Save all filters in ${this.titleDef()}`,
      async () => { await Promise.all(this.viewFields().all().map(field => field.activeFilter.save())); }
    );
  };

  // Revert all filters of fields in the section.
  this.revertFilters = () => {
    this.viewFields().all().forEach(field => { field.activeFilter.revert(); });
  };

  // Reset all filters of fields in the section to their default (i.e. unset) values.
  this.clearFilters = () => this.viewFields().all().forEach(field => field.activeFilter(''));

  // Customizable version of the JSON-stringified sort spec. It may diverge from the saved one.
  this.activeSortJson = modelUtil.customValue(this.sortColRefs);

  // This is an array (parsed from JSON) of colRefs (i.e. rowIds into the columns table), with a
  // twist: a rowId may be positive or negative, for ascending or descending respectively.
  // TODO: This method of ignoring columns which are deleted is inefficient and may cause conflicts
  //  with sharing.
  this.activeSortSpec = modelUtil.jsonObservable(this.activeSortJson, (obj: any) => {
    return (obj || []).filter((sortRef: number) => {
      const colModel = docModel.columns.getRowModel(Math.abs(sortRef));
      return !colModel._isDeleted() && colModel.getRowId();
    });
  });

  // Modified sort spec to take into account any active display columns.
  this.activeDisplaySortSpec = this.autoDispose(ko.computed(() => {
    return this.activeSortSpec().map(directionalColRef => {
      const colRef = Math.abs(directionalColRef);
      const field = this.viewFields().all().find(f => f.column().origColRef() === colRef);
      const effectiveColRef = field ? field.displayColRef() : colRef;
      return directionalColRef > 0 ? effectiveColRef : -effectiveColRef;
    });
  }));

  // Evaluates to an array of column models, which are not referenced by anything in viewFields.
  this.hiddenColumns = this.autoDispose(ko.pureComputed(() => {
    const included = new Set(this.viewFields().all().map((f) => f.column().origColRef()));
    return this.table().columns().all().filter(function(col) {
      return !included.has(col.getRowId()) && !col.isHiddenCol();
    });
  }));

  this.hasFocus = ko.pureComputed({
    // Read may occur for recently disposed sections, must check condition first.
    read: () => !this.isDisposed() && this.view().activeSectionId() === this.id() && !this.view().isLinking(),
    write: (val) => { if (val) { this.view().activeSectionId(this.id()); } }
  });

  this.activeLinkSrcSectionRef = modelUtil.customValue(this.linkSrcSectionRef);
  this.activeLinkSrcColRef = modelUtil.customValue(this.linkSrcColRef);
  this.activeLinkTargetColRef = modelUtil.customValue(this.linkTargetColRef);

  // Whether current linking state is as saved. It may be different during editing.
  this.isActiveLinkSaved = this.autoDispose(ko.pureComputed(() =>
    this.activeLinkSrcSectionRef.isSaved() &&
    this.activeLinkSrcColRef.isSaved() &&
    this.activeLinkTargetColRef.isSaved()));

  // Section-linking affects this table if linkSrcSection is set. The controller value of the
  // link is the value of srcCol at activeRowId of linkSrcSection, or activeRowId itself when
  // srcCol is unset. If targetCol is set, we filter for all rows whose targetCol is equal to
  // the controller value. Otherwise, the controller value determines the rowId of the cursor.
  this.linkSrcSection = refRecord(docModel.viewSections, this.activeLinkSrcSectionRef);
  this.linkSrcCol = refRecord(docModel.columns, this.activeLinkSrcColRef);
  this.linkTargetCol = refRecord(docModel.columns, this.activeLinkTargetColRef);

  this.activeRowId = ko.observable();

  // If the view instance for this section is instantiated, it will be accessible here.
  this.viewInstance = ko.observable(null);

  // Describes the most recent cursor position in the section.
  this.lastCursorPos = {
    rowId:      0,
    fieldIndex: 0
  };

  // Describes the most recent scroll position.
  this.lastScrollPos = {
    rowIndex:   0, // Used for scrolly sections. Indicates the index of the first visible row.
    offset:     0, // Pixel distance past the top of row indicated by rowIndex.
    scrollLeft: 0  // Used for grid sections. Indicates the scrollLeft value of the scroll pane.
  };

  this.disableAddRemoveRows = ko.pureComputed(() => this.table().disableAddRemoveRows());

  this.isSorted = ko.pureComputed(() => this.activeSortSpec().length > 0);
  this.disableDragRows = ko.pureComputed(() => this.isSorted() || !this.table().supportsManualSort());

  this.activeFilterBar = modelUtil.customValue(this.optionsObj.prop('filterBar'));
}
