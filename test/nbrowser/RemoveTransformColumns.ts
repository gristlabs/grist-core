import {assert, driver} from 'mocha-webdriver';

import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from "test/nbrowser/testUtils";

describe('RemoveTransformColumns', function () {
  this.timeout(10000);
  setupTestSuite();

  it('should remove transform columns when the doc shuts down', async function () {
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", 'nasa');
    const doc = await gu.importFixturesDoc('chimpy', 'nasa', 'Horizon', 'RemoveTransformColumns.grist', false);
    await driver.get(`${server.getHost()}/o/nasa/doc/${doc.id}`);
    await gu.waitForDocToLoad();

    assert.deepEqual(await gu.getVisibleGridCells({col: 'B', rowNums: [1]}), [
      'manualSort, A, B, C, ' +
      'gristHelper_Converted, gristHelper_Transform, ' +
      'gristHelper_Converted2, gristHelper_Transform2'
    ]);

    const userAPI = gu.createHomeApi('chimpy', 'nasa');
    await userAPI.applyUserActions(doc.id, [["Calculate"]]);  // finish loading fully
    await userAPI.getDocAPI(doc.id).forceReload();
    await driver.get(`${server.getHost()}/o/nasa/doc/${doc.id}`);
    await gu.waitForDocToLoad();

    assert.deepEqual(await gu.getVisibleGridCells({col: 'B', rowNums: [1]}), [
      'manualSort, A, B, C'
    ]);

    await gu.checkForErrors();
  });

});
