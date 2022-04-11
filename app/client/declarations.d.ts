declare module "app/client/components/AceEditor";
declare module "app/client/components/Clipboard";
declare module "app/client/components/CodeEditorPanel";
declare module "app/client/components/DetailView";
declare module "app/client/components/DocConfigTab";
declare module "app/client/components/GridView";
declare module "app/client/components/Layout";
declare module "app/client/components/LayoutEditor";
declare module "app/client/components/commandList";
declare module "app/client/lib/Mousetrap";
declare module "app/client/lib/browserGlobals";
declare module "app/client/lib/dom";
declare module "app/client/lib/koDom";
declare module "app/client/lib/koForm";
declare module "app/client/lib/koSession";
declare module "app/client/widgets/UserType";
declare module "app/client/widgets/UserTypeImpl";

// tslint:disable:max-classes-per-file

declare module "app/client/components/Base" {
  import {GristDoc} from 'app/client/components/GristDoc';

  namespace Base { }
  class Base {
    public static setBaseFor(ctor: any): void;
    constructor(gristDoc: GristDoc);
  }
  export = Base;
}

declare module "app/client/components/BaseView" {

  import {Cursor, CursorPos} from 'app/client/components/Cursor';
  import {GristDoc} from 'app/client/components/GristDoc';
  import {Disposable} from 'app/client/lib/dispose';
  import * as BaseRowModel from "app/client/models/BaseRowModel";
  import {DataRowModel} from 'app/client/models/DataRowModel';
  import {LazyArrayModel} from "app/client/models/DataTableModel";
  import * as DataTableModel from "app/client/models/DataTableModel";
  import {ViewSectionRec} from "app/client/models/DocModel";
  import {FilterInfo} from 'app/client/models/entities/ViewSectionRec';
  import {SortedRowSet} from 'app/client/models/rowset';
  import {FieldBuilder} from "app/client/widgets/FieldBuilder";
  import {DomArg} from 'grainjs';
  import {IOpenController} from 'popweasel';

  interface Options {
    init?: string;
    state?: any;
  }

  namespace BaseView {}
  class BaseView extends Disposable {
    public viewSection: ViewSectionRec;
    public viewPane: any;
    public viewData: LazyArrayModel<BaseRowModel>;
    public gristDoc: GristDoc;
    public cursor: Cursor;
    public sortedRows: SortedRowSet;
    public activeFieldBuilder: ko.Computed<FieldBuilder>;
    public disableEditing: ko.Computed<boolean>;
    public isTruncated: ko.Observable<boolean>;
    public tableModel: DataTableModel;

    constructor(gristDoc: GristDoc, viewSectionModel: any, options?: {addNewRow?: boolean, isPreview?: boolean});
    public setCursorPos(cursorPos: CursorPos): void;
    public createFilterMenu(ctl: IOpenController, filterInfo: FilterInfo, onClose?: () => void): HTMLElement;
    public buildTitleControls(): DomArg;
    public getLoadingDonePromise(): Promise<void>;
    public activateEditorAtCursor(options?: Options): void;
    public onResize(): void;
    public prepareToPrint(onOff: boolean): void;
    public moveEditRowToCursor(): DataRowModel;
    public scrollToCursor(sync: boolean): Promise<void>;
  }
  export = BaseView;
}

declare module "app/client/components/RefSelect" {
  import {Disposable} from 'app/client/lib/dispose';
  import {ColumnRec} from "app/client/models/DocModel";
  import {DocModel} from "app/client/models/DocModel";
  import {FieldBuilder} from "app/client/widgets/FieldBuilder";

  namespace RefSelect {}
  class RefSelect extends Disposable {
    public isForeignRefCol: ko.Computed<boolean>;

    constructor(options: {
      docModel: DocModel,
      origColumn: ColumnRec,
      fieldBuilder: ko.Computed<FieldBuilder|null>,
    });
    public buildDom(): HTMLElement;
  }
  export = RefSelect;
}

declare module "app/client/components/ViewConfigTab" {
  import {GristDoc} from 'app/client/components/GristDoc';
  import {Disposable} from 'app/client/lib/dispose';
  import {KoArray} from "app/client/lib/koArray";
  import {ColumnRec, ViewRec, ViewSectionRec} from "app/client/models/DocModel";
  import {DomArg, DomContents} from 'grainjs';

