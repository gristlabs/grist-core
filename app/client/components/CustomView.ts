import * as BaseView from 'app/client/components/BaseView';
import {Cursor} from 'app/client/components/Cursor';
import { GristDoc } from 'app/client/components/GristDoc';
import { get as getBrowserGlobals } from 'app/client/lib/browserGlobals';
import { CustomSectionElement, ViewProcess } from 'app/client/lib/CustomSectionElement';
import { Disposable } from 'app/client/lib/dispose';
import * as dom from 'app/client/lib/dom';
import * as kd from 'app/client/lib/koDom';
import * as DataTableModel from 'app/client/models/DataTableModel';
import { ViewFieldRec, ViewSectionRec } from 'app/client/models/DocModel';
import { CustomViewSectionDef } from 'app/client/models/entities/ViewSectionRec';
import {SortedRowSet} from 'app/client/models/rowset';
import { BulkColValues, RowRecord } from 'app/common/DocActions';
import {extractInfoFromColType, reencodeAsAny} from 'app/common/gristTypes';
import { PluginInstance } from 'app/common/PluginInstance';
import {GristView} from 'app/plugin/GristAPI';
import {Events as BackboneEvents} from 'backbone';
import {MsgType, Rpc} from 'grain-rpc';
import * as ko from 'knockout';
import debounce = require('lodash/debounce');
import defaults = require('lodash/defaults');
import noop = require('lodash/noop');

const G = getBrowserGlobals('window');

/**
 * CustomView components displays arbitrary html. There are two modes available, in the "url" mode
 * the content is hosted by a third-party (for instance a github page), as opposed to the "plugin"
 * mode where the contents is provided by a plugin. In both cases the content is rendered safely
 * within an iframe (or webview if running electron). Configuration of the component is done within
 * the view config tab in the side pane. In "plugin" mode, shows notification if either the plugin
 * of the section could not be found.
 */
export class CustomView extends Disposable {

  /**
   * The HTMLElement embedding the content.
   */
  public viewPane: HTMLElement;

  // viewSection, sortedRows, tableModel, gristDoc, and cursor are inherited from BaseView
  protected viewSection: ViewSectionRec;
  protected sortedRows: SortedRowSet;
  protected tableModel: DataTableModel;
  protected gristDoc: GristDoc;
  protected cursor: Cursor;

  private _customDef: CustomViewSectionDef;

  // state of the component
  private _foundPlugin: ko.Observable<boolean>;
  private _foundSection: ko.Observable<boolean>;
  // Note the invariant: this._customSection != undefined if this._foundSection() == true
  private _customSection: ViewProcess|undefined;
  private _pluginInstance: PluginInstance|undefined;

  private _updateData: () => void;   // debounced call to let the view know linked data changed.
  private _updateCursor: () => void; // debounced call to let the view know linked cursor changed.
  private _rpc: Rpc;  // rpc connection to view.

  public create(gristDoc: GristDoc, viewSectionModel: ViewSectionRec) {
    BaseView.call(this as any, gristDoc, viewSectionModel);

    this._customDef =  this.viewSection.customDef;

    this.autoDisposeCallback(() => {
      if (this._customSection) {
        this._customSection.dispose();
      }
    });
    this._foundPlugin = ko.observable(false);
    this._foundSection = ko.observable(false);
    // Ensure that selecting another section in same plugin update the view.
    this._foundSection.extend({notify: 'always'});

    this.autoDispose(this._customDef.pluginId.subscribe(this._updatePluginInstance, this));
    this.autoDispose(this._customDef.sectionId.subscribe(this._updateCustomSection, this));

    this.viewPane = this.autoDispose(this._buildDom());
    this._updatePluginInstance();

    this._updateData = debounce(() => this._updateView(true), 0);
    this._updateCursor = debounce(() => this._updateView(false), 0);

    this.autoDispose(this.viewSection.viewFields().subscribe(this._updateData));
    this.listenTo(this.sortedRows, 'rowNotify', this._updateData);
    this.autoDispose(this.sortedRows.getKoArray().subscribe(this._updateData));

    this.autoDispose(this.cursor.rowIndex.subscribe(this._updateCursor));
  }

