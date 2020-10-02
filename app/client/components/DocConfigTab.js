var dispose = require('../lib/dispose');
var dom = require('../lib/dom');
var ValidationPanel = require('./ValidationPanel');

/**
 * Document level configuration settings.
 * @param {Object}    options.gristDoc   A reference to the GristDoc object
 * @param {Function}  docName            A knockout observable containing a String
 */
function DocConfigTab(options, docName) {
  this.gristDoc = options.gristDoc;

  // Panel to configure validation rules.
  this.validationPanel = this.autoDispose(ValidationPanel.create({gristDoc: this.gristDoc}));

  this.autoDispose(
    this.gristDoc.addOptionsTab(
      'Validate Data',
      dom('span.glyphicon.glyphicon-check'),
      this.buildValidationsConfigDomObj(),
      { 'shortLabel': 'Valid' }
    )
  );
}
dispose.makeDisposable(DocConfigTab);

DocConfigTab.prototype.buildValidationsConfigDomObj = function() {
  return [{
    'buildDom': this.validationPanel.buildDom.bind(this.validationPanel),
    'keywords': ['document', 'validations', 'rules', 'validate']
  }];
};

module.exports = DocConfigTab;
