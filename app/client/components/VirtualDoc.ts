import {ActionLog} from 'app/client/components/ActionLog';
import {BehavioralPromptsManager} from 'app/client/components/BehavioralPromptsManager';
import {buildViewSectionDom} from 'app/client/components/buildViewSectionDom';
import {ClientScope} from 'app/client/components/ClientScope';
import {Comm} from 'app/client/components/Comm';
import * as commands from 'app/client/components/commands';
import {CursorMonitor} from 'app/client/components/CursorMonitor';
import {DocComm, GristDoc, IExtraTool} from 'app/client/components/GristDoc';
import {UndoStack} from 'app/client/components/UndoStack';
import {ViewLayout, ViewSectionHelper} from 'app/client/components/ViewLayout';
import type {BoxSpec} from 'app/client/lib/BoxSpec';
import {DocPluginManager} from 'app/client/lib/DocPluginManager';
import type {AppModel, TopAppModel} from 'app/client/models/AppModel';
import BaseRowModel from 'app/client/models/BaseRowModel';
import {DocData} from 'app/client/models/DocData';
import {DocInfoRec, DocModel, ViewFieldRec, ViewRec, ViewSectionRec} from 'app/client/models/DocModel';
import {DocPageModel, DocPageModelImpl} from 'app/client/models/DocPageModel';
import {QuerySetManager} from 'app/client/models/QuerySet';
import {UserPresenceModel, UserPresenceModelStub} from 'app/client/models/UserPresenceModel';
import {IExternalTable, VirtualTableData, VirtualTableRegistration} from 'app/client/models/VirtualTable';
import {META_TABLES} from 'app/client/models/VirtualTableMeta';
import type {App} from 'app/client/ui/App';
import {ICellContextMenu} from 'app/client/ui/CellContextMenu';
import {IPageWidget} from 'app/client/ui/PageWidgetPicker';
import {IRowContextMenu} from 'app/client/ui/RowContextMenu';
import {WidgetType} from 'app/client/widgets/UserType';
import {MinimalActionGroup} from 'app/common/ActionGroup';
import type {ApplyUAOptions, ApplyUAResult} from 'app/common/ActiveDocAPI';
import {DisposableWithEvents} from 'app/common/DisposableWithEvents';
import {CellValue, DocAction, getColValues, TableDataAction, TableRecordValues} from 'app/common/DocActions';
import type {UserAction} from 'app/common/DocActions';
import {DocDataCache} from 'app/common/DocDataCache';
import {IDocPage} from 'app/common/gristUrls';
import {useBindable} from 'app/common/gutil';
import {VirtualId} from 'app/common/SortSpec';
import {DocAPI, ExtendedUser} from 'app/common/UserAPI';
import type {ISupportedFeatures} from 'app/common/UserConfig';
import {CursorPos} from 'app/plugin/GristAPI';
import type {GristType, RowRecord} from 'app/plugin/GristData';
import type {MaybePromise} from 'app/plugin/gutil';
import camelCase from 'camelcase';
import {
  BaseObservable,
  BindableValue,
  bundleChanges,
  Computed,
  Disposable,
  dom,
  Emitter,
  Holder,
  IDisposable,
  MaybeObsArray,
  Observable,
  toKo,
  UseCB
} from 'grainjs';
import * as ko from 'knockout';
import difference from 'lodash/difference';
import omit from 'lodash/omit';

/**
 * Minimal implementation of the GristDoc interface that is suitable for virtual tables. The GristDoc created
 * appears as readonly version of the document.
 *
 * Currently it only supports rendering readonly view of external data.
 *
 * TODO: Factor out components from GristDoc for easier subtyping.
 */
