import {safeJsonParse} from 'app/common/gutil';
import * as chai from 'chai';
import {assert, driver, Key} from 'mocha-webdriver';
import {serveCustomViews, Serving, setAccess} from 'test/nbrowser/customUtil';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';

chai.config.truncateThreshold = 5000;

describe('CustomView', function() {
  this.timeout('30s');
  gu.bigScreen();
  const cleanup = setupTestSuite();

  let serving: Serving;

  before(async function() {
    if (server.isExternalServer()) {
      this.skip();
    }
    serving = await serveCustomViews();
  });

  after(async function() {
    if (serving) {
      await serving.shutdown();
    }
  });

  it('disabled navigation in custom view', async function() {
    // Start a new doc.
    const session = await gu.session().teamSite.login();
    await session.tempNewDoc(cleanup);

    // Add some data to the table so we can test navigation.
    await gu.sendActions([
      ['AddRecord', 'Table1', null, {A: 'row1'}],
      ['AddRecord', 'Table1', null, {A: 'row2'}],
      ['AddRecord', 'Table1', null, {A: 'row3'}],
    ]);

    // Go to the first row.
    await gu.getCell({section: 'TABLE1', col: 0, rowNum: 1}).click();

    // Add a custom widget.
    await gu.addNewSection('Custom', 'Table1');
    await gu.setCustomWidgetUrl(`${serving.url}/readout`, {openGallery: false});
    await gu.toggleSidePanel('right', 'open');
    await gu.openWidgetPanel();
    await setAccess("read table");
    await gu.waitForServer();

    // Click on the custom widget to focus it.
    const iframe = gu.getSection('TABLE1 custom').find('iframe');

    // Helper to get rowId from the custom widget.
    async function getRowId() {
      await driver.switchTo().frame(iframe);
      const rowId = await driver.find('#rowId').getText();
      await driver.switchTo().defaultContent();
      return rowId;
    }

    // Helper to click inside the custom widget.
    async function clickInside() {
      await driver.switchTo().frame(iframe);
      await driver.find('body').click();
      await driver.switchTo().defaultContent();
    }

    await clickInside();

    // Wait for the custom section to be active.
    await gu.waitToPass(async () => assert.equal(await gu.getActiveSectionTitle(), 'TABLE1 Custom'), 200);

    // Check the initial rowId in the custom widget.
    const initialRowId = await getRowId();
    assert.equal(initialRowId, '1');

    // Try to navigate down with arrow keys - rowId should not change.
    await gu.sendKeys(Key.ARROW_DOWN, Key.ARROW_DOWN, Key.ARROW_DOWN);
    await driver.sleep(100); // There are a lot of setTimeouts there.
    assert.equal(await getRowId(), '1');

    // Try to navigate up with arrow keys - rowId should still not change.
    await gu.sendKeys(Key.ARROW_UP, Key.ARROW_UP, Key.ARROW_UP);
    await driver.sleep(100); // There are a lot of setTimeouts there.
    assert.equal(await getRowId(), '1');

    // Expand the custom widget.
    await gu.expandSection('TABLE1 Custom');

    // Click inside the expanded custom widget.
    await clickInside();

    // Try arrow keys down - rowId should not change.
    await gu.sendKeys(Key.ARROW_DOWN, Key.ARROW_DOWN, Key.ARROW_DOWN);
    await driver.sleep(100); // There are a lot of setTimeouts there.
    assert.equal(await getRowId(), '1');

    // Try arrow keys up - rowId should not change.
    await gu.sendKeys(Key.ARROW_UP, Key.ARROW_UP, Key.ARROW_UP);
    await driver.sleep(100); // There are a lot of setTimeouts there.
    assert.equal(await getRowId(), '1');

    // Close the expanded view.
    await driver.find('.test-viewLayout-overlay .test-close-button').click();
    await gu.waitForServer();

    // Custom widget should still be active after closing the overlay.
    await gu.waitToPass(async () =>
      assert.equal(await gu.getActiveSectionTitle(), 'TABLE1 Custom'));

    // Try arrow keys down one more time - rowId still should not change.
    await gu.sendKeys(Key.ARROW_DOWN, Key.ARROW_DOWN, Key.ARROW_DOWN);
    await driver.sleep(100); // There are a lot of setTimeouts there.
    assert.equal(await getRowId(), '1');

    // Try arrow keys up one more time - rowId still should not change.
    await gu.sendKeys(Key.ARROW_UP, Key.ARROW_UP, Key.ARROW_UP);
    await driver.sleep(100); // There are a lot of setTimeouts there.
    assert.equal(await getRowId(), '1');
  });

  // This tests if test id works. Feels counterintuitive to "test the test" but grist-widget repository test suite
  // depends on this.
  it('informs about ready called', async () => {
    // Add a custom widget to a new doc.
    const session = await gu.session().teamSite.login();
    await session.tempNewDoc(cleanup);
    await gu.addNewSection('Custom', 'Table1');

    // Point to a widget that doesn't immediately call ready.
    await gu.setCustomWidgetUrl(`${serving.url}/deferred-ready`, {openGallery: false});
    await gu.toggleSidePanel('right', 'open');

    // We should have a single iframe.
    assert.equal(await driver.findAll('iframe').then(f => f.length), 1);

    // But without test ready class.
    assert.isFalse(await driver.find("iframe.test-custom-widget-ready").isPresent());

    // Now invoke ready.
    await inFrame(async () => {
      await driver.find('button').click();
    });

    // And we should have a test ready class.
    assert.isTrue(await driver.findWait("iframe.test-custom-widget-ready", 100).isDisplayed());
  });

  for (const access of ['none', 'read table', 'full'] as const) {

    function withAccess(obj: any, fallback: any) {
      return ((access !== 'none') && obj) || fallback;
    }

    function readJson(txt: string) {
      return safeJsonParse(txt, null);
    }

    describe(`with access level ${access}`, function() {

      before(async function() {
        if (server.isExternalServer()) {
          this.skip();
        }
        const mainSession = await gu.session().teamSite.login();
        await mainSession.tempDoc(cleanup, 'Favorite_Films.grist');
        if (!await gu.isSidePanelOpen('right')) {
          await gu.toggleSidePanel('right');
        }
        await driver.find('.test-config-data').click();
      });

      it('gets appropriate notification of row set changes', async function() {
        // Link a section on the "All" page of Favorite Films demo
        await driver.findContent('.test-treeview-itemHeader', /All/).click();
        await gu.getSection('Friends record').click();
        await driver.find('.test-pwc-editDataSelection').click();
        await driver.findWait('.test-wselect-addBtn', 500).click();
        await gu.waitForServer();
        await driver.find('.test-right-select-by').click();
        await gu.findOpenMenuItem('li', /Performances record • Film/).click();
        await gu.waitForServer();
        await driver.find('.test-pwc-editDataSelection').click();
        await driver.findContentWait('.test-wselect-type', /Custom/, 500).click();
        await driver.find('.test-wselect-addBtn').click();
        await gu.waitForServer();

        // Replace the widget with a custom widget that just reads out the data
        // as JSON.
        await gu.setCustomWidgetUrl(`${serving.url}/readout`, {openGallery: false});
        await gu.openWidgetPanel();
        await setAccess(access);
        await gu.waitForServer();

        // Check that the data looks right.
        const iframe = gu.getSection('Friends record').find('iframe');
        await driver.switchTo().frame(iframe);
        assert.deepEqual(readJson(await driver.find('#placeholder').getText()),
                         withAccess({ Name: ["Tom"],
                                      Favorite_Film: ["Toy Story"],
                                      Age: ["25"],
                                      id: [2] }, null));
        assert.equal(await driver.find('#rowId').getText(), withAccess('2', ''));
        assert.equal(await driver.find('#tableId').getText(), withAccess('Friends', ''));
        assert.deepEqual(readJson(await driver.find('#records').getText()),
                         withAccess([{ Name: "Tom",  // not a list!
                                       Favorite_Film: "Toy Story",
                                       Age: "25",
                                       id: 2 }], null));
        await driver.switchTo().defaultContent();

        // Switch row in source section, and see if data updates correctly.
        await gu.getCell({section: 'Performances record', col: 0, rowNum: 5}).click();
        await driver.switchTo().frame(iframe);
        assert.deepEqual(readJson(await driver.find('#placeholder').getText()),
                         withAccess({ Name: ["Roger", "Evan"],
                                      Favorite_Film: ["Forrest Gump", "Forrest Gump"],
                                      Age: ["22", "35"],
                                      id: [1, 5] }, null));
        assert.equal(await driver.find('#rowId').getText(), withAccess('1', ''));
        assert.equal(await driver.find('#tableId').getText(), withAccess('Friends', ''));
        assert.deepEqual(readJson(await driver.find('#records').getText()),
                         withAccess([{ Name: "Roger",
                                       Favorite_Film: "Forrest Gump",
                                       Age: "22",
                                       id: 1 },
                                     { Name: "Evan",
                                       Favorite_Film: "Forrest Gump",
                                      Age: "35",
                                       id: 5 }], null));
        await driver.switchTo().defaultContent();
      });

      it('gets notification of row changes and content changes', async function() {
        // Add a custom view linked to Friends
        await driver.findContentWait('.test-treeview-itemHeader', /Friends/, 500).click();
        await gu.openAddWidgetToPage();
        await driver.findContent('.test-wselect-type', /Custom/).click();
        await driver.findContent('.test-wselect-table', /Friends/).doClick();
        await driver.find('.test-wselect-selectby').doClick();
        await driver.findContent('.test-wselect-selectby option', /FRIENDS/).doClick();
        await driver.find('.test-wselect-addBtn').click();
        await gu.waitForServer();

        // Choose the custom view that just reads out data as json
        await gu.setCustomWidgetUrl(`${serving.url}/readout`, {openGallery: false});
        await gu.openWidgetPanel();
        await setAccess(access);
        await gu.waitForServer();

        // Check that data and cursor looks right
        const iframe = gu.getSection('Friends custom').find('iframe');
        await driver.switchTo().frame(iframe);
        assert.deepEqual(readJson(await driver.find('#placeholder').getText())?.Name,
                         withAccess(['Roger', 'Tom', 'Sydney', 'Bill', 'Evan', 'Mary'], undefined));
        assert.equal(await driver.find('#rowId').getText(), withAccess('1', ''));
        assert.equal(await driver.find('#tableId').getText(), withAccess('Friends', ''));
        assert.equal(readJson(await driver.find('#record').getText())?.Name,
                     withAccess('Roger', undefined));
        assert.deepEqual(readJson(await driver.find('#records').getText())?.[0]?.Name,
                         withAccess('Roger', undefined));

        // Change row in Friends
        await driver.switchTo().defaultContent();
        await gu.getCell({section: 'FRIENDS', col: 0, rowNum: 2}).click();

        // Check that rowId is updated
        await driver.switchTo().frame(iframe);
        assert.deepEqual(readJson(await driver.find('#placeholder').getText())?.Name,
                         withAccess(['Roger', 'Tom', 'Sydney', 'Bill', 'Evan', 'Mary'], undefined));
        assert.equal(await driver.find('#rowId').getText(), withAccess('2', ''));
        assert.equal(await driver.find('#tableId').getText(), withAccess('Friends', ''));
        assert.equal(readJson(await driver.find('#record').getText())?.Name,
                     withAccess('Tom', undefined));
        assert.deepEqual(readJson(await driver.find('#records').getText())?.[0]?.Name,
                         withAccess('Roger', undefined));
        await driver.switchTo().defaultContent();

        // Change a cell in Friends
        await gu.getCell({section: 'FRIENDS', col: 0, rowNum: 1}).click();
        await gu.enterCell('Rabbit');
        await gu.waitForServer();
        // Return to the cell after automatically going to next row.
        await gu.getCell({section: 'FRIENDS', col: 0, rowNum: 1}).click();

        // Check the data in view updates
        await driver.switchTo().frame(iframe);
        assert.deepEqual(readJson(await driver.find('#placeholder').getText())?.Name,
                         withAccess(['Rabbit', 'Tom', 'Sydney', 'Bill', 'Evan', 'Mary'], undefined));
        assert.equal(await driver.find('#rowId').getText(), withAccess('1', ''));
        assert.equal(await driver.find('#tableId').getText(), withAccess('Friends', ''));
        assert.equal(readJson(await driver.find('#record').getText())?.Name,
                     withAccess('Rabbit', undefined));
        assert.deepEqual(readJson(await driver.find('#records').getText())?.[0]?.Name,
                         withAccess('Rabbit', undefined));
        await driver.switchTo().defaultContent();

        // Select new row and test if custom view has noticed it.
        await gu.getCell({section: 'FRIENDS', col: 0, rowNum: 7}).click();
        await driver.switchTo().frame(iframe);
        await gu.waitToPass(async () => {
          assert.equal(await driver.find('#rowId').getText(), withAccess('new', ''));
          assert.equal(await driver.find('#record').getText(), withAccess('new', ''));
        });
        await driver.switchTo().defaultContent();
        await gu.getCell({section: 'FRIENDS', col: 0, rowNum: 1}).click();
        await driver.switchTo().frame(iframe);
        await gu.waitToPass(async () => {
          assert.equal(await driver.find('#rowId').getText(), withAccess('1', ''));
        });
        assert.equal(readJson(await driver.find('#record').getText())?.Name, withAccess('Rabbit', undefined));
        await driver.switchTo().defaultContent();

        // Revert the cell change
        await gu.undo();
      });

      const undoTestTitle = access === 'full'
        ? 'allows undo/redo via keyboard'
        : 'does not allow undo/redo via keyboard';
      it (undoTestTitle, async function() {
        const iframe = gu.getSection('Friends custom').find('iframe');
        await driver.switchTo().frame(iframe);
        await driver.findWait('body', 500).click();

        await gu.sendKeys(Key.chord(Key.CONTROL, 'y'));
        const expected = access === 'full'
          ? withAccess(['Rabbit', 'Tom', 'Sydney', 'Bill', 'Evan', 'Mary'], undefined)
          : withAccess(['Roger', 'Tom', 'Sydney', 'Bill', 'Evan', 'Mary'], undefined);
        await gu.waitToPass(async () => {
          assert.deepEqual(readJson(await driver.find('#placeholder').getText())?.Name, expected);
        }, 1000);

        await gu.sendKeys(Key.chord(await gu.modKey(), 'z'));
        await gu.waitToPass(async () => {
          assert.deepEqual(readJson(await driver.find('#placeholder').getText())?.Name,
          withAccess(['Roger', 'Tom', 'Sydney', 'Bill', 'Evan', 'Mary'], undefined));
        }, 1000);

        await driver.switchTo().defaultContent();
      });

      it('allows switching to custom section by clicking inside it', async function() {
        await gu.getCell({section: 'FRIENDS', col: 0, rowNum: 1}).click();
        assert.equal(await gu.getActiveSectionTitle(), 'FRIENDS');
        assert.equal(await driver.find('.test-config-widget-open-custom-widget-gallery').isPresent(), false);

        const iframe = gu.getSection('Friends custom').find('iframe');
        await driver.switchTo().frame(iframe);
        await driver.find('body').click();

        // Check that the right section is active, and its settings visible in the side panel.
        await driver.switchTo().defaultContent();
        await gu.waitToPass(async () =>
          assert.equal(await gu.getActiveSectionTitle(), 'FRIENDS Custom'), 200);
        assert.equal(await driver.find('.test-config-widget-open-custom-widget-gallery').isPresent(), true);

        // Switch back.
        await gu.getCell({section: 'FRIENDS', col: 0, rowNum: 1}).click();
        assert.equal(await gu.getActiveSectionTitle(), 'FRIENDS');
        assert.equal(await driver.find('.test-config-widget-open-custom-widget-gallery').isPresent(), false);
      });

      it('deals correctly with requests that require full access', async function() {
        // Choose a custom widget that tries to replace all cells in all user tables with 'zap'.
        await gu.getSection('Friends Custom').click();
        await gu.setCustomWidgetUrl(`${serving.url}/zap`);
        await gu.openWidgetPanel();
        await setAccess(access);
        await gu.waitForServer();

        // Wait for widget to finish its work.
        const iframe = gu.getSection('Friends custom').find('iframe');
        await driver.switchTo().frame(iframe);
        await gu.waitToPass(async () => {
          assert.match(await driver.find('#placeholder').getText(), /zap/);
        }, 10000);
        const outcome = await driver.find('#placeholder').getText();
        await driver.switchTo().defaultContent();

        const cell = await gu.getCell({section: 'FRIENDS', col: 0, rowNum: 1}).getText();
        if (access === 'full') {
          assert.equal(cell, 'zap');
          assert.match(outcome, /zap succeeded/);
        } else {
          assert.notEqual(cell, 'zap');
          assert.match(outcome, /zap failed/);
        }
      });
    });
  }

  it('should receive friendly types when reading data from Grist', async function() {
    // TODO The same decoding should probably apply to calls like fetchTable() which are satisfied
    // by the server.
    const mainSession = await gu.session().teamSite.login();
    await mainSession.tempDoc(cleanup, 'TypeEncoding.grist');
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-right-tab-pagewidget').click();
    await gu.waitForServer();
    await driver.find('.test-config-data').click();

    // The test doc already has a Custom View widget. It just needs to
    // have a URL set.
    await gu.getSection('TYPES custom').click();
    await gu.setCustomWidgetUrl(`${serving.url}/types`);
    // If we needed to change widget to Custom URL, make sure access is read table.
    await setAccess("read table");
    await gu.waitForServer();

    const iframe = gu.getSection('TYPES custom').find('iframe');
    await driver.switchTo().frame(iframe);
    await driver.findContentWait('#record', /AnyDate/, 1000000);
    let lines = (await driver.find('#record').getText()).split('\n');

    // The first line has regular old values.
    assert.deepEqual(lines, [
      "AnyDate: 2020-07-02 [typeof=object] [name=GristDate] [date=2020-07-02T00:00:00.000Z]",
      "AnyDateTime: 1990-08-21T17:19:40.705Z [typeof=object] [name=GristDateTime] [date=1990-08-21T17:19:40.705Z]",
      "AnyRef: Types[2] [typeof=object] [name=Reference]",
      "Bool: true [typeof=boolean]",
      "Date: 2020-07-01 [typeof=object] [name=GristDate] [date=2020-07-01T00:00:00.000Z]",
      "DateTime: 2020-08-21T17:19:40.705Z [typeof=object] [name=GristDateTime] [date=2020-08-21T17:19:40.705Z]",
      "Numeric: 17.25 [typeof=number]",
      "RECORD: [object Object] [typeof=object] [name=Object]",
      "  AnyDate: 2020-07-02 [typeof=object] [name=GristDate] [date=2020-07-02T00:00:00.000Z]",
      "  AnyDateTime: 1990-08-21T17:19:40.705Z [typeof=object] [name=GristDateTime] [date=1990-08-21T17:19:40.705Z]",
      "  AnyRef: Types[2] [typeof=object] [name=Reference]",
      "  Bool: true [typeof=boolean]",
      "  Date: 2020-07-01 [typeof=object] [name=GristDate] [date=2020-07-01T00:00:00.000Z]",
      "  DateTime: 2020-08-21T17:19:40.705Z [typeof=object] [name=GristDateTime] [date=2020-08-21T17:19:40.705Z]",
      "  Numeric: 17.25 [typeof=number]",
      "  Reference: Types[2] [typeof=object] [name=Reference]",
      "  Text: Hello! [typeof=string]",
      "  id: 24 [typeof=number]",
      "Reference: Types[2] [typeof=object] [name=Reference]",
      "Text: Hello! [typeof=string]",
      "id: 24 [typeof=number]",
    ]);

    // #match tells us if onRecords() returned the same representation for this record.
    assert.equal(await driver.find('#match').getText(), 'true');

    // Switch to the next row, which has blank values.
    await driver.switchTo().defaultContent();
    await gu.getCell({section: 'TYPES', col: 0, rowNum: 2}).click();
    await driver.switchTo().frame(iframe);
    await driver.findContentWait('#record', /AnyDate: null/, 1000);
    lines = (await driver.find('#record').getText()).split('\n');
    assert.deepEqual(lines, [
      "AnyDate: null [typeof=object]",
      "AnyDateTime: null [typeof=object]",
      "AnyRef: Types[0] [typeof=object] [name=Reference]",
      "Bool: false [typeof=boolean]",
      "Date: null [typeof=object]",
      "DateTime: null [typeof=object]",
      "Numeric: 0 [typeof=number]",
      "RECORD: [object Object] [typeof=object] [name=Object]",
      "  AnyDate: null [typeof=object]",
      "  AnyDateTime: null [typeof=object]",
      "  AnyRef: Types[0] [typeof=object] [name=Reference]",
      "  Bool: false [typeof=boolean]",
      "  Date: null [typeof=object]",
      "  DateTime: null [typeof=object]",
      "  Numeric: 0 [typeof=number]",
      "  Reference: Types[0] [typeof=object] [name=Reference]",
      "  Text:  [typeof=string]",
      "  id: 1 [typeof=number]",
      "Reference: Types[0] [typeof=object] [name=Reference]",
      "Text:  [typeof=string]",
      "id: 1 [typeof=number]",
    ]);

    // #match tells us if onRecords() returned the same representation for this record.
    assert.equal(await driver.find('#match').getText(), 'true');

    // Switch to the next row, which has various error values.
    await driver.switchTo().defaultContent();
    await gu.getCell({section: 'TYPES', col: 0, rowNum: 3}).click();
    await driver.switchTo().frame(iframe);
    await driver.findContentWait('#record', /AnyDate: null/, 1000);
    lines = (await driver.find('#record').getText()).split('\n');

    assert.deepEqual(lines, [
      "AnyDate: #Invalid Date: Not-a-Date [typeof=object] [name=RaisedException]",
      "AnyDateTime: #Invalid DateTime: Not-a-DateTime [typeof=object] [name=RaisedException]",
      "AnyRef: #AssertionError [typeof=object] [name=RaisedException]",
      "Bool: true [typeof=boolean]",
      "Date: Not-a-Date [typeof=string]",
      "DateTime: Not-a-DateTime [typeof=string]",
      "Numeric: Not-a-Number [typeof=string]",
      "RECORD: [object Object] [typeof=object] [name=Object]",
      "  AnyDate: null [typeof=object]",
      "  AnyDateTime: null [typeof=object]",
      "  AnyRef: null [typeof=object]",
      "  Bool: true [typeof=boolean]",
      "  Date: Not-a-Date [typeof=string]",
      "  DateTime: Not-a-DateTime [typeof=string]",
      "  Numeric: Not-a-Number [typeof=string]",
      "  Reference: No-Ref [typeof=string]",
      "  Text: Errors [typeof=string]",
      "  _error_: [object Object] [typeof=object] [name=Object]",
      "    AnyDate: InvalidTypedValue: Invalid Date: Not-a-Date [typeof=string]",
      "    AnyDateTime: InvalidTypedValue: Invalid DateTime: Not-a-DateTime [typeof=string]",
      "    AnyRef: AssertionError:  [typeof=string]",
      "  id: 2 [typeof=number]",
      "Reference: No-Ref [typeof=string]",
      "Text: Errors [typeof=string]",
      "id: 2 [typeof=number]",
    ]);

    // #match tells us if onRecords() returned the same representation for this record.
    assert.equal(await driver.find('#match').getText(), 'true');
  });

  it('should not expand refs when expandRefs is false', async function() {
    const mainSession = await gu.session().teamSite.login();
    await mainSession.tempDoc(cleanup, 'TypeEncoding.grist');
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-right-tab-pagewidget').click();
    await gu.waitForServer();
    await driver.find('.test-config-data').click();

    // The test doc already has a Custom View widget. It just needs to
    // have a URL set.
    await gu.getSection('TYPES custom').click();
    await gu.setCustomWidgetUrl(`${serving.url}/types-raw-refs`);
    // If we needed to change widget to Custom URL, make sure access is read table.
    await setAccess("read table");
    await gu.waitForServer();

    const iframe = gu.getSection('TYPES custom').find('iframe');
    await driver.switchTo().frame(iframe);
    await driver.findContentWait('#record', /AnyDate/, 1000000);
    let record = await driver.find('#record').getText();

    // The first line has regular old values.
    assert.deepEqual(JSON.parse(record), rowsWithoutExpandedRefs[0]);

    // #match tells us if onRecords() returned the same representation for this record.
    assert.equal(await driver.find('#match').getText(), 'true');

    // Switch to the next row, which has blank values.
    await driver.switchTo().defaultContent();
    await gu.getCell({section: 'TYPES', col: 0, rowNum: 2}).click();
    await driver.switchTo().frame(iframe);
    await driver.findContentWait('#record', /"AnyDate":null/, 1000);
    record = await driver.find('#record').getText();
    assert.deepEqual(JSON.parse(record), rowsWithoutExpandedRefs[1]);

    // #match tells us if onRecords() returned the same representation for this record.
    assert.equal(await driver.find('#match').getText(), 'true');

    // Switch to the next row, which has various error values.
    await driver.switchTo().defaultContent();
    await gu.getCell({section: 'TYPES', col: 0, rowNum: 3}).click();
    await driver.switchTo().frame(iframe);
    await driver.findContentWait('#record', /"AnyDate":null/, 1000);
    record = await driver.find('#record').getText();

    assert.deepEqual(JSON.parse(record), rowsWithoutExpandedRefs[2]);

    // #match tells us if onRecords() returned the same representation for this record.
    assert.equal(await driver.find('#match').getText(), 'true');
  });


  it('respect access rules', async function() {
    // Create a Favorite Films copy, with access rules on columns, rows, and tables.
    const mainSession = await gu.session().teamSite.login();
    const api = mainSession.createHomeApi();
    const doc = await mainSession.tempDoc(cleanup, 'Favorite_Films.grist', {load: false});
    await api.applyUserActions(doc.id, [
      ['AddTable', 'Opinions', [{id: 'A'}]],
      ['AddRecord', 'Opinions', null, {A: 'do not zap plz'}],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Performances', colIds: 'Actor'}],
      ['AddRecord', '_grist_ACLResources', -2, {tableId: 'Films', colIds: '*'}],
      ['AddRecord', '_grist_ACLResources', -3, {tableId: 'Opinions', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access == OWNER', permissionsText: 'none',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -2, aclFormula: 'rec.id % 2 == 0', permissionsText: 'none',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -3, aclFormula: '', permissionsText: 'none',
      }],
    ]);

    // Open it up and add a new linked section.
    await mainSession.loadDoc(`/doc/${doc.id}`);
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-config-data').click();
    await driver.findContent('.test-treeview-itemHeader', /All/).click();
    await gu.getSection('Friends record').click();
    await driver.find('.test-pwc-editDataSelection').click();
    await driver.findWait('.test-wselect-addBtn', 500).click();
    await gu.waitForServer();
    await driver.find('.test-right-select-by').click();
    await gu.findOpenMenuItem('li', /Performances record • Film/).click();
    await gu.waitForServer();
    await driver.find('.test-pwc-editDataSelection').click();
    await driver.findContentWait('.test-wselect-type', /Custom/, 500).click();
    await driver.find('.test-wselect-addBtn').click();
    await gu.waitForServer();

    // Select a custom widget that tries to replace all cells in all user tables with 'zap'.
    await gu.setCustomWidgetUrl(`${serving.url}/zap`, {openGallery: false});
    await gu.openWidgetPanel();
    await setAccess("full");
    await gu.waitForServer();

    // Wait for widget to finish its work.
    const iframe = gu.getSection('Friends record').find('iframe');
    await driver.switchTo().frame(iframe);
    await gu.waitToPass(async () => {
      assert.match(await driver.find('#placeholder').getText(), /zap/);
    }, 10000);
    await driver.switchTo().defaultContent();

    // Now leave the page and remove all access rules.
    await mainSession.loadDocMenu('/');
    await api.applyUserActions(doc.id, [
      ['BulkRemoveRecord', '_grist_ACLRules', [2, 3, 4]]
    ]);

    // Check that the expected cells got zapped.

    // In performances table, all but Actor column should have been zapped.
    const performances = await api.getDocAPI(doc.id).getRows('Performances');
    let keys = Object.keys(performances);
    for (let i = 0; i < performances.id.length; i++) {
      for (const key of keys) {
        if (key !== 'Actor' && key !== 'id' && key !== 'manualSort') {
          // use match since zap may be embedded in an error, e.g. if inserted in ref column.
          assert.match(String(performances[key][i]), /zap/);
        }
        assert.notMatch(String(performances['Actor'][i]), /zap/);
      }
    }

    // In films table, every second row should have been zapped.
    const films = await api.getDocAPI(doc.id).getRows('Films');
    keys = Object.keys(films);
    for (let i = 0; i < films.id.length; i++) {
      for (const key of keys) {
        if (key !== 'id' && key !== 'manualSort') {
          assert.equal(films[key][i] === 'zap', films.id[i] % 2 === 1);
        }
      }
    }

    // Opinions table should be untouched.
    const opinions = await api.getDocAPI(doc.id).getRows('Opinions');
    assert.equal(opinions['A'][0], 'do not zap plz');
  });

  it('allows custom options for fetching data', async function () {
    const mainSession = await gu.session().teamSite.login();
    const doc = await mainSession.tempDoc(cleanup, 'FetchSelectedOptions.grist', {load: false});
    await mainSession.loadDoc(`/doc/${doc.id}`);

    await gu.getSection('TABLE1 Custom').click();
    await gu.setCustomWidgetUrl(`${serving.url}/fetchSelectedOptions`);
    await gu.openWidgetPanel();
    await setAccess("full");
    await gu.waitForServer();

    const expected = {
      "default": {
        "fetchSelectedTable": {
          "id": [1, 2],
          "A": [["a", "b"], ["c", "d"]],
        },
        "fetchSelectedRecord": {
          "id": 1,
          "A": ["a", "b"]
        },
        // The viewApi methods don't decode data by default, hence the "L" prefixes.
        "viewApiFetchSelectedTable": {
          "id": [1, 2],
          "A": [["L", "a", "b"], ["L", "c", "d"]],
        },
        "viewApiFetchSelectedRecord": {
          "id": 2,
          "A": ["L", "c", "d"]
        },
        // onRecords returns rows by default, not columns.
        "onRecords": [
          {"id": 1, "A": ["a", "b"]},
          {"id": 2, "A": ["c", "d"]}
        ],
        "onRecord": {
          "id": 1,
          "A": ["a", "b"]
        },
      },
      "options": {
        // This is the result of calling the same methods as above,
        // but with the values of `keepEncoded` and `format` being the opposite of their defaults.
        // `includeColumns` is also set to either 'normal' or 'all' instead of the default 'shown',
        // which means that the 'B' column is included in all the results,
        // and the 'manualSort' columns is included in half of them.
        "fetchSelectedTable": [
          {"id": 1, "manualSort": 1, "A": ["L", "a", "b"], "B": 1},
          {"id": 2, "manualSort": 2, "A": ["L", "c", "d"], "B": 2},
        ],
        "fetchSelectedRecord": {
          "id": 1,
          "A": ["L", "a", "b"],
          "B": 1
        },
        "viewApiFetchSelectedTable": [
          {"id": 1, "manualSort": 1, "A": ["a", "b"], "B": 1},
          {"id": 2, "manualSort": 2, "A": ["c", "d"], "B": 2}
        ],
        "viewApiFetchSelectedRecord": {
          "id": 2,
          "A": ["c", "d"],
          "B": 2
        },
        "onRecords": {
          "id": [1, 2],
          "manualSort": [1, 2],
          "A": [["L", "a", "b"], ["L", "c", "d"]],
          "B": [1, 2],
        },
        "onRecord": {
          "id": 1,
          "A": ["L", "a", "b"],
          "B": 1
        },
      }
    };

    async function getData(shown: number) {
      await driver.findContentWait('#data', `"shown": ${shown}`, 1000);
      const data = await driver.find('#data').getText();
      const result = JSON.parse(data);
      assert.equal(result.shown, shown);
      delete result.shown;
      return result;
    }

    await inFrame(async () => {
      await gu.waitToPass(async () => {
        const parsed = await getData(12);
        assert.deepEqual(parsed, expected);
      }, 1000);
    });

    // Change the access level away from 'full'.
    await setAccess("read table");
    await gu.waitForServer();

    await inFrame(async () => {
      // onRecord(s) with custom includeColumns without full access will fail
      // with an error that we can't catch and display,
      // so only wait for 10 results instead of 12.
      const parsed = await getData(10);

      // The default options don't require full access, so the result is the same.
      assert.deepEqual(parsed.default, expected.default);

      // The alternative options all set includeColumns to 'normal' or 'all',
      // which requires full access.
      assert.deepEqual(parsed.options, {
        "fetchSelectedTable":
          "Error: Setting includeColumns to all requires full access. Current access level is read table",
        "fetchSelectedRecord":
          "Error: Setting includeColumns to normal requires full access. Current access level is read table",
        "viewApiFetchSelectedTable":
          "Error: Setting includeColumns to all requires full access. Current access level is read table",
        "viewApiFetchSelectedRecord":
          "Error: Setting includeColumns to normal requires full access. Current access level is read table"
      });
    });
  });
});

