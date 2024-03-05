import BaseView from 'app/client/components/BaseView';
import {CommandName} from 'app/client/components/commandList';
import * as commands from 'app/client/components/commands';
import {GristDoc} from 'app/client/components/GristDoc';
import {hooks} from 'app/client/Hooks';
import {get as getBrowserGlobals} from 'app/client/lib/browserGlobals';
import {makeTestId} from 'app/client/lib/domUtils';
import {ColumnRec, ViewSectionRec} from 'app/client/models/DocModel';
import {reportError} from 'app/client/models/errors';
import {AccessLevel, ICustomWidget, isSatisfied, matchWidget} from 'app/common/CustomWidget';
import {DisposableWithEvents} from 'app/common/DisposableWithEvents';
import {BulkColValues, fromTableDataAction, RowRecord} from 'app/common/DocActions';
import {extractInfoFromColType, reencodeAsAny} from 'app/common/gristTypes';
import {Theme} from 'app/common/ThemePrefs';
import {getGristConfig} from 'app/common/urlUtils';
import {
  AccessTokenOptions, CursorPos, CustomSectionAPI, FetchSelectedOptions, GristDocAPI, GristView,
  InteractionOptionsRequest, WidgetAPI, WidgetColumnMap
} from 'app/plugin/grist-plugin-api';
import {MsgType, Rpc} from 'grain-rpc';
import {Computed, Disposable, dom, Observable} from 'grainjs';
import noop = require('lodash/noop');
import debounce = require('lodash/debounce');
import isEqual = require('lodash/isEqual');
import flatMap = require('lodash/flatMap');

const testId = makeTestId('test-custom-widget-');


/**
 * This file contains a WidgetFrame and all its components.
 *
 * WidgetFrame embeds an external Custom Widget (external webpage) in an iframe. It is used on a CustomView,
 * to display widget content, and on the configuration screen to display widget's configuration screen.
 *
 * Beside exposing widget content, it also exposes some of the API's that Grist offers via grist-rpc.
 * API are defined in the core/app/plugin/grist-plugin-api.ts.
 */

const G = getBrowserGlobals('window');

/**
 * Options for WidgetFrame
 */
export interface WidgetFrameOptions {
  /**
   * Url of external page. Iframe is rebuild each time the URL changes.
   */
  url: string|null;
  /**
   * ID of widget, if known. When set, the url for the specified widget
   * in the WidgetRepository, if found, will take precedence.
   */
  widgetId?: string|null;
  /**
   * ID of the plugin that provided the widget (if it came from a plugin).
   */
  pluginId?: string;
  /**
   * Assigned access level. Iframe is rebuild each time access level is changed.
   */
  access: AccessLevel;
  /**
   * If document is in readonly mode.
   */
  readonly: boolean;
  /**
   * If set, show the iframe after `grist.ready()`.
   *
   * This is used to defer showing a widget on initial load until it has finished
   * applying the Grist theme.
   */
  showAfterReady?: boolean;
  /**
   * Optional callback to configure exposed API.
   */
  configure?: (frame: WidgetFrame) => void;
  /**
   * Optional handler to modify the iframe.
   */
  onElem?: (iframe: HTMLIFrameElement) => void;
  /**
   * Optional language to use for the widget.
   */
  preferences: {language?: string, timeZone?: any, currency?: string, culture?: string};
  /**
   * The containing document.
   */
  gristDoc: GristDoc;
}

/**
 * Iframe that embeds Custom Widget page and exposes Grist API.
 */
export class WidgetFrame extends DisposableWithEvents {
  // A grist-rpc object, encapsulated to prevent direct access.
  private _rpc: Rpc;
  // Created iframe element, used to receive and post messages via Rpc
  private _iframe: HTMLIFrameElement | null;
  // If widget called ready() method, this will be set to true.
  private _readyCalled = Observable.create(this, false);
  // Whether the iframe is visible.
  private _visible = Observable.create(this, !this._options.showAfterReady);
  private readonly _widget = Observable.create<ICustomWidget|null>(this, null);

