const _             = require('underscore');
const ko            = require('knockout');

const dom           = require('app/client/lib/dom');
const kd            = require('app/client/lib/koDom');
const koDomScrolly  = require('app/client/lib/koDomScrolly');
const {renderAllRows} = require('app/client/components/Printing');
const {isNarrowScreen} = require('app/client/ui2018/cssVars');
const {icon} = require('app/client/ui2018/icons');

require('app/client/lib/koUtil'); // Needed for subscribeInit.

const Base          = require('./Base');
const BaseView      = require('./BaseView');
const selector      = require('./CellSelector');
const {CopySelection} = require('./CopySelection');
const RecordLayout  = require('./RecordLayout');
const commands      = require('./commands');
const tableUtil     = require('../lib/tableUtil');
const {CardContextMenu} = require('../ui/CardContextMenu');
const {FieldContextMenu} = require('../ui/FieldContextMenu');
const {parsePasteForView} = require("./BaseView2");
const {descriptionInfoTooltip} = require("../ui/tooltips");


/**
 * DetailView component implements a list of record layouts.
 */
function DetailView(gristDoc, viewSectionModel) {
  BaseView.call(this, gristDoc, viewSectionModel, { 'addNewRow': true });

  this.cellSelector = selector.CellSelector.create(this, this);

  this.viewFields = gristDoc.docModel.viewFields;
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
    var scrolly = this.scrolly();
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
  this.scrollPane = null;
  this.viewPane = this.autoDispose(this.buildDom());

  //--------------------------------------------------
  // Set up DOM event handling.
  this._twoLastFieldIdsSelected = [null, null];

  // Clicking on a detail field selects that field.
  this.onEvent(this.viewPane, 'mousedown', '.g_record_detail_el', function(elem, event) {
    this.viewSection.hasFocus(true);
    var rowModel = this.recordLayout.getContainingRow(elem, this.viewPane);
    var field = this.recordLayout.getContainingField(elem, this.viewPane);
    commands.allCommands.setCursor.run(rowModel, field);
    this._twoLastFieldIdsSelected.unshift(field.id());
    this._twoLastFieldIdsSelected.pop();
  });

  // Double-clicking on a field also starts editing the field.
  this.onEvent(this.viewPane, 'dblclick', '.g_record_detail_el', function(elem, event) {
    this.activateEditorAtCursor();
  });

  // We authorize single click only on the value to avoid conflict with tooltip
  this.onEvent(this.viewPane, 'click', '.g_record_detail_value', function(elem, event) {
    // If the click was place in a link, we don't want to trigger the single click
    if (event.target?.closest("a")) { return; }

    const field = this.recordLayout.getContainingField(elem, this.viewPane);
    if (
      this._twoLastFieldIdsSelected[0] === this._twoLastFieldIdsSelected[1]
      && !isNarrowScreen()
      && this._canSingleClick(field)
    ) {
      this.activateEditorAtCursor();
    }
  });

  //--------------------------------------------------
  // Instantiate CommandGroups for the different modes.
  this.autoDispose(commands.createGroup(DetailView.generalCommands, this, this.viewSection.hasFocus));
  this.autoDispose(commands.createGroup(DetailView.fieldCommands, this, this.viewSection.hasFocus));
  const hasSelection = this.autoDispose(ko.pureComputed(() =>
    !this.cellSelector.isCurrentSelectType('') || this.copySelection()));
  this.autoDispose(commands.createGroup(DetailView.selectionCommands, this, hasSelection));
}
Base.setBaseFor(DetailView);
_.extend(DetailView.prototype, BaseView.prototype);


DetailView.prototype.onTableLoaded = function() {
  BaseView.prototype.onTableLoaded.call(this);
  this._updateFloatingRow();

  const scrolly = this.scrolly();
  if (scrolly) {
    scrolly.scrollToSavedPos(this.viewSection.lastScrollPos);
  }
};

DetailView.prototype._updateFloatingRow = function() {
  if (this.detailRecord) {
    this.viewData.setFloatingRowModel(this.detailRecord, this.cursor.rowIndex.peek());
  }
};

/**
 * DetailView commands.
 */