export class VirtualDoc extends DisposableWithEvents implements GristDoc {
  // All of those props are only here to satisfy the interface.
  public app: App;
  public docComm: DocComm;
  public docPageModel: DocPageModel;
  public docData: DocData;
  public isReadonly = Observable.create(this, true);
  public isReadonlyKo = toKo(ko, this.isReadonly);
  // Currently we don't support this feature.
  public maximizedSectionId = Observable.create(this, null);
  public externalSectionId = Observable.create(this, null);
  public comparison = null;
  public docInfo: DocInfoRec = {timezone: Observable.create(null, 'UTC')} as any;
  public docModel: DocModel;
  public viewModel: ViewRec;
  public userPresenceModel: UserPresenceModel = new UserPresenceModelStub();
  public activeViewId = Observable.create(this, 0);
  public currentPageName: Observable<string>;
  public docPluginManager: DocPluginManager;
  public querySetManager: QuerySetManager;
  public rightPanelTool: Observable<IExtraTool | null> = Observable.create(this, null);
  public cursorMonitor: CursorMonitor;
  public hasCustomNav: Observable<boolean> = Observable.create(this, false);
  public resizeEmitter: Emitter = this.autoDispose(new Emitter());
  public fieldEditorHolder: Holder<IDisposable> = Holder.create(this);
  public activeEditor = Observable.create(this, null);
  public currentView = Observable.create(this, null);
  public latestActionState = Observable.create(this, null);
  public cursorPosition = Observable.create(this, undefined);
  public userOrgPrefs = Observable.create(this, {});
  public behavioralPromptsManager: BehavioralPromptsManager;
  public viewLayout = null;
  public docApi: DocAPI;
  public isTimingOn = Observable.create(this, false);
  public attachmentTransfer = Observable.create(this, null);
  public canShowRawData = Observable.create(this, false);
  public activeSectionId: ko.Computed<number|string>;
  public currentUser: Observable<ExtendedUser|null>;
  private _tables: Map<string, TableSpec> = new Map();
  constructor(public appModel: AppModel) {
    super();

    // Find or create a reference to the App object. It is mostly used to trigger events and to access
    // Comm object by on demand tables.
    if (window.gristApp) {
      // If we have gristApp, we use directly.
      this.app = window.gristApp as App;
    } else {
      // Otherwise, we create a new InMemoryApp, suitable for tests.
      this.app = this.autoDispose(new InMemoryApp(appModel.topAppModel));
    }

    this.currentUser = Computed.create(this, use => {
      return use(this.app.topAppModel.appObs)?.currentUser ?? null;
    });

    // Create a true DocPageModel that just don't wires up url state transition (that normally is used to switch
    // docs without reloading)
    // TODO: check if that actually works at all or is tested.
    this.docPageModel = this.autoDispose(new InMemoryDocPageModel(this.app, appModel));

    // Create an in-memory doc model that is able to translate UserActions to DocActions (by leveraging on-demand
    // tables functions). This allows us to treat this in memory document as on demand table that can be used and
    // modified by sending actions.
    this.docModel = InMemoryDocModel.create(this);
    this.docData = this.docModel.docData;

    // Wire up things needed for viewInstance component. The bare minimum requires a floating row model for
    // active view and a query set manager for getting data (and filtering/sorting).
    const viewId = toKo(ko, this.activeViewId) as ko.Computed<number>;
    this.viewModel = this.autoDispose(this.docModel.views.createFloatingRowModel(viewId));
    this.querySetManager = this.autoDispose(new QuerySetManager(
      this.docModel,
      this.docComm, // docComm is only needed for on-demand tables, otherwise it is not used at all.
    ));

    // Create a prompt manager (tooltips with hints), that is used to show hints and tips to the logged in user.
    // NOTE: this is not a stub or minimal implementation, it is the same thing that is used in the real GristDoc and
    // all discards are remembered by home db.
    this.behavioralPromptsManager = this.autoDispose(
      new BehavioralPromptsManager(appModel)
    );

    // Since we are a read only document, the field editor won't be disposed (known bug in Grist, same things happen On
    // snapshots or import previews).
    // To fix it, we will listen for active section change event, and manually trigger focus.
    // TODO: This is a hack, and should be fixed in Grist.
    this.autoDispose(this.viewModel.activeSectionId.subscribe(() => {
      this.focus();
    }));

    // By default we want to have a single page with all view sections on it, this way we the layout manager used to
    // render each section can show the green border around active one. But it is entirely possible to have multiple
    // pages and render multiple sections on each page.
    this.docData.receiveAction([
      'AddRecord', '_grist_Views', 'main' as any as number, {
        name: 'main',
        type: 'raw_data',
      }
    ]);

    this.activeViewId.set('main' as any);

    this.activeSectionId = this.viewModel.activeSectionId as any;
  }

  /**
   * Emits the `clipboard_focus` event. Some components (like editors) listen to this event to close themselves.
   */
  public focus() {
    this.app?.trigger('clipboard_focus', null);
  }

  /**
   * Renders default page. While the main GristDoc (and we as a result) contains a lot of things for left and right
   * panel, the dom is actually rendered only in the middle section of the UI. So all the other components are just
   * attached to GristDoc for easy access by other components.
   */
  public buildDom() {
    return dom('div',
      dom.style('flex', '1'),
      dom.on('setCursor', (ev: any) => {
        // This is a custom event triggered by Detail/GridView component. GristDoc normally registers a global
        // command handler to handle cursor change. But this won't work if there will be more then one VirtualDoc
        // on a page (we would need to somehow synchronize those two). So we will just listen to this event more
        // in "dom way".
        const [row, col] = ev.detail;
        this.onSetCursorPos(row, col).catch(reportError);
        ev.stopPropagation();
        ev.preventDefault();
      }),
      dom.domComputed(this.activeViewId, (viewId) => dom.create(ViewLayout, this, viewId)),
    );
  }

