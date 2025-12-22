declare module "app/client/components/AceEditor";
declare module "app/client/components/CodeEditorPanel";
declare module "app/client/lib/Mousetrap";
declare module "app/client/lib/dom";
declare module "app/client/lib/koDom";
declare module "app/client/lib/koForm";


declare module "app/client/components/RecordLayout" {
  import { Disposable } from "app/client/lib/dispose";

  namespace RecordLayout {
    interface NewField {
      isNewField: true;
      colRef: number;
      label: string;
      value: string;
    }
  }

  class RecordLayout extends Disposable {
    public static create(...args: any[]): any;

    public isEditingLayout: ko.Observable<boolean>;
    public editIndex: ko.Observable<number>;
    public layoutEditor: ko.Observable<unknown>;

    public getContainingRow(elem: Element, optContainer?: Element): DataRowModel;
    public getContainingField(elem: Element, optContainer?: Element): ViewFieldRec;
    public editLayout(rowIndex: number): void;
    // FIXME: DataRowModel is unresolved.
    // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
    public buildLayoutDom(row: DataRowModel | undefined, optCreateEditor?: boolean): HTMLElement;
  }
  export = RecordLayout;
}

declare module "app/client/components/ViewConfigTab" {
  import { GristDoc } from "app/client/components/GristDoc";
  import { Disposable } from "app/client/lib/dispose";
  import { KoArray } from "app/client/lib/koArray";
  import { ColumnRec, ViewRec, ViewSectionRec } from "app/client/models/DocModel";
  import { DomArg, DomContents } from "grainjs";

  namespace ViewConfigTab {
    interface ViewSectionData {
      section: ViewSectionRec;
      hiddenFields: KoArray<ColumnRec>;
    }
  }

  class ViewConfigTab extends Disposable {
    constructor(options: { gristDoc: GristDoc, viewModel: ViewRec });
    public buildSortFilterDom(): DomContents;
    /**
     * @deprecated On-demand tables where deprecated as of 2025-05-01.
     */
    public _buildAdvancedSettingsDom(): DomArg;
    // TODO: these should be made private or renamed.
    public _buildThemeDom(): DomArg;
    public _buildChartConfigDom(): DomContents;
    public _buildLayoutDom(): DomArg;
    public _buildCustomTypeItems(): DomArg;
  }
  export = ViewConfigTab;
}

declare module "app/client/models/BaseRowModel" {
  import { Disposable } from "app/client/lib/dispose";
  import TableModel from "app/client/models/TableModel";
  import { ColValues } from "app/common/DocActions";

  namespace BaseRowModel {}
  class BaseRowModel extends Disposable {
    public id: ko.Computed<number>;
    public _index: ko.Observable<number | null>;
    public _table: TableModel;
    protected _rowId: number | "new" | null;
    protected _fields: string[];
    public getRowId(): number;
    public updateColValues(colValues: ColValues): Promise<void>;
  }
  export = BaseRowModel;
}

declare module "app/client/models/MetaRowModel" {
  import BaseRowModel from "app/client/models/BaseRowModel";
  import { ColValues } from "app/common/DocActions";
  import { SchemaTypes } from "app/common/schema";

  type NPartial<T> = {
    [P in keyof T]?: T[P] | null;
  };
  type Values<T> = T extends keyof SchemaTypes ? NPartial<SchemaTypes[T]> : ColValues;

  namespace MetaRowModel {}
  class MetaRowModel<TName extends (keyof SchemaTypes) | undefined = undefined> extends BaseRowModel {
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
    setAndSaveOrRevert(value: T): Promise<void>;
  }

  type KoSaveableObservable<T> = ko.Observable<T> & SaveInterface<T>;
  type KoSaveableComputed<T> = ko.Computed<T> & SaveInterface<T>;

  interface CustomComputed<T> extends KoSaveableComputed<T> {
    isSaved: ko.Computed<boolean>;
    revert(): void;
  }

  function addSaveInterface<T>(
    obs: ko.Observable<T> | ko.Computed<T>,
    saveFunc: (value: T) => Promise<void>): KoSaveableObservable<T>;

  interface ObjObservable<T extends object> extends ko.Observable<T> {
    update(obj: T): void;
    prop<Key extends keyof T>(propName: Key): KoSaveableObservable<T[Key]>;
  }

  interface SaveableObjObservable<T extends object> extends ko.Observable<T>, SaveInterface<T> {
    update(obj: T): void;
    prop<Key extends keyof T>(propName: Key): KoSaveableObservable<T[Key]>;
  }

  function objObservable<T>(obs: ko.KoSaveableObservable<T>): SaveableObjObservable<T>;
  function objObservable<T>(obs: ko.Observable<T>): ObjObservable<T>;
  function jsonObservable(obs: KoSaveableObservable<string | undefined>,
    modifierFunc?: any, optContext?: any): SaveableObjObservable<any>;
  function jsonObservable(obs: ko.Observable<string> | ko.Computed<string>,
    modifierFunc?: any, optContext?: any): ObjObservable<any>;

  function fieldWithDefault<T>(fieldObs: KoSaveableObservable<T | undefined>, defaultOrFunc: T | (() => T)):
  KoSaveableObservable<T>;

