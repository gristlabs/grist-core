/**
 * Builds the structure of the right-side panel containing configuration and assorted tools.
 * It includes the regular tabs, to configure the Page (including several sub-tabs), and Field;
 * and allows other tools, such as Activity Feed, to be rendered temporarily in its place.
 *
 * A single RightPanel object is created in AppUI for a document page, and attached to PagePanels.
 * GristDoc registers callbacks with it to create various standard tabs. These are created as
 * needed, and destroyed when hidden.
 *
 * In addition, tools such as "Activity Feed" may use openTool() to replace the panel header and
 * content. The user may dismiss this panel.
 *
 * All methods above return an object which may  be disposed to close and dispose that specific
 * tab from the outside (e.g. when GristDoc is disposed).
 */
import * as commands from 'app/client/components/commands';
import {FieldModel} from 'app/client/components/Forms/Field';
import {FormView} from 'app/client/components/Forms/FormView';
import {MappedFieldsConfig} from 'app/client/components/Forms/MappedFieldsConfig';
import {GristDoc, IExtraTool, TabContent} from 'app/client/components/GristDoc';
import {EmptyFilterState} from "app/client/components/LinkingState";
import {RefSelect} from 'app/client/components/RefSelect';
import ViewConfigTab from 'app/client/components/ViewConfigTab';
import {domAsync} from 'app/client/lib/domAsync';
import * as imports from 'app/client/lib/imports';
import {makeT} from 'app/client/lib/localization';
import {createSessionObs, isBoolean, SessionObs} from 'app/client/lib/sessionObs';
import {logTelemetryEvent} from 'app/client/lib/telemetry';
import {reportError} from 'app/client/models/AppModel';
import {ColumnRec, ViewSectionRec} from 'app/client/models/DocModel';
import {CustomSectionConfig} from 'app/client/ui/CustomSectionConfig';
import {showCustomWidgetGallery} from 'app/client/ui/CustomWidgetGallery';
import {buildDescriptionConfig} from 'app/client/ui/DescriptionConfig';
import {BuildEditorOptions} from 'app/client/ui/FieldConfig';
import {GridOptions} from 'app/client/ui/GridOptions';
import {textarea} from 'app/client/ui/inputs';
import {attachPageWidgetPicker, IPageWidget, toPageWidget} from 'app/client/ui/PageWidgetPicker';
import {PredefinedCustomSectionConfig} from "app/client/ui/PredefinedCustomSectionConfig";
import {cssConfigContainer, cssGroupLabel, cssLabel, cssSeparator} from 'app/client/ui/RightPanelStyles';
import {buildConfigContainer, getFieldType} from 'app/client/ui/RightPanelUtils';
import {rowHeightConfigTable} from 'app/client/ui/RowHeightConfig';
import {linkId, NoLink, selectBy} from 'app/client/ui/selectBy';
import {VisibleFieldsConfig} from 'app/client/ui/VisibleFieldsConfig';
import {getTelemetryWidgetTypeFromVS, getWidgetTypes} from "app/client/ui/widgetTypesMap";
import {ariaTabs} from 'app/client/ui2018/ariaTabs';
import {basicButton, primaryButton} from 'app/client/ui2018/buttons';
import {buttonSelect} from 'app/client/ui2018/buttonSelect';
import {cssLabel as cssCheckboxLabel, labeledSquareCheckbox} from 'app/client/ui2018/checkbox';
import {testId, theme, vars} from 'app/client/ui2018/cssVars';
import {textInput} from 'app/client/ui2018/editableLabel';
import {icon} from 'app/client/ui2018/icons';
import {select} from 'app/client/ui2018/menus';
import {unstyledButton, unstyledUl} from 'app/client/ui2018/unstyled';
import {FieldBuilder} from 'app/client/widgets/FieldBuilder';
import {components} from 'app/common/ThemePrefs';
import {isFullReferencingType} from "app/common/gristTypes";
import {not} from 'app/common/gutil';
import {StringUnion} from 'app/common/StringUnion';
import {IWidgetType} from 'app/common/widgetTypes';
import {
  bundleChanges,
  Computed,
  Disposable,
  dom,
  domComputed,
  DomContents,
  DomElementArg,
  DomElementMethod,
  fromKo,
  IDomComponent,
  MultiHolder,
  Observable,
  styled,
  subscribe,
  toKo
} from 'grainjs';
import * as ko from 'knockout';

// some unicode characters
const BLACK_CIRCLE = '\u2022';
const ELEMENTOF = '\u2208'; //220A for small elementof

const t = makeT('RightPanel');

// Represents a top tab of the right side-pane.
const TopTab = StringUnion("pageWidget", "field");

// Represents a subtab of pageWidget in the right side-pane.
const PageSubTab = StringUnion("widget", "sortAndFilter", "data", "submission");

export class RightPanel extends Disposable {
  public readonly header: DomContents;
  public readonly content: DomContents;

  // If the panel is showing a tool, such as Action Log, instead of the usual section/field
  // configuration, this will be set to the tool's header and content.
  private _extraTool: Observable<IExtraTool|null>;

  // Which of the two standard top tabs (page widget or field) is selected, or was last selected.
  private _topTab = createSessionObs(this, "rightTopTab", "pageWidget", TopTab.guard);
  private _topTabComponents: ReturnType<typeof ariaTabs>;

  // Which subtab is open for configuring page widget.
  private _subTab = createSessionObs(this, "rightPageSubTab", "widget", PageSubTab.guard);
  private _subTabComponents: ReturnType<typeof ariaTabs>;

  // Which type of page widget is active, e.g. "record" or "chart". This affects the names and
  // icons in the top tab.
  private _pageWidgetType = Computed.create<IWidgetType|null>(this, (use) => {
    const section: ViewSectionRec = use(this._gristDoc.viewModel.activeSection);
    return (use(section.parentKey) || null) as IWidgetType;
  });

  private _isForm = Computed.create(this, (use) => {
    return use(this._pageWidgetType) === 'form';
  });

  private _hasActiveWidget = Computed.create(this, (use) => Boolean(use(this._pageWidgetType)));

  // Returns the active section if it's valid, null otherwise.
  private _validSection = Computed.create(this, (use) => {
    const sec = use(this._gristDoc.viewModel.activeSection);
    return sec.getRowId() ? sec : null;
  });

  // Which subtab is open for configuring page widget.
  private _advLinkInfoCollapsed = createSessionObs(this, "rightPageAdvancedLinkInfoCollapsed",
                                                   true, isBoolean);

