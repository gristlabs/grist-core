var _              = require('underscore');
var ko             = require('knockout');

var gutil          = require('app/common/gutil');

var dispose        = require('../lib/dispose');
var dom            = require('../lib/dom');
var kd             = require('../lib/koDom');

var TextBox        = require('./TextBox');

const {colors, testId}   = require('app/client/ui2018/cssVars');
const {icon}             = require('app/client/ui2018/icons');
const {select}           = require('app/client/ui2018/menus');
const {cssLabel, cssRow} = require('app/client/ui/RightPanel');
const {isVersions}       = require('app/common/gristTypes');
const {Computed, styled} = require('grainjs');

/**
 * Reference - The widget for displaying references to another table's records.
 */
function Reference(field) {
  TextBox.call(this, field);
  var col = field.column();
  this.field = field;
  this.colId = col.colId;
  this.docModel = this.field._table.docModel;

  this._refValueFormatter = this.autoDispose(ko.computed(() =>
    field.createVisibleColFormatter()));

  this._visibleColRef = Computed.create(this, (use) => use(this.field.visibleColRef));
  // Note that saveOnly is used here to prevent display value flickering on visible col change.
  this._visibleColRef.onWrite((val) => this.field.visibleColRef.saveOnly(val));

  this._validCols = Computed.create(this, (use) => {
    const refTable = use(use(this.field.column).refTable);
    if (!refTable) { return []; }
    return use(use(refTable.columns))
      .filter(col => !use(col.isHiddenCol))
      .map(col => ({
        label: use(col.label),
        value: col.getRowId(),
        icon: 'FieldColumn',
        disabled: gutil.startsWith(use(col.type), 'Ref:') || use(col.isTransforming)
      }))
      .concat([{label: 'Row ID', value: 0, icon: 'FieldColumn'}]);
  });

  // Computed returns a function that formats cell values.
  this._formatValue = this.autoDispose(ko.computed(() => {
    // If the field is pulling values from a display column, use a general-purpose formatter.
    if (this.field.displayColRef() !== this.field.colRef()) {
      const fmt = this._refValueFormatter();
      return (val) => fmt.formatAny(val);
    } else {
      const refTable = this.field.column().refTable();
      const refTableId = refTable ? refTable.tableId() : "";
      return (val) => val > 0 ? `${refTableId}[${val}]` : "";
    }
  }));
}
dispose.makeDisposable(Reference);
_.extend(Reference.prototype, TextBox.prototype);

Reference.prototype.buildConfigDom = function() {
  return [
    cssLabel('SHOW COLUMN'),
    cssRow(
      select(this._visibleColRef, this._validCols),
      testId('fbuilder-ref-col-select')
    )
  ];
};

Reference.prototype.buildTransformConfigDom = function() {
  return this.buildConfigDom();
};

Reference.prototype.buildDom = function(row, options) {
  const formattedValue = ko.computed(() => {
    if (row._isAddRow() || this.isDisposed() || this.field.displayColModel().isDisposed()) {
      // Work around JS errors during certain changes (noticed when visibleCol field gets removed
      // for a column using per-field settings).
      return "";
    }
    const value = row.cells[this.field.displayColModel().colId()];
    if (!value) { return ""; }
    const content = value();
    if (isVersions(content)) {
      // We can arrive here if the reference value is unchanged (viewed as a foreign key)
      // but the content of its displayCol has changed.  Postponing doing anything about
      // this until we have three-way information for computed columns.  For now,
      // just showing one version of the cell.  TODO: elaborate.
      return this._formatValue()(content[1].local || content[1].parent);
    }
    return this._formatValue()(content);
  });
  return dom('div.field_clip',
    dom.autoDispose(formattedValue),
    cssRefIcon('FieldReference',
      testId('ref-link-icon')
    ),
    kd.text(formattedValue));
};

const cssRefIcon = styled(icon, `
  background-color: ${colors.slate};
  margin: -1px 2px 2px 0;
`);

module.exports = Reference;
