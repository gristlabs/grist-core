import * as commands from 'app/client/components/commands';
import type {DocComm, GristDoc} from 'app/client/components/GristDoc';
import {ViewLayout, ViewSectionHelper} from 'app/client/components/ViewLayout';
import type BaseRowModel from 'app/client/models/BaseRowModel';
import {DocData} from 'app/client/models/DocData';
import {DocModel, ViewFieldRec, ViewRec} from 'app/client/models/DocModel';
import {QuerySetManager} from 'app/client/models/QuerySet';
import {IEdit, IExternalTable, VirtualTableRegistration} from 'app/client/models/VirtualTable';
import {META_TABLES} from 'app/client/models/VirtualTableMeta';
import type {App} from 'app/client/ui/App';
import type {FieldEditor} from 'app/client/widgets/FieldEditor';
import {WidgetType} from 'app/client/widgets/UserType';
import type {ApplyUAOptions, ApplyUAResult} from 'app/common/ActiveDocAPI';
import {DisposableWithEvents} from 'app/common/DisposableWithEvents';
import {DocAction, getColValues, TableDataAction, UserAction} from 'app/common/DocActions';
import {DocDataCache} from 'app/common/DocDataCache';
import {VirtualId} from 'app/common/SortSpec';
import type {UIRowId} from 'app/plugin/GristAPI';
import {GristType} from 'app/plugin/GristData';
import camelCase from 'camelcase';
import {Disposable, dom, Emitter, Holder, Observable, toKo} from 'grainjs';
import * as ko from 'knockout';
import omit from 'lodash/omit';
import range from 'lodash/range';

/**
 * This is a simple wrapper around VirtualTableRegistration and ExternalTable. It exposes
 * simple API to create a GridView component that is backed by external API source.
 *
 * Sample usage:
 *
 * const table = new VirtualTable({name: 'MyTable'});
 * table.addColumn({label: 'Name', type: 'Text'});
 * table.addColumn({label: 'Age', type: 'Numeric'});
 * table.setData([{Name: 'Alice', Age: 30}, {Name: 'Bob', Age: 40}]);
 *
 * return dom('div', table.buildDom());
 *
 * Or in more functional way
 *
 * return dom('div', dom.create(VirtualTable, {
 *  name: 'MyTable',
 *  columns: [{label: 'Name', type: 'Text'}, {label: 'Age', type: 'Numeric'}],
 *  data: [{Name: 'Alice', Age: 30}, {Name: 'Bob', Age: 40}],
 * });
 *
 * Note: This is first iteration, it will be refined more to completely remove GristDoc dependency.
 */
export class VirtualTable extends Disposable {
  /** JSON array for plain JS objects to show on GridView */
  private _data: Record<string, any>[] = [];
  /** Columns definition. */
  private _columns: Array<ColDef> = [];
  /** In-memory GristDoc created ad hoc just for this virtual table. */
  private _gristDoc: GristDoc;
  /** Name of the table */
  private _name: string;
  /** Function to fetch data from external source */
  private _getData?: () => Promise<any>;

  /** Virtual ids of elements stored in the DocData */
  private _viewId = VirtualId();
  private _sectionId = VirtualId();
  private _tableId = VirtualId();

  private _transformColumns: Array<ColDef> = [];

  constructor(options: {
    name: string;
    columns?: Array<Partial<ColDef> & {label: string}>;
    data?: Record<string, any>[];
    getData?: () => Promise<any>;
  }) {
    super();
    this._name = options.name;
    this._data = options.data || [];
    this._getData = options.getData;
    if (options.columns) {
      options.columns.forEach(col => this.addColumn(col));
    }
  }

  /**
   * Changes the name of the table.
   */
  public rename(name: string) {
    this._name = name;
  }

  /**
   * Adds a column to the virtual table. Only the label is required, other properties are optional.
   */
  public addColumn(...cols: Array<Partial<ColDef> & {label: string}>) {
    this._columns ??= [];
    cols.forEach(col => this._columns.push({type: col.type || 'Any', colId: toId(col.label), ...col}));
  }

  /**
   * Sets the static data for the virtual table.
   */
  public setData(recs: any[]): void
  /**
   * Sets the function to fetch data from external source.
   */
  public setData(func: () => Promise<any>): void
  public setData(args: any) {
    if (typeof args === 'function') {
      this._getData = args;
      return;
    } else {
      this._data = args;
    }
  }

  public buildDom() {
    this._build();
    return dom('div',
      dom.style('flex', '1'),
      dom.create(ViewLayout, this._gristDoc, this._viewId as any),
    );
  }