  private _url: Observable<string>;
  /**
   * If the widget URL is empty, it also means that we are showing the empty page.
   */
  private _isEmpty: Observable<boolean>;

  constructor(private _options: WidgetFrameOptions) {
    super();
    _options.access = _options.access || AccessLevel.none;
    // Build RPC object and connect it to iframe.
    this._rpc = new Rpc({});

    // queue until iframe's content emit ready() message
    this._rpc.queueOutgoingUntilReadyMessage();

    // Register outgoing message handler.
    this._rpc.setSendMessage(msg => this._iframe?.contentWindow!.postMessage(msg, '*'));

    // Register incoming message handler.
    const listener = this._onMessage.bind(this);
    // 'message' is an event's name used by Rpc in window to iframe communication.
    G.window.addEventListener('message', listener);
    this.onDispose(() => {
      // Stop listening for events from the iframe.
      G.window.removeEventListener('message', listener);
      // Stop sending messages to the iframe.
      this._rpc.setSendMessage(noop);
    });

    // Call custom configuration handler.
    _options.configure?.(this);

    this._checkWidgetRepository().catch(reportError);

    // Url if set.
    const maybeUrl = Computed.create(this, use => use(this._widget)?.url || this._options.url);

    // Url to widget or empty page with access level and preferences.
    this._url = Computed.create(this, use => this._urlWithAccess(use(maybeUrl) || this._getEmptyWidgetPage()));

    // Iframe is empty when url is not set.
    this._isEmpty = Computed.create(this, use => !use(maybeUrl));

    // When isEmpty is switched to true, reset the ready state.
    this.autoDispose(this._isEmpty.addListener(isEmpty => {
      if (isEmpty) {
        this._readyCalled.set(false);
      }
    }));
  }

  /**
   * Attach an EventSource with desired access level.
   */
  public useEvents(source: IEventSource, access: AccessChecker) {
    // Wrap event handler with access check.
    const handler = async (data: any) => {
      if (access.check(this._options.access)) {
        await this._rpc.postMessage(data);
      }
    };
    this.listenTo(source, 'event', handler);
    // Give EventSource a chance to attach to WidgetFrame events.
    source.attach(this);
  }

  /**
   * Exposes API for Custom Widget.
   * TODO: add ts-interface support. Currently all APIs are written in typescript,
   * so those checks are not that needed.
   */
  public exposeAPI(name: string, api: any, access: AccessChecker) {
    this._rpc.registerImpl(name, wrapObject(api, access, this._options.access));
    this.onDispose(() => this._rpc.unregisterImpl(name));
  }

  /**
   * Expose a method for Custom Widget.
   */
  public exposeMethod(name: string, handler: (...args: any[]) => any, access: AccessChecker) {
    this._rpc.registerFunc(name, (...args: any[]) => {
      if (access.check(this._options.access, 'invoke')) {
        return handler(...args);
      } else {
        throwError(this._options.access);
      }
    });
  }

  /**
   * Make configure call to the widget. Widget should open some configuration screen or ignore it.
   */
  public editOptions() {
    return this.callRemote('editOptions');
  }

  /**
   * Call remote function that is exposed by the widget.
   */
  public callRemote(name: string, ...args: any[]) {
    return this._rpc.callRemoteFunc(name, ...args);
  }

  public buildDom() {
    const onElem = this._options.onElem ?? ((el: HTMLIFrameElement) => el);
    this._iframe = dom(
      'iframe',
      dom.style('visibility', use => use(this._visible) ? 'visible' : 'hidden'),
      dom.cls('clipboard_focus'),
      dom.cls('custom_view'),
      dom.attr('src', this._url),
      hooks.iframeAttributes,
      testId('ready', use => use(this._readyCalled) && !use(this._isEmpty)),
      self => void onElem(self),
    );
    return this._iframe;
  }

