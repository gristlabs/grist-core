import {getDefaultColValues} from 'app/client/components/BaseView2';
import {CutCallback} from 'app/client/components/Clipboard';
import {CopySelection} from 'app/client/components/CopySelection';
import {Cursor} from 'app/client/components/Cursor';
import {GristDoc} from 'app/client/components/GristDoc';
import {viewCommands} from 'app/client/components/RegionFocusSwitcher';
import {SelectionSummary} from 'app/client/components/SelectionSummary';
import * as commands from 'app/client/components/commands';
import {buildConfirmDelete, reportUndo} from 'app/client/components/modals';
import {KoArray} from 'app/client/lib/koArray';
import * as tableUtil from 'app/client/lib/tableUtil';
import BaseRowModel from 'app/client/models/BaseRowModel';
import {ClientColumnGetters} from 'app/client/models/ClientColumnGetters';
import {DataRowModel} from 'app/client/models/DataRowModel';
import DataTableModel from 'app/client/models/DataTableModel';
import type {LazyArrayModel} from 'app/client/models/DataTableModel';
import {ExtraRows} from 'app/client/models/DataTableModelWithDiff';
import {DynamicQuerySet} from 'app/client/models/QuerySet';
import {SectionFilter} from 'app/client/models/SectionFilter';
import {UnionRowSource} from 'app/client/models/UnionRowSource';
import {markAsSeen} from 'app/client/models/UserPrefs';
import {ColumnRec} from 'app/client/models/entities/ColumnRec';
import {TableRec} from 'app/client/models/entities/TableRec';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {FilterInfo, ViewSectionRec} from 'app/client/models/entities/ViewSectionRec';
import {MutedError} from 'app/client/models/errors';
import {reportError} from 'app/client/models/errors';
import {urlState} from 'app/client/models/gristUrlState';
import * as rowset from 'app/client/models/rowset';
import {RowSource, SortedRowSet} from 'app/client/models/rowset';
import {createFilterMenu, IColumnFilterMenuOptions} from 'app/client/ui/ColumnFilterMenu';
import {buildReassignModal} from 'app/client/ui/buildReassignModal';
import {closeRegisteredMenu} from 'app/client/ui2018/menus';
import type {CommentWithMentions} from 'app/client/widgets/MentionTextBox';
import {BuildEditorOptions, createAllFieldWidgets, FieldBuilder} from 'app/client/widgets/FieldBuilder';
import {BulkColValues, CellValue, DocAction, UserAction} from 'app/common/DocActions';
import {DocStateComparison} from 'app/common/DocState';
import {DismissedPopup} from 'app/common/Prefs';
import {SortFunc} from 'app/common/SortFunc';
import {Sort} from 'app/common/SortSpec';
import * as gristTypes from 'app/common/gristTypes';
import {IGristUrlState} from 'app/common/gristUrls';
import {arrayRepeat, nativeCompare, roundDownToMultiple, waitObs} from 'app/common/gutil';
import {CursorPos, UIRowId} from 'app/plugin/GristAPI';

import {Events as BackboneEvents} from 'backbone';
import {Disposable, DomArg} from 'grainjs';
import ko from 'knockout';
import mapValues from 'lodash/mapValues';
import moment from 'moment-timezone';
import {IOpenController} from 'popweasel';

// Disable member-ordering linting temporarily, so that it's easier to review the conversion to
// typescript. It would be reasonable to reorder methods and re-enable this lint check.
/* eslint-disable @typescript-eslint/member-ordering */

export interface ViewOptions {
  isPreview?: boolean;
  addNewRow?: boolean;
  /**
   * Whether this view supports cursor navigation. Defaults to false. Set to true for custom
   * widgets that manage their own cursor. When false, Cursor.ts will skip listening to
   * keyboard events when this view is active.
   */
  disabledCursor?: boolean;
}

/**
 * BaseView forms the basis for ViewSection classes.
 * @param {Object} viewSectionModel - The model for the viewSection represented.
 * @param {Boolean} options.isPreview - Whether the view is a read-only preview (e.g. Importer view).
 * @param {Boolean} options.addNewRow - Whether to include an add row in the model.
 */
export default class BaseView extends Disposable {

  public viewPane: HTMLElement;
  public viewData: LazyArrayModel<DataRowModel>;
  public cursor: Cursor;
  public sortedRows: SortedRowSet;
  public rowSource: RowSource;
  public activeFieldBuilder: ko.Computed<FieldBuilder>;
  public selectedColumns: ko.Computed<ViewFieldRec[]>|null;
  public disableEditing: ko.Computed<boolean>;
  public isTruncated: ko.Observable<boolean>;
  public tableModel: DataTableModel;
  public selectionSummary?: SelectionSummary;
  public currentEditingColumnIndex: ko.Observable<number>;
  public enableAddRow: ko.Computed<boolean>;
  public options: ViewOptions;

  public onNewRecordRequest?(): Promise<number>|void;

