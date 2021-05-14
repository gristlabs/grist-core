/**
 * This is a copy of TextEditor.js, converted to typescript.
 */
import {createGroup} from 'app/client/components/commands';
import {testId} from 'app/client/ui2018/cssVars';
import {createMobileButtons, getButtonMargins} from 'app/client/widgets/EditorButtons';
import {EditorPlacement} from 'app/client/widgets/EditorPlacement';
import {NewBaseEditor, Options} from 'app/client/widgets/NewBaseEditor';
import {CellValue} from "app/common/DocActions";
import {undefDefault} from 'app/common/gutil';
import {dom} from 'grainjs';


export class NTextEditor extends NewBaseEditor {
  protected cellEditorDiv: HTMLElement;
  protected textInput: HTMLTextAreaElement;
  protected commandGroup: any;

  private _dom: HTMLElement;
  private _editorPlacement: EditorPlacement;
  private _contentSizer: HTMLElement;
  private _alignment: string;

  // Note: TextEditor supports also options.placeholder for use by derived classes, but this is
  // easy to apply to this.textInput without needing a separate option.
  constructor(options: Options) {
    super(options);

    this.commandGroup = this.autoDispose(createGroup(options.commands, null, true));
    this._alignment = options.field.widgetOptionsJson.peek().alignment || 'left';
    this._dom = dom('div.default_editor',
      this.cellEditorDiv = dom('div.celleditor_cursor_editor', testId('widget-text-editor'),
        this._contentSizer = dom('div.celleditor_content_measure'),
        this.textInput = dom('textarea', dom.cls('celleditor_text_editor'),
          dom.style('text-align', this._alignment),
          dom.prop('value', undefDefault(options.editValue, String(options.cellValue ?? ""))),
          this.commandGroup.attach(),
          // Resize the textbox whenever user types in it.
          dom.on('input', () => this.resizeInput())
        )
      ),
      createMobileButtons(options.commands),
    );
  }

  public attach(cellElem: Element): void {
    // Attach the editor dom to page DOM.
    this._editorPlacement = EditorPlacement.create(this, this._dom, cellElem, {margins: getButtonMargins()});

    // Reposition the editor if needed for external reasons (in practice, window resize).
    this.autoDispose(this._editorPlacement.onReposition.addListener(this.resizeInput, this));

    this.setSizerLimits();

    // Once the editor is attached to DOM, resize it to content, focus, and set cursor.
    this.resizeInput();
    this.textInput.focus();
    const pos = Math.min(this.options.cursorPos, this.textInput.value.length);
    this.textInput.setSelectionRange(pos, pos);
  }

  public getDom(): HTMLElement {
    return this._dom;
  }

  public getCellValue(): CellValue {
    return this.textInput.value;
  }

  public getTextValue() {
    return this.textInput.value;
  }

  public getCursorPos() {
    return this.textInput.selectionStart;
  }

  public setSizerLimits() {
    // Set the max width of the sizer to the max we could possibly grow to, so that it knows to wrap
    // once we reach it.
    const maxSize = this._editorPlacement.calcSizeWithPadding(this.textInput,
      {width: Infinity, height: Infinity}, {calcOnly: true});
    this._contentSizer.style.maxWidth = Math.ceil(maxSize.width) + 'px';
  }

  /**
   * Helper which resizes textInput to match its content. It relies on having a contentSizer element
   * with the same font/size settings as the textInput, and on having `calcSize` helper,
   * which is provided by the EditorPlacement class.
   */
  protected resizeInput() {
    const textInput = this.textInput;
    // \u200B is a zero-width space; it is used so the textbox will expand vertically
    // on newlines, but it does not add any width.
    this._contentSizer.textContent = textInput.value + '\u200B';
    const rect = this._contentSizer.getBoundingClientRect();

    // Allow for a bit of extra space after the cursor (only desirable when text is left-aligned).
    if (this._alignment === "left") {
      // Modifiable in modern browsers: https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect
      rect.width += 16;
    }

    const size = this._editorPlacement.calcSizeWithPadding(textInput, rect);
    textInput.style.width = size.width + 'px';
    textInput.style.height = size.height + 'px';
  }
}