  constructor(private _gristDoc: GristDoc, private _isOpen: Observable<boolean>) {
    super();
    this._extraTool = _gristDoc.rightPanelTool;
    this.autoDispose(subscribe(this._extraTool, (_use, tool) => tool && _isOpen.set(true)));
    this.header = this._buildHeaderDom();
    this.content = this._buildContentDom();

    this.autoDispose(commands.createGroup({
      fieldTabOpen: () => this._openFieldTab(),
      viewTabOpen: () => this._openViewTab(),
      viewTabFocus: () => this._viewTabFocus(),
      sortFilterTabOpen: () => this._openSortFilter(),
      dataSelectionTabOpen: () => this._openDataSelection(),
    }, this, true));

    // When a page widget is changed, subType might not be valid anymore, so reset it.
    // TODO: refactor sub tabs and navigation using order of the tab.
    this.autoDispose(subscribe((use) => {
      if (!use(this._isForm) && use(this._subTab) === 'submission') {
        setImmediate(() => !this._subTab.isDisposed() && this._subTab.set('sortAndFilter'));
      } else if (use(this._isForm) && use(this._subTab) === 'sortAndFilter') {
        setImmediate(() => !this._subTab.isDisposed() && this._subTab.set('submission'));
      }
    }));

    this._topTabComponents = ariaTabs('rightTopbar', this._topTab);
    this._subTabComponents = ariaTabs('rightSubbar', this._subTab);
  }

  private _openFieldTab() {
    this._open('field');
  }

  private _openViewTab() {
    this._open('pageWidget', 'widget');
  }

  private _viewTabFocus() {
    // If the view tab is already open, focus on the first input.
    this._focus('pageWidget');
  }

  private _openSortFilter() {
    this._open('pageWidget', 'sortAndFilter');
  }

  private _openDataSelection() {
    this._open('pageWidget', 'data');
  }

  private _open(topTab: typeof TopTab.type, subTab?: typeof PageSubTab.type) {
    bundleChanges(() => {
      this._isOpen.set(true);
      this._topTab.set(topTab);
      if (subTab) {
        this._subTab.set(subTab);
      }
    });
  }

  private _focus(topTab: typeof TopTab.type) {
    bundleChanges(() => {
      if (!this._isOpen.get()) { return; }
      this._isOpen.set(true);
      this._topTab.set(topTab);
    });
  }

  private _buildHeaderDom() {
    return dom.domComputed((use) => {
      if (!use(this._isOpen)) { return null; }
      const tool = use(this._extraTool);
      return tool ? this._buildToolHeader(tool) : this._buildStandardHeader();
    });
  }

  private _buildToolHeader(tool: IExtraTool) {
    return cssTopBarItem(cssTopBarIcon(tool.icon), tool.label,
      cssHoverCircle(cssHoverIcon("CrossBig"),
        dom.on('click', () => this._gristDoc.showTool('none')),
        testId('right-tool-close'),
      ),
      cssTopBarItem.cls('-selected', true)
    );
  }

  private _buildStandardHeader() {
    return dom.maybe(this._pageWidgetType, (type) => {
      const widgetInfo = getWidgetTypes(type);
      const fieldInfo = getFieldType(type);
      return [
        cssTopBarTabList(
          this._topTabComponents.tabList(),
          cssTopBarItem(
            this._topTabComponents.tab('pageWidget'),
            cssTopBarIcon(widgetInfo.icon),
            widgetInfo.getLabel(),
            testId('right-tab-pagewidget')
          ),
          cssTopBarItem(
            this._topTabComponents.tab('field'),
            cssTopBarIcon(fieldInfo.icon),
            fieldInfo.label,
            testId('right-tab-field')
          )
        )
      ];
    });
  }

  private _buildContentDom() {
    return dom.domComputed((use) => {
      if (!use(this._isOpen)) { return null; }
      const tool = use(this._extraTool);
      if (tool) { return tabContentToDom(tool.content); }
      const isForm = use(this._isForm);

      return [
        cssTabPanel(
          this._topTabComponents.tabPanel('pageWidget',
            isForm
              ? [
                dom.create(this._buildPageFormHeader.bind(this)),
                dom.create(() => this._buildPageWidgetContent(isForm)),
              ]
              : use(this._hasActiveWidget)
                ? [
                  dom.create(this._buildPageWidgetHeader.bind(this)),
                  dom.create(() => this._buildPageWidgetContent(isForm)),
                ]
                : null
          ),
          testId('right-tabpanel-pagewidget')
        ),
        cssTabPanel(
          this._topTabComponents.tabPanel('field',
            isForm
              ? dom.create(this._buildQuestionContent.bind(this))
              : dom.create(this._buildFieldContent.bind(this))
          ),
          testId('right-tabpanel-field')
        )
      ];
    });
  }

  private _buildFieldContent(owner: MultiHolder) {
    const fieldBuilder = owner.autoDispose(ko.computed(() => {
      const vsi = this._gristDoc.viewModel.activeSection?.().viewInstance();
      return vsi && vsi.activeFieldBuilder();
    }));

    const selectedColumns = owner.autoDispose(ko.computed(() => {
      const vsi = this._gristDoc.viewModel.activeSection?.().viewInstance();
      if (vsi && vsi.selectedColumns) {
        return vsi.selectedColumns();
      }
      const field = fieldBuilder()?.field;
      return field ? [field] : [];
    }));

    const isMultiSelect = owner.autoDispose(ko.pureComputed(() => {
      const list = selectedColumns();
      return Boolean(list && list.length > 1);
    }));

    owner.autoDispose(selectedColumns.subscribe(cols => {
      if (owner.isDisposed() || this._gristDoc.isDisposed() || this._gristDoc.viewModel.isDisposed()) { return; }
      const section = this._gristDoc.viewModel.activeSection();
      if (!section || section.isDisposed()) { return; }
      section.selectedFields(cols || []);
    }));
    this._gristDoc.viewModel.activeSection()?.selectedFields(selectedColumns.peek() || []);

    const docModel = this._gristDoc.docModel;
    const origColRef = owner.autoDispose(ko.computed(() => fieldBuilder()?.origColumn.origColRef() || 0));
    const origColumn = owner.autoDispose(docModel.columns.createFloatingRowModel(origColRef));
    const isColumnValid = owner.autoDispose(ko.computed(() => Boolean(origColRef())));

    // Builder for the reference display column multiselect.
    const refSelect = RefSelect.create(owner, {docModel, origColumn, fieldBuilder});

    // build cursor position observable
    const cursor = owner.autoDispose(ko.computed(() => {
      const vsi = this._gristDoc.viewModel.activeSection?.().viewInstance();
      return vsi?.cursor.currentPosition() ?? {};
    }));

    return domAsync(imports.loadViewPane().then(ViewPane => {
      const {buildNameConfig, buildFormulaConfig} = ViewPane.FieldConfig;
      return dom.maybe(isColumnValid, () =>
        buildConfigContainer(
          cssSection(
            dom.create(buildNameConfig, origColumn, cursor, isMultiSelect),
          ),
          cssSection(
            dom.create(buildDescriptionConfig, origColumn.description, { cursor, "testPrefix": "column" }),
          ),
          cssSeparator(),
          cssSection(
            dom.create(buildFormulaConfig,
              origColumn, this._gristDoc, this._activateFormulaEditor.bind(this)),
          ),
          cssSeparator(),
          dom.maybe<FieldBuilder|null>(fieldBuilder, builder => [
          cssLabel(t("COLUMN TYPE")),
            cssSection(
              builder.buildSelectTypeDom(),
            ),
            cssSection(
              builder.buildSelectWidgetDom(),
            ),
            cssSection(
              builder.buildConfigDom(),
            ),
            builder.buildColorConfigDom(),
            cssSection(
              builder.buildSettingOptions(),
              dom.maybe(isMultiSelect, () => disabledSection())
            ),
          ]),
          cssSeparator(),
          cssSection(
            dom.maybe(refSelect.isForeignRefCol, () => [
              cssLabel(t('Add referenced columns')),
              cssRow(refSelect.buildDom()),
              cssSeparator()
            ]),
            cssLabel(t("TRANSFORM")),
            dom.maybe<FieldBuilder|null>(fieldBuilder, builder => builder.buildTransformDom()),
            testId('panel-transform'),
          ),
          this._disableIfReadonly(),
        )
      );
    }));
  }