  protected _name: string;
  protected schemaModel: TableRec;
  protected comparison: DocStateComparison | null;
  protected extraRows: ExtraRows;
  protected editRowModel: DataRowModel;
  protected linkedRowId: ko.Computed<UIRowId|null>;
  protected isLinkSource: ko.Computed<boolean>;
  protected isPreview: boolean;
  protected currentColumn: ko.Computed<ColumnRec>;
  protected fieldBuilders: KoArray<FieldBuilder>;
  protected copySelection: ko.Observable<CopySelection|null>;

  private _queryRowSource: DynamicQuerySet;
  private _mainRowSource: RowSource;
  private _exemptFromFilterRows: rowset.ExemptFromFilterRowSource;
  private _sectionFilter: SectionFilter;
  private _filteredRowSource: rowset.FilteredRowSource;
  private _newRowSource: rowset.RowSource;
  private _isLoading: ko.Observable<boolean>;
  private _pendingCursorPos: CursorPos|null;
  protected _isPrinting: ko.Observable<boolean>;

  protected listenTo: BackboneEvents['listenTo'];  // set by Backbone

  constructor(
    public gristDoc: GristDoc,
    public viewSection: ViewSectionRec,
    options?: ViewOptions,
  ) {
    super();
    this.options = options || {};
    this._name = this.viewSection.titleDef.peek();

    //--------------------------------------------------
    // Observable models mapped to the document

    // Instantiate the models for the view metadata and for the data itself.
    // The table should never change for a given view, so no need to watch the table() observable.
    this.schemaModel = this.viewSection.table();

    // Check if we are making a comparison with another document.
    this.comparison = this.gristDoc.comparison;

    // TODO: but accessing by tableId identifier may be problematic when the table is renamed.
    this.tableModel = this.gristDoc.getTableModelMaybeWithDiff(this.schemaModel.tableId());
    this.extraRows = new ExtraRows(this.schemaModel.tableId(), this.comparison?.details);

    // We use a DynamicQuerySet as the underlying RowSource, with ColumnFilters applies on top of
    // it. It filters based on section linking, re-querying as needed in case of onDemand tables.
    this._queryRowSource = DynamicQuerySet.create(this, gristDoc.querySetManager, this.tableModel);
    this._mainRowSource = this._queryRowSource;

    if (this.comparison) {
      // Assign extra row ids for any rows added in the remote (right) table or removed in the
      // local (left) table.
      const extraRowIds = this.extraRows.getExtraRows();
      this._mainRowSource = rowset.ExtendedRowSource.create(this, this._mainRowSource, extraRowIds);
    }

    // Rows that should temporarily be visible even if they don't match filters.
    // This is so that a newly added row doesn't immediately disappear, which would be confusing.
    this._exemptFromFilterRows = rowset.ExemptFromFilterRowSource.create(this);
    this._exemptFromFilterRows.subscribeTo(this.tableModel);

    // Create a section filter and a filtered row source that subscribes to its changes.
    // `sectionFilter` also provides `setFilterOverride()` to allow controlling a filter from a column menu.
    this._sectionFilter = SectionFilter.create(this, this.viewSection, this.tableModel.tableData);
    this._filteredRowSource = rowset.FilteredRowSource.create(this, this._sectionFilter.sectionFilterFunc.get());
    this._filteredRowSource.subscribeTo(this._mainRowSource);
    this.autoDispose(this._sectionFilter.sectionFilterFunc.addListener(filterFunc => {
      this._exemptFromFilterRows.reset();
      this._filteredRowSource.updateFilter(filterFunc);
    }));

    this.rowSource = UnionRowSource.create(this, [this._filteredRowSource, this._exemptFromFilterRows]);

    // Sorted collection of all rows to show in this view.
    this.sortedRows = rowset.SortedRowSet.create(this, null as any, this.tableModel.tableData);

    // Create the sortFunc, and re-sort when sortSpec changes.
    const sortFunc = new SortFunc(new ClientColumnGetters(this.tableModel, {unversioned: true}));
    const updateSort = (spec: Sort.SortSpec) => {
      sortFunc.updateSpec(spec);
      this.sortedRows.updateSort((rowId1, rowId2) => {
        const value = nativeCompare(rowId1 === "new", rowId2 === "new");
        return value || sortFunc.compare(rowId1 as number, rowId2 as number);
      });
    };
    this.autoDispose(this.viewSection.activeDisplaySortSpec.subscribe(updateSort));
    updateSort(this.viewSection.activeDisplaySortSpec.peek());

    // Here we are subscribed to the bulk of the data (main table, possibly filtered).
    this.sortedRows.subscribeTo(this.rowSource);

    // We create a special one-row RowSource for the "Add new" row, in case we need it.
    this._newRowSource = (class extends rowset.RowSource {
      public getAllRows(): rowset.RowList { return ['new']; }
      public getNumRows(): number { return 1; }
    }).create(this);

    // This is the LazyArrayModel containing DataRowModels, for rendering, e.g. with scrolly.
    this.viewData = this.autoDispose(this.tableModel.createLazyRowsModel(this.sortedRows));

    // Floating row model that is not destroyed when the row is scrolled out of view. It must be
    // assigned manually to a rowId. Additionally, we override the saving of field values with a
    // custom method that handles better positioning of cursor on adding a new row.
    this.editRowModel = this.autoDispose(this.tableModel.createFloatingRowModel());
    (this.editRowModel as any)._saveField =
      (colName: string, value: CellValue) => this._saveEditRowField(this.editRowModel, colName, value);

    // Reset heights of rows when there is an action that affects them.
    this.listenTo(this.viewData, 'rowModelNotify', this.onRowResize);

    this.listenTo(this.viewSection.events, 'rowHeightChange', this.onResize );

    // Create a command group for keyboard shortcuts common to all views.
    this.autoDispose(commands.createGroup(
      viewCommands(BaseView._commonCommands, this), this, this.viewSection.hasFocus));
    this.autoDispose(commands.createGroup(
      BaseView._commonFocusedCommands, this, this.viewSection.hasRegionFocus));

    //--------------------------------------------------
    // Prepare logic for linking with other sections.

    // A computed for the rowId of the row selected by section linking.
    this.linkedRowId = this.autoDispose(ko.computed(() => {
      const linking = this.viewSection.linkingState();
      return linking && linking.cursorPos ? linking.cursorPos() : null;
    }).extend({deferred: true}));

    // Update the cursor whenever linkedRowId() changes (but only if we have any linking).
    this.autoDispose(this.linkedRowId.subscribe(rowId => {
      if (this.viewSection.linkingState.peek()) {
        this.setCursorPos({rowId: rowId || 'new'}, true);
      }
    }));

    this.isLinkSource = this.autoDispose(ko.pureComputed(() => this.viewSection.linkedSections().all().length > 0));

    // Indicated whether editing the section should be disabled given the current linking state.
    this.disableEditing = this.autoDispose(ko.computed(() => {
      const linking = this.viewSection.linkingState();
      return linking ? linking.disableEditing() : false;
    }));

    this.isPreview = this.options.isPreview ?? false;

    this.enableAddRow = this.autoDispose(ko.computed(() => Boolean(this.options.addNewRow) &&
      !this.viewSection.disableAddRemoveRows() && !this.disableEditing()));

    // Hide the add row if editing is disabled via filter linking.
    const updateEnableAddRow = (_enableAddRow: boolean) => {
      if (_enableAddRow) {
        this.sortedRows.subscribeTo(this._newRowSource);
      } else {
        this.sortedRows.unsubscribeFrom(this._newRowSource);
      }
    };
    this.autoDispose(this.enableAddRow.subscribe(updateEnableAddRow));
    updateEnableAddRow(this.enableAddRow.peek());

    //--------------------------------------------------
    // Observables local to this view
    this._isLoading = ko.observable(true);
    this._pendingCursorPos = this.viewSection.lastCursorPos;

    // Initialize the cursor with the previous cursor position indices, if they exist.
    console.log("BaseView viewSection %s (%s) lastCursorPos %s", this.viewSection.getRowId(),
      this.viewSection.table().tableId(), JSON.stringify(this.viewSection.lastCursorPos));
    this.cursor = this.autoDispose(Cursor.create(null, this, this.viewSection.lastCursorPos));

    this.currentColumn = this.autoDispose(ko.pureComputed(() =>
      this.viewSection.viewFields().at(this.cursor.fieldIndex())!.column()
    ).extend({rateLimit: 0}));     // TODO Test this without the rateLimit

    this.currentEditingColumnIndex = ko.observable(-1);

    // A koArray of FieldBuilder objects, one for each view-section field.
    this.fieldBuilders = this.autoDispose(
      createAllFieldWidgets(this.gristDoc, this.viewSection.viewFields, this.cursor, {
        isPreview: this.isPreview,
      })
    );

    // An observable evaluating to the FieldBuilder for the field where the cursor is.
    this.activeFieldBuilder = this.autoDispose(ko.pureComputed(() =>
      this.fieldBuilders.at(this.cursor.fieldIndex())!
    ));

    // By default, a view doesn't support selectedColumns, but it can be overridden.
    this.selectedColumns = null;

    // Observable for whether the data in this view is truncated, i.e. not all rows are included
    // (this can only be true for on-demand tables).
    this.isTruncated = ko.observable(false);

    // This computed's purpose is the side-effect of calling makeQuery() initially and when any
    // dependency changes.
    this.autoDispose(ko.computed(() => {
      this._isLoading(true);
      const linkingFilter = this.viewSection.linkingFilter();
      this._queryRowSource.makeQuery(linkingFilter.filters, linkingFilter.operations, (err) => {
        if (this.isDisposed()) { return; }
        if (err) { reportError(err); }
        this._exemptFromFilterRows.reset();
        this.onTableLoaded();
      });
    }));

    // Reset cursor to the first row when filtering changes.
    this.autoDispose(this.viewSection.linkingFilter.subscribe((x) => this.onLinkFilterChange()));

    // When sorting changes, reset the cursor to the first row. (The alternative of moving the
    // cursor to stay at the same record is sometimes better, but sometimes more annoying.)
    this.autoDispose(this.viewSection.activeSortSpec.subscribe(() => this.setCursorPos({rowIndex: 0})));

    this.copySelection = ko.observable<CopySelection|null>(null);

    // Whether parts needed for printing should be rendered now.
    this._isPrinting = ko.observable(false);
  }


