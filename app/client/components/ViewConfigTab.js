var _ = require('underscore');
var ko = require('knockout');
var dispose = require('../lib/dispose');
var dom = require('../lib/dom');
var kd = require('../lib/koDom');
var kf = require('../lib/koForm');
var koArray = require('../lib/koArray');
var SummaryConfig = require('./SummaryConfig');
var commands = require('./commands');
var {CustomSectionElement} = require('../lib/CustomSectionElement');
const {buildChartConfigDom} = require('./ChartView');
const {Computed, dom: grainjsDom, makeTestId, Observable, styled} = require('grainjs');
const {VisibleFieldsConfig} = require('app/client/ui/VisibleFieldsConfig');

const {addToSort, flipColDirection, parseSortColRefs} = require('app/client/lib/sortUtil');
const {reorderSortRefs, updatePositions} = require('app/client/lib/sortUtil');
const {cssIcon, cssRow} = require('app/client/ui/RightPanel');
const {basicButton, primaryButton} = require('app/client/ui2018/buttons');
const {colors} = require('app/client/ui2018/cssVars');
const {cssDragger} = require('app/client/ui2018/draggableList');
const {menu, menuItem, select} = require('app/client/ui2018/menus');
const {confirmModal} = require('app/client/ui2018/modals');
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
    return ['detail','single'].includes(this.viewModel.activeSection().parentKey());
  }, this));
  this.isChart = this.autoDispose(ko.computed(function() {
      return this.viewModel.activeSection().parentKey() === 'chart';}, this));
  this.isGrid = this.autoDispose(ko.computed(function() {
      return this.viewModel.activeSection().parentKey() === 'record';}, this));
  this.isCustom = this.autoDispose(ko.computed(function() {
      return this.viewModel.activeSection().parentKey() === 'custom';}, this));

  this._summaryConfig = this.autoDispose(SummaryConfig.create({
    gristDoc: this.gristDoc,
    section: this.viewModel.activeSection
  }));

  if (!options.skipDomBuild) {
    this.gristDoc.addOptionsTab(
      'View', dom('span.glyphicon.glyphicon-credit-card'),
      this.buildConfigDomObj(),
      { 'category': 'options', 'show': this.activeSectionData }
    );
  }
}
dispose.makeDisposable(ViewConfigTab);


function getLabelFunc(field) { return field ? field.label() : null; }

ViewConfigTab.prototype._buildSectionFieldsConfig = function() {
  var self = this;
  return kd.maybe(this.activeSectionData, function(sectionData) {
    const visibleFieldsConfig = VisibleFieldsConfig.create(null, self.gristDoc, sectionData.section, false);
    const [fieldsDraggable, hiddenFieldsDraggable] = visibleFieldsConfig.buildSectionFieldsConfigHelper({
      visibleFields: { itemCreateFunc: getLabelFunc },
      hiddenFields: {itemCreateFunc: getLabelFunc }
    });
    return dom('div',
      dom.autoDispose(visibleFieldsConfig),
      kf.collapsible(function(isCollapsed) {
        return [
          kf.collapserLabel(isCollapsed, 'Visible Fields', kd.toggleClass('view_config_field_group', true)),
          dom.testId('ViewConfigTab_visibleFields'),
          fieldsDraggable,
        ];
      }, false),

      kf.collapsible(function(isCollapsed) {
        return [
          kf.collapserLabel(isCollapsed, 'Hidden Fields', kd.toggleClass('view_config_field_group', true)),
          dom.testId('ViewConfigTab_hiddenFields'),
          hiddenFieldsDraggable,
        ];
      }, false),
    );
  });
};