DetailView.generalCommands = {
  cursorUp: function() { this.cursor.fieldIndex(this.cursor.fieldIndex() - 1); },
  cursorDown: function() { this.cursor.fieldIndex(this.cursor.fieldIndex() + 1); },
  pageUp: function() { this.cursor.rowIndex(this.cursor.rowIndex() - 1); },
  pageDown: function() { this.cursor.rowIndex(this.cursor.rowIndex() + 1); },
  copy: function() { return this.copy(this.getSelection()); },
  cut: function() { return this.cut(this.getSelection()); },
  paste: function(pasteObj, cutCallback) {
    return this.gristDoc.docData.bundleActions(null, () => this.paste(pasteObj, cutCallback));
  },

  editLayout: function() {
    if (this.scrolly()) {
      this.scrolly().scrollRowIntoView(this.cursor.rowIndex());
    }
    this.recordLayout.editLayout(this.cursor.rowIndex());
  },
};

DetailView.fieldCommands = {
  clearCardFields: function() { this._clearCardFields(); },
  hideCardFields: function() { this._hideCardFields(); },
};

DetailView.selectionCommands = {
  clearCopySelection: function() { this._clearCopySelection(); },
  cancel: function() { this._clearSelection(); }
};

//----------------------------------------------------------------------


DetailView.prototype.selectedRows = function() {
  if (!this._isAddRow()) {
    return [this.viewData.getRowId(this.cursor.rowIndex())];
  }
  return [];
};

DetailView.prototype.deleteRows = async function(rowIds) {
 const index = this.cursor.rowIndex();
  try {
    await BaseView.prototype.deleteRows.call(this, rowIds);
  } finally {
    if (!this.isDisposed()) {
      this.cursor.rowIndex(index);
    }
  }
};

/**
 * Pastes the provided data at the current cursor.
 *
 * @param {Array} data - Array of arrays of data to be pasted. Each array represents a row.
 * i.e.  [["1-1", "1-2", "1-3"],
 *        ["2-1", "2-2", "2-3"]]
 * @param {Function} cutCallback - If provided returns the record removal action needed
 *  for a cut.
 */
DetailView.prototype.paste = async function(data, cutCallback) {
  let pasteData = data[0][0];
  let field = this.viewSection.viewFields().at(this.cursor.fieldIndex());
  let isCompletePaste = (data.length === 1 && data[0].length === 1);

  const richData = await parsePasteForView([[pasteData]], [field], this.gristDoc);
  if (_.isEmpty(richData)) {
    return;
  }

  // Array containing the paste action to which the cut action will be added if it exists.
  const rowId = this.viewData.getRowId(this.cursor.rowIndex());
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
};

/**
 * Returns a selection of the selected rows and cols.  In the case of DetailView this will just
 * be one row and one column as multiple cell selection is not supported.
 *
 * @returns {Object} CopySelection
 */
DetailView.prototype.getSelection = function() {
  return new CopySelection(
    this.tableModel.tableData,
    [this.viewData.getRowId(this.cursor.rowIndex())],
    [this.viewSection.viewFields().at(this.cursor.fieldIndex())],
    {}
  );
};

DetailView.prototype.buildCardContextMenu = function(row) {
  const cardOptions = this._getCardContextMenuOptions(row);
  return CardContextMenu(cardOptions);
}

DetailView.prototype.buildFieldContextMenu = function() {
  const fieldOptions = this._getFieldContextMenuOptions();
  return FieldContextMenu(fieldOptions);
}

/**
 * Builds the DOM for the given field of the given row.
 * @param {MetaRowModel|String} field: Model for the field to render. For a new field being added,
 *    this may instead be an object with {isNewField:true, colRef, label, value}.
 * @param {DataRowModel} row: The record of data from which to render the given field.
 */
