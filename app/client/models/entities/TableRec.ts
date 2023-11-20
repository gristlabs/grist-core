import {KoArray} from 'app/client/lib/koArray';
import {DocModel, IRowModel, recordSet, refRecord, ViewSectionRec} from 'app/client/models/DocModel';
import {ColumnRec, ValidationRec, ViewRec} from 'app/client/models/DocModel';
import * as modelUtil from 'app/client/models/modelUtil';
import {summaryGroupByDescription} from 'app/common/ActiveDocAPI';
import {MANUALSORT} from 'app/common/gristTypes';
import * as ko from 'knockout';
import randomcolor from 'randomcolor';

// Represents a user-defined table.
export interface TableRec extends IRowModel<"_grist_Tables"> {
  columns: ko.Computed<KoArray<ColumnRec>>;
  visibleColumns: ko.Computed<ColumnRec[]>;
  validations: ko.Computed<KoArray<ValidationRec>>;

  primaryView: ko.Computed<ViewRec>;
  rawViewSection: ko.Computed<ViewSectionRec>;
  recordCardViewSection: ko.Computed<ViewSectionRec>;
  summarySource: ko.Computed<TableRec>;

  // A Set object of colRefs for all summarySourceCols of table.
  summarySourceColRefs: ko.Computed<Set<number>>;

  // tableId for normal tables, or tableId of the source table for summary tables.
  primaryTableId: ko.Computed<string>;

  // The list of grouped by columns.
  groupByColumns: ko.Computed<ColumnRec[]>;
  // Grouping description.
  groupDesc: ko.PureComputed<string>;
  // Name of the data table - title of the rawViewSection
  // for summary table it is name of primary table.
  tableName: modelUtil.KoSaveableObservable<string>;
  // Table name with a default value (which is tableId).
  tableNameDef: modelUtil.KoSaveableObservable<string>;
  // Like tableNameDef, but formatted to be more suitable for displaying to
  // users (e.g. including group columns for summary tables).
  formattedTableName: ko.PureComputed<string>;
  // If user can select this table in various places.
  // Note: Some hidden tables can still be visible on RawData view.
  isHidden: ko.Computed<boolean>;

  tableColor: string;
  disableAddRemoveRows: ko.Computed<boolean>;
  supportsManualSort: ko.Computed<boolean>;
}

export function createTableRec(this: TableRec, docModel: DocModel): void {
  this.columns = recordSet(this, docModel.columns, 'parentId', {sortBy: 'parentPos'});
  this.visibleColumns = this.autoDispose(ko.pureComputed(() =>
    this.columns().all().filter(c => !c.isHiddenCol())));
  this.validations = recordSet(this, docModel.validations, 'tableRef');

  this.primaryView = refRecord(docModel.views, this.primaryViewId);
  this.rawViewSection = refRecord(docModel.viewSections, this.rawViewSectionRef);
  this.recordCardViewSection = refRecord(docModel.viewSections, this.recordCardViewSectionRef);
  this.summarySource = refRecord(docModel.tables, this.summarySourceTable);
  this.isHidden = this.autoDispose(
    // This is repeated logic from isHiddenTable.
    ko.pureComputed(() => !this.tableId() || !!this.summarySourceTable() || this.tableId().startsWith("GristHidden_"))
  );

  // A Set object of colRefs for all summarySourceCols of this table.
  this.summarySourceColRefs = this.autoDispose(ko.pureComputed(() => new Set(
    this.columns().all().map(c => c.summarySourceCol()).filter(colRef => colRef))));

  // tableId for normal tables, or tableId of the source table for summary tables.
  this.primaryTableId = ko.pureComputed(() =>
    this.summarySourceTable() ? this.summarySource().tableId() : this.tableId());

  this.groupByColumns = ko.pureComputed(() => this.columns().all().filter(c => c.summarySourceCol()));

  this.groupDesc = ko.pureComputed(() => {
    if (!this.summarySourceTable()) {
      return '';
    }
    return summaryGroupByDescription(this.groupByColumns().map(c => c.label()));
  });

  // TODO: We should save this value and let users change it.
  this.tableColor = randomcolor({
    luminosity: 'light',
    seed: typeof this.id() === 'number' ? 5 * this.id() : this.id()
  });

  this.disableAddRemoveRows = ko.pureComputed(() => Boolean(this.summarySourceTable()));

  this.supportsManualSort = ko.pureComputed(() => this.columns().all().some(c => c.colId() === MANUALSORT));

  this.tableName = modelUtil.savingComputed({
    read: () => {
      if (this.isDisposed()) {
        return '';
      }
      if (this.summarySourceTable()) {
        return this.summarySource().rawViewSection().title();
      } else {
        // Need to be extra careful here, rawViewSection might be disposed.
        if (this.rawViewSection().isDisposed()) {
          return '';
        }
        return this.rawViewSection().title();
      }
    },
    write: (setter, val) => {
      if (this.summarySourceTable()) {
        setter(this.summarySource().rawViewSection().title, val);
      } else {
        setter(this.rawViewSection().title, val);
      }
    }
  });
  this.tableNameDef = modelUtil.fieldWithDefault(
    this.tableName,
    // TableId will be null/undefined when ACL will restrict access to it.
    ko.computed(() => {
      // During table removal, we could be disposed.
      if (this.isDisposed()) {
        return '';
      }
      const table = this.summarySourceTable() ? this.summarySource() : this;
      return table.tableId() || '';
    })
  );
  this.formattedTableName = ko.pureComputed(() => {
    return this.summarySourceTable()
      ? `${this.tableNameDef()} ${this.groupDesc()}`
      : this.tableNameDef();
  });
}
