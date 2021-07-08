var _ = require('underscore');
var dispose = require('../lib/dispose');
var TextEditor = require('./TextEditor');

const {Autocomplete} = require('app/client/lib/autocomplete');
const {ACIndexImpl, buildHighlightedDom} = require('app/client/lib/ACIndex');
const {ChoiceItem, cssChoiceList, cssItem, cssItemLabel, cssMatchText} = require('app/client/widgets/ChoiceListEditor');
const {cssRefList} = require('app/client/widgets/ReferenceEditor');
const {getFillColor, getTextColor} = require('app/client/widgets/ChoiceTextBox');
const {menuCssClass} = require('app/client/ui2018/menus');
const {testId} = require('app/client/ui2018/cssVars');
const {dom} = require('grainjs');

/**
 * ChoiceEditor - TextEditor with a dropdown for possible choices.
 */
function ChoiceEditor(options) {
  TextEditor.call(this, options);

  this.choices = options.field.widgetOptionsJson.peek().choices || [];
  this.choiceOptions = options.field.widgetOptionsJson.peek().choiceOptions || {};
}

dispose.makeDisposable(ChoiceEditor);
_.extend(ChoiceEditor.prototype, TextEditor.prototype);

ChoiceEditor.prototype.getCellValue = function() {
  const selectedItem = this.autocomplete && this.autocomplete.getSelectedItem();
  return selectedItem ? selectedItem.label : TextEditor.prototype.getCellValue.call(this);
}

ChoiceEditor.prototype.renderACItem = function(item, highlightFunc) {
  const options = this.choiceOptions[item.label];
  const fillColor = getFillColor(options);
  const textColor = getTextColor(options);

  return cssItem(
    cssItemLabel(
      buildHighlightedDom(item.label, highlightFunc, cssMatchText),
      dom.style('background-color', fillColor),
      dom.style('color', textColor),
      testId('choice-editor-item-label')
    ),
    testId('choice-editor-item'),
  );
}

ChoiceEditor.prototype.attach = function(cellElem) {
  TextEditor.prototype.attach.call(this, cellElem);
  // Don't create autocomplete if readonly, or if there are no choices.
  if (this.options.readonly || this.choices.length === 0) { return; }

  const acItems = this.choices.map(c => new ChoiceItem(c, false));
  const acIndex = new ACIndexImpl(acItems);
  const acOptions = {
    popperOptions: {
      placement: 'bottom'
    },
    menuCssClass: menuCssClass + ' ' + cssRefList.className + ' ' + cssChoiceList.className + ' test-autocomplete',
    search: (term) => acIndex.search(term),
    renderItem: (item, highlightFunc) => this.renderACItem(item, highlightFunc),
    getItemText: (item) => item.label,
    onClick: () => this.options.commands.fieldEditSave(),
  };

  this.autocomplete = Autocomplete.create(this, this.textInput, acOptions);
}

module.exports = ChoiceEditor;
