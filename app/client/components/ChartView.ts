import * as BaseView from 'app/client/components/BaseView';
import {GristDoc} from 'app/client/components/GristDoc';
import {sortByXValues} from 'app/client/lib/chartUtil';
import {Delay} from 'app/client/lib/Delay';
import {Disposable} from 'app/client/lib/dispose';
import {fromKoSave} from 'app/client/lib/fromKoSave';
import {loadPlotly, PlotlyType} from 'app/client/lib/imports';
import * as DataTableModel from 'app/client/models/DataTableModel';
import {ViewFieldRec, ViewSectionRec} from 'app/client/models/DocModel';
import {KoSaveableObservable, ObjObservable} from 'app/client/models/modelUtil';
import {SortedRowSet} from 'app/client/models/rowset';
import {cssRow} from 'app/client/ui/RightPanel';
import {squareCheckbox} from 'app/client/ui2018/checkbox';
import {colors, vars} from 'app/client/ui2018/cssVars';
import {linkSelect, select} from 'app/client/ui2018/menus';
import {nativeCompare} from 'app/common/gutil';
import {Events as BackboneEvents} from 'backbone';
import {dom, DomElementArg, makeTestId, styled} from 'grainjs';
import * as ko from 'knockout';
import debounce = require('lodash/debounce');
import defaults = require('lodash/defaults');
import defaultsDeep = require('lodash/defaultsDeep');
import {Config, Data, Datum, ErrorBar, Layout, LayoutAxis, Margin} from 'plotly.js';

let Plotly: PlotlyType;

// When charting multiple series based on user data, limit the number of series given to plotly.
const MAX_SERIES_IN_CHART = 100;

const testId = makeTestId('test-chart-');

interface ChartOptions {
  multiseries?: boolean;
  lineConnectGaps?: boolean;
  lineMarkers?: boolean;
  invertYAxis?: boolean;
  logYAxis?: boolean;
  // If "symmetric", one series after each Y series gives the length of the error bars around it. If
  // "separate", two series after each Y series give the length of the error bars above and below it.
  errorBars?: 'symmetric' | 'separate';
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
  if (!series.group) {
    return series.label;
  } else if (haveMultiple) {
    return `${series.group} \u2022 ${series.label}`;  // the unicode character is "black circle"
  } else {
    return String(series.group);
  }
}


// The output of a ChartFunc. Normally it just returns one or more Data[] series, but sometimes it
// includes layout information: e.g. a "Scatter Plot" returns a Layout with axis labels.
interface PlotData {
  data: Data[];
  layout?: Partial<Layout>;
  config?: Partial<Config>;
}

// Convert a list of Series into a set of Plotly traces.
type ChartFunc = (series: Series[], options: ChartOptions) => PlotData;


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

/**
 * ChartView component displays created charts.
 */
export class ChartView extends Disposable {
  public viewPane: Element;

  // These elements are defined in BaseView, from which we inherit with some hackery.
  protected viewSection: ViewSectionRec;
  protected sortedRows: SortedRowSet;
  protected tableModel: DataTableModel;

  private _chartType: ko.Observable<string>;
  private _options: ObjObservable<any>;
  private _chartDom: HTMLElement;
  private _update: () => void;

  public create(gristDoc: GristDoc, viewSectionModel: ViewSectionRec) {
    BaseView.call(this as any, gristDoc, viewSectionModel);

    this._chartDom = this.autoDispose(this.buildDom());

    // Note that .viewPane is used by ViewLayout to insert the actual DOM into the document.
    this.viewPane = this._chartDom;

    // Resize if the window resizes since that can change the layout leaf size.
    // TODO: Belongs into ViewLayout which already does BaseView.onResize for side-pane open/close.
    const resizeChart = this.autoDispose(Delay.untilAnimationFrame(this._resizeChart, this));
    window.addEventListener('resize', resizeChart);
    this.autoDisposeCallback(() => window.removeEventListener('resize', resizeChart));

    this._chartType = this.viewSection.chartTypeDef;
    this._options = this.viewSection.optionsObj;

    this._update = debounce(() => this._updateView(), 0);

    this.autoDispose(this._chartType.subscribe(this._update));
    this.autoDispose(this._options.subscribe(this._update));
    this.autoDispose(this.viewSection.viewFields().subscribe(this._update));
    this.listenTo(this.sortedRows, 'rowNotify', this._update);
    this.autoDispose(this.sortedRows.getKoArray().subscribe(this._update));
  }

