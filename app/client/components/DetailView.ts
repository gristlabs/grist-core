import BaseView from 'app/client/components/BaseView';
import {parsePasteForView} from 'app/client/components/BaseView2';
import * as selector from 'app/client/components/CellSelector';
import {ElemType} from 'app/client/components/CellSelector';
import {CutCallback} from 'app/client/components/Clipboard';
import {GristDoc} from 'app/client/components/GristDoc';
import {renderAllRows} from 'app/client/components/Printing';
import RecordLayout from 'app/client/components/RecordLayout';
import {viewCommands} from 'app/client/components/RegionFocusSwitcher';
import * as commands from 'app/client/components/commands';
import kd from 'app/client/lib/koDom';
import koDomScrolly from 'app/client/lib/koDomScrolly';
import {PasteData} from 'app/client/lib/tableUtil';
import * as tableUtil from 'app/client/lib/tableUtil';
import BaseRowModel from 'app/client/models/BaseRowModel';
import {DataRowModel} from 'app/client/models/DataRowModel';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {ViewSectionRec} from 'app/client/models/entities/ViewSectionRec';
import {CardContextMenu} from 'app/client/ui/CardContextMenu';
import {FieldContextMenu} from 'app/client/ui/FieldContextMenu';
import {descriptionInfoTooltip} from 'app/client/ui/tooltips';
import {isNarrowScreen} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {indexOf} from 'app/common/gutil';
import {UIRowId} from 'app/plugin/GristAPI';

import {dom} from 'grainjs';
import ko from 'knockout';
import _ from 'underscore';

// Disable member-ordering linting temporarily, so that it's easier to review the conversion to
// typescript. It would be reasonable to reorder methods and re-enable this lint check.
/* eslint-disable @typescript-eslint/member-ordering */

/**
 * DetailView component implements a list of record layouts.
 */
export default class DetailView extends BaseView {
  public recordLayout: RecordLayout;

  protected cellSelector: selector.CellSelector;
  protected scrolly: ko.Computed<any>;
  protected layoutBoxIdx: ko.Observable<number>;
  protected detailRecord: DataRowModel|null = null;   // Set whenever _isSingle is true
  protected scrollPane: HTMLElement;

  private _isSingle: boolean;
  private _isExternalSectionPopup: boolean;
  private _twoLastFieldIdsSelected: Array<number|null>;

