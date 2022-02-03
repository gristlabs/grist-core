var _ = require('underscore');
var ko = require('knockout');
var dispose = require('../lib/dispose');
var dom = require('../lib/dom');
var kd = require('../lib/koDom');
var kf = require('../lib/koForm');
var koArray = require('../lib/koArray');
var commands = require('./commands');
var {CustomSectionElement} = require('../lib/CustomSectionElement');
const {ChartConfig} = require('./ChartView');
const {Computed, dom: grainjsDom, makeTestId, Observable, styled, MultiHolder} = require('grainjs');

const {addToSort} = require('app/client/lib/sortUtil');
const {updatePositions} = require('app/client/lib/sortUtil');
const {attachColumnFilterMenu} = require('app/client/ui/ColumnFilterMenu');
const {addFilterMenu} = require('app/client/ui/FilterBar');
const {cssIcon, cssRow} = require('app/client/ui/RightPanel');
const {basicButton, primaryButton} = require('app/client/ui2018/buttons');
const {labeledLeftSquareCheckbox} = require("app/client/ui2018/checkbox");
const {colors} = require('app/client/ui2018/cssVars');
const {cssDragger} = require('app/client/ui2018/draggableList');
const {menu, menuItem, select} = require('app/client/ui2018/menus');
const {confirmModal} = require('app/client/ui2018/modals');
const {Sort} = require('app/common/SortSpec');
const isEqual = require('lodash/isEqual');
const {cssMenuItem} = require('popweasel');

const testId = makeTestId('test-vconfigtab-');

/**
 * Helper class that combines one ViewSection's data for building dom.
 */
function ViewSectionData(section) {
  this.section = section;

  // A koArray reflecting the columns (RowModels) that are not present in the current view.
  this.hiddenFields = this.autoDispose(koArray.syncedKoArray(section.hiddenColumns));
}
dispose.makeDisposable(ViewSectionData);


function ViewConfigTab(options) {
  var self = this;
  this.gristDoc = options.gristDoc;
  this.viewModel = options.viewModel;

  // viewModel may point to different views, but viewSectionData is a single koArray reflecting
  // the sections of the current view.
  this.viewSectionData = this.autoDispose(
    koArray.syncedKoArray(this.viewModel.viewSections, function(section) {
      return ViewSectionData.create(section);
    })
    .setAutoDisposeValues()
  );

  this.activeSectionData = this.autoDispose(ko.computed(function() {
    return _.find(self.viewSectionData.all(), function(sectionData) {
      return sectionData.section &&
        sectionData.section.getRowId() === self.viewModel.activeSectionId();
    }) || self.viewSectionData.at(0);
  }));
  this.isDetail = this.autoDispose(ko.computed(function() {
    return ['detail', 'single'].includes(this.viewModel.activeSection().parentKey());
  }, this));
  this.isChart = this.autoDispose(ko.computed(function() {
      return this.viewModel.activeSection().parentKey() === 'chart';}, this));
  this.isGrid = this.autoDispose(ko.computed(function() {
      return this.viewModel.activeSection().parentKey() === 'record';}, this));
  this.isCustom = this.autoDispose(ko.computed(function() {
      return this.viewModel.activeSection().parentKey() === 'custom';}, this));
}
dispose.makeDisposable(ViewConfigTab);