  protected onTableLoaded() {
    (BaseView.prototype as any).onTableLoaded.call(this);
    this._update();
  }

  protected onResize() {
    this._resizeChart();
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
    const series: Series[] = fields.map((field) => {
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

    const options: ChartOptions = this._options.peek() || {};
    let plotData: PlotData = {data: []};

    if (!options.multiseries) {
      plotData = chartFunc(series, options);
    } else if (series.length > 1) {
      // We need to group all series by the first column.
      const nseries = groupSeries(series[0].values, series.slice(1));

      // This will be in the order in which nseries Map was created; concat() flattens the arrays.
      for (const gSeries of nseries.values()) {
        const part = chartFunc(gSeries, options);
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
    if (this.isDisposed() || !Plotly) { return; }
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
 * Build the DOM for side-pane configuration options for a Chart section.
 */
export function buildChartConfigDom(section: ViewSectionRec) {
  if (section.parentKey() !== 'chart') { return null; }
  const optionsObj = section.optionsObj;
  return [
    cssRow(
      select(fromKoSave(section.chartTypeDef), [
        {value: 'bar',          label: 'Bar Chart',         icon: 'ChartBar'   },
        {value: 'pie',          label: 'Pie Chart',         icon: 'ChartPie'   },
        {value: 'area',         label: 'Area Chart',        icon: 'ChartArea'  },
        {value: 'line',         label: 'Line Chart',        icon: 'ChartLine'  },
        {value: 'scatter',      label: 'Scatter Plot',      icon: 'ChartLine'  },
        {value: 'kaplan_meier', label: 'Kaplan-Meier Plot', icon: 'ChartKaplan'},
      ]),
      testId("type"),
    ),
    dom.maybe((use) => use(section.chartTypeDef) !== 'pie', () => [
      // These options don't make much sense for a pie chart.
      cssCheckboxRow('Group by first column', optionsObj.prop('multiseries'), testId('multiseries')),
      cssCheckboxRow('Invert Y-axis', optionsObj.prop('invertYAxis')),
      cssCheckboxRow('Log scale Y-axis', optionsObj.prop('logYAxis')),
    ]),
    dom.maybe((use) => use(section.chartTypeDef) === 'line', () => [
      cssCheckboxRow('Connect gaps', optionsObj.prop('lineConnectGaps')),
      cssCheckboxRow('Show markers', optionsObj.prop('lineMarkers')),
    ]),
    dom.maybe((use) => ['line', 'bar'].includes(use(section.chartTypeDef)), () => [
      cssRow(cssLabel('Error bars'),
        dom('div', linkSelect(fromKoSave(optionsObj.prop('errorBars')), [
          {value: '', label: 'None'},
          {value: 'symmetric', label: 'Symmetric'},
          {value: 'separate', label: 'Above+Below'},
        ], {defaultLabel: 'None'})),
        testId('error-bars'),
      ),
      dom.domComputed(optionsObj.prop('errorBars'), (value: ChartOptions["errorBars"]) =>
        value === 'symmetric' ? cssRowHelp('Each Y series is followed by a series for the length of error bars.') :
        value === 'separate' ? cssRowHelp('Each Y series is followed by two series, for top and bottom error bars.') :
        null
      ),
    ]),
  ];
}

function cssCheckboxRow(label: string, value: KoSaveableObservable<unknown>, ...args: DomElementArg[]) {
  return dom('label', cssRow.cls(''),
    cssLabel(label),
    squareCheckbox(fromKoSave(value), ...args),
  );
}

function basicPlot(series: Series[], options: ChartOptions, dataOptions: Partial<Data>): PlotData {
  trimNonNumericData(series);
  const errorBars = extractErrorBars(series, options);
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

  pie(series: Series[]): PlotData {
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
      }]
    };
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

const cssLabel = styled('div', `
  flex: 1 0 0px;
  margin-right: 8px;

  font-weight: initial;   /* negate bootstrap */
  color: ${colors.dark};
  overflow: hidden;
  text-overflow: ellipsis;
`);

const cssRowHelp = styled(cssRow, `
  font-size: ${vars.smallFontSize};
  color: ${colors.slate};
`);