DetailView.prototype.buildFieldDom = function(field, row) {
  var self = this;
  if (field.isNewField) {
    return dom('div.g_record_detail_el.flexitem',
      kd.cssClass(function() { return 'detail_theme_field_' + self.viewSection.themeDef(); }),
      dom('div.g_record_detail_label_container',
        dom('div.g_record_detail_label', kd.text(field.label)),
        kd.scope(field.description, desc => desc ? descriptionInfoTooltip(desc, "colmun") : null)
      ),
      dom('div.g_record_detail_value'),
    );
  }

  var isCellSelected = ko.pureComputed(function() {
    return this.cursor.fieldIndex() === (field && field._index()) &&
      this.cursor.rowIndex() === (row && row._index());
  }, this);
  var isCellActive = ko.pureComputed(function() {
    return this.viewSection.hasFocus() && isCellSelected();
  }, this);

  // Whether the cell is part of an active copy-paste operation.
  var isCopyActive = ko.computed(function() {
    return self.copySelection() &&
      self.copySelection().isCellSelected(row.getRowId(), field.colId());
  });

  this.autoDispose(isCellSelected.subscribe(yesNo => {
    if (yesNo) {
      var layoutBox = dom.findAncestor(fieldDom, '.layout_hbox');
      this.layoutBoxIdx(_.indexOf(layoutBox.parentElement.childNodes, layoutBox));
    }
  }));
  var fieldBuilder = this.fieldBuilders.at(field._index());
  var fieldDom = dom('div.g_record_detail_el.flexitem',
    dom.autoDispose(isCellSelected),
    dom.autoDispose(isCellActive),
    kd.cssClass(function() { return 'detail_theme_field_' + self.viewSection.themeDef(); }),
    dom('div.g_record_detail_label_container',
      dom('div.g_record_detail_label', kd.text(field.displayLabel)),
      kd.scope(field.description, desc => desc ? descriptionInfoTooltip(desc, "column") : null)
    ),
    dom('div.g_record_detail_value',
      kd.toggleClass('scissors', isCopyActive),
      kd.toggleClass('record-add', row._isAddRow),
      dom.autoDispose(isCopyActive),
      // Optional icon. Currently only use to show formula icon.
      dom('div.field-icon'),
      fieldBuilder.buildDomWithCursor(row, isCellActive, isCellSelected)
    )
  );
  return fieldDom;
};

DetailView.prototype.buildDom = function() {
  return dom('div.flexvbox.flexitem',
    // Add .detailview_single when showing a single card or while editing layout.
    kd.toggleClass('detailview_single',
      () => this._isSingle || this.recordLayout.isEditingLayout()),
    // Add a marker class that editor is active - used for hiding context menu toggle.
    kd.toggleClass('detailview_layout_editor', this.recordLayout.isEditingLayout),
    kd.maybe(this.recordLayout.isEditingLayout, () => {
      const rowId = this.viewData.getRowId(this.recordLayout.editIndex.peek());
      const record = this.getRenderedRowModel(rowId);
      return dom(
        this.recordLayout.buildLayoutDom(record, true),
        kd.cssClass(() => 'detail_theme_record_' + this.viewSection.themeDef()),
        kd.cssClass('detailview_record_' + this.viewSection.parentKey.peek()),
      );
    }),
    kd.maybe(() => !this.recordLayout.isEditingLayout(), () => {
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
            row => this.makeRecord(row)),

          kd.maybe(this._isPrinting, () =>
            renderAllRows(this.tableModel, this.sortedRows.getKoArray().peek(), row =>
              this.makeRecord(row))
          ),
        );
      } else {
        return dom(
          this.makeRecord(this.detailRecord),
          kd.domData('itemModel', this.detailRecord),
          kd.hide(() => this.cursor.rowIndex() === null)
        );
      }
    }),
  );
};

/** @inheritdoc */
DetailView.prototype.buildTitleControls = function() {
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
    const linkingState = this.viewSection.linkingState();
    return !(linkingState && Boolean(linkingState.cursorPos));
  });
  return dom('div',
    dom.autoDispose(showControls),

    kd.toggleClass('record-layout-editor', this.recordLayout.layoutEditor),
    kd.maybe(this.recordLayout.layoutEditor, (editor) => editor.buildEditorDom()),

    kd.maybe(showControls, () => dom('div.grist-single-record__menu.flexhbox.flexnone',
      dom('div.grist-single-record__menu__count.flexitem',
        // Total should not include the add record row
        kd.text(() => this._isAddRow() ? 'Add record' :
          `${this.cursor.rowIndex() + 1} of ${this.getLastDataRowIndex() + 1}`)
      ),
      dom('div.detail-buttons',
        dom('div.detail-button.detail-left',
          icon('ArrowLeft'),
          dom.on('click', () => { this.cursor.rowIndex(this.cursor.rowIndex() - 1); }),
          kd.toggleClass('disabled', () => this.cursor.rowIndex() === 0),
          dom.testId('detailView_detail_left'),
        ),
        dom('div.detail-button.detail-right',
          icon('ArrowRight'),
          dom.on('click', () => { this.cursor.rowIndex(this.cursor.rowIndex() + 1); }),
          kd.toggleClass('disabled', () => this.cursor.rowIndex() >= this.viewData.all().length - 1),
          dom.testId('detailView_detail_right'),
        ),
        dom('div.detail-button.detail-add-btn',
          icon('Plus'),
          dom.on('click', () => {
            let addRowIndex = this.viewData.getRowIndex('new');
            this.cursor.rowIndex(addRowIndex);
          }),
          kd.toggleClass('disabled', () => this.viewData.getRowId(this.cursor.rowIndex()) === 'new'),
          dom.testId('detailView_detail_add'),
        ),
      ),
    ))
  );
};


