import * as AceEditor from 'app/client/components/AceEditor';
import {createGroup} from 'app/client/components/commands';
import {DataRowModel} from 'app/client/models/DataRowModel';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {colors, testId} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {createMobileButtons, getButtonMargins} from 'app/client/widgets/EditorButtons';
import {EditorPlacement, ISize} from 'app/client/widgets/EditorPlacement';
import {NewBaseEditor, Options} from 'app/client/widgets/NewBaseEditor';
import {undef} from 'app/common/gutil';
import {Computed, dom, Observable, styled} from 'grainjs';
import {isRaisedException} from "app/common/gristTypes";
import {decodeObject, RaisedException} from "app/plugin/objtypes";

// How wide to expand the FormulaEditor when an error is shown in it.
const minFormulaErrorWidth = 400;

export interface IFormulaEditorOptions extends Options {
  cssClass?: string;
}


/**
 * Required parameters:
 * @param {RowModel} options.field: ViewSectionField (i.e. column) being edited.
 * @param {Object} options.cellValue: The value in the underlying cell being edited.
 * @param {String} options.editValue: String to be edited.
 * @param {Number} options.cursorPos: The initial position where to place the cursor.
 * @param {Object} options.commands: Object mapping command names to functions, to enable as part
 *  of the command group that should be activated while the editor exists.
 * @param {Boolean} options.omitBlurEventForObservableMode: Flag to indicate whether ace editor
 *  should save the value on `blur` event.
 */
export class FormulaEditor extends NewBaseEditor {
  private _formulaEditor: any;
  private _commandGroup: any;
  private _dom: HTMLElement;
  private _editorPlacement: EditorPlacement;

  constructor(options: IFormulaEditorOptions) {
    super(options);

    const initialValue = undef(options.state as string | undefined, options.editValue, String(options.cellValue));
    // create editor state observable (used by draft and latest position memory)
    this.editorState = Observable.create(this, initialValue);

    this._formulaEditor = AceEditor.create({
      // A bit awkward, but we need to assume calcSize is not used until attach() has been called
      // and _editorPlacement created.
      field: options.field,
      calcSize: this._calcSize.bind(this),
      gristDoc: options.gristDoc,
      saveValueOnBlurEvent: !options.readonly,
      editorState : this.editorState,
      readonly: options.readonly
    });

    const allCommands = !options.readonly
        ? Object.assign({ setCursor: this._onSetCursor }, options.commands)
        // for readonly mode don't grab cursor when clicked away - just move the cursor
        : options.commands;
    this._commandGroup = this.autoDispose(createGroup(allCommands, this, options.field.editingFormula));

    const hideErrDetails = Observable.create(this, true);
    const raisedException = Computed.create(this, use => {
      if (!options.formulaError) {
        return null;
      }
      const error = isRaisedException(use(options.formulaError)) ?
                    decodeObject(use(options.formulaError)) as RaisedException:
                    new RaisedException(["Unknown error"]);
      return error;
    });
    const errorText = Computed.create(this, raisedException, (_, error) => {
      if (!error) {
        return "";
      }
      return error.message ? `${error.name} : ${error.message}` : error.name;
    });
    const errorDetails = Computed.create(this, raisedException, (_, error) => {
      if (!error) {
        return "";
      }
      return error.details ?? "";
    });

    this.autoDispose(this._formulaEditor);
    this._dom = dom('div.default_editor',
      // switch border shadow
      dom.cls("readonly_editor", options.readonly),
      createMobileButtons(options.commands),
      options.cssClass ? dom.cls(options.cssClass) : null,

      // This shouldn't be needed, but needed for tests.
      dom.on('mousedown', (ev) => {
        ev.preventDefault();
        this._formulaEditor.getEditor().focus();
      }),
      dom('div.formula_editor.formula_field_edit', testId('formula-editor'),
        this._formulaEditor.buildDom((aceObj: any) => {
          aceObj.setFontSize(11);
          aceObj.setHighlightActiveLine(false);
          aceObj.getSession().setUseWrapMode(false);
          aceObj.renderer.setPadding(0);
          const val = initialValue;
          const pos = Math.min(options.cursorPos, val.length);
          this._formulaEditor.setValue(val, pos);
          this._formulaEditor.attachCommandGroup(this._commandGroup);

          // enable formula editing if state was passed
          if (options.state || options.readonly) {
            options.field.editingFormula(true);
          }
          if (options.readonly) {
            this._formulaEditor.enable(false);
            aceObj.gotoLine(0, 0); // By moving, ace editor won't highlight anything
          }
          // This catches any change to the value including e.g. via backspace or paste.
          aceObj.once("change", () => options.field.editingFormula(true));
        })
      ),
      (options.formulaError ?
        dom('div.error_box',
          dom('div.error_msg', testId('formula-error-msg'),
            dom.on('click', () => {
              if (errorDetails.get()){
                hideErrDetails.set(!hideErrDetails.get());
                this._formulaEditor.resize();
              }
            }),
            dom.maybe(errorDetails, () =>
              dom.domComputed(hideErrDetails, (hide) => cssCollapseIcon(hide ? 'Expand' : 'Collapse'))
            ),
            dom.text(errorText),
          ),
          dom.maybe(errorDetails, () =>
            dom('div.error_details',
              dom.hide(hideErrDetails),
              dom.text(errorDetails),
              testId('formula-error-details'),
            )
          )
        ) : null
      )
    );
  }

