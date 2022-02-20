/**
 * Required parameters:
 * @param {RowModel} options.field: ViewSectionField (i.e. column) being edited.
 * @param {Object} options.cellValue: The value in the underlying cell being edited.
 * @param {String} options.editValue: String to be edited, or undefined to use cellValue.
 * @param {Number} options.cursorPos: The initial position where to place the cursor.
 * @param {Object} options.commands: Object mapping command names to functions, to enable as part
 *  of the command group that should be activated while the editor exists.
 */
function BaseEditor(options) {
}

/**
 * Called after the editor is instantiated to attach its DOM to the page.
 * - cellElem: The element representing the cell that this editor should match
 *   in size and position. Used by derived classes, e.g. to construct an EditorPlacement object.
 */
BaseEditor.prototype.attach = function(cellElem) {
  // No-op by default.
};

/**
 * Returns DOM container with the editor, typically present and attached after attach() has been
 * called.
 */
BaseEditor.prototype.getDom = function() {
  return null;
};

/**
 * Called to get the value to save back to the cell.
 */
BaseEditor.prototype.getCellValue = function() {
  throw new Error("Not Implemented");
};

/**
 * Used if an editor needs perform any actions before a save
 */
BaseEditor.prototype.prepForSave = function() {
  // No-op by default.
};

/**
 * Called to get the text in the editor, used when switching between editing data and formula.
 */
BaseEditor.prototype.getTextValue = function() {
  throw new Error("Not Implemented");
};

/**
 * Called to get the position of the cursor in the editor. Used when switching between editing
 * data and formula.
 */
BaseEditor.prototype.getCursorPos = function() {
  throw new Error("Not Implemented");
};

module.exports = BaseEditor;
