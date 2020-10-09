/**
 * GristDoc manages an open Grist document on the client side.
 */
// tslint:disable:no-console

import {ActionLog} from 'app/client/components/ActionLog';
import * as CodeEditorPanel from 'app/client/components/CodeEditorPanel';
import * as commands from 'app/client/components/commands';
import {CursorPos} from 'app/client/components/Cursor';
import {DocComm, DocUserAction} from 'app/client/components/DocComm';
import * as DocConfigTab from 'app/client/components/DocConfigTab';
import * as GridView from 'app/client/components/GridView';
import {Importer} from 'app/client/components/Importer';
import * as REPLTab from 'app/client/components/REPLTab';
import {ActionGroupWithCursorPos, UndoStack} from 'app/client/components/UndoStack';
import {ViewLayout} from 'app/client/components/ViewLayout';
import {get as getBrowserGlobals} from 'app/client/lib/browserGlobals';
import {DocPluginManager} from 'app/client/lib/DocPluginManager';
import {ImportSourceElement} from 'app/client/lib/ImportSourceElement';
import {createSessionObs} from 'app/client/lib/sessionObs';
import {setTestState} from 'app/client/lib/testState';
import {selectFiles} from 'app/client/lib/uploads';
import {reportError} from 'app/client/models/AppModel';
import * as DataTableModel from 'app/client/models/DataTableModel';
import {DataTableModelWithDiff} from 'app/client/models/DataTableModelWithDiff';
import {DocData} from 'app/client/models/DocData';
import {DocInfoRec, DocModel, ViewRec, ViewSectionRec} from 'app/client/models/DocModel';
import {DocPageModel} from 'app/client/models/DocPageModel';
import {UserError} from 'app/client/models/errors';
import {IDocPage, urlState} from 'app/client/models/gristUrlState';
import {QuerySetManager} from 'app/client/models/QuerySet';
import {App} from 'app/client/ui/App';
import {DocHistory} from 'app/client/ui/DocHistory';
import {IPageWidget, toPageWidget} from 'app/client/ui/PageWidgetPicker';
import {IPageWidgetLink, linkFromId, selectBy} from 'app/client/ui/selectBy';
import {testId} from 'app/client/ui2018/cssVars';
import {IconName} from 'app/client/ui2018/IconList';
import {ActionGroup} from 'app/common/ActionGroup';
import {delay} from 'app/common/delay';
import {DisposableWithEvents} from 'app/common/DisposableWithEvents';
import {isSchemaAction} from 'app/common/DocActions';
import {OpenLocalDocResult} from 'app/common/DocListAPI';
import {HashLink} from 'app/common/gristUrls';
import {encodeQueryParams, waitObs} from 'app/common/gutil';
import {StringUnion} from 'app/common/StringUnion';
import {TableData} from 'app/common/TableData';
import {DocStateComparison} from 'app/common/UserAPI';
import {Computed, dom, Emitter, Holder, IDomComponent, subscribe, toKo} from 'grainjs';
import {IDisposable, Observable, styled} from 'grainjs';
import * as ko from 'knockout';
import cloneDeepWith = require('lodash/cloneDeepWith');
import isEqual = require('lodash/isEqual');

const G = getBrowserGlobals('document', 'window');

// Re-export DocComm to move it from main webpack bundle to the one with GristDoc.
export {DocComm};

export interface TabContent {
  showObs?: any;
  header?: boolean;
  label?: any;
  items?: any;
  buildDom?: any;
  keywords?: any;
}

export interface TabOptions {
  shortLabel?: string;
  hideSearchContent?: boolean;
  showObs?: any;
  category?: any;
}

const RightPanelTool = StringUnion("none", "docHistory", "validations", "repl");

export interface IExtraTool {
  icon: IconName;
  label: string;
  content: TabContent[]|IDomComponent;
}