  // Appends access level to query string.
  private _urlWithAccess(url: string) {
    if (!url) {
      return url;
    }
    const urlObj = new URL(url);
    urlObj.searchParams.append('access', this._options.access);
    urlObj.searchParams.append('readonly', String(this._options.readonly));
    // Append user and document preferences to query string.
    const settingsParams = new URLSearchParams(this._options.preferences);
    settingsParams.forEach((value, key) => urlObj.searchParams.append(key, value));
    return urlObj.href;
  }

  private _getEmptyWidgetPage(): string {
    return new URL("custom-widget.html", getGristConfig().homeUrl!).href;
  }

  private _onMessage(event: MessageEvent) {
    if (this._iframe && event.source === this._iframe.contentWindow && !this.isDisposed()) {
      // Previously, we forwarded messages targeted at "grist" to the back-end.
      // Now, we process them immediately in the context of the client for access
      // control purposes.  To do that, any message that comes in with mdest of
      // "grist" will have that destination wiped, and we provide a local
      // implementation of the interface.
      // It feels like it should be possible to deal with the mdest more cleanly,
      // with a rpc.registerForwarder('grist', { ... }), but it seems somehow hard
      // to call a locally registered interface of an rpc object?
      if (event.data.mdest === 'grist') {
        event.data.mdest = '';
      }
      if (event.data.mtype === MsgType.Ready) {
        this.trigger('ready', this);
        this._readyCalled.set(true);
      }
      if (event.data.data?.message === 'themeInitialized') {
        this._visible.set(true);
      }
      this._rpc.receiveMessage(event.data);
    }
  }

  /**
   * If we have a widgetId, look it up in the WidgetRepository and
   * get the best URL we can for it.
   */
  private async _checkWidgetRepository() {
    const {widgetId, pluginId} = this._options;
    if (this.isDisposed() || !widgetId) { return; }
    const widgets = await this._options.gristDoc.app.topAppModel.getWidgets();
    if (this.isDisposed()) { return; }
    const widget = matchWidget(widgets, {widgetId, pluginId});
    this._widget.set(widget || null);
  }
}

const throwError = (access: AccessLevel) => {
  throw new Error('Access not granted. Current access level ' + access);
};

/**
 * Wraps an object to check access level before it is called.
 * TODO: grain-rpc exposes callWrapper which could be used for this purpose,
 * but currently it doesn't have access to the incoming message.
 */
function wrapObject<T extends object>(impl: T, accessChecker: AccessChecker, access: AccessLevel): T {
  return new Proxy(impl, {
    // This proxies all the calls to methods on the API.
    get(target: any, methodName: string) {
      return function () {
        if (methodName === 'then') {
          // Making a proxy for then invocation is not a good idea.
          return undefined;
        }
        if (accessChecker.check(access, methodName)) {
          return target[methodName](...arguments);
        } else {
          throwError(access);
        }
      };
    },
  });
}

/**
 * Interface for custom access rules.
 */
export interface AccessChecker {
  /**
   * Checks if the incoming call can be served on current access level.
   * @param access Current access level
   * @param method Method called on the interface, can use * or undefined to match all methods.
   */
  check(access: AccessLevel, method?: string): boolean;
}

/**
 * Checks if current access level is enough.
 */
export class MinimumLevel implements AccessChecker {
  constructor(private _minimum: AccessLevel) {}
  public check(access: AccessLevel): boolean {
    return isSatisfied(access, this._minimum);
  }
}