  constructor(gristDoc: GristDoc, viewSectionModel: ViewSectionRec) {
    super(gristDoc, viewSectionModel, { addNewRow: true });

    this.cellSelector = selector.CellSelector.create(this, this);

    this._isSingle = (this.viewSection.parentKey.peek() === 'single');
    this._isExternalSectionPopup = gristDoc.externalSectionId.get() === this.viewSection.id();

    //--------------------------------------------------
    // Create and attach the DOM for the view.
    this.recordLayout = this.autoDispose(RecordLayout.create({
      viewSection: this.viewSection,
      buildFieldDom: this.buildFieldDom.bind(this),
      buildCardContextMenu : this.buildCardContextMenu.bind(this),
      buildFieldContextMenu : this.buildFieldContextMenu.bind(this),
      resizeCallback: () => {
        if (!this._isSingle) {
          this.scrolly().updateSize();
          // Keep the cursor in view if the scrolly height resets.
          // TODO: Ideally the original position should be kept in scroll view.
          this.scrolly().scrollRowIntoView(this.cursor.rowIndex.peek());
        }
      }
    }));

    this.scrolly = this.autoDispose(ko.computed(() => {
      if (!this.recordLayout.isEditingLayout() && !this._isSingle) {
        return koDomScrolly.getInstance(this.viewData);
      }
    }));

    // Reset scrolly heights when record theme changes, since it affects heights.
    this.autoDispose(this.viewSection.themeDef.subscribe(() => {
      const scrolly = this.scrolly();
      if (scrolly) {
        setTimeout(function() { scrolly.resetHeights(); }, 0);
      }
    }));

    this.layoutBoxIdx = ko.observable(0);

    //--------------------------------------------------
    if (this._isSingle) {
      this.detailRecord = this.autoDispose(this.tableModel.createFloatingRowModel());
      this._updateFloatingRow();
      this.autoDispose(this.cursor.rowIndex.subscribe(this._updateFloatingRow, this));
      this.autoDispose(this.viewData.subscribe(this._updateFloatingRow, this));
    } else {
      this.detailRecord = null;
    }

    //--------------------------------------------------
    // Construct DOM
    this.viewPane = this.buildDom();
    this.onDispose(() => { dom.domDispose(this.viewPane); this.viewPane.remove(); });

    //--------------------------------------------------
    // Set up DOM event handling.
    this._twoLastFieldIdsSelected = [null, null];

    // Clicking on a detail field selects that field.
    this.autoDispose(dom.onMatchElem(this.viewPane, '.g_record_detail_el', 'mousedown', (event, elem) => {
      this.viewSection.hasFocus(true);
      const rowModel = this.recordLayout.getContainingRow(elem as Element, this.viewPane);
      const field = this.recordLayout.getContainingField(elem as Element, this.viewPane);
      commands.allCommands.setCursor.run(rowModel, field);

      // Trigger custom dom event that will bubble up. View components might not be rendered
      // inside a virtual table which don't register this global handler (as there might be
      // multiple instances of the virtual table component).
      this.viewPane.dispatchEvent(new CustomEvent('setCursor', {detail: [rowModel, field], bubbles: true}));

      this._twoLastFieldIdsSelected.unshift(field.id());
      this._twoLastFieldIdsSelected.pop();
    }));

    // Double-clicking on a field also starts editing the field.
    this.autoDispose(dom.onMatchElem(this.viewPane, '.g_record_detail_el', 'dblclick', (event, elem) => {
      this.activateEditorAtCursor({
        event,
      });
    }));

    // We authorize single click only on the value to avoid conflict with tooltip
    this.autoDispose(dom.onMatchElem(this.viewPane, '.g_record_detail_value', 'click', (event, elem) => {
      // If the click was place in a link, we don't want to trigger the single click
      if ((event.target as HTMLElement)?.closest("a")) { return; }

      const field = this.recordLayout.getContainingField(elem as Element, this.viewPane);
      if (
        this._twoLastFieldIdsSelected[0] === this._twoLastFieldIdsSelected[1]
        && !isNarrowScreen()
        && this._canSingleClick(field)
      ) {
        this.activateEditorAtCursor({
          event,
        });
      }
    }));

    //--------------------------------------------------
    // Instantiate CommandGroups for the different modes.
    this.autoDispose(commands.createGroup(viewCommands(DetailView.detailCommands, this),
      this, this.viewSection.hasFocus));
    this.autoDispose(commands.createGroup(DetailView.detailFocusedCommands, this, this.viewSection.hasRegionFocus));
    const hasSelection = this.autoDispose(ko.pureComputed(() =>
      Boolean(!this.cellSelector.isCurrentSelectType('') || this.copySelection())));
    this.autoDispose(commands.createGroup(DetailView.selectionCommands, this, hasSelection));
  }

  protected onTableLoaded() {
    super.onTableLoaded();
    this._updateFloatingRow();

    const scrolly = this.scrolly();
    if (scrolly) {
      scrolly.scrollToSavedPos(this.viewSection.lastScrollPos);
    }
  }

  protected _updateFloatingRow() {
    if (this.detailRecord) {
      this.viewData.setFloatingRowModel(this.detailRecord, this.cursor.rowIndex.peek());
    }
  }

