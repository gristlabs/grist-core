import * as kf from 'app/client/lib/koForm';
import {ViewSectionRec} from 'app/client/models/DocModel';
import {reportError} from 'app/client/models/errors';
import {cssLabel, cssRow, cssTextInput} from 'app/client/ui/RightPanel';
import {basicButton, primaryButton} from 'app/client/ui2018/buttons';
import {colors} from 'app/client/ui2018/cssVars';
import {cssLink} from 'app/client/ui2018/links';
import {IOptionFull, select} from 'app/client/ui2018/menus';
import {AccessLevel, ICustomWidget} from 'app/common/CustomWidget';
import {GristLoadConfig} from 'app/common/gristUrls';
import {nativeCompare} from 'app/common/gutil';
import {UserAPI} from 'app/common/UserAPI';
import {bundleChanges, Computed, Disposable, dom,
        makeTestId, MultiHolder, Observable, styled} from 'grainjs';
import {icon} from 'app/client/ui2018/icons';

// Custom URL widget id - used as mock id for selectbox.
const CUSTOM_ID = "custom";
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
  // Holds selected option (either custom or a widgetId).
  private _selected: Computed<string|null>;
  // Holds custom widget URL.
  private _url: Computed<string>;
  // Enable or disable widget repository.
  private _canSelect = true;
  // Selected access level.
  private _selectedAccess: Computed<AccessLevel>;
  // When widget is changed, it sets its desired access level. We will prompt
  // user to approve or reject it.
  private _desiredAccess: Observable<AccessLevel>;
  // Current access level (stored inside a section).
  private _currentAccess: Computed<AccessLevel>;

  constructor(section: ViewSectionRec, api: UserAPI) {
    super();

    // Test if we can offer widget list.
    const gristConfig: GristLoadConfig = (window as any).gristConfig || {};
    this._canSelect = gristConfig.enableWidgetRepository ?? true;

    // Array of available widgets - will be updated asynchronously.
    this._widgets = Observable.create(this, []);

    if (this._canSelect) {
      // From the start we will provide single widget definition
      // that was chosen previously.
      if (section.customDef.widgetDef.peek()) {
        this._widgets.set([section.customDef.widgetDef.peek()!]);
      }
      // Request for rest of the widgets.
      api.getWidgets().then(widgets => {
        if (this.isDisposed()) {
          return;
        }
        const existing = section.customDef.widgetDef.peek();
        // Make sure we have current widget in place.
        if (existing && !widgets.some(w => w.widgetId === existing.widgetId)) {
          widgets.push(existing);
        }
        this._widgets.set(widgets.sort((a, b) => nativeCompare(a.name.toLowerCase(), b.name.toLowerCase())));
      }).catch(err => {
        reportError(err);
      });
    }

    // Create temporary variable that will hold blank Custom Url state. When url is blank and widgetDef is not stored
    // we can either show "Select Custom Widget" or a Custom Url with a blank url.
    // To distinguish those states, we will mark Custom Url state at start (by checking that url is not blank and
    // widgetDef is not set). And then switch it during selectbox manipulation.
    const wantsToBeCustom = Observable.create(this,
      Boolean(section.customDef.url.peek() && !section.customDef.widgetDef.peek())
    );

    // Selected value from the dropdown (contains widgetId or "custom" string for Custom URL)
    this._selected = Computed.create(this, use => {
      if (use(section.customDef.widgetDef)) {
        return section.customDef.widgetDef.peek()!.widgetId;
      }
      if (use(section.customDef.url) || use(wantsToBeCustom)) {
        return CUSTOM_ID;
      }
      return null;
    });
    this._selected.onWrite(async (value) => {
      if (value === CUSTOM_ID) {
        // Select Custom URL
        bundleChanges(() => {
          // Clear url.
          section.customDef.url(null);
          // Clear widget definition.
          section.customDef.widgetDef(null);
          // Set intermediate state
          wantsToBeCustom.set(true);
          // Reset access level to none.
          section.customDef.access(AccessLevel.none);
          this._desiredAccess.set(AccessLevel.none);
        });
        await section.saveCustomDef();
      } else {
        // Select Widget
        const selectedWidget = this._widgets.get().find(w => w.widgetId === value);
        if (!selectedWidget) {
          // should not happen
          throw new Error("Error accessing widget from the list");
        }
        // If user selected the same one, do nothing.
        if (section.customDef.widgetDef.peek()?.widgetId === value) {
          return;
        }
        bundleChanges(() => {
          // Clear access level
          section.customDef.access(AccessLevel.none);
          // When widget wants some access, set desired access level.
          this._desiredAccess.set(selectedWidget.accessLevel || AccessLevel.none);
          // Update widget definition.
          section.customDef.widgetDef(selectedWidget);
          // Update widget URL.
          section.customDef.url(selectedWidget.url);
          // Clear intermediate state.
          wantsToBeCustom.set(false);
        });
        await section.saveCustomDef();
      }
    });

    // Url for the widget, taken either from widget definition, or provided by hand for Custom URL.
    // For custom widget, we will store url also in section definition.
    this._url = Computed.create(this, use => use(section.customDef.url) || "");
    this._url.onWrite((newUrl) => section.customDef.url.setAndSave(newUrl));

    // Compute current access level.
    this._currentAccess = Computed.create(this,
      use => use(section.customDef.access) as AccessLevel || AccessLevel.none);

    // From the start desired access level is the same as current one.
    this._desiredAccess = Observable.create(this, this._currentAccess.get());

    // Selected access level will show desired one, but will updated both (desired and current).
    this._selectedAccess = Computed.create(this, use => use(this._desiredAccess));
    this._selectedAccess.onWrite(async newAccess => {
      this._desiredAccess.set(newAccess);
      await section.customDef.access.setAndSave(newAccess);
    });

    // Clear intermediate state when section changes.
    this.autoDispose(section.id.subscribe(() => wantsToBeCustom.set(false)));
    this.autoDispose(section.id.subscribe(() => this._reject()));
  }

  public buildDom() {
    // UI observables holder.
    const holder = new MultiHolder();

    // Show prompt, when desired access level is different from actual one.
    const prompt = Computed.create(holder, use => use(this._currentAccess) !== use(this._desiredAccess));
    // If this is empty section or not.
    const isSelected = Computed.create(holder, use => Boolean(use(this._selected)));
    // If user is using custom url.
    const isCustom = Computed.create(holder, use => use(this._selected) === CUSTOM_ID || !this._canSelect);
    // Options for the selectbox (all widgets definitions and Custom URL)
    const options = Computed.create(holder, use => [
      {label: 'Custom URL', value: 'custom'},
      ...use(this._widgets).map(w => ({label: w.name, value: w.widgetId})),
    ]);
    // Options for access level.
    const levels: IOptionFull<string>[] = [
      {label: 'No document access', value: AccessLevel.none},
      {label: 'Read selected table', value: AccessLevel.read_table},
      {label: 'Full document access', value: AccessLevel.full},
    ];
    return dom(
      'div',
      dom.autoDispose(holder),
      this._canSelect ?
      cssRow(
        select(this._selected, options, {
          defaultLabel: 'Select Custom Widget',
          menuCssClass: cssMenu.className
        }),
        testId('select')
      ) : null,
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
      cssSection(
        cssLink(
          dom.attr('href', 'https://support.getgrist.com/widget-custom'),
          dom.attr('target', '_blank'),
          'Learn more about custom widgets'
        )
      ),
      dom.maybe((use) => use(isSelected) || !this._canSelect, () => [
        cssLabel('ACCESS LEVEL'),
        cssRow(select(this._selectedAccess, levels), testId('access')),
        dom.maybe(prompt, () =>
          kf.prompt(
            {tabindex: '-1'},
            cssColumns(
              cssWarningWrapper(
                icon('Lock'),
              ),
              dom('div',
                cssConfirmRow(
                  "Approve requested access level?"
                ),
                cssConfirmRow(
                  primaryButton("Accept",
                    testId('access-accept'),
                    dom.on('click', () => this._accept())),
                  basicButton("Reject",
                    testId('access-reject'),
                    dom.on('click', () => this._reject()))
                )
              )
            )
          )
        )
      ])
    );
  }

  private _accept() {
    this._selectedAccess.set(this._desiredAccess.get());
    this._reject();
  }

  private _reject() {
    this._desiredAccess.set(this._currentAccess.get());
  }
}

const cssWarningWrapper = styled('div', `
  padding-left: 8px;
  padding-top: 6px;
  --icon-color: ${colors.lightGreen}
`);

const cssColumns = styled('div', `
  display: flex;
`);

const cssConfirmRow = styled('div', `
  display: flex;
  padding: 8px;
  gap: 8px;
`);

const cssSection = styled('div', `
  margin: 16px 16px 12px 16px;
`);

const cssMenu = styled('div', `
  & > li:first-child {
    border-bottom: 1px solid ${colors.mediumGrey};
  }
`);
