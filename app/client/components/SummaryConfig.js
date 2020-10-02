const ko = require('knockout');
const dispose = require('../lib/dispose');
const dom = require('../lib/dom');
const kd = require('../lib/koDom');
const kf = require('../lib/koForm');
const koArray = require('../lib/koArray');
const multiselect = require('../lib/multiselect');
const modelUtil = require('../models/modelUtil');
const gutil = require('app/common/gutil');


/**
 * Maintains the part of side-pane configuration responsible for summary tables. In particular, it
 * allows the user to see and change group-by columns.
 * @param {GristDoc} options.gristDoc: the GristDoc instance.
 * @param {observable} options.section: the observable for the ViewSection RowModel being configured.
 */
function SummaryConfig(options) {
  this.gristDoc = options.gristDoc;
  this.section = options.section;

  // Whether or not this is a summary section at all.
  this.isSummarySection = this.autoDispose(ko.computed(() =>
    Boolean(this.section().table().summarySourceTable())));

  // Observable for the RowModel for the source table for this summary table.
  this._summarySourceTable = this.autoDispose(ko.computed(() =>
    this.section().table().summarySource()
  ));

  // Observable for the array of colRefs for the source group-by columns. It may be saved to sync
  // to the server, or reverted.
  this._groupByCols = this.autoDispose(modelUtil.customComputed({
    read: () => (
      this.section().viewFields().all().map(f => f.column().summarySourceCol())
      .concat(
        // If there are hidden group-by columns, list those as well.
        this.section().hiddenColumns().map(col => col.summarySourceCol())
      )
      .filter(scol => scol)
    ),
    save: colRefs => this.gristDoc.docData.sendAction(
      ["UpdateSummaryViewSection", this.section().getRowId(), colRefs]
    )
  }));

  // Observable for the same set of colRefs as in this._groupByCols, for faster lookups.
  this._groupBySourceColSet = this.autoDispose(ko.computed(() => new Set(this._groupByCols())));

  // KoArray for the RowModels for the source group-by columns.
  this._groupByItems = this.autoDispose(koArray.syncedKoArray(this._groupByCols,
    colRef => this.gristDoc.docModel.columns.getRowModel(colRef)));
}
dispose.makeDisposable(SummaryConfig);


/**
 * Helper that implements the auto-complete search of columns available for group-by.
 * Calls response() with a list of {label, value} objects, where 'label' is the colId, and 'value'
 * is the rowId.
 */
SummaryConfig.prototype._groupBySearch = function(request, response) {
  response(
    this._summarySourceTable().columns().peek().filter(c => {
      return gutil.startsWith(c.label().toLowerCase(), request.term.toLowerCase()) &&
        !this._groupBySourceColSet().has(c.getRowId()) && !c.isHiddenCol();
    })
    .map(c => ({label: c.label(), value: c.getRowId()}))
  );
};


/**
 * Saves this summary table as an independent table.
 */
SummaryConfig.prototype._saveAsTable = function() {
  return this.gristDoc.docData.sendAction(
    ["DetachSummaryViewSection", this.section().getRowId()]);
};


/**
 * Build the DOM for summary table config.
 */
SummaryConfig.prototype.buildSummaryConfigDom = function() {
  return dom('div',
    dom.testId('SummaryConfig'),
    dom('div.multiselect-hint', 'Select columns to group by.'),
    multiselect(this._groupBySearch.bind(this), this._groupByItems, col => {
      return dom('div.multiselect-label', kd.text(col.label));
    }, {
      // Shows up when no group-by columns are selected
      hint: "Showing totals.",

      add: item => this._groupByCols.modifyAssign(colRefs =>
        colRefs.push(item.value)),

      remove: col => this._groupByCols.modifyAssign(colRefs =>
        gutil.arrayRemove(colRefs, col.getRowId())),

      reorder: (col, nextCol) => this._groupByCols.modifyAssign(colRefs => {
        gutil.arrayRemove(colRefs, col.getRowId());
        gutil.arrayInsertBefore(colRefs, col.getRowId(), nextCol ? nextCol.getRowId() : null);
      }),
    }),

    kf.row(
      2, kf.buttonGroup(
        kf.button(() => this._groupByCols.revert(),
          kd.toggleClass('disabled', this._groupByCols.isSaved),
          'Cancel'
        ),
        kf.button(() => this._groupByCols.save(),
          kd.toggleClass('disabled', this._groupByCols.isSaved),
          'Apply'
        )
      ),
      1, kf.buttonGroup(
        kf.button(() => this._saveAsTable(),
          { title: 'Save summary as a separate table' },
          'Detach'
        )
      )
    )
  );
};


module.exports = SummaryConfig;
