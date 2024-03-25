/**
 * GristDoc manages an open Grist document on the client side.
 */
// tslint:disable:no-console

import {AccessRules} from 'app/client/aclui/AccessRules';
import {ActionLog} from 'app/client/components/ActionLog';
import BaseView from 'app/client/components/BaseView';
import {isNumericLike, isNumericOnly} from 'app/client/components/ChartView';
import {CodeEditorPanel} from 'app/client/components/CodeEditorPanel';
import * as commands from 'app/client/components/commands';
import {CursorMonitor, ViewCursorPos} from "app/client/components/CursorMonitor";
import {DocComm} from 'app/client/components/DocComm';
import * as DocConfigTab from 'app/client/components/DocConfigTab';
import {Drafts} from "app/client/components/Drafts";
import {EditorMonitor} from "app/client/components/EditorMonitor";
import GridView from 'app/client/components/GridView';
import {importFromFile, selectAndImport} from 'app/client/components/Importer';
import {RawDataPage, RawDataPopup} from 'app/client/components/RawDataPage';
import {RecordCardPopup} from 'app/client/components/RecordCardPopup';
import {ActionGroupWithCursorPos, UndoStack} from 'app/client/components/UndoStack';
import {ViewLayout} from 'app/client/components/ViewLayout';
import {get as getBrowserGlobals} from 'app/client/lib/browserGlobals';
import {DocPluginManager} from 'app/client/lib/DocPluginManager';
import {ImportSourceElement} from 'app/client/lib/ImportSourceElement';
import {makeT} from 'app/client/lib/localization';
import {createSessionObs} from 'app/client/lib/sessionObs';
import {logTelemetryEvent} from 'app/client/lib/telemetry';
import {setTestState} from 'app/client/lib/testState';
import {selectFiles} from 'app/client/lib/uploads';
import {AppModel, reportError} from 'app/client/models/AppModel';
import BaseRowModel from 'app/client/models/BaseRowModel';
import DataTableModel from 'app/client/models/DataTableModel';
import {DataTableModelWithDiff} from 'app/client/models/DataTableModelWithDiff';
import {DocData} from 'app/client/models/DocData';
import {DocInfoRec, DocModel, ViewFieldRec, ViewRec, ViewSectionRec} from 'app/client/models/DocModel';
import {DocPageModel} from 'app/client/models/DocPageModel';
import {UserError} from 'app/client/models/errors';
import {getMainOrgUrl, urlState} from 'app/client/models/gristUrlState';
import {getFilterFunc, QuerySetManager} from 'app/client/models/QuerySet';
import TableModel from 'app/client/models/TableModel';
import {getUserOrgPrefObs, getUserOrgPrefsObs, markAsSeen} from 'app/client/models/UserPrefs';
import {App} from 'app/client/ui/App';
import {DocHistory} from 'app/client/ui/DocHistory';
import {startDocTour} from "app/client/ui/DocTour";
import {DocTutorial} from 'app/client/ui/DocTutorial';
import {DocSettingsPage} from 'app/client/ui/DocumentSettings';
import {isTourActive, isTourActiveObs} from "app/client/ui/OnBoardingPopups";
import {DefaultPageWidget, IPageWidget, toPageWidget} from 'app/client/ui/PageWidgetPicker';
import {linkFromId, NoLink, selectBy} from 'app/client/ui/selectBy';
import {WebhookPage} from 'app/client/ui/WebhookPage';
import {startWelcomeTour} from 'app/client/ui/WelcomeTour';
import {getTelemetryWidgetTypeFromPageWidget} from 'app/client/ui/widgetTypesMap';
import {PlayerState, YouTubePlayer} from 'app/client/ui/YouTubePlayer';
import {isNarrowScreen, mediaSmall, mediaXSmall, testId, theme} from 'app/client/ui2018/cssVars';
import {IconName} from 'app/client/ui2018/IconList';
import {icon} from 'app/client/ui2018/icons';
import {invokePrompt} from 'app/client/ui2018/modals';
import {DiscussionPanel} from 'app/client/widgets/DiscussionEditor';
import {FieldEditor} from "app/client/widgets/FieldEditor";
import {MinimalActionGroup} from 'app/common/ActionGroup';
import {ClientQuery, FilterColValues} from "app/common/ActiveDocAPI";
import {CommDocChatter, CommDocUsage, CommDocUserAction} from 'app/common/CommTypes';
import {delay} from 'app/common/delay';
import {DisposableWithEvents} from 'app/common/DisposableWithEvents';
import {isSchemaAction, UserAction} from 'app/common/DocActions';
import {OpenLocalDocResult} from 'app/common/DocListAPI';
import {isList, isListType, isRefListType, RecalcWhen} from 'app/common/gristTypes';
import {HashLink, IDocPage, isViewDocPage, parseUrlId, SpecialDocPage, ViewDocPage} from 'app/common/gristUrls';
import {undef, waitObs} from 'app/common/gutil';
import {LocalPlugin} from "app/common/plugin";
import {StringUnion} from 'app/common/StringUnion';
import {TableData} from 'app/common/TableData';
import {getGristConfig} from 'app/common/urlUtils';
import {DocStateComparison} from 'app/common/UserAPI';
import {AttachedCustomWidgets, IAttachedCustomWidget, IWidgetType, WidgetType} from 'app/common/widgetTypes';
import {CursorPos, UIRowId} from 'app/plugin/GristAPI';
import {
  bundleChanges,
  Computed,
  dom,
  DomContents,
  Emitter,
  fromKo,
  Holder,
  IDisposable,
  IDisposableOwner,
  IDomComponent,
  keyframes,
  MultiHolder,
  Observable,
  styled,
  subscribe,
  toKo
} from 'grainjs';
import * as ko from 'knockout';
import cloneDeepWith = require('lodash/cloneDeepWith');
import isEqual = require('lodash/isEqual');

const RICK_ROLL_YOUTUBE_EMBED_ID = 'dQw4w9WgXcQ';

const t = makeT('GristDoc');

const G = getBrowserGlobals('document', 'window');

// Re-export some tools to move them from main webpack bundle to the one with GristDoc.
export {DocComm, startDocTour};

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

const RightPanelTool = StringUnion("none", "docHistory", "validations", "discussion");

export interface IExtraTool {
  icon: IconName;
  label: DomContents;
  content: TabContent[] | IDomComponent;
}

interface PopupSectionOptions {
  viewSection: ViewSectionRec;
  hash: HashLink;
  close: () => void;
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
  public rightPanelTool: Observable<IExtraTool | null>;
  public isReadonly = this.docPageModel.isReadonly;
  public isReadonlyKo = toKo(ko, this.isReadonly);
  public comparison: DocStateComparison | null;
  // component for keeping track of latest cursor position
  public cursorMonitor: CursorMonitor;
  // component for keeping track of a cell that is being edited
  public editorMonitor: EditorMonitor;
  // component for keeping track of a cell that is being edited
  public draftMonitor: Drafts;
  // will document perform its own navigation (from anchor link)
  public hasCustomNav: Observable<boolean>;
  // Emitter triggered when the main doc area is resized.
  public readonly resizeEmitter = this.autoDispose(new Emitter());

  // This holds a single FieldEditor. When a new FieldEditor is created (on edit), it replaces the
  // previous one if any. The holder is maintained by GristDoc, so that we are guaranteed at
  // most one instance of FieldEditor at any time.
  public readonly fieldEditorHolder = Holder.create(this);
  // active field editor
  public readonly activeEditor: Observable<FieldEditor | null> = Observable.create(this, null);

  // Holds current view that is currently rendered
  public currentView: Observable<BaseView | null>;

  // Holds current cursor position with a view id
  public cursorPosition: Computed<ViewCursorPos | undefined>;

  public readonly userOrgPrefs = getUserOrgPrefsObs(this.docPageModel.appModel);

  public readonly behavioralPromptsManager = this.docPageModel.appModel.behavioralPromptsManager;
  // One of the section can be expanded (as requested from the Layout), we will
  // store its id in this variable. NOTE: expanded section looks exactly the same as a section
  // in the popup. But they are rendered differently, as section in popup is probably an external
  // section (or raw data section) that is not part of this view. Maximized section is a section
  // in the view, so there is no need to render it twice, layout just hides all other sections to make
  // the space.
  public maximizedSectionId: Observable<number | null> = Observable.create(this, null);
  // This is id of the section that is currently shown in the popup. Probably this is an external
  // section, like raw data view, or a section from another view.
  public externalSectionId: Computed<number | null>;
  public viewLayout: ViewLayout | null = null;

  // Holder for the popped up formula editor.
  public readonly formulaPopup = Holder.create(this);

  public readonly currentTheme = this.docPageModel.appModel.currentTheme;

  public get docApi() {
    return this.docPageModel.appModel.api.getDocAPI(this.docPageModel.currentDocId.get()!);
  }

