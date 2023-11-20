/**
 * Module for displaying a record of user data in a two-dimentional editable layout.
 */


// TODO:
// 1. Consider a way to upgrade a file to add layoutSpec column to the ViewSections meta table.
//    Plan: add docInfo schemaVersion field.
//          when opening a file, let the sandbox check the version and check if loaded metadata matches the schema.
//          sandbox should return doc-version, current-version, and match status.
//          if current-version != doc_version [AND mismatch] (this is optional, let's think if we
//              want that), then
//            Sandbox creates new temp document
//            Replays action log into it.
//            Renames it over the old document. [Would be nice to ask the user first]
//            Reopen document
// 1. [LATER] Create RecordLayout file with APIs to support more efficient big list of laid-out
//    records (so that a single RecordLayout can maintain many Layout instances).
// 2. [LATER] Allow dragging in boxes from the view config.
// 3. [LATER] Allow creating new field and inserting at the bottom.
// 4. [LATER] Allow selecting existing field from context menu and inserting.
// 5. [LATER] Add interface to Layout to tab forward and back, left, right, up, down, and use that in
//    detail view.
// 6. [LATER] Implement saving and loading of widths in the layout spec.

var _ = require('underscore');
var ko = require('knockout');
var Promise = require('bluebird');

var gutil = require('app/common/gutil');
var dispose = require('../lib/dispose');
var dom = require('../lib/dom');
var {Delay} = require('../lib/Delay');
var kd = require('../lib/koDom');
var {makeT} = require('../lib/localization');
var Layout = require('./Layout');
var RecordLayoutEditor = require('./RecordLayoutEditor');
var commands = require('./commands');
var {menuToggle} = require('app/client/ui/MenuToggle');
var {menu} = require('../ui2018/menus');
var {testId} = require('app/client/ui2018/cssVars');
var {contextMenu} = require('app/client/ui/contextMenu');

const t = makeT('RecordLayout');

/**
 * Construct a RecordLayout.
 * @param {MetaRowModel} options.viewSection: The model for the viewSection represented.
 * @param {Function} options.buildFieldDom: Function called with (viewField) that should
 *    return the DOM for that field.
 * @param {Function} options.resizeCallback: Optional function called with no arguments when
 *    the RecordLayout is modified in a way that may require resizing.
 */
function RecordLayout(options) {
  this.viewSection = options.viewSection;
  this.buildFieldDom = options.buildFieldDom;
  this.buildCardContextMenu = options.buildCardContextMenu;
  this.buildFieldContextMenu = options.buildFieldContextMenu;
  this.isEditingLayout = ko.observable(false);
  this.editIndex = ko.observable(0);
  this.layoutEditor = ko.observable(null);    // RecordLayoutEditor when one is active.

  if (options.resizeCallback) {
    this._resizeCallback = options.resizeCallback;
    this._delayedResize = this.autoDispose(Delay.create());
  }

  // Observable object that will be rebuilt whenever the list of viewFields changes.
  this.fieldsById = this.autoDispose(ko.computed(function() {
    return _.indexBy(this.viewSection.viewFields().all(),
      function(field) { return field.getRowId(); });
  }, this));

  // Update the stored layoutSpecObj with any missing fields that are present in viewFields.
  this.layoutSpec = this.autoDispose(ko.computed(function() {
    if (this.viewSection.isDisposed()) { return null; }
    return RecordLayout.updateLayoutSpecWithFields(
      this.viewSection.layoutSpecObj(), this.viewSection.viewFields().all());
  }, this).extend({rateLimit: 0})); // layoutSpecObj and viewFields should be updated together.
  this.autoDispose(this.layoutSpec.subscribe(() => this.resizeCallback()));

  // TODO: We may want a context menu for each record, but the previous implementation wasn't
  // working, and was creating a separate context menu for each row, which is very expensive. A
  // better approach is to create a single context menu for the view section, as GridView does.
}
dispose.makeDisposable(RecordLayout);


RecordLayout.prototype.resizeCallback = function() {
  // Note that while editing layout, scrolly is hidden, and resizeCallback is unhelpful. We rely
  // on explicit resizing when isEditLayout is reset.
  if (!this.isDisposed() && this._delayedResize && !this.isEditingLayout.peek()) {
    this._delayedResize.schedule(0, this._resizeCallback);
  }
};

RecordLayout.prototype.getField = function(fieldRowId) {
  // If fieldRowId is a string which includes ":", then it's actually "colRef:label:value"
  // placeholder that we use when adding a new field. If so, return a special object with the fields
  // available. Note that virtual tables also produces string fieldRowId but they have no ":".
  if (typeof fieldRowId === 'string' && fieldRowId.includes(':')) {
    var parts = gutil.maxsplit(fieldRowId, ":", 2);
    return {
      isNewField: true,        // To make it easy to distinguish from a ViewField MetaRowModel
      colRef: parseInt(parts[0], 10),
      label: parts[1],
      value: parts[2]
    };
  }
  return this.fieldsById()[fieldRowId];
};


/**
 * Sets the layout to being edited.
 */
