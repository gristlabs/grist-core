import {UserAPI} from 'app/common/UserAPI';
import {assert, driver, Key} from 'mocha-webdriver';
import {addYAxis, checkAxisConfig, checkAxisRange, findYAxis, getAxisTitle, getChartData,
        removeYAxis, selectChartType, selectXAxis,
        setSplitSeries} from 'test/nbrowser/chartViewTestUtils';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('ChartView1', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();
  let api: UserAPI;
  let doc: any;

  before(async function() {
    const session = await gu.session().teamSite.login();
    doc = await session.tempDoc(cleanup, 'ChartData.grist');
    api = session.createHomeApi();
  });

  gu.bigScreen();
  afterEach(() => gu.checkForErrors());

  it('should allow adding and removing chart viewsections', async function() {
    // Starting out with one section
    assert.lengthOf(await driver.findAll('.test-gristdoc .view_leaf'), 1);

    // Add a new chart section
    await gu.addNewSection(/Chart/, /ChartData/);

    // Check that there are now two sections
    assert.lengthOf(await driver.findAll('.test-gristdoc .view_leaf'), 2);

    // Delete the newly added one
    await gu.openSectionMenu('viewLayout', 'CHARTDATA Chart');
    await driver.find('.test-section-delete').click();
    await gu.waitForServer();

    // Check that there is now only one section
    assert.lengthOf(await driver.findAll('.test-gristdoc .view_leaf'), 1);
  });

  it('should display a bar chart by default', async function() {
    // Add a new chart section, and make sure it has focus
    await gu.addNewSection(/Chart/, /ChartData/);
    const section = await gu.getSection('CHARTDATA Chart');
    assert.equal(await section.matches('.active_section'), true);

    const chartDom = await section.find('.test-chart-container');
    assert.equal(await chartDom.isDisplayed(), true);

    const data = (await getChartData(chartDom)).data;
    assert.deepEqual(data[0].type, 'bar');
    assert.deepEqual(data[0].x, [ 6, 5, 4, 3, 2, 1 ]);
    assert.deepEqual(data[0].y, [ 1, 2, 3, 4, 5, 6 ]);
  });

  it('should allow viewing raw data underlying chart', async function() {
    // No raw data overlay at first
    assert.isFalse(await driver.find('.test-raw-data-overlay').isPresent());

    // Show raw data overlay
    await gu.openSectionMenu('viewLayout');
    await driver.find('.test-show-raw-data').click();

    // Test that overlay is showed.
    assert.isTrue(await driver.findWait('.test-raw-data-overlay', 100).isDisplayed());

    // Test that the widget menu doesn't have the raw data option any more
    await gu.openSectionMenu('viewLayout');
    assert.isTrue(await driver.findContentWait('.grist-floating-menu li', 'Print widget', 100).isDisplayed());
    assert.isFalse(await driver.findContent('.grist-floating-menu li', 'Show raw data').isPresent());

    // Go back and confirm that the overlay is gone again
    await driver.find('.test-raw-data-close-button').click();
    assert.isFalse(await driver.find('.test-raw-data-overlay').isPresent());

    // Open once again and close by escaping.
    await gu.openSectionMenu('viewLayout');
    await driver.find('.test-show-raw-data').click();
    assert.isTrue(await driver.findWait('.test-raw-data-overlay', 100).isDisplayed());
    await gu.sendKeys(Key.ESCAPE);
    assert.isFalse(await driver.find('.test-raw-data-overlay').isPresent());
  });

  it('should update as the underlying data changes', async function() {
    await gu.getCell({section: 'ChartData', col: 0, rowNum: 1}).click();
    await driver.sendKeys(Key.ENTER, '1', Key.ENTER);   // Change from 6 to 61
    await gu.waitForServer();

    const chartDom = await driver.find('.test-chart-container');
    let data = (await getChartData(chartDom)).data;
    assert.deepEqual(data[0].type, 'bar');
    assert.deepEqual(data[0].x, [ 61, 5, 4, 3, 2, 1 ]);
    assert.deepEqual(data[0].y, [ 1, 2, 3, 4, 5, 6 ]);

    await gu.getCell({section: 'ChartData', col: 1, rowNum: 1}).click();
    await driver.sendKeys(Key.ENTER, '6', Key.ENTER);              // Change from 1 to 16
    await gu.waitForServer();

    data = (await getChartData(chartDom)).data;
    assert.deepEqual(data[0].type, 'bar');
    assert.deepEqual(data[0].x, [ 61, 5, 4, 3, 2, 1 ]);
    assert.deepEqual(data[0].y, [ 16, 2, 3, 4, 5, 6 ]);
  });

  it('should skip empty points', async function() {
    const chartDom = await driver.find('.test-chart-container');
    let data = (await getChartData(chartDom)).data;
    assert.deepEqual(data[0].x, [ 61, 5, 4, 3, 2, 1 ]);
    assert.deepEqual(data[0].y, [ 16, 2, 3, 4, 5, 6 ]);

    // Enter some blank values and a zero. The zero should be included in the plot, but blanks
    // should not.
    await gu.getCell({col: 1, rowNum: 1}).click();
    await driver.sendKeys(Key.DELETE);
    await gu.getCell({col: 1, rowNum: 4}).click();
    await driver.sendKeys(Key.DELETE);
    await gu.getCell({col: 1, rowNum: 6}).click();
    await driver.sendKeys('0', Key.ENTER);
    await gu.waitForServer();

    data = (await getChartData(chartDom)).data;
    assert.deepEqual(data[0].x, [ 5, 4, 2, 1 ]);
    assert.deepEqual(data[0].y, [ 2, 3, 5, 0 ]);

    // Undo and verify that the range is restored.
    await gu.undo(3);
    data = (await getChartData(chartDom)).data;
    assert.deepEqual(data[0].x, [ 61, 5, 4, 3, 2, 1 ]);
    assert.deepEqual(data[0].y, [ 16, 2, 3, 4, 5, 6 ]);
  });

  it('should update chart when new columns are included', async function() {
    const chartDom = await driver.find('.test-chart-container');
    // Check to make sure intial values are correct.
    let data = (await getChartData(chartDom)).data;
    assert.deepEqual(data[0].type, 'bar');
    assert.deepEqual(data[0].x, [ 61, 5, 4, 3, 2, 1 ]);
    assert.deepEqual(data[0].y, [ 16, 2, 3, 4, 5, 6 ]);

    // Check that the intial scales are correct for the dataset.
    checkAxisRange(await getChartData(chartDom), 0.5, 61.5, 0, 16.5);

    // Open the view config pane for the Chart section.
    await gu.getSection('ChartData chart').find('.viewsection_title').click();
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-right-tab-pagewidget').click();
    await driver.find('.test-config-widget').click();

    // Check intial visible fields.
    await checkAxisConfig({
      xaxis: 'label',
      yaxis: ['value']
    });

    // Adds 'largeValue'
    await driver.find('.test-chart-add-y-axis').click();
    await driver.findContent('.grist-floating-menu li', 'largeValue').click();
    await gu.waitForServer();

    // Check axis are correct
    await checkAxisConfig({
      xaxis: 'label',
      yaxis: ['value', 'largeValue']
    });

    // Move 'largeValue' above 'value'. Scroll it into view first, since dragging is a bit messed
    // up when it causes the pane to scroll.
    await gu.scrollIntoView(findYAxis('largeValue'));
    await driver.withActions((actions) => actions.dragAndDrop(findYAxis('largeValue'), findYAxis('value')));
    await gu.waitForServer();

    await checkAxisConfig({
      xaxis: 'label',
      yaxis: ['largeValue', 'value']
    });

    // Make sure only y axis updates to the new column of data
    await driver.sleep(50);
    data = (await getChartData(chartDom)).data;
    assert.deepEqual(data[0].type, 'bar');
    assert.deepEqual(data[0].x, [ 61, 5, 4, 3, 2, 1 ]);
    assert.deepEqual(data[0].y, [ 22, 33, 11, 44, 22, 55 ]);
    assert.deepEqual(data[1].type, 'bar');
    assert.deepEqual(data[1].x, [ 61, 5, 4, 3, 2, 1 ]);
    assert.deepEqual(data[1].y, [ 16, 2, 3, 4, 5, 6 ]);

    // Check that the scales are correct for the new y values.
    checkAxisRange(await getChartData(chartDom), 0.5, 61.5, 0, 57);

    // select 'largeValue' as x axis
    await selectXAxis('largeValue');

    // check x-axis is correct
    await checkAxisConfig({
      xaxis: 'largeValue',
      yaxis: ['value'] // note: 'largeValue' was correctly removed from y-axis
    });

    // adds 'label' as y axis
    await addYAxis('label');

    // check axis are correct
    await checkAxisConfig({
      xaxis: 'largeValue',
      yaxis: ['value', 'label']
    });

    // Reverse the order of the columns and make sure the data updates to reflect that.
    await driver.sleep(50);
    data = (await getChartData(chartDom)).data;
    assert.deepEqual(data[0].type, 'bar');
    assert.deepEqual(data[0].x, [ 22, 33, 11, 44, 55 ]);
    assert.deepEqual(data[0].y, [ 16, 2, 3, 4, 6 ]);
    assert.deepEqual(data[1].type, 'bar');
    assert.deepEqual(data[1].x, [ 22, 33, 11, 44, 55 ]);
    assert.deepEqual(data[1].y, [ 61, 5, 4, 3, 1 ]);

    // Check that the scales are correct for the new values.
    checkAxisRange(await getChartData(chartDom), 5.5, 60.5, 0, 61);

    // select 'label' as x axis
    await selectXAxis('label');

    // adds 'largeValue' as y axis
    await addYAxis('largeValue');

    // moves 'largeValue' above 'value'
    await driver.withActions((actions) => actions.dragAndDrop(findYAxis('largeValue'), findYAxis('value')));
    await gu.waitForServer();

    // check axis correctness
    await checkAxisConfig({
      xaxis: 'label',
      yaxis: ['largeValue', 'value']
    });
  });

  it('should be able to render different types of charts', async function() {
    const chartDom = await driver.find('.test-chart-container');

    await selectChartType('Pie Chart');
    let data = (await getChartData(chartDom)).data;
    assert.deepEqual(data[0].type, 'pie');
    assert.equal(await driver.find('.test-chart-first-field-label').getText(), 'LABEL');
    await selectChartType('Line Chart');
    data = (await getChartData(chartDom)).data;
    assert.deepEqual(data[0].type, 'scatter');
    // Make sure we are not grouping (which would produce names like "1 · value")
    assert.equal(data[0].name, 'largeValue');
    assert.equal(data[1].name, 'value');
    assert.equal(await driver.find('.test-chart-first-field-label').getText(), 'X-AXIS');

    await selectChartType('Area Chart');
    data = (await getChartData(chartDom)).data;
    assert.deepEqual(data[0].type, 'scatter');
    assert.deepEqual(data[0].line!.shape, 'spline');
    assert.deepEqual(data[0].fill, 'tozeroy');
    assert.equal(await driver.find('.test-chart-type').getText(), 'Area Chart');

    // Make sure first field of scatter plot is marked label, not x-axis.
    await selectChartType('Scatter Plot');
    assert.equal(await driver.find('.test-chart-first-field-label').getText(), 'LABEL');

    // Make sure first field of Kaplan-Meier plot is marked label, not x-axis.
    await selectChartType('Kaplan-Meier Plot');
    assert.equal(await driver.find('.test-chart-first-field-label').getText(), 'LABEL');

    // Return to Area Chart.
    await selectChartType('Area Chart');
  });

  it('should render pie charts with a single series, or counts', async function() {
    await selectChartType('Pie Chart');

    // select 'person' for x axis
    await selectXAxis('person');

    // adds 'label' and move to be first y axis
    await addYAxis('label');
    await driver.withActions((actions) => actions.dragAndDrop(findYAxis('label'), findYAxis('largeValue')));
    await gu.waitForServer();

    // check axis
    await checkAxisConfig({
      xaxis: 'person',
      yaxis: ['label', 'largeValue', 'value']
    });

    const chartDom = await driver.find('.test-chart-container');
    let data = (await getChartData(chartDom)).data;
    // Only the first series of values is included.
    assert.deepEqual(data[0].values, [ 61, 4, 2, 5, 3, 1 ]);
    assert.lengthOf(data, 1);

    // When no series is included, just counts are used.
    await removeYAxis('largeValue');
    await removeYAxis('label');
    await removeYAxis('value');
    data = (await getChartData(chartDom)).data;
    assert.deepEqual(data[0].values, [1, 1, 1, 1, 1, 1]);
    assert.lengthOf(data, 1);

    await gu.undo(7);

    // check axis
    await checkAxisConfig({
      xaxis: 'label',
      yaxis: ['largeValue', 'value']
    });

    // check chart type
    assert.equal(await driver.find('.test-chart-type').getText(), 'Area Chart');
  });

  it('should support Y-axis options', async function() {
    const chartDom = await driver.find('.test-chart-container');
    await selectChartType('Bar Chart');
    checkAxisRange(await getChartData(chartDom), 0.5, 61.5, 0, 57);

    await driver.findContent('label', /Invert Y-axis/).find('input').click();
    await gu.waitForServer();
    checkAxisRange(await getChartData(chartDom), 0.5, 61.5, 57, 0);

    await driver.findContent('label', /Invert Y-axis/).find('input').click();
    await driver.findContent('label', /Log scale Y-axis/).find('input').click();
    await gu.waitForServer();
    checkAxisRange(await getChartData(chartDom), 0.5, 61.5, 0.22, 1.82);

    await gu.undo(4);
    // check axis
    await checkAxisConfig({
      xaxis: 'label',
      yaxis: ['largeValue', 'value']
    });
    // check chart type
    assert.equal(await driver.find('.test-chart-type').getText(), 'Area Chart');
  });

  it('should be able to render multiseries line charts', async function() {
    const chartDom = await driver.find('.test-chart-container');

    // switch type to line chart
    await selectChartType('Line Chart');

    // pick 'largeValue' as the x axis
    await selectXAxis('largeValue');

    // set 'label' as the groupby column
    await setSplitSeries('label');

    let {data, layout} = await getChartData(chartDom);
    assert.deepEqual(data[0].type, 'scatter');
    assert.deepEqual(data.map(d => d.name), ['1', '2', '3', '4', '5', '61']);
    assert.equal(getAxisTitle(layout.xaxis), 'largeValue');
    assert.equal(getAxisTitle(layout.yaxis), 'value');

    // Select person for grouping by column
    await setSplitSeries('person');

    await checkAxisConfig({
      groupingByColumn: 'person',
      xaxis: 'largeValue',
      yaxis: ['value'],
    });

    ({data, layout} = await getChartData(chartDom));
    assert.deepEqual(data[0].type, 'scatter');
    assert.deepEqual(data.map(d => d.name), ['Alice', 'Bob']);
    assert.equal(getAxisTitle(layout.xaxis), 'largeValue');
    assert.equal(getAxisTitle(layout.yaxis), 'value');

    // Add a second series. If we have more than one, its name should be included into the series
    // names rather than in the yaxis.title.
    await addYAxis('label');

    await checkAxisConfig({
      groupingByColumn: 'person',
      xaxis: 'largeValue',
      yaxis: ['value', 'label'],
    });

    ({data, layout} = await getChartData(chartDom));
    assert.deepEqual(data[0].type, 'scatter');
    assert.deepEqual(data.map(d => d.name), ['Alice • value', 'Alice • label', 'Bob • value', 'Bob • label']);
    assert.equal(getAxisTitle(layout.xaxis), 'largeValue');
    assert.equal(getAxisTitle(layout.yaxis), undefined);

    await gu.undo(5);
    await checkAxisConfig({
      groupingByColumn: false,
      xaxis: 'label',
      yaxis: ['largeValue', 'value'],
    });
    // check chart type
    assert.equal(await driver.find('.test-chart-type').getText(), 'Area Chart');
  });

  it('should get options for SPLIT SERIES and X AXIS in sync when table changes', async function() {

    // click change widget
    await driver.findContent('button', 'Change Widget').click();

    // click sum symbol
    await driver.findContent('.test-wselect-table', 'People').click();

    // click save
    await driver.find('.test-wselect-addBtn').click();
    await gu.waitForServer();

    // click Split series
    await driver.findContent('label', 'Split series').click();

    // open split series options
    await driver.find('.test-chart-group-by-column').click();

    // check group-data options
    assert.deepEqual(
      await driver.findAll('.test-select-menu li', e => e.getText()),
      ['Pick a column', 'Name', 'B']
    );

    // send ESCAPE to close menu
    await driver.sendKeys(Key.ESCAPE);

    // open x axis options
    await driver.find('.test-chart-x-axis').click();

    // check x axis options
    assert.deepEqual(
      await driver.findAll('.test-select-menu li', e => e.getText()),
      ['Name', 'B']
    );

    // send ESCAPE to close menu
    await driver.sendKeys(Key.ESCAPE);

    // undo
    await gu.undo(1);
  });

  it('should get series name right when grouped column has \'\' values', async function() {
    // remove series 'value'
    await removeYAxis('value');

    // add a row with person left as blank
    const {retValues} = await api.applyUserActions(doc.id, [
      ['AddRecord', 'ChartData', 7, {largeValue: 44}]
    ]);
    await setSplitSeries('person');

    // check that series name is correct
    const data = (await getChartData()).data;
    assert.deepEqual(data.map(d => d.name), ['[Blank]', 'Alice', 'Bob']);

    // remove row
    await api.applyUserActions(doc.id, [
      ['RemoveRecord', 'ChartData', retValues[0]]
    ]);

    // undo
    await gu.undo(2);
  });

  it('should disabled split series option for pie charts', async function() {

    // start with line chart type
    await selectChartType('Line Chart');

    // check the split series option is present
    assert.equal(await driver.findContent('label', /Split series/).isPresent(), true);
    assert.equal(await driver.find('.test-chart-group-by-column').isPresent(), true);

    // select 'person' as the split series column
    await setSplitSeries('person');

    // check split series option
    assert.equal(await driver.findContent('label', /Split series/).isPresent(), true);
    assert.equal(await driver.find('.test-chart-group-by-column').isPresent(), true);

    // check axis
    await checkAxisConfig({
      groupingByColumn: 'person',
      xaxis: 'label',
      yaxis: ['largeValue', 'value'],
    });

    // select pie chart type
    await selectChartType('Pie Chart');

    // check that the split series option is not present
    assert.equal(await driver.findContent('label', /Split series/).isPresent(), false);
    assert.equal(await driver.find('.test-chart-group-by-column').isPresent(), false);

    // check axis
    await checkAxisConfig({
      groupingByColumn: false,
      xaxis: 'label',
      yaxis: ['largeValue', 'value'],
    });
    assert.equal(await driver.find('.test-chart-type').getText(), 'Pie Chart');

    // undo
    await gu.undo(2);
    await checkAxisConfig({
      groupingByColumn: false,
      xaxis: 'label',
      yaxis: ['largeValue', 'value'],
    });
    assert.equal(await driver.find('.test-chart-type').getText(), 'Line Chart');
  });

  it('should render dates properly on X-axis', async function() {
    await gu.getSection('ChartData').find('.viewsection_title').click();

    // Add a new first column.
    await gu.getCell({col: 0, rowNum: 1}).click();
    // driver.sendKeys() doesn't support key combinations, but elem.sendKeys() does.
    await driver.find('body').sendKeys(Key.chord(Key.ALT, Key.SHIFT, '='));
    await gu.waitForServer();
    await driver.find('.test-column-title-label').sendKeys('MyDate', Key.ENTER);
    await gu.waitForServer();

    // Convert it to Date
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-right-tab-field').click();
    await gu.setType(/Date/);
    await gu.waitForServer();

    // Enter some values.
    await gu.enterGridRows({col: 0, rowNum: 1}, [
      ["2018-01-15"], ["2018-01-31"], ["2018-02-14"], ["2018-03-04"], ["2018-03-14"], ["2018-03-26"]
    ]);

    // Open the view config pane for the Chart section.
    await gu.getSection('ChartData chart').find('.viewsection_title').click();
    await driver.find('.test-right-tab-pagewidget').click();

    // select MyDate for x axis
    await selectXAxis('MyDate');

    const chartDom = await driver.find('.test-chart-container');
    const {data, layout} = await getChartData(chartDom);
    // This check helps understand Plotly's actual interpretation of the dates. E.g. if the range
    // endpoints are like '2018-03-25 20:00', plotly is misinterpreting the timezone.
    assert.deepEqual(layout.xaxis.range, ['2018-01-15', '2018-03-26']);
    assert.deepEqual(data[0].type, 'scatter');
    assert.deepEqual(data[0].name, 'largeValue');
    assert.deepEqual(data[0].x, [
      "2018-01-15T00:00:00.000Z", "2018-01-31T00:00:00.000Z", "2018-02-14T00:00:00.000Z",
      "2018-03-04T00:00:00.000Z", "2018-03-14T00:00:00.000Z", "2018-03-26T00:00:00.000Z"
    ]);
    assert.deepEqual(data[0].y, [22, 33, 11, 44, 22, 55]);
    assert.deepEqual(data[1].type, 'scatter');
    assert.deepEqual(data[1].name, 'value');
    assert.deepEqual(data[0].x, [
      "2018-01-15T00:00:00.000Z", "2018-01-31T00:00:00.000Z", "2018-02-14T00:00:00.000Z",
      "2018-03-04T00:00:00.000Z", "2018-03-14T00:00:00.000Z", "2018-03-26T00:00:00.000Z"
    ]);
    assert.deepEqual(data[1].y, [16, 2, 3, 4, 5, 6]);
  });

  it('should support error bars', async function() {
    // We start with a line chart with MyDate on X-axis, and two series: largeValue and value.
    await selectChartType('Line Chart');
    await checkAxisConfig({xaxis: 'MyDate', yaxis: ['largeValue', 'value']});

    // Symmetric error bars should leave only the largeValue series, with 'value' for error bars.
    await driver.find('.test-chart-error-bars .test-select-open').click();
    await driver.findContent('.test-select-menu li', /Symmetric/).click();
    await gu.waitForServer();

    const chartDom = await driver.find('.test-chart-container');
    let data = (await getChartData(chartDom)).data;
    assert.deepEqual(data[0].type, 'scatter');
    assert.deepEqual(data[0].name, 'largeValue');
    assert.deepEqual(data[0].y, [22, 33, 11, 44, 22, 55]);
    assert.deepEqual((data[0].error_y as any).array, [16, 2, 3, 4, 5, 6]);
    assert.deepEqual(data[0].error_y!.symmetric, true);
    assert.lengthOf(data, 1);

    // Using separate error bars for above+below will leave just the "above" error bars.
    await driver.find('.test-chart-error-bars .test-select-open').click();
    await driver.findContent('.test-select-menu li', /Above.*Below/).click();
    await gu.waitForServer();
    data = (await getChartData(chartDom)).data;
    assert.deepEqual(data[0].y, [22, 33, 11, 44, 22, 55]);
    assert.deepEqual((data[0].error_y as any).array, [16, 2, 3, 4, 5, 6]);
    assert.deepEqual((data[0].error_y as any).arrayminus, null);
    assert.deepEqual(data[0].error_y!.symmetric, false);
    assert.lengthOf(data, 1);

    // If we add another line, it'll be used for "below" error bars.
    await addYAxis('label');
    data = (await getChartData(chartDom)).data;
    assert.deepEqual(data[0].y, [22, 33, 11, 44, 22, 55]);
    assert.deepEqual((data[0].error_y as any).array, [16, 2, 3, 4, 5, 6]);
    assert.deepEqual((data[0].error_y as any).arrayminus, [61, 5, 4, 3, 2, 1]);
    assert.deepEqual(data[0].error_y!.symmetric, false);
    assert.lengthOf(data, 1);

    // Should work also for bar charts
    await selectChartType('Bar Chart');
    data = (await getChartData(chartDom)).data;
    assert.deepEqual(data[0].type, 'bar');
    assert.deepEqual(data[0].y, [22, 33, 11, 44, 22, 55]);
    assert.deepEqual((data[0].error_y as any).array, [16, 2, 3, 4, 5, 6]);
    assert.deepEqual((data[0].error_y as any).arrayminus, [61, 5, 4, 3, 2, 1]);
    assert.deepEqual(data[0].error_y!.symmetric, false);
    assert.lengthOf(data, 1);
    await gu.undo(1);


    await gu.undo(3);
  });

  it('should fetch data for tables not yet loaded', async function() {
    // Create a Page that only has a Chart, no other sections.
    await gu.addNewPage(/Chart/, /ChartData/);

    let chartDom = await driver.findWait('.test-chart-container', 1000);
    assert.equal(await chartDom.isDisplayed(), true);
    let data = (await getChartData(chartDom)).data;
    assert.lengthOf(data, 1);
    assert.deepEqual(data[0].type, 'bar');
    assert.deepEqual(data[0].y, [ 61, 5, 4, 3, 2, 1 ]);

    // Reload the page and test that the chart loaded.
    await driver.navigate().refresh();
    await gu.waitForDocToLoad();

    await driver.sleep(1000);
    chartDom = await driver.findWait('.test-chart-container', 1000);
    assert.equal(await chartDom.isDisplayed(), true);
    data = (await getChartData(chartDom)).data;
    assert.lengthOf(data, 1);
    assert.deepEqual(data[0].type, 'bar');
    assert.deepEqual(data[0].y, [ 61, 5, 4, 3, 2, 1 ]);
  });

  it('should resize chart when side panels open or close', async function() {
    // Open a document with some chart data.
    const session = await gu.session().teamSite.login();
    doc = await session.tempDoc(cleanup, 'ChartData.grist');
    await gu.toggleSidePanel('right', 'close');

    // Add a chart section.
    await gu.addNewSection(/Chart/, /ChartData/);
    const chart = await driver.findWait('.viewsection_content .svg-container', 1000);
    const initialRect = await chart.getRect();
    // We expect the left panel open initially.
    assert.equal(await gu.isSidePanelOpen('left'), true);

    // Open the RightPanel, check that chart's width was reduced.
    await gu.toggleSidePanel('right', 'open');
    await driver.wait(async () => (await chart.getRect()).width < initialRect.width, 1000);

    // Close the panel and check the chart went back to initial size.
    await gu.toggleSidePanel('right', 'close');
    await driver.wait(async () => (await chart.getRect()).width === initialRect.width, 1000);
    assert.deepEqual(await chart.getRect(), initialRect);

    // Close the left panel, and check that chart width was increased.
    await gu.toggleSidePanel('left', 'close');
    await driver.wait(async () => (await chart.getRect()).width > initialRect.width, 1000);

    // Reopen the left panel and check the chart went back to initial size.
    await gu.toggleSidePanel('left', 'open');
    await driver.wait(async () => (await chart.getRect()).width === initialRect.width, 1000);
    assert.deepEqual(await chart.getRect(), initialRect);
  });

  // Tests a bug where js errors would be thrown when fewer than 2 series were visible
  // and any chart settings were changed.
  it('should not throw errors when no y-axis are set', async function() {
    // Open the RightPanel and hide both series.
    await gu.toggleSidePanel('right', 'open');
    await removeYAxis('value');

    // Invert the y-axis. (This is meant to trigger js errors if the bug is present)
    await driver.findContent('label', /Invert Y-axis/).find('input').click();
    await gu.waitForServer();

    // Group by the first column. (This is meant to trigger js errors if the bug is present)
    await setSplitSeries('value');

    // Disable groupby column
    await setSplitSeries(false);

    // Revert changes.
    await gu.undo(3);
  });

  // Tests a bug where hitting enter would try to edit a non-existent cell for summary charts.
  it('should not throw errors when pressing enter on summary charts', async function() {
    // Click the section and press 'Enter'.
    await gu.getSection('ChartData chart').click();
    await driver.sendKeys(Key.ENTER);
    await gu.checkForErrors();
  });

  it('should not throw errors when switching to a chart page', async function() {
    await gu.getPageItem('People').click();
    await gu.waitForServer();
    await gu.getPageItem('ChartData').click();
    await gu.waitForServer();
    const chartDom = await gu.getSection('ChartData chart').find('.test-chart-container');
    assert.equal(await chartDom.isDisplayed(), true);
    await gu.checkForErrors();
  });

  it('should not throw errors when summarizing or un-summarizing underlying table', async function() {
    // activate the chart widget
    await gu.getSection('ChartData chart').click();

    // open widget option
    await gu.openSectionMenu('viewLayout');
    await driver.findContent('.grist-floating-menu li', 'Widget options').click();

    // open the page widget picker
    await driver.findContent('.test-right-panel button', 'Change Widget').click();

    // click the summarize button
    await driver.findContent('.test-wselect-table', 'ChartData').find('.test-wselect-pivot').click();

    // click save
    await driver.find('.test-wselect-addBtn').click();

    // wait for server
    await gu.waitForServer();

    // wait for chart to be changed
    await gu.waitToPass(async () => {
      assert.equal(
        await gu.getActiveSectionTitle(),
        'CHARTDATA [Totals] Chart'
      );
    });

    // check for error
    await gu.checkForErrors();

    // undo 1
    await gu.undo(1);
  });

  it('should sort x-axis values', async function() {
    // Import a small table of numbers to test this.
    await gu.importFileDialog('uploads/ChartData-Sort_Test.csv');

    await driver.find('.test-modal-confirm').click();
    await gu.waitForServer();

    // Add a chart of this data, and configure it first to just show X and Y1, Y2 series.
    await gu.addNewSection(/Chart/, /ChartData-Sort_Test/);
    await gu.toggleSidePanel('right', 'open');
    await selectChartType('Line Chart');

    // Show series X, Y1, Y2, grouped by Group.
    await selectXAxis('X');
    await setSplitSeries('Group');
    await addYAxis('Y1');
    await addYAxis('Y2');

    const chartDom = await driver.findWait('.test-chart-container', 1000);
    let {data} = await getChartData(chartDom);
    assert.lengthOf(data, 4);
    assert.deepInclude(data[0], {type: 'scatter', name: 'Bar • Y1'});
    assert.deepInclude(data[1], {type: 'scatter', name: 'Bar • Y2'});
    assert.deepInclude(data[2], {type: 'scatter', name: 'Foo • Y1'});
    assert.deepInclude(data[3], {type: 'scatter', name: 'Foo • Y2'});
    assert.deepEqual(data[0].x, [ 1.5, 2.5, 3.5, 4.5, 5.5 ]);
    assert.deepEqual(data[0].y, [ 1.5, 1, 3.5, 2.5, 4 ]);
    assert.deepEqual(data[1].x, [ 1.5, 2.5, 3.5, 4.5, 5.5 ]);
    assert.deepEqual(data[1].y, [ 6.9, 6, 4.9, 5, 7 ]);
    assert.deepEqual(data[2].x, [ 1, 2, 3, 4, 5 ]);
    assert.deepEqual(data[2].y, [ 1.5, 1, 3.5, 2.5, 4 ]);
    assert.deepEqual(data[3].x, [ 1, 2, 3, 4, 5 ]);
    assert.deepEqual(data[3].y, [ 6.9, 6, 4.9, 5, 7 ]);

    // Now show series ungrouped.
    await setSplitSeries(false);

    ({data} = await getChartData(chartDom));
    assert.lengthOf(data, 2);
    assert.deepInclude(data[0], {type: 'scatter', name: 'Y1'});
    assert.deepInclude(data[1], {type: 'scatter', name: 'Y2'});
    assert.deepEqual(data[0].x, [ 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5 ]);
    assert.deepEqual(data[0].y, [ 1.5, 1.5, 1, 1, 3.5, 3.5, 2.5, 2.5, 4, 4 ]);
    assert.deepEqual(data[1].x, [ 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5 ]);
    assert.deepEqual(data[1].y, [ 6.9, 6.9, 6, 6, 4.9, 4.9, 5, 5, 7, 7 ]);
  });

  it('should not throw when picking the grouping by column for the x-axis', async function() {
    await checkAxisConfig({xaxis: 'X', yaxis: ['Y1', 'Y2']});
    await setSplitSeries('Group');
    await checkAxisConfig({xaxis: 'X', yaxis: ['Y1', 'Y2'], groupingByColumn: 'Group'});
    await selectXAxis('Group');
    await checkAxisConfig({xaxis: 'Group', yaxis: ['Y1', 'Y2']});
    await gu.checkForErrors();
    await gu.undo(2);
  });
});
