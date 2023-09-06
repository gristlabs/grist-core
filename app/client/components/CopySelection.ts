import type {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import type {CellValue} from 'app/common/DocActions';
import type {TableData} from 'app/common/TableData';
import type {UIRowId} from 'app/plugin/GristAPI';

/**
 * The CopySelection class is an abstraction for a subset of currently selected cells.
 * @param {Array} rowIds - row ids of the rows selected
 * @param {Array} fields - MetaRowModels of the selected view fields
 * @param {Object} options.rowStyle - an object that maps rowId to an object containing
 * style options. i.e. { 1: { height: 20px } }
 * @param {Object} options.colStyle - an object that maps colId to an object containing
 * style options.
 */
export class CopySelection {
  public readonly colIds = this.fields.map(f => f.colId());
  public readonly colRefs = this.fields.map(f => f.colRef());
  public readonly displayColIds = this.fields.map(f => f.displayColModel().colId());
  public readonly rowStyle: {[r: number]: object}|undefined;
  public readonly colStyle: {[c: string]: object}|undefined;

  public readonly columns: Array<{
    colId: string,
    fmtGetter: (rowId: UIRowId) => string,
    rawGetter: (rowId: UIRowId) => CellValue|undefined,
  }>;

  constructor(tableData: TableData, public readonly rowIds: UIRowId[], public readonly fields: ViewFieldRec[],
              options: {
                rowStyle?: {[r: number]: object},
                colStyle?: {[c: string]: object},
              }
  ) {
    this.rowStyle = options.rowStyle;
    this.colStyle = options.colStyle;
    this.columns = fields.map((f, i) => {
      const formatter = f.formatter();
      const _fmtGetter = tableData.getRowPropFunc(this.displayColIds[i])!;
      const _rawGetter = tableData.getRowPropFunc(this.colIds[i])!;

      return {
        colId: this.colIds[i],
        fmtGetter: rowId => formatter.formatAny(_fmtGetter(rowId)),
        rawGetter: rowId => _rawGetter(rowId)
      };
    });
  }

  public isCellSelected(rowId: UIRowId, colId: string): boolean {
    return this.rowIds.includes(rowId) && this.colIds.includes(colId);
  }

  public onlyAddRowSelected(): boolean {
    return this.rowIds.length === 1 && this.rowIds[0] === "new";
  }
}