  /**
   * These commands are common to GridView and DetailView.
   *
   * They work when the view is the currently active one, but not necessarily user-focused.
   *
   * That means the user can be focusing a button in the creator panel and run these commands:
   * they will apply to the active view.
   * When a command from here is executed, keyboard focus is set back to the view.
   *
   * There is no strict rule for which command goes here and which goes in the commonFocusedCommands list.
   * The goal of the distinction is to:
   *   1) allow users to run most commands easily, without having to think about actually focusing an active view,
   *   2) make sure command keyboard shortcuts don't interfere with user keyboard navigation when the user is
   *      focused on something else.
   * The main thing to watch out for is the 2) point. When adding a command, ask yourself if "blocking" the kb shortcut
   * when not focusing the view is risky: is the shortcut so generic that it's likely to be used outside of the view,
   * for example for navigation? If so, the command should go in the "focused" list.
   * Most commands triggered by arrow keys, Tab, Enter, pagination keys, should usually go in the focused list.
   * Most commands with relatively hard or specific triggers should usually go in the normal list.
   */
  private static _commonCommands: {[key: string]: Function} & ThisType<BaseView> = {
    input: function(init?: string, event?: Event) {
      this.scrollToCursor(true).catch(reportError);
      this.activateEditorAtCursor({init, event});
    },
    copyLink: function() { this.copyLink().catch(reportError); },
    filterByThisCellValue: function() { this.filterByThisCellValue(); },
    duplicateRows: function() { this._duplicateRows().catch(reportError); },
    openDiscussion: function(ev: unknown, payload: CommentWithMentions|null) {
      const state = typeof payload === 'object' && payload ? payload : null;
      this._openDiscussionAtCursor(state);
    },
    insertRecordBefore: function() { this.insertRow(this.cursor.rowIndex()!)?.catch(reportError); },
    insertRecordAfter: function() { this.insertRow(this.cursor.rowIndex()! + 1)?.catch(reportError); },
  };

