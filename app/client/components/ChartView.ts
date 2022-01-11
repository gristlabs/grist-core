import * as BaseView from 'app/client/components/BaseView';
import {GristDoc} from 'app/client/components/GristDoc';
import {consolidateValues, formatPercent, sortByXValues, splitValuesByIndex,
        uniqXValues} from 'app/client/lib/chartUtil';
import {Delay} from 'app/client/lib/Delay';
import {Disposable} from 'app/client/lib/dispose';
import {fromKoSave} from 'app/client/lib/fromKoSave';
import {loadPlotly, PlotlyType} from 'app/client/lib/imports';
import * as DataTableModel from 'app/client/models/DataTableModel';
import {ViewFieldRec, ViewSectionRec} from 'app/client/models/DocModel';
import {reportError} from 'app/client/models/errors';
import {KoSaveableObservable, ObjObservable} from 'app/client/models/modelUtil';
import {SortedRowSet} from 'app/client/models/rowset';
import {cssLabel, cssRow, cssSeparator} from 'app/client/ui/RightPanel';
import {cssFieldEntry, cssFieldLabel, IField, VisibleFieldsConfig } from 'app/client/ui/VisibleFieldsConfig';
import {squareCheckbox} from 'app/client/ui2018/checkbox';
import {colors, vars} from 'app/client/ui2018/cssVars';
import {cssDragger} from 'app/client/ui2018/draggableList';
import {icon} from 'app/client/ui2018/icons';
import {linkSelect, menu, menuItem, select} from 'app/client/ui2018/menus';
import {nativeCompare} from 'app/common/gutil';
import {BaseFormatter} from 'app/common/ValueFormatter';
import {decodeObject} from 'app/plugin/objtypes';
import {Events as BackboneEvents} from 'backbone';
import {Computed, dom, DomContents, DomElementArg, fromKo, Disposable as GrainJSDisposable, IOption,
  makeTestId, Observable, styled} from 'grainjs';
import * as ko from 'knockout';
import clamp = require('lodash/clamp');
import debounce = require('lodash/debounce');
import defaults = require('lodash/defaults');
import defaultsDeep = require('lodash/defaultsDeep');
import isNumber = require('lodash/isNumber');
import sum = require('lodash/sum');
import {Annotations, Config, Data, Datum, ErrorBar, Layout, LayoutAxis, Margin} from 'plotly.js';


let Plotly: PlotlyType;

// When charting multiple series based on user data, limit the number of series given to plotly.
const MAX_SERIES_IN_CHART = 100;
const DONUT_DEFAULT_HOLE_SIZE = 0.75;
const DONUT_DEFAULT_TEXT_SIZE = 24;

const testId = makeTestId('test-chart-');

function isPieLike(chartType: string) {
  return ['pie', 'donut'].includes(chartType);
}


interface ChartOptions {
  multiseries?: boolean;
  lineConnectGaps?: boolean;
  lineMarkers?: boolean;
  invertYAxis?: boolean;
  logYAxis?: boolean;
  // If "symmetric", one series after each Y series gives the length of the error bars around it. If
  // "separate", two series after each Y series give the length of the error bars above and below it.
  errorBars?: 'symmetric' | 'separate';
  donutHoleSize?: number;
  showTotal?: boolean;
  textSize?: number;
}

// tslint:disable:no-console

// We use plotly's Datum to describe the type of values in cells. Cells may not match this
// perfectly, but it's helpful for type-checking anyway.
type RowPropGetter = (rowId: number) => Datum;

// We convert Grist data to a list of Series first, from which we then construct Plotly traces.
interface Series {
  label: string;          // Corresponds to the column name.
  group?: Datum;          // The group value, when grouped.
  values: Datum[];
}

function getSeriesName(series: Series, haveMultiple: boolean) {
  if (series.group === undefined) {
    return series.label;
  }

  // Let's show [Blank] instead of leaving the name empty for that series. There is a possibility
  // to confuse user between a blank cell and a cell holding the `[Blank]` value. But that is rare
  // enough, and confusion can easily be removed by the chart creator by editing blank cells
  // directly in the the table to put something more meaningful instead.
  const groupName = series.group === '' ? '[Blank]' : series.group;
  if (haveMultiple) {
    return `${groupName} \u2022 ${series.label}`;  // the unicode character is "black circle"
  } else {
    return String(groupName);
  }
}


// The output of a ChartFunc. Normally it just returns one or more Data[] series, but sometimes it
// includes layout information: e.g. a "Scatter Plot" returns a Layout with axis labels.
interface PlotData {
  data: Data[];
  layout?: Partial<Layout>;
  config?: Partial<Config>;
}

// Data options to pass to chart functions.
interface DataOptions extends Data {

  // Allows to set the pie sort option (see: https://plotly.com/javascript/reference/pie/#pie-sort).
  // Supports pie charts only.
  sort?: boolean;

  // Formatter to be used for the total inside donut charts.
  totalFormatter?: BaseFormatter;
}

