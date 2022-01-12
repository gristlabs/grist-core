import {allCommands} from 'app/client/components/commands';
import {GristDoc} from 'app/client/components/GristDoc';
import * as kf from 'app/client/lib/koForm';
import {ViewSectionRec} from 'app/client/models/DocModel';
import {reportError} from 'app/client/models/errors';
import {cssLabel, cssRow, cssTextInput} from 'app/client/ui/RightPanel';
import {basicButton, primaryButton, textButton} from 'app/client/ui2018/buttons';
import {colors} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {cssLink} from 'app/client/ui2018/links';
import {IOptionFull, select} from 'app/client/ui2018/menus';
import {AccessLevel, ICustomWidget, isSatisfied} from 'app/common/CustomWidget';
import {GristLoadConfig} from 'app/common/gristUrls';
import {nativeCompare} from 'app/common/gutil';
import {bundleChanges, Computed, Disposable, dom, fromKo, makeTestId, MultiHolder, Observable, styled} from 'grainjs';

// Custom URL widget id - used as mock id for selectbox.
const CUSTOM_ID = 'custom';
const testId = makeTestId('test-config-widget-');

/**
 * Custom Widget section.
 * Allows to select custom widget from the list of available widgets
 * (taken from /widgets endpoint), or enter a Custom URL.
 * When Custom Widget has a desired access level (in accessLevel field),
 * will prompt user to approve it. "None" access level is auto approved,
 * so prompt won't be shown.
 *
 * When gristConfig.enableWidgetRepository is set to false, it will only
 * allow to specify Custom URL.
 */

export class CustomSectionConfig extends Disposable {
  // Holds all available widget definitions.
  private _widgets: Observable<ICustomWidget[]>;
  // Holds selected option (either custom string or a widgetId).
  private _selectedId: Computed<string | null>;
  // Holds custom widget URL.
  private _url: Computed<string>;
  // Enable or disable widget repository.
  private _canSelect = true;
  // When widget is changed, it sets its desired access level. We will prompt
  // user to approve or reject it.
  private _desiredAccess: Observable<AccessLevel|null>;
  // Current access level (stored inside a section).
  private _currentAccess: Computed<AccessLevel>;
  // Does widget has custom configuration.
  private _hasConfiguration: Computed<boolean>;

  constructor(_section: ViewSectionRec, _gristDoc: GristDoc) {
    super();

    const api = _gristDoc.app.topAppModel.api;

    // Test if we can offer widget list.
    const gristConfig: GristLoadConfig = (window as any).gristConfig || {};
    this._canSelect = gristConfig.enableWidgetRepository ?? true;

    // Array of available widgets - will be updated asynchronously.
    this._widgets = Observable.create(this, []);

    if (this._canSelect) {
      // From the start we will provide single widget definition
      // that was chosen previously.
      if (_section.customDef.widgetDef.peek()) {
        this._widgets.set([_section.customDef.widgetDef.peek()!]);
      }
      // Request for rest of the widgets.
      api
        .getWidgets()
        .then(widgets => {
          if (this.isDisposed()) {
            return;
          }
          const existing = _section.customDef.widgetDef.peek();
          // Make sure we have current widget in place.
          if (existing && !widgets.some(w => w.widgetId === existing.widgetId)) {
            widgets.push(existing);
          }
          this._widgets.set(widgets.sort((a, b) => nativeCompare(a.name.toLowerCase(), b.name.toLowerCase())));
        })
        .catch(reportError);
    }

    // Create temporary variable that will hold blank Custom Url state. When url is blank and widgetDef is not stored
    // we can either show "Select Custom Widget" or a Custom Url with a blank url.
    // To distinguish those states, we will mark Custom Url state at start (by checking that url is not blank and
    // widgetDef is not set). And then switch it during selectbox manipulation.
    const wantsToBeCustom = Observable.create(
      this,
      Boolean(_section.customDef.url.peek() && !_section.customDef.widgetDef.peek())
    );

    // Selected value from the dropdown (contains widgetId or "custom" string for Custom URL)
    this._selectedId = Computed.create(this, use => {
      if (use(_section.customDef.widgetDef)) {
        return _section.customDef.widgetDef.peek()!.widgetId;
      }
      if (use(_section.customDef.url) || use(wantsToBeCustom)) {
        return CUSTOM_ID;
      }
      return null;
    });
    this._selectedId.onWrite(async value => {
      if (value === CUSTOM_ID) {
        // Select Custom URL
        bundleChanges(() => {
          // Clear url.
          _section.customDef.url(null);
          // Clear widget definition.
          _section.customDef.widgetDef(null);
          // Set intermediate state
          wantsToBeCustom.set(true);
          // Reset access level to none.
          _section.customDef.access(AccessLevel.none);
          // Clear all saved options.
          _section.customDef.widgetOptions(null);
          // Reset custom configuration flag.
          _section.hasCustomOptions(false);
          this._desiredAccess.set(AccessLevel.none);
        });
        await _section.saveCustomDef();
      } else {
        // Select Widget
        const selectedWidget = this._widgets.get().find(w => w.widgetId === value);
        if (!selectedWidget) {
          // should not happen
          throw new Error('Error accessing widget from the list');
        }
        // If user selected the same one, do nothing.
        if (_section.customDef.widgetDef.peek()?.widgetId === value) {
          return;
        }
        bundleChanges(() => {
          // Clear access level
          _section.customDef.access(AccessLevel.none);
          // When widget wants some access, set desired access level.
          this._desiredAccess.set(selectedWidget.accessLevel || AccessLevel.none);
          // Update widget definition.
          _section.customDef.widgetDef(selectedWidget);
          // Update widget URL.
          _section.customDef.url(selectedWidget.url);
          // Clear options.
          _section.customDef.widgetOptions(null);
          // Clear has custom configuration.
          _section.hasCustomOptions(false);
          // Clear intermediate state.
          wantsToBeCustom.set(false);
        });
        await _section.saveCustomDef();
      }
    });

    // Url for the widget, taken either from widget definition, or provided by hand for Custom URL.
    // For custom widget, we will store url also in section definition.
    this._url = Computed.create(this, use => use(_section.customDef.url) || '');
    this._url.onWrite(newUrl => _section.customDef.url.setAndSave(newUrl));

    // Compute current access level.
    this._currentAccess = Computed.create(
      this,
      use => (use(_section.customDef.access) as AccessLevel) || AccessLevel.none
    );
    this._currentAccess.onWrite(async newAccess => {
      await _section.customDef.access.setAndSave(newAccess);
    });
    // From the start desired access level is the same as current one.
    this._desiredAccess = fromKo(_section.desiredAccessLevel);

    // Clear intermediate state when section changes.
    this.autoDispose(_section.id.subscribe(() => wantsToBeCustom.set(false)));
    this.autoDispose(_section.id.subscribe(() => this._reject()));

    this._hasConfiguration = Computed.create(this, use => use(_section.hasCustomOptions));
  }