  public attach(cellElem: Element): void {
    this._editorPlacement = EditorPlacement.create(this, this._dom, cellElem, {margins: getButtonMargins()});
    // Reposition the editor if needed for external reasons (in practice, window resize).
    this.autoDispose(this._editorPlacement.onReposition.addListener(
      this._formulaEditor.resize, this._formulaEditor));
    this._formulaEditor.onAttach();
    this._formulaEditor.editor.focus();
  }

  public getDom(): HTMLElement {
    return this._dom;
  }

  public getCellValue() {
    return this._formulaEditor.getValue();
  }

  public getTextValue() {
    return this._formulaEditor.getValue();
  }

  public getCursorPos() {
    const aceObj = this._formulaEditor.getEditor();
    return aceObj.getSession().getDocument().positionToIndex(aceObj.getCursorPosition());
  }

  private _calcSize(elem: HTMLElement, desiredElemSize: ISize) {
    // If we have an error to show, ask for a larger size for formulaEditor.
    const desiredSize = {
      width: Math.max(desiredElemSize.width, (this.options.formulaError ? minFormulaErrorWidth : 0)),
      height: desiredElemSize.height,
    };
    return this._editorPlacement.calcSizeWithPadding(elem, desiredSize);
  }

  // TODO: update regexes to unicode?
  private _onSetCursor(row: DataRowModel, col: ViewFieldRec) {

    if (!col) { return; } // if clicked on row header, no col to insert

    if (this.options.readonly) { return; }

    const aceObj = this._formulaEditor.getEditor();

    if (!aceObj.selection.isEmpty()) { // If text selected, replace whole selection
      aceObj.session.replace(aceObj.selection.getRange(), '$' + col.colId());

    } else {  // Not a selection, gotta figure out what to replace
      const pos = aceObj.getCursorPosition();
      const line = aceObj.session.getLine(pos.row);
      const result = _isInIdentifier(line, pos.column); // returns {start, end, id} | null

      if (!result) { // Not touching an identifier, insert colId as normal
          aceObj.insert("$" + col.colId());

      // We are touching an identifier
      } else if (result.ident.startsWith("$")) { // If ident is a colId, replace it

          const idRange = AceEditor.makeRange(pos.row, result.start, pos.row, result.end);
          aceObj.session.replace(idRange, "$" + col.colId());
      }

      // Else touching a normal identifier, dont mangle it
    }

    // Resize editor in case it is needed.
    this._formulaEditor.resize();
    aceObj.focus();
  }
}

// returns whether the column in that line is inside or adjacent to an identifier
// if yes, returns {start, end, ident}, else null
function _isInIdentifier(line: string, column: number) {
    // If cursor is in or after an identifier, scoot back to the start of it
    const prefix = line.slice(0, column);
    let startOfIdent = prefix.search(/[$A-Za-z0-9_]+$/);
    if (startOfIdent < 0) { startOfIdent = column; } // if no match, maybe we're right before it

    // We're either before an ident or nowhere near one. Try to match to its end
    const match = line.slice(startOfIdent).match(/^[$a-zA-Z0-9_]+/);
    if (match) {
        const ident = match[0];
        return { ident, start: startOfIdent, end: startOfIdent + ident.length};
    } else {
        return null;
    }
}

const cssCollapseIcon = styled(icon, `
  margin: -3px 4px 0 4px;
  --icon-color: ${colors.slate};
`);
