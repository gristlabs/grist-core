import {KoArray} from 'app/client/lib/koArray';
import {DocModel, IRowModel, recordSet, refRecord} from 'app/client/models/DocModel';
import {ColumnRec, TableViewRec, ValidationRec, ViewRec} from 'app/client/models/DocModel';
import {MANUALSORT} from 'app/common/gristTypes';
import * as ko from 'knockout';
import toUpper = require('lodash/toUpper');
import * as randomcolor from 'randomcolor';

// Represents a user-defined table.
export interface TableRec extends IRowModel<"_grist_Tables"> {
  columns: ko.Computed<KoArray<ColumnRec>>;
  validations: ko.Computed<KoArray<ValidationRec>>;

  primaryView: ko.Computed<ViewRec>;
  tableViewItems: ko.Computed<KoArray<TableViewRec>>;
  summarySource: ko.Computed<TableRec>;

  // A Set object of colRefs for all summarySourceCols of table.
  summarySourceColRefs: ko.Computed<Set<number>>;

  // tableId for normal tables, or tableId of the source table for summary tables.
  primaryTableId: ko.Computed<string>;

  // The list of grouped by columns.
  groupByColumns: ko.Computed<ColumnRec[]>;

  // The user-friendly name of the table, which is the same as tableId for non-summary tables,
  // and is 'tableId[groupByCols...]' for summary tables.
  tableTitle: ko.Computed<string>;

  tableColor: string;
  disableAddRemoveRows: ko.Computed<boolean>;
  supportsManualSort: ko.Computed<boolean>;
}

export function createTableRec(this: TableRec, docModel: DocModel): void {
  this.columns = recordSet(this, docModel.columns, 'parentId', {sortBy: 'parentPos'});
  this.validations = recordSet(this, docModel.validations, 'tableRef');

  this.primaryView = refRecord(docModel.views, this.primaryViewId);
  this.tableViewItems = recordSet(this, docModel.tableViews, 'tableRef', {sortBy: 'viewRef'});
  this.summarySource = refRecord(docModel.tables, this.summarySourceTable);

  // A Set object of colRefs for all summarySourceCols of this table.
  this.summarySourceColRefs = this.autoDispose(ko.pureComputed(() => new Set(
    this.columns().all().map(c => c.summarySourceCol()).filter(colRef => colRef))));

  // tableId for normal tables, or tableId of the source table for summary tables.
  this.primaryTableId = ko.pureComputed(() =>
    this.summarySourceTable() ? this.summarySource().tableId() : this.tableId());

  this.groupByColumns = ko.pureComputed(() => this.columns().all().filter(c => c.summarySourceCol()));

  const groupByDesc = ko.pureComputed(() => {
    const groupBy = this.groupByColumns();
    return groupBy.length ? 'by ' + groupBy.map(c => c.label()).join(", ") : "Totals";
  });

  // The user-friendly name of the table, which is the same as tableId for non-summary tables,
  // and is 'tableId[groupByCols...]' for summary tables.
  this.tableTitle = ko.pureComputed(() => {
    if (this.summarySourceTable()) {
      return toUpper(this.summarySource().tableId()) + " [" + groupByDesc() + "]";
    }
    return toUpper(this.tableId());
  });

  // TODO: We should save this value and let users change it.
  this.tableColor = randomcolor({
    luminosity: 'light',
    seed: typeof this.id() === 'number' ? 5 * this.id() : this.id()
  });

  this.disableAddRemoveRows = ko.pureComputed(() => Boolean(this.summarySourceTable()));

  this.supportsManualSort = ko.pureComputed(() => this.columns().all().some(c => c.colId() === MANUALSORT));
}
