var ko          = require('knockout');
var dispose     = require('../lib/dispose');
var dom         = require('../lib/dom');
var kd          = require('../lib/koDom');
var kf          = require('../lib/koForm');
var modelUtil   = require('../models/modelUtil');
var gutil       = require('app/common/gutil');
var AceEditor   = require('./AceEditor');
var RefSelect   = require('./RefSelect');

const {dom: grainjsDom, makeTestId} = require('grainjs');
const testId = makeTestId('test-fconfigtab-');

function FieldConfigTab(options) {
  this.gristDoc = options.gristDoc;
  this.fieldBuilder = options.fieldBuilder;

  this.origColRef = this.autoDispose(ko.computed(() =>
    this.fieldBuilder() ? this.fieldBuilder().origColumn.origColRef() : null));

  this.isColumnValid = this.autoDispose(ko.computed(() => Boolean(this.origColRef())));

  this.origColumn = this.autoDispose(
    this.gristDoc.docModel.columns.createFloatingRowModel(this.origColRef));

  this.disableModify = this.autoDispose(ko.computed(() =>
    this.origColumn.disableModify() || this.origColumn.isTransforming()));

  this.colId = modelUtil.customComputed({
    read: () => this.origColumn.colId(),
    save: val => this.origColumn.colId.saveOnly(val)
  });

  this.showColId = this.autoDispose(ko.pureComputed({
    read: () => {
      let label = this.origColumn.label();
      let derivedColId = label ? gutil.sanitizeIdent(label) : null;
      return derivedColId === this.colId() && !this.origColumn.untieColIdFromLabel();
    }
  }));

  this.isDerivedFromLabel = this.autoDispose(ko.pureComputed({
    read: () => !this.origColumn.untieColIdFromLabel(),
    write: newValue => this.origColumn.untieColIdFromLabel.saveOnly(!newValue)
  }));

  // Indicates whether this is a ref col that references a different table.
  this.isForeignRefCol = this.autoDispose(ko.pureComputed(() => {
    let type = this.origColumn.type();
    return type && gutil.startsWith(type, 'Ref:') &&
      this.origColumn.table().tableId() !== gutil.removePrefix(type, 'Ref:');
  }));

  // Create an instance of AceEditor that can be built for each column
  this.formulaEditor = this.autoDispose(AceEditor.create({observable: this.origColumn.formula}));

  // Builder for the reference display column multiselect.
  this.refSelect = this.autoDispose(RefSelect.create(this));

  if (options.contentCallback) {
    options.contentCallback(this.buildConfigDomObj());
  } else {
    this.autoDispose(this.gristDoc.addOptionsTab(
      'Field', dom('span.glyphicon.glyphicon-sort-by-attributes'),
      this.buildConfigDomObj(),
      { 'category': 'options', 'show': this.fieldBuilder }
    ));
  }
}
dispose.makeDisposable(FieldConfigTab);

// Builds object with FieldConfigTab dom builder and settings for the sidepane.
// TODO: Field still cannot be filtered/filter settings cannot be opened from FieldConfigTab.
//  This should be considered.
FieldConfigTab.prototype.buildConfigDomObj = function() {
  return [{
    'buildDom': this._buildNameDom.bind(this),
    'keywords': ['field', 'column', 'name', 'title']
  }, {
    'header': true,
    'items': [{
      'buildDom': this._buildFormulaDom.bind(this),
      'keywords': ['field', 'column', 'formula']
    }]
  }, {
    'header': true,
    'label': 'Format Cells',
    'items': [{
      'buildDom': this._buildFormatDom.bind(this),
      'keywords': ['field', 'type', 'widget', 'options', 'alignment', 'justify', 'justification']
    }]
  }, {
    'header': true,
    'label': 'Additional Columns',
    'showObs': this.isForeignRefCol,
    'items': [{
      'buildDom': () => this.refSelect.buildDom(),
      'keywords': ['additional', 'columns', 'reference', 'formula']
    }]
  }, {
    'header': true,
    'label': 'Transform',
    'items': [{
      'buildDom': this._buildTransformDom.bind(this),
      'keywords': ['field', 'type']
    }]
  }];
};

FieldConfigTab.prototype._buildNameDom = function() {
  return grainjsDom.maybe(this.isColumnValid, () => dom('div',
    kf.row(
      1, dom('div.glyphicon.glyphicon-sort-by-attributes.config_icon'),
      4, kf.label('Field'),
      13, kf.text(this.origColumn.label, { disabled: this.disableModify },
        dom.testId("FieldConfigTab_fieldLabel"),
        testId('field-label'))
    ),
    kf.row(
      kd.hide(this.showColId),
      1, dom('div.glyphicon.glyphicon-tag.config_icon'),
      4, kf.label('ID'),
      13, kf.text(this.colId, { disabled: this.disableModify },
        dom.testId("FieldConfigTab_colId"),
        testId('field-col-id'))
    ),
    kf.row(
      8, kf.lightLabel("Use Name as ID?"),
      1, kf.checkbox(this.isDerivedFromLabel,
        dom.testId("FieldConfigTab_deriveId"),
        testId('field-derive-id'))
    )
  ));
};

FieldConfigTab.prototype._buildFormulaDom = function() {
  return grainjsDom.maybe(this.isColumnValid, () => dom('div',
    kf.row(
      3, kf.buttonGroup(
        kf.checkButton(this.origColumn.isFormula,
          dom('span.formula_button_f', '\u0192'),
          dom('span.formula_button_x', 'x'),
          kd.toggleClass('disabled', this.disableModify),
          { title: 'Change to formula column' }
        )
      ),
      15, dom('div.transform_editor', this.formulaEditor.buildDom())
    ),
    kf.helpRow(
      3, dom('span'),
      15, kf.lightLabel(kd.text(
        () => this.origColumn.isFormula() ? 'Formula' : 'Default Formula'))
    )
  ));
};

FieldConfigTab.prototype._buildTransformDom = function() {
  return grainjsDom.maybe(this.fieldBuilder, builder => builder.buildTransformDom());
};

FieldConfigTab.prototype._buildFormatDom = function() {
  return grainjsDom.maybe(this.fieldBuilder, builder => [
    builder.buildSelectTypeDom(),
    builder.buildSelectWidgetDom(),
    builder.buildConfigDom()
  ]);
};

module.exports = FieldConfigTab;
