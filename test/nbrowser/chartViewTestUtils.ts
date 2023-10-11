import {assert, driver, WebElement} from 'mocha-webdriver';
import {Layout, LayoutAxis, PlotData} from 'plotly.js';
import * as gu from 'test/nbrowser/gristUtils';
import isString = require('lodash/isString');
import isUndefined = require('lodash/isUndefined');

export interface ChartData {
  data: Partial<PlotData>[];
  layout: Layout;
}

export async function selectChartType(chartType: string) {
  await driver.find('.test-chart-type').click();
  await driver.findContent('.test-select-row', chartType).click();
  return gu.waitForServer();
}

export async function getChartData(chartElem?: WebElement|string): Promise<ChartData> {
  if (isString(chartElem) || isUndefined(chartElem)) {
    const section = isString(chartElem) ?
      await gu.getSection(chartElem) :
      await driver.findWait('.active_section', 4000);
    chartElem = await section.find('.test-chart-container');
  }
  return driver.executeScript((el: any) => ({data: el.data, layout: el.layout}), chartElem);
}

export function checkAxisRange({layout}: ChartData, xMin: number, xMax: number, yMin: number, yMax: number) {
  assert.closeTo(layout.xaxis.range![0], xMin, xMin * 0.1);
  assert.closeTo(layout.xaxis.range![1], xMax, xMax * 0.1);
  assert.closeTo(layout.yaxis.range![0], yMin, yMin * 0.1);
  assert.closeTo(layout.yaxis.range![1], yMax, yMax * 0.1);
}

export function getAxisTitle(axis: Partial<LayoutAxis>): string|undefined {
  return axis.title && (axis.title as any).text;
}

export function findYAxis(name: string) {
  return driver.findContent('.test-chart-y-axis', name);
}

export async function removeYAxis(name: string) {
  await findYAxis(name).mouseMove().find('.test-chart-ref-select-remove').click();
  await gu.waitForServer();
}

export async function checkAxisConfig(expected: {groupingByColumn?: string|false,
                                                 xaxis: string|undefined, yaxis: string[]}) {
  const isGroupByPresent = await driver.find('.test-chart-group-by-column').isPresent();
  let groupingByColumn = isGroupByPresent ? await driver.find('.test-chart-group-by-column').getText() : false;
  if (groupingByColumn === 'Pick a column') {
    groupingByColumn = false;
  }
  const xaxis = await driver.find('.test-chart-x-axis').getText();
  assert.deepEqual({
    groupingByColumn,
    xaxis: xaxis === 'Pick a column' ? undefined : xaxis,
    yaxis: await driver.findAll('.test-chart-y-axis', (e) => e.getText()),
  }, {...expected, groupingByColumn: expected.groupingByColumn || false});
}

export async function setSplitSeries(name: string|false, section?: string) {
  await gu.openSectionMenu('viewLayout', section);
  await driver.findContent('.grist-floating-menu li', 'Widget options').click();

  const isChecked = await driver.findContent('label', /Split series/).find('input').matches(':checked');
  if (name === false && isChecked === true ||
      name && isChecked === false) {
    await driver.findContent('label', /Split series/).click();
  }
  if (name) {
    await driver.find('.test-chart-group-by-column').click();
    await driver.findContent('.test-select-menu li', name || 'Pick a column').click();
  }
  await gu.waitForServer();
}

export async function selectXAxis(name: string, opt: {noWait?: boolean} = {}) {
  await driver.find('.test-chart-x-axis').click();
  await driver.findContent('.test-select-menu li', name).click();
  if (!opt.noWait) {
    await gu.waitForServer();
  }
}


export async function setYAxis(names: string[]) {
  // let's first remove all yaxis and then add new ones
  const toRemove = await driver.findAll('.test-chart-y-axis', (e) => e.getText());
  for (const n of toRemove) { await removeYAxis(n); }
  for (const n of names) { await addYAxis(n); }
}

export async function addYAxis(name: string) {
  await driver.find('.test-chart-add-y-axis').click();
  await driver.findContent('.grist-floating-menu li', name).click();
  await gu.waitForServer();
}