  /**
   * DetailView commands, enabled when the view is the active one.
   *
   * See BaseView.commonCommands for more details.
   */
  protected static detailCommands: {[key: string]: Function} & ThisType<DetailView> = {
    editLayout: function() {
      if (this.scrolly()) {
        this.scrolly().scrollRowIntoView(this.cursor.rowIndex());
      }
      this.recordLayout.editLayout(this.cursor.rowIndex()!);
    },
    hideCardFields: function() { this._hideCardFields().catch(reportError); },
    copy: function() { return this.copy(this.getSelection()); },
    cut: function() { return this.cut(this.getSelection()); },
    paste: function(pasteObj: PasteData, cutCallback: CutCallback|null) {
      return this.gristDoc.docData.bundleActions(null, () => this.paste(pasteObj, cutCallback));
    },
  };

  /**
   * DetailView commands, enabled when the view is user-focused.
   *
   * See BaseView.commonCommands and BaseView.commonFocusedCommands for more details.
   */
  protected static detailFocusedCommands: {[key: string]: Function} & ThisType<DetailView> = {
    cursorUp: function() { this.cursor.fieldIndex(this.cursor.fieldIndex() - 1); },
    cursorDown: function() { this.cursor.fieldIndex(this.cursor.fieldIndex() + 1); },
    pageUp: function() { this.cursor.rowIndex(this.cursor.rowIndex()! - 1); },
    pageDown: function() { this.cursor.rowIndex(this.cursor.rowIndex()! + 1); },
    clearValues: function() { this._clearCardFields()?.catch(reportError); },
  };

  protected static selectionCommands: {[key: string]: Function} & ThisType<DetailView> = {
    clearCopySelection: function() { this._clearCopySelection(); },
    cancel: function() { this._clearSelection(); }
  };

  //----------------------------------------------------------------------
  // To satisfy CellSelector interface, though it's not actually used.
  public domToRowModel(elem: Element, elemType: ElemType): DataRowModel|undefined { return; }
  public domToColModel(elem: Element, elemType: ElemType): DataRowModel|undefined { return; }

  protected selectedRows() {
    if (!this._isAddRow()) {
      return [this.viewData.getRowId(this.cursor.rowIndex()!)];
    }
    return [];
  }

  protected async deleteRows(rowIds: number[]) {
   const index = this.cursor.rowIndex();
    try {
      await super.deleteRows(rowIds);
    } finally {
      if (!this.isDisposed()) {
        this.cursor.rowIndex(index);
      }
    }
  }

  /**
   * Pastes the provided data at the current cursor.
   *
   * @param {Array} data - Array of arrays of data to be pasted. Each array represents a row.
   * i.e.  [["1-1", "1-2", "1-3"],
   *        ["2-1", "2-2", "2-3"]]
   * @param {Function} cutCallback - If provided returns the record removal action needed
   *  for a cut.
   */
  protected async paste(data: PasteData, cutCallback: CutCallback|null) {
    const pasteData = data[0][0];
    const field = this.viewSection.viewFields().at(this.cursor.fieldIndex())!;
    const isCompletePaste = (data.length === 1 && data[0].length === 1);

    const richData = await parsePasteForView([[pasteData]] as PasteData, [field], this.gristDoc);
    if (_.isEmpty(richData)) {
      return;
    }

    // Array containing the paste action to which the cut action will be added if it exists.
    const rowId = this.viewData.getRowId(this.cursor.rowIndex()!);
    const action = (rowId === 'new') ? ['BulkAddRecord', [null], richData] :
      ['BulkUpdateRecord', [rowId], richData];
    const cursorPos = this.cursor.getCursorPos();

    return this.sendPasteActions(isCompletePaste ? cutCallback : null,
      this.prepTableActions([action]))
      .then(results => {
        // If a row was added, get its rowId from the action results.
        const addRowId = (action[0] === 'BulkAddRecord' ? results[0][0] : null);
        // Restore the cursor to the right rowId, even if it jumped.
        this.cursor.setCursorPos({rowId: cursorPos.rowId === 'new' ? addRowId : cursorPos.rowId});
        commands.allCommands.clearCopySelection.run();
      });
  }

  protected buildCardContextMenu(row: DataRowModel) {
    const cardOptions = this._getCardContextMenuOptions(row);
    return CardContextMenu(cardOptions);
  }

