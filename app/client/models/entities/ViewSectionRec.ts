import * as BaseView from 'app/client/components/BaseView';
import { ColumnRec, FilterRec, TableRec, ViewFieldRec, ViewRec } from 'app/client/models/DocModel';
import * as modelUtil from 'app/client/models/modelUtil';
import {AccessLevel, ICustomWidget} from 'app/common/CustomWidget';
import * as ko from 'knockout';
import { CursorPos, } from 'app/client/components/Cursor';
import { KoArray, } from 'app/client/lib/koArray';
import { DocModel, IRowModel, recordSet, refRecord, } from 'app/client/models/DocModel';
import { RowId, } from 'app/client/models/rowset';
import { getWidgetTypes, } from 'app/client/ui/widgetTypes';
import { arrayRepeat, } from 'app/common/gutil';
import { Sort, } from 'app/common/SortSpec';
import { Computed, } from 'grainjs';
import defaults = require('lodash/defaults');

// Represents a section of user views, now also known as a "page widget" (e.g. a view may contain
// a grid section and a chart section).
export interface ViewSectionRec extends IRowModel<"_grist_Views_section"> {
  viewFields: ko.Computed<KoArray<ViewFieldRec>>;

  // All table columns associated with this view section, excluding hidden helper columns.
  columns: ko.Computed<ColumnRec[]>;

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

  _savedFilters: ko.Computed<KoArray<FilterRec>>;

  /**
   * Unsaved client-side filters, keyed by original col ref. Currently only wiped when unsaved filters
   * are applied or reverted.
   *
   * If saved filters exist for a col ref, unsaved filters take priority and are applied instead. This
   * prevents disruption when changes are made to saved filters for the same field/column, but there
   * may be some cases where we'd want to reset _unsavedFilters on some indirect change to the document.
   *
   * NOTE: See `filters`, where `_unsavedFilters` is merged with `savedFilters`.
   */
  _unsavedFilters: Map<number, string>;

  /**
   * Filter information for all fields/section in the section.
   *
   * Re-computed on changes to `savedFilters`, as well as any changes to `viewFields` or `columns`. Any
   * unsaved filters saved in `_unsavedFilters` are applied on computation, taking priority over saved
   * filters for the same field/column, if any exist.
   */
  filters: ko.Computed<FilterInfo[]>;

  // Subset of `filters` containing non-blank active filters.
  activeFilters: Computed<FilterInfo[]>;

  // Helper metadata item which indicates whether any of the section's fields/columns have unsaved
  // changes to their filters. (True indicates unsaved changes)
  filterSpecChanged: Computed<boolean>;

  // Customizable version of the JSON-stringified sort spec. It may diverge from the saved one.
  activeSortJson: modelUtil.CustomComputed<string>;

  // is an array (parsed from JSON) of colRefs (i.e. rowIds into the columns table), with a
  // twist: a rowId may be positive or negative, for ascending or descending respectively.
  activeSortSpec: modelUtil.ObjObservable<Sort.SortSpec>;

  // Modified sort spec to take into account any active display columns.
  activeDisplaySortSpec: ko.Computed<Sort.SortSpec>;

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
  // Number of frozen columns
  rawNumFrozen: modelUtil.CustomComputed<number>;
  // Number for frozen columns to display.
  // We won't freeze all the columns on a grid, it will leave at least 1 column unfrozen.
  numFrozen: ko.Computed<number>;
  activeCustomOptions: modelUtil.CustomComputed<any>;
  // Temporary variable holding flag that describes if the widget supports custom options (set by api).
  hasCustomOptions: ko.Observable<boolean>;
  // Temporary variable holding widget desired access (changed either from manifest or via api).
  desiredAccessLevel: ko.Observable<AccessLevel|null>;

  // Save all filters of fields/columns in the section.
  saveFilters(): Promise<void>;

  // Revert all filters of fields/columns in the section.
  revertFilters(): void;

  // Apply `filter` to the field or column identified by `colRef`.
  setFilter(colRef: number, filter: string): void;

  // Saves custom definition (bundles change)
  saveCustomDef(): Promise<void>;
}

export interface CustomViewSectionDef {
  /**
   * The mode.
   */
  mode: modelUtil.KoSaveableObservable<"url"|"plugin">;
  /**
   * The url.
   */
  url: modelUtil.KoSaveableObservable<string|null>;
   /**
   * Custom widget information.
   */
  widgetDef: modelUtil.KoSaveableObservable<ICustomWidget|null>;
   /**
   * Custom widget options.
   */
  widgetOptions: modelUtil.KoSaveableObservable<Record<string, any>|null>;
  /**
   * Access granted to url.
   */
  access: modelUtil.KoSaveableObservable<string>;
  /**
   * The plugin id.
   */
  pluginId: modelUtil.KoSaveableObservable<string>;
  /**
   * The section id.
   */
  sectionId: modelUtil.KoSaveableObservable<string>;
}