// Convert a list of Series into a set of Plotly traces.
type ChartFunc = (series: Series[], options: ChartOptions, dataOptions?: DataOptions) => PlotData;


// Helper for converting numeric Date/DateTime values (seconds since Epoch) to JS Date objects for
// use with plotly.
function dateGetter(getter: RowPropGetter): RowPropGetter {
  return (r: number) => {
    // 0's will turn into nulls, and non-numbers will turn into NaNs and then nulls. This prevents
    // Plotly from including 1970-01-01 onto X axis, which usually makes the plot useless.
    const val = (getter(r) as number) * 1000;
    // Plotly recommends using strings for dates rather than Date objects or timestamps. They are
    // interpreted more consistently. See https://github.com/plotly/plotly.js/issues/1532#issuecomment-290420534.
    return val ? new Date(val).toISOString() : null;
  };
}


// List of column types whose values are encoded has list, ie: ['L', 'foo', ...]. Such values
// require special treatment to show correctly in charts.
const LIST_TYPES = ['ChoiceList', 'RefList'];

/**
 * ChartView component displays created charts.
 */
export class ChartView extends Disposable {
  public viewPane: Element;

  // These elements are defined in BaseView, from which we inherit with some hackery.
  protected viewSection: ViewSectionRec;
  protected sortedRows: SortedRowSet;
  protected tableModel: DataTableModel;
  protected gristDoc: GristDoc;

  private _chartType: ko.Observable<string>;
  private _options: ObjObservable<any>;
  private _chartDom: HTMLElement;
  private _update: () => void;
  private _resize: () => void;

  private _formatterComp: ko.Computed<BaseFormatter|undefined>;

  // peek section's sort spec
  private get _sortSpec() { return this.viewSection.activeSortSpec.peek(); }

  public create(gristDoc: GristDoc, viewSectionModel: ViewSectionRec) {
    BaseView.call(this as any, gristDoc, viewSectionModel);

    this._chartDom = this.autoDispose(this.buildDom());

    this._resize = this.autoDispose(Delay.untilAnimationFrame(this._resizeChart, this));

    // Note that .viewPane is used by ViewLayout to insert the actual DOM into the document.
    this.viewPane = this._chartDom;

    this._chartType = this.viewSection.chartTypeDef;
    this._options = this.viewSection.optionsObj;

    // Computed that returns the formatter of the first series. This is useful to format the total
    // within a donut chart.
    this._formatterComp = this.autoDispose(ko.computed(() => {
      const field = this.viewSection.viewFields().at(1);
      return field?.visibleColFormatter();
    }));

    this._update = debounce(() => this._updateView(), 0);

    this.autoDispose(this._chartType.subscribe(this._update));
    this.autoDispose(this._options.subscribe(this._update));
    this.autoDispose(this.viewSection.viewFields().subscribe(this._update));
    this.listenTo(this.sortedRows, 'rowNotify', this._update);
    this.autoDispose(this.sortedRows.getKoArray().subscribe(this._update));
    this.autoDispose(this._formatterComp.subscribe(this._update));
  }

  public prepareToPrint(onOff: boolean) {
    Plotly.relayout(this._chartDom, {}).catch(reportError);
  }

  protected onTableLoaded() {
    (BaseView.prototype as any).onTableLoaded.call(this);
    this._update();
  }

  protected onResize() {
    this._resize();
  }

  protected buildDom() {
    return dom('div.chart_container', testId('container'));
  }

  private listenTo(...args: any[]): void { /* replaced by Backbone */ }