// Builds object with ViewConfigTab dom builder and settings for the sidepane.
ViewConfigTab.prototype.buildConfigDomObj = function() {
  return [{
      'buildDom': this._buildNameDom.bind(this),
      'keywords': ['view', 'name', 'title']
    }, {
      'buildDom': this._buildSectionNameDom.bind(this),
      'keywords': ['section', 'viewsection', 'name', 'title']
    }, {
      'buildDom': this._buildAdvancedSettingsDom.bind(this),
      'keywords': ['table', 'demand', 'ondemand', 'big']
    }, {
      'header': true,
      'label': 'Summarize',
      'showObs': this._summaryConfig.isSummarySection,
      'items': [{
        'buildDom': () => this._summaryConfig.buildSummaryConfigDom(),
        'keywords': ['section', 'summary', 'summarize', 'group', 'breakdown']
      }]
    }, {
      'header': true,
      'label': 'Sort',
      'items': [{
          'buildDom': this.buildSortDom.bind(this),
          'keywords': ['section', 'sort', 'order']
        }]
    }, {
      'header': true,
      'label': 'Filter',
      'items': [{
          'buildDom': this._buildFilterDom.bind(this),
          'keywords': ['section', 'filters']
        }]
    }, {
      'header': true,
      'label': 'Link Sections',
      'items': [{
          'buildDom': this._buildLinkDom.bind(this),
          'keywords': ['section', 'view', 'linking', 'edit', 'autoscroll', 'autofilter']
        }]
    }, {
      'header': true,
      'label': 'Customize Detail View',
      'showObs': this.isDetail,
      'items': [{
          'buildDom': this._buildDetailTypeDom.bind(this),
          'keywords': ['section', 'detail']
        }, {
          'buildDom': this._buildThemeDom.bind(this),
          'keywords': ['section', 'theme', 'appearance', 'detail']
        }, {
          'buildDom': this._buildLayoutDom.bind(this),
          'keywords': ['section', 'layout', 'arrangement', 'rearrange']
        }]
    }, {
      'header': true,
      'label': 'Customize Grid View',
      'showObs': this.isGrid,
      'items': [{
        'buildDom': this._buildGridStyleDom.bind(this),
        'keywords': ['section', 'zebra', 'stripe', 'appearance', 'grid', 'gridlines', 'style', 'border']
        }]
    }, {
      'header': true,
      'label': 'Chart',
      'showObs': this.isChart,
      'items': [{
        'buildDom': () => this._buildChartConfigDom()
      }]
    }, {
      'header': true,
      'label': 'Custom View',
      'showObs': this.isCustom,
      'items': this._buildCustomTypeItems(),
      'keywords': ['section', 'custom']
    }, {
      'header': true,
      'label': 'Column Display',
      'items': [{
          'buildDom': this._buildSectionFieldsConfig.bind(this),
          'keywords': ['section', 'fields', 'hidden', 'hide', 'show', 'visible']
        }]
    }];
};