  private _actionLog: ActionLog;
  private _undoStack: UndoStack;
  private _lastOwnActionGroup: ActionGroupWithCursorPos | null = null;
  private _rightPanelTabs = new Map<string, TabContent[]>();
  private _docHistory: DocHistory;
  private _discussionPanel: DiscussionPanel;
  private _rightPanelTool = createSessionObs(this, "rightPanelTool", "none", RightPanelTool.guard);
  private _showGristTour = getUserOrgPrefObs(this.userOrgPrefs, 'showGristTour');
  private _seenDocTours = getUserOrgPrefObs(this.userOrgPrefs, 'seenDocTours');
  private _popupSectionOptions: Observable<PopupSectionOptions | null> = Observable.create(this, null);
  private _activeContent: Computed<IDocPage>;
  private _docTutorialHolder = Holder.create<DocTutorial>(this);
  private _isRickRowing: Observable<boolean> = Observable.create(this, false);
  private _showBackgroundVideoPlayer: Observable<boolean> = Observable.create(this, false);
  private _backgroundVideoPlayerHolder: Holder<YouTubePlayer> = Holder.create(this);
  private _disableAutoStartingTours: boolean = false;
  private _isShowingPopupSection = false;
  private _prevSectionId: number | null = null;

  constructor(
    public readonly app: App,
    public readonly appModel: AppModel,
    public readonly docComm: DocComm,
    public readonly docPageModel: DocPageModel,
    openDocResponse: OpenLocalDocResult,
    plugins: LocalPlugin[],
    options: {
      comparison?: DocStateComparison  // initial comparison with another document
    } = {}
  ) {
    super();
    console.log("RECEIVED DOC RESPONSE", openDocResponse);
    this.docData = new DocData(this.docComm, openDocResponse.doc);
    this.docModel = new DocModel(this.docData, this.docPageModel);
    this.querySetManager = QuerySetManager.create(this, this.docModel, this.docComm);
    this.docPluginManager = new DocPluginManager({
      plugins,
      untrustedContentOrigin: app.topAppModel.getUntrustedContentOrigin(),
      docComm: this.docComm,
      clientScope: app.clientScope,
      theme: this.currentTheme,
    });

    // Maintain the MetaRowModel for the global document info, including docId and peers.
    this.docInfo = this.docModel.docInfoRow;

    const defaultViewId = this.docInfo.newDefaultViewId;

    // Grainjs observable for current view id, which may be a string such as 'code'.
    this.activeViewId = Computed.create(this, (use) => {
      const {docPage} = use(urlState().state);

      // Return most special pages like 'code' and 'acl' as is
      if (typeof docPage === 'string' && docPage !== 'GristDocTour' && SpecialDocPage.guard(docPage)) {
        return docPage;
      }

      // GristDocTour is a special table that is usually hidden from users, but putting /p/GristDocTour
      // in the URL navigates to it and makes it visible in the list of pages in the sidebar
      // For GristDocTour, find the view with that name.
      // Otherwise find the view with the given row ID, because letting a non-existent row ID pass through here is bad.
      // If no such view exists, return the default view.
      const viewId = this.docModel.views.tableData.findRow(docPage === 'GristDocTour' ? 'name' : 'id', docPage);
      return viewId || use(defaultViewId);
    });
    this._activeContent = Computed.create(this, use => use(this.activeViewId));
    this.externalSectionId = Computed.create(this, use => {
      const externalContent = use(this._popupSectionOptions);
      return externalContent ? use(externalContent.viewSection.id) : null;
    });
    // This viewModel reflects the currently active view, relying on the fact that
    // createFloatingRowModel() supports an observable rowId for its argument.
    // Although typings don't reflect it, createFloatingRowModel() accepts non-numeric values,
    // which yield an empty row, which is why we can cast activeViewId.
    this.viewModel = this.autoDispose(
      this.docModel.views.createFloatingRowModel(toKo(ko, this.activeViewId) as ko.Computed<number>));

    // When active section is changed, clear the maximized state.
    this.autoDispose(this.viewModel.activeSectionId.subscribe((id) => {
      if (id === this.maximizedSectionId.get()) {
        return;
      }
      this.maximizedSectionId.set(null);
      // If we have layout, update it.
      if (!this.viewLayout?.isDisposed()) {
        this.viewLayout?.maximized.set(null);
      }
    }));

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

    // Subscribe to URL state, and navigate to anchor or open a popup if necessary.
    this.autoDispose(subscribe(urlState().state, async (use, state) => {
      if (!state.hash) {
        return;
      }

      try {
        if (state.hash.popup || state.hash.recordCard) {
          await this._openPopup(state.hash);
        } else {
          // Navigate to an anchor if one is present in the url hash.
          const cursorPos = this._getCursorPosFromHash(state.hash);
          await this.recursiveMoveToCursorPos(cursorPos, true);
        }

        const isTourOrTutorialActive = isTourActive() || this.docModel.isTutorial();
        if (state.hash.rickRow && !this._isRickRowing.get() && !isTourOrTutorialActive) {
          YouTubePlayer.create(this._backgroundVideoPlayerHolder, RICK_ROLL_YOUTUBE_EMBED_ID, {
            height: '100%',
            width: '100%',
            origin: getMainOrgUrl(),
            playerVars: {
              controls: 0,
              disablekb: 1,
              fs: 0,
              iv_load_policy: 3,
              modestbranding: 1,
            },
            onPlayerStateChange: (_player, event) => {
              if (event.data === PlayerState.Playing) {
                this._isRickRowing.set(true);
              }
            },
          }, cssYouTubePlayer.cls(''));
          this._showBackgroundVideoPlayer.set(true);
          this._waitForView()
            .then(() => {
              const cursor = document.querySelector('.selected_cursor.active_cursor');
              if (!cursor) {
                return;
              }

              this.behavioralPromptsManager.showPopup(cursor, 'rickRow', {
                onDispose: () => this._playRickRollVideo(),
              });
            })
            .catch(reportError);
        }
      } catch (e) {
        reportError(e);
      } finally {
        setTimeout(finalizeAnchor, 0);
      }
    }));

    this.autoDispose(subscribe(
      urlState().state,
      isTourActiveObs(),
      fromKo(this.docModel.isTutorial),
      async (_use, state, hasActiveTour, isTutorial) => {
        // Tours and tutorials can interfere with in-product tips and announcements.
        const hasPendingDocTour = state.docTour || await this._shouldAutoStartDocTour();
        const hasPendingWelcomeTour = state.welcomeTour || this._shouldAutoStartWelcomeTour();
        const isPopupManagerDisabled = this.behavioralPromptsManager.isDisabled();
        if (
          (hasPendingDocTour || hasPendingWelcomeTour || hasActiveTour || isTutorial) &&
          !isPopupManagerDisabled
        ) {
          this.behavioralPromptsManager.disable();
        } else if (isPopupManagerDisabled) {
          this.behavioralPromptsManager.enable();
        }
      }
    ));

    let isStartingTourOrTutorial = false;
    this.autoDispose(subscribe(urlState().state, async (_use, state) => {
      // Only start a tour or tutorial when the full interface is showing, i.e. not when in
      // embedded mode.
      if (state.params?.style === 'singlePage') {
        return;
      }

      const isTutorial = this.docModel.isTutorial();
      // Onboarding tours were not designed with mobile support in mind. Disable until fixed.
      if (isNarrowScreen() && !isTutorial) {
        return;
      }

      // Onboarding tours can conflict with rick rowing.
      if (state.hash?.rickRow) {
        this._disableAutoStartingTours = true;
      }

      // If we have an active tour or tutorial (or are in the process of starting one), don't start
      // a new one.
      const hasActiveTourOrTutorial = isTourActive() || !this._docTutorialHolder.isEmpty();
      if (isStartingTourOrTutorial || hasActiveTourOrTutorial) {
        return;
      }

      const shouldStartTutorial = isTutorial;
      const shouldStartDocTour = state.docTour || await this._shouldAutoStartDocTour();
      const shouldStartWelcomeTour = state.welcomeTour || this._shouldAutoStartWelcomeTour();
      if (shouldStartTutorial || shouldStartDocTour || shouldStartWelcomeTour) {
        isStartingTourOrTutorial = true;
        try {
          await this._waitForView();

          // Remove any tour-related hash-tags from the URL. So #repeat-welcome-tour and
          // #repeat-doc-tour are used as triggers, but will immediately disappear.
          await urlState().pushUrl({welcomeTour: false, docTour: false},
            {replace: true, avoidReload: true});

          if (shouldStartTutorial) {
            await DocTutorial.create(this._docTutorialHolder, this).start();
          } else if (shouldStartDocTour) {
            const onFinishCB = () => (
              !this._seenDocTours.get()?.includes(this.docId())
              && markAsSeen(this._seenDocTours, this.docId())
            );
            await startDocTour(this.docData, this.docComm, onFinishCB);
            if (this.docPageModel.isTemplate.get()) {
              const doc = this.docPageModel.currentDoc.get();
              if (!doc) { return; }

              logTelemetryEvent('openedTemplateTour', {
                full: {
                  templateId: parseUrlId(doc.urlId || doc.id).trunkId,
                },
              });
            }
          } else {
            startWelcomeTour(() => this._showGristTour.set(false));
          }
        } finally {
          isStartingTourOrTutorial = false;
        }
      }
    }));

    // Importer takes a function for creating previews.
    const createPreview = (vs: ViewSectionRec) => {
      const preview = GridView.create(this, vs, true);
      // We need to set the instance to the newly created section. This is important, as
      // GristDoc is responsible for changing the cursor position not the cursor itself. Final
      // cursor position is determined by finding active (or visible) section and passing this
      // command (setCursor) to its instance.
      vs.viewInstance(preview);
      preview.autoDisposeCallback(() => vs.viewInstance(null));
      return preview;
    };

    const importSourceElems = ImportSourceElement.fromArray(this.docPluginManager.pluginsList);
    const importMenuItems = [
      {
        label: t("Import from file"),
        action: () => importFromFile(this, createPreview),
      },
      ...importSourceElems.map(importSourceElem => ({
        label: importSourceElem.importSource.label,
        action: () => selectAndImport(this, importSourceElems, importSourceElem, createPreview)
      }))
    ];

    // Set the available import sources in the DocPageModel.
    this.docPageModel.importSources = importMenuItems;

    this._actionLog = this.autoDispose(ActionLog.create({gristDoc: this}));
    this._undoStack = this.autoDispose(UndoStack.create(openDocResponse.log, {gristDoc: this}));
    this._docHistory = DocHistory.create(this, this.docPageModel, this._actionLog);
    this._discussionPanel = DiscussionPanel.create(this, this);

    // Tap into docData's sendActions method to save the cursor position with every action, so that
    // undo/redo can jump to the right place.
    this.autoDispose(this.docData.sendActionsEmitter.addListener(this._onSendActionsStart, this));
    this.autoDispose(this.docData.sendActionsDoneEmitter.addListener(this._onSendActionsEnd, this));

    /* Command binding */
    this.autoDispose(commands.createGroup({
      undo() {
        this._undoStack.sendUndoAction().catch(reportError);
      },
      redo() {
        this._undoStack.sendRedoAction().catch(reportError);
      },
      reloadPlugins() {
        void this.docComm.reloadPlugins().then(() => G.window.location.reload(false));
      },

      // Command to be manually triggered on cell selection. Moves the cursor to the selected cell.
      // This is overridden by the formula editor to insert "$col" variables when clicking cells.
      setCursor: this.onSetCursorPos.bind(this),
      createForm: this.onCreateForm.bind(this),
    }, this, true));

    this.listenTo(app.comm, 'docUserAction', this.onDocUserAction);

    this.listenTo(app.comm, 'docUsage', this.onDocUsageMessage);

    this.listenTo(app.comm, 'docChatter', this.onDocChatter);

    this._handleTriggerQueueOverflowMessage();

    this.autoDispose(DocConfigTab.create({gristDoc: this}));

    this.rightPanelTool = Computed.create(this, (use) => this._getToolContent(use(this._rightPanelTool)));

    this.comparison = options.comparison || null;

    // We need prevent default here to allow drop events to fire.
    this.autoDispose(dom.onElem(window, 'dragover', (ev) => ev.preventDefault()));
    // The default action is to open dragged files as a link, navigating out of the app.
    this.autoDispose(dom.onElem(window, 'drop', (ev) => ev.preventDefault()));

    // On window resize, trigger the resizeEmitter to update ViewLayout and individual BaseViews.
    this.autoDispose(dom.onElem(window, 'resize', () => this.resizeEmitter.emit()));

    // create current view observer
    this.currentView = Observable.create<BaseView | null>(this, null);

    // create computed observable for viewInstance - if it is loaded or not

    // GrainJS will not recalculate section.viewInstance correctly because it will be
    // modified (updated from null to a correct instance) in the same tick. We need to
    // switch for a moment to knockout to fix this.
    const viewInstance = fromKo(this.autoDispose(ko.pureComputed(() => {
      const viewId = toKo(ko, this.activeViewId)();
      if (!isViewDocPage(viewId)) {
        return null;
      }
      const section = this.viewModel.activeSection();
      if (section?.isDisposed()) { return null; }
      const view = section.viewInstance();
      return view;
    })));

    // then listen if the view is present, because we still need to wait for it load properly
    this.autoDispose(viewInstance.addListener(async (view) => {
      if (view) {
        await view.getLoadingDonePromise();
      }
      if (view?.isDisposed()) {
        return;
      }
      // finally set the current view as fully loaded
      this.currentView.set(view);
    }));

    // create observable for current cursor position
    this.cursorPosition = Computed.create<ViewCursorPos | undefined>(this, use => {
      // get the BaseView
      const view = use(this.currentView);
      if (!view) {
        return undefined;
      }
      const viewId = use(this.activeViewId);
      if (!isViewDocPage(viewId)) {
        return undefined;
      }
      // read latest position
      const currentPosition = use(view.cursor.currentPosition);
      if (currentPosition) {
        return {...currentPosition, viewId};
      }
      return undefined;
    });

    this.hasCustomNav = Computed.create(this, urlState().state, (_, state) => {
      const hash = state.hash;
      return !!(hash && (undef(hash.colRef, hash.rowId, hash.sectionId) !== undefined));
    });

    this.draftMonitor = Drafts.create(this, this);
    this.cursorMonitor = CursorMonitor.create(this, this);
    this.editorMonitor = EditorMonitor.create(this, this);

    // When active section is changed to a chart or custom widget, change the tab in the creator
    // panel to the table.
    this.autoDispose(this.viewModel.activeSection.subscribe((section) => {
      if (section.isDisposed() || section._isDeleted.peek()) {
        return;
      }
      if (['chart', 'custom'].includes(section.parentKey.peek())) {
        commands.allCommands.viewTabFocus.run();
      }
    }));

    this.autoDispose(this._popupSectionOptions.addListener((popupOptions) => {
      if (!popupOptions) {
        this._isShowingPopupSection = false;
        this._prevSectionId = null;
      }
    }));
  }