export class GristDoc extends DisposableWithEvents {
  public docModel: DocModel;
  public viewModel: ViewRec;
  public activeViewId: Computed<IDocPage>;
  public currentPageName: Observable<string>;
  public docData: DocData;
  public docInfo: DocInfoRec;
  public docPluginManager: DocPluginManager;
  public querySetManager: QuerySetManager;
  public rightPanelTool: Observable<IExtraTool|null>;
  public isReadonly = this.docPageModel.isReadonly;
  public isReadonlyKo = toKo(ko, this.isReadonly);
  public comparison: DocStateComparison|null;

  // Emitter triggered when the main doc area is resized.
  public readonly resizeEmitter = this.autoDispose(new Emitter());

  // This holds a single FieldEditor. When a new FieldEditor is created (on edit), it replaces the
  // previous one if any. The holder is maintained by GristDoc, so that we are guaranteed at
  // most one instance of FieldEditor at any time.
  public readonly fieldEditorHolder = Holder.create(this);

  private _actionLog: ActionLog;
  private _undoStack: UndoStack;
  private _lastOwnActionGroup: ActionGroupWithCursorPos|null = null;
  private _rightPanelTabs = new Map<string, TabContent[]>();
  private _docHistory: DocHistory;
  private _rightPanelTool = createSessionObs(this, "rightPanelTool", "none", RightPanelTool.guard);
  private _viewLayout: ViewLayout|null = null;

  constructor(
    public readonly app: App,
    public readonly docComm: DocComm,
    public readonly docPageModel: DocPageModel,
    openDocResponse: OpenLocalDocResult,
    options: {
      comparison?: DocStateComparison  // initial comparison with another document
    } = {}
  ) {
    super();
    console.log("RECEIVED DOC RESPONSE", openDocResponse.doc);
    this.docData = new DocData(this.docComm, openDocResponse.doc);
    this.docModel = new DocModel(this.docData);
    this.querySetManager = QuerySetManager.create(this, this.docModel, this.docComm);
    this.docPluginManager = new DocPluginManager(openDocResponse.plugins, app.getUntrustedContentOrigin(),
      this.docComm, app.clientScope);

    // Maintain the MetaRowModel for the global document info, including docId and peers.
    this.docInfo = this.docModel.docInfo.getRowModel(1);

    const defaultViewId = this.docInfo.newDefaultViewId;

    // Grainjs observable for current view id, which may be a string such as 'code'.
    this.activeViewId = Computed.create(this, urlState().state, (use, s) => s.docPage || defaultViewId.peek());

    // This viewModel reflects the currently active view, relying on the fact that
    // createFloatingRowModel() supports an observable rowId for its argument.
    // Although typings don't reflect it, createFloatingRowModel() accepts non-numeric values,
    // which yield an empty row, which is why we can cast activeViewId.
    this.viewModel = this.autoDispose(
      this.docModel.views.createFloatingRowModel(toKo(ko, this.activeViewId) as ko.Computed<number>));

    // Grainjs observable reflecting the name of the current document page.
    this.currentPageName = Computed.create(this, this.activeViewId,
      (use, docPage) => typeof docPage === 'number' ? use(this.viewModel.name) : docPage);

    // Whenever the active viewModel is deleted, switch to the default view.
    this.autoDispose(this.viewModel._isDeleted.subscribe((isDeleted) => {
      if (isDeleted) {
        // This should not be done synchronously, as that affects the same viewModel that triggered
        // this callback, and causes some obscure effects on knockout subscriptions.
        Promise.resolve().then(() => urlState().pushUrl({docPage: undefined})).catch(() => null);
      }
    }));

    // Navigate to an anchor if one is present in the url hash.
    this.autoDispose(subscribe(urlState().state, async (use, state) => {
      if (state.hash) {
        try {
          const cursorPos = getCursorPosFromHash(state.hash);
          await this._recursiveMoveToCursorPos(cursorPos, true, state.hash && state.hash.colRef);
        } catch (e) {
          reportError(e);
        } finally {
          setTimeout(finalizeAnchor, 0);
        }
      }
    }));

    // Importer takes a function for creating previews.
    const createPreview = (vs: ViewSectionRec) => GridView.create(this, vs, true);

    const importSourceElems = ImportSourceElement.fromArray(this.docPluginManager.pluginsList);
    const importMenuItems = [
      {
        label: 'Import from file',
        action: () => Importer.selectAndImport(this, null, createPreview),
      },
      ...importSourceElems.map(importSourceElem => ({
        label: importSourceElem.importSource.label,
        action: () => Importer.selectAndImport(this, importSourceElem, createPreview)
      }))
    ];

    // Set the available import sources in the DocPageModel.
    this.docPageModel.importSources = importMenuItems;

    this._actionLog = this.autoDispose(ActionLog.create({ gristDoc: this }));
    this._undoStack = this.autoDispose(UndoStack.create(openDocResponse.log, { gristDoc: this }));
    this._docHistory = DocHistory.create(this, this.docPageModel, this._actionLog);

    // Tap into docData's sendActions method to save the cursor position with every action, so that
    // undo/redo can jump to the right place.
    this.autoDispose(this.docData.sendActionsEmitter.addListener(this._onSendActionsStart, this));
    this.autoDispose(this.docData.sendActionsDoneEmitter.addListener(this._onSendActionsEnd, this));

    /* Command binding */
    this.autoDispose(commands.createGroup({
      undo() { this._undoStack.sendUndoAction(); },
      redo() { this._undoStack.sendRedoAction(); },
      reloadPlugins() { this.docComm.reloadPlugins().then(() => G.window.location.reload(false)); },
    }, this, true));

    this.listenTo(app.comm, 'docUserAction', this.onDocUserAction);

    this.autoDispose(DocConfigTab.create({gristDoc: this}));

    const replTab = this.autoDispose(REPLTab.create(this));
    this.autoDispose(this.addOptionsTab(
      'REPL', dom('span.glyphicon.glyphicon-console'),
      replTab.buildConfigDomObj(),
      { hideSearchContent: true }
    ));

    this.rightPanelTool = Computed.create(this, (use) => this._getToolContent(use(this._rightPanelTool)));

    this.comparison = options.comparison || null;

    // We need prevent default here to allow drop events to fire.
    this.autoDispose(dom.onElem(window, 'dragover', (ev) => ev.preventDefault()));
    // The default action is to open dragged files as a link, navigating out of the app.
    this.autoDispose(dom.onElem(window, 'drop', (ev) => ev.preventDefault()));
  }

