const {NTextBox} = require('./NTextBox');
const {NumericTextBox} = require('./NumericTextBox');
const {Spinner} = require('./Spinner');
const {AttachmentsWidget} = require('./AttachmentsWidget');
const {AttachmentsEditor} = require('./AttachmentsEditor');
const UserType = require('./UserType');
const {HyperLinkEditor} = require('./HyperLinkEditor');
const {NTextEditor} = require('./NTextEditor');
const {ReferenceEditor} = require('./ReferenceEditor');

/**
 * Convert the name of a widget to its implementation.
 */
const nameToWidget = {
  'TextBox': NTextBox,
  'TextEditor': NTextEditor,
  'NumericTextBox': NumericTextBox,
  'HyperLinkTextBox': require('./HyperLinkTextBox'),
  'HyperLinkEditor': HyperLinkEditor,
  'Spinner': Spinner,
  'CheckBox': require('./CheckBox'),
  'CheckBoxEditor': require('./CheckBoxEditor'),
  'Reference': require('./Reference'),
  'Switch': require('./Switch'),
  'ReferenceEditor': ReferenceEditor,
  'ChoiceTextBox': require('./ChoiceTextBox'),
  'ChoiceEditor': require('./ChoiceEditor'),
  'DateTimeTextBox': require('./DateTimeTextBox'),
  'DateTextBox': require('./DateTextBox'),
  'DateEditor': require('./DateEditor'),
  'AttachmentsWidget': AttachmentsWidget,
  'AttachmentsEditor': AttachmentsEditor,
  'DateTimeEditor': require('./DateTimeEditor'),
};

exports.nameToWidget = nameToWidget;

/** return a good class to instantiate for viewing a widget/type combination */
function getWidgetConstructor(widget, type) {
  const {config} = UserType.getWidgetConfiguration(widget, type);
  return nameToWidget[config.cons];
}
exports.getWidgetConstructor = getWidgetConstructor;

/** return a good class to instantiate for editing a widget/type combination */
function getEditorConstructor(widget, type) {
  const {config} = UserType.getWidgetConfiguration(widget, type);
  return nameToWidget[config.editCons];
}
exports.getEditorConstructor = getEditorConstructor;