ViewConfigTab.prototype.buildSortDom = function() {
  return grainjsDom.maybe(this.activeSectionData, (sectionData) => {
    const section = sectionData.section;

    // Computed to indicate if sort has changed from saved.
    const hasChanged = Computed.create(null, (use) =>
      !isEqual(use(section.activeSortSpec), parseSortColRefs(use(section.sortColRefs))));

    // Computed array of sortable columns.
    const columns = Computed.create(null, (use) => {
      // Columns is an observable holding an observable array - must call 'use' on it 2x.
      const cols = use(use(use(section.table).columns));
      return cols.filter(col => !use(col.isHiddenCol))
                 .map(col => ({
                   label: use(col.colId),
                   value: col.getRowId(),
                   icon: 'FieldColumn'
                 }));
    });

    // KoArray of sortRows used to create the draggableList.
    const sortRows = koArray.syncedKoArray(section.activeSortSpec);

    // Sort row create function for each sort row in the draggableList.
    const rowCreateFn = sortRef =>
      this._buildSortRow(sortRef, section.activeSortSpec.peek(), columns);

    // Reorder function called when sort rows are reordered via dragging.
    const reorder = (...args) => {
      const spec = reorderSortRefs(section.activeSortSpec.peek(), ...args);
      this._saveSort(spec);
    };

    return grainjsDom('div',
      grainjsDom.autoDispose(hasChanged),
      grainjsDom.autoDispose(columns),
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
// Takes the sortRef (signed colRef), current sortSpec and array of column select options to show
// in the column select dropdown.
ViewConfigTab.prototype._buildSortRow = function(sortRef, sortSpec, columns) {
  // sortRef is a rowId of a column or its negative value (indicating descending order).
  const colRef = Math.abs(sortRef);
  // Computed to show the selected column at the sortSpec index and to update the
  // sortSpec on write.
  const col = Computed.create(null, () => colRef);
  col.onWrite((newRef) => {
    const idx = sortSpec.findIndex(_sortRef => _sortRef === sortRef);
    const swapIdx = sortSpec.findIndex(_sortRef => Math.abs(_sortRef) === newRef);
    // If the selected ref is already present, swap it with the old ref.
    // Maintain sort order in each case for simplicity.
    if (swapIdx > -1) { sortSpec.splice(swapIdx, 1, sortSpec[swapIdx] > 0 ? colRef : -colRef); }
    if (colRef !== newRef) { sortSpec.splice(idx, 1, sortRef > 0 ? newRef : -newRef); }
    this._saveSort(sortSpec);
  });
  return cssSortRow(
    grainjsDom.autoDispose(col),
    cssSortSelect(
      select(col, columns)
    ),
    cssSortIconPrimaryBtn('Sort',
      grainjsDom.style('transform', sortRef < 0 ? 'none' : 'scaleY(-1)'),
      grainjsDom.on('click', () => {
        this._saveSort(flipColDirection(sortSpec, sortRef));
      }),
      testId('sort-order'),
      testId(sortRef < 0 ? 'sort-order-desc' : 'sort-order-asc')
    ),
    cssSortIconBtn('Remove',
      grainjsDom.on('click', () => {
        const _idx = sortSpec.findIndex(c => c === sortRef);
        if (_idx !== -1) {
          sortSpec.splice(_idx, 1);
          this._saveSort(sortSpec);
        }
      }),
      testId('sort-remove')
    ),
    testId('sort-row')
  );
};

// Build the button to open the menu to add a sort item to the sort dom.
// Takes the full array of sortable column select options.
ViewConfigTab.prototype._buildAddToSortBtn = function(columns) {
  // Observable indicating whether the add new column row is visible.
  const showAddNew = Observable.create(null, false);
  return [
    // Add column button.
    cssRow(
      grainjsDom.autoDispose(showAddNew),
      cssTextBtn(
        cssPlusIcon('Plus'), 'Add Column',
        testId('sort-add')
      ),
      grainjsDom.hide(showAddNew),
      grainjsDom.on('click', () => { showAddNew.set(true); }),
    ),
    // Fake add column row that appears only when the menu is open to select a new column
    // to add to the sort. Immediately destroyed when menu is closed.
    grainjsDom.maybe((use) => use(showAddNew) && use(columns), _columns => {
      const col = Observable.create(null, 0);
      const currentSection = this.activeSectionData().section;
      const currentSortSpec = currentSection.activeSortSpec();
      const specRowIds = new Set(currentSortSpec.map(_sortRef => Math.abs(_sortRef)));
      // Function called when a column select value is clicked.
      const onClick = (_col) => {
        showAddNew.set(false); // Remove add row ASAP to prevent flickering
        addToSort(currentSection.activeSortSpec, _col.value);
      };
      const menuCols = _columns
        .filter(_col => !specRowIds.has(_col.value))
        .map(_col =>
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
        cssSortIconBtn('Remove')
      ));
    })
  ];
};

ViewConfigTab.prototype._saveSort = function(sortSpec) {
  this.activeSectionData().section.activeSortSpec(sortSpec);
};

ViewConfigTab.prototype._buildNameDom = function() {
  return kf.row(
    1, dom('div.glyphicon.glyphicon-tasks.config_icon'),
    4, kf.label('View'),
    13, kf.text(this.viewModel.name, {}, dom.testId('ViewManager_viewNameInput'))
  );
};

ViewConfigTab.prototype._buildSectionNameDom = function() {
  return kd.maybe(this.activeSectionData, function(sectionData) {
    return kf.row(
      1, dom('div.glyphicon.glyphicon-credit-card.config_icon'),
      4, kf.label('Section'),
      13, kf.text(sectionData.section.titleDef, {}, dom.testId('ViewConfigTab_sectionNameInput'))
    );
  });
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

ViewConfigTab.prototype._buildDetailTypeDom = function() {
  return kd.maybe(this.activeSectionData, (sectionData) => {
    var section = sectionData.section;
    if (this.isDetail()) {
      return kf.row(
        1, kf.label('Type'),
        1, kf.buttonSelect(section.parentKey,
          kf.optionButton('detail', 'List', dom.testId('ViewConfigTab_card')),
          kf.optionButton('single', 'Single', dom.testId('ViewConfigTab_detail'))
        )
      );
    }
  });
};

ViewConfigTab.prototype._buildFilterDom = function() {
  return kd.maybe(this.activeSectionData, sectionData => {
    let section = sectionData.section;
    return dom('div',
      kf.row(
        1, dom('div.glyphicon.glyphicon-filter.config_icon'),
        4, kf.label('Filters'),
        13, dom('div.kf_elem', kd.foreach(section.viewFields(), field => {
          return dom('div.filter_list', kd.maybe(field.activeFilter, () => {
            return dom('div.token',
              dom('span.token-label', field.label()),
              dom('span.close.glyphicon.glyphicon-remove',
                dom.on('click', () => { field.activeFilter(''); })
              )
            );
          }));
        }))
      ),
      grainjsDom.maybe(section.filterSpecChanged, () => {
        return kf.prompt(
          kf.liteButtonGroup(
            kf.liteButton(() => section.saveFilters(),
              dom('span.config_icon.left_icon.glyphicon.glyphicon-save'), 'Save',
              dom.testId('ViewConfigTab_saveFilter'),
              kd.toggleClass('disabled', () => this.gristDoc.isReadonlyKo()),
            ),
            kf.liteButton(() => section.revertFilters(),
              dom('span.config_icon.left_icon.glyphicon.glyphicon-refresh'), 'Reset',
              dom.testId('ViewConfigTab_resetFilter')
            )
          )
        );
      })
    );
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

ViewConfigTab.prototype._buildGridStyleDom = function() {

  return kd.maybe(this.activeSectionData, (sectionData) => {
    var section = sectionData.section;
    return dom('div',
      kf.row(
        15, kf.label('Horizontal Gridlines'),
        2, kf.checkbox(section.optionsObj.prop('horizontalGridlines'),
                       dom.testId('ViewConfigTab_hGridButton'))
      ),
      kf.row(
        15, kf.label('Vertical Gridlines'),
        2, kf.checkbox(section.optionsObj.prop('verticalGridlines'),
                       dom.testId('ViewConfigTab_vGridButton'))
      ),
      kf.row(
        15, kf.label('Zebra Stripes'),
        2, kf.checkbox(section.optionsObj.prop('zebraStripes'),
                       dom.testId('ViewConfigTab_zebraStripeButton'))
      ),
      dom.testId('ViewConfigTab_gridOptions')
    );
  });
};

ViewConfigTab.prototype._buildChartConfigDom = function() {
  return grainjsDom.maybe(this.viewModel.activeSection, buildChartConfigDom);
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

ViewConfigTab.prototype._buildLinkDom = function() {
  var linkSpecChanged = ko.computed(() =>
    !this.viewModel.viewSections().all().every(vs => vs.isActiveLinkSaved()));

  return dom('div',
    dom.autoDispose(linkSpecChanged),
    kf.buttonGroup(kf.checkButton(this.viewModel.isLinking,
        dom('span', 'Edit Links', dom.testId('viewConfigTab_link')))),
    kd.maybe(this.activeSectionData, (sectionData) => {
      const section = sectionData.section;
      // This section option affects section linking: it tells a link-target section to show rows
      // matching any of the rows in link-source section, not only the current cursor row.
      const filterByAllShown = section.optionsObj.prop('filterByAllShown');
      return kf.row(
        15, kf.label('Filter by all shown'),
        2, kf.checkbox(filterByAllShown, dom.testId('ViewConfigTab_filterByAll'))
      );
    }),
    kd.maybe(linkSpecChanged, () =>
      kf.prompt(
        kf.liteButtonGroup(
          kf.liteButton(() => {
            commands.allCommands.saveLinks.run();
            this.viewModel.isLinking(false);
          }, dom('span.config_icon.left_icon.glyphicon.glyphicon-save'), 'Save'),
          kf.liteButton(() => commands.allCommands.revertLinks.run(),
            dom('span.config_icon.left_icon.glyphicon.glyphicon-refresh'), 'Reset'
          )
        )
      )
    )
  );
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
    showObs: () => activeSection().customDef.mode() === "url",
    buildDom: () => kd.scope(activeSection, ({customDef}) => dom('div',
      kf.row(18, kf.text(customDef.url, {placeholder: "Full URL of webpage to show"}, dom.testId('ViewConfigTab_url'))),
      kf.row(5, "Access", 13, dom(kf.select(customDef.access, ['none', 'read table', 'full']), dom.testId('ViewConfigTab_customView_access'))),
      kf.helpRow('none: widget has no access to document.',
                 kd.style('text-align', 'left'),
                 kd.style('margin-top', '1.5rem')),
      kf.helpRow('read table: widget can read the selected table.',
                 kd.style('text-align', 'left'),
                 kd.style('margin-top', '1.5rem')),
      kf.helpRow('full: widget can read, modify, and copy the document.',
                 kd.style('text-align', 'left'),
                 kd.style('margin-top', '1.5rem'))
    )),
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
  height: 29px;

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

module.exports = ViewConfigTab;