  namespace ViewConfigTab {
    interface ViewSectionData {
      section: ViewSectionRec;
      hiddenFields: KoArray<ColumnRec>;
    }
  }

  class ViewConfigTab extends Disposable {
    constructor(options: {gristDoc: GristDoc, viewModel: ViewRec});
    public buildSortDom(): DomContents;
    // TODO: these should be made private or renamed.
    public _buildAdvancedSettingsDom(): DomArg;
    public _buildFilterDom(): DomArg;
    public _buildThemeDom(): DomArg;
    public _buildChartConfigDom(): DomContents;
    public _buildLayoutDom(): DomArg;
    public _buildCustomTypeItems(): DomArg;
  }
  export = ViewConfigTab;
}

declare module "app/client/components/commands" {
  export class Command {
    public name: string;
    public desc: string;
    public humanKeys: string[];
    public keys: string[];
    public run: () => any;
  }

  export type CommandsGroup = any;
  export const init: any;
  export const allCommands: any;
  export const createGroup: any;
}

declare module "app/client/models/BaseRowModel" {
  import {Disposable} from 'app/client/lib/dispose';
  import * as TableModel from 'app/client/models/TableModel';
  import {ColValues} from 'app/common/DocActions';

  namespace BaseRowModel {}
  class BaseRowModel extends Disposable {
    public id: ko.Computed<number>;
    public _index: ko.Observable<number|null>;
    public _table: TableModel;
    protected _rowId: number | 'new' | null;
    protected _fields: string[];
    public getRowId(): number;
    public updateColValues(colValues: ColValues): Promise<void>;
  }
  export = BaseRowModel;
}

declare module "app/client/models/MetaRowModel" {
  import * as BaseRowModel from "app/client/models/BaseRowModel";
  namespace MetaRowModel {}
  class MetaRowModel extends BaseRowModel {
    public _isDeleted: ko.Observable<boolean>;
    public events: { trigger: (key: string) => void };
  }
  export = MetaRowModel;
}

declare module "app/client/models/modelUtil" {
  interface SaveInterface<T> {
    saveOnly(value: T): Promise<void>;
    save(): Promise<void>;
    setAndSave(value: T): Promise<void>;
  }

  type KoSaveableObservable<T> = ko.Observable<T> & SaveInterface<T>;
  type KoSaveableComputed<T> = ko.Computed<T> & SaveInterface<T>;

  interface CustomComputed<T> extends KoSaveableComputed<T> {
    isSaved: ko.Computed<boolean>;
    revert(): void;
  }

  function addSaveInterface<T>(
    obs: ko.Observable<T>|ko.Computed<T>,
    saveFunc: (value: T) => Promise<void>): KoSaveableObservable<T>;

  interface ObjObservable<T> extends ko.Observable<T> {
    update(obj: T): void;
    prop(propName: string): ko.Observable<any>;
  }

  interface SaveableObjObservable<T> extends ko.Observable<T>, SaveInterface<T> {
    update(obj: T): void;
    prop(propName: string): KoSaveableObservable<any>;
  }

  function objObservable<T>(obs: ko.Observable<T>): ObjObservable<T>;
  function jsonObservable(obs: KoSaveableObservable<string>,
                          modifierFunc?: any, optContext?: any): SaveableObjObservable<any>;
  function jsonObservable(obs: ko.Observable<string>|ko.Computed<string>,
                          modifierFunc?: any, optContext?: any): ObjObservable<any>;

  function fieldWithDefault<T>(fieldObs: KoSaveableObservable<T>, defaultOrFunc: T | (() => T)):
    KoSaveableObservable<T>;

  function customValue<T>(obs: KoSaveableObservable<T>): CustomComputed<T>;

  function savingComputed<T>(options: {
    read: () => T,
    write: (setter: (obs: ko.Observable<T>, val: T) => void, val: T) => void;
  }): KoSaveableObservable<T>;

  function customComputed<T>(options: {
    read: () => T,
    save?: (val: T) => Promise<void>;
  }): CustomComputed<T>;

  function setSaveValue<T>(obs: KoSaveableObservable<T>, val: T): Promise<void>;
}

declare module "app/client/models/TableModel" {
  import {DocModel} from "app/client/models/DocModel";
  import {RowGrouping, RowSource} from "app/client/models/rowset";
  import {TableData} from "app/client/models/TableData";
  import {CellValue, UserAction} from "app/common/DocActions";