type MethodMatcher<T> = keyof T | '*';
/**
 * Helper object that allows assigning access level to a particular method in the interface.
 *
 * Example:
 *
 * 1. Expose two methods, all other will be denied (even in full access mode)
 * new ApiGranularAccess<GristDocAPI>()
 *  .require("read_table", "method1") // for method1 we need at least read_table
 *  .require("none", "method2") // for method2 no access level is needed
 *
 * 2. Expose two methods, all other will require full access (effectively the same as ex. 1)
 * new ApiGranularAccess<GristDocAPI>()
 *  .require("read_table", "method1") // for method1 we need at least read_table
 *  .require("none", "method2") // for method2 no access level is needed
 *  .require("full", "*") // for any other, require full
 *
 * 3. Expose all methods on read_table access, but one can have none
 * new ApiGranularAccess<GristDocAPI>()
 *  .require("none", "method2") // for method2 we are ok with none access
 *  .require("read_table", "*") // for any other, require read_table
 */
export class MethodAccess<T> implements AccessChecker {
  private _accessMap: Map<MethodMatcher<T>, AccessLevel> = new Map();
  constructor() {}
  public require(level: AccessLevel, method: MethodMatcher<T> = '*') {
    this._accessMap.set(method, level);
    return this;
  }
  public check(access: AccessLevel, method?: string): boolean {
    if (!method) {
      throw new Error('Method name is required for MethodAccess check');
    }
    // Check if the iface was registered.
    if (this._accessMap.has(method as MethodMatcher<T>)) {
      // If it was, check that minimum access level is granted.
      const minimum = this._accessMap.get(method as MethodMatcher<T>)!;
      return isSatisfied(access, minimum);
    } else if (this._accessMap.has('*')) {
      // If there is a default rule, check if it permits the access.
      const minimum = this._accessMap.get('*')!;
      return isSatisfied(access, minimum);
    } else {
      // By default, don't allow anything on this interface.
      return false;
    }
  }
}

/***********************
 * Exposed APIs for Custom Widgets.
 *
 * Currently we expose 3 APIs
 * - GristDocAPI - full access to document.
 * - ViewAPI - access to current table.
 * - WidgetAPI - access to widget configuration.
 ***********************/

/**
 * GristDocApi implemented over active GristDoc.
 */
export class GristDocAPIImpl implements GristDocAPI {
  public static readonly defaultAccess = new MethodAccess<GristDocAPI>()
    .require(AccessLevel.read_table, 'getDocName')
    .require(AccessLevel.full); // for any other, require full Access.

  constructor(private _doc: GristDoc) {}

  public async getDocName() {
    return this._doc.docId();
  }

  public async listTables(): Promise<string[]> {
    // Could perhaps read tableIds from this.gristDoc.docModel.visibleTableIds.all()?
    const {tableData} = await this._doc.docComm.fetchTable('_grist_Tables');
    // Tables the user doesn't have access to are just blanked out.
    return tableData[3].tableId.filter(tableId => tableId !== '') as string[];
  }

  public async fetchTable(tableId: string) {
    return fromTableDataAction(await this._doc.docComm.fetchTable(tableId));
  }

  public async applyUserActions(actions: any[][], options?: any) {
    return this._doc.docComm.applyUserActions(actions, {desc: undefined, ...options});
  }

  // Get a token for out-of-band access to the document.
  // Currently will require the custom widget to have full access to the
  // document.
  // It would be great to support this with read_table rights. This could be
  // possible to do by adding a tableId setting to AccessTokenOptions,
  // encoding that limitation in the access token, and ensuring the back-end
  // respects it. But the current motivating use for adding access tokens is
  // showing attachments, and they aren't currently something that logically
  // lives within a specific table.
  public async getAccessToken(options: AccessTokenOptions) {
    return this._doc.docComm.getAccessToken({
      readOnly: options.readOnly,
    });
  }
}

/**
 * GristViewAPI implemented over BaseView.
 */
export class GristViewImpl implements GristView {
  constructor(private _baseView: BaseView, private _access: AccessLevel) {
  }