  private async _updateView() {
    if (this.isDisposed()) { return; }

    const chartFunc = chartTypes[this._chartType()];
    if (typeof chartFunc !== 'function') {
      console.warn("Unknown trace type %s", this._chartType());
      return;
    }

    const fields: ViewFieldRec[] = this.viewSection.viewFields().all();
    const rowIds: number[] = this.sortedRows.getKoArray().peek() as number[];
    let series: Series[] = fields.map((field) => {
      // Use the colId of the displayCol, which may be different in case of Reference columns.
      const colId: string = field.displayColModel.peek().colId.peek();
      const getter = this.tableModel.tableData.getRowPropFunc(colId) as RowPropGetter;
      const pureType = field.displayColModel().pureType();
      const fullGetter = (pureType === 'Date' || pureType === 'DateTime') ? dateGetter(getter) : getter;
      return {
        label: field.label(),
        values: rowIds.map(fullGetter),
      };
    });

    const startIndexForYAxis = this._options.prop('multiseries').peek() ? 2 : 1;
    for (let i = 0; i < series.length; ++i) {
      if (i < fields.length && LIST_TYPES.includes(fields[i].column.peek().pureType.peek())) {
        if (i < startIndexForYAxis) {
          // For x-axis and group column data, split series we should split records.
          series = splitValuesByIndex(series, i);
        } else {
          // For all y-axis, it's not sure what would be a sensible representation for choice list,
          // simply stringify choice list values seems reasonable.
          series[i].values = series[i].values.map((v) => String(decodeObject(v as any)));
        }
      }
    }

    const dataOptions: DataOptions = {};
    const options: ChartOptions = this._options.peek() || {};
    let plotData: PlotData = {data: []};

    if (isPieLike(this._chartType.peek())) {

      // Plotly's pie charts have a sort option that is enabled by default. Let's turn it off.
      dataOptions.sort = false;

      // This line is for labels to stay in order when value changes, which can happen when using
      // charts with linked list.
      sortByXValues(series);
    }

    if (this._chartType.peek() === 'donut') {
      dataOptions.totalFormatter = this._formatterComp.peek();
    }

    if (!options.multiseries) {
      plotData = chartFunc(series, options, dataOptions);
    } else if (series.length > 1) {
      // We need to group all series by the first column.
      const nseries = groupSeries(series[0].values, series.slice(1));

      // This will be in the order in which nseries Map was created; concat() flattens the arrays.
      const xvalues = Array.from(new Set(series[1].values));
      for (const gSeries of nseries.values()) {

        // All series have partial list of values, ie: if some may have Q1, Q2, Q3, Q4 as x values
        // some others might only have Q1. This causes inconsistent result in regard of the order
        // bars will be displayed by plotly (for bar charts). This eventually result in bars not
        // following the sorting order. This line fixes that issue by consolidating all series to
        // have at least on entry of each x values.
        if (this._chartType.peek() === 'bar') {
          if (this._sortSpec?.length) { consolidateValues(gSeries, xvalues); }
        }

        const part = chartFunc(gSeries, options, dataOptions);
        part.data = plotData.data.concat(part.data);
        plotData = part;
      }
    }

    Plotly = Plotly || await loadPlotly();

    // Loading plotly is asynchronous and it may happen that the chart view had been disposed in the
    // meantime and cause error later. So let's check again.
    if (this.isDisposed()) { return; }

    const layout: Partial<Layout> = defaultsDeep(plotData.layout, getPlotlyLayout(options));
    const config: Partial<Config> = {...plotData.config, displayModeBar: false};
    // react() can be used in place of newPlot(), and is faster when updating an existing plot.
    await Plotly.react(this._chartDom, plotData.data, layout, config);
    this._resizeChart();
  }

  private _resizeChart() {
    if (this.isDisposed() || !Plotly || !this._chartDom.parentNode) { return; }
    Plotly.Plots.resize(this._chartDom);
  }
}

/**
 * Group the given array of series by a column of group values. The groupColumn and each of the
 * series should be arrays of the same length.
 *
 * For example, if groupColumn has CompanyID, and valueSeries contains [Date, Employees, Revenues]
 * (each an array of values), then returns a map mapping each CompanyID to the array [Date,
 * Employees, Revenue], each value of which is itself an array of values for that CompanyID.
 */
function groupSeries<T extends Datum>(groupColumn: T[], valueSeries: Series[]): Map<T, Series[]> {
  const nseries = new Map<T, Series[]>();

  // Limit the number if group values so as to limit the total number of series we pass into
  // Plotly. Too many series are impossible to make sense of anyway, and can hang the browser.
  // TODO: When not all data is shown, we should probably show some indicator, similar to when
  // OnDemand data is truncated.
  const maxGroups = Math.floor(MAX_SERIES_IN_CHART / valueSeries.length);
  const groupValues: T[] = [...new Set(groupColumn)].sort().slice(0, maxGroups);

  // Set up empty lists for each group.
  for (const group of groupValues) {
    nseries.set(group, valueSeries.map((s: Series) => ({
      label: s.label,
      group,
      values: []
    })));
  }

  // Now fill up the lists.
  for (let row = 0; row < groupColumn.length; row++) {
    const group = groupColumn[row];
    const series: Series[]|undefined = nseries.get(group);
    if (series) {
      for (let i = 0; i < valueSeries.length; i++) {
        series[i].values.push(valueSeries[i].values[row]);
      }
    }
  }
  return nseries;
}

// If errorBars are requested, removes error bar series from the 'series' list, adding instead a
// mapping from each main Y series to the corresponding plotly ErrorBar object.
function extractErrorBars(series: Series[], options: ChartOptions): Map<Series, ErrorBar> {
  const result = new Map<Series, ErrorBar>();
  if (options.errorBars) {
    // We assume that series is of the form [X, Y1, Y1-bar, Y2, Y2-bar, ...] (if "symmetric") or
    // [X, Y1, Y1-below, Y1-above, Y2, Y2-below, Y2-above, ...] (if "separate").
    for (let i = 1; i < series.length; i++) {
      result.set(series[i], {
        type: 'data',
        symmetric: (options.errorBars === 'symmetric'),
        array: series[i + 1] && series[i + 1].values,
        arrayminus: (options.errorBars === 'separate' ? series[i + 2] && series[i + 2].values : undefined),
        thickness: 1,
        width: 3,
      });
      series.splice(i + 1, (options.errorBars === 'symmetric' ? 1 : 2));
    }
  }
  return result;
}

