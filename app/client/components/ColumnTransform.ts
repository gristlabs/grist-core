/**
 * ColumnTransform is used as a abstract base class for any classes which must build a dom for the
 * purpose of allowing the user to transform a column. It is currently extended by FormulaTransform
 * and TypeTransform.
 */
import * as commands from 'app/client/components/commands';
import {GristDoc} from 'app/client/components/GristDoc';
import {ColumnRec} from 'app/client/models/entities/ColumnRec';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {TableData} from 'app/client/models/TableData';
import {FieldBuilder} from 'app/client/widgets/FieldBuilder';
import {Disposable, Observable} from 'grainjs';
import * as ko from 'knockout';
import noop = require('lodash/noop');

// To simplify diff (avoid rearranging methods to satisfy private/public order).
// tslint:disable:member-ordering

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

    // This is set to true in the interval between execute() and dispose().
  private _isExecuting: boolean = false;

  constructor(protected gristDoc: GristDoc, private _fieldBuilder: FieldBuilder) {
    super();
    this.field = _fieldBuilder.field;
    this.origColumn = this.field.column();
    this.origDisplayCol = this.field.displayColModel();
    this.origWidgetOptions = this.field.widgetOptionsJson();
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

  public finalize() {
    // Implemented in FormulaTransform.
  }

  /**
   * Build general transform editor dom.
   * @param {String} optInit - Optional initial value for the editor.
   */
  protected buildEditorDom(optInit?: string) {
    return this.editor.buildDom((aceObj: any) => {
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
   * Helper called by contructor to prepare the column transform.
   * @param {String} colType: A pure or complete type for the transformed column.
   */
  public async prepare(colType?: string) {
    colType = colType || this.origColumn.type.peek();
    // Start bundling all actions during the transform, but include a verification callback to ensure
    // no errant actions are added to the bundle.
    this._tableData.docData.startBundlingActions(`Transformed column ${this.origColumn.colId()}.`,
      action => (action[2] === "gristHelper_Transform" || action[1] === "_grist_Tables_column" ||
        action[0] === "SetDisplayFormula" || action[1] === "_grist_Views_section_field"));
    this.isCallPending(true);
    try {
      const newColRef = await this.addTransformColumn(colType);
      // Set DocModel references
      this.field.colRef(newColRef);
      this.transformColumn = this.field.column();
      this.transformColumn.origColRef(this.origColumn.getRowId());
      this._setTransforming(true);
      return await this.postAddTransformColumn();
    } finally {
      this.isCallPending(false);
    }
  }

  /**
   * Adds the tranform column and returns its colRef. May be overridden by derived classes to create
   * differently-prepared transform columns.
   * @param {String} colType: A pure or complete type for the transformed column.
   */
  protected async addTransformColumn(colType: string): Promise<number> {
    // Retrieve widget options on prepare (useful for type transforms)
    const newColInfo = await this._tableData.sendTableAction(['AddColumn', "gristHelper_Transform", {
      type: colType, isFormula: true, formula: this.getIdentityFormula(),
    }]);
    return newColInfo.colRef;
  }

  /**
   * A derived class can override to do some processing after this.transformColumn has been set.
   */
  protected postAddTransformColumn() {
    // Nothing in base class.
  }

  public cancel() {
    this.field.colRef(this.origColumn.getRowId());
    this._tableData.sendTableAction(['RemoveColumn', this.transformColumn.colId()]);
    // TODO: Cancelling a column transform should cancel all involved useractions.
    this._tableData.docData.stopBundlingActions();
    this.dispose();
  }

  // TODO: Values flicker during executing since transform column remains a formula as values are copied
  // back to the original column. The CopyFromColumn useraction really ought to be "CopyAndRemove" since
  // that seems the best way to avoid calculating the formula on wrong values.
  protected async execute() {
    if (this._isExecuting) {
      return;
    }
    this._isExecuting = true;

    // Define variables used in '.then' since this may be disposed
    const transformColId = this.transformColumn.colId();
    const field = this.field;
    const fieldBuilder = this._fieldBuilder;
    const origRef = this.origColumn.getRowId();
    const tableData = this._tableData;
    this.isCallPending(true);

    try {
      return await tableData.sendTableAction(['CopyFromColumn', transformColId, this.origColumn.colId(),
        JSON.stringify(fieldBuilder.options())]);
    } finally {
      // Wait until the change completed to set column back, to avoid value flickering.
      field.colRef(origRef);
      tableData.sendTableAction(['RemoveColumn', transformColId]);
      tableData.docData.stopBundlingActions();
      this.dispose();
    }
  }

  protected getIdentityFormula() {
    return 'return $' + this.origColumn.colId();
  }

  protected _setTransforming(bool: boolean) {
    this.origColumn.isTransforming(bool);
    this.transformColumn.isTransforming(bool);
  }

  protected isExecuting(): boolean {
    return this._isExecuting;
  }
}