  private _build() {
    // Check if we were already built.
    if (this._gristDoc) {
      return;
    }

    // Attach virtual id for each column, and convert widgetOptions to a string.
    const columnDefs = this._columns.map(col => ({
      id: VirtualId(),
      ...col,
      widgetOptions: col.widgetOptions ? JSON.stringify(col.widgetOptions) : undefined,
    }));

    this._transformColumns = this._columns.filter(col => col.transform);

    // Prepare fields definition for the view section. By default we show all columns.
    const fieldsDefs = columnDefs.map(col => col.colId);

    // Prepare in memory structures for managing data, the code below is subject to change. It was created
    // by reverse engineering the calls that are made in the Grist codebase. The goal here is to remove this code
    // completely and allow basic Grist components to work without GristDoc.


    // First is the DocComm. We don't need to implement all methods, just the ones that are used by the VirtualTable.
    const docComm: DocComm = {
      fetchTable: async () => null,
      // We are routing all actions to a DocDataCache, an in-memory implementation of DocData that can convert
      // user actions to DocActions and keep the in-memory state of the tables.
      async applyUserActions(actions: UserAction[], options?: ApplyUAOptions): Promise<ApplyUAResult> {
        const processed = await docDataCache.sendTableActions(actions);
        const retValues = processed.flatMap(action => action.retValues);
        return { retValues, actionHash: '', actionNum: 1, isModification: true };
      }
    } as any;

    // Next is the DocData object, it will be managed by the DocDataCache.

    // docData needs at least one record in doc info.
    const metaWithData: typeof META_TABLES = {
      ...META_TABLES,
      _grist_DocInfo: ['TableData', '_grist_DocInfo', [1], {
        docId: ['1'],
        documentSettings: ['{}'],
      }]
    };
    const docData = new DocData(docComm, metaWithData);
    const docDataCache = new DocDataCache();
    docDataCache.docData = docData;


    // _grist_DocInfo

    // Last one is the DocModel. GridView needs this the most, plus some extra methods from GristDoc.
    const docModel = this.autoDispose(new DocModel(docData));

    // Next is wiring up the ExternalTable and VirtualTableRegistration.
    const ext = this.autoDispose(new ExternalTable());
    ext.label = this._name;
    ext.name = `GristHidden_${toId(this._name)}Table`;

    // Before returning data to the ExternalTable to process we will transform it a little bit and then convert
    // it back to TableData format. API we work with, will likely return records (plain JS objects) instead of TableData
    // format.
    ext.fetchAll = () => Promise.resolve(toTableData(ext.name, this._transform(this._data)));
    if (this._getData) {
      // In case we have a function to fetch data, we will use it instead of the static data.
      ext.fetchAll = async () => toTableData(ext.name, this._transform(await this._getData!()));
    }

    // Next are the initial actions that are needed to create the virtual table.
    // TODO: this should be set as a default in the ExternalTable. Currently each VirtualTable has the same initial
    // actions, so it can be a default for all.
    ext.initialActions = () => {
      const tableId = ext.name;
      return [
        [
          // Add the virtual table.
          'AddTable', tableId, columnDefs.map(col => ({
            id: col.colId,
            label: col.label,
            type: col.type,
            isFormula: false,
            formula: '',
            widgetOptions: col.widgetOptions
          }))
        ], [
          // Add an entry for the virtual table.
          'AddRecord', '_grist_Tables', this._tableId as any, {tableId, primaryViewId: 0},
        ], [
          // Add entries for the columns of the virtual table.
          'BulkAddRecord', '_grist_Tables_column',
          columnDefs.map(col => col.id) as any, getColValues(columnDefs.map(rec =>
            Object.assign({
              isFormula: false,
              formula: '',
              parentId: this._tableId as any,
            }, omit(rec, ['id']) as any))),
        ],
        [
          // Add view instance.
          'AddRecord', '_grist_Views', this._viewId as any, {
            name: this._name,
            type: 'raw_data',
          },
        ],
        [
          // Add a view section.
          'AddRecord', '_grist_Views_section', this._sectionId as any,
          {
            tableRef: this._tableId,
            parentId: this._viewId,
            parentKey: 'record',
            title: this._name, layout: 'vertical', showHeader: true,
            borderWidth: 1, defaultWidth: 100,
          }
        ],
        [
          // List the fields shown in the view section.
          'BulkAddRecord', '_grist_Views_section_field', fieldsDefs.map(VirtualId.bind(null, undefined)) as any, {
            colRef: fieldsDefs.map(colId => columnDefs.find(r => r.colId === colId)!.id),
            parentId: fieldsDefs.map(() => this._sectionId),
            parentPos: fieldsDefs.map((_, i) => i),
          }
        ]
      ];
    };

    // Now register it inside docModel.
    this.autoDispose(new VirtualTableRegistration(docModel, ext));

    // Amend viewSectionModel to hide view menu.
    const viewSectionModel = docModel.viewSections.rowModels[this._sectionId as any as number];
    viewSectionModel.hideViewMenu(true);
    viewSectionModel.canRename(false);

    // Create a minimal GristDoc like object that can be used by the Grid and other components.
    // TODO: this should be removed by refactoring GridView and other Layout components to not depend on GristDoc.
    this._gristDoc = new InMemoryGristDoc(docModel, this._viewId) as any as GristDoc;

    // Initialize the view section using the helper.
    ViewSectionHelper.create(this, this._gristDoc, viewSectionModel);
  }