  public async fetchSelectedTable(options: FetchSelectedOptions = {}): Promise<any> {
    // If widget has a custom columns mapping, we will ignore hidden columns section.
    // Hidden/Visible columns will eventually reflect what is available, but this operation
    // is not instant - and widget can receive rows with fields that are not in the mapping.
    const columns: ColumnRec[] = this._visibleColumns(options);
    const rowIds = this._baseView.sortedRows.getKoArray().peek().filter(id => id != 'new');
    const data: BulkColValues = {};
    for (const column of columns) {
      // Use the colId of the displayCol, which may be different in case of Reference columns.
      const colId: string = column.displayColModel.peek().colId.peek();
      const getter = this._baseView.tableModel.tableData.getRowPropFunc(colId)!;
      const typeInfo = extractInfoFromColType(column.type.peek());
      data[column.colId.peek()] = rowIds.map(r => reencodeAsAny(getter(r)!, typeInfo));
    }
    data.id = rowIds;
    return data;
  }

  public async fetchSelectedRecord(rowId: number, options: FetchSelectedOptions = {}): Promise<any> {
    // Prepare an object containing the fields available to the view
    // for the specified row.  A RECORD()-generated rendering would be
    // more useful. but the data engine needs to know what information
    // the custom view depends on, so we shouldn't volunteer any untracked
    // information here.
    const columns: ColumnRec[] = this._visibleColumns(options);
    const data: RowRecord = {id: rowId};
    for (const column of columns) {
      const colId: string = column.displayColModel.peek().colId.peek();
      const typeInfo = extractInfoFromColType(column.type.peek());
      data[column.colId.peek()] = reencodeAsAny(
        this._baseView.tableModel.tableData.getValue(rowId, colId)!,
        typeInfo
      );
    }
    return data;
  }

  /**
   * This is deprecated method to turn on cursor linking. Previously it was used
   * to create a custom row id filter. Now widgets can be treated as normal source of linking.
   * Now allowSelectBy should be set using the ready event.
   */
  public async allowSelectBy(): Promise<void> {
    this._baseView.viewSection.allowSelectBy(true);
    // This is to preserve a legacy behavior, where when allowSelectBy is called widget expected
    // that the filter was already applied to clear all rows.
    this._baseView.viewSection.selectedRows([]);
  }

  public async setSelectedRows(rowIds: number[]|null): Promise<void> {
    this._baseView.viewSection.selectedRows(rowIds);
  }

  public setCursorPos(cursorPos: CursorPos): Promise<void> {
    this._baseView.setCursorPos(cursorPos);
    return Promise.resolve();
  }

  private _visibleColumns(options: FetchSelectedOptions): ColumnRec[] {
    const columns: ColumnRec[] = this._baseView.viewSection.columns.peek();
    // If columns are mapped, return only those that are mapped.
    const mappings = this._baseView.viewSection.mappedColumns.peek();
    if (mappings) {
      const mappedColumns = new Set(flatMap(Object.values(mappings)));
      const mapped = (col: ColumnRec) => mappedColumns.has(col.colId.peek());
      return columns.filter(mapped);
    } else if (options.includeColumns === 'shown' || !options.includeColumns) {
      // Return columns that have been shown by the user, i.e. have a corresponding view field.
      const hiddenCols = this._baseView.viewSection.hiddenColumns.peek().map(c => c.id.peek());
      const notHidden = (col: ColumnRec) => !hiddenCols.includes(col.id.peek());
      return columns.filter(notHidden);
    }
    // These options are newer and expose more data than the user may have intended,
    // so they require full access.
    if (this._access !== AccessLevel.full) {
      throw new Error(
        `Setting includeColumns to ${options.includeColumns} requires full access.` +
        ` Current access level is ${this._access}`);
    }
    if (options.includeColumns === 'normal') {
      // Return all 'normal' columns of the table, regardless of whether the user has shown them.
      return columns;
    } else {
      // Return *all* columns, including special invisible columns like manualSort.
      return this._baseView.viewSection.table.peek().columns.peek().all();
    }
  }
}

/**
 * WidgetAPI implemented over active section.
 */
export class WidgetAPIImpl implements WidgetAPI {
  constructor(private _section: ViewSectionRec) {}