ViewConfigTab.prototype.buildSortDom = function() {
  return grainjsDom.maybe(this.activeSectionData, (sectionData) => {
    const section = sectionData.section;

    // Computed to indicate if sort has changed from saved.
    const hasChanged = Computed.create(null, (use) =>
      !isEqual(use(section.activeSortSpec), Sort.parseSortColRefs(use(section.sortColRefs))));

    // Computed array of sortable columns.
    const columns = Computed.create(null, (use) => {
      // Columns is an observable holding an observable array - must call 'use' on it 2x.
      const cols = use(use(use(section.table).columns));
      return cols.filter(col => !use(col.isHiddenCol))
                 .map(col => ({
                   label: use(col.colId),
                   value: col.getRowId(),
                   icon: 'FieldColumn',
                   type: col.type()
                 }));
    });

    // We only want to recreate rows, when the actual columns change.
    const colRefs = Computed.create(null, (use) => {
      return use(section.activeSortSpec).map(col => Sort.getColRef(col));
    });
    const sortRows = koArray(colRefs.get());
    colRefs.addListener((curr, prev) => {
      if (!isEqual(curr, prev)){
        sortRows.assign(curr);
      }
    })

    // Sort row create function for each sort row in the draggableList.
    const rowCreateFn = colRef =>
      this._buildSortRow(colRef, section.activeSortSpec, columns);

    // Reorder function called when sort rows are reordered via dragging.
    const reorder = (...args) => {
      const spec = Sort.reorderSortRefs(section.activeSortSpec.peek(), ...args);
      this._saveSort(spec);
    };

    return grainjsDom('div',
      grainjsDom.autoDispose(hasChanged),
      grainjsDom.autoDispose(columns),
      grainjsDom.autoDispose(colRefs),
      grainjsDom.autoDispose(sortRows),
      // Sort rows.
      kf.draggableList(sortRows, rowCreateFn, {
        reorder,
        removeButton: false,
        drag_indicator: cssDragger,
        itemClass: cssDragRow.className
      }),
      // Add to sort btn & menu & fake sort row.
      this._buildAddToSortBtn(columns),
      // Update/save/reset buttons visible when the sort has changed.
      cssRow(
        cssExtraMarginTop.cls(''),
        grainjsDom.maybe(hasChanged, () => [
          primaryButton('Save', {style: 'margin-right: 8px;'},
            grainjsDom.on('click', () => { section.activeSortJson.save(); }),
            testId('sort-save'),
            grainjsDom.boolAttr('disabled', this.gristDoc.isReadonly),
          ),
          // Let's use same label (revert) as the similar button which appear in the view section.
          // menu.
          basicButton('Revert',
            grainjsDom.on('click', () => { section.activeSortJson.revert(); }),
            testId('sort-reset')
          )
        ]),
        cssFlex(),
        grainjsDom.maybe(section.isSorted, () =>
          basicButton('Update Data', {style: 'margin-left: 8px; white-space: nowrap;'},
            grainjsDom.on('click', () => { updatePositions(this.gristDoc, section); }),
            testId('sort-update'),
            grainjsDom.show((use) => use(use(section.table).supportsManualSort)),
            grainjsDom.boolAttr('disabled', this.gristDoc.isReadonly),
          )
        ),
        grainjsDom.show((use) => use(hasChanged) || use(section.isSorted))
      ),
      testId('sort-menu')
    );
  });
};

