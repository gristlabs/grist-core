/**
 * NewAbstractWidget is equivalent to AbstractWidget for outside code, but is in typescript, and
 * so is friendlier and clearer to derive TypeScript classes from.
 */
import {DocComm} from 'app/client/components/DocComm';
import {GristDoc} from 'app/client/components/GristDoc';
import {DocData} from 'app/client/models/DocData';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {SaveableObjObservable} from 'app/client/models/modelUtil';
import {theme} from 'app/client/ui2018/cssVars';
import {CellStyle} from 'app/client/widgets/CellStyle';
import {BaseFormatter} from 'app/common/ValueFormatter';
import {
  Disposable,
  dom,
  DomContents,
  fromKo,
  IDisposableOwnerT,
  Observable,
} from 'grainjs';

export interface Options {
  /**
   * CSS value of the default widget text color. Defaults to the current theme's
   * cell fg color.
   */
  defaultTextColor?: string;
}

/**
 * NewAbstractWidget - The base of the inheritance tree for widgets.
 * @param {Function} field - The RowModel for this view field.
 */
export abstract class NewAbstractWidget extends Disposable {
  /**
   * Override the create() method to match the parameters of create() expected by FieldBuilder.
   */
  // We copy Disposable.create() signature (the second one) to pacify typescript, but code must
  // use the first signature, which is compatible with old-style constructors.
  public static create<T extends new (...args: any[]) => any>(field: ViewFieldRec): InstanceType<T>;
  public static create<T extends new (...args: any[]) => any>(
    this: T, owner: IDisposableOwnerT<InstanceType<T>>|null, ...args: ConstructorParameters<T>): InstanceType<T>;
  public static create(...args: any[]) {
    return Disposable.create.call(this as any, null, ...args);
  }

  protected options: SaveableObjObservable<any>;
  protected valueFormatter: Observable<BaseFormatter>;
  protected textColor: Observable<string>;
  protected fillColor: Observable<string>;
  protected readonly defaultTextColor: string|undefined = this._opts.defaultTextColor
    ?? theme.cellFg.toString();

  constructor(protected field: ViewFieldRec, private _opts: Options = {}) {
    super();
    this.options = field.widgetOptionsJson;
    this.valueFormatter = fromKo(field.formatter);
  }

  /**
   * Builds the DOM showing configuration buttons and fields in the sidebar.
   */
  public buildConfigDom(): DomContents {
    return null;
  }

  /**
   * Builds the transform prompt config DOM in the few cases where it is necessary.
   * Child classes need not override this function if they do not require transform config options.
   */
  public buildTransformConfigDom(): DomContents {
    return null;
  }

  public buildColorConfigDom(gristDoc: GristDoc): DomContents {
    return dom.create(CellStyle, this.field, gristDoc, this.defaultTextColor);
  }

  public buildFormConfigDom(): DomContents {
    return null;
  }

  public buildFormTransformConfigDom(): DomContents {
    return null;
  }

  /**
   * Builds the data cell DOM.
   * @param {DataRowModel} row - The rowModel object.
   */
  public abstract buildDom(row: any): Element;

  /**
   * Returns the DocData object to which this field belongs.
   */
  protected _getDocData(): DocData {
    // TODO: There should be a better way to access docData and docComm, or better yet GristDoc.
    return this.field._table.tableData.docData;
  }

  /**
   * Returns the docComm object for communicating with the server.
   */
  protected _getDocComm(): DocComm {
    return this._getDocData().docComm;
  }
}