  public tableDef(tableId: string) {
    return this._tables.get(tableId) ?? null;
  }

  /** Register and loads external table into the document */
  public addTable(table: TableSpec) {
    // Figure out tableId if not provided.
    const suggestedTableId = table.tableId || properId(table.name);

    // If table is hidden (not shown in the UI), we will prefix it with GristHidden_. Some UI components
    // are sensitive to it.
    const tableId = table.hidden ? `GristHidden_${suggestedTableId}` : suggestedTableId;

    // Skip if we are already registered, we allow multiple registrations of the same table.
    if (this._tables.has(tableId)) {
      return;
    }

    this._tables.set(tableId, table);

    // Now wire up the external table with the low level IExternalTable interface.
    const ext: IExternalTable = {
      name: tableId,
      // Auto-generate initial actions to create the table.
      initialActions: () => generateInitialActions(table),
      // Fetch handlers replaces the data in the table with the data from the external source.
      fetchAll: async () => {
        // Get the data from the external source.
        const data = await maybePeek(table.data).getData();

        const definedColumns = (table.columns || []).map(c => c.colId);

        // If it requires formatting, reformat it to the Grist format.
        // Action looks like ['TableData', 'tableId', [rowIds], {colId: [values]}]
        const formatted: TableDataAction = table.format ? table.format.convert(tableId, data, definedColumns) : data;
        if (!Array.isArray(formatted) || formatted.length !== 4 || !Array.isArray(formatted[2]) || !formatted[3]) {
          throw new Error('Invalid data format');
        }

        // Some columns may require adjustments (like converting ms to s)
        const rows = formatted[2]; // array of row ids (or nulls for adding)
        const cols = formatted[3]; // object with colId -> array of values
        const colIds = Object.keys(cols);
        for (const def of table.columns || []) {
          if (!def.transform) {
            // Filter out not transformed columns.
            continue;
          }
          // Figure out proper colId if not defined.
          const colId = def.colId || properId(def.label);

          // We might have columns that are not in the external data, but we want to generate (like trigger formula)
          if (!cols[colId] && !!def.transform) {
            // In that case fill it up with nulls first.
            cols[colId] = Array(rows.length).fill(null);
          } else if (!cols[colId]) {
            throw new Error(`Column ${colId} not found in external data`);
          }

          // Now go through each row and apply transformation.
          for (let rowIndex = 0; rowIndex < cols[colId].length; rowIndex++) {
            const rowId = rows[rowIndex];
            // Some transformation needs access to the whole record (with raw data), so we will provide it.
            // This is somehow very similar to `rec` in formula.
            const rec = Object.fromEntries(colIds.map(c => [c, cols[c][rowIndex]]));
            Object.assign(rec, {id: rowId});
            // Apply transformation, very similar concept to cleaning trigger formula (it has access to current value)
            // and record.
            cols[colId][rowIndex] = def.transform(cols[colId][rowIndex], rec);
          }
        }
        return formatted;
      }
    };

    // Some column might be hidden with is an observable value. We will listen to it and hide/show columns as needed.
    if (table.columns) {
      const dynamicHidden = table.columns.filter(c => c.hidden && typeof c.hidden !== 'boolean');
      for(const col of dynamicHidden) {
        if (col.hidden === undefined) {
          continue;
        }
        const origHidden = col.hidden;
        const obs = Computed.create(this, use => useBindable(use, origHidden));
        const coldId = col.colId || properId(col.label);
        col.hidden = obs.get();
        this.autoDispose(obs.addListener(async isHidden => {
          if (!isHidden) {
            await this.showColumn(tableId, coldId);
          } else {
            await this.hideColumn(tableId, coldId);
          }
        }));
      }
    }


    // Now register this table with the docModel.
    this.autoDispose(new VirtualTableRegistration(this.docModel, ext));

    // The caller of this method might want to refresh the table if some external event happens.
    // This is modeled using an observable. If it value changes we will force this table to reload itself (probably
    // with some different filter args).
    if (table.watch) {
      this.autoDispose(table.watch.addListener(async (val) => {
        await this.refreshTableData(tableId);
      }));
    }

    // Same thing for the data itself, the fetch function can also be an observable. But in this case
    // we don't allow those two combined.
    if (table.data instanceof Observable) {
      if (table.watch) {
        throw new Error('Table data and watch cannot be both observables');
      }
      this.autoDispose(table.data.addListener(async () => {
        await this.refreshTableData(tableId);
      }));
    }

    // And adjust the UI a bit.
    const tableRec = this.docModel.allTables.peek().find(t => t.tableId.peek() === tableId);
    const sectionRec = this.docModel.viewSections.tableData.filterRecords({tableRef: tableRec?.id.peek()})[0];
    const sectionId = sectionRec?.id;
    const viewSectionModel = this.docModel.viewSections.rowModels[sectionId as any as number];
    // Hide view menu on the right.
    viewSectionModel.hideViewMenu(true);
    // Disable renaming
    // TODO: this should be disable by default if doc is readonly.
    viewSectionModel.canRename(false);

    if (table.initialFocus) {
      viewSectionModel.hasFocus(true);
      this.setView(table.name);
    }
  }

