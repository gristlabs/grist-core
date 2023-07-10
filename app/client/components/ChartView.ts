import BaseView from 'app/client/components/BaseView';
import {GristDoc} from 'app/client/components/GristDoc';
import {consolidateValues, formatPercent, sortByXValues, splitValuesByIndex,
        uniqXValues} from 'app/client/lib/chartUtil';
import {Delay} from 'app/client/lib/Delay';
import {Disposable} from 'app/client/lib/dispose';
import {fromKoSave} from 'app/client/lib/fromKoSave';
import {loadPlotly, PlotlyType} from 'app/client/lib/imports';
import DataTableModel from 'app/client/models/DataTableModel';
import {ColumnRec, ViewFieldRec, ViewSectionRec} from 'app/client/models/DocModel';
import {reportError} from 'app/client/models/errors';
import {KoSaveableObservable, ObjObservable, setSaveValue} from 'app/client/models/modelUtil';
import {SortedRowSet} from 'app/client/models/rowset';
import {IPageWidget, toPageWidget} from 'app/client/ui/PageWidgetPicker';
import {cssLabel, cssRow, cssSeparator} from 'app/client/ui/RightPanelStyles';
import {cssFieldEntry, cssFieldLabel, IField, VisibleFieldsConfig } from 'app/client/ui/VisibleFieldsConfig';
import {IconName} from 'app/client/ui2018/IconList';
import {squareCheckbox} from 'app/client/ui2018/checkbox';
import {theme, vars} from 'app/client/ui2018/cssVars';
import {cssDragger} from 'app/client/ui2018/draggableList';
import {icon} from 'app/client/ui2018/icons';
import {IOptionFull, linkSelect, menu, menuItem, menuText, select} from 'app/client/ui2018/menus';
import {nativeCompare, unwrap} from 'app/common/gutil';
import {Sort} from 'app/common/SortSpec';
import {BaseFormatter} from 'app/common/ValueFormatter';
import {decodeObject} from 'app/plugin/objtypes';
import {Events as BackboneEvents} from 'backbone';
import {Computed, dom, DomContents, DomElementArg, fromKo, Disposable as GrainJSDisposable,
        IDisposable, IOption, makeTestId, Observable, styled, UseCB} from 'grainjs';
import * as ko from 'knockout';
import clamp = require('lodash/clamp');
import debounce = require('lodash/debounce');
import defaults = require('lodash/defaults');
import defaultsDeep = require('lodash/defaultsDeep');
import isNumber = require('lodash/isNumber');
import merge = require('lodash/merge');
import sum = require('lodash/sum');
import union = require('lodash/union');
import type {Annotations, Config, Datum, ErrorBar, Layout, LayoutAxis, Margin,
    PlotData as PlotlyPlotData} from 'plotly.js';
import {makeT} from 'app/client/lib/localization';


let Plotly: PlotlyType;

// When charting multiple series based on user data, limit the number of series given to plotly.
const MAX_SERIES_IN_CHART = 100;
const DONUT_DEFAULT_HOLE_SIZE = 0.75;
const DONUT_DEFAULT_TEXT_SIZE = 24;

const testId = makeTestId('test-chart-');

const t = makeT('ChartView');

function isPieLike(chartType: string) {
  return ['pie', 'donut'].includes(chartType);
}

function firstFieldIsLabels(chartType: string) {
  return ['pie', 'donut', 'kaplan_meier', 'scatter'].includes(chartType);
}

export function isNumericOnly(chartType: string) {
  return ['bar', 'pie', 'donut', 'kaplan_meier', 'line', 'area', 'scatter'].includes(chartType);
}

// Returns the type of the visibleCol if col is of type `Ref`, otherwise returns the type of col.
function visibleColType(col: ColumnRec, use: UseCB = unwrap) {
  const colType = use(col.pureType);
  const isRef = colType === 'Ref';
  return isRef ? use(use(col.visibleColModel).type) : colType;
}

// Returns true if col is one of 'Numeric', 'Int', 'Any'.
export function isNumericLike(col: ColumnRec, use: UseCB = unwrap) {
  const colType = visibleColType(col, use);
  return ['Numeric', 'Int', 'Any'].includes(colType);
}