  public addOptionsTab(label: string, iconElem: any, contentObj: TabContent[], options: TabOptions): IDisposable {
    this._rightPanelTabs.set(label, contentObj);
    // Return a do-nothing disposable, to satisfy the previous interface.
    return {dispose: () => null};
  }

  /**
   * Builds the DOM for this GristDoc.
   */
  public buildDom() {
    return cssViewContentPane(testId('gristdoc'),
      dom.domComputed<IDocPage>(this.activeViewId, (viewId) => (
        viewId === 'code' ? dom.create((owner) => owner.autoDispose(CodeEditorPanel.create(this))) :
        viewId === 'new' ? null :
        dom.create((owner) => (this._viewLayout = ViewLayout.create(owner, this, viewId)))
      )),
    );
  }

  // Open the given page. Note that links to pages should use <a> elements together with setLinkUrl().
  public openDocPage(viewId: IDocPage) {
    return urlState().pushUrl({docPage: viewId});
  }

  public showTool(tool: typeof RightPanelTool.type): void {
    this._rightPanelTool.set(tool);
  }

  /**
   * Returns an object representing the position of the cursor, including the section. It will have
   * fields { sectionId, rowId, fieldIndex }. Fields may be missing if no section is active.
   */
  public getCursorPos(): CursorPos {
    const pos = { sectionId: this.viewModel.activeSectionId() };
    const viewInstance = this.viewModel.activeSection.peek().viewInstance.peek();
    return Object.assign(pos, viewInstance ? viewInstance.cursor.getCursorPos() : {});
  }