  private _updateView(dataChange: boolean) {
    if (this.isDisposed()) { return; }
    if (this._rpc) {
      const state = {
        tableId: this.viewSection.table().tableId(),
        rowId: this.cursor.getCursorPos().rowId || undefined,
        dataChange
      };
      // tslint:disable-next-line:no-console
      this._rpc.postMessage(state).catch(e => console.error('Failed to send view state', e));
      // This post message won't get through if doc access has not been granted to the view.
    }
  }

  /**
   * Find a plugin instance that matchs the plugin id, update the `found` observables, then tries to
   * find a matching section.
   */
  private _updatePluginInstance() {

    const pluginId = this._customDef.pluginId();
    this._pluginInstance = this.gristDoc.docPluginManager.pluginsList.find(p => p.definition.id === pluginId);

    if (this._pluginInstance) {
      this._foundPlugin(true);
    } else {
      this._foundPlugin(false);
      this._foundSection(false);
    }
    this._updateCustomSection();
  }

  /**
   * If a plugin was found, find a custom section matching the section id and update the `found`
   * observables.
   */
  private _updateCustomSection() {

    if (!this._pluginInstance) { return; }

    const sectionId = this._customDef.sectionId();
    this._customSection = CustomSectionElement.find(this._pluginInstance, sectionId);

    if (this._customSection) {
      const el = this._customSection.element;
      el.classList.add("flexitem");
      this._foundSection(true);
    } else {
      this._foundSection(false);
    }

  }

  /**
   * Access data backing the section as a table.  This code is borrowed
   * with variations from ChartView.ts.
   */
  private _getSelectedTable(): BulkColValues {
    const fields: ViewFieldRec[] = this.viewSection.viewFields().all();
    const rowIds: number[] = this.sortedRows.getKoArray().peek() as number[];
    const data: BulkColValues = {};
    for (const field of fields) {
      // Use the colId of the displayCol, which may be different in case of Reference columns.
      const colId: string = field.displayColModel.peek().colId.peek();
      const getter = this.tableModel.tableData.getRowPropFunc(colId)!;
      const typeInfo = extractInfoFromColType(field.column.peek().type.peek());
      data[field.column().colId()] = rowIds.map((r) => reencodeAsAny(getter(r)!, typeInfo));
    }
    data.id = rowIds;
    return data;
  }

  private _getSelectedRecord(rowId: number): RowRecord {
    // Prepare an object containing the fields available to the view
    // for the specified row.  A RECORD()-generated rendering would be
    // more useful. but the data engine needs to know what information
    // the custom view depends on, so we shouldn't volunteer any untracked
    // information here.
    const fields: ViewFieldRec[] = this.viewSection.viewFields().all();
    const data: RowRecord = {id: rowId};
    for (const field of fields) {
      const colId: string = field.displayColModel.peek().colId.peek();
      const typeInfo = extractInfoFromColType(field.column.peek().type.peek());
      data[field.column().colId()] = reencodeAsAny(this.tableModel.tableData.getValue(rowId, colId)!, typeInfo);
    }
    return data;
  }

  private _buildDom() {
    const {mode, url, access} = this._customDef;
    const showPlugin = ko.pureComputed(() => this._customDef.mode() === "plugin");

    // When both plugin and section are not found, let's show only plugin notification.
    const showPluginNotification = ko.pureComputed(() => showPlugin() && !this._foundPlugin());
    const showSectionNotification = ko.pureComputed(() => showPlugin() && this._foundPlugin() && !this._foundSection());
    const showPluginContent = ko.pureComputed(() => showPlugin() && this._foundSection())
        // For the view to update when switching from one section to another one, the computed
        // observable must always notify.
        .extend({notify: 'always'});
    return dom('div.flexauto.flexvbox.custom_view_container',
      dom.autoDispose(showPlugin),
      dom.autoDispose(showPluginNotification),
      dom.autoDispose(showSectionNotification),
      dom.autoDispose(showPluginContent),
      // todo: should display content in webview when running electron
      kd.scope(() => [mode(), url(), access()], ([_mode, _url, _access]: string[]) =>
        _mode === "url" ? this._buildIFrame(_url, _access) : null),
      kd.maybe(showPluginNotification, () => buildNotification('Plugin ',
        dom('strong', kd.text(this._customDef.pluginId)), ' was not found',
        dom.testId('customView_notification_plugin')
      )),
      kd.maybe(showSectionNotification, () => buildNotification('Section ',
        dom('strong', kd.text(this._customDef.sectionId)), ' was not found in plugin ',
        dom('strong', kd.text(this._customDef.pluginId)),
        dom.testId('customView_notification_section')
      )),
      // When showPluginContent() is true then _foundSection() is also and _customSection is not
      // undefined (invariant).
      kd.maybe(showPluginContent, () => this._customSection!.element)
    );
  }

