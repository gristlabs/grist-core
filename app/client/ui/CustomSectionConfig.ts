import {allCommands} from 'app/client/components/commands';
import {GristDoc} from 'app/client/components/GristDoc';
import {makeTestId} from 'app/client/lib/domUtils';
import {FocusLayer} from 'app/client/lib/FocusLayer';
import * as kf from 'app/client/lib/koForm';
import {makeT} from 'app/client/lib/localization';
import {localStorageBoolObs} from 'app/client/lib/localStorageObs';
import {ColumnToMapImpl} from 'app/client/models/ColumnToMap';
import {ColumnRec, ViewSectionRec} from 'app/client/models/DocModel';
import {
  cssDeveloperLink,
  cssWidgetMetadata,
  cssWidgetMetadataName,
  cssWidgetMetadataRow,
  cssWidgetMetadataValue,
  CUSTOM_URL_WIDGET_ID,
  getWidgetName,
  showCustomWidgetGallery,
} from 'app/client/ui/CustomWidgetGallery';
import {cssHelp, cssLabel, cssRow, cssSeparator} from 'app/client/ui/RightPanelStyles';
import {hoverTooltip} from 'app/client/ui/tooltips';
import {cssDragRow, cssFieldEntry, cssFieldLabel} from 'app/client/ui/VisibleFieldsConfig';
import {basicButton, primaryButton, textButton} from 'app/client/ui2018/buttons';
import {theme, vars} from 'app/client/ui2018/cssVars';
import {cssDragger} from 'app/client/ui2018/draggableList';
import {textInput} from 'app/client/ui2018/editableLabel';
import {icon} from 'app/client/ui2018/icons';
import {cssOptionLabel, IOption, IOptionFull, menu, menuItem, menuText, select} from 'app/client/ui2018/menus';
import {AccessLevel, ICustomWidget, isSatisfied, matchWidget} from 'app/common/CustomWidget';
import {not, unwrap} from 'app/common/gutil';
import {
  bundleChanges,
  Computed,
  Disposable,
  dom,
  DomContents,
  fromKo,
  MultiHolder,
  Observable,
  styled,
  UseCBOwner
} from 'grainjs';

const t = makeT('CustomSectionConfig');