  /**
   * Switch to the view/section and scroll to the record indicated by cursorPos. If cursorPos is
   * null, then moves to a position best suited for optActionGroup (not yet implemented).
   */
  public moveToCursorPos(cursorPos?: CursorPos, optActionGroup?: ActionGroup): void {
    if (!cursorPos || cursorPos.sectionId == null) {
      // TODO We could come up with a suitable cursorPos here based on the action itself.
      // This should only come up if trying to undo/redo after reloading a page (since the cursorPos
      // associated with the action is only stored in memory of the current JS process).
      // A function like `getCursorPosForActionGroup(ag)` would also be useful to jump to the best
      // place from any action in the action log.
      return;
    }

    this._switchToSectionId(cursorPos.sectionId)
    .then(viewInstance => (viewInstance && viewInstance.setCursorPos(cursorPos)))
    .catch(reportError);
  }

  /**
   * Process actions received from the server by forwarding them to `docData.receiveAction()` and
   * pushing them to actionLog.
   */
  public onDocUserAction(message: DocUserAction) {
    console.log("GristDoc.onDocUserAction", message);
    let schemaUpdated = false;
    if (this.docComm.isActionFromThisDoc(message)) {
      const docActions = message.data.docActions;
      for (let i = 0, len = docActions.length; i < len; i++) {
        console.log("GristDoc applying #%d", i, docActions[i]);
        this.docData.receiveAction(docActions[i]);
        this.docPluginManager.receiveAction(docActions[i]);

        if (!schemaUpdated && isSchemaAction(docActions[i])) {
          schemaUpdated = true;
        }
      }
      // Add fromSelf property to actionGroup indicating if it's from the current session.
      const actionGroup = message.data.actionGroup;
      actionGroup.fromSelf = message.fromSelf || false;
      // Push to the actionLog and the undoStack.
      if (!actionGroup.internal) {
        this._actionLog.pushAction(actionGroup);
        this._undoStack.pushAction(actionGroup);
        if (actionGroup.fromSelf) {
          this._lastOwnActionGroup = actionGroup;
        }
      }
      if (schemaUpdated) {
        this.trigger('schemaUpdateAction', docActions);
      }
    }
  }

  public getTableModel(tableId: string): DataTableModel {
    return this.docModel.dataTables[tableId];
  }

  // Get a DataTableModel, possibly wrapped to include diff data if a comparison is
  // in effect.
  public getTableModelMaybeWithDiff(tableId: string): DataTableModel {
    const tableModel = this.getTableModel(tableId);
    if (!this.comparison?.details) { return tableModel; }
    // TODO: cache wrapped models and share between views.
    return new DataTableModelWithDiff(tableModel, this.comparison.details);
  }

  /**
   * Sends an action to create a new empty table and switches to that table's primary view.
   */
  public async addEmptyTable(): Promise<void> {
    const tableInfo = await this.docData.sendAction(['AddEmptyTable']);
    await this.openDocPage(this.docModel.tables.getRowModel(tableInfo.id).primaryViewId());
  }

  /**
   * Adds a view section described by val to the current page.
   */
  public async addWidgetToPage(val: IPageWidget) {
    const docData = this.docModel.docData;
    const viewName = this.viewModel.name.peek();

    const res = await docData.bundleActions(
      `Added new linked section to view ${viewName}`,
      () => this.addWidgetToPageImpl(val)
    );

    // The newly-added section should be given focus.
    this.viewModel.activeSectionId(res.sectionRef);
  }

  /**
   * The actual implementation of addWidgetToPage
   */
  public async addWidgetToPageImpl(val: IPageWidget) {
    const viewRef = this.activeViewId.get();
    const tableRef = val.table === 'New Table' ? 0 : val.table;
    const link = linkFromId(val.link);

    const result = await this.docData.sendAction(
      ['CreateViewSection', tableRef, viewRef, val.type, val.summarize ? val.columns : null]
    );
    await this.docData.sendAction(
      ['UpdateRecord', '_grist_Views_section', result.sectionRef, {
        linkSrcSectionRef: link.srcSectionRef,
        linkSrcColRef: link.srcColRef,
        linkTargetColRef: link.targetColRef
      }]
    );
    return result;
  }