// Getting an ES6 class to work with old-style multiple base classes takes a little hacking.
defaults(ChartView.prototype, BaseView.prototype);
Object.assign(ChartView.prototype, BackboneEvents);

function getPlotlyLayout(options: ChartOptions): Partial<Layout> {
  // Note that each call to getPlotlyLayout() creates a new layout object. We are intentionally
  // avoiding reuse because Plotly caches too many layout calculations when the object is reused.
  const yaxis: Partial<LayoutAxis> = {};
  if (options.logYAxis) { yaxis.type = 'log'; }
  if (options.invertYAxis) { yaxis.autorange = 'reversed'; }
  return {
    // Margins include labels, titles, legend, and may get auto-expanded beyond this.
    margin: {
      l: 50,
      r: 50,
      b: 40,  // Space below chart which includes x-axis labels
      t: 30,  // Space above the chart (doesn't include any text)
      pad: 4
    } as Margin,
    legend: {
      // Translucent background, so chart data is still visible if legend overlaps it.
      bgcolor: "#FFFFFF80",
    },
    yaxis,
  };
}

/**
 * The grainjs component for side-pane configuration options for a Chart section.
 */
export class ChartConfig extends GrainJSDisposable {

  // helper to build the draggable field list
  private _configFieldsHelper = VisibleFieldsConfig.create(this, this._gristDoc, this._section, true);

  // The index for the x-axis in the list visible fields. Could be eigther 0 or 1 depending on
  // whether multiseries is set.
  private _xAxisFieldIndex = Computed.create(
    this, fromKo(this._optionsObj.prop('multiseries')), (_use, multiseries) => (
      multiseries ? 1 : 0
    )
  );

  // The column id of the grouping column, or -1 if multiseries is disabled or there are no viewFields,
  // for example during section removal.
  private _groupDataColId: Computed<number> = Computed.create(this, (use) => {
    const multiseries = use(this._optionsObj.prop('multiseries'));
    const viewFields = use(use(this._section.viewFields).getObservable());
    if (!multiseries || viewFields.length === 0) { return -1; }
    return use(viewFields[0].column).getRowId();
  })
    .onWrite((colId) => this._setGroupDataColumn(colId));

  // Updating the group data column involves several changes of the list of view fields which could
  // leave the x-axis field index momentarily point to the wrong column. The freeze x axis
  // observable is part of a hack to fix this issue.
  private _freezeXAxis = Observable.create(this, false);

  private _freezeYAxis = Observable.create(this, false);

  // The column is of the x-axis.
  private _xAxis: Computed<number> = Computed.create(
    this, this._xAxisFieldIndex, this._freezeXAxis, (use, i, freeze) => {
      if (freeze) { return this._xAxis.get(); }
      const viewFields = use(use(this._section.viewFields).getObservable());
      if (i < viewFields.length) {
        return use(viewFields[i].column).getRowId();
      }
      return -1;
    })
    .onWrite((colId) => this._setXAxis(colId));

  // The list of available columns for the group data picker. Picking the actual x-axis is not
  // permitted.
  private _groupDataOptions = Computed.create<Array<IOption<number>>>(this, (use) => [
    {value: -1, label: 'Pick a column'},
    ...this._section.table().columns().peek()
    // filter out hidden column (ie: manualsort ...) and the one selected for x axis
      .filter((col) => !col.isHiddenCol.peek() && (col.getRowId() !== use(this._xAxis)))
      .map((col) => ({
        value: col.getRowId(), label: col.label.peek(), icon: 'FieldColumn',
      }))
  ]);

  // Force checking/unchecking of the group data checkbox option.
  private _groupDataForce = Observable.create(null, false);

  // State for the group data option checkbox. True, if a group data column is set or if the user
  // forced it. False otherwise.
  private _groupData = Computed.create(
    this, this._groupDataColId, this._groupDataForce, (_use, col, force) => {
      if (col > -1) { return true; }
      return force;
    }).onWrite((val) => {
      if (val === false) {
        this._groupDataColId.set(-1);
      }
      this._groupDataForce.set(val);
    });

  // The label to show for the first field in the axis configurator.
  private _firstFieldLabel = Computed.create(this, fromKo(this._section.chartTypeDef), (
    (_use, chartType) => isPieLike(chartType) ? 'LABEL' : 'X-AXIS'
  ));

  // A computed that returns `this._section.chartTypeDef` and that takes care of removing the group
  // data option when type is switched to 'pie'.
  private _chartType = Computed.create(this, (use) => use(this._section.chartTypeDef))
    .onWrite((val) => {
      return this._gristDoc.docData.bundleActions('switched chart type', async () => {
        await this._section.chartTypeDef.saveOnly(val);
        // When switching chart type to 'pie' makes sure to remove the group data option.
        if (isPieLike(val)) {
          await this._setGroupDataColumn(-1);
          this._groupDataForce.set(false);
        }
      });
    });


  constructor(private _gristDoc: GristDoc, private _section: ViewSectionRec) {
    super();
  }

