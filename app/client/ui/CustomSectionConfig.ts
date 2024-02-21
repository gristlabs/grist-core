import {allCommands} from 'app/client/components/commands';
import {GristDoc} from 'app/client/components/GristDoc';
import {makeTestId} from 'app/client/lib/domUtils';
import * as kf from 'app/client/lib/koForm';
import {makeT} from 'app/client/lib/localization';
import {ColumnToMapImpl} from 'app/client/models/ColumnToMap';
import {ColumnRec, ViewSectionRec} from 'app/client/models/DocModel';
import {reportError} from 'app/client/models/errors';
import {cssHelp, cssLabel, cssRow, cssSeparator} from 'app/client/ui/RightPanelStyles';
import {hoverTooltip} from 'app/client/ui/tooltips';
import {cssDragRow, cssFieldEntry, cssFieldLabel} from 'app/client/ui/VisibleFieldsConfig';
import {basicButton, primaryButton, textButton} from 'app/client/ui2018/buttons';
import {theme, vars} from 'app/client/ui2018/cssVars';
import {cssDragger} from 'app/client/ui2018/draggableList';
import {textInput} from 'app/client/ui2018/editableLabel';
import {icon} from 'app/client/ui2018/icons';
import {cssLink} from 'app/client/ui2018/links';
import {cssOptionLabel, IOption, IOptionFull, menu, menuItem, menuText, select} from 'app/client/ui2018/menus';
import {AccessLevel, ICustomWidget, isSatisfied, matchWidget} from 'app/common/CustomWidget';
import {GristLoadConfig} from 'app/common/gristUrls';
import {not, unwrap} from 'app/common/gutil';
import {
  bundleChanges,
  Computed,
  Disposable,
  dom,
  fromKo,
  MultiHolder,
  Observable,
  styled,
  UseCBOwner
} from 'grainjs';

const t = makeT('CustomSectionConfig');

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
 * allow to specify the custom URL.
 */

class ColumnPicker extends Disposable {
  constructor(
    private _value: Observable<number|number[]|null>,
    private _column: ColumnToMapImpl,
    private _section: ViewSectionRec){
    super();
  }
  public buildDom() {
    // Rewrite value to ignore old configuration when allowMultiple is switched.
    const properValue = Computed.create(this, use => {
      const value = use(this._value);
      return Array.isArray(value) ? null : value;
    });
    properValue.onWrite(value => this._value.set(value || null));

    const canBeMapped = Computed.create(this, use => {
      return use(this._section.columns)
        .filter(col => this._column.canByMapped(use(col.pureType)));
    });

    // This is a HACK, to refresh options only when the menu is opened (or closed)
    // and not to track down all the dependencies. Otherwise the select menu won't
    // be hidden when option is selected - there is a bug that prevents it from closing
    // when list of options is changed.
    const refreshTrigger = Observable.create(this, false);

    const options = Computed.create(this, use => {
      void use(refreshTrigger);

      const columnsAsOptions: IOption<number|null>[] = use(canBeMapped)
                                              .map((col) => ({
                                                value: col.getRowId(),
                                                label: col.label.peek(),
                                                icon: 'FieldColumn',
                                              }));

      // For optional mappings, add 'Blank' option but only if the value is set.
      // This option will allow to clear the selection.
      if (this._column.optional && properValue.get()) {
        columnsAsOptions.push({
          value: 0,
          // Another hack. Select doesn't allow to have different label for blank option and the default text.
          // So we will render this label ourselves later using `renderOptionArgs`.
          label: '',
        });
      }
      return columnsAsOptions;
    });

    const isDisabled = Computed.create(this, use => {
      return use(canBeMapped).length === 0;
    });

    const defaultLabel = this._column.typeDesc != "any"
        ? t("Pick a {{columnType}} column", {"columnType": this._column.typeDesc})
        : t("Pick a column");

    return [
      cssLabel(
        this._column.title,
        this._column.optional ? cssSubLabel(t(" (optional)")) : null,
        testId('label-for-' + this._column.name),
      ),
      this._column.description ? cssHelp(
        this._column.description,
        testId('help-for-' + this._column.name),
      ) : null,
        dom.maybe(not(isDisabled), () => [
          cssRow(
            dom.update(
              select(
                properValue,
                options,
                {
                  defaultLabel,
                  renderOptionArgs : (opt) => {
                    // If there is a label, render it.
                    // Otherwise show the 'Clear selection' label as a greyed out text.
                    // This is the continuation of the hack from above - were we added an option
                    // without a label.
                    return (opt.label) ? null : [
                      cssBlank(t("Clear selection")),
                      testId('clear-selection'),
                    ];
                  }
                }
              ),
              dom.on('click', () => {
                // When the menu is opened or closed, refresh the options.
                refreshTrigger.set(!refreshTrigger.get());
              })
            ),
            testId('mapping-for-' + this._column.name),
            testId('enabled'),
          ),
        ]),
        dom.maybe(isDisabled, () => [
          cssRow(
            cssDisabledSelect(
              Observable.create(this, null),
              [], {
                disabled: true,
                defaultLabel: t("No {{columnType}} columns in table.", {"columnType": this._column.typeDesc})
              }
            ),
            hoverTooltip(t("No {{columnType}} columns in table.", {"columnType": this._column.typeDesc})),
            testId('mapping-for-' + this._column.name),
            testId('disabled'),
          ),
        ]),
    ];
  }
}

