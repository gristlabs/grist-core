var dispose = require('../lib/dispose');
var _ = require('underscore');
var TextEditor = require('./TextEditor');


function CheckBoxEditor(options) {
  TextEditor.call(this, options);
}
dispose.makeDisposable(CheckBoxEditor);
_.extend(CheckBoxEditor.prototype, TextEditor.prototype);

// For documentation, see NewBaseEditor.ts
CheckBoxEditor.skipEditor = function(typedVal, cellVal) {
  if (typedVal === ' ') {
    // This is a special case when user hits <space>. We return the toggled value to save, and by
    // this indicate that the editor should not open.
    return !cellVal;
  }
}

// For documentation, see NewBaseEditor.ts
CheckBoxEditor.supportsReadonly = function() { return false; }

module.exports = CheckBoxEditor;