// Builds a single row of the sort dom
// Takes the colRef, current sortSpec and array of column select options to show
// in the column select dropdown.
ViewConfigTab.prototype._buildSortRow = function(colRef, sortSpec, columns) {
  const holder = new MultiHolder();

  const col           = Computed.create(holder, () => colRef);
  const details       = Computed.create(holder, (use) => Sort.specToDetails(Sort.findCol(use(sortSpec), colRef)));
  const hasSpecs      = Computed.create(holder, details, (_, details) => Sort.hasOptions(details));
  const isAscending   = Computed.create(holder, details, (_, details) => details.direction === Sort.ASC);

  col.onWrite((newRef) => {
    let specs = sortSpec.peek();
    const colSpec = Sort.findCol(specs, colRef);
    const newSpec = Sort.findCol(specs, newRef);
    if (newSpec) {
      // this column is already there so only swap order
      specs = Sort.swap(specs, colRef, newRef);
      // but keep the directions
      specs = Sort.setSortDirection(specs, colRef, Sort.direction(newSpec))
      specs = Sort.setSortDirection(specs, newRef, Sort.direction(colSpec))
    } else {
      specs = Sort.replace(specs, colRef, Sort.createColSpec(newRef, Sort.direction(colSpec)));
    }
    this._saveSort(specs);
  });

  const computedFlag = (flag, allowedTypes, label) => {
    const computed = Computed.create(holder, details, (_, details) => details[flag] || false);
    computed.onWrite(value => {
      const specs = sortSpec.peek();
      // Get existing details
      const details = Sort.specToDetails(Sort.findCol(specs, colRef));
      // Update flags
      details[flag] = value;
      // Replace the colSpec at the index
      this._saveSort(Sort.replace(specs, Sort.getColRef(colRef), details));
    });
    return {computed, allowedTypes, flag, label};
  }
  const orderByChoice = computedFlag('orderByChoice', ['Choice'], 'Use choice position');
  const naturalSort   = computedFlag('naturalSort', ['Text'], 'Natural sort');
  const emptyLast     = computedFlag('emptyLast', null, 'Empty values last');
  const flags = [orderByChoice, emptyLast, naturalSort];

  const column = columns.get().find(col => col.value === Sort.getColRef(colRef));

  return cssSortRow(
    grainjsDom.autoDispose(holder),
    cssSortSelect(
      select(col, columns)
    ),
    // Use domComputed method for this icon, for dynamic testId, otherwise
    // we are not able add it dynamically.
    grainjsDom.domComputed(isAscending, isAscending =>
      cssSortIconPrimaryBtn(
        "Sort",
        grainjsDom.style("transform", isAscending ? "scaleY(-1)" : "none"),
        grainjsDom.on("click", () => {
          this._saveSort(Sort.flipSort(sortSpec.peek(), colRef));
        }),
        testId("sort-order"),
        testId(isAscending ? "sort-order-asc" : "sort-order-desc")
      )
    ),
    cssSortIconBtn('Remove',
      grainjsDom.on('click', () => {
        const specs = sortSpec.peek();
        if (Sort.findCol(specs, colRef)) {
          this._saveSort(Sort.removeCol(specs, colRef));
        }
      }),
      testId('sort-remove')
    ),
    cssMenu(
      cssBigIconWrapper(
        cssIcon('Dots', grainjsDom.cls(cssBgLightGreen.className, hasSpecs)),
        testId('sort-options-icon'),
      ),
      menu(_ctl => flags.map(({computed, allowedTypes, flag, label}) => {
        // when allowedTypes is null, flag can be used for every column
        const enabled = !allowedTypes || allowedTypes.includes(column.type);
        return cssMenuItem(
            labeledLeftSquareCheckbox(
              computed,
              label,
              grainjsDom.prop('disabled', !enabled),
            ),
            grainjsDom.cls(cssOptionMenuItem.className),
            grainjsDom.cls('disabled', !enabled),
            testId('sort-option'),
            testId(`sort-option-${flag}`),
          );
        },
      ))
    ),
    testId('sort-row')
  );
};

// Build the button to open the menu to add a sort item to the sort dom.
// Takes the full array of sortable column select options.
ViewConfigTab.prototype._buildAddToSortBtn = function(columns) {
  // Observable indicating whether the add new column row is visible.
  const showAddNew = Observable.create(null, false);
  const available = Computed.create(null, (use) => {
    const currentSection = use(this.activeSectionData).section;
    const currentSortSpec = use(currentSection.activeSortSpec);
    const specRowIds = new Set(currentSortSpec.map(_sortRef => Sort.getColRef(_sortRef)));
    return use(columns)
      .filter(_col => !specRowIds.has(_col.value))
  });
  return [
    // Add column button.
    cssRow(
      grainjsDom.autoDispose(showAddNew),
      grainjsDom.autoDispose(available),
      cssTextBtn(
        cssPlusIcon('Plus'), 'Add Column',
        testId('sort-add')
      ),
      grainjsDom.hide((use) => use(showAddNew) || !use(available).length),
      grainjsDom.on('click', () => { showAddNew.set(true); }),
    ),
    // Fake add column row that appears only when the menu is open to select a new column
    // to add to the sort. Immediately destroyed when menu is closed.
    grainjsDom.maybe((use) => use(showAddNew) && use(available), _columns => {
      const col = Observable.create(null, 0);
      const currentSection = this.activeSectionData().section;
      // Function called when a column select value is clicked.
      const onClick = (_col) => {
        showAddNew.set(false); // Remove add row ASAP to prevent flickering
        addToSort(currentSection.activeSortSpec, _col.value, 1);
      };
      const menuCols = _columns.map(_col =>
        menuItem(() => onClick(_col),
          cssMenuIcon(_col.icon),
          _col.label,
          testId('sort-add-menu-row')
        )
      );
      return cssRow(cssSortRow(
        dom.autoDispose(col),
        cssSortSelect(
          select(col, [], {defaultLabel: 'Add Column'}),
          menu(() => [
            menuCols,
            grainjsDom.onDispose(() => { showAddNew.set(false); })
          ], {
            // Trigger to make menu open immediately
            trigger: [(elem, ctl) => {
              ctl.open();
              grainjsDom.onElem(elem, 'click', () => { ctl.close(); });
            }],
            stretchToSelector: `.${cssSortSelect.className}`
          })
        ),
        cssSortIconPrimaryBtn('Sort',
          grainjsDom.style('transform', 'scaleY(-1)')
        ),
        cssSortIconBtn('Remove'),
        cssBigIconWrapper(cssIcon('Dots')),
      ));
    })
  ];
};