RecordLayout.prototype.editLayout = function(rowIndex) {
  this.editIndex(rowIndex);
  this.isEditingLayout(true);
};

/**
 * Ends layout editing, without updating the layout on the server.
 */
RecordLayout.prototype.onEditLayoutCancel = function(layoutSpec) {
  this.isEditingLayout(false);
  // Call resizeCallback here, since it's possible that theme was also changed (and auto-saved)
  // even though the layout itself was reverted.
  this.resizeCallback();
};

/**
 * Ends layout editing, and saves the given layoutSpec to the server.
 */
RecordLayout.prototype.onEditLayoutSave = async function(layoutSpec) {
  try {
    await this.saveLayoutSpec(layoutSpec);
  } finally {
    this.isEditingLayout(false);
    this.resizeCallback();
  }
};

/**
 * If there is no layout saved, we can create a default layout just from the list of fields for
 * this view section. By default we just arrange them into a list of rows, two fields per row.
 */
RecordLayout.updateLayoutSpecWithFields = function(spec, viewFields) {
  // We use tmpLayout as a way to manipulate the layout before we get a final spec from it.
  var tmpLayout = Layout.Layout.create(spec, function(leafId) { return dom('div'); });

  var specFieldIds = tmpLayout.getAllLeafIds();
  var viewFieldIds = viewFields.map(function(f) { return f.getRowId(); });

  // For any stale fields (no longer among viewFields), remove them from tmpLayout.
  _.difference(specFieldIds, viewFieldIds).forEach(function(leafId) {
    tmpLayout.getLeafBox(leafId).dispose();
  });

  // For all fields that should be in the spec but aren't, add them to tmpLayout. We maintain a
  // two-column layout, so add a new row, or a second box to the last row if it's a leaf.
  _.difference(viewFieldIds, specFieldIds).forEach(function(leafId) {
    var newBox = tmpLayout.buildLayoutBox({ leaf: leafId });
    var rows = tmpLayout.rootBox().childBoxes.peek();
    if (rows.length >= 1 && _.last(rows).isLeaf()) {
      // Add a new child to the last row.
      _.last(rows).addChild(newBox, true);
    } else {
      // Add a new row.
      tmpLayout.rootBox().addChild(newBox, true);
    }
  });

  spec = tmpLayout.getLayoutSpec();
  tmpLayout.dispose();
  return spec;
};

/**
 * Saves the layout spec as build by the user. This is quite involved, because it may need to
 * remove fields as well as create fields and possibly new columns. And it needs the results of
 * these operations to update the spec before saving it.
 */