  /**
   * Some columns can be registered with an additional function `transform` that will be used to transform the
   * data before it is displayed in the GridView. Most likely data that come from the API will have different
   * format to the one that is expected by the GridView.
   */
  private _transform(rows: any[]): any {
    // Find columns with transform function.
    if (!this._transformColumns.length) {
      return rows;
    }
    return rows.map(row => {
      const ret: Record<string, any> = {...row};
      this._transformColumns.forEach(col => {
        ret[col.colId] = col.transform!(row[col.colId]);
      });
      return ret;
    });
  }
}

/** This is default empty implementation of an external table used only for viewing */
class ExternalTable extends Disposable implements IExternalTable {
  public name = '';
  public label = '';
  public saveableFields = [];
  public fetchAll: () => Promise<TableDataAction>;
  public initialActions: () => DocAction[];
  public async beforeEdit(editor: IEdit) {}
  public async afterEdit(editor: IEdit) {}
  public async afterAnySchemaChange(editor: IEdit) {}
  public async sync(editor: IEdit): Promise<void> {}
}

/** Converts any kind of string to an identifier */
function toId(label: string) {
  return camelCase(label.replace(/[^a-zA-Z0-9]/g, ''));
}

/** Converts arbitrary records to a TableData action */
function toTableData(name: string, data: Record<string, any>[]): TableDataAction {
  const indices = range(data.length).map(i => i + 1);
  return ['TableData', name, indices,
    getColValues(
      indices.map(rowId => ({
        id: rowId,
        ...data[rowId - 1],
      }))
    )];
}

/**
 * This is hacky, sorry for that. This is a minimal implementation of GristDoc that makes it possible to use
 * VirtualTable without the need to have a full GristDoc implementation.
 * TODO: remove this code by refactoring GridView and other components to not depend on GristDoc.
 */
class InMemoryGristDoc extends Disposable {
  public viewModel: ViewRec;
  public app: App;
  public isReadonly = Observable.create(this, true);
  public isReadonlyKo = toKo(ko, this.isReadonly);
  public maximizedSectionId = Observable.create(this, null);
  public externalSectionId = Observable.create(this, null);
  public readonly resizeEmitter = this.autoDispose(new Emitter());
  public readonly fieldEditorHolder = Holder.create(this);
  public readonly activeEditor: Observable<FieldEditor | null> = Observable.create(this, null);
  public comparison = false;
  public docData: DocData = {} as any; // Don't need anything from it here.
  public docInfo = {timezone: Observable.create(null, 'UTC')};
  public querySetManager = new QuerySetManager(this.docModel, {} as any);
  public docPageModel = {
    appModel: {
      dismissedPopups: Observable.create(null, []),
    },
  };
  public behavioralPromptsManager = {
    attachPopup: () => {},
  };

  constructor(public docModel: DocModel, viewId: any) {
    super();
    if ((window as any).gristApp) {
      this.app = (window as any).gristApp;
    } else {
      this.app = this.autoDispose(new DisposableWithEvents()) as any;
    }
    this.viewModel = this.autoDispose(this.docModel.views.createFloatingRowModel(ko.observable(viewId)));
    this.autoDispose(commands.createGroup({
      setCursor: this.onSetCursorPos.bind(this),
    }, this, true));
  }

  public getCsvLink() {
    return '';
  }

  public getTsvLink() {
    return '';
  }

  public getDsvLink() {
    return '';
  }

  public getXlsxActiveViewLink() {
    return '';
  }
  public async clearColumns() {}
  public async convertIsFormula() {}
  public async sendTableAction() {}
  public async sendTableActions() {}
  public convertToCard() {}
  public getTableModelMaybeWithDiff(tableId: string) {
    return this.docModel.getTableModel(tableId);
  }
  public getTableModel(tableId: string) {
    return this.docModel.getTableModel(tableId);
  }
  public async onSetCursorPos(rowModel: BaseRowModel | undefined, fieldModel?: ViewFieldRec) {
    const cursorPos = {
      rowIndex: rowModel?._index() || 0,
      fieldIndex: fieldModel?._index() || 0,
      sectionId: fieldModel?.viewSection().getRowId(),
    };
    const viewInstance = this.viewModel.activeSection.peek().viewInstance.peek();
    viewInstance?.setCursorPos(cursorPos);
    this.app?.trigger('clipboard_focus', null);
  }
  public getLinkingRowIds(sectionId: number): UIRowId[]|undefined {
    throw new Error('Anchor links are not supported in virtual tables.');
  }
}

/**
 * This is a minimal representation of the Column definition that is used by the VirtualTable.
 * It more or less follows app/common/schema.ts, but it is simplified to only include the properties
 * that are needed by the VirtualTable.
 */
interface ColDef {
  colId: string;
  type: GristType;
  label: string;
  widgetOptions?: {
    widget?: WidgetType;
    choices?: string[];
    choiceOptions?: Array<Record<string, any>>;
    alignment?: 'left' | 'right' | 'center';
  };
  /**
   * If set, Virtual table will use this function to convert value before displaying it in the GridView.
   */
  transform?: (value: any) => any;
}