  /**
   * Returns current document's id
   */
  public docId() {
    return this.docPageModel.currentDocId.get()!;
  }

  // DEPRECATED This is used only for validation, which is not used anymore.
  public addOptionsTab(label: string, iconElem: any, contentObj: TabContent[], options: TabOptions): IDisposable {
    this._rightPanelTabs.set(label, contentObj);
    // Return a do-nothing disposable, to satisfy the previous interface.
    return {dispose: () => null};
  }

  /**
   * Builds the DOM for this GristDoc.
   */
  public buildDom() {
    const isMaximized = Computed.create(this, use => use(this.maximizedSectionId) !== null);
    const isPopup = Computed.create(this, use => {
      return ['data', 'settings'].includes(use(this.activeViewId) as any) // On Raw data or doc settings pages
        || use(isMaximized) // Layout has a maximized section visible
        || Boolean(use(this._popupSectionOptions)); // Layout has a popup section visible
    });
    return cssViewContentPane(
      testId('gristdoc'),
      cssViewContentPane.cls("-contents", isPopup),
      dom.maybe(this._isRickRowing, () => cssStopRickRowingButton(
        cssCloseIcon('CrossBig'),
        dom.on('click', () => {
          this._isRickRowing.set(false);
          this._showBackgroundVideoPlayer.set(false);
        }),
        testId('gristdoc-stop-rick-rowing'),
      )),
      dom.domComputed(this._activeContent, (content) => {
        return  (
          content === 'code' ? dom.create(CodeEditorPanel, this) :
          content === 'acl' ? dom.create(AccessRules, this) :
          content === 'data' ? dom.create(RawDataPage, this) :
          content === 'settings' ? dom.create(DocSettingsPage, this) :
          content === 'webhook' ? dom.create(WebhookPage, this) :
          content === 'GristDocTour' ? null :
          [
            dom.create((owner) => {
              this.viewLayout = ViewLayout.create(owner, this, content);
              this.viewLayout.maximized.addListener(sectionId => {
                this.maximizedSectionId.set(sectionId);

                if (sectionId === null && !this._isShowingPopupSection) {
                  // If we didn't navigate to another section in the popup, move focus
                  // back to the previous section.
                  this._focusPreviousSection();
                }
              });
              owner.onDispose(() => this.viewLayout = null);
              return this.viewLayout;
            }),
            dom.maybe(this._popupSectionOptions, (popupOptions) => {
              return dom.create((owner) => {
                // In case user changes a page, close the popup.
                owner.autoDispose(this.activeViewId.addListener(popupOptions.close));

                // In case the section is removed, close the popup.
                popupOptions.viewSection.autoDispose({dispose: popupOptions.close});

                const {recordCard, rowId} = popupOptions.hash;
                if (recordCard) {
                  if (!rowId || rowId === 'new') {
                    // Should be unreachable, but just to be sure (and to satisfy type checking)...
                    throw new Error('Unable to open Record Card: undefined row id');
                  }

                  return dom.create(RecordCardPopup, {
                    gristDoc: this,
                    rowId,
                    viewSection: popupOptions.viewSection,
                    onClose: popupOptions.close,
                  });
                } else {
                  return dom.create(RawDataPopup, this, popupOptions.viewSection, popupOptions.close);
                }
              });
            }),
          ]
        );
      }),
      dom.maybe(this._showBackgroundVideoPlayer, () => [
        cssBackgroundVideo(
          this._backgroundVideoPlayerHolder.get()?.buildDom(),
          cssBackgroundVideo.cls('-fade-in-and-out', this._isRickRowing),
          testId('gristdoc-background-video'),
        ),
      ]),
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
    const pos = {sectionId: this.viewModel.activeSectionId()};
    const viewInstance = this.viewModel.activeSection.peek().viewInstance.peek();
    return Object.assign(pos, viewInstance ? viewInstance.cursor.getCursorPos() : {});
  }

  public async onSetCursorPos(rowModel: BaseRowModel | undefined, fieldModel?: ViewFieldRec) {
    return this.setCursorPos({
      rowIndex: rowModel?._index() || 0,
      fieldIndex: fieldModel?._index() || 0,
      sectionId: fieldModel?.viewSection().getRowId(),
    });
  }

  public async setCursorPos(cursorPos: CursorPos) {
    if (cursorPos.sectionId && cursorPos.sectionId !== this.externalSectionId.get()) {
      const desiredSection: ViewSectionRec = this.docModel.viewSections.getRowModel(cursorPos.sectionId);
      // If the section id is 0, the section doesn't exist (can happen during undo/redo), and should
      // be fixed there. For now ignore it, to not create empty sections or views (peeking a view will create it).
      if (!desiredSection.id.peek()) {
        return;
      }
      // If this is completely unknown section (without a parent), it is probably an import preview.
      if (
        !desiredSection.parentId.peek() &&
        !desiredSection.isRaw.peek() &&
        !desiredSection.isRecordCard.peek()
      ) {
        const view = desiredSection.viewInstance.peek();
        // Make sure we have a view instance here - it will prove our assumption that this is
        // an import preview. Section might also be disconnected during undo/redo.
        if (view && !view.isDisposed()) {
          view.setCursorPos(cursorPos);
          return;
        }
      }
      if (desiredSection.view.peek().getRowId() !== this.activeViewId.get()) {
        // This may be asynchronous. In other cases, the change is synchronous, and some code
        // relies on it (doesn't wait for this function to resolve).
        await this._switchToSectionId(cursorPos.sectionId);
      } else if (desiredSection !== this.viewModel.activeSection.peek()) {
        this.viewModel.activeSectionId(cursorPos.sectionId);
      }
    }
    const viewInstance = this.viewModel.activeSection.peek().viewInstance.peek();
    viewInstance?.setCursorPos(cursorPos);
  }

  /**
   * Switch to the view/section and scroll to the record indicated by cursorPos. If cursorPos is
   * null, then moves to a position best suited for optActionGroup (not yet implemented).
   */
  public async moveToCursorPos(cursorPos?: CursorPos, optActionGroup?: MinimalActionGroup): Promise<void> {
    if (!cursorPos || !cursorPos.sectionId) {
      // TODO We could come up with a suitable cursorPos here based on the action itself.
      // This should only come up if trying to undo/redo after reloading a page (since the cursorPos
      // associated with the action is only stored in memory of the current JS process).
      // A function like `getCursorPosForActionGroup(ag)` would also be useful to jump to the best
      // place from any action in the action log.
      // When user deletes table from Raw Data view, the section id will be 0 and undoing that
      // operation will move cursor to the empty section row (with id 0).
      return;
    }
    try {
      await this.setCursorPos(cursorPos);
    } catch (e) {
      reportError(e);
    }
  }

  /**
   * Process actions received from the server by forwarding them to `docData.receiveAction()` and
   * pushing them to actionLog.
   */
  public onDocUserAction(message: CommDocUserAction) {
    console.log("GristDoc.onDocUserAction", message);
    let schemaUpdated = false;
    /**
     * If an operation is applied successfully to a document, and then information about
     * it is broadcast to clients, and one of those broadcasts has a failure (due to
     * granular access control, which is client-specific), then that error is logged on
     * the server and also sent to the client via an `error` field.  Under normal operation,
     * there should be no such errors, but if they do arise it is best to make them as visible
     * as possible.
     */
    if (message.data.error) {
      reportError(new Error(message.data.error));
      return;
    }
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
      this.docPageModel.updateCurrentDocUsage(message.data.docUsage);
      this.trigger('onDocUserAction', docActions);
    }
  }