  /**
   * Adds a new page (aka: view) with a single view section (aka: page widget) described by `val`.
   */
  public async addNewPage(val: IPageWidget) {
    if (val.table === 'New Table') {
      const result = await this.docData.sendAction(['AddEmptyTable']);
      await this.openDocPage(result.views[0].id);
    } else {
      const result = await this.docData.sendAction(
        ['CreateViewSection', val.table, 0, val.type, val.summarize ? val.columns : null]
      );
      await this.openDocPage(result.viewRef);
      // The newly-added section should be given focus.
      this.viewModel.activeSectionId(result.sectionRef);
    }
  }

  /**
   * Opens a dialog to upload one or multiple files as tables and then switches to the first table's
   * primary view.
   */
  public async uploadNewTable(): Promise<void> {
    const uploadResult = await selectFiles({docWorkerUrl: this.docComm.docWorkerUrl,
                                            multiple: true});
    if (uploadResult) {
      const dataSource = {uploadId: uploadResult.uploadId, transforms: []};
      const importResult = await this.docComm.finishImportFiles(dataSource, {}, []);
      const tableId = importResult.tables[0].hiddenTableId;
      const tableRowModel = this.docModel.dataTables[tableId].tableMetaRow;
      await this.openDocPage(tableRowModel.primaryViewId());
    }
  }

  public async saveViewSection(section: ViewSectionRec, newVal: IPageWidget) {
    const docData = this.docModel.docData;
    const oldVal: IPageWidget = toPageWidget(section);
    const viewModel = section.view();

    if (isEqual(oldVal, newVal)) {
      // nothing to be done
      return;
    }

    await this._viewLayout!.freezeUntil(docData.bundleActions(
      `Saved linked section ${section.title()} in view ${viewModel.name()}`,
      async () => {

        // if table changes or a table is made a summary table, let's replace the view section by a
        // new one, and return.
        if (oldVal.table !== newVal.table || oldVal.summarize !== newVal.summarize) {
          await this._replaceViewSection(section, newVal);
          return;
        }

        // if type changes, let's save it.
        if (oldVal.type !== newVal.type) {
          await section.parentKey.saveOnly(newVal.type);
        }

        // if grouped by column changes, let's use the specific user action.
        if (!isEqual(oldVal.columns, newVal.columns)) {
          await docData.sendAction(
            ['UpdateSummaryViewSection', section.getRowId(), newVal.columns]
          );
        }

        // update link
        if (oldVal.link !== newVal.link) {
          await this.saveLink(linkFromId(newVal.link));
        }
      }
    ));
  }

  // Save link for the active section.
  public async saveLink(link: IPageWidgetLink) {
    const viewModel = this.viewModel;
    return this.docData.sendAction(
      ['UpdateRecord', '_grist_Views_section', viewModel.activeSection.peek().getRowId(), {
        linkSrcSectionRef: link.srcSectionRef,
        linkSrcColRef: link.srcColRef,
        linkTargetColRef: link.targetColRef
      }]
    );
  }


  // Returns the list of all the valid links to link from one of the sections in the active view to
  // the page widget 'widget'.
  public selectBy(widget: IPageWidget) {
    const viewSections = this.viewModel.viewSections.peek().peek();
    return selectBy(this.docModel, viewSections, widget);
  }

  // Fork the document if it is in prefork mode.
  public async forkIfNeeded() {
    if (this.docPageModel.isPrefork.get()) {
      await this.docComm.forkAndUpdateUrl();
    }
  }

  public getDownloadLink() {
    return this.docComm.docUrl('download') + '?' + encodeQueryParams({
      doc: this.docPageModel.currentDocId.get(),
      title: this.docPageModel.currentDocTitle.get(),
      ...this.docComm.getUrlParams(),
    });
  }