  // Helper to activate the side-pane formula editor over the given HTML element.
  private _activateFormulaEditor(options: BuildEditorOptions) {
    const vsi = this._gristDoc.viewModel.activeSection().viewInstance();
    if (!vsi) { return; }

    const {refElem, editValue, canDetach, onSave, onCancel} = options;
    const editRow = vsi.moveEditRowToCursor();
    return vsi.activeFieldBuilder.peek().openSideFormulaEditor({
      editRow,
      refElem,
      canDetach,
      editValue,
      onSave,
      onCancel,
    });
  }

  private _buildPageWidgetContent(isForm: boolean) {
    const content = (activeSection: ViewSectionRec) => {
      return [
        dom('div',
          this._subTabComponents.tabPanel('widget',
            dom.create(this._buildPageWidgetConfig.bind(this), activeSection)
          ),
          testId('right-subtabpanel-widget')
        ),
        isForm
          ? dom('div',
            this._subTabComponents.tabPanel('submission',
              dom.create(this._buildPageSubmissionConfig.bind(this), activeSection)
            ),
            testId('right-subtabpanel-submission')
          )
          : dom('div',
            this._subTabComponents.tabPanel('sortAndFilter',
              dom.create(this._buildPageSortFilterConfig.bind(this)),
            ),
            cssConfigContainer.cls('-disabled', activeSection.isRecordCard),
            testId('right-subtabpanel-sortAndFilter')
          ),
        dom('div',
          this._subTabComponents.tabPanel('data',
            dom.create(this._buildPageDataConfig.bind(this), activeSection)
          ),
          testId('right-subtabpanel-data')
        ),
      ];
    };
    return dom.maybe(this._validSection, (activeSection) =>
      buildConfigContainer(content(activeSection))
    );
  }

  private _buildPageFormHeader(_owner: MultiHolder) {
    return [
      cssSubTabContainer(
        this._subTabComponents.tabList(),
        cssSubTab(t("Configuration"),
          this._subTabComponents.tab('widget'),
          // the data-text attribute is necessary for a css trick to work (see cssSubTab)
          dom.attr('data-text', t("Configuration")),
          testId('config-widget')),
        cssSubTab(t("Submission"),
          this._subTabComponents.tab('submission'),
          dom.attr('data-text', t("Submission")),
          testId('config-submission')),
        cssSubTab(t("Data"),
          this._subTabComponents.tab('data'),
          dom.attr('data-text', t("Data")),
          testId('config-data')),
      ),
    ];
  }

  private _buildPageWidgetHeader(_owner: MultiHolder) {
    return [
      cssSubTabContainer(
        this._subTabComponents.tabList(),
        cssSubTab(t("Widget"),
          this._subTabComponents.tab('widget'),
          // the data-text attribute is necessary for a css trick to work (see cssSubTab)
          dom.attr('data-text', t("Widget")),
          testId('config-widget')),
        cssSubTab(t("Sort & filter"),
          this._subTabComponents.tab('sortAndFilter'),
          dom.attr('data-text', t("Sort & filter")),
          testId('config-sortAndFilter')),
        cssSubTab(t("Data"),
          this._subTabComponents.tab('data'),
          dom.attr('data-text', t("Data")),
          testId('config-data')),
      ),
    ];
  }

  private _createViewConfigTab(owner: MultiHolder): Observable<null|ViewConfigTab> {
    const viewConfigTab = Observable.create<null|ViewConfigTab>(owner, null);
    const gristDoc = this._gristDoc;
    imports.loadViewPane()
      .then(ViewPane => {
        if (owner.isDisposed()) { return; }
        viewConfigTab.set(owner.autoDispose(
          ViewPane.ViewConfigTab.create({gristDoc, viewModel: gristDoc.viewModel})));
      })
      .catch(reportError);
    return viewConfigTab;
  }