  /**
   * Stores options in viewSection.customDef.widgetDef json field.
   * This way whenever widget is changed, options are removed and not shared
   * between widgets by design.
   */
  public async setOptions(options: object): Promise<void> {
    if (options === null || options === undefined || typeof options !== 'object') {
      throw new Error('options must be a valid JSON object');
    }
    this._section.activeCustomOptions(options);
  }

  public async getOptions(): Promise<Record<string, unknown> | null> {
    return this._section.activeCustomOptions.peek() ?? null;
  }

  public async clearOptions(): Promise<void> {
    this._section.activeCustomOptions(null);
  }

  public async setOption(key: string, value: any): Promise<void> {
    const options = {...this._section.activeCustomOptions.peek()};
    options[key] = value;
    this._section.activeCustomOptions(options);
  }

  public getOption(key: string): Promise<unknown> {
    const options = this._section.activeCustomOptions.peek();
    return options?.[key];
  }
}

const COMMAND_MINIMUM_ACCESS_LEVELS: Map<CommandName, AccessLevel> = new Map([
  ['undo', AccessLevel.full],
  ['redo', AccessLevel.full],
  ['viewAsCard', AccessLevel.read_table],
]);

export class CommandAPI {
  constructor(private _currentAccess: AccessLevel) {}

  public async run(commandName: CommandName): Promise<unknown> {
    const minimumAccess = COMMAND_MINIMUM_ACCESS_LEVELS.get(commandName);
    if (minimumAccess === undefined || !isSatisfied(this._currentAccess, minimumAccess)) {
      // If the command name is unrecognized, or the current access level doesn't meet the
      // command's minimum access level, do nothing.
      return;
    }

    return await commands.allCommands[commandName].run();
  }
}

/************************
 * Events that are sent to the CustomWidget.
 *
 * Currently:
 * - onRecord, implemented by RecordNotifier, sends a message each time active row is changed.
 * - onRecords, implemented by TableNotifier, sends a message each time table is changed
 * - onOptions, implemented by ConfigNotifier, sends a message each time configuration is changed
 *
 * All of those events are also sent when CustomWidget sends its ready message.
 ************************/

/**
 * EventSource should trigger event called "event" that will be send to the Custom Widget.
 */
export interface IEventSource extends DisposableWithEvents {
  /**
   * Called by WidgetFrame, allowing EventSource to attach to its ready event.
   */
  attach(frame: WidgetFrame): void;
}

export class BaseEventSource extends DisposableWithEvents implements IEventSource {
  // Attaches to WidgetFrame ready event.
  public attach(frame: WidgetFrame): void {
    this.listenTo(frame, 'ready', this._ready.bind(this));
  }
  protected _ready() {
    // To override if needed to react on the ready event.
  }
  protected _notify(data: any) {
    if (this.isDisposed()) {
      return;
    }
    this.trigger('event', data);
  }
}

/**
 * Notifies about cursor position change. Exposed in the API as a onRecord handler.
 */
export class RecordNotifier extends BaseEventSource {
  private _debounced: () => void; // debounced call to let the view know linked cursor changed.
  constructor(private _baseView: BaseView) {
    super();
    this._debounced = debounce(() => this._update(), 0);
    this.autoDispose(_baseView.cursor.rowIndex.subscribe(this._debounced));
  }

  private _update() {
    if (this.isDisposed()) {
      return;
    }
    const state = {
      tableId: this._baseView.viewSection.table().tableId(),
      rowId: this._baseView.cursor.getCursorPos().rowId || undefined,
      dataChange: false,
    };
    this._notify(state);
  }
}

export interface ConfigNotifierOptions {
  access: AccessLevel;
}

/**
 * Notifies about options changes. Exposed in the API as `onOptions`.
 */
export class ConfigNotifier extends BaseEventSource {
  private _accessLevel = this._options.access;
  private _currentConfig = Computed.create(this, use => {
    const options = use(this._section.activeCustomOptions);
    return options;
  });

