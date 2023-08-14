import * as AceEditor from 'app/client/components/AceEditor';
import {CommandName} from 'app/client/components/commandList';
import * as commands from 'app/client/components/commands';
import {GristDoc} from 'app/client/components/GristDoc';
import {makeT} from 'app/client/lib/localization';
import {DataRowModel} from 'app/client/models/DataRowModel';
import {ColumnRec} from 'app/client/models/DocModel';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {reportError} from 'app/client/models/errors';
import {HAS_FORMULA_ASSISTANT} from 'app/client/models/features';
import {hoverTooltip} from 'app/client/ui/tooltips';
import {textButton} from 'app/client/ui2018/buttons';
import {colors, testId, theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {createMobileButtons, getButtonMargins} from 'app/client/widgets/EditorButtons';
import {EditorPlacement, ISize} from 'app/client/widgets/EditorPlacement';
import {createDetachedIcon} from 'app/client/widgets/FloatingEditor';
import {FormulaAssistant} from 'app/client/widgets/FormulaAssistant';
import {NewBaseEditor, Options} from 'app/client/widgets/NewBaseEditor';
import {asyncOnce} from 'app/common/AsyncCreate';
import {CellValue} from 'app/common/DocActions';
import {isRaisedException} from 'app/common/gristTypes';
import {undef} from 'app/common/gutil';
import {decodeObject, RaisedException} from 'app/plugin/objtypes';
import {Computed, Disposable, dom, Holder, MultiHolder, Observable, styled, subscribe} from 'grainjs';
import debounce = require('lodash/debounce');

// How wide to expand the FormulaEditor when an error is shown in it.
const minFormulaErrorWidth = 400;
const t = makeT('FormulaEditor');

export interface IFormulaEditorOptions extends Options {
  cssClass?: string;
  editingFormula: ko.Computed<boolean>;
  column: ColumnRec;
  field?: ViewFieldRec;
  canDetach?: boolean;
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
  public isDetached = Observable.create(this, false);
  protected options: IFormulaEditorOptions;

  private _aceEditor: any;
  private _dom: HTMLElement;
  private _editorPlacement!: EditorPlacement;
  private _placementHolder = Holder.create(this);
  private _canDetach: boolean;
  private _isEmpty: Computed<boolean>;

  constructor(options: IFormulaEditorOptions) {
    super(options);

    const editingFormula = options.editingFormula;

    const initialValue = undef(options.state as string | undefined, options.editValue, String(options.cellValue));
    // create editor state observable (used by draft and latest position memory)
    this.editorState = Observable.create(this, initialValue);

    this._isEmpty = Computed.create(this, this.editorState, (_use, state) => state === '');

    this._aceEditor = AceEditor.create({
      // A bit awkward, but we need to assume calcSize is not used until attach() has been called
      // and _editorPlacement created.
      column: options.column,
      calcSize: this._calcSize.bind(this),
      gristDoc: options.gristDoc,
      saveValueOnBlurEvent: !options.readonly,
      editorState : this.editorState,
      readonly: options.readonly
    });


    // For editable editor we will grab the cursor when we are in the formula editing mode.
    const cursorCommands = options.readonly ? {} : { setCursor: this._onSetCursor };
    const isActive = Computed.create(this, use => Boolean(use(editingFormula)));
    const commandGroup = this.autoDispose(commands.createGroup(cursorCommands, this, isActive));

    // We will create a group of editor commands right away.
    const editorGroup = this.autoDispose(commands.createGroup({
      ...options.commands,
    }, this, true));

    // Merge those two groups into one.
    const aceCommands: any = {
      knownKeys: {...commandGroup.knownKeys, ...editorGroup.knownKeys},
      commands: {...commandGroup.commands, ...editorGroup.commands},
    };

    // Tab, Shift + Tab, Enter should be handled by the editor itself when we are in the detached mode.
    // We will create disabled group, but will push those commands to the editor directly.
    const passThrough = (name: CommandName) => () => {
      if (this.isDetached.get()) {
        // For detached editor, just leave the default behavior.
        return true;
      }
      // Else invoke regular command.
      return commands.allCommands[name]?.run() ?? false;
    };
    const detachedCommands = this.autoDispose(commands.createGroup({
      nextField: passThrough('nextField'),
      prevField: passThrough('prevField'),
      fieldEditSave: passThrough('fieldEditSave'),
    }, this, false /* don't activate, we're just borrowing constructor */));

    Object.assign(aceCommands.knownKeys, detachedCommands.knownKeys);
    Object.assign(aceCommands.commands, detachedCommands.commands);

    const hideErrDetails = Observable.create(this, true);
    const raisedException = Computed.create(this, use => {
      if (!options.formulaError || !use(options.formulaError)) {
        return null;
      }
      const error = isRaisedException(use(options.formulaError)!) ?
                    decodeObject(use(options.formulaError)!) as RaisedException:
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
    this.autoDispose(errorDetails.addListener(() => setTimeout(this.resize.bind(this), 0)));

    this._canDetach = Boolean(options.canDetach && !options.readonly);

    this.autoDispose(this._aceEditor);

    // Show placeholder text when the formula is blank.
    this._isEmpty.addListener(() => this._updateEditorPlaceholder());

    // Disable undo/redo while the editor is detached.
    this.isDetached.addListener((isDetached) => {
      // TODO: look into whether we can support undo/redo while the editor is detached.
      if (isDetached) {
        options.gristDoc.getUndoStack().disable();
      } else {
        options.gristDoc.getUndoStack().enable();
      }
    });

    this.onDispose(() => {
      options.gristDoc.getUndoStack().enable();
    });

    this._dom = cssFormulaEditor(
      // switch border shadow
      dom.cls("readonly_editor", options.readonly),
      createMobileButtons(options.commands),
      options.cssClass ? dom.cls(options.cssClass) : null,

      // This shouldn't be needed, but needed for tests.
      dom.on('mousedown', (ev) => {
        // If we are detached, allow user to click and select error text.
        if (this.isDetached.get()) {
          // If we clicked on input element in our dom, don't do anything. We probably clicked on chat input, in AI
          // tools box.
          const clickedOnInput = ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement;
          if (clickedOnInput && this._dom.contains(ev.target)) {
            // By not doing anything special here we assume that the input element will take the focus.
            return;
          }
        }
        // Allow clicking the error message.
        if (ev.target instanceof HTMLElement && (
          ev.target.classList.contains('error_msg') ||
              ev.target.classList.contains('error_details_inner')
        )) {
          return;
        }
        ev.preventDefault();
        this.focus();
      }),
      !this._canDetach ? null : createDetachedIcon(
        hoverTooltip(t('Expand Editor')),
        dom.hide(this.isDetached),
      ),
      cssFormulaEditor.cls('-detached', this.isDetached),
      dom('div.formula_editor.formula_field_edit', testId('formula-editor'),
        this._aceEditor.buildDom((aceObj: any) => {
          aceObj.setFontSize(11);
          aceObj.setHighlightActiveLine(false);
          aceObj.getSession().setUseWrapMode(false);
          aceObj.renderer.setPadding(0);
          const val = initialValue;
          const pos = Math.min(options.cursorPos, val.length);
          this._aceEditor.setValue(val, pos);
          this._aceEditor.attachCommandGroup(aceCommands);

          // enable formula editing if state was passed
          if (options.state || options.readonly) {
            editingFormula(true);
          }
          if (options.readonly) {
            this._aceEditor.enable(false);
            aceObj.gotoLine(0, 0); // By moving, ace editor won't highlight anything
          }
          // This catches any change to the value including e.g. via backspace or paste.
          aceObj.once("change", () => {
            editingFormula?.(true);
          });

          if (val === '') {
            // Show placeholder text if the formula is blank.
            this._updateEditorPlaceholder();
          }
        })
      ),
      dom.maybe(options.formulaError, () => [
        dom('div.error_msg', testId('formula-error-msg'),
          dom.attr('tabindex', '-1'),
          dom.maybe(errorDetails, () =>
            dom.domComputed(hideErrDetails, (hide) => cssCollapseIcon(
              hide ? 'Expand' : 'Collapse',
              testId('formula-error-expand'),
              dom.on('click', () => {
                if (errorDetails.get()){
                  hideErrDetails.set(!hideErrDetails.get());
                  this._aceEditor.resize();
                }
              })
            ))
          ),
          dom.text(errorText),
        ),
        dom.maybe(use => Boolean(use(errorDetails) && !use(hideErrDetails)), () =>
          dom('div.error_details',
            dom.attr('tabindex', '-1'),
            dom('div.error_details_inner',
              dom.text(errorDetails),
            ),
            testId('formula-error-details'),
          )
        )
      ]),
      dom.maybe(this.isDetached, () => {
        return dom.create(FormulaAssistant, {
          column: this.options.column,
          field: this.options.field,
          gristDoc: this.options.gristDoc,
          editor: this,
        });
      }),
    );
  }

  public attach(cellElem: Element): void {
    this.isDetached.set(false);
    this._editorPlacement = EditorPlacement.create(
      this._placementHolder, this._dom, cellElem, {margins: getButtonMargins()});
    // Reposition the editor if needed for external reasons (in practice, window resize).
    this.autoDispose(this._editorPlacement.onReposition.addListener(this._aceEditor.resize, this._aceEditor));
    this._aceEditor.onAttach();
    this._updateEditorPlaceholder();
    this._aceEditor.resize();
    this.focus();
  }

  public getDom(): HTMLElement {
    return this._dom;
  }

  public setFormula(formula: string) {
    this._aceEditor.setValue(formula);
  }

  public getCellValue() {
    const value = this._aceEditor.getValue();
    // Strip the leading "=" sign, if any, in case users think it should start the formula body (as
    // it does in Excel, and because the equal sign is also used for formulas in Grist UI).
    return (value[0] === '=') ? value.slice(1) : value;
  }

  public getTextValue() {
    return this._aceEditor.getValue();
  }

  public getCursorPos() {
    const aceObj = this._aceEditor.getEditor();
    return aceObj.getSession().getDocument().positionToIndex(aceObj.getCursorPosition());
  }

  public focus() {
    if (this.isDisposed()) { return; }
    this._aceEditor.getEditor().focus();
  }

  public resize() {
    if (this.isDisposed()) { return; }
    this._aceEditor.resize();
  }

  public detach() {
    // Remove the element from the dom (to prevent any autodispose) from happening.
    this._dom.parentNode?.removeChild(this._dom);
    // First mark that we are detached, to show the buttons,
    // and halt the autosizing mechanism.
    this.isDetached.set(true);
    // Finally, destroy the normal inline placement helper.
    this._placementHolder.clear();
    // We are going in the full formula edit mode right away.
    this.options.editingFormula(true);
    this._updateEditorPlaceholder();
    // Set the focus in timeout, as the dom is added after this function.
    setTimeout(() => !this.isDisposed() && this._aceEditor.resize(), 0);
    // Return the dom, it will be moved to the floating editor.
    return this._dom;
  }

  private _updateEditorPlaceholder() {
    const editor = this._aceEditor.getEditor();
    const shouldShowPlaceholder = editor.session.getValue().length === 0;
    if (editor.renderer.emptyMessageNode) {
      // Remove the current placeholder if one is present.
      editor.renderer.scroller.removeChild(editor.renderer.emptyMessageNode);
    }
    if (!shouldShowPlaceholder) {
      editor.renderer.emptyMessageNode = null;
    } else {
      const withAiButton = this._canDetach && !this.isDetached.get() && HAS_FORMULA_ASSISTANT();
      editor.renderer.emptyMessageNode = cssFormulaPlaceholder(
          !withAiButton
          ? t('Enter formula.')
          : t('Enter formula or {{button}}.', {
            button: cssUseAssistantButton(
              t('use AI Assistant'),
              dom.on('click', (ev) => this._handleUseAssistantButtonClick(ev)),
              testId('formula-editor-use-ai-assistant'),
            ),
          }),
      );
      editor.renderer.scroller.appendChild(editor.renderer.emptyMessageNode);
    }
  }

  private _handleUseAssistantButtonClick(ev: MouseEvent) {
    ev.stopPropagation();
    ev.preventDefault();
    commands.allCommands.detachEditor.run();
    commands.allCommands.activateAssistant.run();
  }

  private _calcSize(elem: HTMLElement, desiredElemSize: ISize) {
    if (this.isDetached.get()) {
      // If we are detached, we will stop autosizing.
      return {
        height: 0,
        width: 0
      };
    }

    const placeholder: HTMLElement | undefined = this._aceEditor.getEditor().renderer.emptyMessageNode;
    if (placeholder) {
      // If we are showing the placeholder, fit it all on the same line.
      return this._editorPlacement.calcSizeWithPadding(elem, {
        width: placeholder.scrollWidth,
        height: placeholder.scrollHeight,
      });
    }

    const errorBox: HTMLElement|null = this._dom.querySelector('.error_details');
    const errorBoxStartHeight = errorBox?.getBoundingClientRect().height || 0;
    const errorBoxDesiredHeight = errorBox?.scrollHeight || 0;

    // If we have an error to show, ask for a larger size for formulaEditor.
    const desiredSize = {
      width: Math.max(desiredElemSize.width, (this.options.formulaError.get() ? minFormulaErrorWidth : 0)),
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
  private _onSetCursor(row?: DataRowModel, col?: ViewFieldRec) {
    // Don't do anything when we are readonly.
    if (this.options.readonly) { return; }
    // If we don't have column information, we can't insert anything.
    if (!col) { return; }

    const colId = col.origCol.peek().colId.peek();

    if (col.tableId.peek() !== this.options.column.table.peek().tableId.peek()) {
      // Fall back to default behavior if cursor didn't move to a column in the same table.
      this.options.gristDoc.onSetCursorPos(row, col).catch(reportError);
      return;
    }

    const aceObj = this._aceEditor.getEditor();
    if (!aceObj.selection.isEmpty()) {
      // If text selected, replace whole selection
      aceObj.session.replace(aceObj.selection.getRange(), '$' + colId);
    } else {
      // Not a selection, gotta figure out what to replace
      const pos = aceObj.getCursorPosition();
      const line = aceObj.session.getLine(pos.row);
      const result = _isInIdentifier(line, pos.column); // returns {start, end, id} | null
      if (!result) {
        // Not touching an identifier, insert colId as normal
        aceObj.insert('$' + colId);
        // We are touching an identifier
      } else if (result.ident.startsWith('$')) {
        // If ident is a colId, replace it
        const idRange = AceEditor.makeRange(pos.row, result.start, pos.row, result.end);
        aceObj.session.replace(idRange, '$' + colId);
      }
      // Else touching a normal identifier, don't mangle it
    }
    // Resize editor in case it is needed.
    this._aceEditor.resize();

    // This focus method will try to focus a textarea immediately and again on setTimeout. But
    // other things may happen by the setTimeout time, messing up focus. The reason the immediate
    // call doesn't usually help is that this is called on 'mousedown' before its corresponding
    // focus/blur occur. We can do a bit better by restoring focus immediately after blur occurs.
    aceObj.focus();
    const lis = dom.onElem(aceObj.textInput.getElement(), 'blur', e => { lis.dispose(); aceObj.focus(); });
    // If no blur right away, clear the listener, to avoid unexpected interference.
    setTimeout(() => lis.dispose(), 0);
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
  // Associated formula from a view field. If provided together with column, this field is used
  field?: ViewFieldRec,
  editingFormula?: ko.Computed<boolean>,
  // Needed to get exception value, if any.
  editRow?: DataRowModel,
  // Element over which to position the editor.
  refElem: Element,
  editValue?: string,
  onSave?: (column: ColumnRec, formula: string) => Promise<void>,
  onCancel?: () => void,
  canDetach?: boolean,
  // Called after editor is created to set up editor cleanup (e.g. saving on click-away).
  setupCleanup: (
    owner: Disposable,
    doc: GristDoc,
    editingFormula: ko.Computed<boolean>,
    save: () => Promise<void>
  ) => void,
}): FormulaEditor {
  const {gristDoc, editRow, refElem, setupCleanup} = options;
  const attachedHolder = new MultiHolder();

  if (options.field) {
    options.column = options.field.origCol();
  } else if (options.canDetach) {
    throw new Error('Field is required for detached editor');
  }

  // We can't rely on the field passed in, we need to create our own.
  const column = options.column ?? options.field?.column();

  if (!column) {
    throw new Error('Column or field is required');
  }

  // AsyncOnce ensures it's called once even if triggered multiple times.
  const saveEdit = asyncOnce(async () => {
    const detached = editor.isDetached.get();
    if (detached) {
      editor.dispose();
      return;
    }
    const formula = String(editor.getCellValue());
    if (formula !== column.formula.peek()) {
      if (options.onSave) {
        await options.onSave(column, formula);
      } else {
        await column.updateColValues({formula});
      }
      editor.dispose();
    } else {
      editor.dispose();
      options.onCancel?.();
    }
  });

  // These are the commands for while the editor is active.
  const editCommands = {
    fieldEditSave: () => { saveEdit().catch(reportError); },
    fieldEditSaveHere: () => { saveEdit().catch(reportError); },
    fieldEditCancel: () => { editor.dispose(); options.onCancel?.(); },
  };

  const formulaError = editRow ? getFormulaError(attachedHolder, {
    gristDoc,
    editRow,
    column,
    field: options.field,
  }) : undefined;
  const editor = FormulaEditor.create(null, {
    gristDoc,
    column,
    field: options.field,
    editingFormula: options.editingFormula,
    rowId: editRow ? editRow.id() : 0,
    cellValue: column.formula(),
    formulaError,
    editValue: options.editValue,
    cursorPos: Number.POSITIVE_INFINITY,    // Position of the caret within the editor.
    commands: editCommands,
    cssClass: 'formula_editor_sidepane',
    readonly : false,
    canDetach: options.canDetach
  } as IFormulaEditorOptions) as FormulaEditor;
  editor.autoDispose(attachedHolder);
  editor.attach(refElem);

  const editingFormula = options.editingFormula ?? options?.field?.editingFormula;

  if (!editingFormula) {
    throw new Error(t('editingFormula is required'));
  }

  // When formula is empty enter formula-editing mode (highlight formula icons; click on a column inserts its ID).
  // This function is used for primarily for switching between different column behaviors, so we want to enter full
  // edit mode right away.
  // TODO: consider converting it to parameter, when this will be used in different scenarios.
  if (!column.formula()) {
    editingFormula(true);
  }
  setupCleanup(editor, gristDoc, editingFormula, saveEdit);
  return editor;
}

/**
 * If the cell at the given row and column is a formula value containing an exception, return an
 * observable with this exception, and fetch more details to add to the observable.
 */
export function getFormulaError(owner: Disposable, options: {
  gristDoc: GristDoc,
  editRow: DataRowModel,
  column?: ColumnRec,
  field?: ViewFieldRec,
}): Observable<CellValue|undefined> {
  const {gristDoc, editRow} = options;
  const formulaError = Observable.create(owner, undefined as any);
  // When we don't have a field information we don't need to be reactive at all.
  if (!options.field) {
    const column = options.column!;
    const colId = column.colId.peek();
    const onValueChange = errorMonitor(gristDoc, column, editRow, owner, formulaError);
    const subscription = editRow.cells[colId].subscribe(onValueChange);
    owner.autoDispose(subscription);
    onValueChange(editRow.cells[colId].peek());
    return formulaError;
  } else {

    // We can't rely on the editRow we got, as this is owned by the view. When we will be detached the view will be
    // gone. So, we will create our own observable that will be updated when the row is updated.
    const errorRow: DataRowModel = gristDoc.getTableModel(options.field.tableId.peek()).createFloatingRowModel() as any;
    errorRow.assign(editRow.getRowId());
    owner.autoDispose(errorRow);

    // When we have a field information we will grab the error from the column that is currently connected to the field.
    // This will change when user is using the preview feature in detached editor, where a new column is created, and
    // field starts showing it instead of the original column.
    Computed.create(owner, use => {
      // This pattern creates a subscription using compute observable.

      // Create an holder for everything that is created during recomputation. It will be returned as the value
      // of the computed observable, and will be disposed when the value changes.
      const holder = MultiHolder.create(use.owner);

      // Now subscribe to the column in the field, this is the part that will be changed when user creates a preview.
      const column = use(options.field!.column);
      const colId = use(column.colId);
      const onValueChange = errorMonitor(gristDoc, column, errorRow, holder, formulaError);
      // Unsubscribe when computed is recomputed.
      holder.autoDispose(errorRow.cells[colId].subscribe(onValueChange));
      // Trigger the subscription to get the initial value.
      onValueChange(errorRow.cells[colId].peek());

      // Return the holder, it will be disposed when the value changes.
      return holder;
    });
  }
  return formulaError;
}

function errorMonitor(
  gristDoc: GristDoc,
  column: ColumnRec,
  editRow: DataRowModel,
  holder: Disposable,
  formulaError: Observable<CellValue|undefined> ) {
  return  function onValueChange(cellCurrentValue: CellValue) {
    const isFormula = column.isFormula() || column.hasTriggerFormula();
    if (isFormula && isRaisedException(cellCurrentValue)) {
      if (!formulaError.get()) {
        // Don't update it when there is already an error (to avoid flickering).
        formulaError.set(cellCurrentValue);
      }
      gristDoc.docData.getFormulaError(column.table().tableId(), column.colId(), editRow.getRowId())
        .then(value => {
          if (holder.isDisposed()) { return; }
          formulaError.set(value);
        })
        .catch((er) => {
          if (!holder.isDisposed()) {
            reportError(er);
          }
        });
    } else {
      formulaError.set(undefined);
    }
  };
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
        (numCells === 1) ? t(`Error in the cell`) :
        (numErrors === numCells) ? t(`Errors in all {{numErrors}} cells`, {numErrors}) :
        t(`Errors in {{numErrors}} of {{numCells}} cells`, {numErrors, numCells})
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
  cursor: pointer;
  position: sticky;
  top: 0px;
  flex-shrink: 0;
`);

export const cssError = styled('div', `
  color: ${theme.errorText};
`);

const cssFormulaEditor = styled('div.default_editor.formula_editor_wrapper', `
  &-detached {
    height: 100%;
    position: relative;
    box-shadow: none;
  }
  &-detached .formula_editor {
    flex-grow: 1;
    min-height: 100px;
  }

  &-detached .error_msg, &-detached .error_details {
    max-height: 100px;
    flex-shrink: 0;
  }

  &-detached .code_editor_container {
    height: 100%;
    width: 100%;
  }

  &-detached .ace_editor {
    height: 100% !important;
    width: 100% !important;
  }
`);

const cssFormulaPlaceholder = styled('div', `
  color: ${theme.lightText};
  font-style: italic;
  white-space: nowrap;
`);

const cssUseAssistantButton = styled(textButton, `
  font-size: ${vars.smallFontSize};
`);