  public buildDom() {
    // UI observables holder.
    const holder = new MultiHolder();

    // Show prompt, when desired access level is different from actual one.
    const prompt = Computed.create(holder, use =>
      use(this._desiredAccess)
      && !isSatisfied(use(this._currentAccess), use(this._desiredAccess)!));
    // If this is empty section or not.
    const isSelected = Computed.create(holder, use => Boolean(use(this._selectedId)));
    // If user is using custom url.
    const isCustom = Computed.create(holder, use => use(this._selectedId) === CUSTOM_ID || !this._canSelect);
    // Options for the select-box (all widgets definitions and Custom URL)
    const options = Computed.create(holder, use => [
      {label: 'Custom URL', value: 'custom'},
      ...use(this._widgets).map(w => ({label: w.name, value: w.widgetId})),
    ]);
    function buildPrompt(level: AccessLevel|null) {
      if (!level) {
        return null;
      }
      switch(level) {
        case AccessLevel.none: return cssConfirmLine("Widget does not require any permissions.");
        case AccessLevel.read_table: return cssConfirmLine("Widget needs to ", dom("b", "read"), " the current table.");
        case AccessLevel.full: return cssConfirmLine("Widget needs a ", dom("b", "full access"), " to this document.");
        default: throw new Error(`Unsupported ${level} access level`);
      }
    }
    // Options for access level.
    const levels: IOptionFull<string>[] = [
      {label: 'No document access', value: AccessLevel.none},
      {label: 'Read selected table', value: AccessLevel.read_table},
      {label: 'Full document access', value: AccessLevel.full},
    ];
    return dom(
      'div',
      dom.autoDispose(holder),
      this._canSelect
        ? cssRow(
            select(this._selectedId, options, {
              defaultLabel: 'Select Custom Widget',
              menuCssClass: cssMenu.className,
            }),
            testId('select')
          )
        : null,
      dom.maybe(isCustom, () => [
        cssRow(
          cssTextInput(
            this._url,
            async value => this._url.set(value),
            dom.attr('placeholder', 'Enter Custom URL'),
            testId('url')
          )
        ),
      ]),
      dom.maybe(prompt, () =>
        kf.prompt(
          {tabindex: '-1'},
          cssColumns(
            cssWarningWrapper(icon('Lock')),
            dom(
              'div',
              cssConfirmRow(
                dom.domComputed(this._desiredAccess, (level) => buildPrompt(level))
              ),
              cssConfirmRow(
                primaryButton(
                  'Accept',
                  testId('access-accept'),
                  dom.on('click', () => this._accept())
                ),
                basicButton(
                  'Reject',
                  testId('access-reject'),
                  dom.on('click', () => this._reject())
                )
              )
            )
          )
        )
      ),
      dom.maybe(
        use => use(isSelected) || !this._canSelect,
        () => [
          cssLabel('ACCESS LEVEL'),
          cssRow(select(this._currentAccess, levels), testId('access')),
        ]
      ),
      dom.maybe(this._hasConfiguration, () =>
        cssSection(
          textButton(
            'Open configuration',
            dom.on('click', () => this._openConfiguration()),
            testId('open-configuration')
          )
        )
      ),
      cssSection(
        cssLink(
          dom.attr('href', 'https://support.getgrist.com/widget-custom'),
          dom.attr('target', '_blank'),
          'Learn more about custom widgets'
        )
      ),
    );
  }

  private _openConfiguration(): void {
    allCommands.openWidgetConfiguration.run();
  }

  private _accept() {
    if (this._desiredAccess.get()) {
      this._currentAccess.set(this._desiredAccess.get()!);
    }
    this._reject();
  }

  private _reject() {
    this._desiredAccess.set(null);
  }
}

const cssWarningWrapper = styled('div', `
  padding-left: 8px;
  padding-top: 6px;
  --icon-color: ${colors.error}
`);

const cssColumns = styled('div', `
  display: flex;
`);

const cssConfirmRow = styled('div', `
  display: flex;
  padding: 8px;
  gap: 8px;
`);

const cssConfirmLine = styled('span', `
  white-space: pre-wrap;
`);

const cssSection = styled('div', `
  margin: 16px 16px 12px 16px;
`);

const cssMenu = styled('div', `
  & > li:first-child {
    border-bottom: 1px solid ${colors.mediumGrey};
  }
`);