  /**
   * These commands are common to GridView and DetailView.
   *
   * They are enabled only when the user is actually focusing the view, meaning
   * they don't work when the view is the active one but the user is focused on something else, like the creator panel.
   */
  private static _commonFocusedCommands: {[key: string]: Function} & ThisType<BaseView> = {
    editField: function(this: BaseView, event?: KeyboardEvent) {
      closeRegisteredMenu();
      this.scrollToCursor(true).catch(reportError);
      this.activateEditorAtCursor({event});
    },

    insertCurrentDate: function() { this.insertCurrentDate(false)?.catch(reportError); },
    insertCurrentDateTime: function() { this.insertCurrentDate(true)?.catch(reportError); },

    deleteRecords: function(source?: KeyboardEvent) { this.deleteRecords(source)?.catch(reportError); },

    viewAsCard: function() {
      /* Overridden by subclasses.
       *
       * This is still needed so that <space> doesn't trigger the `input` command
       * if a subclass doesn't support opening the current record as a card. */
    },
  };


  /**
   * Returns a selection of the selected rows and cols.  By default this will just
   * be one row and one column as multiple cell selection is not supported.
   * GridView overrides to support multiple cell selection.
   */
  protected getSelection(): CopySelection {
    return new CopySelection(
      this.tableModel.tableData,
      [this.viewData.getRowId(this.cursor.rowIndex()!)],
      [this.viewSection.viewFields().at(this.cursor.fieldIndex())!],
      {}
    );
  }


  protected selectedRows(): number[] {
    return [];
  }

  protected deleteRows(rowIds: number[]) {
    return this.tableModel.sendTableAction(['BulkRemoveRecord', rowIds]);
  }

  // Commands run via a Mousetrap callback get a KeyboardEvent is the first argument. This is
  // obscure and essentially undocumented.
  protected deleteRecords(source: KeyboardEvent|unknown) {
    if (this.gristDoc.isReadonly.get()) {
      return;
    }

    const rowIds = this.selectedRows();
    if (this.viewSection.disableAddRemoveRows() || rowIds.length === 0){
      return;
    }
    const isKeyboard = source instanceof KeyboardEvent;
    const popups = this.gristDoc.docPageModel.appModel.dismissedPopups;
    const popupName = DismissedPopup.check('deleteRecords');
    const onSave = async (remember?: boolean) => {
      if (remember) {
        markAsSeen(popups, popupName);
      }
      return this.deleteRows(rowIds);
    };
    if (isKeyboard && !popups.get().includes(popupName)) {
      // If we can't find it, use viewPane itself
      this.scrollToCursor().catch(reportError);
      const selectedCell = this.viewPane.querySelector(".selected_cursor") || this.viewPane;
      buildConfirmDelete(selectedCell, onSave, rowIds.length <= 1);
    } else {
      return onSave().then(() => {
        if (!this.isDisposed()) {
          reportUndo(this.gristDoc, `You deleted ${rowIds.length} row${rowIds.length > 1 ? 's' : ''}.`);
        }
        return true;
      });
    }
  }