  /**
   * Hides column on a main section for a given table.
   * Main section is the first one we have. Currently VirtualDoc assumes we have only one section per table.
   */
  public async hideColumn(tableId: string, colId: string) {
    const sectionRec = this.getMainSectionRec(tableId);
    const columnRec = this.getColumnRec(tableId, colId);
    if (!columnRec) {
      return;
    }

    // Check if the viewField is actually added, maybe it is already hidden.
    const hasField = sectionRec.viewFields.peek()
      .all().find(f => f.colRef.peek() === columnRec.id.peek());
    if (!hasField) {
      return;
    }
    // Hide using meta action.
    await this.docData.sendActions([
      ['RemoveRecord', '_grist_Views_section_field', hasField.id.peek()]
    ]);
  }

  /**
   * Shows column on a main section for a given table.
   */
  public async showColumn(tableId: string, colId: string) {
    const sectionRec = this.getMainSectionRec(tableId);
    const columnRec = this.getColumnRec(tableId, colId)!;

    // Check if that column is already there.
    const hasField = sectionRec.viewFields.peek()
      .all().find(f => f.colRef.peek() === columnRec.id.peek());
    if (hasField) {
      return;
    }
    // Else generate action.
    const fieldId = VirtualId();
    await this.docData.sendActions([
      ['AddRecord', '_grist_Views_section_field', fieldId, {
        colRef: columnRec.id.peek(),
        parentId: sectionRec.id.peek(),
        parentPos: 0, // move first
      }]
    ]);
  }

  /** Returns ColumnRec row model */
  public getColumnRec(tableId: string, colId: string) {
    // Note: rowModels for virtual tables are not stored as normal array. This is more map rowId -> rowModel.
    // and since, rowIds are string, we can't use them as indexes or just iterated on it.
    return Object.values(this.docModel.columns.rowModels)
      .find(r => r.table.peek().tableId.peek() === tableId && r.colId.peek() === colId);
  }

  /** Returns TableRec record. */
  public getTableRec(tableId: string) {
    return this.docModel.allTables.peek().find(t => t.tableId.peek() === tableId);
  }

  /** Returns first section for a table. */
  public getMainSectionRec(tableId: string) {
    const tableRec = this.getTableRec(tableId);
    const rows = this.docModel.viewSections.tableData.filterRecords({tableRef: tableRec?.id.peek()});
    const row = rows[0];
    if (rows.length > 1) {
      throw new Error('Multiple sections per table not supported');
    }
    return this.docModel.viewSections.getRowModel(row.id);
  }

  /** Forces virtual table to reload data. */
  public async refreshTableData(tableId: string) {
    const virt = this.docData.getTable(tableId)! as VirtualTableData;
    await virt.fetchData();
  }

  /** Changes active view. */
  public setView(label: string) {
    // Find view with this name.
    const viewId = this.docModel.views.tableData.findMatchingRowId({name: label});
    if (!viewId) {
      throw new Error(`View with name or id ${label} not found`);
    }
    this.activeViewId.set(viewId);
  }

