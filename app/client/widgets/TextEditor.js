var _ = require('underscore');
var gutil = require('app/common/gutil');
var dom = require('../lib/dom');
var kd = require('../lib/koDom');
var dispose = require('../lib/dispose');
var BaseEditor = require('./BaseEditor');
var commands = require('../components/commands');
const {testId} = require('app/client/ui2018/cssVars');
const {createMobileButtons, getButtonMargins} = require('app/client/widgets/EditorButtons');
const {EditorPlacement} = require('app/client/widgets/EditorPlacement');
const {observable} = require('grainjs');

/**
 * Required parameters:
 * @param {RowModel} options.field: ViewSectionField (i.e. column) being edited.
 * @param {Object} options.cellValue: The value in the underlying cell being edited.
 * @param {String} options.editValue: String to be edited, or undefined to use cellValue.
 * @param {Number} options.cursorPos: The initial position where to place the cursor.
 * @param {Object} options.commands: Object mapping command names to functions, to enable as part
 *  of the command group that should be activated while the editor exists.
 *
 * Optional parameters:
 * @param {String} options.placeholder: Optional placeholder for the textarea.
 *
 * TextEditor exposes the following members, which derived classes may use:
 * @member {Object} this.options: Options as passed into the constructor.
 * @member {Node} this.dom: The DOM element for the editor.
 * @member {Node} this.textInput: The textarea element of the editor (contained within this.dom).
 * @member {Object} this.commandGroup: The CommandGroup created from options.commands.
 */
function TextEditor(options) {
  this.options = options;
  this.commandGroup = this.autoDispose(commands.createGroup(options.commands, null, true));
  this._alignment = options.field.widgetOptionsJson.peek().alignment || 'left';
  // calculate initial value (state, requested edited value or a current cell value)
  const initialValue = gutil.undef(options.state, options.editValue, String(options.cellValue == null ? "" : options.cellValue));
  // create observable with current state
  this.editorState = this.autoDispose(observable(initialValue));

  this.dom = dom('div.default_editor',
    kd.toggleClass("readonly_editor", options.readonly),
    this.cellEditorDiv = dom('div.celleditor_cursor_editor', dom.testId('TextEditor_editor'),
      testId('widget-text-editor'),   // new-style testId matches NTextEditor, for more uniform tests.
      this.contentSizer = dom('div.celleditor_content_measure'),
      this.textInput = dom('textarea.celleditor_text_editor',
        kd.attr('placeholder', options.placeholder || ''),
        kd.style('text-align', this._alignment),
        kd.boolAttr('readonly', options.readonly),
        kd.value(initialValue),
        this.commandGroup.attach(),

        // Resize the textbox whenever user types in it.
        dom.on('input', () => this.onChange())
      )
    ),
    createMobileButtons(options.commands),
  );
}

dispose.makeDisposable(TextEditor);
_.extend(TextEditor.prototype, BaseEditor.prototype);

TextEditor.prototype.attach = function(cellElem) {
  // Attach the editor dom to page DOM.
  this.editorPlacement = EditorPlacement.create(this, this.dom, cellElem, {margins: getButtonMargins()});

  // Reposition the editor if needed for external reasons (in practice, window resize).
  this.autoDispose(this.editorPlacement.onReposition.addListener(this._resizeInput, this));

  this.setSizerLimits();

  // Once the editor is attached to DOM, resize it to content, focus, and set cursor.
  this._resizeInput();
  this.textInput.focus();
  var pos = Math.min(this.options.cursorPos, this.textInput.value.length);
  this.textInput.setSelectionRange(pos, pos);
};

TextEditor.prototype.getDom = function() {
  return this.dom;
};

TextEditor.prototype.setSizerLimits = function() {
  // Set the max width of the sizer to the max we could possibly grow to, so that it knows to wrap
  // once we reach it.
  const maxSize = this.editorPlacement.calcSizeWithPadding(this.textInput,
    {width: Infinity, height: Infinity}, {calcOnly: true});
  this.contentSizer.style.maxWidth = Math.ceil(maxSize.width) + 'px';
};

TextEditor.prototype.getCellValue = function() {
  return this.textInput.value;
};

TextEditor.prototype.onChange = function() {
  if (this.editorState)
    this.editorState.set(this.getTextValue());
  this._resizeInput()
}

TextEditor.prototype.getTextValue = function() {
  return this.textInput.value;
};

TextEditor.prototype.getCursorPos = function() {
  return this.textInput.selectionStart;
};

/**
 * Helper which resizes textInput to match its content. It relies on having a contentSizer element
 * with the same font/size settings as the textInput, and on having `calcSize` helper,
 * which is provided by the EditorPlacement class.
 */
TextEditor.prototype._resizeInput = function() {
  var textInput = this.textInput;
  // \u200B is a zero-width space; it is used so the textbox will expand vertically
  // on newlines, but it does not add any width.
  this.contentSizer.textContent = textInput.value + '\u200B';
  var rect = this.contentSizer.getBoundingClientRect();

  // Allow for a bit of extra space after the cursor (only desirable when text is left-aligned).
  if (this._alignment === 'left') {
    rect.width += 16;
  }

  var size = this.editorPlacement.calcSizeWithPadding(textInput, rect);
  textInput.style.width = size.width + 'px';
  textInput.style.height = size.height + 'px';
};

module.exports = TextEditor;