  private _buildPageWidgetConfig(owner: MultiHolder, activeSection: ViewSectionRec) {
    // TODO: This uses private methods from ViewConfigTab. These methods are likely to get
    // refactored, but if not, should be made public.
    const viewConfigTab = this._createViewConfigTab(owner);
    const hasCustomMapping = Computed.create(owner, use => {
      // We shouldn't get here if activeSection is disposed but some errors reported in the wild
      // point to this being sometimes possible.
      if (activeSection.isDisposed()) { return false; }
      const widgetType = use(this._pageWidgetType);
      const isCustom = widgetType === 'custom' || widgetType?.startsWith('custom.');
      return Boolean(isCustom && use(activeSection.columnsToMap));
    });

    // build cursor position observable
    const cursor = owner.autoDispose(ko.computed(() => {
      const vsi = this._gristDoc.viewModel.activeSection?.().viewInstance();
      return vsi?.cursor.currentPosition() ?? {};
    }));

    return dom.maybe(viewConfigTab, (vct) => [
      this._disableIfReadonly(),
      dom.maybe(use => !use(activeSection.isRecordCard), () => [
        cssLabel(dom.text(use => use(activeSection.isRaw) ? t("DATA TABLE NAME") : t("WIDGET TITLE")),
          {for: "right-widget-title-input"},
        ),
        cssRow(cssTextInput(
          Computed.create(owner, (use) => use(activeSection.titleDef)),
          val => activeSection.titleDef.saveOnly(val),
          dom.boolAttr('disabled', use => {
            const isRawTable = use(activeSection.isRaw);
            const isSummaryTable = use(use(activeSection.table).summarySourceTable) !== 0;
            return isRawTable && isSummaryTable;
          }),
          {id: "right-widget-title-input"},
          testId('right-widget-title')
        )),

        cssSection(
          dom.create(buildDescriptionConfig, activeSection.description, { cursor, "testPrefix": "right-widget" }),
        ),
      ]),

      dom.maybe(
        (use) => !use(activeSection.isRaw) && !use(activeSection.isRecordCard),
        () => cssRow(
          primaryButton(t("Change widget"), this._createPageWidgetPicker()),
          cssRow.cls('-top-space')
        ),
      ),

      dom.maybe((use) => ['detail', 'single'].includes(use(this._pageWidgetType)!), () => [
        cssGroupLabel(t("Theme")),
        dom('div',
          vct._buildThemeDom(),
          vct._buildLayoutDom())
      ]),

      domComputed((use) => {
        if (use(this._pageWidgetType) !== 'record') { return null; }
        return dom.create(GridOptions, activeSection);
      }),

      domComputed((use) => {
        if (use(this._pageWidgetType) !== 'record') { return null; }
        return dom('div', {role: 'group', 'aria-labelledby': 'row-style-label'},
          cssSeparator(),
          cssGroupLabel(t("Row style"), {id: 'row-style-label'}),
          dom.create(rowHeightConfigTable, activeSection.optionsObj),
          domAsync(imports.loadViewPane().then(ViewPane =>
            dom.create(ViewPane.ConditionalStyle, t("Row style"), activeSection, this._gristDoc)
          ))
        );
      }),

      dom.maybe((use) => use(this._pageWidgetType) === 'chart', () =>
        dom('div', {role: 'group', 'aria-label': t('Chart options')},
          cssGroupLabel(t("CHART TYPE")),
          vct._buildChartConfigDom(),
        )
      ),

      dom.maybe((use) => use(this._pageWidgetType) === 'custom', () => {
        const parts = vct._buildCustomTypeItems() as any[];
        return [
          cssSeparator(),
          // If 'customViewPlugin' feature is on, show the toggle that allows switching to
          // plugin mode. Note that the default mode for a new 'custom' view is 'url', so that's
          // the only one that will be shown without the feature flag.
          dom.maybe((use) => use(this._gristDoc.app.features).customViewPlugin,
            () => dom('div', parts[0].buildDom())),
          dom.maybe(use => use(activeSection.customDef.mode) === 'plugin',
            () => dom('div', parts[2].buildDom())),
          // In the default url mode, allow picking a url and granting/forbidding
          // access to data.
          dom.maybe(use => use(activeSection.customDef.mode) === 'url' && use(this._pageWidgetType) === 'custom',
            () => dom.create(CustomSectionConfig, activeSection, this._gristDoc)),
        ];
      }),
      dom.maybe((use) =>  use(this._pageWidgetType)?.startsWith('custom.'), () => {
        return [
          dom.create(PredefinedCustomSectionConfig, activeSection, this._gristDoc),
        ];
      }),

      dom.maybe(
        (use) => !(
          use(hasCustomMapping) ||
          use(this._pageWidgetType) === 'chart' ||
          use(activeSection.isRaw)
        ) && use(activeSection.parentKey) !== 'form',
        () => [
          cssSeparator(),
          dom.create(VisibleFieldsConfig, this._gristDoc, activeSection),
        ]),

      dom.maybe(this._isForm, () => [
        cssSeparator(),
        dom.create(MappedFieldsConfig, activeSection),
      ]),
    ]);
  }

  private _buildPageSortFilterConfig(owner: MultiHolder) {
    const viewConfigTab = this._createViewConfigTab(owner);
    return dom.maybe(viewConfigTab, (vct) => vct.buildSortFilterDom());
  }

  private _buildLinkInfo(activeSection: ViewSectionRec, ...domArgs: DomElementArg[]) {
    //NOTE!: linkingState.filterState might transiently be EmptyFilterState while things load
    //Each case (filters-table, id cols, etc) needs to be able to handle having lfilter.filterLabels = {}
    const tgtSec = activeSection;
    return dom.domComputed((use) => {

      const srcSec = use(tgtSec.linkSrcSection); //might be the empty section
      const srcCol = use(tgtSec.linkSrcCol);
      const srcColId = use(use(tgtSec.linkSrcCol).colId); // if srcCol is the empty col, colId will be undefined

      if (srcSec.isDisposed()) { // can happen when deleting srcSection with rightpanel open
        return cssLinkInfoPanel("");
      }

      //const tgtColId = use(use(tgtSec.linkTargetCol).colId);
      const srcTable = use(srcSec.table);
      const tgtTable = use(tgtSec.table);

      const lstate = use(tgtSec.linkingState);
      if(lstate == null) { return null; }

      // if not filter-linking, this will be incorrect, but we don't use it then
      const lfilter = lstate.filterState ? use(lstate.filterState): EmptyFilterState;

      //If it's null then no cursor-link is set, but in that case we won't show the string anyway.
      const cursorPos = lstate.cursorPos ? use(lstate.cursorPos) : 0;
      const linkedCursorStr =  cursorPos ? `${use(tgtTable.tableId)}[${cursorPos}]` : '';

      // Make descriptor for the link's source like: "TableName . ColName" or "${SIGMA} TableName", etc
      const fromTableDom = [
          dom.maybe((use2) => use2(srcTable.summarySourceTable), () => cssLinkInfoIcon("Pivot")),
          use(srcSec.titleDef) + (srcColId ? ` ${BLACK_CIRCLE} ${use(srcCol.label)}` : ''),
          dom.style("white-space", "normal"), //Allow table name to wrap, reduces how often scrollbar needed
        ];

      //Count filters for proper pluralization
      const hasId = lfilter.filterLabels?.hasOwnProperty("id");
      const numFilters = Object.keys(lfilter.filterLabels).length - (hasId ? 1 : 0);

      // ================== Link-info Helpers

      //For each col-filter in lfilters, makes a row showing "${icon} colName = [filterVals]"
      //FilterVals is in a box to look like a grid cell
      const makeFiltersTable = (): DomContents => {
        return cssLinkInfoBody(
          dom.style("width", "100%"), //width 100 keeps table from growing outside bounds of flex parent if overfull
          dom("table",
            dom.style("margin-left", "8px"),
            Object.keys(lfilter.filterLabels).map( (colId) => {
              const vals = lfilter.filterLabels[colId];
              let operationSymbol = "=";
              //if [filter (reflist) <- ref], op="intersects", need to convey "list has value". symbol =":"
              //if [filter (ref) <- reflist], op="in", vals.length>1, need to convey "ref in list"
              //Sometimes operation will be 'empty', but in that case "=" still works fine, i.e. "list = []"
              if (lfilter.operations[colId] == "intersects") { operationSymbol = ":"; }
              else if (vals.length > 1) { operationSymbol = ELEMENTOF; }

              if (colId == "id") {
                return dom("div", `ERROR: ID FILTER: ${colId}[${vals}]`);
              } else {
                return dom("tr",
                  dom("td", cssLinkInfoIcon("Filter"),
                    `${colId}`),
                  dom("td", operationSymbol, dom.style('padding', '0 2px 0 2px')),
                  dom("td", cssLinkInfoValuesBox(
                    isFullReferencingType(lfilter.colTypes[colId]) ?
                      cssLinkInfoIcon("FieldReference"): null,
                    `${vals.join(', ')}`)),
                );
            } }), //end of keys(filterLabels).map
        ));
      };

      //Given a list of filterLabels, show them all in a box, as if a grid cell
      //Shows a "Reference" icon in the left side, since this should only be used for reflinks and cursor links
      const makeValuesBox = (valueLabels: string[]): DomContents => {
        return cssLinkInfoBody((
            cssLinkInfoValuesBox(
            cssLinkInfoIcon("FieldReference"),
            valueLabels.join(', '), ) //TODO: join labels like "Entries[1], Entries[2]" to "Entries[[1,2]]"
        ));
      };

      const linkType = lstate.linkTypeDescription();

      return cssLinkInfoPanel(() => { switch (linkType) {
          case "Filter:Summary-Group":
          case "Filter:Col->Col":
          case "Filter:Row->Col":
          case "Summary":
            return [
              dom("div", `Link applies filter${numFilters > 1 ? "s" : ""}:`),
              makeFiltersTable(),
              dom("div", `Linked from `, fromTableDom),
            ];
          case "Show-Referenced-Records": {
            //filterLabels might be {} if EmptyFilterState, so filterLabels["id"] might be undefined
            const displayValues = lfilter.filterLabels["id"] ?? [];
            return [
              dom("div", `Link shows record${displayValues.length > 1 ? "s" : ""}:`),
              makeValuesBox(displayValues),
              dom("div", `from `, fromTableDom),
            ];
          }
          case "Cursor:Same-Table":
          case "Cursor:Reference":
            return [
              dom("div", `Link sets cursor to:`),
              makeValuesBox([linkedCursorStr]),
              dom("div", `from `, fromTableDom),
            ];
          case "Error:Invalid":
          default:
            return dom("div", `Error: Couldn't identify link state`);
        } },
        ...domArgs
      ); // End of cssLinkInfoPanel
    });
}

