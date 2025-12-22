import {DocAPI} from 'app/common/UserAPI';
import {assert, driver} from 'mocha-webdriver';

import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from "test/nbrowser/testUtils";

describe('RemoveTransformColumns', function () {
  this.timeout(20000);
  setupTestSuite();

  let docAPI: DocAPI;

  it('should remove transform columns when the doc shuts down', async function () {
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", 'nasa');
    const doc = await gu.importFixturesDoc('chimpy', 'nasa', 'Horizon', 'RemoveTransformColumns.grist', false);
    await driver.get(`${server.getHost()}/o/nasa/doc/${doc.id}`);
    await gu.waitForDocToLoad();

    assert.deepEqual(await gu.getVisibleGridCells({col: 'B', rowNums: [1]}), [
      'manualSort, A, B, C, ' +
      'gristHelper_Converted, gristHelper_Transform, ' +
      'gristHelper_Converted2, gristHelper_Transform2',
    ]);

    const userAPI = gu.createHomeApi('chimpy', 'nasa');
    await userAPI.applyUserActions(doc.id, [["Calculate"]]);  // finish loading fully
    await userAPI.getDocAPI(doc.id).forceReload();
    await driver.get(`${server.getHost()}/o/nasa/doc/${doc.id}`);
    await gu.waitForDocToLoad();

    assert.deepEqual(await gu.getVisibleGridCells({col: 'B', rowNums: [1]}), [
      'manualSort, A, B, C',
    ]);

    await gu.checkForErrors();
  });

  it('should remove temporary tables when the doc shuts down', async function () {
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", 'nasa');
    const doc = await gu.importFixturesDoc('chimpy', 'nasa', 'Horizon', 'Hello.grist', false);
    await driver.get(`${server.getHost()}/o/nasa/doc/${doc.id}`);
    await gu.waitForDocToLoad();

    const userAPI = gu.createHomeApi('chimpy', 'nasa');
    docAPI = userAPI.getDocAPI(doc.id);

    // Create temporary tables and non-matching tables
    await userAPI.applyUserActions(doc.id, [
      // Tables that should be removed.
      ["AddTable", "GristHidden_import1", [
        {"id": "A", "type": "Text", "isFormula": false},
      ]],
      ["AddTable", "GristHidden_import2", [
        {"id": "B", "type": "Numeric", "isFormula": false},
      ]],
      ["AddTable", "GristHidden_importSuffix", [
        {"id": "D", "type": "Text", "isFormula": false},
      ]],
      // Tables that look ok, and won't be removed.
      ["AddTable", "GristHidden_something", [
        {"id": "E", "type": "Text", "isFormula": false},
      ]],
      ["AddTable", "Hidden_import", [
        {"id": "F", "type": "Numeric", "isFormula": false},
      ]],
      ["AddTable", "RegularTable", [
        {"id": "C", "type": "Text", "isFormula": false},
      ]],
    ]);

    // Verify all tables exist before doc restart
    const expectedTablesBeforeRestart = [
      'GristHidden_import1', 'GristHidden_import2', 'GristHidden_importSuffix',
      'GristHidden_something', 'Hidden_import', 'RegularTable', 'Table1',
    ];
    assert.deepEqual(await allTables(), expectedTablesBeforeRestart.sort());

    // Finish loading fully and force reload to trigger document shutdown/restart
    await userAPI.getDocAPI(doc.id).forceReload();
    await gu.waitForDocToLoad();

    // Verify only temporary tables with GristHidden_import prefix were removed during shutdown
    const expectedTablesAfterRestart = [
      'GristHidden_something', 'Hidden_import', 'RegularTable', 'Table1',
    ];
    assert.deepEqual(await allTables(), expectedTablesAfterRestart.sort());

    await gu.checkForErrors();
  });

  it('should remove temporary tables after failed import', async function () {
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", 'nasa');
    const doc = await gu.importFixturesDoc('chimpy', 'nasa', 'Horizon', 'Hello.grist', false);
    await driver.get(`${server.getHost()}/o/nasa/doc/${doc.id}`);
    await gu.waitForDocToLoad();

    const userAPI = gu.createHomeApi('chimpy', 'nasa');
    docAPI = userAPI.getDocAPI(doc.id);

    // Start an import to create temporary tables
    await gu.importFileDialog('./uploads/UploadedData1.csv');

    // Wait for the import dialog to show, indicating temporary tables have been created
    await driver.findWait('.test-importer-preview', 5000);

    // Verify the temporary table exists before we simulate failure
    assert.equal((await tempTables()).length, 1);

    // Simulate a failure by refreshing the page.
    await gu.reloadDoc();

    // We still have one temporary table left.
    assert.equal((await tempTables()).length, 1);

    // Now reload the document and check that the temporary tables are gone.
    await userAPI.getDocAPI(doc.id).forceReload();
    await gu.reloadDoc();

    // Verify temporary tables are removed before shutdown.
    assert.equal((await tempTables()).length, 0);
  });

  async function allTables() {
    const rows = await docAPI.getRows('_grist_Tables');
    return (rows.tableId as string[]).sort();
  }

  async function tempTables() {
    return (await allTables()).filter(id =>
      id && typeof id === 'string' && id.startsWith('GristHidden_import'),
    ).sort();
  }
});