  public getUndoStack() {
    return this._undoStack;
  }

  /**
   * Process usage and product received from the server by updating their respective
   * observables.
   */
  public onDocUsageMessage(message: CommDocUsage) {
    if (!this.docComm.isActionFromThisDoc(message)) {
      return;
    }

    bundleChanges(() => {
      this.docPageModel.updateCurrentDocUsage(message.data.docUsage);
      this.docPageModel.currentProduct.set(message.data.product ?? null);
    });
  }

  public onDocChatter(message: CommDocChatter) {
    if (!this.docComm.isActionFromThisDoc(message) ||
      !message.data.webhooks) {
      return;
    }
    if (message.data.webhooks.type == 'webhookOverflowError') {
      this.trigger('webhookOverflowError',
        t('New changes are temporarily suspended. Webhooks queue overflowed.' +
          ' Please check webhooks settings, remove invalid webhooks, and clean the queue.'),);
    } else {
      this.trigger('webhooks', message.data.webhooks);
    }
  }

  public getTableModel(tableId: string): DataTableModel {
    return this.docModel.getTableModel(tableId);
  }

  // Get a DataTableModel, possibly wrapped to include diff data if a comparison is
  // in effect.
  public getTableModelMaybeWithDiff(tableId: string): DataTableModel {
    const tableModel = this.getTableModel(tableId);
    if (!this.comparison?.details) {
      return tableModel;
    }
    // TODO: cache wrapped models and share between views.
    return new DataTableModelWithDiff(tableModel, this.comparison.details);
  }

  /**
   * Sends an action to create a new empty table and switches to that table's primary view.
   */
  public async addEmptyTable(): Promise<void> {
    const name = await this._promptForName();
    if (name === undefined) {
      return;
    }
    const tableInfo = await this.docData.sendAction(['AddEmptyTable', name || null]);
    await this.openDocPage(this.docModel.tables.getRowModel(tableInfo.id).primaryViewId());
  }

  /**
   * Adds a view section described by val to the current page.
   */
  public async addWidgetToPage(val: IPageWidget) {
    const docData = this.docModel.docData;
    const viewName = this.viewModel.name.peek();
    let tableId: string | null | undefined;
    if (val.table === 'New Table') {
      tableId = await this._promptForName();
      if (tableId === undefined) {
        return;
      }
    }

    const widgetType = getTelemetryWidgetTypeFromPageWidget(val);
    logTelemetryEvent('addedWidget', {full: {docIdDigest: this.docId(), widgetType}});
    if (val.link !== NoLink) {
      logTelemetryEvent('linkedWidget', {full: {docIdDigest: this.docId(), widgetType}});
    }

    const res: {sectionRef: number} = await docData.bundleActions(
      t("Added new linked section to view {{viewName}}", {viewName}),
      () => this.addWidgetToPageImpl(val, tableId ?? null)
    );

    // The newly-added section should be given focus.
    this.viewModel.activeSectionId(res.sectionRef);

    this._maybeShowEditCardLayoutTip(val.type).catch(reportError);

    if (AttachedCustomWidgets.guard(val.type)) {
      this._handleNewAttachedCustomWidget(val.type).catch(reportError);
    }

    return res.sectionRef;
  }

  public async onCreateForm() {
    const table = this.currentView.get()?.viewSection.tableRef.peek();
    if (!table) {
      return;
    }
    await this.addWidgetToPage({
      ...DefaultPageWidget(),
      table,
      type: WidgetType.Form,
    });
    commands.allCommands.expandSection.run();
  }

  /**
   * The actual implementation of addWidgetToPage
   */
  public async addWidgetToPageImpl(val: IPageWidget, tableId: string | null = null) {
    const viewRef = this.activeViewId.get();
    const tableRef = val.table === 'New Table' ? 0 : val.table;
    const result = await this.docData.sendAction(
      ['CreateViewSection', tableRef, viewRef, val.type, val.summarize ? val.columns : null, tableId]
    );
    if (val.type === 'chart') {
      await this._ensureOneNumericSeries(result.sectionRef);
    }
    await this.saveLink(val.link, result.sectionRef);
    return result;
  }

