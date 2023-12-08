var dispose = require('../lib/dispose');
var _ = require('underscore');
var TextEditor = require('./TextEditor');


function CheckBoxEditor(options) {
  TextEditor.call(this, options);
}
dispose.makeDisposable(CheckBoxEditor);
_.extend(CheckBoxEditor.prototype, TextEditor.prototype);

// For documentation, see NewBaseEditor.ts
CheckBoxEditor.skipEditor = function(typedVal, cellVal, {event}) {
  // eslint-disable-next-line no-undef
  if (typedVal === '<enter>' || (event && event instanceof KeyboardEvent)) {
    // This is a special case when user hits <enter>. We return the toggled value to save, and by
    // this indicate that the editor should not open.
    return !cellVal;
  }
}

// For documentation, see NewBaseEditor.ts
CheckBoxEditor.supportsReadonly = function() { return false; }

module.exports = CheckBoxEditor;
