import * as commands from 'app/client/components/commands';
import {Cursor} from 'app/client/components/Cursor';
import {GristDoc} from 'app/client/components/GristDoc';
import {UnsavedChange} from 'app/client/components/UnsavedChanges';
import {makeT} from 'app/client/lib/localization';
import {DataRowModel} from 'app/client/models/DataRowModel';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {reportError} from 'app/client/models/errors';
import {showTooltipToCreateFormula} from 'app/client/widgets/EditorTooltip';
import {FormulaEditor, getFormulaError} from 'app/client/widgets/FormulaEditor';
import {IEditorCommandGroup, NewBaseEditor} from 'app/client/widgets/NewBaseEditor';
import {asyncOnce} from "app/common/AsyncCreate";
import {CellValue} from "app/common/DocActions";
import * as gutil from 'app/common/gutil';
import {CellPosition} from "app/client/components/CellPosition";
import {FloatingEditor} from 'app/client/widgets/FloatingEditor';
import {CursorPos} from 'app/plugin/GristAPI';
import isEqual = require('lodash/isEqual');
import {Disposable, dom, Emitter, Holder, MultiHolder, Observable} from 'grainjs';

type IEditorConstructor = typeof NewBaseEditor;

const t = makeT('FieldEditor');

/**
 * Check if the typed-in value should change the cell without opening the cell editor, and if so,
 * saves and returns true. E.g. on typing enter, CheckBoxEditor toggles the cell without opening.
 */
export function saveWithoutEditor(
  editorCtor: IEditorConstructor,
  editRow: DataRowModel,
  field: ViewFieldRec,
  options: {typedVal?: string, event?: KeyboardEvent|MouseEvent}
): boolean {
  const {typedVal, event} = options;
  // Never skip the editor if editing a formula. Also, check that skipEditor static function
  // exists (we don't bother adding it on old-style JS editors that don't need it).
  if (!field.column.peek().isRealFormula.peek() && editorCtor.skipEditor) {
    const origVal = editRow.cells[field.colId()].peek();
    const skipEditorValue = editorCtor.skipEditor(typedVal, origVal, {event});
    if (skipEditorValue !== undefined) {
      setAndSave(editRow, field, skipEditorValue).catch(reportError);
      return true;
    }
  }
  return false;
}

// Set the given field of editRow to value, only if different from the current value of the cell.
export async function setAndSave(editRow: DataRowModel, field: ViewFieldRec, value: CellValue): Promise<void> {
  const obs = editRow.cells[field.colId()];
  if (!isEqual(value, obs.peek())) {
    return obs.setAndSave(value);
  }
}

/**
 * Event that is fired when editor stat has changed
 */
export interface FieldEditorStateEvent {
  position: CellPosition,
  wasModified: boolean,
  currentState: any,
  type: string
}

export class FieldEditor extends Disposable {

  public readonly saveEmitter = this.autoDispose(new Emitter());
  public readonly cancelEmitter = this.autoDispose(new Emitter());
  public readonly changeEmitter = this.autoDispose(new Emitter());
  public floatingEditor: FloatingEditor;

  private _gristDoc: GristDoc;
  private _field: ViewFieldRec;
  private _cursor: Cursor;
  private _editRow: DataRowModel;
  private _cellElem: Element;
  private _editCommands: IEditorCommandGroup;
  private _editorCtor: IEditorConstructor;
  private _editorHolder: Holder<NewBaseEditor> = Holder.create(this);
  private _saveEdit = asyncOnce(() => this._doSaveEdit());
  private _editorHasChanged = false;
  private _isFormula = false;
  private _readonly = false;
  private _detached = Observable.create(this, false);
  private _detachedAt: CursorPos|null = null;

