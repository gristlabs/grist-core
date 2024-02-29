import BaseView from 'app/client/components/BaseView';
import * as commands from 'app/client/components/commands';
import {Cursor} from 'app/client/components/Cursor';
import {GristDoc} from 'app/client/components/GristDoc';
import {
  CommandAPI,
  ConfigNotifier,
  CustomSectionAPIImpl,
  GristDocAPIImpl,
  GristViewImpl,
  MinimumLevel,
  RecordNotifier,
  TableNotifier,
  ThemeNotifier,
  WidgetAPIImpl,
  WidgetFrame
} from 'app/client/components/WidgetFrame';
import {CustomSectionElement, ViewProcess} from 'app/client/lib/CustomSectionElement';
import {makeT} from 'app/client/lib/localization';
import {Disposable} from 'app/client/lib/dispose';
import dom from 'app/client/lib/dom';
import {makeTestId} from 'app/client/lib/domUtils';
import * as kd from 'app/client/lib/koDom';
import DataTableModel from 'app/client/models/DataTableModel';
import {ViewSectionRec} from 'app/client/models/DocModel';
import {CustomViewSectionDef} from 'app/client/models/entities/ViewSectionRec';
import {UserError} from 'app/client/models/errors';
import {SortedRowSet} from 'app/client/models/rowset';
import {closeRegisteredMenu} from 'app/client/ui2018/menus';
import {AccessLevel} from 'app/common/CustomWidget';
import {defaultLocale} from 'app/common/gutil';
import {PluginInstance} from 'app/common/PluginInstance';
import {Events as BackboneEvents} from 'backbone';
import {dom as grains} from 'grainjs';
import * as ko from 'knockout';
import defaults = require('lodash/defaults');

const t = makeT('CustomView');
const testId = makeTestId('test-custom-widget-');

/**
 *
 * Built in settings for a custom widget. Used when the custom
 * widget is the implementation of a native-looking widget,
 * for example the calendar widget.
 *
 */
export interface CustomViewSettings {
  widgetId?: string;
  accessLevel?: AccessLevel;
}

/**
 * CustomView components displays arbitrary html. There are two modes available, in the "url" mode
 * the content is hosted by a third-party (for instance a github page), as opposed to the "plugin"
 * mode where the contents is provided by a plugin. In both cases the content is rendered safely
 * within an iframe (or webview if running electron). Configuration of the component is done within
 * the view config tab in the side pane. In "plugin" mode, shows notification if either the plugin
 * of the section could not be found.
 */
export class CustomView extends Disposable {

  private static _commands = {
    async openWidgetConfiguration(this: CustomView) {
      if (!this.isDisposed() && !this._frame?.isDisposed()) {
        try {
          await this._frame.editOptions();
        } catch(err) {
          if (err.message === "Unknown interface") {
            throw new UserError("Custom widget doesn't expose configuration screen.");
          } else {
            throw err;
          }
        }
      }
    },
    async viewAsCard(event: Event) {
      if (event instanceof KeyboardEvent) {
        // Ignore the keyboard shortcut if pressed; it's disabled at this time for custom widgets.
        return;
      }

      (this as unknown as BaseView).viewSelectedRecordAsCard();

      // Move focus back to the app, so that keyboard shortcuts work in the popup.
      document.querySelector<HTMLElement>('textarea.copypaste.mousetrap')?.focus();
    },
  };
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

  protected customDef: CustomViewSectionDef;

  // state of the component
  private _foundPlugin: ko.Observable<boolean>;
  private _foundSection: ko.Observable<boolean>;
  // Note the invariant: this._customSection != undefined if this._foundSection() == true
  private _customSection: ViewProcess|undefined;
  private _pluginInstance: PluginInstance|undefined;

  private _frame: WidgetFrame;  // plugin frame (holding external page)
  private _hasUnmappedColumns: ko.Computed<boolean>;

  public create(gristDoc: GristDoc, viewSectionModel: ViewSectionRec) {
    BaseView.call(this as any, gristDoc, viewSectionModel, { 'addNewRow': true });

    this.customDef = this.viewSection.customDef;

    this.autoDisposeCallback(() => {
      if (this._customSection) {
        this._customSection.dispose();
      }
    });
    this._foundPlugin = ko.observable(false);
    this._foundSection = ko.observable(false);
    // Ensure that selecting another section in same plugin update the view.
    this._foundSection.extend({notify: 'always'});

    this.autoDispose(this.customDef.pluginId.subscribe(this._updatePluginInstance, this));
    this.autoDispose(this.customDef.sectionId.subscribe(this._updateCustomSection, this));
    this.autoDispose(commands.createGroup(CustomView._commands, this, this.viewSection.hasFocus));

    this._hasUnmappedColumns = this.autoDispose(ko.pureComputed(() => {
      const columns = this.viewSection.columnsToMap();
      if (!columns) { return false; }
      const required = columns.filter(col => typeof col === 'string' || !(col.optional === true))
                              .map(col => typeof col === 'string' ? col : col.name);
      const mapped = this.viewSection.mappedColumns() || {};
      return required.some(col => !mapped[col]) && this.customDef.mode() === "url";
    }));

    this.viewPane = this.autoDispose(this._buildDom());
    this._updatePluginInstance();
  }