  private get _optionsObj() { return this._section.optionsObj; }

  public buildDom(): DomContents {

    if (this._section.parentKey() !== 'chart') { return null; }

    return [
      cssRow(
        select(this._chartType, [
          {value: 'bar',          label: 'Bar Chart',         icon: 'ChartBar'   },
          {value: 'pie',          label: 'Pie Chart',         icon: 'ChartPie'   },
          {value: 'donut',        label: 'Donut Chart',       icon: 'ChartDonut' },
          {value: 'area',         label: 'Area Chart',        icon: 'ChartArea'  },
          {value: 'line',         label: 'Line Chart',        icon: 'ChartLine'  },
          {value: 'scatter',      label: 'Scatter Plot',      icon: 'ChartLine'  },
          {value: 'kaplan_meier', label: 'Kaplan-Meier Plot', icon: 'ChartKaplan'},
        ]),
        testId("type"),
      ),
      dom.maybe((use) => !isPieLike(use(this._section.chartTypeDef)), () => [
        // These options don't make much sense for a pie chart.
        cssCheckboxRowObs('Group data', this._groupData),
        cssCheckboxRow('Invert Y-axis', this._optionsObj.prop('invertYAxis')),
        cssCheckboxRow('Log scale Y-axis', this._optionsObj.prop('logYAxis')),
      ]),
      dom.maybeOwned((use) => use(this._section.chartTypeDef) === 'donut', (owner) => [
        cssSlideRow(
          'Hole Size',
          Computed.create(owner, (use) => use(this._optionsObj.prop('donutHoleSize')) ?? DONUT_DEFAULT_HOLE_SIZE),
          (val: number) => this._optionsObj.prop('donutHoleSize').saveOnly(val),
          testId('option')
        ),
        cssCheckboxRow('Show Total', this._optionsObj.prop('showTotal')),
        dom.maybe(this._optionsObj.prop('showTotal'), () => (
          cssNumberWithSpinnerRow(
            'Text Size',
            Computed.create(owner, (use) => use(this._optionsObj.prop('textSize')) ??  DONUT_DEFAULT_TEXT_SIZE),
            (val: number) => this._optionsObj.prop('textSize').saveOnly(val),
            testId('option')
          )
        ))
      ]),
      dom.maybe((use) => use(this._section.chartTypeDef) === 'line', () => [
        cssCheckboxRow('Connect gaps', this._optionsObj.prop('lineConnectGaps')),
        cssCheckboxRow('Show markers', this._optionsObj.prop('lineMarkers')),
      ]),
      dom.maybe((use) => ['line', 'bar'].includes(use(this._section.chartTypeDef)), () => [
        cssRow(
          cssRowLabel('Error bars'),
          dom('div', linkSelect(fromKoSave(this._optionsObj.prop('errorBars')), [
            {value: '', label: 'None'},
            {value: 'symmetric', label: 'Symmetric'},
            {value: 'separate', label: 'Above+Below'},
          ], {defaultLabel: 'None'})),
          testId('error-bars'),
        ),
        dom.domComputed(this._optionsObj.prop('errorBars'), (value: ChartOptions["errorBars"]) =>
          value === 'symmetric' ? cssRowHelp('Each Y series is followed by a series for the length of error bars.') :
          value === 'separate' ? cssRowHelp('Each Y series is followed by two series, for top and bottom error bars.') :
          null
        ),
      ]),

      cssSeparator(),

      dom.maybe(this._groupData, () => [
        cssLabel('Group data'),
        cssRow(
          select(this._groupDataColId, this._groupDataOptions),
          testId('group-by-column'),
        ),
        cssHintRow('Create separate series for each value of the selected column.'),
      ]),

      // TODO: user should select x axis before widget reach page
      cssLabel(dom.text(this._firstFieldLabel), testId('first-field-label')),
      cssRow(
        select(
          this._xAxis, this._section.table().columns().peek()
            .filter((col) => !col.isHiddenCol.peek())
            .map((col) => ({
              value: col.getRowId(), label: col.label.peek(), icon: 'FieldColumn',
            }))
        ),
        testId('x-axis'),
      ),

      cssLabel('SERIES'),
      this._buildYAxis(),
      cssRow(
        cssAddYAxis(
          cssAddIcon('Plus'), 'Add Series',
          menu(() => this._section.hiddenColumns.peek().map((col) => (
            menuItem(() => this._configFieldsHelper.addField(col), col.label.peek())
          ))),
          testId('add-y-axis'),
        )
      ),

    ];
  }

