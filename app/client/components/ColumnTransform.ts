/**
 * ColumnTransform is used as a abstract base class for any classes which must build a dom for the
 * purpose of allowing the user to transform a column. It is currently extended by FormulaTransform
 * and TypeTransform.
 */
import * as commands from 'app/client/components/commands';
import * as AceEditor from 'app/client/components/AceEditor';
import {GristDoc} from 'app/client/components/GristDoc';
import {ColumnRec} from 'app/client/models/entities/ColumnRec';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {TableData} from 'app/client/models/TableData';
import {FieldBuilder} from 'app/client/widgets/FieldBuilder';
import {UserAction} from 'app/common/DocActions';
import {GristObjCode} from 'app/plugin/GristData';
import {Disposable, Observable} from 'grainjs';
import isPlainObject from 'lodash/isPlainObject';
import * as ko from 'knockout';
import noop = require('lodash/noop');

// To simplify diff (avoid rearranging methods to satisfy private/public order).
/* eslint-disable @typescript-eslint/member-ordering */

type AceEditor = any;

/**
 * Abstract class for FormulaTransform and TypeTransform to extend. Initializes properties needed
 * for both types of transform. optPureType is useful for initializing type transforms.
 */
export class ColumnTransform extends Disposable {
  protected field: ViewFieldRec;
  protected origColumn: ColumnRec;
  protected origDisplayCol: ColumnRec;
  protected transformColumn: ColumnRec;                 // Set in prepare()
  protected origWidgetOptions: unknown;
  protected isCallPending: ko.Observable<boolean>;
  protected editor: AceEditor|null = null;              // Created when the dom is built by extending classes
  protected formulaUpToDate = Observable.create(this, true);
  protected _tableData: TableData;
  protected rules: [GristObjCode.List, ...number[]]|null;

  // Whether _doFinalize should execute the transform, or cancel it.
  protected _shouldExecute: boolean = false;

  // Ask DocData to finalize the action bundle by calling the finalize callback provided to
  // startBundlingActions. Finalizing should always be triggered this way, for a uniform flow,
  // since finalizing could be triggered either from DocData or from cancel/execute methods.
  // This is a noop until startBundlingActions is called.
  private _triggerFinalize: (() => void) = noop;

  // This is set to true once finalize has started.
  private _isFinalizing: boolean = false;

  constructor(protected gristDoc: GristDoc, private _fieldBuilder: FieldBuilder) {
    super();
    this.field = _fieldBuilder.field;
    this.origColumn = this.field.column();
    this.origDisplayCol = this.field.displayColModel();
    this.origWidgetOptions = this.field.widgetOptionsJson();
    this.rules = this.origColumn.rules();
    this.isCallPending = _fieldBuilder.isCallPending;

    this._tableData = gristDoc.docData.getTable(this.origColumn.table().tableId())!;

    this.autoDispose(commands.createGroup({
      undo: this.cancel,
      redo: noop
    }, this, true));

    this.onDispose(() => {
      this._setTransforming(false);
      this._fieldBuilder.columnTransform = null;
      this.isCallPending(false);
    });
  }

  /**
   * Build dom function should be implemented by extending classes.
   */
  public buildDom() {
    throw new Error("Not Implemented");
  }

  public async finalize(): Promise<void> {
    return this._triggerFinalize();
  }

  /**
   * Build general transform editor dom.
   * @param {String} optInit - Optional initial value for the editor.
   */
  protected buildEditorDom(optInit?: string) {
    if (!this.editor) {
      this.editor = this.autoDispose(AceEditor.create({
        gristDoc: this.gristDoc,
        observable: this.transformColumn.formula,
        saveValueOnBlurEvent: false,
      }));
    }
    return this.editor.buildDom((aceObj: any) => {
      aceObj.setOptions({placeholder: 'Enter formula.'});
      aceObj.setHighlightActiveLine(false);
      this.editor.adjustContentToWidth();
      this.editor.attachSaveCommand();
      aceObj.on('change', () => {
        if (this.editor) {
          this.formulaUpToDate.set(this.editor.getValue() === this.transformColumn.formula());
        }
      });
      aceObj.focus();
    });
  }

  /**
   * Helper called by constructor to prepare the column transform.
   * @param {String} colType: A pure or complete type for the transformed column.
   */
  public async prepare(optColType?: string) {
    const colType: string = optColType || this.origColumn.type.peek();

    // Start bundling all actions during the transform. The verification callback ensures
    // no errant actions are added to the bundle; if there are, finalize is immediately called.
    const bundlingInfo = this._tableData.docData.startBundlingActions({
      description: `Transformed column ${this.origColumn.colId()}.`,
      shouldIncludeInBundle: this._shouldIncludeInBundle.bind(this),
      prepare: this._doPrepare.bind(this, colType),
      finalize: this._doFinalize.bind(this)
    });

    // triggerFinalize tells DocData to call the finalize callback we passed above; this way
    // DocData knows when it's finished.
    this._triggerFinalize = bundlingInfo.triggerFinalize;

    // preparePromise resolves once prepare() callback has got a chance to run and finish.
    await bundlingInfo.preparePromise;
  }

  private async _doPrepare(colType: string) {
    if (this.isDisposed()) { return; }
    this.isCallPending(true);
    try {
      const newColRef = await this.addTransformColumn(colType);
      // Set DocModel references
      this.field.colRef(newColRef);
      this.transformColumn = this.field.column();
      this.transformColumn.origColRef(this.origColumn.getRowId());
      this._setTransforming(true);
      return this.postAddTransformColumn();
    } finally {
      this.isCallPending(false);
    }
  }