interface ChartOptions {
  multiseries?: boolean;
  lineConnectGaps?: boolean;
  lineMarkers?: boolean;
  stacked?: boolean;
  invertYAxis?: boolean;
  logYAxis?: boolean;
  // If "symmetric", one series after each Y series gives the length of the error bars around it. If
  // "separate", two series after each Y series give the length of the error bars above and below it.
  errorBars?: 'symmetric' | 'separate';
  donutHoleSize?: number;
  showTotal?: boolean;
  textSize?: number;
  isXAxisUndefined?: boolean;
  orientation?: 'v'|'h';
  aggregate?: boolean;
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
  isInSortSpec?: boolean; // Whether this series is present in sort spec for this chart.
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

type Data = Partial<PlotlyPlotData>;

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

    let subs: IDisposable[] = [];
    this.autoDispose(this._chartType.subscribe(this._update));
    this.autoDispose(this._options.subscribe(this._update));
    this.autoDispose(this.viewSection.viewFields().subscribe((viewFields: ViewFieldRec[]) => {
      this._update();
      subs.forEach((sub) => sub.dispose());
      subs = [
        ...viewFields.map((field) => field.displayColModel.peek().type.subscribe(this._update)),
        ...viewFields.map((field) => field.visibleColModel.peek().type.subscribe(this._update)),
      ];
    }));
    this.listenTo(this.sortedRows, 'rowNotify', this._update);
    this.autoDispose(this.sortedRows.getKoArray().subscribe(this._update));
    this.autoDispose(this._formatterComp.subscribe(this._update));
    this.autoDispose(this.gristDoc.currentTheme.addListener(() => this._update()));
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
    const startIndexForYAxis = this._options.prop('multiseries').peek() ? 2 : 1;
    let series: Series[] = fields
      .filter((field, i) => i < startIndexForYAxis || this._isCompatibleSeries(field.column.peek()))
      .map((field) => {
        // Use the colId of the displayCol, which may be different in case of Reference columns.
        const colId: string = field.displayColModel.peek().colId.peek();
        const getter = this.tableModel.tableData.getRowPropFunc(colId) as RowPropGetter;
        const pureType = field.displayColModel().pureType();
        const fullGetter = (pureType === 'Date' || pureType === 'DateTime') ? dateGetter(getter) : getter;
        return {
          label: field.label(),
          values: rowIds.map(fullGetter),
          isInSortSpec: Boolean(Sort.findCol(this._sortSpec, field.colRef.peek())),
        };
      });

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

    if (!options.multiseries && series.length) {
      plotData = chartFunc(series, options, dataOptions);
    } else if (series.length > 1) {
      // We need to group all series by the first column.
      // Sort series alphabetically only if user has not defined a sort on this chart.
      const shouldSort = !series[0].isInSortSpec;
      const nseries = groupSeries(series[0].values, series.slice(1), shouldSort);

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

    const layout: Partial<Layout> = defaultsDeep(plotData.layout, this._getPlotlyLayout(options));
    const config: Partial<Config> = {...plotData.config, displayModeBar: false};
    // react() can be used in place of newPlot(), and is faster when updating an existing plot.
    await Plotly.react(this._chartDom, plotData.data, layout, config);
    this._resizeChart();
  }

  private _resizeChart() {
    if (this.isDisposed() || !Plotly || !this._chartDom.parentNode) { return; }
    // Check if the chart is visible before resizing. If it's not visible, Plotly will throw an error.
    const display = window.getComputedStyle(this._chartDom).display;
    if (!display || display === 'none') {
      return;
    }
    Plotly.Plots.resize(this._chartDom);
  }

  private _isCompatibleSeries(col: ColumnRec) {
    return isNumericOnly(this._chartType.peek()) ? isNumericLike(col) : true;
  }