  private async _setXAxis(colId: number) {
    const optionsObj = this._section.optionsObj;
    const col = this._gristDoc.docModel.columns.getRowModel(colId);
    const viewFields = this._section.viewFields.peek();

    await this._gristDoc.docData.bundleActions('selected new x-axis', async () => {
      this._freezeYAxis.set(true);
      try {
        // first remove the current field
        if (this._xAxisFieldIndex.get() < viewFields.peek().length) {
          await this._configFieldsHelper.removeField(viewFields.peek()[this._xAxisFieldIndex.get()]);
        }

        // if  new field was used to group by column series, disable multiseries
        const fieldIndex = viewFields.peek().findIndex((f) => f.column.peek().getRowId() === colId);
        if (fieldIndex === 0 && optionsObj.prop('multiseries').peek()) {
          await optionsObj.prop('multiseries').setAndSave(false);
          return;
        }

        // if new field is already visible, moves the fields to the first place else add the field to the first
        // place
        const xAxisField = viewFields.peek()[this._xAxisFieldIndex.get()];
        if (fieldIndex > -1) {
          await this._configFieldsHelper.changeFieldPosition(viewFields.peek()[fieldIndex], xAxisField);
        } else {
          await this._configFieldsHelper.addField(col, xAxisField);
        }
      } finally {
        this._freezeYAxis.set(false);
      }
    });
  }

  private async _setGroupDataColumn(colId: number) {
    const viewFields = this._section.viewFields.peek().peek();

    await this._gristDoc.docData.bundleActions('selected new x-axis', async () => {
      this._freezeXAxis.set(true);
      this._freezeYAxis.set(true);
      try {
        // if grouping was already set, first remove the current field
        if (this._groupDataColId.get() > -1) {
          await this._configFieldsHelper.removeField(viewFields[0]);
        }

        if (colId > -1) {
          const col = this._gristDoc.docModel.columns.getRowModel(colId);
          const field = viewFields.find((f) => f.column.peek().getRowId() === colId);

          // if new field is already visible, moves the fields to the first place else add the field to the first
          // place
          if (field) {
            await this._configFieldsHelper.changeFieldPosition(field, viewFields[0]);
          } else {
            await this._configFieldsHelper.addField(col, viewFields[0]);
          }
        }

        await this._optionsObj.prop('multiseries').setAndSave(colId > -1);
      } finally {
        this._freezeXAxis.set(false);
        this._freezeYAxis.set(false);
      }
    }, {nestInActiveBundle: true});
  }

  private _buildField(col: IField) {
    return cssFieldEntry(
      cssFieldLabel(dom.text(col.label)),
      cssRemoveIcon(
        'Remove',
        dom.on('click', () => this._configFieldsHelper.removeField(col)),
        testId('ref-select-remove'),
      ),
      testId('y-axis'),
    );
  }

  private _buildYAxis(): Element {

    // The y-axis are all visible fields that comes after the x-axis and maybe the group data
    // column. Hence the draggable list of y-axis needs to skip either one or two visible fields.
    const skipFirst = Computed.create(this, fromKo(this._optionsObj.prop('multiseries')), (_use, multiseries) =>  (
      multiseries ? 2 : 1
    ));

    return this._configFieldsHelper.buildVisibleFieldsConfigHelper({
      itemCreateFunc: (field) => this._buildField(field),
      draggableOptions: {
        removeButton: false,
        drag_indicator: cssDragger,
      }, skipFirst, freeze: this._freezeYAxis
    });
  }
}

// Row for a numeric option. User can change value using spinners or directly using keyboard. In
// case of invalid values, the field reverts to the saved one.
function cssNumberWithSpinnerRow(label: string, value: Computed<number>, save: (val: number) => Promise<void>,
                                 ...args: DomElementArg[]) {
  const minValue = 1;
  let input: HTMLInputElement;

  // Set the input's value to the value that's saved on the server.
  function reset() {
    input.value = value.get() + "px";
  }

  async function onChange(val: string, func: (val: number) => number = (v) => v) {
    let fvalue = parseFloat(val);
    if (isFinite(fvalue)) {
      fvalue = clamp(func(fvalue), minValue, Infinity);
      await save(fvalue);
    }
    // Reset is needed if value were not a valid number.
    reset();
  }

  return cssRow(
    cssRowLabel(label),
    cssNumberWithSpinner(
      input = cssNumberInput(
        {type: 'text'},
        dom.prop('value', (use) => use(value) + "px"),
        dom.on('change', (_ev, el) => onChange(el.value)),
        dom.onKeyDown({
          ArrowDown: (_ev, el) => onChange(el.value, (val) => val - 1),
          ArrowUp: (_ev, el) => onChange(el.value, (val) => val + 1),
        }),
      ),

      // We add spinners as overlay in order to support showing the unit 'px' next to the value.
      cssSpinners(
        'input',
        {type: 'number', step: '1', min: String(minValue)},
        dom.prop('value', value),
        dom.on('change', (_ev, el) => onChange(el.value)),
      ),
    ),
    ...args
  );
}