  public getRecords(table: string) {
    const tableData = this.docData.getTable(table)!.getTableDataAction();
    const rowIds = tableData[2];
    const columns = tableData[3];
    return rowIds.map(rowId => {
      const record: RowRecord = {id: rowId};
      for(const colId of Object.keys(columns)) {
        record[colId] = columns[colId][rowId];
      }
      return record;
    });
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

  ///////////////////////
  // Rest of the methods are not implemented and not needed or used by virtual tables.

  public getTableModelMaybeWithDiff(tableId: string) {
    return this.docModel.getTableModel(tableId);
  }

  public getTableModel(tableId: string) {
    return this.docModel.getTableModel(tableId);
  }

  public docId(): string {
    return "disconnected-doc";
  }

  public async openDocPage(viewId: IDocPage): Promise<void> {
    return Promise.resolve();
  }

  public showTool(tool: 'none' | 'docHistory' | 'validations' | 'discussion'): void {
  }

  public async moveToCursorPos(cursorPos?: CursorPos, optActionGroup?: MinimalActionGroup): Promise<void> {
    return Promise.resolve();
  }

  public getUndoStack(): UndoStack {
    return new UndoStack(); // Return empty undo stack
  }

  public async addEmptyTable(): Promise<void> {
    return Promise.resolve();
  }

  public async addWidgetToPage(widget: IPageWidget): Promise<void> {
    return Promise.resolve();
  }

  public async addNewPage(val: IPageWidget): Promise<void> {
    return Promise.resolve();
  }

  public async saveViewSection(section: ViewSectionRec, newVal: IPageWidget): Promise<ViewSectionRec> {
    return Promise.resolve(section);
  }

  public async saveLink(linkId: string, sectionId?: number): Promise<any> {
    return Promise.resolve(null);
  }

  public selectBy(widget: IPageWidget): any[] {
    return [];
  }

  public async forkIfNeeded(): Promise<void> {
    return Promise.resolve();
  }

  public async recursiveMoveToCursorPos(
    cursorPos: CursorPos,
    setAsActiveSection: boolean,
    silent?: boolean,
    visitedSections?: number[]
  ): Promise<boolean> {
    return Promise.resolve(false);
  }

  public async activateEditorAtCursor(options?: {init?: string; state?: any}): Promise<void> {
    return Promise.resolve();
  }

  public async copyAnchorLink(_anchorInfo: unknown) {}

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
  public async sendTableAction() {}
  public async sendTableActions() {}
  public getActionLog(): ActionLog {
    throw new Error('no ActionLog available');
  }
}

/**
 * Interface for an object that should provide full data for a table.
 */
interface ExternalData {
  getData(): MaybePromise<any>;
}

/**
 * Interface for an object that should convert data from external source to TableDataAction format.
 */
interface ExternalFormat {
  convert(tableId: string, data: any, colIds: string[]): TableDataAction;
}

/**
 * UI component for rendering single section (from VirtualDoc) in the UI.
 */
export class VirtualSection extends Disposable {
  private _sectionRec: ViewSectionRec;
  private _sectionId: string | number;
  private _columns: Computed<string[]>;