  protected buildFieldContextMenu() {
    const fieldOptions = this._getFieldContextMenuOptions();
    return FieldContextMenu(fieldOptions);
  }

  /**
   * Builds the DOM for the given field of the given row.
   * @param {MetaRowModel|String} field: Model for the field to render. For a new field being added,
   *    this may instead be an object with {isNewField:true, colRef, label, value}.
   * @param {DataRowModel} row: The record of data from which to render the given field.
   */
  protected buildFieldDom(field: RecordLayout.NewField | ViewFieldRec, row: DataRowModel) {
    if ('isNewField' in field) {
      return dom('div.g_record_detail_el.flexitem',
        dom.cls((use) => 'detail_theme_field_' + use(this.viewSection.themeDef)),
        dom('div.g_record_detail_label_container',
          dom('div.g_record_detail_label', field.label),
        ),
        dom('div.g_record_detail_value'),
      );
    }

    const isCellSelected = ko.pureComputed(() => {
      return this.cursor.fieldIndex() === (field && field._index()) &&
        this.cursor.rowIndex() === (row && row._index());
    });
    const isCellActive = ko.pureComputed(() => {
      return this.viewSection.hasFocus() && isCellSelected();
    });

    // Whether the cell is part of an active copy-paste operation.
    const isCopyActive = ko.computed(() => {
      return Boolean(this.copySelection()?.isCellSelected(row.getRowId(), field.colId()));
    });

    this.autoDispose(isCellSelected.subscribe(yesNo => {
      if (yesNo) {
        const layoutBox = fieldDom.closest('.layout_hbox')!;
        this.layoutBoxIdx(indexOf(layoutBox.parentElement!.childNodes, layoutBox));
      }
    }));
    const fieldBuilder = this.fieldBuilders.at(field._index()!)!;
    const fieldDom = dom('div.g_record_detail_el.flexitem',
      dom.autoDispose(isCellSelected),
      dom.autoDispose(isCellActive),
      dom.cls((use) => 'detail_theme_field_' + use(this.viewSection.themeDef)),
      dom('div.g_record_detail_label_container',
        dom('div.g_record_detail_label', dom.text(field.displayLabel)),
        dom.domComputed(use => use(field.description),
          desc => desc ? descriptionInfoTooltip(desc, "column") : null)
      ),
      dom('div.g_record_detail_value',
        dom.cls('scissors', isCopyActive),
        dom.cls('record-add', row._isAddRow),
        dom.autoDispose(isCopyActive),
        // Optional icon. Currently only use to show formula icon.
        dom('div.field-icon'),
        fieldBuilder.buildDomWithCursor(row, isCellActive, isCellSelected)
      )
    );
    return fieldDom;
  }

  protected buildDom() {
    return dom('div.flexvbox.flexitem',
      // Add .detailview_single when showing a single card or while editing layout.
      dom.cls('detailview_single',
        (use) => this._isSingle || use(this.recordLayout.isEditingLayout)),
      // Add a marker class that editor is active - used for hiding context menu toggle.
      dom.cls('detailview_layout_editor', this.recordLayout.isEditingLayout),
      dom.maybe(this.recordLayout.isEditingLayout, () => {
        const rowId = this.viewData.getRowId(this.recordLayout.editIndex.peek());
        const record = this.getRenderedRowModel(rowId);
        return dom.update(
          this.recordLayout.buildLayoutDom(record, true),
          dom.cls((use) => 'detail_theme_record_' + use(this.viewSection.themeDef)),
          dom.cls('detailview_record_' + this.viewSection.parentKey.peek()),
        );
      }),
      dom.maybe((use) => !use(this.recordLayout.isEditingLayout), () => {
        if (!this._isSingle) {
          return this.scrollPane = dom('div.detailview_scroll_pane.flexitem',
            kd.scrollChildIntoView(this.cursor.rowIndex),
            dom.onDispose(() => {
              // Save the previous scroll values to the section.
              if (this.scrolly()) {
                this.viewSection.lastScrollPos = this.scrolly().getScrollPos();
              }
            }),
            koDomScrolly.scrolly(this.viewData, {fitToWidth: true},
              (row: DataRowModel) => this.makeRecord(row)),

            dom.maybe(this._isPrinting, () =>
              renderAllRows(this.tableModel, this.sortedRows.getKoArray().peek(), row =>
                this.makeRecord(row))
            ),
          );
        } else {
          return dom.update(
            this.makeRecord(this.detailRecord!),
            kd.domData('itemModel', this.detailRecord),
            dom.hide((use) => use(this.cursor.rowIndex) === null)
          );
        }
      }),
    );
  }

