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
import {Computed, Disposable, dom, MultiHolder, Observable, styled, subscribe} from 'grainjs';
import {isRaisedException} from "app/common/gristTypes";
import {decodeObject, RaisedException} from "app/plugin/objtypes";
import {GristDoc} from 'app/client/components/GristDoc';
import {ColumnRec} from 'app/client/models/DocModel';
import {asyncOnce} from 'app/common/AsyncCreate';
import {reportError} from 'app/client/models/errors';
import {CellValue} from 'app/common/DocActions';
import debounce = require('lodash/debounce');

// How wide to expand the FormulaEditor when an error is shown in it.
const minFormulaErrorWidth = 400;

export interface IFormulaEditorOptions extends Options {
  cssClass?: string;
  editingFormula: ko.Computed<boolean>,
  column: ColumnRec,
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
  private _editorPlacement!: EditorPlacement;

  constructor(options: IFormulaEditorOptions) {
    super(options);

    const editingFormula = options.editingFormula;

    const initialValue = undef(options.state as string | undefined, options.editValue, String(options.cellValue));
    // create editor state observable (used by draft and latest position memory)
    this.editorState = Observable.create(this, initialValue);

    this._formulaEditor = AceEditor.create({
      // A bit awkward, but we need to assume calcSize is not used until attach() has been called
      // and _editorPlacement created.
      column: options.column,
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
    this._commandGroup = this.autoDispose(createGroup(allCommands, this, editingFormula));

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

    // Once the exception details are available, update the sizing. The extra delay is to allow
    // the DOM to update before resizing.
    this.autoDispose(errorDetails.addListener(() => setTimeout(() => this._formulaEditor.resize(), 0)));

    this.autoDispose(this._formulaEditor);
    this._dom = dom('div.default_editor.formula_editor_wrapper',
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
            editingFormula(true);
          }
          if (options.readonly) {
            this._formulaEditor.enable(false);
            aceObj.gotoLine(0, 0); // By moving, ace editor won't highlight anything
          }
          // This catches any change to the value including e.g. via backspace or paste.
          aceObj.once("change", () => editingFormula?.(true));
        })
      ),
      (options.formulaError ? [
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
          dom.maybe(use => Boolean(use(errorDetails) && !use(hideErrDetails)), () =>
            dom('div.error_details',
              dom('div.error_details_inner',
                dom.text(errorDetails),
              ),
              testId('formula-error-details'),
            )
          )
        ] : null
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
    const errorBox: HTMLElement|null = this._dom.querySelector('.error_details');
    const errorBoxStartHeight = errorBox?.getBoundingClientRect().height || 0;
    const errorBoxDesiredHeight = errorBox?.scrollHeight || 0;

    // If we have an error to show, ask for a larger size for formulaEditor.
    const desiredSize = {
      width: Math.max(desiredElemSize.width, (this.options.formulaError ? minFormulaErrorWidth : 0)),
      // Ask for extra space for the error; we'll decide how to allocate it below.
      height: desiredElemSize.height + (errorBoxDesiredHeight - errorBoxStartHeight),
    };
    const result = this._editorPlacement.calcSizeWithPadding(elem, desiredSize);
    if (errorBox) {
      // Note that result.height does not include errorBoxStartHeight, but includes any available
      // extra space that we requested.
      const availableForError = errorBoxStartHeight + (result.height - desiredElemSize.height);
      // This is the key calculation: if space is available, use it; if not, give 64px to error
      // (it'll scroll within that), but don't use more than desired.
      const errorBoxEndHeight = Math.min(errorBoxDesiredHeight, Math.max(availableForError, 64));
      errorBox.style.height = `${errorBoxEndHeight}px`;
      result.height -= (errorBoxEndHeight - errorBoxStartHeight);
    }
    return result;
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

/**
 * Open a formula editor. Returns a Disposable that owns the editor.
 */
export function openFormulaEditor(options: {
  gristDoc: GristDoc,
  // Associated formula from a different column (for example style rule).
  column?: ColumnRec,
  field?: ViewFieldRec,
  editingFormula?: ko.Computed<boolean>,
  // Needed to get exception value, if any.
  editRow?: DataRowModel,
  // Element over which to position the editor.
  refElem: Element,
  editValue?: string,
  onSave?: (column: ColumnRec, formula: string) => Promise<void>,
  onCancel?: () => void,
  // Called after editor is created to set up editor cleanup (e.g. saving on click-away).
  setupCleanup: (
    owner: MultiHolder,
    doc: GristDoc,
    editingFormula: ko.Computed<boolean>,
    save: () => Promise<void>
  ) => void,
}): Disposable {
  const {gristDoc, editRow, refElem, setupCleanup} = options;
  const holder = MultiHolder.create(null);
  const column = options.column ?? options.field?.column();

  if (!column) {
    throw new Error('Column or field is required');
  }

  // AsyncOnce ensures it's called once even if triggered multiple times.
  const saveEdit = asyncOnce(async () => {
    const formula = editor.getCellValue();
    if (formula !== column.formula.peek()) {
      if (options.onSave) {
        await options.onSave(column, formula as string);
      } else {
        await column.updateColValues({formula});
      }
      holder.dispose();
    } else {
      holder.dispose();
      options.onCancel?.();
    }
  });

  // These are the commands for while the editor is active.
  const editCommands = {
    fieldEditSave: () => { saveEdit().catch(reportError); },
    fieldEditSaveHere: () => { saveEdit().catch(reportError); },
    fieldEditCancel: () => { holder.dispose(); options.onCancel?.(); },
  };

  // Replace the item in the Holder with a new one, disposing the previous one.
  const editor = FormulaEditor.create(holder, {
    gristDoc,
    column,
    editingFormula: options.editingFormula,
    rowId: editRow ? editRow.id() : 0,
    cellValue: column.formula(),
    formulaError: editRow ? getFormulaError(gristDoc, editRow, column) : undefined,
    editValue: options.editValue,
    cursorPos: Number.POSITIVE_INFINITY,    // Position of the caret within the editor.
    commands: editCommands,
    cssClass: 'formula_editor_sidepane',
    readonly : false
  } as IFormulaEditorOptions);
  editor.attach(refElem);

  const editingFormula = options.editingFormula ?? options?.field?.editingFormula;

  if (!editingFormula) {
    throw new Error('editingFormula is required');
  }

  // When formula is empty enter formula-editing mode (highlight formula icons; click on a column inserts its ID).
  // This function is used for primarily for switching between different column behaviors, so we want to enter full
  // edit mode right away.
  // TODO: consider converting it to parameter, when this will be used in different scenarios.
  if (!column.formula()) {
    editingFormula(true);
  }
  setupCleanup(holder, gristDoc, editingFormula, saveEdit);
  return holder;
}

/**
 * If the cell at the given row and column is a formula value containing an exception, return an
 * observable with this exception, and fetch more details to add to the observable.
 */
export function getFormulaError(
  gristDoc: GristDoc, editRow: DataRowModel, column: ColumnRec
): Observable<CellValue>|undefined {
  const colId = column.colId.peek();
  const cellCurrentValue = editRow.cells[colId].peek();
  const isFormula = column.isFormula() || column.hasTriggerFormula();
  if (isFormula && isRaisedException(cellCurrentValue)) {
    const formulaError = Observable.create(null, cellCurrentValue);
    gristDoc.docData.getFormulaError(column.table().tableId(), colId, editRow.getRowId())
      .then(value => {
        formulaError.set(value);
      })
      .catch(reportError);
    return formulaError;
  }
  return undefined;
}

/**
 * Create and return an observable for the count of errors in a column, which gets updated in
 * response to changes in origColumn and in user data.
 */
export function createFormulaErrorObs(owner: MultiHolder, gristDoc: GristDoc, origColumn: ColumnRec) {
  const errorMessage = Observable.create(owner, '');

  // Count errors in origColumn when it's a formula column. Counts get cached by the
  // tableData.countErrors() method, and invalidated on relevant data changes.
  function countErrors() {
    if (owner.isDisposed()) { return; }
    const tableData = gristDoc.docData.getTable(origColumn.table.peek().tableId.peek());
    const isFormula = origColumn.isRealFormula.peek() || origColumn.hasTriggerFormula.peek();
    if (tableData && isFormula) {
      const colId = origColumn.colId.peek();
      const numCells = tableData.getColValues(colId)?.length || 0;
      const numErrors = tableData.countErrors(colId) || 0;
      errorMessage.set(
        (numErrors === 0) ? '' :
        (numCells === 1) ? `Error in the cell` :
        (numErrors === numCells) ? `Errors in all ${numErrors} cells` :
        `Errors in ${numErrors} of ${numCells} cells`
      );
    } else {
      errorMessage.set('');
    }
  }

  // Debounce the count calculation to defer it to the end of a bundle of actions.
  const debouncedCountErrors = debounce(countErrors, 0);

  // If there is an update to the data in the table, count errors again. Since the same UI is
  // reused when different page widgets are selected, we need to re-create this subscription
  // whenever the selected table changes. We use a Computed to both react to changes and dispose
  // the previous subscription when it changes.
  Computed.create(owner, (use) => {
    const tableData = gristDoc.docData.getTable(use(use(origColumn.table).tableId));
    return tableData ? use.owner.autoDispose(tableData.tableActionEmitter.addListener(debouncedCountErrors)) : null;
  });

  // The counts depend on the origColumn and its isRealFormula status, but with the debounced
  // callback and subscription to data, subscribe to relevant changes manually (rather than using
  // a Computed).
  owner.autoDispose(subscribe(use => { use(origColumn.id); use(origColumn.isRealFormula); debouncedCountErrors(); }));
  return errorMessage;
}

const cssCollapseIcon = styled(icon, `
  margin: -3px 4px 0 4px;
  --icon-color: ${colors.slate};
`);

export const cssError = styled('div', `
  color: ${colors.error};
`);
