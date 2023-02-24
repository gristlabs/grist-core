var _ = require('underscore');
var BackboneEvents = require('backbone').Events;

var dispose = require('app/client/lib/dispose');
var {makeT} = require('app/client/lib/localization');
var commands = require('./commands');
var LayoutEditor = require('./LayoutEditor');

const t = makeT('RecordLayoutEditor');
const {basicButton, cssButton, primaryButton} = require('app/client/ui2018/buttons');
const {icon} = require('app/client/ui2018/icons');
const {menu, menuDivider, menuItem} = require('app/client/ui2018/menus');
const {testId} = require('app/client/ui2018/cssVars');
const {dom, Observable, styled} = require('grainjs');

//----------------------------------------------------------------------

/**
 * An extension of LayoutEditor which includes commands and the option for a callback function.
 *
 * Used by RecordLayout.js
 *
 * @param {layoutSpec} observable - An observable evaluating to the original layoutSpec of the layout.
 * @param {optResizeCallback} Function - An optional function to be called after every resize during
 *  layout editing.
 */
function RecordLayoutEditor(recordLayout, layout, optResizeCallback) {
  this.recordLayout = recordLayout;
  this.layout = layout;
  this.layoutEditor = this.autoDispose(LayoutEditor.LayoutEditor.create(layout));
  this._hiddenColumns = this.autoDispose(Observable.create(null, this.getHiddenColumns()));

  this.listenTo(layout, 'layoutChanged', function() {
    this._hiddenColumns.set(this.getHiddenColumns());
  });

  if (optResizeCallback) {
    this.listenTo(layout, 'layoutChanged', optResizeCallback);
    this.listenTo(layout, 'layoutResized', optResizeCallback);
  }

  // Command group implementing the commands available while editing the layout.
  this.autoDispose(commands.createGroup(RecordLayoutEditor.editLayoutCommands, this, true));
}
dispose.makeDisposable(RecordLayoutEditor);
_.extend(RecordLayoutEditor.prototype, BackboneEvents);


/**
 * Commands active while editing the record layout.
 */
RecordLayoutEditor.editLayoutCommands = {
  accept: function() {
    this.recordLayout.onEditLayoutSave(this.layout.getLayoutSpec());
  },
  cancel: function() {
    this.layout.buildLayout(this.recordLayout.layoutSpec());
    this.recordLayout.onEditLayoutCancel();
  },
};

/**
 * Returns the list of columns that are not included in the current layout.
 */
RecordLayoutEditor.prototype.getHiddenColumns = function() {
  var included = new Set(this.layout.getAllLeafIds().map(function(leafId) {
    var f = this.recordLayout.getField(leafId);
    return f.isNewField ? f.colRef : f.colRef.peek();
  }, this));
  return this.recordLayout.viewSection.table().columns().all().filter(function(col) {
    return !included.has(col.getRowId()) && !col.isHiddenCol();
  });
};

RecordLayoutEditor.prototype._addField = function(leafId) {
  var newBox = this.layout.buildLayoutBox({ leaf: leafId });
  var rows = this.layout.rootBox().childBoxes.peek();
  if (rows.length >= 1 && _.last(rows).isLeaf()) {
    // Add a new child to the last row.
    _.last(rows).addChild(newBox, true);
  } else {
    // Add a new row.
    this.layout.rootBox().addChild(newBox, true);
  }
};

RecordLayoutEditor.prototype.buildEditorDom = function() {
  const addNewField = () => { this._addField(':New_Field:'); };
  const showField = (col) => {
    // Use setTimeout, since showing a field synchronously removes it from the list, which would
    // prevent the menu from closing if we don't let the event to run its course.
    setTimeout(() => this._addField(col.getRowId() + ':' + col.label()), 0);
  };

  return cssControls(
    basicButton(t('Add Field'), cssCollapseIcon('Collapse'),
      menu((ctl) => [
        menuItem(() => addNewField(), t('Create New Field')),
        dom.maybe((use) => use(this._hiddenColumns).length > 0,
          () => menuDivider()),
        dom.forEach(this._hiddenColumns, (col) =>
          menuItem(() => showField(col), t("Show field {{- label}}", {label:col.label()}))
        ),
        testId('edit-layout-add-menu'),
      ]),
    ),

    dom('div.flexauto', {style: 'margin-left: 8px'}),
    this.buildFinishButtons(),
    testId('edit-layout-controls'),
  );
};

RecordLayoutEditor.prototype.buildFinishButtons = function() {
  return [
    primaryButton(t('Save Layout'),
      dom.on('click', () => commands.allCommands.accept.run()),
    ),
    basicButton(t('Cancel'),
      dom.on('click', () => commands.allCommands.cancel.run()),
      {style: 'margin-left: 8px'},
    ),
  ];
}

RecordLayoutEditor.prototype.buildLeafDom = function() {
  return dom('div.layout_grabbable.g_record_layout_editing',
    dom('div.g_record_delete_field.glyphicon.glyphicon-eye-close',
      dom.on('mousedown', (ev) => ev.stopPropagation()),
      dom.on('click', (ev, elem) => {
        ev.preventDefault();
        ev.stopPropagation();
        const box = this.layoutEditor.getBoxFromElement(elem);
        this.layoutEditor.removeContainingBox(box);
      })
    )
  );
};

const cssControls = styled('div', `
  display: flex;
  align-items: flex-start;

  & > .${cssButton.className} {
    white-space: nowrap;
    overflow: hidden;
  }
`);

const cssCollapseIcon = styled(icon, `
  margin: -3px -2px -2px 2px;
`);

module.exports = RecordLayoutEditor;
