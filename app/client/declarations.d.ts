declare module "app/client/components/AceEditor";
declare module "app/client/components/Clipboard";
declare module "app/client/components/CodeEditorPanel";
declare module "app/client/components/DetailView";
declare module "app/client/components/DocConfigTab";
declare module "app/client/components/GridView";
declare module "app/client/lib/Mousetrap";
declare module "app/client/lib/browserGlobals";
declare module "app/client/lib/dom";
declare module "app/client/lib/koDom";
declare module "app/client/lib/koForm";

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

  import {Cursor} from 'app/client/components/Cursor';
  import {GristDoc} from 'app/client/components/GristDoc';
  import {IGristUrlState} from 'app/common/gristUrls';
  import {SelectionSummary} from 'app/client/components/SelectionSummary';
  import {Disposable} from 'app/client/lib/dispose';
  import BaseRowModel from "app/client/models/BaseRowModel";
  import {DataRowModel} from 'app/client/models/DataRowModel';
  import {LazyArrayModel} from "app/client/models/DataTableModel";
  import DataTableModel from "app/client/models/DataTableModel";
  import {ViewFieldRec, ViewSectionRec} from "app/client/models/DocModel";
  import {FilterInfo} from 'app/client/models/entities/ViewSectionRec';
  import {SortedRowSet} from 'app/client/models/rowset';
  import {IColumnFilterMenuOptions} from 'app/client/ui/ColumnFilterMenu';
  import {FieldBuilder} from "app/client/widgets/FieldBuilder";
  import {CursorPos} from 'app/plugin/GristAPI';
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
    public rowSource: RowSource;
    public activeFieldBuilder: ko.Computed<FieldBuilder>;
    public selectedColumns: ko.Computed<ViewFieldRec[]>|null;
    public disableEditing: ko.Computed<boolean>;
    public isTruncated: ko.Observable<boolean>;
    public tableModel: DataTableModel;
    public selectionSummary?: SelectionSummary;
    public currentEditingColumnIndex: ko.Observable<number>;

    constructor(gristDoc: GristDoc, viewSectionModel: any, options?: {addNewRow?: boolean, isPreview?: boolean});
    public setCursorPos(cursorPos: CursorPos): void;
    public createFilterMenu(ctl: IOpenController, filterInfo: FilterInfo,
      options?: IColumnFilterMenuOptions): HTMLElement;
    public buildTitleControls(): DomArg;
    public getLoadingDonePromise(): Promise<void>;
    public activateEditorAtCursor(options?: Options): void;
    public openDiscussionAtCursor(discussionId?: number): boolean;
    public onResize(): void;
    public prepareToPrint(onOff: boolean): void;
    public moveEditRowToCursor(): DataRowModel;
    public scrollToCursor(sync: boolean): Promise<void>;
    public getAnchorLinkForSection(sectionId: number): IGristUrlState;
    public viewSelectedRecordAsCard(): void;
    public isRecordCardDisabled(): boolean;
  }
  export = BaseView;
}

declare module 'app/client/components/GridView' {
  import BaseView from 'app/client/components/BaseView';
  import {GristDoc} from 'app/client/components/GristDoc';
  import {ColInfo, NewColInfo} from 'app/client/models/entities/ViewSectionRec';

  interface InsertColOptions {
    colInfo?: ColInfo;
    index?: number;
    skipPopup?: boolean;
    onPopupClose?: () => void;
  }

  namespace GridView {}

  class GridView extends BaseView {
    public static create(...args: any[]): any;

    public gristDoc: GristDoc;

    constructor(gristDoc: GristDoc, viewSectionModel: any, isPreview?: boolean);
    public insertColumn(
      colId?: string|null,
      options?: InsertColOptions,
    ): Promise<NewColInfo>;
    public showColumn(colRef: number, index?: number): Promise<void>;
  }
  export = GridView;
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
    public buildSortFilterDom(): DomContents;
    // TODO: these should be made private or renamed.
    public _buildAdvancedSettingsDom(): DomArg;
    public _buildThemeDom(): DomArg;
    public _buildChartConfigDom(): DomContents;
    public _buildLayoutDom(): DomArg;
    public _buildCustomTypeItems(): DomArg;
  }
  export = ViewConfigTab;
}

declare module "app/client/models/BaseRowModel" {
  import {Disposable} from 'app/client/lib/dispose';
  import TableModel from 'app/client/models/TableModel';
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
  import BaseRowModel from "app/client/models/BaseRowModel";
  import {ColValues} from 'app/common/DocActions';
  import {SchemaTypes} from 'app/common/schema';

  type NPartial<T> = {
    [P in keyof T]?: T[P]|null;
  };
  type Values<T> = T extends keyof SchemaTypes ? NPartial<SchemaTypes[T]> : ColValues;

  namespace MetaRowModel {}
  class MetaRowModel<TName extends (keyof SchemaTypes)|undefined = undefined> extends BaseRowModel {
    public _isDeleted: ko.Observable<boolean>;
    public events: { trigger: (key: string) => void };
    public updateColValues(colValues: Values<TName>): Promise<void>;
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

  function objObservable<T>(obs: ko.KoSaveableObservable<T>): SaveableObjObservable<T>;
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
  import MetaRowModel from "app/client/models/MetaRowModel";
  import {RowSource} from "app/client/models/rowset";
  import {TableData} from "app/client/models/TableData";
  import TableModel from "app/client/models/TableModel";
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
  import BaseRowModel from "app/client/models/BaseRowModel";
  import {DocModel, TableRec} from "app/client/models/DocModel";
  import {TableQuerySets} from 'app/client/models/QuerySet';
  import {SortedRowSet} from "app/client/models/rowset";
  import {TableData} from "app/client/models/TableData";
  import TableModel from "app/client/models/TableModel";
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

interface Location {
  // We use reload(true) in places, which has an effect in Firefox, but may be more of a
  // historical accident than an intentional choice.
  reload(forceGet?: boolean): void;
}
