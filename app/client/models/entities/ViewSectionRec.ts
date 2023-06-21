import BaseView from 'app/client/components/BaseView';
import {CursorPos} from 'app/client/components/Cursor';
import {FilterColValues, LinkingState} from 'app/client/components/LinkingState';
import {KoArray} from 'app/client/lib/koArray';
import {
  ColumnRec,
  DocModel,
  FilterRec,
  IRowModel,
  recordSet,
  refListRecords,
  refRecord,
  TableRec,
  ViewFieldRec,
  ViewRec
} from 'app/client/models/DocModel';
import * as modelUtil from 'app/client/models/modelUtil';
import {RowId} from 'app/client/models/rowset';
import {LinkConfig} from 'app/client/ui/selectBy';
import {getWidgetTypes} from 'app/client/ui/widgetTypes';
import {AccessLevel, ICustomWidget} from 'app/common/CustomWidget';
import {UserAction} from 'app/common/DocActions';
import {arrayRepeat} from 'app/common/gutil';
import {Sort} from 'app/common/SortSpec';
import {ColumnsToMap, WidgetColumnMap} from 'app/plugin/CustomSectionAPI';
import {ColumnToMapImpl} from 'app/client/models/ColumnToMap';
import {BEHAVIOR} from 'app/client/models/entities/ColumnRec';
import {removeRule, RuleOwner} from 'app/client/models/RuleOwner';
import {Computed, Holder, Observable} from 'grainjs';
import * as ko from 'knockout';
import defaults = require('lodash/defaults');

// Represents a section of user views, now also known as a "page widget" (e.g. a view may contain
// a grid section and a chart section).
export interface ViewSectionRec extends IRowModel<"_grist_Views_section">, RuleOwner {
  viewFields: ko.Computed<KoArray<ViewFieldRec>>;

  // List of sections linked from this one, i.e. for whom this one is the selector or link source.
  linkedSections: ko.Computed<KoArray<ViewSectionRec>>;

  // All table columns associated with this view section, excluding hidden helper columns.
  columns: ko.Computed<ColumnRec[]>;

  optionsObj: modelUtil.SaveableObjObservable<any>;

  customDef: CustomViewSectionDef;

  themeDef: modelUtil.KoSaveableObservable<string>;
  chartTypeDef: modelUtil.KoSaveableObservable<string>;
  view: ko.Computed<ViewRec>;

  table: ko.Computed<TableRec>;

  // Widget title with a default value
  titleDef: modelUtil.KoSaveableObservable<string>;
  // Default widget title (the one that is used in titleDef).
  defaultWidgetTitle: ko.PureComputed<string>;

  description: modelUtil.KoSaveableObservable<string>;

  // true if this record is its table's rawViewSection, i.e. a 'raw data view'
  // in which case the UI prevents various things like hiding columns or changing the widget type.
  isRaw: ko.Computed<boolean>;
  isVirtual: ko.Computed<boolean>;
  isCollapsed: ko.Computed<boolean>;

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
  _unsavedFilters: Map<number, Partial<Filter>>;

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

  // Subset of `activeFilters` that are pinned.
  pinnedActiveFilters: Computed<FilterInfo[]>;

  // Helper metadata item which indicates whether any of the section's fields/columns have unsaved
  // changes to their filters. (True indicates unsaved changes)
  filterSpecChanged: Computed<boolean>;

  // Set to true when a second pinned filter is added, to trigger a behavioral prompt. Note that
  // the popup is only shown once, even if this observable is set to true again in the future.
  showNestedFilteringPopup: Observable<boolean>;

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

  // Linking state maintains .filterFunc and .cursorPos observables which we use for
  // auto-scrolling and filtering.
  linkingState: ko.Computed<LinkingState | null>;
  _linkingState: Holder<LinkingState>; // Holder for the current value of linkingState

  linkingFilter: ko.Computed<FilterColValues>;

  activeRowId: ko.Observable<RowId | null>;     // May be null when there are no rows.

  // If the view instance for section is instantiated, it will be accessible here.
  viewInstance: ko.Observable<BaseView | null>;

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
  // Number of frozen columns
  rawNumFrozen: modelUtil.CustomComputed<number>;
  // Number for frozen columns to display.
  // We won't freeze all the columns on a grid, it will leave at least 1 column unfrozen.
  numFrozen: ko.Computed<number>;
  activeCustomOptions: modelUtil.CustomComputed<any>;