/** @inheritdoc */
DetailView.prototype.onResize = function() {
  var scrolly = this.scrolly();
  if (scrolly) {
    scrolly.scheduleUpdateSize();
  }
};

/** @inheritdoc */
DetailView.prototype.onRowResize = function(rowModels) {
  var scrolly = this.scrolly();
  if (scrolly) {
    scrolly.resetItemHeights(rowModels);
  }
};

DetailView.prototype.makeRecord = function(record) {
  return dom(
    this.recordLayout.buildLayoutDom(record),
    kd.cssClass(() => 'detail_theme_record_' + this.viewSection.themeDef()),
    this.comparison ? kd.cssClass(() => {
      const rowType = this.extraRows.getRowType(record.id());
      return rowType && `diff-${rowType}` || '';
    }) : null,
    kd.toggleClass('active', () => (this.cursor.rowIndex() === record._index() && this.viewSection.hasFocus())),
    kd.toggleClass('selected', () => (this.cursor.rowIndex() === record._index()  && !this.viewSection.hasFocus())),
    // 'detailview_record_single' or 'detailview_record_detail' doesn't need to be an observable,
    // since a change to parentKey would cause a separate call to makeRecord.
    kd.cssClass('detailview_record_' + this.viewSection.parentKey.peek())
  );
};

/**
 * Extends BaseView getRenderedRowModel. Called to obtain the rowModel for the given rowId.
 * Returns the rowModel if it is rendered in the current view type, otherwise returns null.
 */
DetailView.prototype.getRenderedRowModel = function(rowId) {
  if (this.detailRecord) {
    return this.detailRecord.getRowId() === rowId ? this.detailRecord : null;
  } else {
    return this.viewData.getRowModel(rowId);
  }
};

/**
 * Returns a boolean indicating whether the given index is the index of the add row.
 * Index defaults to the current index of the cursor.
 */
DetailView.prototype._isAddRow = function(index = this.cursor.rowIndex()) {
  return this.viewData.getRowId(index) === 'new';
};

DetailView.prototype.scrollToCursor = function(sync = true) {
  if (!this.scrollPane) { return Promise.resolve(); }
  return kd.doScrollChildIntoView(this.scrollPane, this.cursor.rowIndex(), sync);
}

DetailView.prototype._duplicateRows = async function() {
  const addRowIds = await BaseView.prototype._duplicateRows.call(this);
  this.setCursorPos({rowId: addRowIds[0]})
}

DetailView.prototype._canSingleClick = function(field) {
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
};

DetailView.prototype._clearCardFields = function() {
  const selection = this.getSelection();
  const isFormula = Boolean(selection.fields[0]?.column.peek().isRealFormula.peek());
  if (isFormula) {
    this.activateEditorAtCursor({init: ''});
  } else {
    const clearAction = tableUtil.makeDeleteAction(this.getSelection());
    if (clearAction) {
      this.gristDoc.docData.sendAction(clearAction);
    }
  }
};

DetailView.prototype._hideCardFields = function() {
  const selection = this.getSelection();
  const actions = selection.fields.map(field => ['RemoveRecord', field.id()]);
  return this.gristDoc.docModel.viewFields.sendTableActions(
    actions,
    `Hide fields ${actions.map(a => a[1]).join(', ')} ` +
      `from ${this.tableModel.tableData.tableId}.`
  );
}

DetailView.prototype._clearSelection = function() {
  this.copySelection(null);
  this.cellSelector.setToCursor();
};

DetailView.prototype._clearCopySelection = function() {
  this.copySelection(null);
};

DetailView.prototype._getCardContextMenuOptions = function(row) {
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

DetailView.prototype._getFieldContextMenuOptions = function() {
  const selection = this.getSelection();
  return {
    disableModify: Boolean(selection.fields[0]?.disableModify.peek()),
    isReadonly: this.gristDoc.isReadonly.get() || this.isPreview,
  };
}

module.exports = DetailView;
