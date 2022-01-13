/**
 * NewAbstractWidget is equivalent to AbstractWidget for outside code, but is in typescript, and
 * so is friendlier and clearer to derive TypeScript classes from.
 */
import {DocComm} from 'app/client/components/DocComm';
import {DocData} from 'app/client/models/DocData';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {SaveableObjObservable} from 'app/client/models/modelUtil';
import {cssLabel, cssRow} from 'app/client/ui/RightPanel';
import {colorSelect} from 'app/client/ui2018/ColorSelect';
import {BaseFormatter} from 'app/common/ValueFormatter';
import {Computed, Disposable, DomContents, fromKo, Observable} from 'grainjs';


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

  constructor(protected field: ViewFieldRec, opts: Options = {}) {
    super();
    const {defaultTextColor = '#000000'} = opts;
    this.options = field.widgetOptionsJson;
    this.textColor = Computed.create(this, (use) => (
      use(this.field.textColor) || defaultTextColor
    )).onWrite((val) => this.field.textColor(val === defaultTextColor ? undefined : val));
    this.fillColor = fromKo(this.field.fillColor);

    this.valueFormatter = fromKo(field.formatter);
  }

  /**
   * Builds the DOM showing configuration buttons and fields in the sidebar.
   */
  public buildConfigDom(): DomContents { return null; }

  /**
   * Builds the transform prompt config DOM in the few cases where it is necessary.
   * Child classes need not override this function if they do not require transform config options.
   */
  public buildTransformConfigDom(): DomContents { return null; }

  public buildColorConfigDom(): Element[] {
    return [
      cssLabel('CELL COLOR'),
      cssRow(
        colorSelect(
          this.textColor,
          this.fillColor,
          // Calling `field.widgetOptionsJson.save()` saves both fill and text color settings.
          () => this.field.widgetOptionsJson.save()
        )
      )
    ];
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
  protected _getDocComm(): DocComm { return this._getDocData().docComm; }
}