RecordLayout.prototype.saveLayoutSpec = async function(layoutSpec) {
  // The layout hasn't actually changed. Skip the rest to avoid creating no-op actions (the
  // resulting no-op undo would be particularly confusing).
  if (JSON.stringify(layoutSpec) === this.viewSection.layoutSpec.peek()) {
    return;
  }

  const docModel = this.viewSection._table.docModel;
  const docData = docModel.docData;
  const tableId = this.viewSection.table().tableId();
  const getField = fieldRef => this.getField(fieldRef);
  const addColAction = ["AddColumn", null, {}];

  // Build a set of fieldRefs (i.e. rowIds) that are currently stored. Also build a map of colRef
  // to fieldRef, so that we can restore a field that got removed and re-added (as a colRef).
  var origRefs = [];
  var colRefToFieldRef = new Map();
  this.viewSection.viewFields().all().forEach(f => {
    origRefs.push(f.getRowId());
    colRefToFieldRef.set(f.colRef(), f.getRowId());
  });

  // Initialize leaf index counter and num cols to be added counter.
  var nextPos = 0;
  var addColNum = 0;

  // Initialize arrays to keep track of existing field refs and their updated positions.
  var existingRefs = [];
  var existingPositions = [];

  // Initialize arrays to keep track of added fields for existing but hidden columns.
  var hiddenColRefs = [];
  var hiddenCallbacks = [];
  var hiddenPositions = [];

  // Initialize arrays to keep track of newly added columns.
  var addedCallbacks = [];
  var addedPositions = [];

  // Recursively process all layoutBoxes in the spec. Sets up bookkeeping arrays for
  // existing fields and added fields for new/hidden cols from which the action bundle will
  // be created.
  function processBox(spec) {
    // "empty" is a temporary placeholder used by LayoutEditor, and not a valid leaf.
    if (spec.leaf && spec.leaf !== "empty") {
      let pos = nextPos++;
      let field = getField(spec.leaf);
      let updateLeaf = ref => { spec.leaf = ref; };
      if (!field.isNewField) {
        // Existing field.
        existingRefs.push(field.getRowId());
        existingPositions.push(pos);
      } else if (colRefToFieldRef.has(field.colRef)) {
        // Existing field that got removed and re-added.
        let fieldRef = colRefToFieldRef.get(field.colRef);
        existingRefs.push(fieldRef);
        existingPositions.push(pos);
        updateLeaf(fieldRef);
      } else if (Number.isNaN(field.colRef)) {
        // We need to add a new column AND field.
        addColNum++;
        addedCallbacks.push(updateLeaf);
        addedPositions.push(pos);
      } else {
        // We need to add a field for an existing column.
        hiddenColRefs.push(field.colRef);
        hiddenCallbacks.push(updateLeaf);
        hiddenPositions.push(pos);
      }
    }
    if (spec.children) {
      spec.children.map(processBox);
    }
  }
  processBox(layoutSpec);

  // Combine data for item which require both new columns and new fields and only new fields,
  // with items which require new columns first.
  let callbacks = addedCallbacks.concat(hiddenCallbacks);
  let positions = addedPositions.concat(hiddenPositions);

  // Use separate copies of addColAction, since sendTableActions modified each in-place.
  let addActions = gutil.arrayRepeat(addColNum, 0).map(() => addColAction.slice());

  await docData.bundleActions(t("Updating record layout."), () => {
    return Promise.try(() => {
      return addColNum > 0 ? docModel.dataTables[tableId].sendTableActions(addActions) : [];
    })
    .then(results => {
      let colRefs = results.map(r => r.colRef).concat(hiddenColRefs);
      const addFieldNum = colRefs.length;
      // Add fields for newly added columns and previously hidden columns.
      return addFieldNum > 0 ?
        docModel.viewFields.sendTableAction(["BulkAddRecord", gutil.arrayRepeat(addFieldNum, null), {
          parentId: gutil.arrayRepeat(addFieldNum, this.viewSection.getRowId()),
          colRef: colRefs,
          parentPos: positions
        }]) : [];
    })
    .each((fieldRef, i) => {
      // Call the stored callback for each fieldRef, which each set the correct layoutSpec leaf
      // to the newly obtained fieldRef.
      callbacks[i](fieldRef);
    })
    .then(addedRefs => {
      let actions = [];

      // Records present before that were not present after editing must be removed.
      let finishedRefs = new Set(existingRefs.concat(addedRefs));
      let removed = origRefs.filter(fieldRef => !finishedRefs.has(fieldRef));
      if (removed.length > 0) {
        actions.push(["BulkRemoveRecord", "_grist_Views_section_field", removed]);
      }

      // Positions must be updated for fields which were not added/removed.
      if (existingRefs.length > 0) {
        actions.push(["BulkUpdateRecord", "_grist_Views_section_field", existingRefs, {
          "parentPos": existingPositions
        }]);
      }

      // And update the layoutSpecObj itself.
      actions.push(["UpdateRecord", "_grist_Views_section", this.viewSection.getRowId(), {
        "layoutSpec": JSON.stringify(layoutSpec)
      }]);

      return docData.sendActions(actions);
    })
  });
};

/**
 * Builds the Layout dom for a single record.
 */
RecordLayout.prototype.buildLayoutDom = function(row, optCreateEditor) {
  const createEditor = Boolean(optCreateEditor && !this.layoutEditor.peek());

  const layout = Layout.Layout.create(this.layoutSpec(), (fieldRowId) =>
    dom('div.g_record_layout_leaf.flexhbox.flexauto',
      this.buildFieldDom(this.getField(fieldRowId), row),
      (createEditor ?
        kd.maybe(this.layoutEditor, editor => editor.buildLeafDom()) :
        null
      )
    )
  );

  const sub = this.layoutSpec.subscribe((spec) => { layout.buildLayout(spec, createEditor); });

  if (createEditor) {
    this.layoutEditor(RecordLayoutEditor.create(this, layout));
  }

  return dom('div.g_record_detail.flexauto',
    dom.autoDispose(layout),
    dom.autoDispose(sub),
    createEditor ? dom.onDispose(() => {
      this.layoutEditor.peek().dispose();
      this.layoutEditor(null);
    }) : null,
    // enables field context menu anywhere on the card
    contextMenu(() => this.buildFieldContextMenu()),
    dom('div.detail_row_num',
      kd.text(() => (row._index() + 1)),
      dom.on('contextmenu', ev => {
        // This is a little hack to position the menu the same way as with a click,
        // the same hack as on a column menu.
        ev.preventDefault();
        // prevent 2nd context menu to show up
        ev.stopPropagation();
        ev.currentTarget.querySelector('.menu_toggle').click();
      }),
      menuToggle(null,
        dom.on('click', () => {
          this.viewSection.hasFocus(true);
          commands.allCommands.setCursor.run(row);
        }),
        menu(() => this.buildCardContextMenu(row)),
        testId('card-menu-trigger')
      )
    ),
    dom('div.g_record_detail_inner', layout.rootElem)
  );
};

/**
 * Returns the viewField row model for the field that the given DOM element belongs to.
 */
RecordLayout.prototype.getContainingField = function(elem, optContainer) {
  return this.getField(Layout.Layout.getContainingBox(elem, optContainer).leafId());
};

/**
 * Returns the RowModel for the record that the given DOM element belongs to.
 */
RecordLayout.prototype.getContainingRow = function(elem, optContainer) {
  var itemElem = dom.findAncestor(elem, optContainer, '.g_record_detail');
  return ko.utils.domData.get(itemElem, 'itemModel');
};

module.exports = RecordLayout;