  // Debounced call to let the view know linked cursor changed.
  private _debounced = debounce((options?: {fromReady?: boolean}) => this._update(options), 0);

  constructor(private _section: ViewSectionRec, private _options: ConfigNotifierOptions) {
    super();
    this.autoDispose(
      this._currentConfig.addListener((newConfig, oldConfig) => {
        if (isEqual(newConfig, oldConfig)) { return; }

        this._debounced();
      })
    );
  }

  protected _ready() {
    // On ready, send initial configuration.
    this._debounced({fromReady: true});
  }

  private _update({fromReady}: {fromReady?: boolean} = {}) {
    if (this.isDisposed()) { return; }

    this._notify({
      options: this._currentConfig.get(),
      settings: {
        accessLevel: this._accessLevel,
      },
      fromReady,
    });
  }
}

/**
 * Notifies about theme changes. Exposed in the API as `onThemeChange`.
 */
export class ThemeNotifier extends BaseEventSource {
  constructor(private _theme: Computed<Theme>) {
    super();
    this.autoDispose(
      this._theme.addListener((newTheme, oldTheme) => {
        if (isEqual(newTheme, oldTheme)) { return; }

        this._update();
      })
    );
  }

  protected _ready() {
    this._update({fromReady: true});
  }

  private _update({fromReady}: {fromReady?: boolean} = {}) {
    if (this.isDisposed()) { return; }

    this._notify({
      theme: this._theme.get(),
      fromReady,
    });
  }
}

/**
 * Notifies about cursor table data or structure change.
 * Exposed in the API as a onRecords handler.
 * This Notifier sends an initial event when subscribed
 */
export class TableNotifier extends BaseEventSource {
  private _debounced: () => void;
  private _updateMapping = true;
  constructor(private _baseView: BaseView) {
    super();
    this._debounced = debounce(() => this._update(), 0);
    this.autoDispose(_baseView.viewSection.viewFields().subscribe(this._debounced.bind(this)));
    this.listenTo(_baseView.sortedRows, 'rowNotify', this._debounced.bind(this));
    this.autoDispose(_baseView.sortedRows.getKoArray().subscribe(this._debounced.bind(this)));
    this.autoDispose(_baseView.viewSection.mappedColumns
      .subscribe(() => {
        this._updateMapping = true;
        this._debounced();
      })
    );
  }

  protected _ready() {
    // On ready, send initial table information.
    this._debounced();
  }

  private _update() {
    if (this.isDisposed()) {
      return;
    }
    const state = {
      tableId: this._baseView.viewSection.table().tableId(),
      rowId: this._baseView.cursor.getCursorPos().rowId || undefined,
      dataChange: true,
      mappingsChange: this._updateMapping
    };
    this._updateMapping = false;
    this._notify(state);
  }
}

export class CustomSectionAPIImpl extends Disposable implements CustomSectionAPI {
  constructor(
    private _section: ViewSectionRec,
    private _currentAccess: AccessLevel,
    private _promptCallback: (access: AccessLevel) => void
  ) {
    super();
  }

  public async mappings(): Promise<WidgetColumnMap|null> {
    return this._section.mappedColumns.peek();
  }

  /**
   * Method called as part of ready message. Allows widget to request for particular features or inform about
   * capabilities.
   */
  public async configure(settings: InteractionOptionsRequest): Promise<void> {
    if (settings.hasCustomOptions !== undefined) {
      this._section.hasCustomOptions(settings.hasCustomOptions);
    }
    if (settings.requiredAccess && settings.requiredAccess !== this._currentAccess) {
      this._promptCallback(settings.requiredAccess as AccessLevel);
    }
    if (settings.columns !== undefined) {
      this._section.columnsToMap(settings.columns);
    } else {
      this._section.columnsToMap(null);
    }
    if (settings.allowSelectBy !== undefined) {
      this._section.allowSelectBy(settings.allowSelectBy);
    }
  }
}
