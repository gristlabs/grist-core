/* global $ */
var ko = require('knockout');
var dispose = require('../lib/dispose');
var dom = require('../lib/dom');
var kd = require('../lib/koDom');
var kf = require('../lib/koForm');
var AceEditor = require('./AceEditor');
var {makeT} = require('app/client/lib/localization');

const t = makeT('ValidationPanel');

/**
 * Document level configuration settings.
 * @param {Object}    options.gristDoc   A reference to the GristDoc object
 * @param {Function}  docName            A knockout observable containing a String
 */
function ValidationPanel(options) {
  this.gristDoc = options.gristDoc;

  this.validationsTable = this.gristDoc.docModel.validations;
  this.validations = this.autoDispose(this.validationsTable.createAllRowsModel('id'));

  this.docTables = this.autoDispose(
    this.gristDoc.docModel.tables.createAllRowsModel('tableId'));

  this.tableChoices = this.autoDispose(this.docTables.map(function(table) {
    return { label: table.tableId, value: table.id() };
  }));
}
dispose.makeDisposable(ValidationPanel);


ValidationPanel.prototype.onAddRule = function() {
  this.validationsTable.sendTableAction(["AddRecord", null, {
    tableRef: this.docTables.at(0).id(),
    name: t("Rule {{length}}", {length: this.validations.peekLength + 1}),
    formula: ""
  }])
  .then(function() {
    $('.validation_formula').last().find("input").focus();
  });
};

ValidationPanel.prototype.onDeleteRule = function(rowId) {
  this.validationsTable.sendTableAction(["RemoveRecord", rowId]);
};

ValidationPanel.prototype.buildDom = function() {
  return [
    kf.row(
      1, kf.label('Validations'),
      1, kf.buttonGroup(
        kf.button(this.onAddRule.bind(this), 'Add Rule', dom.testId("Validation_addRule"))
      )
    ),
    dom('div',
      dom.testId("Validation_rules"),
      kd.foreach(this.validations, validation => {
        var editor = AceEditor.create({ observable: validation.formula });
        var editorUpToDate = ko.observable(true);
        return dom('div.validation',
          dom.autoDispose(editor),
          dom('div.validation_title.flexhbox',
            dom('div.validation_name', kf.editableLabel(validation.name)),
            dom('div.flexitem'),
            dom('div.validation_trash.glyphicon.glyphicon-remove',
              dom.on('click', this.onDeleteRule.bind(this, validation.id()))
            )
          ),
          kf.row(
            1, dom('div.glyphicon.glyphicon-tag.config_icon'),
            8, kf.label('Table'),
            9, kf.select(validation.tableRef, this.tableChoices)
          ),
          dom('div.kf_elem.validation_formula', editor.buildDom(aceObj => {
            editor.attachSaveCommand();
            aceObj.on('change', () => {
              // Monitor whether the value mismatch is reflected by editorDiff
              if ((editor.getValue() === validation.formula()) !== editorUpToDate()) {
                editorUpToDate(!editorUpToDate());
              }
            });
            aceObj.removeAllListeners('blur');
          })),
          kf.row(
            2, '',
            1, kf.buttonGroup(
              kf.button(() => editor.writeObservable(),
                'Apply', { title: t("Update formula (Shift+Enter)")},
                kd.toggleClass('disabled', editorUpToDate)
              )
            )
          )
        );
      })
    )
  ];
};

module.exports = ValidationPanel;