  constructor(protected _doc: VirtualDoc, protected props: {
    /** Table id to render */
    tableId: string,
    /** Optional section id to use. Useful for linking sections together */
    sectionId?: string | number,
    /** Grid or Detail view */
    type?: 'single' | 'record',
    /** Optional label for the section, defaults to table name */
    label?: string,
    /** Sorted list of fields to render */
    columns?: MaybeObsArray<string>,
    /** List of columns to hide */
    hiddenColumns?: MaybeObsArray<string>,
    /* Initial focus when creating this section. */
    initialFocus?: boolean,
    /** Function to be called when focus is changed in this section */
    onFocus?: (on: boolean) => void,
    /** Observable for currently selected row, support two-way binding */
    selectedRow?: Observable<string | number | undefined>,
    /** Optional function to call when cursor is changed (for convenience, as there is an observer above ) */
    rowChanged?: (rowId?: string|number) => void,
    /** Linking configuration to other sections in the same view */
    selectBy?: {
      sectionId: string,
      colId: string,
    },
    /** Handler that is called when user wants to show card view */
    onCard?: (rowId?: string | number) => void,
    /** A function that can change items visible in the cell context menu */
    cellMenu?: (items: Element[], options: ICellContextMenu) => Element[],
    /** A function that can change items visible in the row context menu */
    rowMenu?: (items: Element[], options: IRowContextMenu) => Element[],
    // TODO: add some clever way for detecting visibility.
    /** If this view section is visible or not. Used for resizing when the parent element is initially hidden */
    isVisible?: Observable<boolean>,
    disableAddRemove?: boolean,
  }) {
    super();

    const {tableId} = this.props;
    const tableRec = this._doc.getTableRec(tableId);
    if (!tableRec) {
      throw new Error(`Table ${tableId} not found`);
    }

    const sectionId = this.props.sectionId ?? tableId;
    this._sectionId = sectionId;


    const linkSrcSectionRef = this.props.selectBy?.sectionId ?? 0;
    this._doc.docData.receiveAction([
      'AddRecord', '_grist_Views_section', this._sectionId as any as number, {
        tableRef: tableRec.id.peek(),
        parentId: 'main' as any as number,
        parentKey: this.props.type ?? 'record',
        title: this.props?.label ?? tableRec.tableName.peek(),
        borderWidth: 1,
        defaultWidth: 100,
        linkSrcSectionRef,
      }
    ]);
    this.onDispose(() => {
      const fieldsIds = this._doc.docModel.viewFields.tableData.filterRowIds(
        {parentId: sectionId as any as number});

      this._doc.docData.receiveAction([
        'BulkRemoveRecord', '_grist_Views_section_field', fieldsIds
      ]);
      this._doc.docData.receiveAction([
        'RemoveRecord', '_grist_Views_section', sectionId as any as number
      ]);
    });

    const tableCols = tableRec.columns.peek().all().map(c => c.colId.peek());

    this._columns = Computed.create(this, use => {
      const hidden = this.props.hiddenColumns ? maybeUse(use, this.props.hiddenColumns) : [];
      const columns = props.columns ? maybeUse(use, props.columns) : tableCols;
      return difference(columns, hidden);
    });

    this._syncColumns();

    this.autoDispose(this._columns.addListener(this._syncColumns.bind(this)));

    const viewSectionRec = this._doc.docModel.viewSections.getRowModel(sectionId as any as number);
    ViewSectionHelper.create(this, this._doc as any, viewSectionRec);

    viewSectionRec.hideViewMenu(true);
    viewSectionRec.canRename(false);
    viewSectionRec.canExpand(false);
    viewSectionRec.overrideDisableAddRemoveRows(props.disableAddRemove);

    this._sectionRec = viewSectionRec;

    if (props.initialFocus) {
      viewSectionRec.hasFocus(true);
    }

    const viewInstance =viewSectionRec.viewInstance.peek() as any;
    // Additional elements to add to the cell context menu.
    if (props.cellMenu && viewInstance) {
      viewInstance.customCellMenu = props.cellMenu;
    }
    // Additional elements to add to the row context menu.
    if (props.rowMenu && viewInstance) {
      viewInstance.customRowMenu = props.rowMenu;
    }

    if (props.onFocus) {
      this.autoDispose(viewSectionRec.hasFocus.subscribe(on => {
        if (props.onFocus) {
          props.onFocus(on);
        }
      }));
    }

    // The viewInstance is already created, now we can override some commands.
    // Commands disabled in the menus, but still runnable with keyboard shortcuts.
    this.autoDispose(commands.createGroup({
      copyLink: () => {},
      viewAsCard: (ev?: Event) => {
        props.onCard?.(viewSectionRec.viewInstance.peek()?.cursor.getCursorPos().rowId);
        if (ev instanceof KeyboardEvent) {
          ev.stopPropagation();
          ev.preventDefault();
        }
        this._doc.app?.trigger('clipboard_focus', null);
        return true;
      }
    }, this, viewSectionRec.hasFocus));

    if (props.selectedRow) {
      const setRowIdInInstance = (rowId: any) => viewSectionRec.viewInstance.peek()?.setCursorPos({rowId});
      setRowIdInInstance(props.selectedRow.get());
      this.autoDispose(props.selectedRow.addListener(val => {
        setRowIdInInstance(val);
      }));
      const rowId = viewSectionRec.viewInstance.peek()?.cursor.rowId;
      if (rowId) {
        this.autoDispose(rowId.subscribe(id => {
          props.selectedRow!.set(id as any);
        }));
      }
    }

    if (props.isVisible) {
      this.autoDispose(props.isVisible.addListener(visible => {
        if (visible) {
          viewSectionRec.viewInstance.peek()?.onResize();
        }
      }));
    }
  }

  public buildDom() {
    const vs = this._sectionRec;
    return dom('div.layout_root',
      // Catch custom CustomEvent('setCursor', {detail: {row, col}}) event and set cursor position.
      dom.on('setCursor', (ev: any) => {
        vs.hasFocus(true);
        const [rowModel, fieldModel] = ev.detail;
        const cursorPos = {
          rowIndex: rowModel?._index() || 0,
          fieldIndex: fieldModel?._index() || 0,
          sectionId: fieldModel?.viewSection().getRowId(),
        };
        const viewInstance = vs.viewInstance.peek();
        viewInstance?.setCursorPos(cursorPos);
        this._doc.focus();
        this.props.rowChanged?.(viewInstance?.cursor.getCursorPos().rowId);
        ev.stopPropagation();
        ev.preventDefault();
      }),
      dom.style('flex', '1'),
      dom('div.layout_box layout_vbox',
        dom('div.layout_box layout_leaf',
          dom.style('--flex-grow', '100'),
          buildViewSectionDom({
            gristDoc: this._doc,
            sectionRowId: this._sectionId as number,
            viewModel: vs.view.peek(),
          }),
        )
      )
    );
  }