// Row for a numeric option that leaves between 0 and 1. User can change value using a slider, or
// spinners or by directly using keyboard. Value is shown as percent. If user enter an invalid
// value, field reverts to the saved value.
function cssSlideRow(label: string, value: Computed<number>, save: (val: number) => Promise<void>,
                     ...args: DomElementArg[]) {
  let input: HTMLInputElement;

  // Set the input's value to the value that's saved on the server.
  function reset() {
    input.value = formatPercent(value.get());
  }

  async function onChange(val: string, func: (val: number) => number = (v) => v) {
    let fvalue = parseFloat(val);
    if (isFinite(fvalue)) {
      fvalue = clamp(func(fvalue), 0, 99) / 100;
      await save(fvalue);
    }
    // Reset is needed if value were not a valid number.
    reset();
  }

  return cssRow(
    cssRowLabel(label),
    cssRangeInput(
      {type: 'range', min: "0", max: "1", step: "0.01"},
      dom.prop('value', value),
      dom.on('change', (_ev, el) => save(Number(el.value)))
    ),
    cssNumberWithSpinner(
      input = cssNumberInput(
        {type: 'text'},
        dom.prop('value', (use) => formatPercent(use(value))),
        dom.on('change', (_ev, el) => onChange(el.value)),
        dom.onKeyDown({
          ArrowDown: (_ev, el) => onChange(el.value, (val) => val - 1),
          ArrowUp: (_ev, el) => onChange(el.value, (val) => val + 1),
        }),
      ),

      // We add spinners as overlay in order to support showing the unit '%' next to the value.
      cssSpinners(
        'input',
        {type: 'number', step: '0.01', min: '0', max: '0.99'},
        dom.prop('value', value),
        dom.on('change', (_ev, el) => save(Number(el.value))),
      )
    ),
    ...args
  );
}

function cssCheckboxRow(label: string, value: KoSaveableObservable<unknown>, ...args: DomElementArg[]) {
  return cssCheckboxRowObs(label, fromKoSave(value), ...args);
}

function cssCheckboxRowObs(label: string, value: Observable<boolean>, ...args: DomElementArg[]) {
  return dom('label', cssRow.cls(''),
    cssRowLabel(label),
    squareCheckbox(value, ...args),
  );
}

function basicPlot(series: Series[], options: ChartOptions, dataOptions: Data): PlotData {
  trimNonNumericData(series);
  const errorBars = extractErrorBars(series, options);

  if (dataOptions.type === 'bar') {
    // Plotly has weirdness when redundant values shows up on the x-axis: the values that shows
    // up on hover is different than the value on the y-axis. It seems that one is the sum of all
    // values with same x-axis value, while the other is the last of them. To fix this, we force
    // unique values for the x-axis.
    uniqXValues(series);
  }

  return {
    data: series.slice(1).map((line: Series): Data => ({
      name: getSeriesName(line, series.length > 2),
      x: series[0].values,
      y: line.values,
      error_y: errorBars.get(line),
      ...dataOptions,
    })),
    layout: {
      xaxis: series.length > 0 ? {title: series[0].label} : {},
      // Include yaxis title for a single y-value series only (2 series total);
      // If there are fewer than 2 total series, there is no y-series to display.
      // If there are multiple y-series, a legend will be included instead, and the yaxis title
      // is less meaningful, so omit it.
      yaxis: series.length === 2 ? {title: series[1].label} : {},
    },
  };
}

// Most chart types take a list of series and then use the first series for the X-axis, and each
// subsequent series for their Y-axis values, allowing for multiple lines on the same plot.
// Each series should have the form {label, values}.
export const chartTypes: {[name: string]: ChartFunc} = {
  // TODO There is a lot of code duplication across chart types. Some refactoring is in order.
  bar(series: Series[], options: ChartOptions): PlotData {
    return basicPlot(series, options, {type: 'bar'});
  },
  line(series: Series[], options: ChartOptions): PlotData {
    sortByXValues(series);
    return basicPlot(series, options, {
      type: 'scatter',
      connectgaps: options.lineConnectGaps,
      mode: options.lineMarkers ? 'lines+markers' : 'lines',
    });
  },
  area(series: Series[], options: ChartOptions): PlotData {
    sortByXValues(series);
    return basicPlot(series, options, {
      type: 'scatter',
      fill: 'tozeroy',
      line: {shape: 'spline'},
    });
  },
  scatter(series: Series[], options: ChartOptions): PlotData {
    return basicPlot(series.slice(1), options, {
        type: 'scatter',
        mode: 'text+markers',
        text: series[0].values as string[],
        textposition: "bottom center",
    });
  },

  pie(series: Series[], _options: ChartOptions, dataOptions: DataOptions = {}): PlotData {
    let line: Series;
    if (series.length === 0) {
      return {data: []};
    }
    if (series.length > 1) {
      trimNonNumericData(series);
      line = series[1];
    } else {
      // When there is only one series of labels, simply count their occurrences.
      line = {label: 'Count', values: series[0].values.map(() => 1)};
    }
    return {
      data: [{
        type: 'pie',
        name: getSeriesName(line, false),
        // nulls cause JS errors when pie charts resize, so replace with blanks.
        // (a falsy value would cause plotly to show its index, like "2" which is more confusing).
        labels: series[0].values.map(v => (v == null || v === "") ? "-" : v),
        values: line.values,
        ...dataOptions,
      }]
    };
  },


  donut(series: Series[], options: ChartOptions, dataOptions: DataOptions = {}): PlotData {
    const hole = isNumber(options.donutHoleSize) ? options.donutHoleSize : DONUT_DEFAULT_HOLE_SIZE;
    const annotations: Array<Partial<Annotations>> = [];
    const plotData: PlotData = chartTypes.pie(series, options, {...dataOptions, hole});

    function format(val: number) {
      if (dataOptions.totalFormatter) {
        return dataOptions.totalFormatter.format(val);
      }
      return String(val);
    }

    if (options.showTotal) {
      annotations.push({
        text: format(
          series.length > 1 ?
            sum(series[1].values.filter(isNumber)) :
            plotData.data[0].labels!.length,
        ),
        showarrow: false,
        font: {
          size: options.textSize ?? DONUT_DEFAULT_TEXT_SIZE,
        }
      } as any);
    }
    return defaultsDeep(
      plotData,
      {layout: {annotations}}
    );

  },

  kaplan_meier(series: Series[]): PlotData {
    // For this plot, the first series names the category of each point, and the second the
    // survival time for that point. We turn that into as many series as there are categories.
    if (series.length < 2) { return {data: []}; }
    const newSeries = groupIntoSeries(series[0].values, series[1].values);
    return {
      data: newSeries.map((line: Series): Data => {
        const points = kaplanMeierPlot(line.values as number[]);
        return {
          type: 'scatter',
          mode: 'lines',
          line: {shape: 'hv'},
          name: getSeriesName(line, false),
          x: points.map(p => p.x),
          y: points.map(p => p.y),
        } as Data;
      })
    };
  },
};


