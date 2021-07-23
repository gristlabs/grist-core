import {DataRowModel} from 'app/client/models/DataRowModel';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {cssLabel, cssRow} from 'app/client/ui/RightPanel';
import {colors, testId} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {IOptionFull, select} from 'app/client/ui2018/menus';
import {NTextBox} from 'app/client/widgets/NTextBox';
import {isFullReferencingType, isVersions} from 'app/common/gristTypes';
import {BaseFormatter} from 'app/common/ValueFormatter';
import {Computed, dom, styled} from 'grainjs';
import * as ko from 'knockout';

/**
 * Reference - The widget for displaying references to another table's records.
 */
export class Reference extends NTextBox {
  protected _formatValue: Computed<(val: any) => string>;

  private _refValueFormatter: ko.Computed<BaseFormatter>;
  private _visibleColRef: Computed<number>;
  private _validCols: Computed<Array<IOptionFull<number>>>;

  constructor(field: ViewFieldRec) {
    super(field);

    this._refValueFormatter = this.autoDispose(ko.computed(() =>
      field.createVisibleColFormatter()));

    this._visibleColRef = Computed.create(this, (use) => use(this.field.visibleColRef));
    // Note that saveOnly is used here to prevent display value flickering on visible col change.
    this._visibleColRef.onWrite((val) => this.field.visibleColRef.saveOnly(val));

    this._validCols = Computed.create(this, (use) => {
      const refTable = use(use(this.field.column).refTable);
      if (!refTable) { return []; }
      return use(use(refTable.columns).getObservable())
        .filter(col => !use(col.isHiddenCol))
        .map<IOptionFull<number>>(col => ({
          label: use(col.label),
          value: col.getRowId(),
          icon: 'FieldColumn',
          disabled: isFullReferencingType(use(col.type)) || use(col.isTransforming)
        }))
        .concat([{label: 'Row ID', value: 0, icon: 'FieldColumn'}]);
    });

    // Computed returns a function that formats cell values.
    this._formatValue = Computed.create(this, (use) => {
      // If the field is pulling values from a display column, use a general-purpose formatter.
      if (use(this.field.displayColRef) !== use(this.field.colRef)) {
        const fmt = use(this._refValueFormatter);
        return (val: any) => fmt.formatAny(val);
      } else {
        const refTable = use(use(this.field.column).refTable);
        const refTableId = refTable ? use(refTable.tableId) : "";
        return (val: any) => val > 0 ? `${refTableId}[${val}]` : "";
      }
    });
  }

  public buildConfigDom() {
    return [
      this.buildTransformConfigDom(),
      cssLabel('CELL FORMAT'),
      super.buildConfigDom()
    ];
  }

  public buildTransformConfigDom() {
    return [
      cssLabel('SHOW COLUMN'),
      cssRow(
        select(this._visibleColRef, this._validCols),
        testId('fbuilder-ref-col-select')
      )
    ];
  }

  public buildDom(row: DataRowModel) {
    const formattedValue = Computed.create(null, (use) => {
      if (use(row._isAddRow) || this.isDisposed() || use(this.field.displayColModel).isDisposed()) {
        // Work around JS errors during certain changes (noticed when visibleCol field gets removed
        // for a column using per-field settings).
        return "";
      }
      const value = row.cells[use(use(this.field.displayColModel).colId)];
      if (!value) { return ""; }
      const content = use(value);
      if (isVersions(content)) {
        // We can arrive here if the reference value is unchanged (viewed as a foreign key)
        // but the content of its displayCol has changed.  Postponing doing anything about
        // this until we have three-way information for computed columns.  For now,
        // just showing one version of the cell.  TODO: elaborate.
        return use(this._formatValue)(content[1].local || content[1].parent);
      }
      return use(this._formatValue)(content);
    });
    return dom('div.field_clip',
      dom.autoDispose(formattedValue),
      dom.style('text-align', this.alignment),
      dom.cls('text_wrapping', this.wrapping),
      cssRefIcon('FieldReference',
        testId('ref-link-icon')
      ),
      dom.text(formattedValue)
    );
  }
}

const cssRefIcon = styled(icon, `
  float: left;
  background-color: ${colors.slate};
  margin: -1px 2px 2px 0;
`);