class ColumnListPicker extends Disposable {
  constructor(
    private _value: Observable<number|number[]|null>,
    private _column: ColumnToMapImpl,
    private _section: ViewSectionRec) {
    super();
  }
  public buildDom() {
    return dom.domComputed((use) => {
      return [
        cssLabel(this._column.title,
          cssLabel.cls("-required", !this._column.optional),
          testId('label-for-' + this._column.name),
        ),
        this._buildDraggableList(use),
        this._buildAddColumn()
      ];
    });
  }
  private _buildAddColumn() {

    const owner = MultiHolder.create(null);

    const notMapped = Computed.create(owner, use => {
      const value = use(this._value) || [];
      const mapped = !Array.isArray(value) ? [] : value;
      return this._section.columns().filter(col => !mapped.includes(use(col.id)));
    });

    const typedColumns = Computed.create(owner, use => {
      return use(notMapped).filter(this._typeFilter(use));
    });

    return [
      cssRow(
        dom.autoDispose(owner),
        cssAddMapping(
          cssAddIcon('Plus'), t("Add") + ' ' + this._column.title,
          dom.cls('disabled', use => use(notMapped).length === 0),
          testId('disabled', use => use(notMapped).length === 0),
          menu(() => {
            const wrongTypeCount = notMapped.get().length - typedColumns.get().length;
            return [
              ...typedColumns.get()
              .map((col) => menuItem(
                () => this._addColumn(col),
                col.label.peek(),
              )),
              wrongTypeCount > 0 ? menuText(
                t("{{wrongTypeCount}} non-{{columnType}} columns are not shown", {
                  wrongTypeCount,
                  columnType: this._column.type.toLowerCase(),
                  count: wrongTypeCount
                }),
                testId('map-message-' + this._column.name)
              ) : null
            ];
          }),
          testId('add-column-for-' + this._column.name),
        )
      ),
    ];
  }

  // Helper method for filtering columns that can be picked by the widget.
  private _typeFilter = (use = unwrap) => (col: ColumnRec|null) =>
    !col ? false : this._column.canByMapped(use(col.pureType));

  private _buildDraggableList(use: UseCBOwner) {
    return dom.update(kf.draggableList(
      this._readItems(use),
      this._renderItem.bind(this, use),
      {
        itemClass: cssDragRow.className,
        reorder: this._reorder.bind(this),
        receive: this._addColumn.bind(this),
        drag_indicator: cssDragger,
      }
    ), testId('map-list-for-' + this._column.name));
  }

  private _readItems(use: UseCBOwner): ColumnRec[] {
    let selectedRefs = (use(this._value) || []) as number[];
    // Ignore if configuration was changed from what it was saved.
    if (!Array.isArray(selectedRefs)) {
      selectedRefs = [];
    }
    // Filter columns by type - when column type has changed since mapping.
    const columns = use(this._section.columns).filter(this._typeFilter(use));
    const columnMap = new Map(columns.map(c => [c.id.peek(), c]));
    // Remove any columns that are no longer there.
    return selectedRefs.map(s => columnMap.get(s)!).filter(c => Boolean(c));
  }

  private _renderItem(use: UseCBOwner, field: ColumnRec): any {
    return cssFieldEntry(
      cssFieldLabel(
        dom.text(field.label),
        testId('ref-select-label'),
      ),
      cssRemoveIcon(
        'Remove',
        dom.on('click', () => this._remove(field)),
        testId('ref-select-remove'),
      ),
    );
  }