  /**
   * Sets the cursor to the given position, deferring if necessary until the current query finishes
   * loading. isFromLink will be set when called as result of cursor linking(see Cursor.setCursorPos for info)
   */
  public setCursorPos(cursorPos: CursorPos, isFromLink = false): void {
    if (this.isDisposed()) {
      return;
    }
    if (!this._isLoading.peek()) {
      this.cursor.setCursorPos(cursorPos, isFromLink);
    } else {
      // This is the first step; the second happens in onTableLoaded.
      this._pendingCursorPos = cursorPos;
      this.cursor.setLive(false);
    }
  }

  /**
   * Returns a promise that's resolved when the query being loaded finishes loading.
   * If no query is being loaded, it will resolve immediately.
   */
  public async getLoadingDonePromise(): Promise<void> {
    await waitObs(this._isLoading, (value) => !value);
  }

  /**
   * Start editing the selected cell.
   * @param {String} input: If given, initialize the editor with the given input (rather than the
   *    original content of the cell).
   */
  public activateEditorAtCursor(options: BuildEditorOptions = {}): void {
    const builder = this.activeFieldBuilder();
    if (builder.isEditorActive()) {
      return;
    }
    const rowId = this.viewData.getRowId(this.cursor.rowIndex()!);
    // LazyArrayModel row model which is also used to build the cell dom. Needed since
    // it may be used as a key to retrieve the cell dom, which is useful for editor placement.
    const lazyRow = this.getRenderedRowModel(rowId);
    if (!lazyRow) {
      // TODO scroll into view. For now, just don't activate the editor.
      return;
    }
    this.editRowModel.assign(rowId);
    builder.buildEditorDom(this.editRowModel, lazyRow, options || {});
  }


  /**
   * Opens discussion panel at the cursor position. Returns true if discussion panel was opened.
   */
  private _openDiscussionAtCursor(text: CommentWithMentions|null) {
    const builder = this.activeFieldBuilder();
    if (builder.isEditorActive()) {
      return false;
    }
    const rowId = this.viewData.getRowId(this.cursor.rowIndex()!);
    // LazyArrayModel row model which is also used to build the cell dom. Needed since
    // it may be used as a key to retrieve the cell dom, which is useful for editor placement.
    const lazyRow = this.getRenderedRowModel(rowId);
    if (!lazyRow) {
      // TODO scroll into view. For now, just don't start discussion.
      return false;
    }
    this.editRowModel.assign(rowId);
    builder.buildDiscussionPopup(this.editRowModel, lazyRow, text);
    return true;
  }


  /**
   * Move the floating RowModel for editing to the current cursor position, and return it.
   *
   * This is used for opening the formula editor in the side panel; the current row is used to get
   * possible exception info from the formula.
   */
  public moveEditRowToCursor(): DataRowModel {
    const rowId = this.viewData.getRowId(this.cursor.rowIndex()!);
    this.editRowModel.assign(rowId);
    return this.editRowModel;
  }

  // Get an anchor link for the current cell and a given view section to the clipboard.
  public getAnchorLinkForSection(sectionId: number): IGristUrlState {
    const rowId = this.viewData.getRowId(this.cursor.rowIndex()!)
        // If there are no visible rows (happens in some widget linking situations),
        // pick an arbitrary row which will hopefully be close to the top of the table.
        || this.tableModel.tableData.findMatchingRowId({})
        // If there are no rows at all, return the 'new record' row ID.
        // Note that this case only happens in combination with the widget linking mentioned.
        // If the table is empty but the 'new record' row is selected, the `viewData.getRowId` line above works.
        || 'new';
    // The `fieldIndex` will be null if there are no visible columns.
    const fieldIndex = this.cursor.fieldIndex.peek();
    const field = fieldIndex !== null ? this.viewSection.viewFields().peek()[fieldIndex] : null;
    const colRef = field?.colRef.peek();
    const linkingRowIds = sectionId ? this.gristDoc.docModel.getLinkingRowIds(sectionId) : undefined;
    return {hash: {sectionId, rowId, colRef, linkingRowIds}};
  }

  // Copy an anchor link for the current row to the clipboard.
  protected async copyLink() {
    const sectionId = this.viewSection.getRowId();
    const anchorUrlState = this.getAnchorLinkForSection(sectionId);
    return this.gristDoc.copyAnchorLink(anchorUrlState.hash!);
  }

  protected filterByThisCellValue() {
    const rowId = this.viewData.getRowId(this.cursor.rowIndex()!);
    const col = this.viewSection.viewFields().peek()[this.cursor.fieldIndex()].column();
    let value = this.tableModel.tableData.getValue(rowId, col.colId.peek())!;

    // This mimics the logic in ColumnFilterMenu.addCountsToMap
    // ChoiceList and Reflist values get 'flattened' out so we filter by each element within.
    // In any other column type, complex values (even lists) get converted to JSON.
    let filterValues;
    const colType = col.type.peek();
    if (gristTypes.isList(value) && gristTypes.isListType(colType)) {
      filterValues = value.slice(1);
      if (!filterValues.length) {
        // If the list is empty, filter instead by an empty value for the whole list
        filterValues = [colType === "ChoiceList" ? "" : null];
      }
    } else {
      if (Array.isArray(value)) {
        value = JSON.stringify(value);
      }
      filterValues = [value];
    }
    this.viewSection.setFilter(col.getRowId(), {filter: JSON.stringify({included: filterValues})});
  }