  public override buildTitleControls() {
    // Hide controls if this is a card list section, or if the section has a scroll cursor link, since
    // the controls can be confusing in this case.
    // Note that the controls should still be visible with a filter link.
    const showControls = ko.computed(() => {
      if (
        !this._isSingle||
        this.recordLayout.layoutEditor() ||
        this._isExternalSectionPopup
      ) {
        return false;
      }
      if (this.viewSection.hideViewMenu()) {
        return false;
      }
      const linkingState = this.viewSection.linkingState();
      return !(linkingState && Boolean(linkingState.cursorPos));
    });
    return dom('div',
      dom.autoDispose(showControls),

      dom.cls('record-layout-editor', use => Boolean(use(this.recordLayout.layoutEditor))),
      dom.maybe(this.recordLayout.layoutEditor, (editor: any) => editor.buildEditorDom()),

      dom.maybe(showControls, () => dom('div.grist-single-record__menu.flexhbox.flexnone',
        dom('div.grist-single-record__menu__count.flexitem',
          // Total should not include the add record row
          kd.text(() => this._isAddRow() ? 'Add record' :
            `${this.cursor.rowIndex()! + 1} of ${this.getLastDataRowIndex() + 1}`)
        ),
        dom('div.detail-buttons',
          dom('div.detail-button.detail-left',
            icon('ArrowLeft'),
            dom.on('click', () => { this.cursor.rowIndex(this.cursor.rowIndex()! - 1); }),
            dom.cls('disabled', (use) => use(this.cursor.rowIndex) === 0),
          ),
          dom('div.detail-button.detail-right',
            icon('ArrowRight'),
            dom.on('click', () => { this.cursor.rowIndex(this.cursor.rowIndex()! + 1); }),
            dom.cls('disabled', (use) => use(this.cursor.rowIndex)! >= this.viewData.all().length - 1),
          ),
          dom('div.detail-button.detail-add-btn',
            icon('Plus'),
            dom.on('click', () => {
              const addRowIndex = this.viewData.getRowIndex('new');
              this.cursor.rowIndex(addRowIndex);
            }),
            dom.cls('disabled', (use) => this.viewData.getRowId(use(this.cursor.rowIndex)!) === 'new'),
          ),
        ),
      ))
    );
  }

  public override onNewRecordRequest() {
    const addRowIndex = this.viewData.getRowIndex('new');
    this.cursor.rowIndex(addRowIndex);
  }

  public override onResize() {
    const scrolly = this.scrolly();
    if (scrolly) {
      scrolly.scheduleUpdateSize();
    }
  }

  public override onRowResize(rowModels: BaseRowModel[]): void {
    const scrolly = this.scrolly();
    if (scrolly) {
      scrolly.resetItemHeights(rowModels);
    }
  }

  protected makeRecord(record: DataRowModel) {
    return dom.update(
      this.recordLayout.buildLayoutDom(record),
      dom.cls((use) => 'detail_theme_record_' + use(this.viewSection.themeDef)),
      this.comparison ? dom.cls((use) => {
        const rowType = this.extraRows.getRowType(use(record.id));
        return rowType && `diff-${rowType}` || '';
      }) : null,
      dom.cls('active', (use) =>
        (use(this.cursor.rowIndex) === use(record._index) && use(this.viewSection.hasFocus))),
      dom.cls('selected', (use) =>
        (use(this.cursor.rowIndex) === use(record._index)  && !use(this.viewSection.hasFocus))),
      // 'detailview_record_single' or 'detailview_record_detail' doesn't need to be an observable,
      // since a change to parentKey would cause a separate call to makeRecord.
      dom.cls('detailview_record_' + this.viewSection.parentKey.peek())
    );
  }