  // Helper method that for accessing mapped columns. Can be used to set and retrieve the value.
  private _list(value: number[]): void
  private _list(): number[]
  private _list(value?: number[]) {
    if (value) {
      this._value.set(value);
    } else {
      let current = (this._value.get() || []) as number[];
      // Ignore if the saved value is not a number list.
      if (!Array.isArray(current)) {
        current = [];
      }
      return current;
    }
  }

  private _reorder(column: ColumnRec, nextColumn: ColumnRec|null): any {
    const id = column.id.peek();
    const nextId = nextColumn?.id.peek();
    const currentList = this._list();
    const indexOfId = currentList.indexOf(id);
    // Remove element from the list.
    currentList.splice(indexOfId, 1);
    const indexOfNext = nextId ? currentList.indexOf(nextId) : currentList.length;
    // Insert before next element or at the end.
    currentList.splice(indexOfNext, 0, id);
    this._list(currentList);
  }
  private _remove(column: ColumnRec): any {
    const current = this._list();
    this._value.set(current.filter(c => c != column.id.peek()));
  }
  private _addColumn(col: ColumnRec): any {
    // Helper to find column model.
    const model = (id: number) => this._section.columns().find(c => c.id.peek() === id) || null;
    // Get the list of currently mapped columns.
    let current = this._list();
    // Add new column.
    current.push(col.id.peek());
    // Remove those that don't exists anymore.
    current = current.filter(c => model(c));
    // And those with wrong type.
    current = current.filter(c => this._typeFilter()(model(c)));
    this._value.set(current);
  }
}

class CustomSectionConfigurationConfig extends Disposable{
  // Does widget has custom configuration.
  private readonly _hasConfiguration: Computed<boolean>;
  constructor(private _section: ViewSectionRec, private _gristDoc: GristDoc) {
    super();
    this._hasConfiguration = Computed.create(this, use => use(_section.hasCustomOptions));
  }
  public buildDom() {
    // Show prompt, when desired access level is different from actual one.
    return dom(
      'div',
      dom.maybe(this._hasConfiguration, () =>
        cssSection(
          textButton(
            t("Open configuration"),
            dom.on('click', () => this._openConfiguration()),
            testId('open-configuration')
          )
        )
      ),
      dom.maybeOwned(use => use(this._section.columnsToMap), (owner, columns) => {
        const createObs = (column: ColumnToMapImpl) => {
          const obs = Computed.create(owner, use => {
            const savedDefinition = use(this._section.customDef.columnsMapping) || {};
            return savedDefinition[column.name];
          });
          obs.onWrite(async (value) => {
            const savedDefinition = this._section.customDef.columnsMapping.peek() || {};
            savedDefinition[column.name] = value;
            await this._section.customDef.columnsMapping.setAndSave(savedDefinition);
          });
          return obs;
        };
        // Create observables for all columns to pick.
        const mappings = columns.map(c => new ColumnToMapImpl(c)).map((column) => ({
          value: createObs(column),
          column
        }));
        return dom('div',
          this._attachColumnMappingTip(this._section.customDef.url()),
          ...mappings.map(m => m.column.allowMultiple
            ? dom.create(ColumnListPicker, m.value, m.column, this._section)
            : dom.create(ColumnPicker, m.value, m.column, this._section)),
        );
      })
    );
  }
  private _openConfiguration(): void {
    allCommands.openWidgetConfiguration.run();
  }

  private _attachColumnMappingTip(widgetUrl: string | null) {
    switch (widgetUrl) {
      // TODO: come up with a way to attach tips without hardcoding widget URLs.
      case 'https://gristlabs.github.io/grist-widget/calendar/index.html': {
        return this._gristDoc.behavioralPromptsManager.attachPopup('calendarConfig', {
          popupOptions: {placement: 'left-start'},
        });
      }
      default: {
        return null;
      }
    }
  }
}

export class CustomSectionConfig extends Disposable {

  protected _customSectionConfigurationConfig: CustomSectionConfigurationConfig;
  // Holds all available widget definitions.
  private _widgets: Observable<ICustomWidget[]|null>;
  // Holds selected option (either custom string or a widgetId).
  private readonly _selectedId: Computed<string | null>;
  // Holds custom widget URL.
  private readonly _url: Computed<string>;
  // Enable or disable widget repository.
  private readonly _canSelect: boolean = true;
  // When widget is changed, it sets its desired access level. We will prompt
  // user to approve or reject it.
  private readonly _desiredAccess: Observable<AccessLevel|null>;
  // Current access level (stored inside a section).
  private readonly _currentAccess: Computed<AccessLevel>;