  private _shouldIncludeInBundle(actions: UserAction[]) {
    // Allow certain expected actions. If we encounter anything else, the user must have
    // started doing something else, and we should finalize the transform.
    return actions.every(action => (
      // ['AddColumn', USER_TABLE, 'gristHelper_Transform', colInfo]
      (action[2]?.toString().startsWith('gristHelper_Transform')) ||
      // ['AddColumn', USER_TABLE, 'gristHelper_Converted', colInfo]
      (action[2]?.toString().startsWith('gristHelper_Converted')) ||
      // ['ConvertFromColumn', USER_TABLE, SOURCE_COLUMN, 'gristHelper_Converted']
      (action[3]?.toString().startsWith('gristHelper_Converted')) ||
      // ["SetDisplayFormula", USER_TABLE, ...]
      (action[0] === 'SetDisplayFormula') ||
      // ['UpdateRecord', '_grist_Table_column', transformColId, ...]
      (action[1] === '_grist_Tables_column') ||
      // ['UpdateRecord', '_grist_Views_section_field', transformColId, ...] (e.g. resize)
      (action[1] === '_grist_Views_section_field')
    ));
  }

  /**
   * Adds the transform column and returns its colRef. May be overridden by derived classes to create
   * differently-prepared transform columns.
   * @param {String} colType: A pure or complete type for the transformed column.
   */
  protected async addTransformColumn(colType: string): Promise<number> {
    // Retrieve widget options on prepare (useful for type transforms)
    const newColInfo = await this._tableData.sendTableAction(['AddColumn', "gristHelper_Transform", {
      type: colType,
      isFormula: true,
      formula: this.getIdentityFormula(),
      ...(this.origWidgetOptions ? {widgetOptions: JSON.stringify(this.origWidgetOptions)} : {}),
    }]);
    if (this.rules) {
      // We are in bundle, it is safe to just send another action.
      // NOTE: We could add rules with AddColumn action, but there are some optimizations that converts array values.
      await this.gristDoc.docData.sendActions([
        ['UpdateRecord', '_grist_Tables_column', newColInfo.colRef, {rules: this.rules}]
      ]);
    }

    return newColInfo.colRef;
  }

  /**
   * A derived class can override to do some processing after this.transformColumn has been set.
   */
  protected postAddTransformColumn(): void {
    // Nothing in base class.
  }

  public async cancel(): Promise<void> {
    this._shouldExecute = false;
    return this._triggerFinalize();
  }

  protected async execute(): Promise<void> {
    this._shouldExecute = true;
    return this._triggerFinalize();
  }

  // This is passed as a callback to startBundlingActions(), and should NOT be called directly.
  // Instead, call _triggerFinalize() is used to trigger it.
  private async _doFinalize(): Promise<void> {
    if (this.isDisposed() || this._isFinalizing) {
      return;
    }
    this._isFinalizing = true;

    // Define variables used after await, since this will be disposed by then.
    const transformColId = this.transformColumn.colId();
    const field = this.field;
    const origRef = this.origColumn.getRowId();
    const tableData = this._tableData;
    this.isCallPending(true);
    try {
      if (this._shouldExecute) {
        // TODO: Values flicker during executing since transform column remains a formula as values are copied
        // back to the original column. The CopyFromColumn useraction really ought to be "CopyAndRemove" since
        // that seems the best way to avoid calculating the formula on wrong values.
        await this.gristDoc.docData.sendActions(this.executeActions());
      }
    } finally {
      // Wait until the change completed to set column back, to avoid value flickering.
      field.colRef(origRef);
      void tableData.sendTableAction(['RemoveColumn', transformColId]);
      this.cleanup();
      this.dispose();
    }
  }

  /**
   * The user actions to send when actually executing the transform.
   */
  protected executeActions(): UserAction[] {
    const newWidgetOptions = isPlainObject(this.origWidgetOptions) ?
     {...this.origWidgetOptions as object, ...this._fieldBuilder.options.peek()} :
     this._fieldBuilder.options.peek();
    return [
      ...this.previewActions(),
      [
        'CopyFromColumn',
        this._tableData.tableId,
        this.transformColumn.colId.peek(),
        this.origColumn.colId.peek(),
        // Get the options from builder rather the transforming columns.
        // Those options are supposed to be set by prepTransformColInfo(TypeTransform) and
        // adjusted by client.
        // TODO: is this really needed? Aren't those options already in the data-engine?
        JSON.stringify(newWidgetOptions),
      ],
    ];
  }

  protected cleanup() {
    // For overriding
  }

  protected getIdentityFormula() {
    return 'return $' + this.origColumn.colId();
  }

  protected _setTransforming(bool: boolean) {
    this.origColumn.isTransforming(bool);
    this.transformColumn.isTransforming(bool);
  }

  protected isFinalizing(): boolean {
    return this._isFinalizing;
  }

  protected preview() {
    if (!this.editor) { return; }
    return this.editor.writeObservable();
  }

  /**
   * Generates final actions before executing the transform. Used only when the editor was created.
   */
  protected previewActions(): UserAction[] {
    if (!this.editor) { return []; }
    const formula = this.editor.getValue();
    const oldFormula = this.transformColumn.formula();
    if (formula === oldFormula) { return []; }
    if (!formula && !oldFormula) { return []; }
    return [
      ['UpdateRecord', '_grist_Tables_column', this.transformColumn.getRowId(), {formula}]
    ];
  }
}