  private _buildLinkInfoAdvanced(activeSection: ViewSectionRec) {
    return  dom.domComputed((use): DomContents => {
      //TODO: if this just outputs a string, this could really be in LinkingState as a toDebugStr function
      //      but the fact that it's all observables makes that trickier to do correctly, so let's leave it here
      const srcSec = use(activeSection.linkSrcSection); //might be the empty section
      const tgtSec = activeSection;

      if (srcSec.isDisposed()) { // can happen when deleting srcSection with rightpanel open
        return cssRow("");
      }

      const srcCol = use(activeSection.linkSrcCol); // might be the empty column
      const tgtCol = use(activeSection.linkTargetCol);
      // columns might be the empty column
      // to check nullness, use `.getRowId() == 0` or `use(srcCol.colId) == undefined`

      const secToStr = (sec: ViewSectionRec) => (!sec || !sec.getRowId()) ?
          'null' :
          `#${use(sec.id)} "${use(sec.titleDef)}", (table "${use(use(sec.table).tableId)}")`;
      const colToStr = (col: ColumnRec) => (!col || !col.getRowId()) ?
          'null' :
          `#${use(col.id)} "${use(col.colId)}", type "${use(col.type)}")`;

      // linkingState can be null if the constructor throws, so for debugging we want to show link info
      // if either the viewSection or the linkingState claim there's a link
      const hasLink = use(srcSec.id) != undefined || use(tgtSec.linkingState) != null;
      const lstate = use(tgtSec.linkingState);
      const lfilter = lstate?.filterState ? use(lstate.filterState) : undefined;

      // Debug info for cursor linking
      const inPos = lstate?.incomingCursorPos ? use(lstate.incomingCursorPos) : null;
      const cursorPosStr = (lstate?.cursorPos ? `${use(tgtSec.tableId)}[${use(lstate.cursorPos)}]` : "N/A") +
      // TODO: the lastEdited and incomingCursorPos is kinda technical, to do with how bidirectional linking determines
      //       priority for cyclical cursor links. Might be too technical even for the "advanced info" box
        `\n srclastEdited: T+${use(srcSec.lastCursorEdit)} \n tgtLastEdited: T+${use(tgtSec.lastCursorEdit)}` +
        `\n incomingCursorPos: ${inPos ? `${inPos[0]}@T+${inPos[1]}` : "N/A"}`;

      //Main link info as a big string, will be in a <pre></pre> block
      let preString = "No Incoming Link";
      if (hasLink) {
        preString = [
          `From Sec: ${secToStr(srcSec)}`,
          `To   Sec: ${secToStr(tgtSec)}`,
          '',
          `From Col: ${colToStr(srcCol)}`,
          `To   Col: ${colToStr(tgtCol)}`,
          '===========================',
          // Show linkstate
          lstate == null ? "LinkState: null" : [
              `Link Type: ${use(lstate.linkTypeDescription)}`,
              ``,

              "Cursor Pos: " + cursorPosStr,
              !lfilter ? "Filter State: null" :
                ["Filter State:", ...(Object.keys(lfilter).map(key =>
                  `- ${key}: ${JSON.stringify((lfilter as any)[key])}`))].join('\n'),
            ].join('\n')
        ].join('\n');
      }

      const collapsed: SessionObs<Boolean> = this._advLinkInfoCollapsed;
      return hasLink ? [
          cssRow(
            icon('Dropdown', dom.style('transform', (use2) => use2(collapsed) ? 'rotate(-90deg)' : '')),
            "Advanced Link info",
            dom.style('font-size', `${vars.smallFontSize}`),
            dom.style('text-transform', 'uppercase'),
            dom.style('cursor', 'pointer'),
            dom.on('click', () => collapsed.set(!collapsed.get())),
          ),
          dom.maybe(not(collapsed), () => cssRow(cssLinkInfoPre(preString)))
      ] : null;
    });
  }