async function inFrame(op: () => Promise<void>)  {
  await driver.switchTo().frame(driver.find("iframe"));
  await op();
  await driver.switchTo().defaultContent();
}

const rowsWithoutExpandedRefs = [
  {
    id: 24,
    Reference: { tableId: 'Types', rowId: 2 },
    AnyDateTime: '1990-08-21T17:19:40.705Z',
    AnyRef: { tableId: 'Types', rowId: 2 },
    AnyDate: '2020-07-02T00:00:00.000Z',
    RECORD: {
      AnyDate: '2020-07-02T00:00:00.000Z',
      AnyDateTime: '1990-08-21T17:19:40.705Z',
      AnyRef: { tableId: 'Types', rowId: 2 },
      Bool: true,
      Date: '2020-07-01T00:00:00.000Z',
      DateTime: '2020-08-21T17:19:40.705Z',
      Numeric: 17.25,
      Reference: { tableId: 'Types', rowId: 2 },
      Text: 'Hello!',
      id: 24
    },
    Bool: true,
    Date: '2020-07-01T00:00:00.000Z',
    DateTime: '2020-08-21T17:19:40.705Z',
    Numeric: 17.25,
    Text: 'Hello!'
  },
  {
    id: 1,
    Reference: { tableId: 'Types', rowId: 0 },
    AnyDateTime: null,
    AnyRef: { tableId: 'Types', rowId: 0 },
    AnyDate: null,
    RECORD: {
      AnyDate: null,
      AnyDateTime: null,
      AnyRef: { tableId: 'Types', rowId: 0 },
      Bool: false,
      Date: null,
      DateTime: null,
      Numeric: 0,
      Reference: { tableId: 'Types', rowId: 0 },
      Text: '',
      id: 1
    },
    Bool: false,
    Date: null,
    DateTime: null,
    Numeric: 0,
    Text: ''
  },
  {
    id: 2,
    Reference: 'No-Ref',
    AnyDateTime: {
      name: 'InvalidTypedValue',
      message: 'DateTime',
      details: 'Not-a-DateTime'
    },
    AnyRef: { name: 'AssertionError' },
    AnyDate: { name: 'InvalidTypedValue', message: 'Date', details: 'Not-a-Date' },
    RECORD: {
      AnyDate: null,
      AnyDateTime: null,
      AnyRef: null,
      Bool: true,
      Date: 'Not-a-Date',
      DateTime: 'Not-a-DateTime',
      Numeric: 'Not-a-Number',
      Reference: 'No-Ref',
      Text: 'Errors',
      _error_: {
        AnyDate: 'InvalidTypedValue: Invalid Date: Not-a-Date',
        AnyDateTime: 'InvalidTypedValue: Invalid DateTime: Not-a-DateTime',
        AnyRef: 'AssertionError: '
      },
      id: 2
    },
    Bool: true,
    Date: 'Not-a-Date',
    DateTime: 'Not-a-DateTime',
    Numeric: 'Not-a-Number',
    Text: 'Errors'
  },
];