  private _syncColumns() {
    const columns = this._columns.get();
    const tableId = this.props.tableId;
    const sectionId = this._sectionId;
    const columnDefs = this._doc.tableDef(tableId)?.columns || [];
    const widths = new Map<string, number|null>(columnDefs.map(c => [c.colId, c.width ?? null]));

    bundleChanges(() => {
      const fieldsIds = this._doc.docModel.viewFields.tableData.filterRowIds(
        {parentId: sectionId as any as number});

      this._doc.docData.receiveAction([
        'BulkRemoveRecord', '_grist_Views_section_field', fieldsIds
      ]);
      const newFieldIds = columns.map(VirtualId.bind(null, undefined)) as any as number[];
      this._doc.docData.receiveAction([
        'BulkAddRecord', '_grist_Views_section_field', newFieldIds, {
          colRef: columns.map(c => this._doc.getColumnRec(tableId, c)!.id.peek()),
          parentId: columns.map(() => sectionId as any as number),
          parentPos: columns.map((_, i) => i + 1),
          width: columns.map(c => widths.get(c) ?? null),
        }
      ]);
    });
  }
}

/**
 * Default implementation for ExternalData interface. Just a wrapper around a function that returns data.
 */
export class ApiData implements ExternalData {
  constructor(private _fun: () => MaybePromise<any>) {
  }

