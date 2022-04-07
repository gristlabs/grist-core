/**
 * NewAbstractWidget is equivalent to AbstractWidget for outside code, but is in typescript, and
 * so is friendlier and clearer to derive TypeScript classes from.
 */
import {DocComm} from 'app/client/components/DocComm';
import {GristDoc} from 'app/client/components/GristDoc';
import {DocData} from 'app/client/models/DocData';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {SaveableObjObservable} from 'app/client/models/modelUtil';
import {CellStyle} from 'app/client/widgets/CellStyle';
import {BaseFormatter} from 'app/common/ValueFormatter';
import {
  Disposable,
  dom,
  DomContents,
  fromKo,
  Observable,
} from 'grainjs';

export interface Options {
  // A hex value to set the default widget text color. Default to '#000000' if omitted.
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
  public static create(field: ViewFieldRec) {
    return Disposable.create.call(this as any, null, field);
  }

  protected options: SaveableObjObservable<any>;
  protected valueFormatter: Observable<BaseFormatter>;
  protected textColor: Observable<string>;
  protected fillColor: Observable<string>;
  protected readonly defaultTextColor: string;

  constructor(protected field: ViewFieldRec, opts: Options = {}) {
    super();
    this.options = field.widgetOptionsJson;
    this.valueFormatter = fromKo(field.formatter);
    this.defaultTextColor = opts?.defaultTextColor || '#000000';
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