const testId = makeTestId('test-config-widget-');

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
  private readonly _hasConfiguration = Computed.create(this, use =>
    Boolean(use(this._section.hasCustomOptions) || use(this._section.columnsToMap)));

  constructor(private _section: ViewSectionRec, private _gristDoc: GristDoc) {
    super();
  }

  public buildDom() {
    return dom.maybe(this._hasConfiguration, () => [
      cssSeparator(),
      dom.maybe(this._section.hasCustomOptions, () =>
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
    ]);
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

/**
 * Custom widget configuration.
 *
 * Allows picking a custom widget from a gallery of available widgets
 * (fetched from the `/widgets` endpoint), which includes the Custom URL
 * widget.
 *
 * When a custom widget has a desired `accessLevel` set to a value other
 * than `"None"`, a prompt will be shown to grant the requested access level
 * to the widget.
 *
 * When `gristConfig.enableWidgetRepository` is set to false, only the
 * Custom URL widget will be available to select in the gallery.
 */
export class CustomSectionConfig extends Disposable {
  protected _customSectionConfigurationConfig = new CustomSectionConfigurationConfig(
    this._section, this._gristDoc);

  private readonly _widgetId = Computed.create(this, use => {
    // Stored in one of two places, depending on age of document.
    const widgetId = use(this._section.customDef.widgetId) ||
      use(this._section.customDef.widgetDef)?.widgetId;
    if (widgetId) {
      const pluginId = use(this._section.customDef.pluginId);
      return (pluginId || '') + ':' + widgetId;
    } else {
      return CUSTOM_URL_WIDGET_ID;
    }
  });

  private readonly _isCustomUrlWidget = Computed.create(this, this._widgetId, (_use, widgetId) => {
    return widgetId === CUSTOM_URL_WIDGET_ID;
  });

  private readonly _currentAccess = Computed.create(this, use =>
    (use(this._section.customDef.access) as AccessLevel) || AccessLevel.none)
    .onWrite(async newAccess => {
      await this._section.customDef.access.setAndSave(newAccess);
    });

  private readonly _desiredAccess = fromKo(this._section.desiredAccessLevel);

  private readonly _url = Computed.create(this, use => use(this._section.customDef.url) || '')
    .onWrite(async newUrl => {
      bundleChanges(() => {
        this._section.customDef.renderAfterReady(false);
        if (newUrl) {
          this._section.customDef.widgetId(null);
          this._section.customDef.pluginId('');
          this._section.customDef.widgetDef(null);
        }
        this._section.customDef.url(newUrl);
      });
      await this._section.saveCustomDef();
    });

  private readonly _requiresAccess = Computed.create(this, use => {
    const [currentAccess, desiredAccess] = [use(this._currentAccess), use(this._desiredAccess)];
    return desiredAccess && !isSatisfied(currentAccess, desiredAccess);
  });

  private readonly _widgetDetailsExpanded: Observable<boolean>;

  private readonly _widgets: Observable<ICustomWidget[] | null> = Observable.create(this, null);

  private readonly _selectedWidget = Computed.create(this, use => {
    const id = use(this._widgetId);
    if (id === CUSTOM_URL_WIDGET_ID) { return null; }

    const widgets = use(this._widgets);
    if (!widgets) { return null; }

    const [pluginId, widgetId] = id.split(':');
    return matchWidget(widgets, {pluginId, widgetId}) ?? null;
  });

  constructor(protected _section: ViewSectionRec, private _gristDoc: GristDoc) {
    super();

    const userId = this._gristDoc.appModel.currentUser?.id ?? 0;
    this._widgetDetailsExpanded = this.autoDispose(localStorageBoolObs(
      `u:${userId};customWidgetDetailsExpanded`,
      true
    ));

    this._getWidgets()
      .then(widgets => {
        if (this.isDisposed()) { return; }

        this._widgets.set(widgets);
      })
      .catch(reportError);

    // Clear intermediate state when section changes.
    this.autoDispose(_section.id.subscribe(() => this._dismissAccessPrompt()));
  }

  public buildDom(): DomContents {
    return dom('div',
      this._buildWidgetSelector(),
      this._buildAccessLevelConfig(),
      this._customSectionConfigurationConfig.buildDom(),
    );
  }

  protected shouldRenderWidgetSelector(): boolean {
    return true;
  }

  protected async _getWidgets() {
    return await this._gristDoc.app.topAppModel.getWidgets();
  }

  private _buildWidgetSelector() {
    if (!this.shouldRenderWidgetSelector()) { return null; }

    return [
      cssRow(
        cssWidgetSelector(
          this._buildShowWidgetDetailsButton(),
          this._buildWidgetName(),
        ),
      ),
      this._maybeBuildWidgetDetails(),
    ];
  }

  private _buildShowWidgetDetailsButton() {
    return cssShowWidgetDetails(
      cssShowWidgetDetailsIcon(
        'Dropdown',
        cssShowWidgetDetailsIcon.cls('-collapsed', use => !use(this._widgetDetailsExpanded)),
        testId('toggle-custom-widget-details'),
        testId(use => !use(this._widgetDetailsExpanded)
          ? 'show-custom-widget-details'
          : 'hide-custom-widget-details'
        ),
      ),
      cssWidgetLabel(t('Widget')),
      dom.on('click', () => {
        this._widgetDetailsExpanded.set(!this._widgetDetailsExpanded.get());
      }),
    );
  }

  private _buildWidgetName() {
    return cssWidgetName(
      dom.text(use => {
        if (use(this._isCustomUrlWidget)) {
          return t('Custom URL');
        } else {
          const widget = use(this._selectedWidget) ?? use(this._section.customDef.widgetDef);
          return widget ? getWidgetName(widget) : use(this._widgetId);
        }
      }),
      dom.on('click', () => showCustomWidgetGallery(this._gristDoc, {
        sectionRef: this._section.id(),
      })),
      testId('open-custom-widget-gallery'),
    );
  }

  private _maybeBuildWidgetDetails() {
    return dom.maybe(this._widgetDetailsExpanded, () =>
      dom.domComputed(this._selectedWidget, (widget) =>
        cssRow(
          this._buildWidgetDetails(widget),
        )
      )
    );
  }

  private _buildWidgetDetails(widget: ICustomWidget | null) {
    return dom.domComputed(this._isCustomUrlWidget, (isCustomUrlWidget) => {
      if (isCustomUrlWidget) {
        return cssCustomUrlDetails(
          cssTextInput(
            this._url,
            async value => this._url.set(value),
            dom.show(this._isCustomUrlWidget),
            {placeholder: t('Enter Custom URL')},
          ),
        );
      } else if (!widget?.description && !widget?.authors?.[0] && !widget?.lastUpdatedAt) {
        return cssDetailsMessage(t('Missing description and author information.'));
      } else {
        return cssWidgetDetails(
          !widget?.description ? null : cssWidgetDescription(
            widget.description,
            testId('custom-widget-description'),
          ),
          cssWidgetMetadata(
            !widget?.authors?.[0] ? null : cssWidgetMetadataRow(
              cssWidgetMetadataName(t('Developer:')),
              cssWidgetMetadataValue(
                widget.authors[0].url
                  ? cssDeveloperLink(
                    widget.authors[0].name,
                    {href: widget.authors[0].url, target: '_blank'},
                    testId('custom-widget-developer'),
                  )
                  : dom('span',
                    widget.authors[0].name,
                    testId('custom-widget-developer'),
                  ),
                testId('custom-widget-developer'),
              ),
            ),
            !widget?.lastUpdatedAt ? null : cssWidgetMetadataRow(
              cssWidgetMetadataName(t('Last updated:')),
              cssWidgetMetadataValue(
                new Date(widget.lastUpdatedAt).toLocaleDateString('default', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                }),
                testId('custom-widget-last-updated'),
              ),
            ),
          )
        );
      }
    });
  }

  private _buildAccessLevelConfig() {
    return [
      cssSeparator({style: 'margin-top: 0px'}),
      cssLabel(t('ACCESS LEVEL')),
      cssRow(select(this._currentAccess, getAccessLevels()), testId('access')),
      dom.maybeOwned(this._requiresAccess, (owner) => kf.prompt(
        (elem: HTMLDivElement) => { FocusLayer.create(owner, {defaultFocusElem: elem, pauseMousetrap: true}); },
        cssColumns(
          cssWarningWrapper(icon('Lock')),
          dom('div',
            cssConfirmRow(
              dom.domComputed(this._desiredAccess, (level) => this._buildAccessLevelPrompt(level))
            ),
            cssConfirmRow(
              primaryButton(
                t('Accept'),
                testId('access-accept'),
                dom.on('click', () => this._grantDesiredAccess())
              ),
              basicButton(
                t('Reject'),
                testId('access-reject'),
                dom.on('click', () => this._dismissAccessPrompt())
              )
            )
          )
        ),
        dom.onKeyDown({
          Enter: () => this._grantDesiredAccess(),
          Escape:() => this._dismissAccessPrompt(),
        }),
      )),
    ];
  }

  private _buildAccessLevelPrompt(level: AccessLevel | null) {
    if (!level) { return null; }

    switch (level) {
      case AccessLevel.none: {
        return cssConfirmLine(t("Widget does not require any permissions."));
      }
      case AccessLevel.read_table: {
        return cssConfirmLine(t("Widget needs to {{read}} the current table.", {read: dom("b", "read")}));
      }
      case AccessLevel.full: {
        return cssConfirmLine(t("Widget needs {{fullAccess}} to this document.", {
          fullAccess: dom("b", "full access")
        }));
      }
    }
  }

  private _grantDesiredAccess() {
    if (this._desiredAccess.get()) {
      this._currentAccess.set(this._desiredAccess.get()!);
    }
    this._dismissAccessPrompt();
  }

  private _dismissAccessPrompt() {
    this._desiredAccess.set(null);
  }
}

function getAccessLevels(): IOptionFull<string>[] {
  return [
    {label: t("No document access"), value: AccessLevel.none},
    {label: t("Read selected table"), value: AccessLevel.read_table},
    {label: t("Full document access"), value: AccessLevel.full},
  ];
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
  color: ${theme.inputFg};
  background-color: ${theme.inputBg};

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

const cssWidgetSelector = styled('div', `
  width: 100%;
  display: flex;
  justify-content: space-between;
  column-gap: 16px;
`);

const cssShowWidgetDetails = styled('div', `
  display: flex;
  align-items: center;
  column-gap: 4px;
  cursor: pointer;
`);

const cssShowWidgetDetailsIcon = styled(icon, `
  --icon-color: ${theme.lightText};
  flex-shrink: 0;

  &-collapsed {
    transform: rotate(-90deg);
  }
`);

const cssWidgetLabel = styled('div', `
  text-transform: uppercase;
  font-size: ${vars.xsmallFontSize};
`);

const cssWidgetName = styled('div', `
  color: ${theme.rightPanelCustomWidgetButtonFg};
  background-color: ${theme.rightPanelCustomWidgetButtonBg};
  height: 24px;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`);

const cssWidgetDetails = styled('div', `
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  margin-bottom: 8px;
`);

const cssCustomUrlDetails = styled(cssWidgetDetails, `
  flex: 1 0 auto;
`);

const cssDetailsMessage = styled('div', `
  color: ${theme.lightText};
`);

const cssWidgetDescription = styled('div', `
  margin-bottom: 16px;
`);