  constructor(options: {
    gristDoc: GristDoc,
    field: ViewFieldRec,
    cursor: Cursor,
    editRow: DataRowModel,
    cellElem: Element,
    editorCtor: IEditorConstructor,
    startVal?: string,
    state?: any,
    readonly: boolean
  }) {
    super();
    this._gristDoc = options.gristDoc;
    this._field = options.field;
    this._cursor = options.cursor;
    this._editRow = options.editRow;
    this._editorCtor = options.editorCtor;
    this._cellElem = options.cellElem;
    this._readonly = options.readonly;

    const startVal = options.startVal;
    let offerToMakeFormula = false;

    const column = this._field.column();
    this._isFormula = column.isRealFormula.peek();
    let editValue: string|undefined = startVal;
    if (!options.readonly && startVal && gutil.startsWith(startVal, '=')) {
      if (this._isFormula  || this._field.column().isEmpty()) {
        // If we typed '=' on an empty column, convert it to a formula. If on a formula column,
        // start editing ignoring the initial '='.
        this._isFormula  = true;
        editValue = gutil.removePrefix(startVal, '=') as string;
      } else {
        // If we typed '=' on a non-empty column, only suggest to convert it to a formula.
        offerToMakeFormula = true;
      }
    }

    // These are the commands for while the editor is active.
    this._editCommands = {
      // _saveEdit disables this command group, so when we run fieldEditSave again, it triggers
      // another registered group, if any. E.g. GridView listens to it to move the cursor down.
      fieldEditSave: () => {
        this._saveEdit().then((jumped: boolean) => {
          // To avoid confusing cursor movement, do not increment the rowIndex if the row
          // was re-sorted after editing.
          if (!jumped) { commands.allCommands.fieldEditSave.run(); }
        })
        .catch(reportError);
      },
      fieldEditSaveHere: () => { this._saveEdit().catch(reportError); },
      fieldEditCancel: () => { this._cancelEdit(); },
      prevField: () => { this._saveEdit().then(commands.allCommands.prevField.run).catch(reportError); },
      nextField: () => { this._saveEdit().then(commands.allCommands.nextField.run).catch(reportError); },
      makeFormula: () => this._makeFormula(),
      unmakeFormula: () => this._unmakeFormula(),
    };

    // for readonly editor rewire commands, most of this also could be
    // done by just overriding the saveEdit method, but this is more clearer
    if (options.readonly) {
      this._editCommands.fieldEditSave = () => {
        // those two lines are tightly coupled - without disposing first
        // it will run itself in a loop. But this is needed for a GridView
        // which navigates to the next row on save.
        this._editCommands.fieldEditCancel();
        commands.allCommands.fieldEditSave.run();
      };
      this._editCommands.fieldEditSaveHere = this._editCommands.fieldEditCancel;
      this._editCommands.prevField = () => { this._cancelEdit(); commands.allCommands.prevField.run(); };
      this._editCommands.nextField = () => { this._cancelEdit(); commands.allCommands.nextField.run(); };
      this._editCommands.makeFormula = () => true; /* don't stop propagation */
      this._editCommands.unmakeFormula = () => true;
    }

    this.rebuildEditor(editValue, Number.POSITIVE_INFINITY, options.state);

    // Create a floating editor, which will be used to display the editor in a popup.
    this.floatingEditor = FloatingEditor.create(this, this, {
      gristDoc: this._gristDoc,
      refElem: this._cellElem,
      placement: 'adjacent',
    });

    if (offerToMakeFormula) {
      this._offerToMakeFormula();
    }

    // connect this editor to editor monitor, it will restore this editor
    // when user or server refreshes the browser
    this._gristDoc.editorMonitor.monitorEditor(this);

    // For detached editor, we don't need to cleanup anything.
    // It will be cleanuped automatically.
    const onCleanup = async () => {
      if (this._detached.get()) { return; }
      await this._saveEdit();
    };

    // for readonly field we don't need to do anything special
    if (!options.readonly) {
      setupEditorCleanup(this, this._gristDoc, this._field.editingFormula, onCleanup);
    } else {
      setupReadonlyEditorCleanup(this, this._gristDoc, this._field, () => this._cancelEdit());
    }
  }

