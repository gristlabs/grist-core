var _ = require('underscore');
var dispose = require('app/client/lib/dispose');
var TextEditor = require('app/client/widgets/TextEditor');

const {Autocomplete} = require('app/client/lib/autocomplete');
const {ACIndexImpl, buildHighlightedDom} = require('app/client/lib/ACIndex');
const {makeT} = require('app/client/lib/localization');
const {
  buildDropdownConditionFilter,
  ChoiceItem,
  cssChoiceList,
  cssMatchText,
  cssPlusButton,
  cssPlusIcon,
} = require('app/client/widgets/ChoiceListEditor');
const {icon} = require('app/client/ui2018/icons');
const {menuCssClass} = require('app/client/ui2018/menus');
const {testId, theme} = require('app/client/ui2018/cssVars');
const {choiceToken, cssChoiceACItem} = require('app/client/widgets/ChoiceToken');
const {dom, styled} = require('grainjs');

const t = makeT('ChoiceEditor');

/**
 * ChoiceEditor - TextEditor with a dropdown for possible choices.
 */
function ChoiceEditor(options) {
  TextEditor.call(this, options);

  this.widgetOptionsJson = options.field.widgetOptionsJson;
  this.choices = this.widgetOptionsJson.peek().choices || [];
  this.choicesSet = new Set(this.choices);
  this.choiceOptions = this.widgetOptionsJson.peek().choiceOptions || {};

  this.hasDropdownCondition = Boolean(options.field.dropdownCondition.peek()?.text);
  this.dropdownConditionError;

  let acItems = this.choices.map(c => new ChoiceItem(c, false, false));
  if (this.hasDropdownCondition) {
    try {
      const dropdownConditionFilter = this.buildDropdownConditionFilter();
      acItems = acItems.filter((item) => dropdownConditionFilter(item));
    } catch (e) {
      acItems = [];
      this.dropdownConditionError = e.message;
    }
  }

  const acIndex = new ACIndexImpl(acItems);
  this._acOptions = {
    popperOptions: {
      placement: 'bottom'
    },
    menuCssClass: `${menuCssClass} ${cssChoiceList.className} test-autocomplete`,
    buildNoItemsMessage: this.buildNoItemsMessage.bind(this),
    search: (term) => this.maybeShowAddNew(acIndex.search(term), term),
    renderItem: (item, highlightFunc) => this.renderACItem(item, highlightFunc),
    getItemText: (item) => item.label,
    onClick: () => this.options.commands.fieldEditSave(),
  };

  if (!options.readonly && options.field.viewSection().parentKey() === "single") {
    this.cellEditorDiv.classList.add(cssChoiceEditor.className);
    this.cellEditorDiv.appendChild(cssChoiceEditIcon('Dropdown'));
  }

  // Whether to include a button to show a new choice.
  // TODO: Disable when the user cannot change column configuration.
  this.enableAddNew = !this.hasDropdownCondition;
}

dispose.makeDisposable(ChoiceEditor);
_.extend(ChoiceEditor.prototype, TextEditor.prototype);

ChoiceEditor.prototype.getCellValue = function() {
  const selectedItem = this.autocomplete && this.autocomplete.getSelectedItem();
  if (selectedItem) {
    return selectedItem.label;
  } else if (this.textInput.value.trim() === '') {
    return '';
  } else {
    return TextEditor.prototype.getCellValue.call(this);
  }
}

ChoiceEditor.prototype.renderACItem = function(item, highlightFunc) {
  const options = this.choiceOptions[item.label];

  return cssChoiceACItem(
    (item.isNew ?
      [cssChoiceACItem.cls('-new'), cssPlusButton(cssPlusIcon('Plus')), testId('choice-editor-new-item')] :
      [cssChoiceACItem.cls('-with-new', this.showAddNew)]
    ),
    choiceToken(
      buildHighlightedDom(item.label, highlightFunc, cssMatchText),
      options || {},
      dom.style('max-width', '100%'),
      testId('choice-editor-item-label')
    ),
    testId('choice-editor-item'),
  );
}

ChoiceEditor.prototype.attach = function(cellElem) {
  TextEditor.prototype.attach.call(this, cellElem);
  // Don't create autocomplete if readonly.
  if (this.options.readonly) { return; }

  this.autocomplete = Autocomplete.create(this, this.textInput, this._acOptions);
}

/**
 * Updates list of valid choices with any new ones that may have been
 * added from directly inside the editor (via the "add new" item in autocomplete).
 */
ChoiceEditor.prototype.prepForSave = async function() {
  const selectedItem = this.autocomplete && this.autocomplete.getSelectedItem();
  if (selectedItem && selectedItem.isNew) {
    const choices = this.widgetOptionsJson.prop('choices');
    await choices.saveOnly([...(choices.peek() || []), selectedItem.label]);
  }
}

ChoiceEditor.prototype.buildDropdownConditionFilter = function() {
  const dropdownConditionCompiled = this.options.field.dropdownConditionCompiled.get();
  if (dropdownConditionCompiled?.kind !== 'success') {
    throw new Error('Dropdown condition is not compiled');
  }

  return buildDropdownConditionFilter({
    dropdownConditionCompiled: dropdownConditionCompiled.result,
    gristDoc: this.options.gristDoc,
    tableId: this.options.field.tableId(),
    rowId: this.options.rowId,
  });
}

ChoiceEditor.prototype.buildNoItemsMessage = function() {
  if (this.dropdownConditionError) {
    return t('Error in dropdown condition');
  } else if (this.hasDropdownCondition) {
    return t('No choices matching condition');
  } else {
    return t('No choices to select');
  }
}

/**
 * If the search text does not match anything exactly, adds 'new' item to it.
 *
 * Also see: prepForSave.
 */
ChoiceEditor.prototype.maybeShowAddNew = function(result, text) {
  // TODO: This logic is also mostly duplicated in ChoiceListEditor and ReferenceEditor.
  // See if there's anything common we can factor out and re-use.
  this.showAddNew = false;
  if (!this.enableAddNew) {
    return result;
  }

  const trimmedText = text.trim();
  if (!trimmedText || this.choicesSet.has(trimmedText)) {
    return result;
  }

  const addNewItem = new ChoiceItem(trimmedText, false, false, true);
  if (result.items.find((item) => item.cleanText === addNewItem.cleanText)) {
    return result;
  }

  result.extraItems.push(addNewItem);
  this.showAddNew = true;

  return result;
}

const cssChoiceEditIcon = styled(icon, `
  background-color: ${theme.lightText};
  position: absolute;
  top: 0;
  left: 0;
  margin: 3px 3px 0 3px;
`);

const cssChoiceEditor = styled('div', `
  & > .celleditor_text_editor, & > .celleditor_content_measure {
    padding-left: 18px;
  }
`);

module.exports = ChoiceEditor;