  /**
   * Insert a new row immediately before the row at the given index if given an Integer. Otherwise
   * insert a new row at the end.
   */
  public insertRow(index?: number): Promise<number>|undefined {
    if (this.gristDoc.isReadonly.get()) {
      return;
    }

    if (this.viewSection.disableAddRemoveRows() || this.disableEditing()) {
      return;
    }
    const rowId = index != null ? this.viewData.getRowId(index) : undefined;
    const insertPos = Number.isInteger(rowId) ?
      this.tableModel.tableData.getValue(rowId, 'manualSort') : null;

    return this.sendTableAction(['AddRecord', null, { 'manualSort': insertPos }])!
    .then((rowId) => {      // eslint-disable-line @typescript-eslint/no-shadow
      if (!this.isDisposed()) {
        this._exemptFromFilterRows.addExemptRow(rowId);
        this.setCursorPos({rowId});
      }
      return rowId;
    });
  }

  private _getDefaultColValues() {
    return getDefaultColValues(this.viewSection);
  }

  /**
   * Enhances [Bulk]AddRecord actions to include the default values determined by the current
   * section-linking filter.
   */
  private _enhanceAction(action: UserAction) {
    if (action[0] === 'AddRecord' || action[0] === 'BulkAddRecord') {
      let colValues = this._getDefaultColValues();
      const rowIds = action[1] as number[];
      if (action[0] === 'BulkAddRecord') {
        colValues = mapValues(colValues, v => rowIds.map(() => v));
      }
      Object.assign(colValues, action[2]);
      return [action[0], rowIds, colValues];
    } else {
      return action;
    }
  }

  /**
   * Enhances a list of table actions and turns them from implicit-table actions into
   * proper actions.
   */
  protected prepTableActions(actions: UserAction[]) {
    actions = actions.map(a => this._enhanceAction(a));
    actions.forEach(action_ => {
      action_.splice(1, 0, this.tableModel.tableData.tableId);
    });
    return actions;
  }

  /**
   * Shortcut for `.tableModel.tableData.sendTableActions`, which also sets default values
   * determined by the current section-linking filter, if any.
   */
  protected sendTableActions(actions: UserAction[], optDesc?: string) {
    return this.tableModel.sendTableActions(actions.map(a => this._enhanceAction(a)), optDesc);
  }


  /**
   * Shortcut for `.tableModel.tableData.sendTableAction`, which also sets default values
   * determined by the current section-linking filter, if any.
   */
  protected sendTableAction(action: UserAction, optDesc?: string) {
    return action ? this.tableModel.sendTableAction(this._enhanceAction(action), optDesc) : null;
  }


  /**
   * Inserts the current date/time into the selected cell if the cell is of a compatible type
   * (Text/Date/DateTime/Any).
   * @param {Boolean} withTime: Whether to include the time in addition to the date. This is ignored
   *    for Date columns (assumed false) and for DateTime (assumed true).
   */
  protected insertCurrentDate(withTime: boolean) {
    if (this.gristDoc.isReadonly.get()) {
      return;
    }

    const column = this.currentColumn();
    if (column.isRealFormula()) {
      // Ignore the shortcut when in a formula column.
      return;
    }
    const type = column.pureType();
    let value;
    const now = Date.now();
    const docTimezone = this.gristDoc.docInfo.timezone.peek();
    if (type === 'Text' || type === 'Any') {
      // Use document timezone. Don't forget to use uppercase HH for 24-hour time.
      value = moment.tz(now, docTimezone).format('YYYY-MM-DD' + (withTime ? ' HH:mm:ss' : ''));
    } else if (type === 'Date') {
      // Get UTC midnight for the current date (as seen in docTimezone). This is a bit confusing. If
      // it's "2019-11-14 23:30 -05:00", then it's "2019-11-15 04:30" in UTC. Since we measure time
      // from Epoch UTC, we want the UTC time to have the correct date, so need to add the offset
      // (-05:00) to get "2019-11-14 23:30" in UTC, and then round down to midnight.
      const offsetMinutes = moment.tz(now, docTimezone).utcOffset();
      value = roundDownToMultiple(now / 1000 + offsetMinutes * 60, 24*3600);
    } else if (type === 'DateTime') {
      value = now / 1000;
    } else {
      // Ignore the shortcut when in a column of an inappropriate type.
      return;
    }
    const rowId = this.viewData.getRowId(this.cursor.rowIndex()!);
    this.editRowModel.assign(rowId);
    return this.editRowModel.cells[column.colId()].setAndSave(value);
  }