ViewConfigTab.prototype._saveSort = function(sortSpec) {
  this.activeSectionData().section.activeSortSpec(sortSpec);
};

ViewConfigTab.prototype._makeOnDemand = function(table) {
  // After saving the changed setting, force the reload of the document.
  const onConfirm = () => {
    return table.onDemand.saveOnly(!table.onDemand.peek())
    .then(() => {
      return this.gristDoc.docComm.reloadDoc()
      .catch((err) => {
        // Ignore the expected error from the socket shutdown that we asked for.
        if (!err.message.includes('GristWSConnection disposed')) {
          throw err;
        }
      })
    });
  }

  if (table.onDemand()) {
    confirmModal('Unmark table On-Demand?', 'Unmark On-Demand', onConfirm,
      dom('div', 'If you unmark table ', dom('b', table), ' as On-Demand, ' +
        'its data will be loaded into the calculation engine and will be available ' +
        'for use in formulas. For a big table, this may greatly increase load times.',
        dom('br'), dom('br'), 'Changing this setting will reload the document for all users.')
    );
  } else {
    confirmModal('Make table On-Demand?', 'Make On-Demand', onConfirm,
      dom('div', 'If you make table ', dom('b', table), ' On-Demand, ' +
        'its data will no longer be loaded into the calculation engine and will not be available ' +
        'for use in formulas. It will remain available for viewing and editing.',
        dom('br'), dom('br'), 'Changing this setting will reload the document for all users.')
    );
  }
};

ViewConfigTab.prototype._buildAdvancedSettingsDom = function() {
  return kd.maybe(() => {
    const s = this.activeSectionData();
    return s && !s.section.table().summarySourceTable() ? s : null;
  }, (sectionData) => {

    const table = sectionData.section.table();
    const isCollapsed = ko.observable(true);
    return [
      kf.collapserLabel(isCollapsed, 'Advanced settings', dom.testId('ViewConfig_advanced')),
      kf.helpRow(kd.hide(isCollapsed),
        'Big tables may be marked as "on-demand" to avoid loading them into the data engine.',
        kd.style('text-align', 'left'),
        kd.style('margin-top', '1.5rem')
      ),
      kf.row(kd.hide(isCollapsed),
        kf.label('Table ', dom('b', kd.text(table.tableId)), ':')
      ),
      kf.row(kd.hide(isCollapsed),
        kf.buttonGroup(kf.button(() => this._makeOnDemand(table),
          kd.text(() => table.onDemand() ? 'Unmark On-Demand' : 'Make On-Demand'),
          dom.testId('ViewConfig_onDemandBtn')
        ))
      ),
    ];
  });
};

