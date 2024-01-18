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
const {Computed, dom: grainjsDom, makeTestId, Holder} = require('grainjs');

const {cssRow} = require('app/client/ui/RightPanelStyles');
const {SortFilterConfig} = require('app/client/ui/SortFilterConfig');
const {primaryButton} = require('app/client/ui2018/buttons');
const {select} = require('app/client/ui2018/menus');
const {confirmModal} = require('app/client/ui2018/modals');
const {makeT} = require('app/client/lib/localization');

const testId = makeTestId('test-vconfigtab-');

const t = makeT('ViewConfigTab');

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
  this._viewSectionDataHolder = Holder.create(this);

  // viewModel may point to different views, but viewSectionData is a single koArray reflecting
  // the sections of the current view.
  this.viewSectionData = this.autoDispose(
    koArray.syncedKoArray(this.viewModel.viewSections, function(section) {
      return ViewSectionData.create(section);
    })
    .setAutoDisposeValues()
  );

  this.isDetail = this.autoDispose(ko.computed(function() {
    return ['detail', 'single'].includes(this.viewModel.activeSection().parentKey());
  }, this));
  this.isChart = this.autoDispose(ko.computed(function() {
    return this.viewModel.activeSection().parentKey() === 'chart';}, this));
  this.isGrid = this.autoDispose(ko.computed(function() {
    return this.viewModel.activeSection().parentKey() === 'record';}, this));
  this.isCustom = this.autoDispose(ko.computed(function() {
    return this.viewModel.activeSection().parentKey() === 'custom';}, this));
  this.isRaw = this.autoDispose(ko.computed(function() {
    return this.viewModel.activeSection().isRaw();}, this));
  this.isRecordCard = this.autoDispose(ko.computed(function() {
    return this.viewModel.activeSection().isRecordCard();}, this));

  this.activeRawOrRecordCardSectionData = this.autoDispose(ko.computed(function() {
    return self.isRaw() || self.isRecordCard()
      ? self._viewSectionDataHolder.autoDispose(ViewSectionData.create(self.viewModel.activeSection()))
      : null;
  }));
  this.activeSectionData = this.autoDispose(ko.computed(function() {
    return (
      _.find(self.viewSectionData.all(), function(sectionData) {
        return sectionData.section &&
          sectionData.section.getRowId() === self.viewModel.activeSectionId();
      })
      || self.activeRawOrRecordCardSectionData()
      || self.viewSectionData.at(0)
    );
  }));
}
dispose.makeDisposable(ViewConfigTab);


ViewConfigTab.prototype.buildSortFilterDom = function() {
  return grainjsDom.maybe(this.activeSectionData, ({section}) => {
    return grainjsDom.create(SortFilterConfig, section, this.gristDoc);
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
    confirmModal('Unmark table On-Demand?', 'Unmark On-Demand', onConfirm, {
      explanation: dom('div', 'If you unmark table ', dom('b', table), ' as On-Demand, ' +
        'its data will be loaded into the calculation engine and will be available ' +
        'for use in formulas. For a big table, this may greatly increase load times.',
        dom('br'), dom('br'), 'Changing this setting will reload the document for all users.'),
    });
  } else {
    confirmModal('Make table On-Demand?', 'Make On-Demand', onConfirm, {
      explanation: dom('div', 'If you make table ', dom('b', table), ' On-Demand, ' +
        'its data will no longer be loaded into the calculation engine and will not be available ' +
        'for use in formulas. It will remain available for viewing and editing.',
        dom('br'), dom('br'), 'Changing this setting will reload the document for all users.'),
    });
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
      kf.collapserLabel(isCollapsed, t("Advanced settings"), dom.testId('ViewConfig_advanced')),
      kf.helpRow(kd.hide(isCollapsed),
        t("Big tables may be marked as \"on-demand\" to avoid loading them into the data engine."),
        kd.style('text-align', 'left'),
        kd.style('margin-top', '1.5rem')
      ),
      kf.row(kd.hide(isCollapsed),
        dom('div', primaryButton(
          kd.text(() => table.onDemand() ? t("Unmark On-Demand") : t("Make On-Demand")),
          kd.style('margin-top', '1rem'),
          dom.on('click', () => this._makeOnDemand(table)),
          dom.testId('ViewConfig_onDemandBtn'),
        )),
      ),
    ];
  });
};

ViewConfigTab.prototype._buildThemeDom = function() {
  return kd.maybe(() => this.isDetail() ? this.activeSectionData() : null, (sectionData) => {
    const section = sectionData.section;
    const theme = Computed.create(null, (use) => use(section.themeDef));
    theme.onWrite(val => section.themeDef.setAndSave(val));
    return cssRow(
      dom.autoDispose(theme),
      select(theme, [
        {label: t("Form"),        value: 'form'   },
        {label: t("Compact"),     value: 'compact'},
        {label: t("Blocks"),      value: 'blocks'  },
      ]),
      testId('detail-theme')
    );
  });
};

ViewConfigTab.prototype._buildChartConfigDom = function() {
  return grainjsDom.maybe(this.viewModel.activeSection, (section) => grainjsDom.create(ChartConfig, this.gristDoc, section));
};

ViewConfigTab.prototype._buildLayoutDom = function() {
  return kd.maybe(() => this.isDetail() ? this.activeSectionData() : null, (sectionData) => {
    const view = sectionData.section.viewInstance.peek();
    const layoutEditorObs = ko.computed(() => view && view.recordLayout && view.recordLayout.layoutEditor());
    return cssRow({style: 'margin-top: 16px;'},
      kd.maybe(layoutEditorObs, (editor) => editor.buildFinishButtons()),
      primaryButton(t("Edit Card Layout"),
        dom.autoDispose(layoutEditorObs),
        dom.on('click', () => commands.allCommands.editLayout.run()),
        grainjsDom.hide(layoutEditorObs),
        grainjsDom.cls('behavioral-prompt-edit-card-layout'),
        testId('detail-edit-layout'),
      )
    );
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
      kf.row(5, t("Plugin: "), 13, kf.text(customDef.pluginId, {}, {list: "list_plugin"}, dom.testId('ViewConfigTab_customView_pluginId'))),
      kf.row(5, t("Section: "), 13, kf.text(customDef.sectionId, {}, {list: "list_section"},  dom.testId('ViewConfigTab_customView_sectionId'))),
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

module.exports = ViewConfigTab;