  // Temporary fields used to communicate with the Custom Widget. There are set through the Widget API.

  // Temporary variable holding columns mapping requested by the widget (set by API).
  columnsToMap: ko.Observable<ColumnsToMap|null>;
  // Temporary variable holding columns mapped by the user;
  mappedColumns: ko.Computed<WidgetColumnMap|null>;
  // Temporary variable holding flag that describes if the widget supports custom options (set by API).
  hasCustomOptions: ko.Observable<boolean>;
  // Temporary variable holding widget desired access (changed either from manifest or via API).
  desiredAccessLevel: ko.Observable<AccessLevel|null>;

  // Show widget as linking source. Used by custom widget.
  allowSelectBy: Observable<boolean>;

  // List of selected rows
  selectedRows: Observable<number[]>;

  editingFormula: ko.Computed<boolean>;

  // Selected fields (columns) for the section.
  selectedFields: ko.Observable<ViewFieldRec[]>;

  // Some computed observables for multi-select, used in the creator panel, by more than one widgets.

  // Common column behavior or mixed.
  columnsBehavior: ko.PureComputed<BEHAVIOR|'mixed'>;
  // If all selected columns are empty or formula column.
  columnsAllIsFormula: ko.PureComputed<boolean>;
  // Common type of selected columns or mixed.
  columnsType: ko.PureComputed<string|'mixed'>;

  // Save all filters of fields/columns in the section.
  saveFilters(): Promise<void>;

  // Revert all filters of fields/columns in the section.
  revertFilters(): void;

  // Set `filter` for the field or column identified by `colRef`.
  setFilter(colRef: number, filter: Partial<Filter>): void;

  // Revert the filter of the field or column identified by `colRef`.
  revertFilter(colRef: number): void;

  // Saves custom definition (bundles change)
  saveCustomDef(): Promise<void>;
}

export type WidgetMappedColumn = number|number[]|null;
export type WidgetColumnMapping = Record<string, WidgetMappedColumn>

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
   * Custom widget interaction options.
   */
  columnsMapping: modelUtil.KoSaveableObservable<WidgetColumnMapping|null>;
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

/** Information about filters for a field or hidden column. */
export interface FilterInfo {
  /** The section that's being filtered. */
  viewSection: ViewSectionRec;
  /** The field or column that's being filtered. (Field if column is visible.) */
  fieldOrColumn: ViewFieldRec|ColumnRec;
  /** Filter that applies to this field/column, if any. */
  filter: modelUtil.CustomComputed<string>;
  /** Whether this filter is pinned to the filter bar. */
  pinned: modelUtil.CustomComputed<boolean>;
  /** True if `filter` has a non-blank value. */
  isFiltered: ko.PureComputed<boolean>;
  /** True if `pinned` is true. */
  isPinned: ko.PureComputed<boolean>;
}

export interface Filter {
  filter: string;
  pinned: boolean;
}