ViewConfigTab.prototype._buildFilterDom = function() {
  return grainjsDom.maybe(this.activeSectionData, (sectionData) => {
    const section = sectionData.section;
    const docModel = this.gristDoc.docModel;
    const popupControls = new WeakMap();
    const activeFilterBar = section.activeFilterBar;

    const hasChangedObs = Computed.create(null, (use) => use(section.filterSpecChanged) || !use(section.activeFilterBar.isSaved))

    async function save() {
      await docModel.docData.bundleActions("Update Filter settings", () => Promise.all([
        section.saveFilters(),          // Save filter
        section.activeFilterBar.save(), // Save bar
      ]));
    }
    function revert() {
      section.revertFilters();          // Revert filter
      section.activeFilterBar.revert(); // Revert bar
    }

    return [
      grainjsDom.forEach(section.activeFilters, (filterInfo) => {
        return cssRow(
          cssIconWrapper(
            cssFilterIcon('FilterSimple', cssNoMarginLeft.cls('')),
            attachColumnFilterMenu(section, filterInfo, {
              placement: 'bottom-end', attach: 'body',
              trigger: [
                'click',
                (_el, popupControl) => popupControls.set(filterInfo.fieldOrColumn.origCol(), popupControl)
              ],
            }),
          ),
          cssLabel(grainjsDom.text(filterInfo.fieldOrColumn.label)),
          cssIconWrapper(
            cssFilterIcon('Remove',
              dom.on('click', () => section.setFilter(filterInfo.fieldOrColumn.origCol().origColRef(), '')),
              testId('remove-filter')
            ),
          ),
          testId('filter'),
        );
      }),
      cssRow(
        grainjsDom.domComputed((use) => {
          const filters = use(section.filters);
          return cssTextBtn(
            cssPlusIcon('Plus'), 'Add Filter',
            addFilterMenu(filters, section, popupControls, {placement: 'bottom-end'}),
            testId('add-filter-btn'),
          );
        }),
      ),
      cssRow(
        cssTextBtn(
          testId('toggle-filter-bar'),
          grainjsDom.domComputed((use) => {
            const filterBar = use(activeFilterBar);
            return cssPlusIcon(
              filterBar ? "Tick" : "Plus",
              cssIcon.cls('-green', Boolean(filterBar)),
              testId('toggle-filter-bar-icon'),
            );
          }),
          grainjsDom.on('click', () => activeFilterBar(!activeFilterBar.peek())),
          'Toggle Filter Bar',
        )
      ),
      grainjsDom.maybe(hasChangedObs, () => cssRow(
        cssExtraMarginTop.cls(''),
        testId('save-filter-btns'),
        primaryButton(
          'Save', {style: 'margin-right: 8px'},
          grainjsDom.on('click', save),
          grainjsDom.boolAttr('disabled', this.gristDoc.isReadonly),
        ),
        basicButton(
          'Revert',
          grainjsDom.on('click', revert),
        )
      ))
    ];
  });
};

ViewConfigTab.prototype._buildThemeDom = function() {
  return kd.maybe(this.activeSectionData, (sectionData) => {
    var section = sectionData.section;
    if (this.isDetail()) {
      const theme = Computed.create(null, (use) => use(section.themeDef));
      theme.onWrite(val => section.themeDef.setAndSave(val));
      return cssRow(
        dom.autoDispose(theme),
        select(theme, [
          {label: 'Form',        value: 'form'   },
          {label: 'Compact',     value: 'compact'},
          {label: 'Blocks',      value: 'blocks'  },
        ]),
        testId('detail-theme')
      );
    }
  });
};

ViewConfigTab.prototype._buildChartConfigDom = function() {
  return grainjsDom.maybe(this.viewModel.activeSection, (section) => grainjsDom.create(ChartConfig, this.gristDoc, section));
};

ViewConfigTab.prototype._buildLayoutDom = function() {
  return kd.maybe(this.activeSectionData, (sectionData) => {
    if (this.isDetail()) {
      const view = sectionData.section.viewInstance.peek();
      const layoutEditorObs = ko.computed(() => view && view.recordLayout && view.recordLayout.layoutEditor());
      return cssRow({style: 'margin-top: 16px;'},
        kd.maybe(layoutEditorObs, (editor) => editor.buildFinishButtons()),
        primaryButton('Edit Card Layout',
          dom.autoDispose(layoutEditorObs),
          dom.on('click', () => commands.allCommands.editLayout.run()),
          grainjsDom.hide(layoutEditorObs),
          testId('detail-edit-layout')
        )
      );
    }
  });
};

/**
 * Builds the three items for configuring a `Custom View`:
 *  1) Mode picker: let user choose between 'url' and 'plugin' mode
 *  2) Show if 'url' mode: let user enter the url
 *  3) Show if 'plugin' mode: let user pick a plugin and a section from the list of available plugin.
 */