  /**
   * Override the saving of field values to add some extra processing:
   * - If a new row is saved, then we may need to adjust the row where the cursor is.
   * - We add the edited or added row to ensure it's displayed regardless of current columnFilters.
   * - We change the main view's row observables to see the new value immediately.
   * TODO: When saving a formula in the addRow, the cursor moves down instead of staying in place.
   *       To fix that behavior, propose to factor out the `isAddRow` overrides from here
   *       into a `setNewRowColValues` on the editRowModel and have `FieldBuilder._saveEdit` call
   *       that instead of `updateColValues`.
   */
  private _saveEditRowField(editRowModel: DataRowModel, colName: string, value: CellValue) {
    if (editRowModel._isAddRow.peek()) {
      this.cursor.setLive(false);
      const colValues = this._getDefaultColValues();
      colValues[colName] = value;

      return editRowModel.updateColValues(colValues)
      // Once we know the new row's rowId, add it to column filters to make sure it's displayed.
      .then(rowId => {
        if (!this.isDisposed()) {
          this._exemptFromFilterRows.addExemptRow(rowId);
          this.setCursorPos({rowId});
        }
        return rowId;
      })
      .finally(() => !this.isDisposed() && this.cursor.setLive(true));
    } else {
      const rowId = editRowModel.getRowId();
      // We are editing the floating "edit" rowModel, but to ensure that we see data in the main view
      // (when the editor closes), we immediately update the main view's rowModel, if such exists.
      const mainRowModel = this.getRenderedRowModel(rowId);
      if (mainRowModel) {
        mainRowModel.cells[colName](value);
      }
      const ret = editRowModel.updateColValues({[colName]: value})
        // Display this rowId, even if it doesn't match the filter,
        // unless the filter is on a Bool column
        .then((result) => {
          if (!this.isDisposed() && this.currentColumn().pureType() !== 'Bool') {
            this._exemptFromFilterRows.addExemptRow(rowId);
          }
          return result;
        })
        .finally(() => !this.isDisposed() && mainRowModel && (mainRowModel as any)._assignColumn(colName));
      return this.viewSection.isSorted() ? ret : null;
      // Do not return the saveField call in the case that the column is unsorted: in this case,
      // we assumes optimistically that the action is successful and browser events can
      // continue being processed immediately without waiting.
      // When sorted, we wait on the saveField call so we may determine where the row ends
      // up for cursor movement purposes.
    }
  }

  /**
   * Uses the current cursor selection to return a rich paste object with a reference to the data,
   * and the selection ranges.  See CopySelection.js
   *
   * @returns {pasteObj} - Paste object
   */
  protected copy(selection: CopySelection) {
    // Clear the previous copy selection, if any.
    commands.allCommands.clearCopySelection.run();

    this.copySelection(selection);

    return {
      data: this.tableModel.tableData,
      selection: selection
    };
  }

  /**
   * Uses the current cursor selection to return a rich paste object with a reference to the data,
   * the selection ranges and a callback that when called performs all of the actions needed for a cut.
   *
   * @returns {pasteObj} - Paste object
   */
  protected cut(selection: CopySelection) {
    // Clear the previous copy selection, if any.
    commands.allCommands.clearCopySelection.run();

    this.copySelection(selection);

    return {
      data: this.tableModel.tableData,
      selection: selection,
      cutCallback: () => tableUtil.makeDeleteAction(selection)
    };
  }

  /**
   * Helper to send paste actions from the cutCallback and a list of paste actions.
   */
  protected sendPasteActions(cutCallback: CutCallback|null, actions: UserAction[]) {
    let cutAction = null;
    // If this is a cut -> paste, add the cut action and a description.
    if (cutCallback) {
      cutAction = cutCallback();
      // If the cut occurs on an edit restricted cell, there may be no cut action.
      if (cutAction) { actions.unshift(cutAction); }
    }
    return this.gristDoc.docData.sendActions(actions).catch(ex => {
      if (ex.code === 'UNIQUE_REFERENCE_VIOLATION') {
        buildReassignModal({
          docModel: this.gristDoc.docModel,
          actions: actions as DocAction[],
        }).catch(reportError);
        throw new MutedError();
      } else {
        throw ex;
      }
    });
  }

  protected buildDom() {
    throw new Error("Not Implemented");
  }

  /**
   * Called by ViewLayout to return view-specific controls to add into its ViewSection's title bar.
   * By default builds nothing. Derived views may override.
   */
  public buildTitleControls(): DomArg {
    return null;
  }

  /**
   * Called when table data gets loaded (if already loaded, then called immediately after the
   * constructor). Derived views may override.
   */
  protected onTableLoaded() {
    // Complete the setting of a pending cursor position (see setCursorPos() for the first half).
    if (this._pendingCursorPos) {
      this.cursor.setCursorPos(this._pendingCursorPos);
      this._pendingCursorPos = null;
    }
    this._isLoading(false);
    this.isTruncated(this._queryRowSource.isTruncated);
    this.cursor.setLive(true);
  }

  /**
   * Called when view gets resized. Derived views may override.
   */
  public onResize(): void {
  }

  /**
   * Called when rows have changed and may potentially need resizing. Derived views may override.
   * @param {Array<DataRowModel>} rowModels: Array of row models whose size may have changed.
   */
  public onRowResize(rowModels: BaseRowModel[]): void {
  }