  namespace TableModel {}
  class TableModel extends RowSource {
    public docModel: DocModel;
    public tableData: TableData;
    public isLoaded: ko.Observable<boolean>;

    constructor(docModel: DocModel, tableData: TableData);
    public fetch(force?: boolean): Promise<void>;
    public getAllRows(): ReadonlyArray<number>;
    public getNumRows(): number;
    public getRowGrouping(groupByCol: string): RowGrouping<CellValue>;
    public sendTableActions(actions: UserAction[], optDesc?: string): Promise<any[]>;
    public sendTableAction(action: UserAction, optDesc?: string): Promise<any> | undefined;
  }
  export = TableModel;
}

declare module "app/client/models/MetaTableModel" {
  import {KoArray} from "app/client/lib/koArray";
  import {DocModel} from "app/client/models/DocModel";
  import * as MetaRowModel from "app/client/models/MetaRowModel";
  import {RowSource} from "app/client/models/rowset";
  import {TableData} from "app/client/models/TableData";
  import * as TableModel from "app/client/models/TableModel";
  import {CellValue} from "app/common/DocActions";

  namespace MetaTableModel {}
  class MetaTableModel<RowModel extends MetaRowModel> extends TableModel {
    public rowModels: RowModel[];

    constructor(docModel: DocModel, tableData: TableData, fields: string[], rowConstructor: (dm: DocModel) => void);
    public loadData(): void;
    public getRowModel(rowId: number, dependOnVersion?: boolean): RowModel;
    public getEmptyRowModel(): RowModel;
    public createFloatingRowModel(rowIdObs: ko.Observable<number>|ko.Computed<number>): RowModel;
    public createRowGroupModel(groupValue: CellValue, options: {groupBy: string, sortBy: string}): KoArray<RowModel>;
    public createAllRowsModel(sortColId: string): KoArray<RowModel>;
    public _createRowSetModel(rowSource: RowSource, sortColId: string): KoArray<RowModel>;
  }
  export = MetaTableModel;
}

declare module "app/client/models/DataTableModel" {
  import {KoArray} from "app/client/lib/koArray";
  import * as BaseRowModel from "app/client/models/BaseRowModel";
  import {DocModel, TableRec} from "app/client/models/DocModel";
  import {TableQuerySets} from 'app/client/models/QuerySet';
  import {SortedRowSet} from "app/client/models/rowset";
  import {TableData} from "app/client/models/TableData";
  import * as TableModel from "app/client/models/TableModel";
  import {UIRowId} from "app/common/UIRowId";

  namespace DataTableModel {
    interface LazyArrayModel<T> extends KoArray<T | null> {
      getRowId(index: number): UIRowId;
      getRowIndex(rowId: UIRowId): number;
      getRowIndexWithSub(rowId: UIRowId): number;
      getRowModel(rowId: UIRowId): T|undefined;
    }
  }

  class DataTableModel extends TableModel {
    public tableMetaRow: TableRec;
    public tableQuerySets: TableQuerySets;

    constructor(docModel: DocModel, tableData: TableData, tableMetaRow: TableRec);
    public createLazyRowsModel(sortedRowSet: SortedRowSet, optRowModelClass: any):
      DataTableModel.LazyArrayModel<BaseRowModel>;
    public createFloatingRowModel(optRowModelClass?: any): BaseRowModel;
  }
  export = DataTableModel;
}

declare module "app/client/lib/koUtil" {
  export interface ComputedWithKoUtils<T> extends ko.Computed<T> {
    onlyNotifyUnequal(): this;
    previousOnUndefined(): this;
  }
  export interface ObservableWithKoUtils<T> extends ko.Observable<T> {
    assign(value: unknown): this;
  }
  export function withKoUtils<T>(computed: ko.Computed<T>): ComputedWithKoUtils<T>;
  export function withKoUtils<T>(computed: ko.Observable<T>): ObservableWithKoUtils<T>;
  export function computedBuilder(callback: any, optContext: any): any;
  export function observableWithDefault(obs: any, defaultOrFunc: any, optContext?: any): any;
  export function computedAutoDispose(optionsOrReadFunc: any, target: any, options: any): any;
}

// Used in browser check.  Bowser does in fact have types, but not the bundled version
// with polyfills for old browsers.
declare module "bowser/bundled";
declare module "randomcolor";