  /**
   * Extends BaseView getRenderedRowModel. Called to obtain the rowModel for the given rowId.
   * Returns the rowModel if it is rendered in the current view type, otherwise returns null.
   */
  protected override getRenderedRowModel(rowId: UIRowId) {
    if (this.detailRecord) {
      return this.detailRecord.getRowId() === rowId ? this.detailRecord : undefined;
    } else {
      return this.viewData.getRowModel(rowId);
    }
  }

  /**
   * Returns a boolean indicating whether the given index is the index of the add row.
   * Index defaults to the current index of the cursor.
   */
  protected _isAddRow(index: number|null = this.cursor.rowIndex()) {
    return index !== null && this.viewData.getRowId(index) === 'new';
  }

  public async scrollToCursor(sync: boolean = true): Promise<void> {
    if (!this.scrollPane) { return; }
    return kd.doScrollChildIntoView(this.scrollPane, this.cursor.rowIndex(), sync);
  }

  protected async _duplicateRows(): Promise<number[]|undefined> {
    const addRowIds = await super._duplicateRows();
    if (!addRowIds || addRowIds.length === 0) {
      return;
    }

    this.setCursorPos({rowId: addRowIds[0]});
  }

  protected _canSingleClick(field: ViewFieldRec) {
    // we can't single click if :
    // - the field is a formula
    // - the field is toggle (switch or checkbox)
    if (
      field.column().isRealFormula() ||
      field.column().hasTriggerFormula() ||
      (
        field.column().pureType() === "Bool" &&
        ["Switch", "CheckBox"].includes(field.visibleColFormatter().widgetOpts.widget)
      )
    ) {
      return false;
    }
    return true;
  }

  protected _clearCardFields() {
    if (this.gristDoc.isReadonly.get()) {
      return;
    }

    const selection = this.getSelection();
    const isFormula = Boolean(selection.fields[0]?.column.peek().isRealFormula.peek());
    if (isFormula) {
      this.activateEditorAtCursor({init: ''});
    } else {
      const clearAction = tableUtil.makeDeleteAction(this.getSelection());
      if (clearAction) {
        return this.gristDoc.docData.sendAction(clearAction);
      }
    }
  }

  protected _hideCardFields() {
    const selection = this.getSelection();
    const actions = selection.fields.map(field => ['RemoveRecord', field.id()]);
    return this.gristDoc.docModel.viewFields.sendTableActions(
      actions,
      `Hide fields ${actions.map(a => a[1]).join(', ')} ` +
        `from ${this.tableModel.tableData.tableId}.`
    );
  }

  protected _clearSelection() {
    this.copySelection(null);
    this.cellSelector.setToCursor();
  }

  protected _clearCopySelection() {
    this.copySelection(null);
  }

  protected _getCardContextMenuOptions(row: DataRowModel) {
    return {
      disableInsert: Boolean(
        this.gristDoc.isReadonly.get() ||
        this.viewSection.disableAddRemoveRows() ||
        this.tableModel.tableMetaRow.onDemand()
      ),
      disableDelete: Boolean(
        this.gristDoc.isReadonly.get() ||
        this.viewSection.disableAddRemoveRows() ||
        row._isAddRow()
      ),
      isViewSorted: this.viewSection.activeSortSpec.peek().length > 0,
      numRows: this.getSelection().rowIds.length,
    };
  }

  protected _getFieldContextMenuOptions() {
    const selection = this.getSelection();
    return {
      disableModify: Boolean(selection.fields[0]?.disableModify.peek()),
      isReadonly: this.gristDoc.isReadonly.get() || this.isPreview,
      field: selection.fields[0],
      isAddRow: selection.onlyAddRowSelected(),
    };
  }
}