  // cursorPos refers to the position of the caret within the editor.
  public rebuildEditor(editValue: string|undefined, cursorPos: number, state?: any) {
    const editorCtor: IEditorConstructor = this._isFormula ? FormulaEditor : this._editorCtor;

    const column = this._field.column();
    const cellCurrentValue = this._editRow.cells[this._field.colId()].peek();
    let cellValue: CellValue;
    if (column.isFormula()) {
      cellValue = column.formula();
    } else if (Array.isArray(cellCurrentValue) && cellCurrentValue[0] === 'C') {
      // This cell value is censored by access control rules
      // Really the rules should also block editing, but in case they don't, show a blank value
      // rather than a 'C'. However if the user tries to edit the cell and then clicks away
      // without typing anything the empty string is saved, deleting what was there.
      // We should probably just automatically block updates where reading is not allowed.
      cellValue = '';
    } else {
      cellValue = cellCurrentValue;
    }

    const errorHolder = new MultiHolder();

    const error = getFormulaError(errorHolder, {
      gristDoc: this._gristDoc,
      editRow: this._editRow,
      field: this._field
    });

    // For readonly mode use the default behavior of Formula Editor
    // TODO: cleanup this flag - it gets modified in too many places
    if (!this._readonly){
      // Enter formula-editing mode (e.g. click-on-column inserts its ID) only if we are opening the
      // editor by typing into it (and overriding previous formula). In other cases (e.g. double-click),
      // we defer this mode until the user types something.
      const active = this._isFormula && editValue !== undefined;
      this._field.editingFormula(active);
    }

    this._detached.set(false);
    this._editorHasChanged = false;
    // Replace the item in the Holder with a new one, disposing the previous one.
    const editor = this._editorHolder.autoDispose(editorCtor.create({
      gristDoc: this._gristDoc,
      field: this._field,
      column: this._field.column(), // needed for FormulaEditor
      editingFormula: this._field.editingFormula, // needed for Formula editor
      cellValue,
      rowId: this._editRow.id(),
      formulaError: error,
      editValue,
      cursorPos,
      state,
      canDetach: true,
      commands: this._editCommands,
      readonly : this._readonly
    }));

    editor.autoDispose(errorHolder);

    // if editor supports live changes, connect it to the change emitter
    if (editor.editorState) {
      editor.autoDispose(editor.editorState.addListener((currentState) => {
        this._editorHasChanged = true;
        const event: FieldEditorStateEvent = {
          position : this.cellPosition(),
          wasModified : this._editorHasChanged,
          currentState,
          type: this._field.column.peek().pureType.peek()
        };
        this.changeEmitter.emit(event);
      }));
    }

    editor.attach(this._cellElem);
  }

  public detach() {
    this._detached.set(true);
    this._detachedAt = this._gristDoc.cursorPosition.get()!;
    return this._editorHolder.get()!.detach()!;
  }

  public async attach(content: HTMLElement) {
    // If we are disconnected from the dom (maybe page was changed or something), we can't
    // simply attach the editor back, we need to rebuild it.
    if (!this._cellElem.isConnected) {
      dom.domDispose(content);
      if (await this._gristDoc.recursiveMoveToCursorPos(this._detachedAt!, true)) {
        await this._gristDoc.activateEditorAtCursor();
      }
      this.dispose();
      return;
    }
    this._detached.set(false);
    this._editorHolder.get()?.attach(this._cellElem);
    this._field.viewSection.peek().hasFocus(true);
  }

  public getDom() {
    return this._editorHolder.get()?.getDom();
  }

  // calculate current cell's absolute position
  public cellPosition() {
    const rowId = this._editRow.getRowId();
    const colRef = this._field.column.peek().origColRef.peek();
    const sectionId = this._field.viewSection.peek().id.peek();
    const position = {
      rowId,
      colRef,
      sectionId
    };
    return position;
  }

  private _makeFormula() {
    const editor = this._editorHolder.get();
    // On keyPress of "=" on textInput, consider turning the column into a formula.
    if (editor && !this._field.editingFormula.peek() && editor.getCursorPos() === 0) {
      if (this._field.column().isEmpty()) {
        this._isFormula = true;
        // If we typed '=' an empty column, convert it to a formula.
        this.rebuildEditor(editor.getTextValue(), 0);
        return false;
      } else {
        // If we typed '=' on a non-empty column, only suggest to convert it to a formula.
        this._offerToMakeFormula();
      }
    }
    return true;    // don't stop propagation.
  }

  private _unmakeFormula() {
    const editor = this._editorHolder.get();
    if (editor instanceof FormulaEditor && editor.isDetached.get()) {
      return true;
    }

    // Only convert to data if we are undoing a to-formula conversion. To convert formula to
    // data, use column menu option, or delete the formula first (which makes the column "empty").
    if (editor && this._field.editingFormula.peek() && editor.getCursorPos() === 0 &&
      !this._field.column().isRealFormula()) {
      // Restore a plain '=' character. This gives a way to enter "=" at the start if line. The
      // second backspace will delete it.
      this._isFormula = false;
      this.rebuildEditor('=' + editor.getTextValue(), 1);
      return false;
    }
    return true;    // don't stop propagation.
  }

  private _offerToMakeFormula() {
    const editorDom = this._editorHolder.get()?.getDom();
    if (!editorDom) { return; }
    showTooltipToCreateFormula(editorDom, () => this._convertEditorToFormula());
  }

  private _convertEditorToFormula() {
    const editor = this._editorHolder.get();
    if (editor) {
      const editValue = editor.getTextValue();
      const formulaValue = editValue.startsWith('=') ? editValue.slice(1) : editValue;
      this._isFormula = true;
      this.rebuildEditor(formulaValue, 0);
    }
  }