ViewConfigTab.prototype._buildCustomTypeItems = function() {
  const docPluginManager = this.gristDoc.docPluginManager;
  const activeSection = this.viewModel.activeSection;

  // all available custom sections grouped by their plugin id
  const customSections = _.groupBy(CustomSectionElement.getSections(docPluginManager.pluginsList), s => s.pluginId);

  // all plugin ids which have custom sections
  const allPlugins = Object.keys(customSections);

  // the list of customSections of the selected plugin (computed)
  const customSectionIds = ko.pureComputed(() => {
    const sections = customSections[this.viewModel.activeSection().customDef.pluginId()] || [];
    return sections.map(({sectionId}) => sectionId);
  });

  return [{

    // 1)
    buildDom: () => kd.scope(activeSection, ({customDef}) => kf.buttonSelect(customDef.mode,
      kf.optionButton('url', 'URL', dom.testId('ViewConfigTab_customView_url')),
      kf.optionButton('plugin', 'Plugin', dom.testId('ViewConfigTab_customView_plugin'))))
  }, {

    // 2)
    // TODO: refactor this part, Custom Widget moved to separate file.
  }, {

    // 3)
    showObs: () => activeSection().customDef.mode() === "plugin",
    buildDom: () => kd.scope(activeSection, ({customDef}) => dom('div',
      kf.row(5, "Plugin: ", 13, kf.text(customDef.pluginId, {}, {list: "list_plugin"}, dom.testId('ViewConfigTab_customView_pluginId'))),
      kf.row(5, "Section: ", 13, kf.text(customDef.sectionId, {}, {list: "list_section"},  dom.testId('ViewConfigTab_customView_sectionId'))),
      // For both `customPlugin` and `selectedSection` it is possible for the value not to be in the
      // list of options. Combining <datalist> and <input> allows both to freely edit the value with
      // keyboard and to select it from a list. Although the content of the list seems to be
      // filtered by the current value, which could confuse user into thinking that there are no
      // available options. I think it would be better to have the full list always, but it seems
      // harder to accomplish and is left as a TODO.
      dom('datalist#list_plugin',  kd.foreach(koArray(allPlugins), value => dom('option', {value}))),
      dom('datalist#list_section', kd.scope(customSectionIds, sections => kd.foreach(koArray(sections), (value) => dom('option', {value}))))
      ))
  }];
};

const cssMenuIcon = styled(cssIcon, `
  margin: 0 8px 0 0;

  .${cssMenuItem.className}-sel > & {
    background-color: ${colors.light};
  }
`);

// Note that the width is set to 0 so that flex-shrink works properly with long text values.
const cssSortSelect = styled('div', `
  flex: 1 1 0px;
  margin: 0 6px 0 0;
  min-width: 0;
`);

const cssSortIconBtn = styled(cssIcon, `
  flex: none;
  margin: 0 6px;
  cursor: pointer;
  background-color: ${colors.slate};

  &:hover {
    background-color: ${colors.dark};
  }
`);

const cssSortIconPrimaryBtn = styled(cssSortIconBtn, `
  background-color: ${colors.lightGreen};

  &:hover {
    background-color: ${colors.darkGreen};
  }
`);

const cssTextBtn = styled('div', `
  color: ${colors.lightGreen};
  cursor: pointer;

  &:hover {
    color: ${colors.darkGreen};
  }
`);

const cssPlusIcon = styled(cssIcon, `
  background-color: ${colors.lightGreen};
  cursor: pointer;
  margin: 0px 4px 3px 0;

  .${cssTextBtn.className}:hover > & {
    background-color: ${colors.darkGreen};
  }
`);

const cssDragRow = styled('div', `
  display: flex !important;
  align-items: center;
  margin: 0 16px 0px 0px;
  & > .kf_draggable_content {
    margin: 6px 0;
    flex: 1 1 0px;
    min-width: 0px;
  }
`);

const cssSortRow = styled('div', `
  display: flex;
  align-items: center;
  width: 100%;
`);

const cssFlex = styled('div', `
  flex: 1 1 0;
`);

const cssLabel = styled('div', `
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
  flex-grow: 1;
`);

const cssExtraMarginTop = styled('div', `
  margin-top: 28px;
`);

const cssFilterIcon = cssSortIconBtn;

const cssNoMarginLeft = styled('div', `
  margin-left: 0;
`);

const cssIconWrapper = styled('div', ``);

const cssBigIconWrapper = styled('div', `
  padding: 3px;
  border-radius: 3px;
  cursor: pointer;
  user-select: none;
`);

const cssMenu = styled('div', `
  display: inline-flex;
  cursor: pointer;
  border-radius: 3px;
  border: 1px solid transparent;
  &:hover, &.weasel-popup-open {
    background-color: ${colors.mediumGrey};
  }
`);

const cssBgLightGreen = styled(`div`, `
  background: ${colors.lightGreen}
`)

const cssOptionMenuItem = styled('div', `
  &:hover {
    background-color: ${colors.mediumGrey};
  }
  & label {
    flex: 1;
    cursor: pointer;
  }
  &.disabled * {
    color: ${colors.darkGrey} important;
    cursor: not-allowed;
  }
`)

module.exports = ViewConfigTab;
