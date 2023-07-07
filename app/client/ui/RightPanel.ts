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
import {GristDoc, IExtraTool, TabContent} from 'app/client/components/GristDoc';
import {RefSelect} from 'app/client/components/RefSelect';
import ViewConfigTab from 'app/client/components/ViewConfigTab';
import {domAsync} from 'app/client/lib/domAsync';
import * as imports from 'app/client/lib/imports';
import {makeT} from 'app/client/lib/localization';
import {createSessionObs} from 'app/client/lib/sessionObs';
import {reportError} from 'app/client/models/AppModel';
import {ColumnRec, TableRec, ViewFieldRec, ViewSectionRec} from 'app/client/models/DocModel';
import {GridOptions} from 'app/client/ui/GridOptions';
import {attachPageWidgetPicker, IPageWidget, toPageWidget} from 'app/client/ui/PageWidgetPicker';
import {linkId, selectBy} from 'app/client/ui/selectBy';
import {CustomSectionConfig} from 'app/client/ui/CustomSectionConfig';
import {buildDescriptionConfig} from 'app/client/ui/DescriptionConfig';
import {cssLabel} from 'app/client/ui/RightPanelStyles';
import {VisibleFieldsConfig} from 'app/client/ui/VisibleFieldsConfig';
import {IWidgetType, widgetTypes} from 'app/client/ui/widgetTypes';
import {basicButton, primaryButton} from 'app/client/ui2018/buttons';
import {testId, theme, vars} from 'app/client/ui2018/cssVars';
import {textInput} from 'app/client/ui2018/editableLabel';
import {IconList, IconName} from 'app/client/ui2018/IconList';
import {icon} from 'app/client/ui2018/icons';
import {select} from 'app/client/ui2018/menus';
import {FieldBuilder} from 'app/client/widgets/FieldBuilder';
import {StringUnion} from 'app/common/StringUnion';
import {
  bundleChanges, Computed, Disposable, dom, domComputed, DomContents,
  DomElementArg, DomElementMethod, fromKo, IDomComponent, UseCBOwner
} from 'grainjs';
import {MultiHolder, Observable, styled, subscribe} from 'grainjs';
import * as ko from 'knockout';
import {ReferenceUtils} from "../lib/ReferenceUtils";
import {isFullReferencingType} from "../../common/gristTypes";
import assert from "assert";

const t = makeT('RightPanel');

// Represents a top tab of the right side-pane.
const TopTab = StringUnion("pageWidget", "field");

// Represents a subtab of pageWidget in the right side-pane.
const PageSubTab = StringUnion("widget", "sortAndFilter", "data");

// Returns the icon and label of a type, default to those associate to 'record' type.
export function getFieldType(widgetType: IWidgetType|null) {
  // A map of widget type to the icon and label to use for a field of that widget.
  const fieldTypes = new Map<IWidgetType, {label: string, icon: IconName, pluralLabel: string}>([
    ['record', {label: t('Columns', { count: 1 }), icon: 'TypeCell', pluralLabel: t('Columns', { count: 2 })}],
    ['detail', {label: t('Fields', { count: 1 }), icon: 'TypeCell', pluralLabel: t('Fields', { count: 2 })}],
    ['single', {label: t('Fields', { count: 1 }), icon: 'TypeCell', pluralLabel: t('Fields', { count: 2 })}],
    ['chart', {label: t('Series', { count: 1 }), icon: 'ChartLine', pluralLabel: t('Series', { count: 2 })}],
    ['custom', {label: t('Columns', { count: 1 }), icon: 'TypeCell', pluralLabel: t('Columns', { count: 2 })}],
  ]);

  return fieldTypes.get(widgetType || 'record') || fieldTypes.get('record')!;
}

export class RightPanel extends Disposable {
  public readonly header: DomContents;
  public readonly content: DomContents;

  // If the panel is showing a tool, such as Action Log, instead of the usual section/field
  // configuration, this will be set to the tool's header and content.
  private _extraTool: Observable<IExtraTool|null>;