  private _buildPageDataConfig(owner: MultiHolder, activeSection: ViewSectionRec) {
    const viewConfigTab = this._createViewConfigTab(owner);
    const viewModel = this._gristDoc.viewModel;
    const table = activeSection.table;
    const groupedBy = Computed.create(owner, (use) => use(use(table).groupByColumns));
    const link = Computed.create(owner, (use) => {
      return linkId({
        srcSectionRef: use(activeSection.linkSrcSectionRef),
        srcColRef: use(activeSection.linkSrcColRef),
        targetColRef: use(activeSection.linkTargetColRef)
      });
    });

    // This computed is not enough to make sure that the linkOptions are up to date. Indeed
    // the selectBy function depends on a much greater number of observables. Creating that many
    // dependencies does not seem a better approach. Instead, we refresh the list of
    // linkOptions only when the user clicks on the dropdown. Such behavior is not supported by the
    // weasel select function as of writing and would require a custom implementation, so we will simulate
    // this behavior by using temporary observable that will be changed when the user clicks on the dropdown.
    const refreshTrigger = Observable.create(owner, false);
    const linkOptions = Computed.create(owner, (use) => {
      void use(refreshTrigger);
      return selectBy(
        this._gristDoc.docModel,
        viewModel.viewSections().all(),
        activeSection,
      );
    });

    link.onWrite(async (val) => {
      const widgetType = getTelemetryWidgetTypeFromVS(activeSection);
      if (val !== NoLink) {
        logTelemetryEvent('linkedWidget', {full: {docIdDigest: this._gristDoc.docId(), widgetType}});
      } else {
        logTelemetryEvent('unlinkedWidget', {full: {docIdDigest: this._gristDoc.docId(), widgetType}});
      }

      await this._gristDoc.saveLink(val);
    });
    return [
      this._disableIfReadonly(),
      dom('div', {role: 'group', 'aria-labelledby': 'data-table-label'},
        cssGroupLabel(t("DATA TABLE"), {id: 'data-table-label'}),
        cssRow(
          cssIcon('TypeTable'), cssDataLabel(t("SOURCE DATA")),
          cssContent(dom.text((use) => use(use(table).primaryTableId)),
                    testId('pwc-table'))
        ),
        dom(
          'div',
          cssRow(cssIcon('Pivot'), cssDataLabel(t("GROUPED BY"), {id: 'data-grouped-by-label'})),
          cssRow(domComputed(groupedBy, (cols) => cssList(
            cols.map((c) => cssListItem(dom.text(c.label), testId('pwc-groupedBy-col'))),
            {'aria-labelledby': 'data-grouped-by-label'}
          ))),

          testId('pwc-groupedBy'),
          // hide if not a summary table
          dom.hide((use) => !use(use(table).summarySourceTable)),
        ),

        dom.maybe((use) => !use(activeSection.isRaw) && !use(activeSection.isRecordCard), () =>
          cssButtonRow(primaryButton(t("Edit data selection"), this._createPageWidgetPicker(),
            testId('pwc-editDataSelection')),
            dom.maybe(
              use => Boolean(use(use(activeSection.table).summarySourceTable)),
              () => basicButton(
                t("Detach"),
                dom.on('click', () => this._gristDoc.docData.sendAction(
                  ["DetachSummaryViewSection", activeSection.getRowId()])),
                testId('detach-button'),
              )),
            cssRow.cls('-top-space'),
        )),
      ),

      // TODO: "Advanced settings" is for "on-demand" marking of tables. This is now a deprecated feature. UIRowId
      // is only shown for tables that are marked as "on-demand""
      dom.domComputed(use => use(use(table).onDemand) && use(viewConfigTab), (vct) => vct ? cssRow(
        dom('div', vct._buildAdvancedSettingsDom()),
      ) : null),

      dom.maybe((use) => !use(activeSection.isRaw) && !use(activeSection.isRecordCard), () => [
        cssSeparator(),
        cssLabel(t("SELECT BY")),
        cssRow(
          dom.update(
            select(link, linkOptions, {defaultLabel: t("Select widget")}),
            dom.on('click', () => {
              refreshTrigger.set(!refreshTrigger.get());
            })
          ),
          testId('right-select-by')
        ),
      ]),

      dom.maybe(activeSection.linkingState, () => cssRow(this._buildLinkInfo(activeSection))),

      domComputed((use) => {
        const selectorFor = use(use(activeSection.linkedSections).getObservable());
        // TODO: sections should be listed following the order of appearance in the view layout (ie:
        // left/right - top/bottom);
        return selectorFor.length ? [
          cssGroupLabel(t("SELECTOR FOR"), {id: 'data-selector-for-label'}, testId('selector-for')),
          cssRow(cssList(
            {'aria-labelledby': 'data-selector-for-label'},
            selectorFor.map((sec) => this._buildSectionItem(sec)),
          )),
        ] : null;
      }),

      //Advanced link info is a little too JSON-ish for general use. But it's very useful for debugging
      this._buildLinkInfoAdvanced(activeSection),
    ];
  }

  private _createPageWidgetPicker(): DomElementMethod {
    const gristDoc = this._gristDoc;
    const {activeSection} = gristDoc.viewModel;
    const onSave = async (val: IPageWidget) => {
      const {id} = await gristDoc.saveViewSection(activeSection.peek(), val);
      if (val.type === 'custom') {
        showCustomWidgetGallery(gristDoc, {sectionRef: id()});
      }
    };
    return (elem) => {
      attachPageWidgetPicker(elem, gristDoc, onSave, {
        buttonLabel:  t("Save"),
        value: () => toPageWidget(activeSection.peek()),
        selectBy: (val) => gristDoc.selectBy(val),
      });
    };
  }

  // Returns dom for a section item.
  private _buildSectionItem(sec: ViewSectionRec) {
    return cssListItem(
      dom.text(sec.titleDef),
      this._buildLinkInfo(sec, dom.style("border", "none")),
      testId('selector-for-entry')
    );
  }

  // Returns a DomArg that disables the content of the panel by adding a transparent overlay on top
  // of it.
  private _disableIfReadonly() {
    if (this._gristDoc.docPageModel) {
      return dom.maybe(this._gristDoc.docPageModel.isReadonly,  () => (
        cssOverlay(
          testId('disable-overlay'),
          cssBottomText(t("You do not have edit access to this document")),
        )
      ));
    }
  }

  private _buildPageSubmissionConfig(owner: MultiHolder, activeSection: ViewSectionRec) {
    // All of those observables are backed by the layout config.
    const submitButtonKo = activeSection.layoutSpecObj.prop('submitText');
    const toComputed = (obs: typeof submitButtonKo) => {
      const result = Computed.create(owner, (use) => use(obs));
      result.onWrite(val => obs.setAndSave(val));
      return result;
    };
    const submitButton = toComputed(submitButtonKo);
    const successText = toComputed(activeSection.layoutSpecObj.prop('successText'));
    const successURL = toComputed(activeSection.layoutSpecObj.prop('successURL'));
    const anotherResponse = toComputed(activeSection.layoutSpecObj.prop('anotherResponse'));
    const redirection = Observable.create(owner, Boolean(successURL.get()));
    owner.autoDispose(redirection.addListener(val => {
      if (!val) {
        successURL.set(null);
      }
    }));
    owner.autoDispose(successURL.addListener(val => {
      if (val) {
        redirection.set(true);
      }
    }));
    return [
      cssLabel(t("Submit button label")),
      cssRow(
        cssTextInput(submitButton, (val) => submitButton.set(val), {placeholder: t('Submit')}),
      ),
      cssLabel(t("Success text")),
      cssRow(
        cssTextArea(
          successText,
          {autoGrow: true, save: (val) => successText.set(val)},
          {placeholder: t('Thank you! Your response has been recorded.')}
        ),
      ),
      cssLabel(t("Submit another response")),
      cssRow(
        labeledSquareCheckbox(anotherResponse, [
          t("Display button"),
        ]),
      ),
      cssLabel(t("Redirection")),
      cssRow(
        labeledSquareCheckbox(
          redirection,
          t("Redirect automatically after submission"),
          testId("form-redirect")
        )
      ),
      cssRow(
        cssTextInput(
          successURL,
          (val) => successURL.set(val),
          { placeholder: t("Enter redirect URL") },
          testId("form-redirect-url")
        ),
        dom.show(redirection)
      ),
    ];
  }

