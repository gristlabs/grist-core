/**
 * NewAbstractWidget is equivalent to AbstractWidget for outside code, but is in typescript, and
 * so is friendlier and clearer to derive TypeScript classes from.
 */
import {DocComm} from 'app/client/components/DocComm';
import {DocData} from 'app/client/models/DocData';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {SaveableObjObservable} from 'app/client/models/modelUtil';
import {cssLabel, cssRow} from 'app/client/ui/RightPanel';
import {colorSelect} from 'app/client/ui2018/buttonSelect';
import {colors, testId} from 'app/client/ui2018/cssVars';
import {BaseFormatter, createFormatter} from 'app/common/ValueFormatter';
import {Disposable, DomContents, fromKo, Observable, styled} from 'grainjs';
import * as ko from 'knockout';


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

  constructor(protected field: ViewFieldRec) {
    super();
    this.options = field.widgetOptionsJson;
    this.textColor = fromKo(this.field.textColor);
    this.fillColor = fromKo(this.field.fillColor);

    // Note that its easier to create a knockout computed from the several knockout observables,
    // but then we turn it into a grainjs observable.
    const formatter = this.autoDispose(ko.computed(() =>
      createFormatter(field.displayColModel().type(), this.options())));
    this.valueFormatter = fromKo(formatter);
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
        cssHalfWidth(
          colorSelect(
            this.textColor,
            (val) => this.field.textColor.saveOnly(val),
            testId('text-color')
          ),
          cssInlineLabel('Text'),
        ),
        cssHalfWidth(
          colorSelect(
            this.fillColor,
            (val) => this.field.fillColor.saveOnly(val),
            testId('fill-color')
          ),
          cssInlineLabel('Fill')
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

export const cssHalfWidth = styled('div', `
  display: flex;
  flex: 1 1 50%;
  align-items: center;
`);

export const cssInlineLabel = styled('span', `
  margin: 0 8px;
  color: ${colors.dark};
`);