  // Which of the two standard top tabs (page widget or field) is selected, or was last selected.
  private _topTab = createSessionObs(this, "rightTopTab", "pageWidget", TopTab.guard);

  // Which subtab is open for configuring page widget.
  private _subTab = createSessionObs(this, "rightPageSubTab", "widget", PageSubTab.guard);

  // Which type of page widget is active, e.g. "record" or "chart". This affects the names and
  // icons in the top tab.
  private _pageWidgetType = Computed.create<IWidgetType|null>(this, (use) => {
    const section: ViewSectionRec = use(this._gristDoc.viewModel.activeSection);
    return (use(section.parentKey) || null) as IWidgetType;
  });

  // Returns the active section if it's valid, null otherwise.
  private _validSection = Computed.create(this, (use) => {
    const sec = use(this._gristDoc.viewModel.activeSection);
    return sec.getRowId() ? sec : null;
  });

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
      dataSelectionTabOpen: () => this._openDataSelection()
    }, this, true));
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
      const widgetInfo = widgetTypes.get(type) || {label: 'Table', icon: 'TypeTable'};
      const fieldInfo = getFieldType(type);
      return [
        cssTopBarItem(cssTopBarIcon(widgetInfo.icon), widgetInfo.label,
          cssTopBarItem.cls('-selected', (use) => use(this._topTab) === 'pageWidget'),
          dom.on('click', () => this._topTab.set("pageWidget")),
          testId('right-tab-pagewidget')),
        cssTopBarItem(cssTopBarIcon(fieldInfo.icon), fieldInfo.label,
          cssTopBarItem.cls('-selected', (use) => use(this._topTab) === 'field'),
          dom.on('click', () => this._topTab.set("field")),
          testId('right-tab-field')),
      ];
    });
  }

  private _buildContentDom() {
    return dom.domComputed((use) => {
      if (!use(this._isOpen)) { return null; }
      const tool = use(this._extraTool);
      if (tool) { return tabContentToDom(tool.content); }

      const topTab = use(this._topTab);
      if (topTab === 'field') {
        return dom.create(this._buildFieldContent.bind(this));
      }
      if (topTab === 'pageWidget' && use(this._pageWidgetType)) {
        return dom.create(this._buildPageWidgetContent.bind(this));
      }
      return null;
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
            dom.maybe(isMultiSelect, () => disabledSection()),
            testId('panel-transform'),
          ),
          this._disableIfReadonly(),
        )
      );
    }));
  }

  // Helper to activate the side-pane formula editor over the given HTML element.
  private _activateFormulaEditor(
    // Element to attach to.
    refElem: Element,
    // Simulate user typing on the cell - open editor with an initial value.
    editValue?: string,
    // Custom save handler.
    onSave?: (column: ColumnRec, formula: string) => Promise<void>,
    // Custom cancel handler.
    onCancel?: () => void) {
    const vsi = this._gristDoc.viewModel.activeSection().viewInstance();
    if (!vsi) { return; }
    const editRowModel = vsi.moveEditRowToCursor();
    return vsi.activeFieldBuilder.peek().openSideFormulaEditor(editRowModel, refElem, editValue, onSave, onCancel);
  }

  private _buildPageWidgetContent(_owner: MultiHolder) {
    return [
      cssSubTabContainer(
        cssSubTab(t("Widget"),
          cssSubTab.cls('-selected', (use) => use(this._subTab) === 'widget'),
          dom.on('click', () => this._subTab.set("widget")),
          testId('config-widget')),
        cssSubTab(t("Sort & Filter"),
          cssSubTab.cls('-selected', (use) => use(this._subTab) === 'sortAndFilter'),
          dom.on('click', () => this._subTab.set("sortAndFilter")),
          testId('config-sortAndFilter')),
        cssSubTab(t("Data"),
          cssSubTab.cls('-selected', (use) => use(this._subTab) === 'data'),
          dom.on('click', () => this._subTab.set("data")),
          testId('config-data')),
      ),
      dom.domComputed(this._subTab, (subTab) => (
        dom.maybe(this._validSection, (activeSection) => (
          buildConfigContainer(
            subTab === 'widget' ? dom.create(this._buildPageWidgetConfig.bind(this), activeSection) :
              subTab === 'sortAndFilter' ? dom.create(this._buildPageSortFilterConfig.bind(this)) :
              subTab === 'data' ? dom.create(this._buildPageDataConfig.bind(this), activeSection) :
              null
          )
        ))
      ))
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
      const isCustom = use(this._pageWidgetType) === 'custom';
      const hasColumnMapping = use(activeSection.columnsToMap);
      return Boolean(isCustom && hasColumnMapping);
    });

    // build cursor position observable
    const cursor = owner.autoDispose(ko.computed(() => {
      const vsi = this._gristDoc.viewModel.activeSection?.().viewInstance();
      return vsi?.cursor.currentPosition() ?? {};
    }));

    return dom.maybe(viewConfigTab, (vct) => [
      this._disableIfReadonly(),
      cssLabel(dom.text(use => use(activeSection.isRaw) ? t("DATA TABLE NAME") : t("WIDGET TITLE")),
        dom.style('margin-bottom', '14px'),
      ),
      cssRow(cssTextInput(
        Computed.create(owner, (use) => use(activeSection.titleDef)),
        val => activeSection.titleDef.saveOnly(val),
        dom.boolAttr('disabled', use => {
          const isRawTable = use(activeSection.isRaw);
          const isSummaryTable = use(use(activeSection.table).summarySourceTable) !== 0;
          return isRawTable && isSummaryTable;
        }),
        testId('right-widget-title')
      )),

      cssSection(
        dom.create(buildDescriptionConfig, activeSection.description, { cursor, "testPrefix": "right-widget" }),
      ),

      dom.maybe(
        (use) => !use(activeSection.isRaw),
        () => cssRow(
          primaryButton(t("Change Widget"), this._createPageWidgetPicker()),
          cssRow.cls('-top-space')
        ),
      ),

      cssSeparator(),

      dom.maybe((use) => ['detail', 'single'].includes(use(this._pageWidgetType)!), () => [
        cssLabel(t("Theme")),
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
        return [
          cssSeparator(),
          cssLabel(t("ROW STYLE")),
          domAsync(imports.loadViewPane().then(ViewPane =>
            dom.create(ViewPane.ConditionalStyle, t("Row Style"), activeSection, this._gristDoc)
          ))
        ];
      }),

      dom.maybe((use) => use(this._pageWidgetType) === 'chart', () => [
        cssLabel(t("CHART TYPE")),
        vct._buildChartConfigDom(),
      ]),

      dom.maybe((use) => use(this._pageWidgetType) === 'custom', () => {
        const parts = vct._buildCustomTypeItems() as any[];
        return [
          cssLabel(t("CUSTOM")),
          // If 'customViewPlugin' feature is on, show the toggle that allows switching to
          // plugin mode. Note that the default mode for a new 'custom' view is 'url', so that's
          // the only one that will be shown without the feature flag.
          dom.maybe((use) => use(this._gristDoc.app.features).customViewPlugin,
            () => dom('div', parts[0].buildDom())),
          dom.maybe(use => use(activeSection.customDef.mode) === 'plugin',
            () => dom('div', parts[2].buildDom())),
          // In the default url mode, allow picking a url and granting/forbidding
          // access to data.
          dom.maybe(use => use(activeSection.customDef.mode) === 'url',
            () => dom.create(CustomSectionConfig, activeSection, this._gristDoc)),
        ];
      }),

      dom.maybe(
        (use) => !(
          use(hasCustomMapping) ||
          use(this._pageWidgetType) === 'chart' ||
          use(activeSection.isRaw)
        ),
        () => [
          cssSeparator(),
          dom.create(VisibleFieldsConfig, this._gristDoc, activeSection),
        ]),
    ]);
  }

  private _buildPageSortFilterConfig(owner: MultiHolder) {
    const viewConfigTab = this._createViewConfigTab(owner);
    return dom.maybe(viewConfigTab, (vct) => vct.buildSortFilterDom());
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


    const secToCursorPos = (use: UseCBOwner, sec: ViewSectionRec) => {
      const vi = use(sec.viewInstance);
      if (!vi) { return undefined; }
      return use(vi.cursor.currentPosition);
    };
    const getCurrentViewField = (use: UseCBOwner, sec: ViewSectionRec): ViewFieldRec|undefined => {
          const vi = use(sec.viewInstance);
          if (vi) {
            // @ts-ignore (it's a debug function)
            return use(use(sec.viewFields))[use(vi.cursor.fieldIndex)];
          }
          return undefined;
    };




    const JV = (window as any).JV = (window as any).JV || {};  //JV DEBUG
    JV._gristDoc = this._gristDoc;
    JV.asec = this._gristDoc.viewModel.activeSection;//JV.asec || Computed.create(null, use => use())
    JV.afield = Computed.create(owner, use=> getCurrentViewField(use, use(JV.asec) as ViewSectionRec));
    JV.pprint = ((obj: any) => JSON.stringify(obj, null, 2));
    JV.nulluse = ((obs: any) => { obs = ('_getDepItem' in obs) ? obs : fromKo(obs); return obs.get(); }); //use print without creating an observable
    JV.poCol = (use: UseCBOwner, col: ColumnRec) => `C#${use(col.id)}:'${use(col.colId)}' type ${use(col.type)} @T#${use(use(col.table).id)}'`;
    JV.poTab = (use: UseCBOwner, tab: TableRec) => `T#${use(tab.id)}:'${use(tab.formattedTableName)}'`;
    JV.poFld = (use: UseCBOwner, field: ViewFieldRec) => `F#${use(field.id)}: '${use(field.label)}' (C#${use(use(field.column).id)}) @S#${use(use(field.viewSection).id)}`;

    JV.poSec = (use: UseCBOwner, sec: ViewSectionRec) => `S#${use(sec.id)}: '${use(sec.titleDef)}'`; //curs:${JSON.stringify(secToCursorPos(use,sec))}`;
    //helpers for peeking
    JV.pCol = (x: any) => JV.poCol(JV.nulluse, x);
    JV.pTab = (x: any) => JV.poTab(JV.nulluse, x);
    JV.pFld = (x: any) => JV.poFld(JV.nulluse, x);
    JV.pSec = (x: any) => JV.poSec(JV.nulluse, x);

    const debugBox = styled('div', `
      position:fixed;
      z-index: 99999;
      background-color: white;
      border: 1px solid black;
      min-width: 100px;
      min-height: 40px;
    `);

    const paddedIcon = styled('div', "margin: 2px");
    // @ts-ignore
    const makeIconBox = () => debugBox(
        dom("div", dom.attr("style", "display:flex; flex-direction:row; flex-wrap: wrap; max-width:600px"),
          IconList.map(iname => paddedIcon(icon(iname))),
        ),
        dom.on("click", (evt, elem) => { const box = elem; dom.domDispose(box); box.remove(); })
    );

    //add debugbox to window if it doesn't already exist
    // @ts-ignore
    const makeDebugBox = () => debugBox(
        dom("button",
            dom.text("X"), dom.style("float", "right"), dom.style("color", "red"),
            dom.on("click", (event, elem) => {
              const box = elem.parentElement;
              if(box == null)
                { return; }
              dom.domDispose(box);
              box.remove();
              JV.boxExists = false; })
        ),
        dom.text("JV Debug info:"),
        dom("br"),
        dom.domComputed((use) => {

          const docData = this._gristDoc.docData;
          const aSec = use(JV._gristDoc.viewModel.activeSection) as ViewSectionRec;
          const aField = getCurrentViewField(use, aSec);

          const cursorPos = secToCursorPos(use, aSec);
          let cellValue, cellValue2, cellType, cellRefValue, cellFormatterVal = null;
          if(cursorPos && aField != null){
            const rowId = cursorPos.rowId;
            const col = use(aField.column);
            if(rowId != undefined) {
              cellValue = docData.getTable(use(aSec.tableId))!.getValue(rowId, use(col.colId));
              if(cellValue != null) {
                cellValue2 = use(col.visibleColFormatter).formatAny(cellValue);
                cellType = use(col.type);
                if (isFullReferencingType(cellType)) {
                  const RU = new ReferenceUtils(aField, docData);
                  cellRefValue = RU.isRefList ? (cellValue as any[]).slice(1).map(v => RU.idToText(v)) : RU.idToText(cellValue);
                }

                cellFormatterVal = use(aField.formatter).formatAny(cellValue);
                // const refData = docData.getTable(use(use(col.refTable)!.tableId));
                // cellRefValue = use(col.visibleColFormatter).formatAny(refData!.getValue(cellValue as any, use(use(col.visibleColModel).colId) || 'id'));
              }
            }
          }
          return [
              cssRow(JV.poSec(use, aSec)),
              cssRow(aField ? JV.poFld(use, aField): "no field selected"),
              cssRow(aField ? JV.poCol(use, use(aField.column)): "no field selected"),
              cssRow(cellValue === null ? "no cell value": `cell: ${JSON.stringify(cellValue)},  ${cellValue2}, type ${cellType} ; '${cellRefValue}'`),
              cssRow("formatterVal (.formatter, unreliable): " + cellFormatterVal || "null"),
          ];
        }),
    );
    if (!JV.boxExists) {
      //window.document.body.append(makeIconBox());
      //window.document.body.append(makeDebugBox());
      JV.boxExists = true;
    }
    const pprintedLinkInfo = (sec: ViewSectionRec) => Computed.create(owner, (use)=> {
      //makes an observable for the passed-in section
      const lstate = use(sec.linkingState);
      if(lstate == null) { return "No Link"; }

      const srcSec = use(sec.linkSrcSection); //might be the empty section
      const srcColId = use(use(sec.linkSrcCol).colId); // might be the empty column
      const tgtColId = use(use(sec.linkTargetCol).colId);
      //can use .getRowId(), 0 means empty
      //can do use(srcCol.colId) == undefined for empty

      /* ==================== TODO ===================
    - (for linking state):
    - show source section (section label)
    - show source column (id, type) (or default to row)
    - show selected row ID
    - show filtering value at selected row
      - if col -> any
        - first show cell value
        - then if col is a ref col, find it's display field and show "RefTable[$id]", then show "ref display value"
      - if row -> col
        - first show "SrcTable[$rowId]"
        - then if target col is ref-type, show display value for selected ref row
      - if row -> row
        - show "cursor link, SrcTable[$rowId]"
        - later, infer a good display col for it? try first col?
    -aaaa
    */

      // @ts-ignore
      let wipStr = "";
      if (!srcSec.getRowId()) { wipStr = "No Linking"; }
      else {
        // @ts-ignore
        const srcTable = use(srcSec.table);
        const srcCursorPos = secToCursorPos(use, srcSec);
        const rowIndex = srcCursorPos ? srcCursorPos.rowIndex : "null";
        const rowId = use(srcSec.activeRowId);

        // @ts-ignore
        let selectorVal = undefined; // if
        // @ts-ignore
        const selectorType = "";//if filterL, use ref from srcCol, if lookup use ref from trgCol, if cursor link then we dont' have a display column
        // if a summary table, then it's trickier. If it's a


        // =============== Let's try making a descriptive sentence
        wipStr = `Selected by ${JV.poSec(use, srcSec)}, at row#${typeof rowIndex == "number" ? rowIndex+1 : "(new)"}\n`;
        if(srcColId){
          let srcColValue = undefined;
          if(rowId) {
            srcColValue = this._gristDoc.docData.getTable(use(srcSec.tableId))!.getValue(rowId, srcColId);
          }



          if (srcColValue == undefined) { srcColValue = "(undefined)"; }
          selectorVal = srcColValue;
          wipStr += `using col='${srcColId}'; val='${srcColValue}' (from row ${use(srcSec.tableId)}[${rowId || "null"}]) `;
        } else { //selected by row
          selectorVal = rowId;
          wipStr +=`using row '${use(srcSec.tableId)}[${rowId || "null"}]'`;
        }

        // === Selector value: format appropriately
       /* let cellValue, cellValue2, cellType, cellRefValue = null;
        cellValue = docData.getTable(use(aSec.tableId))!.getValue(rowId,use(col.colId));
        cellValue2 = use(col.visibleColFormatter).formatAny(cellValue);
        cellType = use(col.type);
        if (isFullReferencingType(cellType)) {
          const RU = new ReferenceUtils(aField!, docData);
          cellRefValue = RU.isRefList ? (cellValue as any[]).slice(1).map(v => RU.idToText(v)) : RU.idToText(cellValue);
        }*/

        wipStr += "\n";

        if(tgtColId) {
          //target col specified, therefore doing filter-linking
          wipStr += "Doing Filter-linking";
        } else { //no target column, either same-table cursor linking, or lookup linking
          if(srcColId) {
              wipStr += "Lookup linking";
            } else {
            wipStr += "Cursor linking (same-table)";
          }
      }

      }

      // ========== Old debug description: just list out the stuff=================
      const lcursor = lstate.cursorPos ? use(lstate.cursorPos) : null;
      const lfilter = use(sec.linkingFilter);

      // Pretty print cursor info
      const lcursorRec = lcursor ? `${use(sec.tableId)}[${lcursor}]`: null;
      let resCursor = "";
      if(lcursor != null){
        resCursor += "cursor link: rowId=" + lcursorRec;
      }

      let resFilter = "";
      try {
        // Pretty print filter info
        if (lfilter != null && Object.keys(lfilter.filters).length != 0) {
          resFilter = "Link Filters:";
          for (const colId in lfilter.filters) {
            if (colId == "id") { //lookup of reflist implemented as filter on id, handle separately
              resFilter += "\n    " + colId + " = '" + lfilter.filters[colId] + "'";
              if (lfilter.operations[colId] != "in") {
                resFilter += "  (op=" + lfilter.operations[colId] + ")";
              }
              continue;
            }

            //lookup target column, to display references better and/or show date formatters
            // @ts-ignore
            const fields: ViewFieldRec[] = use(use(sec.viewFields)).filter((field: ViewFieldRec) => use(field.colId) == colId);
            assert(fields.length == 1, "Should have exactly 1 field matching colId '" + colId + "': " + JSON.stringify(fields));
            const field = fields[0];
            //TODO: bug? how to correctly use() koArray
            //TODO: is there a better way to get field by colId?

            console.log("!!!!Found field:" + JV.pFld(field));

            const rawVals = lfilter.filters[colId]; //filters[colId] looks like [val, val, ...]
            let formattedVals;
            const cellType = use(use(field.column).type);
            const formatter = use(use(field.column).visibleColFormatter);
            //const formatter2 = use(field.formatter);

            JV.x = field;
            JV.x2 = cellType;
            JV.x3 = rawVals;
            //formattedVals = rawVals.map(rv => formatter2.formatAny(rv))
            if (isFullReferencingType(cellType)) {
              const RU = new ReferenceUtils(field, this._gristDoc.docData); //TODO: disposal?
              if (!RU.tableData.isLoaded) {
                formattedVals = rawVals.map(rv => `${use(use(use(field.column).refTable)!.tableId)}[${rv}]  (table not loaded)`);
              } else {
                formattedVals = rawVals.map(rv => `${use(use(use(field.column).refTable)!.tableId)}[${rv}]  (${RU.idToText(rv)})`);
              }
            } else { // //normal vals just get formatted (needed for dates and currencies and things)
              formattedVals = rawVals.map(rv => formatter.formatAny(rv));
            }


            resFilter += "\n    " + colId + " = '" + formattedVals + "'";
            if (lfilter.operations[colId] != "in") {
              resFilter += "  (op=" + lfilter.operations[colId] + ")";
            }
          }
        }
      } catch(e) {
        //filters not loaded yet
        resFilter = "Failed to load fields: \n filters: " + JSON.stringify(lfilter.filters) + "\n labels: " + JSON.stringify(lfilter.filterLabels);
      }

      let LinkInfo = "";
      LinkInfo+= `SrcSection: '${JV.poSec(use, srcSec)}'`;
      LinkInfo+= `\nTgtSection: '${JV.poSec(use, sec)}'`;
      LinkInfo += `\nSrcCol: ${srcColId}\nTgtCol: ${tgtColId}\n`;

      if(resCursor == "" && resFilter == "") { resCursor = " no filters"; }
      //let res = resCursor + resFilter;
      return "===Linking State Debug===\n" + LinkInfo + "\nLinkingState:\n"
        + Object.keys(lfilter).map(key => `-${key}: ${JSON.stringify((lfilter as any)[key])}`).join("\n");
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

    link.onWrite((val) => this._gristDoc.saveLink(val));
    return [
      this._disableIfReadonly(),
      cssLabel(t("DATA TABLE")),
      cssRow(
        cssIcon('TypeTable'), cssDataLabel(t("SOURCE DATA")),
        cssContent(dom.text((use) => use(use(table).primaryTableId)),
                   testId('pwc-table'))
      ),
      dom(
        'div',
        cssRow(cssIcon('Pivot'), cssDataLabel(t("GROUPED BY"))),
        cssRow(domComputed(groupedBy, (cols) => cssList(cols.map((c) => (
          cssListItem(dom.text(c.label),
                      testId('pwc-groupedBy-col'))
        ))))),

        testId('pwc-groupedBy'),
        // hide if not a summary table
        dom.hide((use) => !use(use(table).summarySourceTable)),
      ),

      dom.maybe((use) => !use(activeSection.isRaw), () =>
        cssButtonRow(primaryButton(t("Edit Data Selection"), this._createPageWidgetPicker(),
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

      // TODO: "Advanced settings" is for "on-demand" marking of tables. This should only be shown
      // for raw data tables (once that's supported), should have updated UI, and should possibly
      // be hidden for free plans.
      dom.maybe(viewConfigTab, (vct) => cssRow(
        dom('div', vct._buildAdvancedSettingsDom()),
      )),
      cssSeparator(),

      dom.maybe((use) => !use(activeSection.isRaw), () => [
        cssLabel(t("SELECT BY")),
        cssRow(
          dom.update(
            select(link, linkOptions, {defaultLabel: t("Select Widget")}),
            dom.on('click', () => {
              refreshTrigger.set(!refreshTrigger.get());
            })
          ),
          testId('right-select-by')
        ),
      ]),


      //JV Addition:
      //Lets add a debug rendering of the current filters:
      cssLabel(domComputed((use) => t(`DEBUG: INCOMING LINK FOR "${JV.poSec(use, activeSection)}"`))),
      cssRow(
        dom("pre", dom.text(pprintedLinkInfo(activeSection)))
      ),



      domComputed((use) => {
        const selectorFor = use(use(activeSection.linkedSections).getObservable());
        // TODO: sections should be listed following the order of appearance in the view layout (ie:
        // left/right - top/bottom);

        JV.selectorFor = selectorFor;//JV TEMP DEBUG


        return selectorFor.length ? [
          cssLabel(t("SELECTOR FOR"), testId('selector-for')),
          cssRow(cssList(selectorFor.map((sec) => this._buildSectionItem(sec)))),

          //JV: lets also show link filters for this:
          selectorFor.map( (sec) => [
              cssRow(`DEBUG: OUTGOING LINK TO: "${use(sec.titleDef)}" (T:${use(sec.tableId).toUpperCase()})`),
              //cssRow(dom("pre",dom.text("lorem ipsum"))),
              cssRow(dom("pre", dom.text(pprintedLinkInfo(sec)))),
          ]),
        ] : null;
      }),
    ];
  }

  private _createPageWidgetPicker(): DomElementMethod {
    const gristDoc = this._gristDoc;
    const section = gristDoc.viewModel.activeSection;
    const onSave = (val: IPageWidget) => gristDoc.saveViewSection(section.peek(), val);
    return (elem) => { attachPageWidgetPicker(elem, gristDoc, onSave, {
      buttonLabel:  t("Save"),
      value: () => toPageWidget(section.peek()),
      selectBy: (val) => gristDoc.selectBy(val),
    }); };
  }

  // Returns dom for a section item.
  private _buildSectionItem(sec: ViewSectionRec) {
    return cssListItem(
      dom.text(sec.titleDef),
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
}

function disabledSection() {
  return cssOverlay(
    testId('panel-disabled-section'),
  );
}

export function buildConfigContainer(...args: DomElementArg[]): HTMLElement {
  return cssConfigContainer(
    // The `position: relative;` style is needed for the overlay for the readonly mode. Note that
    // we cannot set it on the cssConfigContainer directly because it conflicts with how overflow
    // works. `padding-top: 1px;` prevents collapsing the top margins for the container and the
    // first child.
    dom('div', {style: 'position: relative; padding-top: 1px;'}, ...args),
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

const cssTopBarItem = styled('div', `
  flex: 1 1 0px;
  height: 100%;
  background-color: ${theme.rightPanelTabBg};
  font-weight: ${vars.headerControlTextWeight};
  color: ${theme.rightPanelTabFg};
  --icon-color: ${theme.rightPanelTabIcon};
  display: flex;
  align-items: center;
  cursor: default;

  &-selected {
    background-color: ${theme.rightPanelTabSelectedBg};
    font-weight: initial;
    color: ${theme.rightPanelTabSelectedFg};
    --icon-color: ${theme.rightPanelTabSelectedFg};
  }
  &:not(&-selected):hover {
    background-color: ${theme.rightPanelTabHoverBg};
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

  &:hover {
    background-color: ${theme.rightPanelTabButtonHoverBg};
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
`);

const cssSubTab = styled('div', `
  color: ${theme.rightPanelSubtabFg};
  flex: auto;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  text-align: center;
  padding-bottom: 8px;
  border-bottom: 1px solid ${theme.pagePanelsBorder};
  cursor: default;

  &-selected {
    color: ${theme.rightPanelSubtabSelectedFg};
    border-bottom: 1px solid ${theme.rightPanelSubtabSelectedUnderline};
  }
  &:not(&-selected):hover {
    color: ${theme.rightPanelSubtabHoverFg};
  }
  &:hover {
    border-bottom: 1px solid ${theme.rightPanelSubtabHoverUnderline};
  }
  .${cssSubTabContainer.className}:hover > &-selected:not(:hover) {
    border-bottom: 1px solid ${theme.pagePanelsBorder};
  }
`);

const cssTabContents = styled('div', `
  padding: 16px 8px;
  overflow: auto;
`);

const cssSeparator = styled('div', `
  border-bottom: 1px solid ${theme.pagePanelsBorder};
  margin-top: 16px;
`);

const cssConfigContainer = styled('div.test-config-container', `
  overflow: auto;
  --color-list-item: none;
  --color-list-item-hover: none;

  &:after {
    content: "";
    display: block;
    height: 40px;
  }
  & .fieldbuilder_settings {
    margin: 16px 0 0 0;
  }
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

const cssList = styled('div', `
  list-style: none;
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