  function customValue<T>(obs: KoSaveableObservable<T>): CustomComputed<T>;

  function savingComputed<T>(options: {
    read: () => T,
    write: (setter: (obs: ko.Observable<T | undefined>, val: T) => void, val: T) => void;
  }): KoSaveableObservable<T>;

  function customComputed<T>(options: {
    read: () => T,
    save?: (val: T) => Promise<void>;
  }): CustomComputed<T>;

  function setSaveValue<T>(obs: KoSaveableObservable<T>, val: T): Promise<void>;
}

declare module "app/client/models/TableModel" {
  import { DocModel } from "app/client/models/DocModel";
  import { RowGrouping, RowSource } from "app/client/models/rowset";
  import { TableData } from "app/client/models/TableData";
  import { CellValue, UserAction } from "app/common/DocActions";

  namespace TableModel {}
  class TableModel extends RowSource {
    public docModel: DocModel;
    public tableData: TableData;
    public isLoaded: ko.Observable<boolean>;

    constructor(docModel: DocModel, tableData: TableData);
    public fetch(force?: boolean): Promise<void>;
    public getAllRows(): readonly number[];
    public getNumRows(): number;
    public getRowGrouping(groupByCol: string): RowGrouping<CellValue>;
    public sendTableActions(actions: UserAction[], optDesc?: string): Promise<any[]>;
    public sendTableAction(action: UserAction, optDesc?: string): Promise<any> | undefined;
  }
  export = TableModel;
}

declare module "app/client/models/MetaTableModel" {
  import { KoArray } from "app/client/lib/koArray";
  import { DocModel } from "app/client/models/DocModel";
  import MetaRowModel from "app/client/models/MetaRowModel";
  import { RowSource } from "app/client/models/rowset";
  import { TableData } from "app/client/models/TableData";
  import TableModel from "app/client/models/TableModel";
  import { CellValue } from "app/common/DocActions";

  namespace MetaTableModel {}
  class MetaTableModel<RowModel extends MetaRowModel> extends TableModel {
    public rowModels: RowModel[];

    constructor(docModel: DocModel, tableData: TableData, fields: string[], rowConstructor: (dm: DocModel) => void);
    public loadData(): void;
    public getRowModel(rowId: number, dependOnVersion?: boolean): RowModel;
    public getEmptyRowModel(): RowModel;
    public createFloatingRowModel(rowIdObs: ko.Observable<number> | ko.Computed<number>): RowModel;
    public createRowGroupModel(groupValue: CellValue, options: { groupBy: string, sortBy: string }): KoArray<RowModel>;
    public createAllRowsModel(sortColId: string): KoArray<RowModel>;
    public _createRowSetModel(rowSource: RowSource, sortColId: string): KoArray<RowModel>;
  }
  export = MetaTableModel;
}

declare module "app/client/models/DataTableModel" {
  import { KoArray } from "app/client/lib/koArray";
  import { DocModel, TableRec } from "app/client/models/DocModel";
  import { TableQuerySets } from "app/client/models/QuerySet";
  import { SortedRowSet } from "app/client/models/rowset";
  import { TableData } from "app/client/models/TableData";
  import TableModel from "app/client/models/TableModel";
  import { UIRowId } from "app/common/UIRowId";

  namespace DataTableModel {
    interface LazyArrayModel<T> extends KoArray<T | null> {
      getRowId(index: number): UIRowId;
      getRowIndex(rowId: UIRowId): number;
      getRowIndexWithSub(rowId: UIRowId): number;
      getRowModel(rowId: UIRowId): T | undefined;
      setFloatingRowModel(rowModel: T, index: number | null): void;
    }
  }

  class DataTableModel extends TableModel {
    public tableMetaRow: TableRec;
    public tableQuerySets: TableQuerySets;

    constructor(docModel: DocModel, tableData: TableData, tableMetaRow: TableRec);
    public createLazyRowsModel(sortedRowSet: SortedRowSet, optRowModelClass?: any):
    DataTableModel.LazyArrayModel<DataRowModel>;
    public createFloatingRowModel(optRowModelClass?: any): DataRowModel;
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

interface JQuery {
  datepicker(options: unknown): JQuery;
  resizable(options?: ResizableOptions): JQuery;
  resizable(method: string): JQuery;
}

interface ResizableOptions {
  disabled?: boolean;
  handles?: "n" | "e" | "s" | "w" | "ne" | "se" | "sw" | "nw" | "all";
  minHeight?: number;
  minWidth?: number;
  maxHeight?: number;
  maxWidth?: number;
  start?: (event: JQuery.MouseBaseEvent, ui: JQueryUI) => void,
  resize?: (event: JQuery.MouseBaseEvent, ui: JQueryUI) => void,
  stop?: (event: JQuery.MouseBaseEvent, ui: JQueryUI) => void,
}

interface JQueryUI {
  element: JQuery;
  helper: JQuery;
  originalElement: JQuery;
  originalPosition: Position;
  originalSize: Size;
  position: Position;
  size: Size;
}

interface Position {
  left: number;
  top: number;
}

interface Size {
  width: number;
  height: number;
}