  private _buildQuestionContent(owner: MultiHolder) {
    const fieldBuilder = owner.autoDispose(ko.computed(() => {
      const vsi = this._gristDoc.viewModel.activeSection?.().viewInstance();
      return vsi && vsi.activeFieldBuilder();
    }));

    // Sorry for the acrobatics below, but grainjs are not reentred when the active section changes.
    const viewInstance = owner.autoDispose(ko.computed(() => {
      const vsi = this._gristDoc.viewModel.activeSection?.().viewInstance();
      if (!vsi || vsi.isDisposed() || !toKo(ko, this._isForm)) { return null; }
      return vsi;
    }));

    const formView = owner.autoDispose(ko.computed(() => {
      const view = viewInstance() as unknown as FormView;
      if (!view || !view.selectedBox) { return null; }
      return view;
    }));

    const selectedBox = owner.autoDispose(ko.pureComputed(() => {
      const view = formView();
      if (!view) { return null; }
      const box = toKo(ko, view.selectedBox)();
      return box;
    }));
    const selectedField = Computed.create(owner, (use) => {
      const box = use(selectedBox);
      if (!box) { return null; }
      if (box.type !== 'Field') { return null; }
      const fieldBox = box as FieldModel;
      return use(fieldBox.field);
    });
    const selectedBoxWithOptions = Computed.create(owner, (use) => {
      const box = use(selectedBox);
      if (!box || !['Paragraph', 'Label'].includes(box.type)) { return null; }

      return box;
    });

    return domAsync(imports.loadViewPane().then(() => buildConfigContainer(cssSection(
      // Field config.
      dom.maybe(selectedField, (field) => {
        const fieldTitle = field.widgetOptionsJson.prop('question');

        return [
          cssLabel(t("Field title")),
          cssRow(
            cssTextInput(
              fromKo(fieldTitle),
              (val) => fieldTitle.saveOnly(val).catch(reportError),
              dom.prop('readonly', use => use(field.disableModify)),
              dom.prop('placeholder', use => use(field.displayLabel) || use(field.colId)),
              testId('field-title'),
            ),
          ),
          cssLabel(t("Table column name")),
          cssRow(
            cssTextInput(
              fromKo(field.displayLabel),
              (val) => field.displayLabel.saveOnly(val).catch(reportError),
              dom.prop('readonly', use => use(field.disableModify)),
              testId('field-label'),
            ),
          ),
          dom.maybe<FieldBuilder|null>(fieldBuilder, builder => [
            cssSeparator(),
            cssLabel(t("COLUMN TYPE")),
            cssSection(
              builder.buildSelectTypeDom(),
            ),
            cssSection(
              builder.buildFormConfigDom(),
            ),
          ]),
        ];
      }),

      // Box config
      dom.maybe(selectedBoxWithOptions, (box) => [
        cssLabel(dom.text(box.type)),
        cssRow(
          cssTextArea(
            box.prop('text'),
            {onInput: true, autoGrow: true},
            dom.on('blur', () => box.save().catch(reportError)),
            {placeholder: t('Enter text')},
          ),
        ),
        cssRow(
          buttonSelect(box.prop('alignment'), [
            {value: 'left',   icon: 'LeftAlign'},
            {value: 'center', icon: 'CenterAlign'},
            {value: 'right',  icon: 'RightAlign'}
          ]),
          dom.autoDispose(box.prop('alignment').addListener(() => box.save().catch(reportError))),
        )
      ]),

      // Default.
      dom.maybe(u => !u(selectedField) && !u(selectedBoxWithOptions), () => [
        buildFormConfigPlaceholder(),
      ])
    ))));
  }
}

function buildFormConfigPlaceholder() {
  return cssFormConfigPlaceholder(
    cssFormConfigImg(),
    cssFormConfigMessage(
      cssFormConfigMessageTitle(t('No field selected')),
      dom('div', t('Select a field in the form widget to configure.')),
    )
  );
}

function disabledSection() {
  return cssOverlay(
    testId('panel-disabled-section'),
  );
}



// This logic is copied from SidePane.js for building DOM from TabContent.
// TODO It may not be needed after new-ui refactoring of the side-pane content.
function tabContentToDom(content: Observable<TabContent[]>|TabContent[]|IDomComponent) {
  function buildItemDom(item: any) {
    return dom('div.config_item',
      dom.show(item.showObs || true),
      item.buildDom()
    );
  }

  if ("buildDom" in content) {
    return content.buildDom();
  }

  return cssTabContents(
    dom.forEach(content, itemOrHeader => {
      if (itemOrHeader.header) {
        return dom('div.config_group',
          dom.show(itemOrHeader.showObs || true),
          itemOrHeader.label ? dom('div.config_header', itemOrHeader.label) : null,
          dom.forEach(itemOrHeader.items, item => buildItemDom(item)),
        );
      } else {
        return buildItemDom(itemOrHeader);
      }
    })
  );
}

const cssOverlay = styled('div', `
  background-color: ${theme.rightPanelDisabledOverlay};
  opacity: 0.8;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 100;
`);

const cssBottomText = styled('span', `
  color: ${theme.text};
  position: absolute;
  bottom: -40px;
  padding: 4px 16px;
`);

const cssRow = styled('div', `
  color: ${theme.text};
  display: flex;
  margin: 8px 16px;
  align-items: center;
  &-top-space {
    margin-top: 24px;
  }
  &-disabled {
    color: ${theme.disabledText};
  }
  & .${cssCheckboxLabel.className} {
    flex-shrink: revert;  /* allow checkbox labels to wrap in right-panel rows */
  }
`);


const cssButtonRow = styled(cssRow, `
  margin-left: 0;
  margin-right: 0;
  & > button {
    margin-left: 16px;
  }
`);

const cssIcon = styled(icon, `
  flex: 0 0 auto;
  --icon-color: ${theme.lightText};
`);

const cssTopBarTabList = styled('div', `
  display: flex;
  width: 100%;
`);