  public async triggerPrint() {
    if (!this.isDisposed() && this._frame) {
      return await this._frame.callRemote('print');
    }
  }

  protected getBuiltInSettings(): CustomViewSettings {
    return {};
  }

  /**
   * Find a plugin instance that matches the plugin id, update the `found` observables, then tries to
   * find a matching section.
   */
  private _updatePluginInstance() {

    const pluginId = this.customDef.pluginId();
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

    const sectionId = this.customDef.sectionId();
    this._customSection = CustomSectionElement.find(this._pluginInstance, sectionId);

    if (this._customSection) {
      const el = this._customSection.element;
      el.classList.add("flexitem");
      this._foundSection(true);
    } else {
      this._foundSection(false);
    }
  }

  private _buildDom() {
    const {mode, url, access, renderAfterReady, widgetDef, widgetId, pluginId} = this.customDef;
    const showPlugin = ko.pureComputed(() => this.customDef.mode() === "plugin");
    const showAfterReady = () => {
      // The empty widget page calls `grist.ready()`.
      if (!url() && !widgetId()) { return true; }

      return renderAfterReady();
    };

    // When both plugin and section are not found, let's show only plugin notification.
    const showPluginNotification = ko.pureComputed(() => showPlugin() && !this._foundPlugin());
    const showSectionNotification = ko.pureComputed(() => showPlugin() && this._foundPlugin() && !this._foundSection());
    const showPluginContent = ko.pureComputed(() => showPlugin() && this._foundSection())
        // For the view to update when switching from one section to another one, the computed
        // observable must always notify.
        .extend({notify: 'always'});
    // Some widgets have built-in settings that should override anything
    // that is in the rest of the view options. Ideally, everything would
    // be consistent. We could fix inconsistencies if we find them, but
    // we are not guaranteed to have write privileges at this point.
    const builtInSettings = this.getBuiltInSettings();
    return dom('div.flexauto.flexvbox.custom_view_container',
      dom.autoDispose(showPlugin),
      dom.autoDispose(showPluginNotification),
      dom.autoDispose(showSectionNotification),
      dom.autoDispose(showPluginContent),

      kd.maybe(this._hasUnmappedColumns, () => dom('div.custom_view_no_mapping',
        testId('not-mapped'),
        dom('img', {src: 'img/empty-widget.svg'}),
        dom('h1', kd.text(t("Some required columns aren't mapped"))),
        dom('p',
          t('To use this widget, please map all non-optional columns from the creator panel on the right.')
        ),
      )),
      // todo: should display content in webview when running electron
      // prefer widgetId; spelunk in widgetDef for older docs
      kd.scope(() => [
        this._hasUnmappedColumns(), mode(), url(), access(), widgetId() || widgetDef()?.widgetId || '', pluginId()
      ], ([_hide, _mode, _url, _access, _widgetId, _pluginId]: string[]) =>
        _mode === "url" && !_hide ?
          this._buildIFrame({
            baseUrl: _url,
            access: builtInSettings.accessLevel || (_access as AccessLevel || AccessLevel.none),
            showAfterReady: showAfterReady(),
            widgetId: builtInSettings.widgetId || _widgetId,
            pluginId: _pluginId,
          })
          : null
      ),
      kd.maybe(showPluginNotification, () => buildNotification('Plugin ',
        dom('strong', kd.text(this.customDef.pluginId)), ' was not found',
        dom.testId('customView_notification_plugin')
      )),
      kd.maybe(showSectionNotification, () => buildNotification('Section ',
        dom('strong', kd.text(this.customDef.sectionId)), ' was not found in plugin ',
        dom('strong', kd.text(this.customDef.pluginId)),
        dom.testId('customView_notification_section')
      )),
      // When showPluginContent() is true then _foundSection() is also and _customSection is not
      // undefined (invariant).
      kd.maybe(showPluginContent, () => this._customSection!.element)
    );
  }

  private _promptAccess(access: AccessLevel) {
    if (this.gristDoc.isReadonly.get()) {
      return;
    }
    this.viewSection.desiredAccessLevel(access);
  }