  private _getPlotlyLayout(options: ChartOptions): Partial<Layout> {
    // Note that each call to getPlotlyLayout() creates a new layout object. We are intentionally
    // avoiding reuse because Plotly caches too many layout calculations when the object is reused.
    const yaxis: Partial<LayoutAxis> = {automargin: true, title: {standoff: 0}};
    const xaxis: Partial<LayoutAxis> = {automargin: true, title: {standoff: 0}};
    if (options.logYAxis) { yaxis.type = 'log'; }
    if (options.invertYAxis) { yaxis.autorange = 'reversed'; }
    const layout = {
      // Margins include labels, titles, legend, and may get auto-expanded beyond this.
      margin: {
        l: 50,
        r: 50,
        b: 40,  // Space below chart which includes x-axis labels
        t: 30,  // Space above the chart (doesn't include any text)
        pad: 4
      } as Margin,
      yaxis,
      xaxis,
      ...(options.stacked ? {barmode: 'relative'} : {}),
    };
    return merge(layout, this._getPlotlyTheme());
  }

  private _getPlotlyTheme(): Partial<Layout> {
    const appModel = this.gristDoc.docPageModel.appModel;
    const {colors} = appModel.currentTheme.get();
    return {
      paper_bgcolor: colors['chart-bg'],
      plot_bgcolor: colors['chart-bg'],
      xaxis: {
        color: colors['chart-x-axis'],
      },
      yaxis: {
        color: colors['chart-y-axis'],
      },
      font: {
        color: colors['chart-fg'],
      },
      legend: {
        bgcolor: colors['chart-legend-bg'],
      },
    };
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
function groupSeries<T extends Datum>(groupColumn: T[], valueSeries: Series[], sort: boolean): Map<T, Series[]> {
  const nseries = new Map<T, Series[]>();

  // Limit the number if group values so as to limit the total number of series we pass into
  // Plotly. Too many series are impossible to make sense of anyway, and can hang the browser.
  // TODO: When not all data is shown, we should probably show some indicator, similar to when
  // OnDemand data is truncated.
  const maxGroups = Math.floor(MAX_SERIES_IN_CHART / valueSeries.length);
  let groupValues: T[] = [...new Set(groupColumn)];
  if (sort) {
    groupValues.sort();
  }
  groupValues = groupValues.slice(0, maxGroups);

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

/**
 * The grainjs component for side-pane configuration options for a Chart section.
 */
export class ChartConfig extends GrainJSDisposable {

  private static _instanceMap = new WeakMap<ViewSectionRec, ChartConfig>();

  // helper to build the draggable field list
  private _configFieldsHelper = VisibleFieldsConfig.create(this, this._gristDoc, this._section);

  // The index for the x-axis in the list visible fields. Could be eigther 0 or 1 or -1 depending on
  // whether multiseries and isXAxisUndefined are set.
  private _xAxisFieldIndex = Computed.create(
    this,
    fromKo(this._optionsObj.prop('multiseries')),
    fromKo(this._optionsObj.prop('isXAxisUndefined')), (_use, multiseries, isUndefined) => (
      isUndefined ? -1 : (multiseries ? 1 : 0)
    )
  );

  // The colId of the grouping column, or "" if multiseries is disabled or there are no viewFields,
  // for example during section removal.
  private _groupDataColId: Computed<string> = Computed.create(this, (use) => {
    const multiseries = use(this._optionsObj.prop('multiseries'));
    const viewFields = use(use(this._section.viewFields).getObservable());
    if (!multiseries || viewFields.length === 0) { return ""; }
    return use(use(viewFields[0].column).colId);
  })
    .onWrite((colId) => this._setGroupDataColumn(colId));

  // Updating the group data column involves several changes of the list of view fields which could
  // leave the x-axis field index momentarily point to the wrong column. The freeze x axis
  // observable is part of a hack to fix this issue.
  private _freezeXAxis = Observable.create(this, false);

  private _freezeYAxis = Observable.create(this, false);

  // The colId of the x-axis, or "" is x axis is undefined.
  private _xAxis: Computed<string> = Computed.create(
    this, this._xAxisFieldIndex, this._freezeXAxis, (use, i, freeze) => {
      if (freeze) { return this._xAxis.get(); }
      const viewFields = use(use(this._section.viewFields).getObservable());
      if (-1 < i && i < viewFields.length) {
        return use(use(viewFields[i].column).colId);
      }
      return "";
    })
    .onWrite((colId) => this._setXAxis(colId));

  // Whether value is aggregated or not
  private _isValueAggregated = Computed.create(this, (use) => this._isSummaryTable(use))
    .onWrite((val) => this._setAggregation(val));

  // Columns options
  private _columnsOptions: Computed<Array<IOptionFull<string>>> = Computed.create(
    this, this._freezeXAxis, (use, freeze) => {
      if (freeze) { return this._columnsOptions.get(); }
      const columns = use(this._isValueAggregated) ?
        this._getSummarySourceColumns(use) :
        this._getColumns(use);
      return columns
      // filter out hidden column (ie: manualsort ...)
        .filter((col) => !col.isHiddenCol.peek())
        .map((col) => ({
          value: col.colId(), label: col.label.peek(), icon: 'FieldColumn' as IconName,
        }));
    }
  );

  // The list of available columns for the group data picker.
  private _groupDataOptions = Computed.create<Array<IOption<string>>>(this, (use) => [
    {value: "", label: 'Pick a column'},
    ...use(this._columnsOptions)
  ]);

  // Force checking/unchecking of the group data checkbox option.
  private _groupDataForce = Observable.create(null, false);

  // State for the group data option checkbox. True, if a group data column is set or if the user
  // forced it. False otherwise.
  private _groupData = Computed.create(
    this, this._groupDataColId, this._groupDataForce, (_use, colId, force) => {
      if (colId) { return true; }
      return force;
    }).onWrite((val) => {
      if (val === false) {
        this._groupDataColId.set("");
      }
      this._groupDataForce.set(val);
    });

  // The label to show for the first field in the axis configurator.
  private _firstFieldLabel = Computed.create(this, fromKo(this._section.chartTypeDef), (
    (_use, chartType) => firstFieldIsLabels(chartType) ? 'LABEL' : 'X-AXIS'
  ));

  // A computed that returns `this._section.chartTypeDef` and that takes care of removing the group
  // data option when type is switched to 'pie'.
  private _chartType = Computed.create(this, (use) => use(this._section.chartTypeDef))
    .onWrite((val) => {
      return this._gristDoc.docData.bundleActions('switched chart type', async () => {
        await this._section.chartTypeDef.saveOnly(val);
        // When switching chart type to 'pie' makes sure to remove the group data option.
        if (isPieLike(val)) {
          await this._setGroupDataColumn("");
          this._groupDataForce.set(false);
        }
      });
    });

  constructor(private _gristDoc: GristDoc, private _section: ViewSectionRec) {
    super();
    ChartConfig._instanceMap.set(_section, this);
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
        cssCheckboxRowObs('Split series', this._groupData),
        cssCheckboxRow('Invert Y-axis', this._optionsObj.prop('invertYAxis')),
        cssRow(
          cssRowLabel('Orientation'),
          dom('div', linkSelect(fromKoSave(this._optionsObj.prop('orientation')), [
            {value: 'v', label: 'Vertical'},
            {value: 'h', label: 'Horizontal'}
          ], {defaultLabel: 'Vertical'})),
          testId('orientation'),
        ),
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
        cssCheckboxRow('Stack series', this._optionsObj.prop('stacked')),
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
          value === 'symmetric' ? cssRowHelp(t("Each Y series is followed by a series for the length of error bars.")) :
            value === 'separate' ? cssRowHelp(
              t("Each Y series is followed by two series, for top and bottom error bars.")
            )
          : null
        ),
      ]),

      cssSeparator(),

      dom.maybe(this._groupData, () => [
        cssLabel('Split Series'),
        cssRow(
          select(this._groupDataColId, this._groupDataOptions),
          testId('group-by-column'),
        ),
        cssHintRow(t("Create separate series for each value of the selected column.")),
      ]),

      // TODO: user should select x axis before widget reach page
      cssLabel(dom.text(this._firstFieldLabel), testId('first-field-label')),
      cssRow(
        select(
          this._xAxis, this._columnsOptions,
          { defaultLabel: t("Pick a column") }
        ),
        testId('x-axis'),
      ),
      cssCheckboxRowObs('Aggregate values', this._isValueAggregated),

      cssLabel('SERIES'),
      this._buildYAxis(),
      cssRow(
        cssAddYAxis(
          cssAddIcon('Plus'), 'Add Series',
          menu(() => {
            const hiddenColumns = this._section.hiddenColumns.peek();
            const filterFunc = this._isCompatibleSeries.bind(this);
            const nonNumericCount = hiddenColumns.filter((col) => !filterFunc(col)).length;
            return [
              ...hiddenColumns
                .filter((col) => filterFunc(col))
                .map((col) => menuItem(
                  () => this._configFieldsHelper.addField(col),
                  col.label.peek(),
                )),
              nonNumericCount ? menuText(
                `${nonNumericCount} ` + (
                  nonNumericCount > 1 ?
                    `non-numeric columns are not shown` :
                    `non-numeric column is not shown`
                ),
                testId('yseries-picker-message'),
              ) : null,
            ];
          }),
          testId('add-y-axis'),
        )
      ),

    ];
  }

  private async _setXAxis(colId: string) {
    const optionsObj = this._section.optionsObj;
    const findColumn = () => this._getColumns().find((c) => c.colId() === colId);
    const viewFields = this._section.viewFields.peek();

    await this._gristDoc.docData.bundleActions('selected new x-axis', async () => {
      this._freezeYAxis.set(true);
      this._freezeXAxis.set(true);
      try {

        // first remove the current field
        if (this._xAxisFieldIndex.get() !== -1 && this._xAxisFieldIndex.get() < viewFields.peek().length) {
          await this._configFieldsHelper.removeField(viewFields.peek()[this._xAxisFieldIndex.get()]);
        }

        // if x axis was undefined, set option to false
        await setSaveValue(this._optionsObj.prop('isXAxisUndefined'), false);

        // if new field was used to split series, disable multiseries
        const fieldIndex = viewFields.peek().findIndex((f) => f.column.peek().colId() === colId);
        if (fieldIndex === 0 && optionsObj.prop('multiseries').peek()) {
          await optionsObj.prop('multiseries').setAndSave(false);
          return;
        }

        // if values aggregation is 'on' update the grouped by columns before findColumn()
        // call. This will make sure that colId is not missing from the summary table's columns (as
        // could happen if it were a non-numeric for instance).
        if (this._isValueAggregated.get()) {
          const splitColId = this._groupDataColId.get();
          const cols = splitColId === colId ? [colId] : [splitColId, colId];
          await this._setGroupByColumns(cols);
        }

        // if the new column for the x axis is already visible, make it the first visible column,
        // else add it as the first visible field. The field will be first because it will be
        // inserted before current xAxis column (which is already first (or second if we have
        // multi-series option checked))
        const xAxisField = viewFields.peek()[this._xAxisFieldIndex.get()];
        if (fieldIndex > -1) {
          await this._configFieldsHelper.changeFieldPosition(viewFields.peek()[fieldIndex], xAxisField);
        } else {
          const col = findColumn();
          if (col) {
            await this._configFieldsHelper.addField(col, xAxisField);
          }
        }
      } finally {
        this._freezeYAxis.set(false);
        this._freezeXAxis.set(false);
      }
    });
  }

  private async _setGroupDataColumn(colId: string) {
    const viewFields = this._section.viewFields.peek().peek();

    await this._gristDoc.docData.bundleActions(t("selected new group data columns"), async () => {
      this._freezeXAxis.set(true);
      this._freezeYAxis.set(true);
      try {

        // if grouping was already set, first remove the current field
        if (this._groupDataColId.get()) {
          await this._configFieldsHelper.removeField(viewFields[0]);
        }

        // if values aggregation is 'on' update the grouped by columns first. This will make sure
        // that colId is not missing from the summary table's columns (as could happen if it were a
        // non-numeric for instance).
        if (this._isValueAggregated.get()) {
          const xAxisColId = this._xAxis.get();
          const cols = xAxisColId === colId ? [colId] : [colId, xAxisColId];
          await this._setGroupByColumns(cols);
        }

        if (colId) {
          const col = this._getColumns().find((c) => c.colId() === colId)!;
          const field = viewFields.find((f) => f.column.peek().colId() === colId);

          // if new field is already visible, moves the fields to the first place else add the field to the first
          // place
          if (field) {
            await this._configFieldsHelper.changeFieldPosition(field, viewFields[0]);
          } else {
            await this._configFieldsHelper.addField(col, viewFields[0]);
          }

          // if this column is used as xAxis, set the xAxis to undefined (show Pick a column label)
          if (colId === this._xAxis.get()) {
            await this._optionsObj.prop('isXAxisUndefined').setAndSave(true);
          }
        }

        await this._optionsObj.prop('multiseries').setAndSave(Boolean(colId));

      } finally {
        this._freezeXAxis.set(false);
        this._freezeYAxis.set(false);
      }
    }, {nestInActiveBundle: true});
  }

  private _getColumns(use: UseCB = unwrap) {
    const table = use(this._section.table);
    return use(use(table.columns).getObservable());
  }

  private _getSummarySourceColumns(use: UseCB = unwrap) {
    let table = use(this._section.table);
    table = use(table.summarySource);
    return use(use(table.columns).getObservable());
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

  private _buildYAxis(): DomContents {

    // The y-axis are all visible fields that comes after the x-axis and maybe the group data
    // column. Hence the draggable list of y-axis needs to skip either one or two visible fields.
    const skipFirst = Computed.create(this,
                                      fromKo(this._optionsObj.prop('multiseries')),
                                      fromKo(this._optionsObj.prop('isXAxisUndefined')),
                                      (_use, multiseries, isUndefined) =>  (
      (isUndefined ? 0 : 1) + (multiseries ? 1 : 0)
    ));

    return dom.domComputed((use) => {
      const filterFunc = (field: ViewFieldRec) => this._isCompatibleSeries(use(field.column), use);
      return this._configFieldsHelper.buildVisibleFieldsConfigHelper({
        itemCreateFunc: (field) => this._buildField(field),
        draggableOptions: {
          removeButton: false,
          drag_indicator: cssDragger,
        }, skipFirst, freeze: this._freezeYAxis, filterFunc
      });
    });
  }

  private _isCompatibleSeries(col: ColumnRec, use: UseCB = unwrap) {
    return isNumericOnly(use(this._chartType)) ? isNumericLike(col, use) : true;
  }

  private async _setAggregation(val: boolean) {
    try {
      this._freezeXAxis.set(true);
      await this._gristDoc.docData.bundleActions(t("Toggle chart aggregation"), async () => {
        if (val) {
          await this._doAggregation();
        } else {
          await this._undoAggregation();
        }
      });
    } finally {
      if (!this.isDisposed()) {
        this._freezeXAxis.set(false);
      }
    }
  }

  // Do the aggregation: if not a summary table, turns into one; else update groupby columns to
  // match the X-Axis and Split-series columns.
  private async _doAggregation(): Promise<void> {
    if (!this._isSummaryTable()) {
      await this._toggleSummaryTable();
    } else {
      await this._setGroupByColumns([this._xAxis.get(), this._groupDataColId.get()]);
    }
  }

  // Undo the aggregation.
  private async _undoAggregation() {
    if (this._isSummaryTable()) {
      await this._toggleSummaryTable();
    }
  }

  private _isSummaryTable(use: UseCB = unwrap) {
    return Boolean(use(use(this._section.table).summarySourceTable));
  }

  // Toggle whether section table is a summary table. Must use with care: this function calls
  // `this.dispose()` as a side effect. Conveniently returns the ChartConfig instance of the new
  // view section that replaces the old one.
  private async _toggleSummaryTable(): Promise<ChartConfig> {
    const colIds = [this._xAxis.get(), this._groupDataColId.get()];
    const pageWidget = toPageWidget(this._section);
    pageWidget.summarize = !this._isSummaryTable();
    pageWidget.columns = this._getColumnIds(colIds);
    this._ensureValidLinkingIfAny(pageWidget);
    const newSection = await this._gristDoc.saveViewSection(this._section, pageWidget);
    return ChartConfig._instanceMap.get(newSection)!;
  }

  private async _setGroupByColumns(groupByCols: string[]) {
    const pageWidget = toPageWidget(this._section);
    pageWidget.columns = this._getColumnIds(groupByCols);
    this._ensureValidLinkingIfAny(pageWidget);
    return this._gristDoc.saveViewSection(this._section, pageWidget);
  }

  // If section is linked to a summary table, makes sure that pageWidget describes a summary table
  // that is more detailed than the source summary table. Function mutates `pageWidget`.
  private _ensureValidLinkingIfAny(pageWidget: IPageWidget) {
    if (!pageWidget.summarize) { return; }
    if (!this._section.linkSrcSection().getRowId()) { return; }
    const srcPageWidget = toPageWidget(this._section.linkSrcSection());
    pageWidget.columns = union(pageWidget.columns, srcPageWidget.columns);
  }

  // Returns column ids corresponding to each colIds in the selected table (or corresponding summary
  // source table, if select table is a summary table).
  private _getColumnIds(colIds: string[]) {
    const cols = this._isSummaryTable() ?
      this._section.table().summarySource().columns().all() :
      this._section.table().columns().all();
    const columns = colIds
      .map((colId) => colId && cols.find(c => c.colId() === colId))
      .filter((col): col is ColumnRec => Boolean(col))
      .map(col => col.id());
    return columns;
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
  const [axis1, axis2] = options.orientation === 'h' ? ['y', 'x'] : ['x', 'y'];

  const dataSeries = series.slice(1).map((line: Series): Data => ({
    name: getSeriesName(line, series.length > 2),
    [axis1]: replaceEmptyLabels(series[0].values),
    [axis2]: line.values,
    [`error_${axis2}`]: errorBars.get(line),
    orientation: options.orientation,
    ...dataOptions,
    stackgroup: makeRelativeStackGroup(dataOptions.stackgroup, line.values),
  }));

  // When stacking, stackgroup will be non-empty (an arbitrary value, set to "A" for line-charts).
  // We further separate positive series from negative ones, by changing stackgroup to a different
  // value ("-A") for series which look probably negative. This keeps positive ones above the
  // x-axis, and negative ones below, as for barmode=relative (which only applies to bar charts).
  function makeRelativeStackGroup(stackgroup: string|undefined, values: Datum[]) {
    if (!stackgroup) { return stackgroup; }
    const firstNonZero = values.find(v => v && (v > 0 || v < 0));
    const isNegative = firstNonZero && firstNonZero < 0;
    return isNegative ? "-" + stackgroup : stackgroup;
  }

  return {
    data: dataSeries,
    layout: {
      [`${axis1}axis`]: {title: series.length > 0 ? {text: series[0].label}: {}},
      // Include yaxis title for a single y-value series only (2 series total);
      // If there are fewer than 2 total series, there is no y-series to display.
      // If there are multiple y-series, a legend will be included instead, and the yaxis title
      // is less meaningful, so omit it.
      [`${axis2}axis`]: {title: series.length === 2 ? {text: series[1].label} : {}},
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
      stackgroup: (options.stacked ? "A" : ""),
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
        labels: replaceEmptyLabels(series[0].values),
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
        return dataOptions.totalFormatter.formatAny(val);
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

/**
 * Replace empty values with "-", which is relevant for labels in Pie Charts and for X-axis in
 * other chart types.
 *
 * In pie charts, nulls cause JS errors. In other types, nulls in X-axis cause that point to be
 * omitted (but still affect the Y scale, causing confusion). Replace with "-" rather than blank
 * because plotly replaces falsy values by their index (eg "2") in Pie charts, which is confusing.
 */
function replaceEmptyLabels(values: Datum[]): Datum[] {
  return values.map(v => (v == null || v === "") ? "-" : v);
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
  color: ${theme.text};
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: none;
`);

const cssRowHelp = styled(cssRow, `
  font-size: ${vars.smallFontSize};
  color: ${theme.lightText};
`);

const cssAddIcon = styled(icon, `
  margin-right: 4px;
`);

const cssAddYAxis = styled('div', `
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
  color: ${theme.lightText};
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