export function createViewSectionRec(this: ViewSectionRec, docModel: DocModel): void {
  this.viewFields = recordSet(this, docModel.viewFields, 'parentId', {sortBy: 'parentPos'});
  this.linkedSections = recordSet(this, docModel.viewSections, 'linkSrcSectionRef');

  // All table columns associated with this view section, excluding any hidden helper columns.
  this.columns = this.autoDispose(ko.pureComputed(() => this.table().columns().all().filter(c => !c.isHiddenCol())));
  this.editingFormula = ko.pureComputed({
    read: () => docModel.editingFormula(),
    write: val => {
      docModel.editingFormula(val);
    }
  });
  const defaultOptions = {
    verticalGridlines: true,
    horizontalGridlines: true,
    zebraStripes: false,
    customView: '',
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
    columnsMapping: customDefObj.prop('columnsMapping'),
    access: customDefObj.prop('access'),
    pluginId: customDefObj.prop('pluginId'),
    sectionId: customDefObj.prop('sectionId')
  };

  this.selectedFields = ko.observable<any>([]);

  // During schema change, some columns/fields might be disposed beyond our control.
  const selectedColumns = this.autoDispose(ko.pureComputed(() => this.selectedFields()
    .filter(f => !f.isDisposed())
    .map(f => f.column())
    .filter(c => !c.isDisposed())));
  this.columnsBehavior = ko.pureComputed(() => {
    const list = new Set(selectedColumns().map(c => c.behavior()));
    return list.size === 1 ? list.values().next().value : 'mixed';
  });
  this.columnsType = ko.pureComputed(() => {
    const list = new Set(selectedColumns().map(c => c.type()));
    return list.size === 1 ? list.values().next().value : 'mixed';
  });
  this.columnsAllIsFormula = ko.pureComputed(() => {
    return selectedColumns().every(c => c.isFormula());
  });

  this.activeCustomOptions = modelUtil.customValue(this.customDef.widgetOptions);

  this.saveCustomDef = async () => {
    await customDefObj.save();
    this.activeCustomOptions.revert();
  };

  this.themeDef = modelUtil.fieldWithDefault(this.theme, 'form');
  this.chartTypeDef = modelUtil.fieldWithDefault(this.chartType, 'bar');
  this.view = refRecord(docModel.views, this.parentId);

  this.table = refRecord(docModel.tables, this.tableRef);


  // The user-friendly name of the table, which is the same as tableId for non-summary tables,
  // and is 'tableId[groupByCols...]' for summary tables.
  // Consist of 3 parts
  // - TableId (or primary table id for summary tables) capitalized
  // - Grouping description (table record contains this for summary tables)
  // - Widget type description (if not grid)
  // All concatenated separated by space.
  this.defaultWidgetTitle = this.autoDispose(ko.pureComputed(() => {
    const widgetTypeDesc = this.parentKey() !== 'record' ? `${getWidgetTypes(this.parentKey.peek() as any).label}` : '';
    const table = this.table();
    return [
      table.tableNameDef()?.toUpperCase(), // Due to ACL this can be null.
      table.groupDesc(),
      widgetTypeDesc
    ].filter(part => Boolean(part?.trim())).join(' ');
  }));
  // Widget title.
  this.titleDef = modelUtil.fieldWithDefault(this.title, this.defaultWidgetTitle);

  // Widget description
  this.description = modelUtil.fieldWithDefault(this.description, this.description());

  // true if this record is its table's rawViewSection, i.e. a 'raw data view'
  // in which case the UI prevents various things like hiding columns or changing the widget type.
  this.isRaw = this.autoDispose(ko.pureComputed(() => this.table().rawViewSectionRef() === this.getRowId()));

  this.isVirtual = this.autoDispose(ko.pureComputed(() => typeof this.id() === 'string'));

  this.borderWidthPx = ko.pureComputed(() => this.borderWidth() + 'px');

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
   * Filter information for all fields/columns in the section.
   *
   * Re-computed on changes to `savedFilters`, as well as any changes to `viewFields` or `columns`. Any
   * unsaved filters saved in `_unsavedFilters` are applied on computation, taking priority over saved
   * filters for the same field/column, if any exist.
   */
  this.filters = this.autoDispose(ko.computed(() => {
    const savedFiltersByColRef = new Map(this._savedFilters().all().map(f => [f.colRef(), f]));
    const viewFieldsByColRef = new Map(this.viewFields().all().map(f => [f.origCol().getRowId(), f]));

    return this.columns().map(column => {
      const savedFilter = savedFiltersByColRef.get(column.origColRef());
      // Initialize with a saved filter, if one exists. Otherwise, use a blank filter.
      const filter = modelUtil.customComputed({
        read: () => { return savedFilter ? savedFilter.activeFilter() : ''; },
      });
      const pinned = modelUtil.customComputed({
        read: () => { return savedFilter ? savedFilter.pinned() : false; },
      });

      // If an unsaved filter exists, overwrite the filter with it.
      const unsavedFilter = this._unsavedFilters.get(column.origColRef());
      if (unsavedFilter) {
        const {filter: f, pinned: p} = unsavedFilter;
        if (f !== undefined) { filter(f); }
        if (p !== undefined) { pinned(p); }
      }

      return {
        viewSection: this,
        filter,
        pinned,
        fieldOrColumn: viewFieldsByColRef.get(column.origColRef()) ?? column,
        isFiltered: ko.pureComputed(() => filter() !== ''),
        isPinned: ko.pureComputed(() => pinned()),
      };
    });
  }));

  // List of `filters` that have non-blank active filters.
  this.activeFilters = Computed.create(this, use => use(this.filters).filter(f => use(f.isFiltered)));

  // List of `activeFilters` that are pinned.
  this.pinnedActiveFilters = Computed.create(this, use => use(this.activeFilters).filter(f => use(f.isPinned)));

  // Helper metadata item which indicates whether any of the section's fields/columns have unsaved
  // changes to their filters. (True indicates unsaved changes)
  this.filterSpecChanged = Computed.create(this, use => {
    return use(this.filters).some(col => !use(col.filter.isSaved) || !use(col.pinned.isSaved));
  });

  this.showNestedFilteringPopup = Observable.create(this, false);

  // Save all filters of fields/columns in the section.
  this.saveFilters = () => {
    return docModel.docData.bundleActions(`Save all filters in ${this.titleDef()}`,
      async () => {
        const savedFiltersByColRef = new Map(this._savedFilters().all().map(f => [f.colRef(), f]));
        const updatedFilters: [number, Filter][] = []; // Pairs of row ids and filters to update.
        const removedFilterIds: number[] = []; // Row ids of filters to remove.
        const newFilters: [number, Filter][] = []; // Pairs of column refs and filters to add.

        for (const f of this.filters()) {
          const {fieldOrColumn, filter, pinned} = f;
          // Skip saved filters (i.e. filters whose local values are unchanged from server).
          if (filter.isSaved() && pinned.isSaved()) { continue; }

          const savedFilter = savedFiltersByColRef.get(fieldOrColumn.origCol().origColRef());
          if (!savedFilter) {
            // Never save blank filters. (This is primarily a sanity check.)
            if (filter() === '') { continue; }

            // Since no saved filter exists, we must add a new record to the filters table.
            newFilters.push([fieldOrColumn.origCol().origColRef(), {
              filter: filter(),
              pinned: pinned(),
            }]);
          } else if (filter() === '') {
            // Mark the saved filter for removal from the filters table.
            removedFilterIds.push(savedFilter.id());
          } else {
            // Mark the saved filter for update in the filters table.
            updatedFilters.push([savedFilter.id(), {
              filter: filter(),
              pinned: pinned(),
            }]);
          }
        }

        const actions: UserAction[] = [];

        // Remove records of any deleted filters.
        if (removedFilterIds.length > 0) {
          actions.push(['BulkRemoveRecord', removedFilterIds]);
        }

        // Update existing filter records with new filter values.
        if (updatedFilters.length > 0) {
          actions.push(['BulkUpdateRecord',
            updatedFilters.map(([id]) => id),
            {
              filter: updatedFilters.map(([, {filter}]) => filter),
              pinned: updatedFilters.map(([, {pinned}]) => pinned),
            }
          ]);
        }

        // Add new filter records.
        if (newFilters.length > 0) {
          actions.push(['BulkAddRecord',
            arrayRepeat(newFilters.length, null),
            {
              viewSectionRef: arrayRepeat(newFilters.length, this.id()),
              colRef: newFilters.map(([colRef]) => colRef),
              filter: newFilters.map(([, {filter}]) => filter),
              pinned: newFilters.map(([, {pinned}]) => pinned),
            }
          ]);
        }

        if (actions.length > 0) {
          await docModel.filters.sendTableActions(actions);
        }

        // Reset client filter state.
        this.revertFilters();
      }
    );
  };

  // Revert all filters of fields/columns in the section.
  this.revertFilters = () => {
    this._unsavedFilters.clear();
    this.filters().forEach(c => {
      c.filter.revert();
      c.pinned.revert();
    });
  };

  // Set `filter` for the field or column identified by `colRef`.
  this.setFilter = (colRef: number, filter: Partial<Filter>) => {
    this._unsavedFilters.set(colRef, {...this._unsavedFilters.get(colRef), ...filter});
    const filterInfo = this.filters().find(c => c.fieldOrColumn.origCol().origColRef() === colRef);
    if (!filterInfo) { return; }

    const {filter: newFilter, pinned: newPinned} = filter;
    if (newFilter !== undefined) { filterInfo.filter(newFilter); }
    if (newPinned !== undefined) { filterInfo.pinned(newPinned); }
  };

  // Revert the filter of the field or column identified by `colRef`.
  this.revertFilter = (colRef: number) => {
    this._unsavedFilters.delete(colRef);
    const filterInfo = this.filters().find(c => c.fieldOrColumn.origCol().origColRef() === colRef);
    if (!filterInfo) { return; }

    filterInfo.filter.revert();
    filterInfo.pinned.revert();
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
    read: () => !this.isDisposed() && this.view().activeSectionId() === this.id(),
    write: (val) => { this.view().activeSectionId(val ? this.id() : 0); }
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

  this.activeRowId = ko.observable<RowId|null>(null);

  this._linkingState = Holder.create(this);
  this.linkingState = this.autoDispose(ko.pureComputed(() => {
    if (!this.activeLinkSrcSectionRef()) {
      // This view section isn't selecting by anything.
      return null;
    }
    try {
      const config = new LinkConfig(this);
      return LinkingState.create(this._linkingState, docModel, config);
    } catch (err) {
      console.warn(err);
      // Dispose old LinkingState in case creating the new one failed.
      this._linkingState.dispose();
      return null;
    }
  }));

  this.linkingFilter = this.autoDispose(ko.pureComputed(() => {
    return this.linkingState()?.filterColValues?.() || {filters: {}, operations: {}};
  }));

  // If the view instance for this section is instantiated, it will be accessible here.
  this.viewInstance = ko.observable<BaseView|null>(null);

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
  this.desiredAccessLevel = ko.observable<AccessLevel|null>(null);
  this.columnsToMap = ko.observable<ColumnsToMap|null>(null);
  // Calculate mapped columns for Custom Widget.
  this.mappedColumns = ko.pureComputed(() => {
    // First check if widget has requested a custom column mapping and
    // if we have a saved configuration.
    const request = this.columnsToMap();
    const mapping = this.customDef.columnsMapping();
    if (!request || !mapping) {
      return null;
    }
    // Convert simple column expressions (widget can just specify a name of a column) to a rich column definition.
    const columnsToMap = request.map(r => new ColumnToMapImpl(r));
    const result: WidgetColumnMap = {};
    // Prepare map of existing column, will need this for translating colRefs to colIds.
    const colMap = new Map(this.columns().map(f => [f.id.peek(), f]));
    for(const widgetCol of columnsToMap) {
      // Start with marking this column as not mapped.
      result[widgetCol.name] = widgetCol.allowMultiple ? [] : null;
      const mappedCol = mapping[widgetCol.name];
      if (!mappedCol) {
        continue;
      }
      if (widgetCol.allowMultiple) {
        // We expect a list of colRefs be mapped;
        if (!Array.isArray(mappedCol)) { continue; }
        result[widgetCol.name] = mappedCol
          // Remove all colRefs saved but deleted
          .filter(cId => colMap.has(cId))
          // And those with wrong type.
          .filter(cId => widgetCol.canByMapped(colMap.get(cId)!.pureType()))
          .map(cId => colMap.get(cId)!.colId());
      } else {
         // Widget expects a single value and existing column
         if (Array.isArray(mappedCol) || !colMap.has(mappedCol)) { continue; }
         const selectedColumn = colMap.get(mappedCol)!;
         result[widgetCol.name] = widgetCol.canByMapped(selectedColumn.pureType()) ? selectedColumn.colId() : null;
      }
    }
    return result;
  });

  this.allowSelectBy = Observable.create(this, false);
  this.selectedRows = Observable.create(this, []);

  this.tableId = this.autoDispose(ko.pureComputed(() => this.table().tableId()));
  const rawSection = this.autoDispose(ko.pureComputed(() => this.table().rawViewSection()));
  this.rulesCols = refListRecords(docModel.columns, ko.pureComputed(() => rawSection().rules()));
  this.rulesColsIds = ko.pureComputed(() => this.rulesCols().map(c => c.colId()));
  this.rulesStyles = modelUtil.savingComputed({
    read: () => rawSection().optionsObj.prop("rulesOptions")() ?? [],
    write: (setter, val) => setter(rawSection().optionsObj.prop("rulesOptions"), val)
  });
  this.hasRules = ko.pureComputed(() => this.rulesCols().length > 0);
  this.addEmptyRule = async () => {
    const action = [
      'AddEmptyRule',
      this.tableId.peek(),
      null,
      null
    ];
    await docModel.docData.sendAction(action, `Update rules for ${this.table.peek().tableId.peek()}`);
  };

  this.removeRule = (index: number) => removeRule(docModel, this, index);

  this.isCollapsed = this.autoDispose(ko.pureComputed(() => {
    const list = this.view().activeCollapsedSections();
    return list.includes(this.id());
  }));
}