  /**
   * Adds a new page (aka: view) with a single view section (aka: page widget) described by `val`.
   */
  public async addNewPage(val: IPageWidget) {
    logTelemetryEvent('addedPage', {full: {docIdDigest: this.docId()}});
    logTelemetryEvent('addedWidget', {
      full: {
        docIdDigest: this.docId(),
        widgetType: getTelemetryWidgetTypeFromPageWidget(val),
      },
    });

    if (val.table === 'New Table') {
      const name = await this._promptForName();
      if (name === undefined) {
        return;
      }
      let newViewId: IDocPage;
      if (val.type === WidgetType.Table) {
        const result = await this.docData.sendAction(['AddEmptyTable', name]);
        newViewId = result.views[0].id;
      } else {
        // This will create a new table and page.
        const result = await this.docData.sendAction(
          ['CreateViewSection', /* new table */0, 0, val.type, null, name]
        );
        newViewId = result.viewRef;
      }
      await this.openDocPage(newViewId);
    } else {
      let result: any;
      await this.docData.bundleActions(`Add new page`, async () => {
        result = await this.docData.sendAction(
          ['CreateViewSection', val.table, 0, val.type, val.summarize ? val.columns : null, null]
        );
        if (val.type === 'chart') {
          await this._ensureOneNumericSeries(result.sectionRef);
        }
      });
      await this.openDocPage(result.viewRef);
      // The newly-added section should be given focus.
      this.viewModel.activeSectionId(result.sectionRef);

      this._maybeShowEditCardLayoutTip(val.type).catch(reportError);

      if (AttachedCustomWidgets.guard(val.type)) {
        this._handleNewAttachedCustomWidget(val.type).catch(reportError);
      }
    }
  }

  /**
   * Opens a dialog to upload one or multiple files as tables and then switches to the first table's
   * primary view.
   */
  public async uploadNewTable(): Promise<void> {
    const uploadResult = await selectFiles({
      docWorkerUrl: this.docComm.docWorkerUrl,
      multiple: true
    });
    if (uploadResult) {
      const dataSource = {uploadId: uploadResult.uploadId, transforms: []};
      const importResult = await this.docComm.finishImportFiles(dataSource, [], {});
      const tableId = importResult.tables[0].hiddenTableId;
      const tableRowModel = this.docModel.dataTables[tableId].tableMetaRow;
      await this.openDocPage(tableRowModel.primaryViewId());
    }
  }

  public async saveViewSection(section: ViewSectionRec, newVal: IPageWidget) {
    const docData = this.docModel.docData;
    const oldVal: IPageWidget = toPageWidget(section);
    const viewModel = section.view();
    const colIds = section.viewFields().all().map((f) => f.column().colId());

    if (isEqual(oldVal, newVal)) {
      // nothing to be done
      return section;
    }

    return await this.viewLayout!.freezeUntil(docData.bundleActions(
      t("Saved linked section {{title}} in view {{name}}", {title: section.title(), name: viewModel.name()}),
      async () => {

        // if table changes or a table is made a summary table, let's replace the view section by a
        // new one, and return.
        if (oldVal.table !== newVal.table || oldVal.summarize !== newVal.summarize) {
          return await this._replaceViewSection(section, oldVal, newVal);
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
          // Charts needs to keep view fields consistent across update.
          if (newVal.type === 'chart' && oldVal.type === 'chart') {
            await this.setSectionViewFieldsFromArray(section, colIds);
          }
        }

        // update link
        if (oldVal.link !== newVal.link) {
          await this.saveLink(newVal.link);
        }
        return section;
      },
      {nestInActiveBundle: true}
    ));
  }

  // Set section's viewFields to be colIds in that order. Omit any colum id that do not belong to
  // section's table.
  public async setSectionViewFieldsFromArray(section: ViewSectionRec, colIds: string[]) {

    // remove old view fields
    await Promise.all(section.viewFields.peek().all().map((viewField) => (
      this.docModel.viewFields.sendTableAction(['RemoveRecord', viewField.id()])
    )));

    // create map
    const mapColIdToColumn = new Map();
    for (const col of section.table().columns().all()) {
      mapColIdToColumn.set(col.colId(), col);
    }

    // If split series and/or x-axis do not exist any more in new table, update options to make them
    // undefined
    if (colIds.length) {
      if (section.optionsObj.prop('multiseries')()) {
        if (!mapColIdToColumn.has(colIds[0])) {
          await section.optionsObj.prop('multiseries').saveOnly(false);
        }
        if (colIds.length > 1 && !mapColIdToColumn.has(colIds[1])) {
          await section.optionsObj.prop('isXAxisUndefined').saveOnly(true);
        }
      } else if (!mapColIdToColumn.has(colIds[0])) {
        await section.optionsObj.prop('isXAxisUndefined').saveOnly(true);
      }
    }

    // adds new view fields; ignore colIds that do not exist in new table.
    await Promise.all(colIds.map((colId, i) => {
      if (!mapColIdToColumn.has(colId)) {
        return;
      }
      const colInfo = {
        parentId: section.id(),
        colRef: mapColIdToColumn.get(colId).id(),
        parentPos: i
      };
      const action = ['AddRecord', null, colInfo];
      return this.docModel.viewFields.sendTableAction(action);
    }));
  }

