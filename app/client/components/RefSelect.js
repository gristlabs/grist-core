var _           = require('underscore');
var ko          = require('knockout');
var Promise     = require('bluebird');
var koArray     = require('../lib/koArray');
var dispose     = require('../lib/dispose');
var tableUtil   = require('../lib/tableUtil');
var gutil       = require('app/common/gutil');
const {colors, testId} = require('app/client/ui2018/cssVars');
const {cssFieldEntry, cssFieldLabel} = require('app/client/ui/VisibleFieldsConfig');
const {dom, fromKo, styled} = require('grainjs');
const {icon} = require('app/client/ui2018/icons');
const {menu, menuItem, menuText} = require('app/client/ui2018/menus');

/**
 * Builder for the reference display multiselect.
 */
function RefSelect(options) {
  this.docModel        = options.docModel;
  this.origColumn      = options.origColumn;
  this.colId           = this.origColumn.colId;

  // Indicates whether this is a ref col that references a different table.
  // (That's the only time when RefSelect is offered.)
  this.isForeignRefCol = this.autoDispose(ko.computed(() => {
    const t = this.origColumn.refTable();
    return Boolean(t && t.getRowId() !== this.origColumn.parentId());
  }));

  // Computed for the current fieldBuilder's field, if it exists.
  this.fieldObs = this.autoDispose(ko.computed(() => {
    let builder = options.fieldBuilder();
    return builder ? builder.field : null;
  }));

  // List of valid cols in the currently referenced table.
  this._validCols = this.autoDispose(ko.computed(() => {
    var refTable = this.origColumn.refTable();
    if (refTable) {
      return refTable.columns().all().filter(col => !col.isHiddenCol() &&
        !gutil.startsWith(col.type(), 'Ref:'));
    }
    return [];
  }));

  // Returns the array of columns added to the multiselect. Used as a helper to create a synced KoArray.
  var _addedObs = this.autoDispose(ko.computed(() => {
    return this.isForeignRefCol() && this.fieldObs() ?
      this._getReferencedCols().map(c => ({ label: c.label(), value: c.colId() })) : [];
  }));

  // KoArray of columns displaying data from the referenced table in the current section.
  this._added = this.autoDispose(koArray.syncedKoArray(_addedObs));

  // Set of added colIds.
  this._addedSet = this.autoDispose(ko.computed(() => new Set(this._added.all().map(item => item.value))));
}
dispose.makeDisposable(RefSelect);


/**
 * Builds the multiselect dom to select columns to added to the table to show data from the
 * referenced table.
 */
RefSelect.prototype.buildDom = function() {
  return cssFieldList(
    testId('ref-select'),
    dom.forEach(fromKo(this._added), (col) =>
      cssFieldEntry(
        cssFieldLabel(dom.text(col.label)),
        cssRemoveIcon('Remove',
          dom.on('click', () => this._removeFormulaField(col)),
          testId('ref-select-remove'),
        ),
        testId('ref-select-item'),
      )
    ),
    cssAddLink(cssAddIcon('Plus'), 'Add Column',
      menu(() => [
        ...this._validCols.peek()
        .filter((col) => !this._addedSet.peek().has(col.colId.peek()))
        .map((col) =>
          menuItem(() => this._addFormulaField({label: col.label(), value: col.colId()}),
            col.label.peek())
        ),
        cssEmptyMenuText("No columns to add"),
        testId('ref-select-menu'),
      ]),
      testId('ref-select-add'),
    ),
  );
};

const cssFieldList = styled('div', `
  display: flex;
  flex-direction: column;
  width: 100%;

  & > .${cssFieldEntry.className} {
    margin: 2px 0;
  }
`);

const cssEmptyMenuText = styled(menuText, `
  font-size: inherit;
  &:not(:first-child) {
    display: none;
  }
`);

const cssAddLink = styled('div', `
  display: flex;
  cursor: pointer;
  color: ${colors.lightGreen};
  --icon-color: ${colors.lightGreen};

  &:not(:first-child) {
    margin-top: 8px;
  }
  &:hover, &:focus, &:active {
    color: ${colors.darkGreen};
    --icon-color: ${colors.darkGreen};
  }
`);

