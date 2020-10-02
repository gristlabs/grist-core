var _ = require('underscore');
var dispose = require('../lib/dispose');
var TextEditor = require('./TextEditor');

const {autocomplete} = require('app/client/ui2018/menus');

/**
 * ChoiceEditor - TextEditor with a dropdown for possible choices.
 */
function ChoiceEditor(options) {
  TextEditor.call(this, options);

  this.choices = options.field.widgetOptionsJson.peek().choices || [];

  // Add autocomplete if there are any choices to select from
  if (this.choices.length > 0) {

    autocomplete(this.textInput, this.choices, {
      allowNothingSelected: true,
      onClick: () => this.options.commands.fieldEditSave(),
    });
  }
}
dispose.makeDisposable(ChoiceEditor);
_.extend(ChoiceEditor.prototype, TextEditor.prototype);

module.exports = ChoiceEditor;
