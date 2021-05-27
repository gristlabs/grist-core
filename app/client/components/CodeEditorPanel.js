var _              = require('underscore');
var ko             = require('knockout');
var BackboneEvents = require('backbone').Events;

var dispose        = require('../lib/dispose');
var dom            = require('../lib/dom');
var kd             = require('../lib/koDom');

// Rather than require the whole of highlight.js, require just the core with the one language we
// need, to keep our bundle smaller and the build faster.
var hljs           = require('highlight.js/lib/highlight');
hljs.registerLanguage('python', require('highlight.js/lib/languages/python'));

function CodeEditorPanel(gristDoc) {
  this._gristDoc = gristDoc;
  this._schema = ko.observable('');
  this._denied = ko.observable(false);

  this.listenTo(this._gristDoc, 'schemaUpdateAction', this.onSchemaAction);
  this.onSchemaAction(); // Fetch the schema to initialize
}
dispose.makeDisposable(CodeEditorPanel);
_.extend(CodeEditorPanel.prototype, BackboneEvents);

CodeEditorPanel.prototype.buildDom = function() {
  // The tabIndex enables the element to gain focus, and the .clipboard class prevents the
  // Clipboard module from re-grabbing it. This is a quick fix for the issue where clipboard
  // interferes with text selection. TODO it should be possible for the Clipboard to never
  // interfere with text selection even for un-focusable elements.
  return dom('div.g-code-panel.clipboard',
    {tabIndex: "-1"},
    kd.maybe(this._denied, () => dom('div.g-code-panel-denied',
      dom('h2', kd.text('Access denied')),
      dom('div', kd.text('Code View is available only when you have full document access.')),
    )),
    kd.scope(this._schema, function(schema) {
      // The reason to scope and rebuild instead of using `kd.text(schema)` is because
      // hljs.highlightBlock(elem) replaces `elem` with a whole new dom tree.
      if (!schema) { return null; }
      return dom(
        'code.g-code-viewer.python',
        schema,
        dom.hide,
        dom.defer(function(elem) {
          hljs.highlightBlock(elem);
          dom.show(elem);
        })
      );
    })
  );
};

CodeEditorPanel.prototype.onSchemaAction = async function(actions) {
  try {
    const schema = await this._gristDoc.docComm.fetchTableSchema();
    if (!this.isDisposed()) {
      this._schema(schema);
      this._denied(false);
    }
  } catch (err) {
    if (!String(err).match(/Cannot view code/)) {
      throw err;
    }
    if (!this.isDisposed()) {
      this._schema('');
      this._denied(true);
    }
  }
};

module.exports = CodeEditorPanel;