/**
 * Assumes a list of series of the form [xValues, yValues1, yValues2, ...]. Remove from all series
 * those points for which all of the y-values are non-numeric (e.g. null or a string).
 */
function trimNonNumericData(series: Series[]): void {
  const values = series.slice(1).map((s) => s.values);
  for (const s of series) {
    s.values = s.values.filter((_, i) => values.some(v => typeof v[i] === 'number'));
  }
}

// Given two parallel arrays, returns an array of series of the form
// {label: category, values: array-of-values}
function groupIntoSeries(categoryList: Datum[], valueList: Datum[]): Series[] {
  const groups = new Map();
  for (const [i, cat] of categoryList.entries()) {
    if (!groups.has(cat)) { groups.set(cat, []); }
    groups.get(cat).push(valueList[i]);
  }
  return Array.from(groups, ([label, values]) => ({label, values}));
}

// Given a list of survivalValues, returns a list of {x, y} pairs for the kaplanMeier plot.
function kaplanMeierPlot(survivalValues: number[]): Array<{x: number, y: number}> {
  // First get a distribution of survivalValue -> count.
  const dist = new Map<number, number>();
  for (const v of survivalValues) {
    dist.set(v, (dist.get(v) || 0) + 1);
  }

  // Sort the distinct values.
  const distinctValues = Array.from(dist.keys());
  distinctValues.sort(nativeCompare);

  // Now generate plot values, with 'x' for survivalValue and 'y' the number of surviving points.
  let y = survivalValues.length;
  const points = [{x: 0, y}];
  for (const x of distinctValues) {
    y -= dist.get(x)!;
    points.push({x, y});
  }
  return points;
}


const cssRowLabel = styled('div', `
  flex: 1 0 0px;
  margin-right: 8px;

  font-weight: initial;   /* negate bootstrap */
  color: ${colors.dark};
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: none;
`);

const cssRowHelp = styled(cssRow, `
  font-size: ${vars.smallFontSize};
  color: ${colors.slate};
`);

const cssAddIcon = styled(icon, `
  margin-right: 4px;
`);

const cssAddYAxis = styled('div', `
  display: flex;
  cursor: pointer;
  color: ${colors.lightGreen};
  --icon-color: ${colors.lightGreen};

  &:not(:first-child) {
    margin-top: 8px;
  }
  &:hover, &:focus, &:active {
    color: ${colors.darkGreen};
    --icon-color: ${colors.darkGreen};
  }
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

const cssHintRow = styled('div', `
  margin: -4px 16px 8px 16px;
  color: ${colors.slate};
`);

const cssRangeInput = styled('input', `
  input& {
    width: 82px;
    margin-right: 4px;
  }
`);

const cssNumberWithSpinner = styled('div', `
  position: relative;
`);

const cssNumberInput = styled('input', `
  width: 55px;
`);


const cssSpinners = styled('input', `
  width: 19px;
  position: absolute;
  top: 2px;
  right: 1px;
  border: none;
  outline: none;
  appearance: none;
  -moz-appearance: none;
  visibility: hidden;

  .${cssNumberWithSpinner.className}:hover & {
    visibility: visible;
  }

  /* needed for chrome to show spinners, indeed the cursor could be outside of spinners' input
  element */
  &[type=number]::-webkit-inner-spin-button {
    opacity: 1;
  }
`);