  /**
   * Called when user selects a different row which drives the link-filtering of this section.
   */
  protected onLinkFilterChange() {
    // If this section is linked, go to the first row as the row previously selected may no longer
    // be visible.
    if (this.viewSection.linkingState.peek()) {
      this.setCursorPos({rowIndex: 0});
    }
  }

  /**
   * Called before and after printing this section.
   */
  public prepareToPrint(onOff: boolean): void {
    this._isPrinting(onOff);
  }

  /**
   * Called to obtain the rowModel for the given rowId. Returns a rowModel if it belongs to the
   * section and is rendered, otherwise returns null.
   * Useful to tie a rendered row to the row being edited. Derived views may override.
   */
  protected getRenderedRowModel(rowId: UIRowId): DataRowModel|undefined {
    return this.viewData.getRowModel(rowId);
  }

  /**
   * Returns the index of the last non-AddNew row in the grid.
   */
  protected getLastDataRowIndex() {
    const last = this.viewData.peekLength - 1;
    return (last >= 0 && this.viewData.getRowId(last) === 'new') ? last - 1 : last;
  }

  /**
   * Creates and opens ColumnFilterMenu for a given field/column, and returns its PopupControl.
   */
  public createFilterMenu(
    openCtl: IOpenController, filterInfo: FilterInfo, options: IColumnFilterMenuOptions
  ): HTMLElement {
    const {showAllFiltersButton, onClose} = options;
    return createFilterMenu({
      openCtl,
      sectionFilter: this._sectionFilter,
      filterInfo,
      rowSource: this._mainRowSource,
      tableData: this.tableModel.tableData,
      gristDoc: this.gristDoc,
      showAllFiltersButton,
      onClose,
    });
  }

  /**
   * Whether the rows shown by this view are a proper subset of all rows in the table.
   */
  protected isFiltered() {
    return this._filteredRowSource.getNumRows() < this.tableModel.tableData.numRecords();
  }

  /**
   * Makes sure that active record is in the view.
   * @param {Boolean} sync If the scroll should be performed synchronously. For typing we should
   * scroll synchronously, for other cases asynchronously as there might be some other operations
   * pending (see doScrollChildIntoView in koDom).
   */
  public async scrollToCursor(sync?: boolean): Promise<void> {
    // to override
  }

  /**
   * Return a list of manual sort positions so that inserting {numInsert} rows
   * with the returned positions will place them in between index-1 and index.
   * when the GridView is sorted by MANUALSORT
   **/
  protected _getRowInsertPos(index: number, numInserts: number) {
    const rowId = this.viewData.getRowId(index);
    const insertPos = this.tableModel.tableData.getValue(rowId, gristTypes.MANUALSORT);
    return Array(numInserts).fill(insertPos);
  }

  /**
   * Duplicates selected row(s) and returns inserted rowIds
   */
  protected async _duplicateRows(): Promise<number[]|undefined> {
    if (
      this.gristDoc.isReadonly.get() ||
      this.viewSection.disableAddRemoveRows() ||
      this.disableEditing()
    ) {
      return;
    }

    // Get current selection (we need only rowIds).
    const selection = this.getSelection();
    const rowIds = selection.rowIds;
    const length = rowIds.length;
    // Start assembling action.
    const action: UserAction = ['BulkAddRecord'];
    // Put nulls as rowIds.
    action.push(arrayRepeat(length, null));
    const columns: BulkColValues = {};
    action.push(columns);
    // Calculate new positions for rows using helper function. It requires
    // index where we want to put new rows (it accepts new row index).
    const lastSelectedIndex = this.viewData.getRowIndex(rowIds[length-1]);
    columns.manualSort = this._getRowInsertPos(lastSelectedIndex + 1, length);
    // Now copy all visible data.
    for(const col of this.viewSection.columns.peek()) {
      // But omit all formula columns (and empty ones).
      const colId = col.colId.peek();
      if (col.isFormula.peek()) {
        continue;
      }
      columns[colId] = rowIds.map(id => this.tableModel.tableData.getValue(id, colId)!);
      // If all values in a column are censored, remove this column,
      if (columns[colId].every(gristTypes.isCensored)) {
        delete columns[colId];
      } else {
        // else remove only censored values
        columns[colId].forEach((val, i) => {
          if (gristTypes.isCensored(val)) {
            columns[colId][i] = null;
          }
        });
      }
    }
    const result: number[] = await this.sendTableAction(action, `Duplicated rows ${rowIds}`);
    return result;
  }

  public viewSelectedRecordAsCard(): void {
    if (this.isRecordCardDisabled()) { return; }

    const colRef = this.viewSection.viewFields().at(this.cursor.fieldIndex())!.column().id();
    const rowId = this.viewData.getRowId(this.cursor.rowIndex()!);
    const sectionId = this.viewSection.tableRecordCard().id();
    const anchorUrlState = {hash: {colRef, rowId, sectionId, recordCard: true}};
    urlState().pushUrl(anchorUrlState, {replace: true}).catch(reportError);
  }

  public isRecordCardDisabled(): boolean {
    return this.viewSection.isTableRecordCardDisabled();
  }
}

Object.assign(BaseView.prototype, BackboneEvents);
