var commands = require('../components/commands');
var dispose = require('../lib/dispose');
var kd = require('../lib/koDom');
var _ = require('underscore');
var TextBox = require('./TextBox');

const {fromKoSave} = require('app/client/lib/fromKoSave');
const {ListEntry} = require('app/client/lib/listEntry');
const {alignmentSelect} = require('app/client/ui2018/buttonSelect');
const {colors, testId} = require('app/client/ui2018/cssVars');
const {icon} = require('app/client/ui2018/icons');
const {menu, menuItem} = require('app/client/ui2018/menus');
const {cssLabel, cssRow} = require('app/client/ui/RightPanel');
const {dom, Computed, styled} = require('grainjs');

/**
 * ChoiceTextBox - A textbox for choice values.
 */
function ChoiceTextBox(field) {
  TextBox.call(this, field);

  this.docData = field._table.docModel.docData;
  this.colId = field.column().colId;
  this.tableId = field.column().table().tableId;

  this.choices = this.options.prop('choices');
  this.choiceValues = Computed.create(this, (use) => use(this.choices) || [])
}
dispose.makeDisposable(ChoiceTextBox);
_.extend(ChoiceTextBox.prototype, TextBox.prototype);


ChoiceTextBox.prototype.buildDom = function(row) {
  let value = row[this.field.colId()];
  return cssChoiceField(
    cssChoiceText(
      kd.style('text-align', this.alignment),
      kd.text(() => row._isAddRow() ? '' : this.valueFormatter().format(value())),
    ),
    cssDropdownIcon('Dropdown',
      // When choices exist, click dropdown icon to open edit autocomplete.
      dom.on('click', () => this._hasChoices() && commands.allCommands.editField.run()),
      // When choices do not exist, open a single-item menu to open the sidepane choice option editor.
      menu(() => [
        menuItem(commands.allCommands.fieldTabOpen.run, 'Add Choice Options')
      ], {
        trigger: [(elem, ctl) => {
          // Only open this menu if there are no choices.
          dom.onElem(elem, 'click', () => this._hasChoices() || ctl.open());
        }]
      }),
      testId('choice-dropdown')
    )
  );
};

ChoiceTextBox.prototype.buildConfigDom = function() {
  return [
    cssRow(
      alignmentSelect(fromKoSave(this.alignment))
    ),
    cssLabel('OPTIONS'),
    cssRow(
      dom.create(ListEntry, this.choiceValues, (values) => this.choices.saveOnly(values))
    )
  ];
};

ChoiceTextBox.prototype.buildTransformConfigDom = function() {
  return this.buildConfigDom();
};

ChoiceTextBox.prototype._hasChoices = function() {
  return this.choiceValues.get().length > 0;
};

const cssChoiceField = styled('div.field_clip', `
  display: flex;
  justify-content: space-between;
`);

const cssChoiceText = styled('div', `
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
`);

const cssDropdownIcon = styled(icon, `
  cursor: pointer;
  background-color: ${colors.lightGreen};
  min-width: 16px;
  width: 16px;
  height: 16px;
`);

module.exports = ChoiceTextBox;
