import {GristDoc} from 'app/client/components/GristDoc';
import {ACIndex, ACResults} from 'app/client/lib/ACIndex';
import {makeT} from 'app/client/lib/localization';
import {ICellItem} from 'app/client/models/ColumnACIndexes';
import {ColumnCache} from 'app/client/models/ColumnCache';
import {ColumnRec} from 'app/client/models/entities/ColumnRec';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {TableData} from 'app/client/models/TableData';
import {getReferencedTableId, isRefListType} from 'app/common/gristTypes';
import {EmptyRecordView} from 'app/common/RecordView';
import {BaseFormatter} from 'app/common/ValueFormatter';
import {Disposable, dom, Observable} from 'grainjs';

const t = makeT('ReferenceUtils');

/**
 * Utilities for common operations involving Ref[List] fields.
 */
export class ReferenceUtils extends Disposable {
  public readonly refTableId: string;
  public readonly tableData: TableData;
  public readonly visibleColFormatter: BaseFormatter;
  public readonly visibleColModel: ColumnRec;
  public readonly visibleColId: string;
  public readonly isRefList: boolean;
  public readonly hasDropdownCondition = Boolean(this.field.dropdownCondition.peek()?.text);

  private readonly _columnCache: ColumnCache<ACIndex<ICellItem>>;
  private readonly _docData = this._gristDoc.docData;
  private _dropdownConditionError = Observable.create<string | null>(this, null);

  constructor(public readonly field: ViewFieldRec, private readonly _gristDoc: GristDoc) {
    super();

    const colType = field.column().type();
    const refTableId = getReferencedTableId(colType);
    if (!refTableId) {
      throw new Error("Non-Reference column of type " + colType);
    }
    this.refTableId = refTableId;

    const tableData = this._docData.getTable(refTableId);
    if (!tableData) {
      throw new Error("Invalid referenced table " + refTableId);
    }
    this.tableData = tableData;

    this.visibleColFormatter = field.visibleColFormatter();
    this.visibleColModel = field.visibleColModel();
    this.visibleColId = this.visibleColModel.colId() || 'id';
    this.isRefList = isRefListType(colType);

    this._columnCache = new ColumnCache<ACIndex<ICellItem>>(this.tableData);
  }

  public idToText(value: unknown) {
    if (typeof value === 'number') {
      return this.visibleColFormatter.formatAny(this.tableData.getValue(value, this.visibleColId));
    }
    return String(value || '');
  }

  /**
   * Searches the autocomplete index for the given `text`, returning
   * all matching results and related metadata.
   *
   * If a dropdown condition is set, results are dependent on the `rowId`
   * that the autocomplete dropdown is open in. Otherwise, `rowId` has no
   * effect.
   */
  public autocompleteSearch(text: string, rowId: number): ACResults<ICellItem> {
    let acIndex: ACIndex<ICellItem>;
    if (this.hasDropdownCondition) {
      try {
        acIndex = this._getDropdownConditionACIndex(rowId);
      } catch (e) {
        this._dropdownConditionError?.set(e);
        return {items: [], extraItems: [], highlightFunc: () => [], selectIndex: -1};
      }
    } else {
      acIndex = this.tableData.columnACIndexes.getColACIndex(
        this.visibleColId,
        this.visibleColFormatter,
      );
    }
    return acIndex.search(text);
  }

  public buildNoItemsMessage() {
    return dom.domComputed(use => {
      const error = use(this._dropdownConditionError);
      if (error) { return t('Error in dropdown condition'); }

      return this.hasDropdownCondition
        ? t('No choices matching condition')
        : t('No choices to select');
    });
  }

  /**
   * Returns a column index for the visible column, filtering the items in the
   * index according to the set dropdown condition.
   *
   * This method is similar to `this.tableData.columnACIndexes.getColACIndex`,
   * but whereas that method caches indexes globally, this method does so
   * locally (as a new instances of this class is created each time a Reference
   * or Reference List editor is created).
   *
   * It's important that this method be used when a dropdown condition is set,
   * as items in indexes that don't satisfy the dropdown condition need to be
   * filtered.
   */
  private _getDropdownConditionACIndex(rowId: number) {
    return this._columnCache.getValue(
      this.visibleColId,
      () => this.tableData.columnACIndexes.buildColACIndex(
        this.visibleColId,
        this.visibleColFormatter,
        this._buildDropdownConditionACFilter(rowId)
      )
    );
  }

  private _buildDropdownConditionACFilter(rowId: number) {
    const dropdownConditionCompiled = this.field.dropdownConditionCompiled.get();
    if (dropdownConditionCompiled?.kind !== 'success') {
      throw new Error('Dropdown condition is not compiled');
    }

    const tableId = this.field.tableId.peek();
    const table = this._docData.getTable(tableId);
    if (!table) { throw new Error(`Table ${tableId} not found`); }

    const {result: predicate} = dropdownConditionCompiled;
    const user = this._gristDoc.docPageModel.user.get() ?? undefined;
    const rec = table.getRecord(rowId) || new EmptyRecordView();
    return (item: ICellItem) => {
      const choice = item.rowId === 'new' ? new EmptyRecordView() : this.tableData.getRecord(item.rowId);
      if (!choice) { throw new Error(`Reference ${item.rowId} not found`); }

      return predicate({user, rec, choice});
    };
  }
}

export function nocaseEqual(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