  public getCsvLink() {
    return this.docComm.docUrl('gen_csv') + '?' + encodeQueryParams({
      ...this.docComm.getUrlParams(),
      title: this.docPageModel.currentDocTitle.get(),
      viewSection: this.viewModel.activeSectionId(),
      tableId: this.viewModel.activeSection().table().tableId(),
      activeSortSpec: JSON.stringify(this.viewModel.activeSection().activeSortSpec())
    });
  }

  private _getToolContent(tool: typeof RightPanelTool.type): IExtraTool|null {
    switch (tool) {
      case 'docHistory': {
        return {icon: 'Log', label: 'Document History', content: this._docHistory};
      }
      case 'validations': {
        const content = this._rightPanelTabs.get("Validate Data");
        return content ? {icon: 'Validation', label: 'Validation Rules', content} : null;
      }
      case 'repl': {
        const content = this._rightPanelTabs.get("REPL");
        return content ? {icon: 'Repl', label: 'REPL', content} : null;
      }
      case 'none':
      default: {
        return null;
      }
    }
  }

  private async _replaceViewSection(section: ViewSectionRec, newVal: IPageWidget) {

    const docModel = this.docModel;
    const viewModel = section.view();
    const docData = this.docModel.docData;

    // we must read the current layout from the view layout because it can override the one in
    // `section.layoutSpec` (in particular it provides a default layout when missing from the
    // latter).
    const layoutSpec = this._viewLayout!.layoutSpec();

    const sectionTitle = section.title();
    const sectionId = section.id();

    // create a new section
    const sectionCreationResult = await this.addWidgetToPageImpl(newVal);

    // update section name
    const newSection: ViewSectionRec = docModel.viewSections.getRowModel(sectionCreationResult.sectionRef);
    await newSection.title.saveOnly(sectionTitle);

    // replace old section id with new section id in the layout spec and save
    const newLayoutSpec = cloneDeepWith(layoutSpec, (val) => {
      if (typeof val === 'object' && val.leaf === sectionId) {
        return {...val, leaf: newSection.id()};
      }
    });
    await viewModel.layoutSpec.saveOnly(JSON.stringify(newLayoutSpec));

    // The newly-added section should be given focus.
    this.viewModel.activeSectionId(newSection.getRowId());

    // remove old section
    await docData.sendAction(['RemoveViewSection', sectionId]);
  }

  /**
   * Helper called before an action is sent to the server. It saves cursor position to come back to
   * in case of Undo.
   */
  private _onSendActionsStart(ev: {cursorPos: CursorPos}) {
    this._lastOwnActionGroup = null;
    ev.cursorPos = this.getCursorPos();
  }

  /**
   * Helper called when server responds to an action. It attaches the saved cursor position to the
   * received action (if any), and stores also the resulting position.
   */
  private _onSendActionsEnd(ev: {cursorPos: CursorPos}) {
    const a = this._lastOwnActionGroup;
    if (a) {
      a.cursorPos = ev.cursorPos;
      if (a.rowIdHint) {
        a.cursorPos.rowId = a.rowIdHint;
      }
    }
  }

  /**
   * Switch to a given sectionId, wait for it to load, and return a Promise for the instantiated
   * viewInstance (such as an instance of GridView or DetailView).
   */
  private async _switchToSectionId(sectionId: number) {
    const section: ViewSectionRec = this.docModel.viewSections.getRowModel(sectionId);
    const view: ViewRec = section.view.peek();
    await this.openDocPage(view.getRowId());
    view.activeSectionId(sectionId);  // this.viewModel will reflect this with a delay.

    // Returns the value of section.viewInstance() as soon as it is truthy.
    return waitObs(section.viewInstance);
  }