  public async getData() {
    return await this._fun();
  }
}

/**
 * Converts the Records format ({record: {id, fields}[]}) to TableDataAction.
 */
export class RecordsFormat implements ExternalFormat {
  public convert(tableId: string, data: TableRecordValues, keys: string[]): TableDataAction {
    if (!data.records.length) {
      return ['TableData', tableId, [], {}];
    }
    const rows = data.records.map(r => r.id) as number[];
    const cols = Object.fromEntries(keys
      .filter(k => k !== 'id')
      .map(k => [k, data.records.map(r => r.fields[k] ?? null)]));
    return ['TableData', tableId, rows, cols];
  }
}

/**
 * Converts plain object to TableDataAction.
 */
export class RawFormat implements ExternalFormat {
  public convert(tableId: string, data: any[], keys: string[]): TableDataAction {
    if (!data.length) {
      return ['TableData', tableId, [], {}];
    }
    const colIds = keys.filter(k => k !== 'id');
    const rowIds = data.map((row, index) => row.id ?? (index + 1));
    const cols = Object.fromEntries(colIds.map(k => [k, data.map(r => r[k] ?? null)]));
    return ['TableData', tableId, rowIds, cols];
  }
}

/**
 * Description of external table. It is used to register the table with the VirtualDoc.
 */
export interface TableSpec {
  name: string;
  data: ExternalData|Observable<ExternalData>;
  watch?: Observable<any>;
  type?: 'record'|'single'|'detail'; // default 'record'
  tableId?: string;
  fields?: string[];
  columns?: ColumnSpec[];
  format?: ExternalFormat;
  hidden?: boolean;
  initialFocus?: boolean;
}

/**
 * Description of a column, used in TableSpec. Almost 1-1 to what is stored in _grist_Tables_column.
 */
export interface ColumnSpec<T = string> {
  /** Name of the column (also used to match a property from external source) */
  colId: T;
  /** Type of the column to create in Grist */
  type: GristType;
  label: string;
  hidden?: BindableValue<boolean>; // should this be hidden at start, by default not.
  widgetOptions?: {
    // Bare minimum to support Markdown and Choice widgets.
    widget?: WidgetType;
    choices?: string[];
    choiceOptions?: Array<Record<string, any>>;
    alignment?: 'left' | 'right' | 'center';
  };
  // Optional col id, if not provided it will be autogenerated. Useful fo linking two sections together.
  colRef?: string|number;
  // Default width for the field.
  width?: number;
  // An optional method that will convert this column to a Grist format (liek seconds).
  transform?: (value: any, rec: Record<string, any>) => CellValue;
}

/**
 * Version of DocModel that is connected to DocDataCache, a version of DocData that can translate UserActions
 * (limited set) to DocActions, that is also used for on-demand tables.
 */
class InMemoryDocModel extends DocModel {
  constructor() {
    // First is the DocComm. We don't need to implement all methods, just the ones that are used by the VirtualTable.
    const docComm: DocComm = {
      fetchTable: async () => null,
      // We are routing all actions to a DocDataCache, an in-memory implementation of DocData that can convert
      // user actions to DocActions and keep the in-memory state of the tables.
      async applyUserActions(actions: UserAction[], options?: ApplyUAOptions): Promise<ApplyUAResult> {
        const processed = await docDataCache.sendTableActions(actions);
        const retValues = processed.flatMap(action => action.retValues);
        return {retValues, actionHash: '', actionNum: 1, isModification: true};
      }
    } as any;

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

    // Sorry for this late constructor call, but the super class is doing a lot of actual work in
    // the constructor, besides pure initialization.
    // TODO: Remove code for the main constructor of DocModel.
    super(docData);
  }
}

/**
 * Prepare a empty App representation if one is not already created, empty objects are enough for us. Virtual tables
 * don't need the full App object yet (used for attachments for example, or custom plugins (not supported anyway)).
 */
class InMemoryApp extends DisposableWithEvents implements App {
  public allCommands = commands.allCommands;
  public comm = this.autoDispose(Comm.create());
  public clientScope = this.autoDispose(ClientScope.create());
  public features = ko.computed(() => ({} as ISupportedFeatures));
  constructor(public topAppModel: TopAppModel) {
    super();
  }
}

/**
 * This is a version of docModel that is suitable for virtual tables. It is not initialized, but the super class
 * just subscribes to urlState reload the document. We don't need to do it.
 */
class InMemoryDocPageModel extends DocPageModelImpl {
  public override initialize(): void {
    // Ignore the initialization, for now it just subscribe itself to the url state.
    // TODO: Refactor DocPageModelImpl for easier subtyping.
  }
}

/**
 * Generate initial actions for a virtual table based on the TableSpec.
 */
function generateInitialActions(tabDef: TableSpec): DocAction[] {
  const tableId = tabDef.tableId ?? properId(tabDef.name);
  const columnDefs = (tabDef.columns || []).map(col => ({...col, id: col.colRef ?? VirtualId()}));
  const tableRowId = VirtualId();
  const viewId = VirtualId();
  const sectionRowId = VirtualId();
  const fields = tabDef.fields ?? columnDefs.filter(c => !c.hidden).map(col => col.colId);
  const fieldsIds = fields.map(VirtualId.bind(null, undefined)) as any as number[];
  const widths = new Map(columnDefs.map(col => [col.colId, col.width ?? null]));
  return [
    [
      // Add the virtual table.
      'AddTable', tableId, columnDefs.map(col => ({
        id: col.colId,
        label: col.label,
        type: col.type,
        isFormula: false,
        formula: '',
        widgetOptions: col.widgetOptions ? JSON.stringify(col.widgetOptions) : '',
      }))
    ], [
      // Add an entry for the virtual table.
      'AddRecord', '_grist_Tables', tableRowId as any, {tableId, primaryViewId: viewId},
    ], [
      // Add entries for the columns of the virtual table.
      'BulkAddRecord', '_grist_Tables_column',
      columnDefs.map(col => col.id as any), getColValues(columnDefs.map(col =>
        Object.assign({
          isFormula: false,
          formula: '',
          parentId: tableRowId as any,
          widgetOptions: col.widgetOptions ? JSON.stringify(col.widgetOptions) : '',
        }, omit(col, ['id', 'widgetOptions']) as any))),
    ],
    [
      // Add view instance.
      'AddRecord', '_grist_Views', viewId as any, {
        name: tabDef.name,
        type: 'raw_data',
      },
    ],
    [
      // Add a view section.
      'AddRecord', '_grist_Views_section', sectionRowId as any,
      {
        tableRef: tableRowId,
        parentId: viewId,
        parentKey: tabDef.type ?? 'record',
        title: tabDef.name,
        // By default virtual table are producing vertical layouts (where fields are just below each other).
        layoutSpec: JSON.stringify({
          children: fieldsIds.map(id => ({leaf: id})),
        } as BoxSpec),
        showHeader: true,
        borderWidth: 1,
        defaultWidth: 100,
      }
    ],
    [
      // List the fields shown in the view section.
      'BulkAddRecord', '_grist_Views_section_field', fieldsIds, {
        colRef: fields.map(colId => columnDefs.find(r => r.colId === colId)!.id),
        parentId: fields.map(() => sectionRowId),
        parentPos: fields.map((_, i) => i + 1),
        width: fields.map(colId => widths.get(colId) ?? null),
      }
    ]
  ];
}

function properId(label: string) {
  return camelCase(label.replace(/[^a-zA-Z0-9]/g, ''));
}

function maybePeek<T>(value: T|Observable<T>) {
  return value instanceof BaseObservable ? value.get() : value;
}

function maybeUse<T>(use: UseCB, obs: BaseObservable<T>|T): T {
  return obs instanceof BaseObservable ? use(obs) : obs;
}