const cssAddIcon = styled(icon, `
  margin-right: 4px;
`);

const cssRemoveIcon = styled(icon, `
  display: none;
  cursor: pointer;
  flex: none;
  margin-left: 8px;
  .${cssFieldEntry.className}:hover & {
    display: block;
  }
`);

/**
 * Adds the column item to the multiselect. If the visibleCol is 'id', sets the visibleCol.
 * Otherwise, adds a field which refers to the column to the table. If a column with the
 * necessary formula exists, only adds a field to this section, otherwise adds the necessary
 * column and field.
 */
RefSelect.prototype._addFormulaField = function(item) {
  var field = this.fieldObs();
  var tableData = this.docModel.dataTables[this.origColumn.table().tableId()].tableData;
  // Check if column already exists in the table
  var cols = this.origColumn.table().columns().all();
  var colMatch = cols.find(c => c.formula() === `$${this.colId()}.${item.value}` && !c.isHiddenCol());
  // Get field position, so that the new field is inserted just after the current field.
  var fields = field.viewSection().viewFields();
  var index = fields.all()
    .sort((a, b) => a.parentPos() > b.parentPos() ? a : b)
    .findIndex(f => f.getRowId() === field.getRowId());
  var pos = tableUtil.fieldInsertPositions(fields, index + 1)[0];
  var colAction;
  if (colMatch) {
    // If column exists, use it.
    colAction = Promise.resolve({ colRef: colMatch.getRowId(), colId: colMatch.colId() });
  } else {
    // If column doesn't exist, add it (without fields).
    colAction = tableData.sendTableAction(['AddHiddenColumn', `${this.colId()}_${item.value}`, {
      type: 'Any',
      isFormula: true,
      formula: `$${this.colId()}.${item.value}`,
      _position: pos
    }]);
  }
  return colAction.then(colInfo => {
    // Add field to the current section.
    var fieldInfo = {
      colRef: colInfo.colRef,
      parentId: field.viewSection().getRowId(),
      parentPos: pos
    };
    return this.docModel.viewFields.sendTableAction(['AddRecord', null, fieldInfo]);
  });
};

/**
 * Removes the column item from the multiselect. If the item is the visibleCol, clears to show
 * row id. Otherwise, removes all fields which refer to the column from the table.
 */
RefSelect.prototype._removeFormulaField = function(item) {
  var tableData = this.docModel.dataTables[this.origColumn.table().tableId()].tableData;
  // Iterate through all display fields in the current section.
  this._getReferrerFields(item.value).forEach(refField => {
    var sectionId = this.fieldObs().viewSection().getRowId();
    if (_.any(refField.column().viewFields().all(), field => field.parentId() !== sectionId)) {
      // The col has fields in other sections, remove only the fields in this section.
      this.docModel.viewFields.sendTableAction(['RemoveRecord', refField.getRowId()]);
    } else {
      // The col is only displayed in this section, remove the column.
      tableData.sendTableAction(['RemoveColumn', refField.column().colId()]);
    }
  });
};

/**
 * Returns a list of fields in the current section whose formulas refer to 'colId' in the table this
 * reference column refers to.
 */
RefSelect.prototype._getReferrerFields = function(colId) {
  var re = new RegExp("^\\$" + this.colId() + "\\." + colId + "$");
  return this.fieldObs().viewSection().viewFields().all()
    .filter(field => re.exec(field.column().formula()));
};

/**
 * Returns a non-repeating list of columns in the referenced table referred to by fields in
 * the current section.
 */
RefSelect.prototype._getReferencedCols = function() {
  var matchesSet = this._getFormulaMatchSet();
  return this._validCols().filter(c => matchesSet.has(c.colId()));
};

/**
 * Helper function for getReferencedCols. Iterates through fields in
 * the current section, returning a set of colIds which those fields' formulas refer to.
 */
RefSelect.prototype._getFormulaMatchSet = function() {
  var fields = this.fieldObs().viewSection().viewFields().all();
  var re = new RegExp("^\\$" + this.colId() + "\\.(\\w+)$");
  return new Set(fields.map(field => {
    var found = re.exec(field.column().formula());
    return found ? found[1] : null;
  }));
};

module.exports = RefSelect;