  /**
   * Move to the desired cursor position.  If colRef is supplied, the cursor will be
   * moved to a field with that colRef.  Any linked sections that need their cursors
   * moved in order to achieve the desired outcome are handled recursively.
   * If setAsActiveSection is true, the section in cursorPos is set as the current
   * active section.
   */
  private async _recursiveMoveToCursorPos(cursorPos: CursorPos, setAsActiveSection: boolean,
                                          colRef?: number): Promise<void> {
    try {
      if (!cursorPos.sectionId) { throw new Error('sectionId required'); }
      if (!cursorPos.rowId) { throw new Error('rowId required'); }
      const section = this.docModel.viewSections.getRowModel(cursorPos.sectionId);
      const srcSection = section.linkSrcSection.peek();
      if (srcSection.id.peek()) {
        // We're in a linked section, so we need to recurse to make sure the row we want
        // will be visible.
        const linkTargetCol = section.linkTargetCol.peek();
        let controller: any;
        if (linkTargetCol.colId.peek()) {
          const destTable = await this._getTableData(section);
          controller = destTable.getValue(cursorPos.rowId, linkTargetCol.colId.peek());
        } else {
          controller = cursorPos.rowId;
        }
        const colId = section.linkSrcCol.peek().colId.peek();
        let srcRowId: any;
        const isSrcSummary = srcSection.table.peek().summarySource.peek().id.peek();
        if (!colId && !isSrcSummary) {
          // Simple case - source linked by rowId, not a summary.
          srcRowId = controller;
        } else {
          const srcTable = await this._getTableData(srcSection);
          if (!colId) {
            // must be a summary -- otherwise dealt with earlier.
            const destTable = await this._getTableData(section);
            const filter: {[key: string]: any} = {};
            for (const c of srcSection.table.peek().columns.peek().peek()) {
              if (c.summarySourceCol.peek()) {
                const filterColId = c.summarySource.peek().colId.peek();
                const destValue = destTable.getValue(cursorPos.rowId, filterColId);
                filter[filterColId] = destValue;
              }
            }
            const result = srcTable.filterRecords(filter); // Should just have one record, or 0.
            srcRowId = result[0] && result[0].id;
          } else {
            srcRowId = srcTable.findRow(colId, controller);
          }
        }
        if (!srcRowId || typeof srcRowId !== 'number') { throw new Error('cannot trace rowId'); }
        await this._recursiveMoveToCursorPos({
          rowId: srcRowId,
          sectionId: srcSection.id.peek()
        }, false);
      }
      const view: ViewRec = section.view.peek();
      await this.openDocPage(view.getRowId());
      if (setAsActiveSection) { view.activeSectionId(cursorPos.sectionId); }
      const fieldIndex = colRef ? section.viewFields().peek().findIndex(f => f.colRef.peek() === colRef) : undefined;
      const viewInstance = await waitObs(section.viewInstance);
      if (!viewInstance) { throw new Error('view not found'); }
      // Give any synchronous initial cursor setting a chance to happen.
      await delay(0);
      viewInstance.setCursorPos({...cursorPos, fieldIndex});
      // TODO: column selection not working on card/detail view, or getting overridden -
      // look into it (not a high priority for now since feature not easily discoverable
      // in this view).
    } catch (e) {
      console.debug(`_recursiveMoveToCursorPos(${JSON.stringify(cursorPos)}): ${e}`);
      throw new UserError('There was a problem finding the desired cell.');
    }
  }

  private async _getTableData(section: ViewSectionRec): Promise<TableData> {
    const viewInstance = await waitObs(section.viewInstance);
    if (!viewInstance) { throw new Error('view not found'); }
    await viewInstance.getLoadingDonePromise();
    const table = this.docData.getTable(section.table.peek().tableId.peek());
    if (!table) { throw new Error('no section table'); }
    return table;
  }
}

/**
 * Convert a url hash to a cursor position.
 */
function getCursorPosFromHash(hash: HashLink): CursorPos {
  return { rowId: hash.rowId, sectionId: hash.sectionId };
}

async function finalizeAnchor() {
  await urlState().pushUrl({ hash: {} }, { replace: true });
  setTestState({anchorApplied: true});
}

const cssViewContentPane = styled('div', `
  flex: auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  min-width: 240px;
  margin: 12px;
  @media print {
    & {
      margin: 0px;
    }
  }
`);