  // Cancels the edit
  private _cancelEdit() {
    if (this.isDisposed()) { return; }
    const event: FieldEditorStateEvent = {
      position : this.cellPosition(),
      wasModified : this._editorHasChanged,
      currentState : this._editorHolder.get()?.editorState?.get(),
      type : this._field.column.peek().pureType.peek()
    };
    this.cancelEmitter.emit(event);
    this.dispose();
  }

  // Returns true if Enter/Shift+Enter should NOT move the cursor, for instance if the current
  // record got reordered (i.e. the cursor jumped), or when editing a formula.
  private async _doSaveEdit(): Promise<boolean> {
    const editor = this._editorHolder.get();
    if (!editor) { return false; }
    // Make sure the editor is save ready
    const saveIndex = this._cursor.rowIndex();
    await editor.prepForSave();
    if (this.isDisposed()) {
      // We shouldn't normally get disposed here, but if we do, avoid confusing JS errors.
      console.warn(t("Unable to finish saving edited cell"));  // tslint:disable-line:no-console
      return false;
    }

    // Then save the value the appropriate way
    // TODO: this isFormula value doesn't actually reflect if editing the formula, since
    // editingFormula() is used for toggling column headers, and this is deferred to start of
    // typing (a double-click or Enter) does not immediately set it. (This can cause a
    // console.warn below, although harmless.)
    const isFormula = this._field.editingFormula();
    const col = this._field.column();
    let waitPromise: Promise<unknown>|null = null;

    if (isFormula) {
      const formula = String(editor.getCellValue() ?? '');
      // Bundle multiple changes so that we can undo them in one step.
      if (isFormula !== col.isFormula.peek() || formula !== col.formula.peek()) {
        waitPromise = this._gristDoc.docData.bundleActions(null, () => Promise.all([
          col.updateColValues({isFormula, formula}),
          // If we're saving a non-empty formula, then also add an empty record to the table
          // so that the formula calculation is visible to the user.
          (!this._detached.get() && this._editRow._isAddRow.peek() && formula !== "" ?
            this._editRow.updateColValues({}) : undefined),
        ]));
      }
    } else {
      const value = editor.getCellValue();
      if (col.isRealFormula()) {
        // tslint:disable-next-line:no-console
        console.warn(t("It should be impossible to save a plain data value into a formula column"));
      } else {
        // This could still be an isFormula column if it's empty (isEmpty is true), but we don't
        // need to toggle isFormula in that case, since the data engine takes care of that.
        waitPromise = setAndSave(this._editRow, this._field, value);
      }
    }

    const event: FieldEditorStateEvent = {
      position : this.cellPosition(),
      wasModified : this._editorHasChanged,
      currentState : this._editorHolder.get()?.editorState?.get(),
      type : this._field.column.peek().pureType.peek()
    };
    this.saveEmitter.emit(event);

    const cursor = this._cursor;
    // Deactivate the editor. We are careful to avoid using `this` afterwards.
    this.dispose();
    await waitPromise;
    return isFormula || (saveIndex !== cursor.rowIndex());
  }
}


/**
 * For an readonly editor, set up its cleanup:
 * - canceling on click-away (when focus returns to Grist "clipboard" element)
 */
function setupReadonlyEditorCleanup(
  owner: MultiHolder, gristDoc: GristDoc, field: ViewFieldRec, cancelEdit: () => any
) {
  // Whenever focus returns to the Clipboard component, close the editor by saving the value.
  gristDoc.app.on('clipboard_focus', cancelEdit);
  owner.onDispose(() => {
    field.editingFormula(false);
    gristDoc.app.off('clipboard_focus', cancelEdit);
  });
}

/**
 * For an active editor, set up its cleanup:
 * - saving on click-away (when focus returns to Grist "clipboard" element)
 * - unset field.editingFormula mode
 * - Arrange for UnsavedChange protection against leaving the page with unsaved changes.
 */
export function setupEditorCleanup(
  owner: MultiHolder, gristDoc: GristDoc, editingFormula: ko.Computed<boolean>, _saveEdit: () => Promise<unknown>
) {
  const saveEdit = () => _saveEdit().catch(reportError);

  // Whenever focus returns to the Clipboard component, close the editor by saving the value.
  gristDoc.app.on('clipboard_focus', saveEdit);

  // TODO: This should ideally include a callback that returns true only when the editor value
  // has changed. Currently an open editor is considered unsaved even when unchanged.
  UnsavedChange.create(owner, async () => { await saveEdit(); });

  owner.onDispose(() => {
    gristDoc.app.off('clipboard_focus', saveEdit);
    // Unset field.editingFormula flag when the editor closes.
    editingFormula(false);
  });
}