  private _buildIFrame(baseUrl: string, access: string) {
    // This is a url-flavored custom view.
    // Here we create an iframe, and add hooks for sending
    // messages to it and receiving messages from it.

    // Compute a url for the view.  We add in a parameter called "access"
    // so the page can determine what access level has been granted to it
    // in a simple and unambiguous way.
    let fullUrl: string;
    if (!baseUrl) {
      fullUrl = baseUrl;
    } else {
      const url = new URL(baseUrl);
      url.searchParams.append('access', access);
      fullUrl = url.href;
    }

    if (!access) { access = 'none'; }
    const someAccess = (access !== 'none');
    const fullAccess = (access === 'full');

    // Create an Rpc object to manage messaging.  If full access is granted,
    // allow forwarding to the back-end; otherwise restrict to APIs explicitly
    // made available here.
    const rpc = fullAccess ? this.gristDoc.docPluginManager.makeAnonForwarder() :
      new Rpc({});
    // Now, we create a listener for message events (if access was granted), making sure
    // to respond only to messages from our iframe.
    const listener = someAccess ? (event: MessageEvent) => {
      if (event.source === iframe.contentWindow) {
        rpc.receiveMessage(event.data);
        if (event.data.mtype === MsgType.Ready) {
          // After, the "ready" message, send a notification with cursor
          // (if available).
          this._updateView(true);
        }
      }
    } : null;
    // Add the listener only if some access has been granted.
    if (listener) { G.window.addEventListener('message', listener); }
    // Here is the actual iframe.
    const iframe = dom('iframe.custom_view.clipboard_focus',
                       {src: fullUrl},
                       dom.onDispose(() => {
                         if (listener) { G.window.removeEventListener('message', listener); }
                       }));
    if (someAccess) {
      // When replies come back, forward them to the iframe if access
      // is granted.
      rpc.setSendMessage(msg => {
        iframe.contentWindow!.postMessage(msg, '*');
      });
      // Register a way for the view to access the data backing the view.
      rpc.registerImpl<GristView>('GristView', {
        fetchSelectedTable: () => this._getSelectedTable(),
        fetchSelectedRecord: (rowId: number) => this._getSelectedRecord(rowId),
      });
    } else {
      // Direct messages to /dev/null otherwise.  Important to setSendMessage
      // or they will be queued indefinitely.
      rpc.setSendMessage(noop);
    }
    // We send events via the rpc object when the data backing the view changes
    // or the cursor changes.
    if (this._rpc) {
      // There's an existing RPC object we are replacing.
      // Unregister anything that may have been registered previously.
      // TODO: add a way to clean up more systematically to grain-rpc.
      this._rpc.unregisterForwarder('*');
      this._rpc.unregisterImpl('GristView');
    }
    this._rpc = rpc;
    return iframe;
  }

  private listenTo(...args: any[]): void { /* replaced by Backbone */ }
}

// Getting an ES6 class to work with old-style multiple base classes takes a little hacking. Credits: ./ChartView.ts
defaults(CustomView.prototype, BaseView.prototype);
Object.assign(CustomView.prototype, BackboneEvents);


// helper to build the notification's frame.
function buildNotification(...args: any[]) {
  return dom('div.custom_view_notification.bg-warning', dom('p', ...args));
}