  // Save link for a given section, by default the active section.
  public async saveLink(linkId: string, sectionId?: number) {
    sectionId = sectionId || this.viewModel.activeSection.peek().getRowId();
    const link = linkFromId(linkId);
    if (link.targetColRef) {
      const targetTable = this.docModel.viewSections.getRowModel(sectionId).table();
      const targetCol = this.docModel.columns.getRowModel(link.targetColRef);
      if (targetTable.id() !== targetCol.table().id()) {
        // targetColRef is actually not a column in the target table.
        // This should mean that the target table is a summary table (which didn't exist when the
        // option was selected) and targetColRef is from the source table.
        // Change it to the corresponding summary table column instead.
        link.targetColRef = targetTable.columns().all().find(c => c.summarySourceCol() === link.targetColRef)!.id();
      }
    }
    return this.docData.sendAction(
      ['UpdateRecord', '_grist_Views_section', sectionId, {
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

  // Turn the given columns into empty columns, losing any data stored in them.
  public async clearColumns(colRefs: number[], {keepType}: { keepType?: boolean } = {}): Promise<void> {
    await this.docModel.columns.sendTableAction(
      ['BulkUpdateRecord', colRefs, {
        isFormula: colRefs.map(f => true),
        formula: colRefs.map(f => ''),
        ...(keepType ? {} : {
          type: colRefs.map(f => 'Any'),
          widgetOptions: colRefs.map(f => ''),
          visibleCol: colRefs.map(f => null),
          displayCol: colRefs.map(f => null),
          rules: colRefs.map(f => null),
        }),
        // Set recalc settings to defaults when emptying a column.
        recalcWhen: colRefs.map(f => RecalcWhen.DEFAULT),
        recalcDeps: colRefs.map(f => null),
      }]
    );
  }

  // Convert the given columns to data, saving the calculated values and unsetting the formulas.
  public async convertIsFormula(colRefs: number[], opts: { toFormula: boolean, noRecalc?: boolean }): Promise<void> {
    return this.docModel.columns.sendTableAction(
      ['BulkUpdateRecord', colRefs, {
        isFormula: colRefs.map(f => opts.toFormula),
        recalcWhen: colRefs.map(f => opts.noRecalc ? RecalcWhen.NEVER : RecalcWhen.DEFAULT),
        recalcDeps: colRefs.map(f => null),
      }]
    );
  }

  // Updates formula for a column.
  public async updateFormula(colRef: number, formula: string): Promise<void> {
    return this.docModel.columns.sendTableAction(
      ['UpdateRecord', colRef, {
        formula,
      }]
    );
  }

  // Convert column to pure formula column.
  public async convertToFormula(colRef: number, formula: string): Promise<void> {
    return this.docModel.columns.sendTableAction(
      ['UpdateRecord', colRef, {
        isFormula: true,
        formula,
        recalcWhen: RecalcWhen.DEFAULT,
        recalcDeps: null,
      }]
    );
  }

  // Convert column to data column with a trigger formula
  public async convertToTrigger(
    colRefs: number,
    formula: string,
    recalcWhen: RecalcWhen = RecalcWhen.DEFAULT ): Promise<void> {
    return this.docModel.columns.sendTableAction(
      ['UpdateRecord', colRefs, {
        isFormula: false,
        formula,
        recalcWhen: recalcWhen,
        recalcDeps: null,
      }]
    );
  }

  public getCsvLink() {
    const params = this._getDocApiDownloadParams();
    return this.docPageModel.appModel.api.getDocAPI(this.docId()).getDownloadCsvUrl(params);
  }

  public getTsvLink() {
    const params = this._getDocApiDownloadParams();
    return this.docPageModel.appModel.api.getDocAPI(this.docId()).getDownloadTsvUrl(params);
  }

  public getDsvLink() {
    const params = this._getDocApiDownloadParams();
    return this.docPageModel.appModel.api.getDocAPI(this.docId()).getDownloadDsvUrl(params);
  }

  public getXlsxActiveViewLink() {
    const params = this._getDocApiDownloadParams();
    return this.docPageModel.appModel.api.getDocAPI(this.docId()).getDownloadXlsxUrl(params);
  }

  public hasGranularAccessRules(): boolean {
    const rulesTable = this.docData.getMetaTable('_grist_ACLRules');
    // To check if there are rules, ignore the default no-op rule created for an older incarnation
    // of ACLs. It exists in older documents, and is still created for new ones. We detect it by
    // the use of the deprecated 'permissions' field, and not the new 'permissionsText' field.
    return rulesTable.numRecords() > rulesTable.filterRowIds({permissionsText: '', permissions: 63}).length;
  }

  /**
   * If the given section is the target of linking, collect and return the active rowIDs up the
   * chain of links, returning the list of rowIds starting with the current section's parent. This
   * method is intended for when there is ambiguity such as when RefList linking is involved.
   * In other cases, returns undefined.
   */
  public getLinkingRowIds(sectionId: number): UIRowId[]|undefined {
    const linkingRowIds: UIRowId[] = [];
    let anyAmbiguity = false;
    let section = this.docModel.viewSections.getRowModel(sectionId);
    const seen = new Set<number>();
    while (section?.id.peek() && !seen.has(section.id.peek())) {
      seen.add(section.id.peek());
      const rowId = section.activeRowId.peek() || 'new';
      if (isRefListType(section.linkTargetCol.peek().type.peek()) || rowId === 'new') {
        anyAmbiguity = true;
      }
      linkingRowIds.push(rowId);
      section = section.linkSrcSection.peek();
    }
    return anyAmbiguity ? linkingRowIds.slice(1) : undefined;
  }

  /**
   * Move to the desired cursor position.  If colRef is supplied, the cursor will be
   * moved to a field with that colRef.  Any linked sections that need their cursors
   * moved in order to achieve the desired outcome are handled recursively.
   * If setAsActiveSection is true, the section in cursorPos is set as the current
   * active section.
   */
  public async recursiveMoveToCursorPos(
    cursorPos: CursorPos,
    setAsActiveSection: boolean,
    silent: boolean = false,
    visitedSections: number[] = []): Promise<boolean> {
    try {
      if (!cursorPos.sectionId) {
        throw new Error('sectionId required');
      }
      if (!cursorPos.rowId) {
        throw new Error('rowId required');
      }
      const section = this.docModel.viewSections.getRowModel(cursorPos.sectionId);
      if (!section.id.peek()) {
        throw new Error(`Section ${cursorPos.sectionId} does not exist`);
      }

      if (visitedSections.includes(section.id.peek())) {
        // We've already been here (we hit a cycle), just return immediately
        return true;
      }

      const srcSection = section.linkSrcSection.peek();
      const linkingRowId = cursorPos.linkingRowIds?.[0];
      const linkingRowIds = cursorPos.linkingRowIds?.slice(1);
      if (srcSection.id.peek()) {
        // We're in a linked section, so we need to recurse to make sure the row we want
        // will be visible.
        const linkTargetCol = section.linkTargetCol.peek();
        let controller: any;
        if (linkTargetCol.colId.peek()) {
          const destTable = await this._getTableData(section);
          if (cursorPos.rowId === 'new') {
            controller = 'new';
          } else {
            controller = destTable.getValue(cursorPos.rowId, linkTargetCol.colId.peek());
          }
        } else {
          controller = cursorPos.rowId;
        }
        const colId = section.linkSrcCol.peek().colId.peek();
        let srcRowId: any;
        const isSrcSummary = srcSection.table.peek().summarySource.peek().id.peek();
        if (!colId && !isSrcSummary) {
          // Simple case - source linked by rowId, not a summary.
          if (isList(controller)) {
            // Should be a reference list. Use linkingRowId if available and present in the list,
            if (linkingRowId && controller.indexOf(linkingRowId) > 0) {
              controller = linkingRowId;
            } else {
              // Otherwise, pick the first reference.
              controller = controller[1];  // [0] is the L type code, [1] is the first value
            }
          } else if (controller === 'new' && linkingRowId) {
            controller = linkingRowId;
          }
          srcRowId = controller;
        } else {
          const srcTable = await this._getTableData(srcSection);
          const query: ClientQuery = {tableId: srcTable.tableId, filters: {}, operations: {}};
          if (colId) {
            query.operations[colId] = isRefListType(section.linkSrcCol.peek().type.peek()) ? 'intersects' : 'in';
            query.filters[colId] = isList(controller) ? controller.slice(1) : [controller];
          } else {
            // must be a summary -- otherwise dealt with earlier.
            const destTable = await this._getTableData(section);
            for (const srcCol of srcSection.table.peek().groupByColumns.peek()) {
              const filterCol = srcCol.summarySource.peek();
              const filterColId = filterCol.colId.peek();
              controller = destTable.getValue(cursorPos.rowId, filterColId);
              // If the source groupby column is a ChoiceList or RefList, then null or '' in the summary table
              // should match against an empty list in the source table.
              query.operations[filterColId] = isListType(filterCol.type.peek()) && !controller ? 'empty' : 'in';
              query.filters[filterColId] = isList(controller) ? controller.slice(1) : [controller];
            }
          }
          srcRowId = srcTable.getRowIds().find(getFilterFunc(this.docData, query));
        }
        if (!srcRowId || (typeof srcRowId !== 'number' && srcRowId !== 'new')) {
          throw new Error('cannot trace rowId');
        }
        await this.recursiveMoveToCursorPos({
          rowId: srcRowId,
          sectionId: srcSection.id.peek(),
          linkingRowIds,
        }, false, silent, visitedSections.concat([section.id.peek()]));
      }
      const view: ViewRec = section.view.peek();
      const isRawOrRecordCardView = section.isRaw.peek() || section.isRecordCard.peek();
      const docPage: ViewDocPage = isRawOrRecordCardView ? 'data' : view.getRowId();
      if (docPage != this.activeViewId.get()) {
        await this.openDocPage(docPage);
      }
      if (setAsActiveSection) {
        view.activeSectionId(cursorPos.sectionId);
      }
      const fieldIndex = cursorPos.fieldIndex;
      const viewInstance = await waitObs(section.viewInstance);
      if (!viewInstance) {
        throw new Error('view not found');
      }
      // Give any synchronous initial cursor setting a chance to happen.
      await delay(0);
      viewInstance.setCursorPos({...cursorPos, fieldIndex});
      // TODO: column selection not working on card/detail view, or getting overridden -
      // look into it (not a high priority for now since feature not easily discoverable
      // in this view).

      // even though the cursor is at right place, the scroll could not have yet happened
      // wait for a bit (scroll is done in a setTimeout 0)
      await delay(0);
      return true;
    } catch (e) {
      console.debug(`_recursiveMoveToCursorPos(${JSON.stringify(cursorPos)}): ${e}`);
      if (!silent) {
        throw new UserError('There was a problem finding the desired cell.');
      }
      return false;
    }
  }

  /**
   * Opens up an editor at cursor position
   * @param input Optional. Cell's initial value
   */
  public async activateEditorAtCursor(options?: { init?: string, state?: any }) {
    const view = await this._waitForView();
    view?.activateEditorAtCursor(options);
  }

  /**
   * Renames table. Method exposed primarily for tests.
   */
  public async renameTable(tableId: string, newTableName: string) {
    const tableRec = this.docModel.visibleTables.all().find(tb => tb.tableId.peek() === tableId);
    if (!tableRec) {
      throw new UserError(`No table with id ${tableId}`);
    }
    await tableRec.tableName.saveOnly(newTableName);
  }

  /**
   * Creates computed with all the data for the given column.
   */
  public columnObserver(owner: IDisposableOwner, tableId: Observable<string>, columnId: Observable<string>) {
    const tableModel = Computed.create(owner, (use) => this.docModel.dataTables[use(tableId)]);
    const refreshed = Observable.create(owner, 0);
    const toggle = () => !refreshed.isDisposed() && refreshed.set(refreshed.get() + 1);
    const holder = Holder.create(owner);
    const listener = (tab: TableModel) => {
      // Now subscribe to any data change in that table.
      const subs = MultiHolder.create(holder);
      subs.autoDispose(tab.tableData.dataLoadedEmitter.addListener(toggle));
      subs.autoDispose(tab.tableData.tableActionEmitter.addListener(toggle));
      tab.fetch().catch(reportError);
    };
    owner.autoDispose(tableModel.addListener(listener));
    listener(tableModel.get());
    const values = Computed.create(owner, refreshed, (use) => {
      const rows = use(tableModel).getAllRows();
      const colValues = use(tableModel).tableData.getColValues(use(columnId));
      if (!colValues) { return []; }
      return rows.map((row, i) => [row, colValues[i]]);
    });
    return values;
  }

  /**
   * Opens popup with a section data (used by Raw Data view).
   */
  private async _openPopup(hash: HashLink) {
    // We can only open a popup for a section.
    if (!hash.sectionId) {
      return;
    }
    if (!this._prevSectionId) {
      this._prevSectionId = this.viewModel.activeSection.peek().id();
    }
    // We might open popup either for a section in this view or some other section (like Raw Data Page).
    if (this.viewModel.viewSections.peek().peek().some(s => s.id.peek() === hash.sectionId)) {
      this.viewModel.activeSectionId(hash.sectionId);
      // If the anchor link is valid, set the cursor.
      if (hash.colRef || hash.rowId) {
        const activeSection = this.viewModel.activeSection.peek();
        const {rowId} = hash;
        let fieldIndex = undefined;
        if (hash.colRef) {
          const maybeFieldIndex = activeSection.viewFields.peek().all()
            .findIndex(f => f.colRef.peek() === hash.colRef);
          if (maybeFieldIndex !== -1) { fieldIndex = maybeFieldIndex; }
        }
        const view = await this._waitForView(activeSection);
        view?.setCursorPos({rowId, fieldIndex});
      }
      this.viewLayout?.maximized.set(hash.sectionId);
      return;
    }
    this._isShowingPopupSection = true;
    // We will borrow active viewModel and will trick him into believing that
    // the section from the link is his viewSection and it is active. Fortunately
    // he doesn't care. After popup is closed, we will restore the original.
    this.viewModel.activeSectionId(hash.sectionId);
    // Now we have view section we want to show in the popup.
    const popupSection = this.viewModel.activeSection.peek();
    // We need to make it active, so that cursor on this section will be the
    // active one. This will change activeViewSectionId on a parent view of this section,
    // which might be a diffrent view from what we currently have. If the section is
    // a raw data or record card section, it will use `EmptyRowModel` as these sections
    // don't currently have parent views.
    popupSection.hasFocus(true);
    this._popupSectionOptions.set({
      hash,
      viewSection: popupSection,
      close: () => {
        // In case we are already closed, do nothing.
        if (!this._popupSectionOptions.get()) {
          return;
        }
        if (popupSection.id() !== this._prevSectionId) {
          // We need to blur the popup section. Otherwise it will automatically be opened
          // on raw data view. Note: raw data and record card sections don't have parent views;
          // they use the empty row model as a parent (which feels like a hack).
          if (!popupSection.isDisposed()) {
            popupSection.hasFocus(false);
          }
          // When this popup was opened we tricked active view by setting its activeViewSection
          // to our viewSection (which might be a completely different section or a raw data section) not
          // connected to this view. We need to return focus back to the previous section.
          this._focusPreviousSection();
        }
        // Clearing popup section data will close this popup.
        this._popupSectionOptions.set(null);
      }
    });
    // If the anchor link is valid, set the cursor.
    if (hash.rowId || hash.colRef) {
      const {rowId} = hash;
      let fieldIndex;
      if (hash.colRef) {
        const maybeFieldIndex = popupSection.viewFields.peek().all()
          .findIndex(f => f.colRef.peek() === hash.colRef);
        if (maybeFieldIndex !== -1) { fieldIndex = maybeFieldIndex; }
      }
      const view = await this._waitForView(popupSection);
      view?.setCursorPos({rowId, fieldIndex});
    }
  }

  /**
   * Starts playing the music video for Never Gonna Give You Up in the background.
   */
  private async _playRickRollVideo() {
    const backgroundVideoPlayer = this._backgroundVideoPlayerHolder.get();
    if (!backgroundVideoPlayer) {
      return;
    }

    await backgroundVideoPlayer.isLoaded();
    backgroundVideoPlayer.play();

    const setVolume = async (start: number, end: number, step: number) => {
      let volume: number;
      const condition = start <= end
        ? () => volume <= end
        : () => volume >= end;
      const afterthought = start <= end
        ? () => volume += step
        : () => volume -= step;
      for (volume = start; condition(); afterthought()) {
        backgroundVideoPlayer.setVolume(volume);
        await delay(250);
      }
    };

    await setVolume(0, 100, 5);

    await delay(190 * 1000);
    if (!this._isRickRowing.get()) {
      return;
    }

    await setVolume(100, 0, 5);

    this._isRickRowing.set(false);
    this._showBackgroundVideoPlayer.set(false);
  }

  private _focusPreviousSection() {
    const prevSectionId = this._prevSectionId;
    if (!prevSectionId) { return; }

    if (
      this.viewModel.viewSections.peek().all().some(s =>
        !s.isDisposed() && s.id.peek() === prevSectionId)
    ) {
      this.viewModel.activeSectionId(prevSectionId);
    }
    this._prevSectionId = null;
  }

  /**
   * Waits for a view to be ready
   */
  private async _waitForView(popupSection?: ViewSectionRec) {
    const sectionToCheck = popupSection ?? this.viewModel.activeSection.peek();
    // For pages like ACL's, there isn't a view instance to wait for.
    if (!sectionToCheck.getRowId()) {
      return null;
    }

    async function singleWait(s: ViewSectionRec): Promise<BaseView> {
      const view = await waitObs(
        sectionToCheck.viewInstance,
        vsi => Boolean(vsi && !vsi.isDisposed())
      );
      return view!;
    }

    let view = await singleWait(sectionToCheck);
    if (view.isDisposed()) {
      // If the view is disposed (it can happen, as wait is not reliable enough, because it uses
      // subscription for testing the predicate, which might dispose object before we have a chance to test it).
      // This can happen when section is recreating itself on a popup.
      if (popupSection) {
        view = await singleWait(popupSection);
      }
      if (view.isDisposed()) {
        return null;
      }
    }
    await view.getLoadingDonePromise();
    // Wait extra bit for scroll to happen.
    await delay(0);
    return view;
  }

  private _getToolContent(tool: typeof RightPanelTool.type): IExtraTool | null {
    switch (tool) {
      case 'docHistory': {
        return {icon: 'Log', label: 'Document History', content: this._docHistory};
      }
      case 'validations': {
        const content = this._rightPanelTabs.get("Validate Data");
        return content ? {icon: 'Validation', label: 'Validation Rules', content} : null;
      }
      case 'discussion': {
        return {icon: 'Chat', label: this._discussionPanel.buildMenu(), content: this._discussionPanel};
      }
      case 'none':
      default: {
        return null;
      }
    }
  }

  private async _maybeShowEditCardLayoutTip(selectedWidgetType: IWidgetType) {
    if (
      // Don't show the tip if a non-card widget was selected.
      !['single', 'detail'].includes(selectedWidgetType) ||
      // Or if we shouldn't see the tip.
      !this.behavioralPromptsManager.shouldShowPopup('editCardLayout')
    ) {
      return;
    }

    // Open the right panel to the widget subtab.
    commands.allCommands.viewTabOpen.run();

    // Wait for the right panel to finish animation if it was collapsed before.
    await commands.allCommands.rightPanelOpen.run();

    const editLayoutButton = document.querySelector('.behavioral-prompt-edit-card-layout');
    if (!editLayoutButton) {
      throw new Error('GristDoc failed to find edit card layout button');
    }

    this.behavioralPromptsManager.showPopup(editLayoutButton, 'editCardLayout', {
      popupOptions: {
        placement: 'left-start',
      }
    });
  }

  private async _handleNewAttachedCustomWidget(widget: IAttachedCustomWidget) {
    switch (widget) {
      case 'custom.calendar': {
        if (this.behavioralPromptsManager.shouldShowPopup('calendarConfig')) {
          // Open the right panel to the calendar subtab.
          commands.allCommands.viewTabOpen.run();

          // Wait for the right panel to finish animation if it was collapsed before.
          await commands.allCommands.rightPanelOpen.run();
        }
        break;
      }
    }
  }

  private async _promptForName() {
    return await invokePrompt("Table name", "Create", '', "Default table name");
  }

  private async _replaceViewSection(
    section: ViewSectionRec,
    oldVal: IPageWidget,
    newVal: IPageWidget
  ) {

    const docModel = this.docModel;
    const viewModel = section.view();
    const docData = this.docModel.docData;
    const options = section.options();
    const colIds = section.viewFields().all().map((f) => f.column().colId());
    const chartType = section.chartType();
    const sectionTheme = section.theme();

    // we must read the current layout from the view layout because it can override the one in
    // `section.layoutSpec` (in particular it provides a default layout when missing from the
    // latter).
    const layoutSpec = this.viewLayout!.layoutSpec();

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

    // persist options
    await newSection.options.saveOnly(options);

    // charts needs to keep view fields consistent across updates
    if (oldVal.type === 'chart' && newVal.type === 'chart') {
      await this.setSectionViewFieldsFromArray(newSection, colIds);
    }

    // update theme, and chart type
    await newSection.theme.saveOnly(sectionTheme);
    await newSection.chartType.saveOnly(chartType);

    // The newly-added section should be given focus.
    this.viewModel.activeSectionId(newSection.getRowId());

    // remove old section
    await docData.sendAction(['RemoveViewSection', sectionId]);
    return newSection;
  }

  /**
   * Helper called before an action is sent to the server. It saves cursor position to come back to
   * in case of Undo.
   */
  private _onSendActionsStart(ev: { cursorPos: CursorPos }) {
    this._lastOwnActionGroup = null;
    ev.cursorPos = this.getCursorPos();
  }

  /**
   * Helper called when server responds to an action. It attaches the saved cursor position to the
   * received action (if any), and stores also the resulting position.
   */
  private _onSendActionsEnd(ev: { cursorPos: CursorPos }) {
    const a = this._lastOwnActionGroup;
    if (a) {
      a.cursorPos = ev.cursorPos;
      if (a.rowIdHint) {
        a.cursorPos.rowId = a.rowIdHint;
      }
    }
  }

  private _getDocApiDownloadParams() {
    const activeSection = this.viewModel.activeSection();
    const filters = activeSection.activeFilters.get().map(filterInfo => ({
      colRef: filterInfo.fieldOrColumn.origCol().origColRef(),
      filter: filterInfo.filter()
    }));
    const linkingFilter: FilterColValues = activeSection.linkingFilter();

    return {
      viewSection: this.viewModel.activeSectionId(),
      tableId: activeSection.table().tableId(),
      activeSortSpec: JSON.stringify(activeSection.activeSortSpec()),
      filters: JSON.stringify(filters),
      linkingFilter: JSON.stringify(linkingFilter),
    };
  }

  /**
   * Switch to a given sectionId, wait for it to load, and return a Promise for the instantiated
   * viewInstance (such as an instance of GridView or DetailView).
   */
  private async _switchToSectionId(sectionId: number) {
    const section: ViewSectionRec = this.docModel.viewSections.getRowModel(sectionId);
    if (section.isRaw.peek() || section.isRecordCard.peek()) {
      // This is a raw data or record card view.
      await urlState().pushUrl({docPage: 'data'});
      this.viewModel.activeSectionId(sectionId);
    } else if (section.isVirtual.peek()) {
      // this is a virtual table, and therefore a webhook page (that is the only
      // place virtual tables are used so far)
      await urlState().pushUrl({docPage: 'webhook'});
      this.viewModel.activeSectionId(sectionId);
    } else {
      const view: ViewRec = section.view.peek();
      await this.openDocPage(view.getRowId());
      view.activeSectionId(sectionId);  // this.viewModel will reflect this with a delay.
    }

    // Returns the value of section.viewInstance() as soon as it is truthy.
    return waitObs(section.viewInstance);
  }

  private async _getTableData(section: ViewSectionRec): Promise<TableData> {
    const viewInstance = await waitObs(section.viewInstance);
    if (!viewInstance) {
      throw new Error('view not found');
    }
    await viewInstance.getLoadingDonePromise();
    const table = this.docData.getTable(section.table.peek().tableId.peek());
    if (!table) {
      throw new Error('no section table');
    }
    return table;
  }

  /**
   * Convert a url hash to a cursor position.
   */
  private _getCursorPosFromHash(hash: HashLink): CursorPos {
    const cursorPos: CursorPos = {rowId: hash.rowId, sectionId: hash.sectionId};
    if (cursorPos.sectionId != undefined && hash.colRef !== undefined) {
      // translate colRef to a fieldIndex
      const section = this.docModel.viewSections.getRowModel(cursorPos.sectionId);
      const fieldIndex = section.viewFields.peek().all()
        .findIndex(x => x.colRef.peek() == hash.colRef);
      if (fieldIndex >= 0) {
        cursorPos.fieldIndex = fieldIndex;
      }
      cursorPos.linkingRowIds = hash.linkingRowIds;
    }
    return cursorPos;
  }

  /**
   * Returns whether a doc tour should automatically be started.
   *
   * Currently, tours are started if a non-empty GristDocTour table exists and the
   * user hasn't seen the tour before.
   */
  private async _shouldAutoStartDocTour(): Promise<boolean> {
    if (
      this._disableAutoStartingTours ||
      this.docModel.isTutorial() ||
      !this.docModel.hasDocTour() ||
      this._seenDocTours.get()?.includes(this.docId())
    ) {
      return false;
    }

    const tableData = this.docData.getTable('GristDocTour')!;
    await this.docData.fetchTable('GristDocTour');
    return tableData.numRecords() > 0;
  }

  /**
   * Returns whether a welcome tour should automatically be started.
   *
   * Currently, tours are started for first-time users on a personal org, as long as
   * a doc tutorial or tour isn't available.
   */
  private _shouldAutoStartWelcomeTour(): boolean {
    // For non-SaaS flavors of Grist, don't show the tour if the Help Center is explicitly
    // disabled. A separate opt-out feature could be added down the road for more granularity,
    // but will require communication in advance to avoid disrupting users.
    const {features} = getGristConfig();
    if (!features?.includes('helpCenter')) {
      return false;
    }

    // If a doc tutorial or tour are available, leave the welcome tour for another
    // doc (e.g. a new one).
    if (this._disableAutoStartingTours || this.docModel.isTutorial() || this.docModel.hasDocTour()) {
      return false;
    }

    // Only show the tour if one is on a personal org and can edit. This excludes templates (on
    // the Templates org, which may have their own tour) and team sites (where user's intended
    // role is often other than document creator).
    const appModel = this.docPageModel.appModel;
    if (!appModel.currentOrg?.owner || this.isReadonly.get()) {
      return false;
    }
    // Use the showGristTour pref if set; otherwise default to true for anonymous users, and false
    // for real returning users.
    return this._showGristTour.get() ?? (!appModel.currentValidUser);
  }

  /**
   * Makes sure that the first y-series (ie: the view fields at index 1) is a numeric series. Does
   * not handle chart with the group by option on: it is only intended to be used to make sure that
   * newly created chart do have a visible y series.
   */
  private async _ensureOneNumericSeries(id: number) {
    const viewSection = this.docModel.viewSections.getRowModel(id);
    const viewFields = viewSection.viewFields.peek().peek();

    // If no y-series, then simply return.
    if (viewFields.length === 1) {
      return;
    }

    const field = viewSection.viewFields.peek().peek()[1];
    if (isNumericOnly(viewSection.chartTypeDef.peek()) &&
      !isNumericLike(field.column.peek())) {
      const actions: UserAction[] = [];

      // remove non-numeric field
      actions.push(['RemoveRecord', field.id.peek()]);

      // add new field
      const newField = viewSection.hiddenColumns.peek().find((col) => isNumericLike(col));
      if (newField) {
        const colInfo = {
          parentId: viewSection.id.peek(),
          colRef: newField.id.peek(),
        };
        actions.push(['AddRecord', null, colInfo]);
      }

      // send actions
      await this.docModel.viewFields.sendTableActions(actions);
    }
  }

  private _handleTriggerQueueOverflowMessage() {
    this.listenTo(this, 'webhookOverflowError', (err: any) => {
      this.app.topAppModel.notifier.createNotification({
        message: err.toString(),
        canUserClose: false,
        level: "error",
        badgeCounter: true,
        expireSec: 5,
        key: 'webhookOverflowError',
        actions: [{
          label: t('go to webhook settings'), action: async () => {
            await urlState().pushUrl({docPage: 'webhook'});
          }
        }]
      });
    });
  }
}

async function finalizeAnchor() {
  await urlState().pushUrl({hash: {}}, {replace: true});
  setTestState({anchorApplied: true});
}

const cssViewContentPane = styled('div', `
  --view-content-page-padding: 12px;
  flex: auto;
  display: flex;
  flex-direction: column;
  overflow: visible;
  position: relative;
  min-width: 240px;
  padding: var(--view-content-page-padding, 12px);
  @media ${mediaSmall} {
    & {
      padding: 4px;
    }
  }
  @media print {
    & {
      padding: 0px;
    }
  }
  &-contents {
    overflow: hidden;
  }
`);

const fadeInAndOut = keyframes(`
  0% {
    opacity: 0.01;
  }
  5%, 95% {
    opacity: 0.2;
  }
  100% {
    opacity: 0.01;
  }
`);

const cssBackgroundVideo = styled('div', `
  position: fixed;
  top: 0;
  right: 0;
  height: 100%;
  width: 100%;
  opacity: 0;
  pointer-events: none;

  &-fade-in-and-out {
    animation: ${fadeInAndOut} 200s;
  }
`);

const cssYouTubePlayer = styled('div', `
  position: absolute;
  width: 450%;
  height: 450%;
  top: -175%;
  left: -175%;

  @media ${mediaXSmall} {
    & {
      width: 450%;
      height: 450%;
      top: -175%;
      left: -175%;
    }
  }
`);

const cssStopRickRowingButton = styled('div', `
  position: fixed;
  top: 0;
  right: 0;
  padding: 8px;
  margin: 16px;
  border-radius: 24px;
  background-color: ${theme.toastBg};
  cursor: pointer;
`);

const cssCloseIcon = styled(icon, `
  height: 24px;
  width: 24px;
  --icon-color: ${theme.toastControlFg};
`);