  constructor(protected _section: ViewSectionRec, private _gristDoc: GristDoc) {
    super();
    this._customSectionConfigurationConfig = new CustomSectionConfigurationConfig(_section, _gristDoc);

    // Test if we can offer widget list.
    const gristConfig: GristLoadConfig = (window as any).gristConfig || {};
    this._canSelect = gristConfig.enableWidgetRepository ?? true;

    // Array of available widgets - will be updated asynchronously.
    this._widgets = _gristDoc.app.topAppModel.customWidgets;
    this._getWidgets().catch(reportError);
    // Request for rest of the widgets.

    // Selected value from the dropdown (contains widgetId or "custom" string for Custom URL)
    this._selectedId = Computed.create(this, use => {
      // widgetId could be stored in one of two places, depending on
      // age of document.
      const widgetId = use(_section.customDef.widgetId) ||
          use(_section.customDef.widgetDef)?.widgetId;
      const pluginId = use(_section.customDef.pluginId);
      if (widgetId) {
        // selection id is "pluginId:widgetId"
        return (pluginId || '') + ':' + widgetId;
      }
      return CUSTOM_ID;
    });
    this._selectedId.onWrite(async value => {
      if (value === CUSTOM_ID) {
        // Select Custom URL
        bundleChanges(() => {
          // Reset whether widget should render after `grist.ready()`.
          _section.customDef.renderAfterReady(false);
          // Clear url.
          _section.customDef.url(null);
          // Clear widgetId
          _section.customDef.widgetId(null);
          _section.customDef.widgetDef(null);
          // Clear pluginId
          _section.customDef.pluginId('');
          // Reset access level to none.
          _section.customDef.access(AccessLevel.none);
          // Clear all saved options.
          _section.customDef.widgetOptions(null);
          // Reset custom configuration flag.
          _section.hasCustomOptions(false);
          // Clear column mappings.
          _section.customDef.columnsMapping(null);
          _section.columnsToMap(null);
          this._desiredAccess.set(AccessLevel.none);
        });
        await _section.saveCustomDef();
      } else {
        const [pluginId, widgetId] = value?.split(':') || [];
        // Select Widget
        const selectedWidget = matchWidget(this._widgets.get()||[], {
          widgetId,
          pluginId,
        });
        if (!selectedWidget) {
          // should not happen
          throw new Error('Error accessing widget from the list');
        }
        // If user selected the same one, do nothing.
        if (_section.customDef.widgetId.peek() === widgetId &&
            _section.customDef.pluginId.peek() === pluginId) {
          return;
        }
        bundleChanges(() => {
          // Reset whether widget should render after `grist.ready()`.
          _section.customDef.renderAfterReady(selectedWidget.renderAfterReady ?? false);
          // Clear access level
          _section.customDef.access(AccessLevel.none);
          // When widget wants some access, set desired access level.
          this._desiredAccess.set(selectedWidget.accessLevel || AccessLevel.none);

          // Keep a record of the original widget definition.
          // Don't rely on this much, since the document could
          // have moved installation since, and widgets could be
          // served from elsewhere.
          _section.customDef.widgetDef(selectedWidget);

          // Update widgetId.
          _section.customDef.widgetId(selectedWidget.widgetId);
          // Update pluginId.
          _section.customDef.pluginId(selectedWidget.source?.pluginId || '');
          // Update widget URL. Leave blank when widgetId is set.
          _section.customDef.url(null);
          // Clear options.
          _section.customDef.widgetOptions(null);
          // Clear has custom configuration.
          _section.hasCustomOptions(false);
          // Clear column mappings.
          _section.customDef.columnsMapping(null);
          _section.columnsToMap(null);
        });
        await _section.saveCustomDef();
      }
    });

    // Url for the widget, taken either from widget definition, or provided by hand for Custom URL.
    // For custom widget, we will store url also in section definition.
    this._url = Computed.create(this, use => use(_section.customDef.url) || '');
    this._url.onWrite(async newUrl => {
      bundleChanges(() => {
        _section.customDef.renderAfterReady(false);
        if (newUrl) {
          // When a URL is set explicitly, make sure widgetId/pluginId/widgetDef
          // is empty.
          _section.customDef.widgetId(null);
          _section.customDef.pluginId('');
          _section.customDef.widgetDef(null);
        }
        _section.customDef.url(newUrl);
      });
      await _section.saveCustomDef();
    });

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
    this.autoDispose(_section.id.subscribe(() => this._reject()));
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
      ...(use(this._widgets) || [])
           .filter(w => w?.published !== false)
           .map(w => ({
             label: w.source?.name ? `${w.name} (${w.source.name})` : w.name,
             value: (w.source?.pluginId || '') + ':' + w.widgetId,
           })),
    ]);
    function buildPrompt(level: AccessLevel|null) {
      if (!level) {
        return null;
      }
      switch(level) {
        case AccessLevel.none: return cssConfirmLine(t("Widget does not require any permissions."));
        case AccessLevel.read_table:
          return cssConfirmLine(t("Widget needs to {{read}} the current table.", {read: dom("b", "read")}));
        case AccessLevel.full:
          return cssConfirmLine(t("Widget needs {{fullAccess}} to this document.", {
            fullAccess: dom("b", "full access")
          }));
        default: throw new Error(`Unsupported ${level} access level`);
      }
    }
    // Options for access level.
    const levels: IOptionFull<string>[] = [
      {label: t("No document access"), value: AccessLevel.none},
      {label: t("Read selected table"), value: AccessLevel.read_table},
      {label: t("Full document access"), value: AccessLevel.full},
    ];
    return dom(
      'div',
      dom.autoDispose(holder),
      this.shouldRenderWidgetSelector() &&
      this._canSelect
        ? cssRow(
          select(this._selectedId, options, {
            defaultLabel: t("Select Custom Widget"),
            menuCssClass: cssMenu.className,
          }),
          testId('select')
        )
        : null,
      dom.maybe((use) => use(isCustom) && this.shouldRenderWidgetSelector(), () => [
        cssRow(
          cssTextInput(
            this._url,
            async value => this._url.set(value),
            dom.attr('placeholder', t("Enter Custom URL")),
            testId('url')
          ),
          this._gristDoc.behavioralPromptsManager.attachPopup('customURL', {
            popupOptions: {
              placement: 'left-start',
            },
            isDisabled: () => {
              // Disable tip if a custom widget is already selected.
              return Boolean(this._selectedId.get() && !(isCustom.get() && this._url.get().trim() === ''));
            },
          })
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
      cssSection(
        cssLink(
          dom.attr('href', 'https://support.getgrist.com/widget-custom'),
          dom.attr('target', '_blank'),
          t("Learn more about custom widgets")
        )
      ),
      cssSeparator(),
      this._customSectionConfigurationConfig.buildDom(),
    );
  }

  protected shouldRenderWidgetSelector(): boolean {
    return true;
  }

  protected async _getWidgets() {
    await this._gristDoc.app.topAppModel.getWidgets();
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
  --icon-color: ${theme.iconError}
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
    border-bottom: 1px solid ${theme.menuBorder};
  }
`);

const cssAddIcon = styled(icon, `
  margin-right: 4px;
`);

const cssRemoveIcon = styled(icon, `
  display: none;
  cursor: pointer;
  flex: none;
  margin-left: 8px;
  .${cssFieldEntry.className}:hover & {
    display: block;
  }
`);

// Additional text in label (greyed out)
const cssSubLabel = styled('span', `
  text-transform: none;
  font-size: ${vars.xsmallFontSize};
  color: ${theme.lightText};
`);

const cssAddMapping = styled('div', `
  display: flex;
  cursor: pointer;
  color: ${theme.controlFg};
  --icon-color: ${theme.controlFg};

  &:not(:first-child) {
    margin-top: 8px;
  }
  &:hover, &:focus, &:active {
    color: ${theme.controlHoverFg};
    --icon-color: ${theme.controlHoverFg};
  }
  &.disabled {
    color: ${theme.lightText};
    --icon-color: ${theme.lightText};
    pointer-events: none;
  }
`);

const cssTextInput = styled(textInput, `
  flex: 1 0 auto;

  color: ${theme.inputFg};
  background-color: ${theme.inputBg};

  &:disabled {
    color: ${theme.inputDisabledFg};
    background-color: ${theme.inputDisabledBg};
    pointer-events: none;
  }

  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }
`);

const cssDisabledSelect = styled(select, `
  opacity: unset !important;
`);

const cssBlank = styled(cssOptionLabel, `
  --grist-option-label-color: ${theme.lightText};
`);