// Information about filters for a field or hidden column.
export interface FilterInfo {
  // The field or column associated with this filter info.
  fieldOrColumn: ViewFieldRec|ColumnRec;
  // Filter that applies to this field/column, if any.
  filter: modelUtil.CustomComputed<string>;
  // True if `filter` has a non-blank value.
  isFiltered: ko.PureComputed<boolean>;
}

export function createViewSectionRec(this: ViewSectionRec, docModel: DocModel): void {
  this.viewFields = recordSet(this, docModel.viewFields, 'parentId', {sortBy: 'parentPos'});

  // All table columns associated with this view section, excluding any hidden helper columns.
  this.columns = this.autoDispose(ko.pureComputed(() => this.table().columns().all().filter(c => !c.isHiddenCol())));

  const defaultOptions = {
    verticalGridlines: true,
    horizontalGridlines: true,
    zebraStripes: false,
    customView: '',
    filterBar: false,
    numFrozen: 0
  };
  this.optionsObj = modelUtil.jsonObservable(this.options,
    (obj: any) => defaults(obj || {}, defaultOptions));

  const customViewDefaults = {
    mode: 'url',
    url: null,
    widgetDef: null,
    access: '',
    pluginId: '',
    sectionId: ''
  };
  const customDefObj = modelUtil.jsonObservable(this.optionsObj.prop('customView'),
    (obj: any) => defaults(obj || {}, customViewDefaults));

  this.customDef = {
    mode: customDefObj.prop('mode'),
    url: customDefObj.prop('url'),
    widgetDef: customDefObj.prop('widgetDef'),
    widgetOptions: customDefObj.prop('widgetOptions'),
    access: customDefObj.prop('access'),
    pluginId: customDefObj.prop('pluginId'),
    sectionId: customDefObj.prop('sectionId')
  };

  this.activeCustomOptions = modelUtil.customValue(this.customDef.widgetOptions);

  this.saveCustomDef = async () => {
    await customDefObj.save();
    this.activeCustomOptions.revert();
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

  this._savedFilters = recordSet(this, docModel.filters, 'viewSectionRef');

  /**
   * Unsaved client-side filters, keyed by original col ref. Currently only wiped when unsaved filters
   * are applied or reverted.
   *
   * If saved filters exist for a col ref, unsaved filters take priority and are applied instead. This
   * prevents disruption when changes are made to saved filters for the same field/column, but there
   * may be some cases where we'd want to reset _unsavedFilters on some indirect change to the document.
   *
   * NOTE: See `filters`, where `_unsavedFilters` is merged with `savedFilters`.
   */
  this._unsavedFilters = new Map();

  /**
   * Filter information for all fields/section in the section.
   *
   * Re-computed on changes to `savedFilters`, as well as any changes to `viewFields` or `columns`. Any
   * unsaved filters saved in `_unsavedFilters` are applied on computation, taking priority over saved
   * filters for the same field/column, if any exist.
   */
  this.filters = this.autoDispose(ko.computed(() => {
    const savedFiltersByColRef = new Map(this._savedFilters().all().map(f => [f.colRef(), f]));
    const viewFieldsByColRef = new Map(this.viewFields().all().map(f => [f.colRef(), f]));

    return this.columns().map(column => {
      const savedFilter = savedFiltersByColRef.get(column.origColRef());
      const filter = modelUtil.customComputed({
        // Initialize with a saved filter, if one exists. Otherwise, use a blank filter.
        read: () => { return savedFilter ? savedFilter.activeFilter() : ''; },
      });

      // If an unsaved filter exists, overwrite `filter` with it.
      const unsavedFilter = this._unsavedFilters.get(column.origColRef());
      if (unsavedFilter !== undefined) { filter(unsavedFilter); }

      return {
        filter,
        fieldOrColumn: viewFieldsByColRef.get(column.origColRef()) ?? column,
        isFiltered: ko.pureComputed(() => filter() !== '')
      };
    });
  }));

  // List of `filters` that have non-blank active filters.
  this.activeFilters = Computed.create(this, use => use(this.filters).filter(col => use(col.isFiltered)));

  // Helper metadata item which indicates whether any of the section's fields/columns have unsaved
  // changes to their filters. (True indicates unsaved changes)
  this.filterSpecChanged = Computed.create(this, use => {
    return use(this.filters).some(col => !use(col.filter.isSaved));
  });

  // Save all filters of fields/columns in the section.
  this.saveFilters = () => {
    return docModel.docData.bundleActions(`Save all filters in ${this.titleDef()}`,
      async () => {
        const savedFiltersByColRef = new Map(this._savedFilters().all().map(f => [f.colRef(), f]));
        const updatedFilters: [number, string][] = []; // Pairs of row ids and filters to update.
        const removedFilterIds: number[] = []; // Row ids of filters to remove.
        const newFilters: [number, string][] = []; // Pairs of column refs and filters to add.

        for (const c of this.filters()) {
          // Skip saved filters (i.e. filters whose local values are unchanged from server).
          if (c.filter.isSaved()) { continue; }

          const savedFilter = savedFiltersByColRef.get(c.fieldOrColumn.origCol().origColRef());
          if (!savedFilter) {
            // Since no saved filter exists, we must add a new record to the filters table.
            newFilters.push([c.fieldOrColumn.origCol().origColRef(), c.filter()]);
          } else if (c.filter() === '') {
            // Mark the saved filter for removal from the filters table.
            removedFilterIds.push(savedFilter.id());
          } else {
            // Mark the saved filter for update in the filters table.
            updatedFilters.push([savedFilter.id(), c.filter()]);
          }
        }

        // Remove records of any deleted filters.
        if (removedFilterIds.length > 0) {
          await docModel.filters.sendTableAction(['BulkRemoveRecord', removedFilterIds]);
        }

        // Update existing filter records with new filter values.
        if (updatedFilters.length > 0) {
          await docModel.filters.sendTableAction(['BulkUpdateRecord',
            updatedFilters.map(([id]) => id),
            {filter: updatedFilters.map(([, filter]) => filter)}
          ]);
        }

        // Add new filter records.
        if (newFilters.length > 0) {
          await docModel.filters.sendTableAction(['BulkAddRecord',
            arrayRepeat(newFilters.length, null),
            {
              viewSectionRef: arrayRepeat(newFilters.length, this.id()),
              colRef: newFilters.map(([colRef]) => colRef),
              filter: newFilters.map(([, filter]) => filter),
            }
          ]);
        }

        // Reset client filter state.
        this.revertFilters();
      }
    );
  };

  // Revert all filters of fields/columns in the section.
  this.revertFilters = () => {
    this._unsavedFilters = new Map();
    this.filters().forEach(c => { c.filter.revert(); });
  };

  // Apply `filter` to the field or column identified by `colRef`.
  this.setFilter = (colRef: number, filter: string) => {
    this._unsavedFilters.set(colRef, filter);
    const filterInfo = this.filters().find(c => c.fieldOrColumn.origCol().origColRef() === colRef);
    filterInfo?.filter(filter);
  };

  // Customizable version of the JSON-stringified sort spec. It may diverge from the saved one.
  this.activeSortJson = modelUtil.customValue(this.sortColRefs);

  // This is an array (parsed from JSON) of colRefs (i.e. rowIds into the columns table), with a
  // twist: a rowId may be positive or negative, for ascending or descending respectively.
  // TODO: This method of ignoring columns which are deleted is inefficient and may cause conflicts
  //  with sharing.
  this.activeSortSpec = modelUtil.jsonObservable(this.activeSortJson, (obj: Sort.SortSpec|null) => {
    return (obj || []).filter((sortRef: Sort.ColSpec) => {
      const colModel = docModel.columns.getRowModel(Sort.getColRef(sortRef));
      return !colModel._isDeleted() && colModel.getRowId();
    });
  });

  // Modified sort spec to take into account any active display columns.
  this.activeDisplaySortSpec = this.autoDispose(ko.computed(() => {
    return this.activeSortSpec().map(directionalColRef => {
      const colRef = Sort.getColRef(directionalColRef);
      const field = this.viewFields().all().find(f => f.column().origColRef() === colRef);
      const effectiveColRef = field ? field.displayColRef() : colRef;
      return Sort.swapColRef(directionalColRef, effectiveColRef);
    });
  }));

  // Evaluates to an array of column models, which are not referenced by anything in viewFields.
  this.hiddenColumns = this.autoDispose(ko.pureComputed(() => {
    const included = new Set(this.viewFields().all().map((f) => f.column().origColRef()));
    return this.columns().filter(c => !included.has(c.getRowId()));
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

  this.activeRowId = ko.observable(null);

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

  // Number of frozen columns
  this.rawNumFrozen = modelUtil.customValue(this.optionsObj.prop('numFrozen'));
  // Number for frozen columns to display
  this.numFrozen = ko.pureComputed(() =>
    Math.max(
      0,
      Math.min(
        this.rawNumFrozen(),
        this.viewFields().all().length - 1
      )
    )
  );

  this.hasCustomOptions = ko.observable(false);
  this.desiredAccessLevel = ko.observable(null);
}