  private _buildIFrame(options: {
    baseUrl: string|null,
    access: AccessLevel,
    showAfterReady?: boolean,
    widgetId?: string|null,
    pluginId?: string
  }) {
    const {baseUrl, access, showAfterReady, widgetId, pluginId} = options;
    const documentSettings = this.gristDoc.docData.docSettings();
    const readonly = this.gristDoc.isReadonly.get();
    const widgetFrame = WidgetFrame.create(null,  {
      url: baseUrl,
      widgetId,
      pluginId,
      access,
      preferences:
      {
        culture: documentSettings.locale?? defaultLocale,
        language:  this.gristDoc.appModel.currentUser?.locale ?? defaultLocale,
        timeZone: this.gristDoc.docInfo.timezone() ?? "UTC",
        currency: documentSettings.currency?? "USD",
      },
      readonly,
      showAfterReady,
      configure: (frame) => {
        this._frame = frame;
        // Need to cast myself to a BaseView
        const view = this as unknown as BaseView;
        frame.exposeAPI(
          "GristDocAPI",
          new GristDocAPIImpl(this.gristDoc),
          GristDocAPIImpl.defaultAccess);
        frame.exposeAPI(
          "GristView",
          new GristViewImpl(view, access), new MinimumLevel(AccessLevel.read_table));
        frame.exposeAPI(
          "CustomSectionAPI",
          new CustomSectionAPIImpl(
            this.viewSection,
            access,
            this._promptAccess.bind(this)),
          new MinimumLevel(AccessLevel.none));
        frame.exposeAPI(
          "CommandAPI",
          new CommandAPI(access),
          new MinimumLevel(AccessLevel.none));
        frame.useEvents(RecordNotifier.create(frame, view), new MinimumLevel(AccessLevel.read_table));
        frame.useEvents(TableNotifier.create(frame, view), new MinimumLevel(AccessLevel.read_table));
        frame.exposeAPI(
          "WidgetAPI",
          new WidgetAPIImpl(this.viewSection),
          new MinimumLevel(AccessLevel.none)); // none access is enough
        frame.useEvents(
          ConfigNotifier.create(frame, this.viewSection, {
            access,
          }),
          new MinimumLevel(AccessLevel.none)); // none access is enough
        frame.useEvents(
          ThemeNotifier.create(frame, this.gristDoc.currentTheme),
          new MinimumLevel(AccessLevel.none));
      },
      onElem: (iframe) => onFrameFocus(iframe, () => {
        if (this.isDisposed()) { return; }
        if (!this.viewSection.isDisposed() && !this.viewSection.hasFocus()) {
          this.viewSection.hasFocus(true);
        }
        // allow menus to close if any
        closeRegisteredMenu();
      }),
      gristDoc: this.gristDoc,
    });

    // Can't use dom.create() because it seems buggy in this context. This dom will be detached
    // and attached several times, and dom.create() doesn't seem to handle that well as it returns an
    // array of nodes (comment, node, comment) and it somehow breaks the dispose order. Collapsed widgets
    // relay on a correct order of dispose, and are detaching nodes just before they are disposed, so if
    // the order is wrong, the node is disposed without being detached first.
    return grains.update(widgetFrame.buildDom(), dom.autoDispose(widgetFrame));
  }
}

// Getting an ES6 class to work with old-style multiple base classes takes a little hacking. Credits: ./ChartView.ts
defaults(CustomView.prototype, BaseView.prototype);
Object.assign(CustomView.prototype, BackboneEvents);


// helper to build the notification's frame.
function buildNotification(...args: any[]) {
  return dom('div.custom_view_notification.bg-warning', dom('p', ...args));
}

/**
 * There is no way to detect if the frame was clicked. This causes a bug, when
 * there are 2 custom widgets on a page then user can't switch focus from 1 section
 * to another. The only solution is too pool and test if the iframe is an active element
 * in the dom.
 * (See https://stackoverflow.com/questions/2381336/detect-click-into-iframe-using-javascript).
 *
 * For a single iframe, it will gain focus through a hack in ViewLayout.ts.
 */
function onFrameFocus(frame: HTMLIFrameElement, handler: () => void) {
  let timer: NodeJS.Timeout|null = null;
  // Flag that will prevent mouseenter event to be fired
  // after dom is disposed. This shouldn't happen.
  let disposed = false;
  // Stops pooling.
  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }
  return grains.update(frame,
    grains.on("mouseenter", () => {
      // Make sure we weren't dispose (should not happen)
      if (disposed) { return; }
      // If frame already has focus, do nothing.
      // NOTE: Frame will always be an active element from our perspective,
      // even if the focus is somewhere inside the iframe.
      if (document.activeElement === frame) { return; }
      // Start pooling for frame focus.
      timer = setInterval(() => {
        if (document.activeElement === frame) {
          try {
            handler();
          } finally {
            // Stop checking, we will start again after next mouseenter.
            stop();
          }
        }
      }, 70); // 70 is enough to make it look like a click.
    }),
    grains.on("mouseleave", stop),
    grains.onDispose(() => {
      stop();
      disposed = true;
    })
  );
}