const cssTopBarItem = styled(unstyledButton, `
  flex: 1 1 0px;
  height: 100%;
  background-color: ${theme.rightPanelTabBg};
  border-right: 1px solid ${theme.rightPanelTabBg};
  border-left: 1px solid ${theme.rightPanelTabBg};
  border-bottom: 1px solid ${theme.rightPanelTabBorder};
  font-weight: initial;
  color: ${theme.rightPanelTabFg};
  --icon-color: ${theme.rightPanelTabIcon};
  display: flex;
  align-items: center;
  cursor: default;
  outline-offset: -6px;
  &:first-child {
    border-left: 0;
  }
  &:last-child {
    border-right: 0;
  }
  /* the -selected class is used when the topbar item is not a tab */
  &-selected, &[aria-selected="true"] {
    background-color: ${theme.rightPanelTabSelectedBg};
    font-weight: ${vars.headerControlTextWeight};
    color: ${theme.rightPanelTabSelectedFg};
    --icon-color: ${theme.rightPanelTabSelectedIcon};
    border-bottom-color: ${theme.rightPanelTabSelectedBg};
    border-left-color: ${theme.rightPanelTabBorder};
    border-right-color: ${theme.rightPanelTabBorder};
  }
  &:not(&-selected, &[aria-selected="true"]):hover {
    background-color: ${theme.rightPanelTabHoverBg};
    border-left-color: ${theme.rightPanelTabHoverBg};
    border-right-color: ${theme.rightPanelTabHoverBg};
    color: ${theme.rightPanelTabHoverFg};
    --icon-color: ${theme.rightPanelTabIconHover};
  }
`);

const cssTopBarIcon = styled(icon, `
  flex: none;
  margin: 16px;
  height: 16px;
  width: 16px;
  background-color: var(--icon-color);
`);

const cssHoverCircle = styled('div', `
  margin-left: auto;
  margin-right: 8px;
  width: 32px;
  height: 32px;
  background: none;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  &:hover {
    background-color: ${theme.rightPanelTabButtonHoverBg};
    --icon-color: ${theme.iconButtonFg};
  }
`);

const cssHoverIcon = styled(icon, `
  height: 16px;
  width: 16px;
  background-color: var(--icon-color);
`);

const cssSubTabContainer = styled('div', `
  height: 48px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid ${components.pagePanelsBorder};
`);

const cssSubTab = styled(unstyledButton, `
  color: ${components.rightPanelSubtabFg};
  flex: auto;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  text-align: center;
  padding-bottom: 8px;
  cursor: default;
  border-bottom: 2px solid transparent;
  outline-offset: -3px;

  &[aria-selected="true"] {
    font-weight: 600;
    color: ${components.rightPanelSubtabSelectedFg};
    border-bottom-color: ${components.rightPanelSubtabSelectedUnderline};
  }
  &:not(&[aria-selected="true"]):hover {
    color: ${components.rightPanelSubtabHoverFg};
  }
  &:hover {
    font-weight: 600;
  }

  /* Trick to prevent text moving on hover because of font-weight change */
  &::after {
    content: attr(data-text);
    content: attr(data-text) / "";
    font-weight: 600;
    opacity: 0;
    pointer-events: none;
    height: 0;
    overflow: hidden;
  }
`);

const cssTabPanel = styled('div', `
  overflow: hidden;
  display: flex;
  flex-direction: column;
`);

const cssTabContents = styled('div', `
  padding: 16px 8px;
  overflow: auto;
`);



const cssDataLabel = styled('div', `
  flex: 0 0 81px;
  color: ${theme.lightText};
  font-size: ${vars.xsmallFontSize};
  margin-left: 4px;
  margin-top: 2px;
`);

const cssContent = styled('div', `
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 1em;
`);

const cssList = styled(unstyledUl, `
  width: 100%;
`);


const cssListItem = styled('li', `
  background-color: ${theme.hover};
  border-radius: 2px;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
  padding: 4px 8px;
`);

const cssTextArea = styled(textarea, `
  flex: 1 0 auto;
  color: ${theme.inputFg};
  background-color: ${theme.inputBg};
  border: 1px solid ${theme.inputBorder};
  border-radius: 3px;

  outline: none;
  padding: 3px 7px;
  /* Make space at least for two lines: size of line * 2 * line height + 2 * padding + border * 2 */
  min-height: calc(2em * 1.5 + 2 * 3px + 2px);
  line-height: 1.5;
  resize: none;

  &:disabled {
    color: ${theme.inputDisabledFg};
    background-color: ${theme.inputDisabledBg};
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
`);

const cssSection = styled('div', `
  position: relative;
`);


//============ LinkInfo CSS ============

//LinkInfoPanel is a flex-column
//`LinkInfoPanel > table` is the table where we show linked filters, if there are any
const cssLinkInfoPanel = styled('div', `
  width: 100%;

  display: flex;
  flex-flow: column;
  align-items: start;
  text-align: left;

  font-family: ${vars.fontFamily};

  border: 1px solid ${theme.pagePanelsBorder};
  border-radius: 4px;

  padding: 6px;

  white-space: nowrap;
  overflow-x: auto;

  & table {
      border-spacing: 2px;
      border-collapse: separate;
  }
`);

// Center table / values box inside LinkInfoPanel
const cssLinkInfoBody= styled('div', `
  margin: 2px 0 2px 0;
  align-self: center;
`);

// Intended to imitate style of a grid cell
// white-space: normal allows multiple values to wrap
// min-height: 22px matches real field size, +2 for the borders
const cssLinkInfoValuesBox = styled('div', `
  border: 1px solid ${'#CCC'};
  padding: 3px 3px 0px 3px;
  min-width: 60px;
  min-height: 24px;

  white-space: normal;
`);

//If inline with text, icons look better shifted up slightly
//since icons are position:relative, bottom:1 should shift it without affecting layout
const cssLinkInfoIcon = styled(icon, `
  bottom: 1px;
  margin-right: 3px;
  background-color: ${theme.controlSecondaryFg};
`);

// ============== styles for _buildLinkInfoAdvanced
const cssLinkInfoPre = styled("pre", `
  padding: 6px;
  font-size: ${vars.smallFontSize};
  line-height: 1.2;
`);

const cssFormConfigPlaceholder = styled('div', `
  display: flex;
  flex-direction: column;
  row-gap: 16px;
  margin-top: 32px;
  padding: 8px;
`);

const cssFormConfigImg = styled('div', `
  height: 140px;
  width: 100%;
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
  background-image: var(--icon-FormConfig);
`);

const cssFormConfigMessage = styled('div', `
  display: flex;
  flex-direction: column;
  row-gap: 8px;
  color: ${theme.text};
  text-align: center;
`);

const cssFormConfigMessageTitle = styled('div', `
  font-size: ${vars.largeFontSize};
  font-weight: 600;
`);
