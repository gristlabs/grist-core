import {assert, driver, Key} from 'mocha-webdriver';

import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from "test/nbrowser/testUtils";

describe('DeleteColumnsUndo', function () {
  this.timeout(20000);
  setupTestSuite();

  before(async function () {
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", 'nasa');
    const doc = await gu.importFixturesDoc('chimpy', 'nasa', 'Horizon', 'DeleteColumnsUndo.grist', false);
    await driver.get(`${server.getHost()}/o/nasa/doc/${doc.id}/p/2`);
    await gu.waitForDocToLoad();
  });

  it('should be able to delete multiple columns and undo without errors', async function () {
    const revert = await gu.begin();
    assert.deepEqual(await gu.getColumnNames(), ['A', 'B', 'C', 'D']);
    await gu.getColumnHeader({col: 'A'}).click();
    await gu.sendKeys(Key.chord(Key.SHIFT, Key.RIGHT));
    await gu.sendKeys(Key.chord(Key.SHIFT, Key.RIGHT));
    const selectedCols = await driver.findAll(".column_name.selected");
    assert.lengthOf(selectedCols, 3);
    await gu.openColumnMenu('A', 'Delete 3 columns');
    await gu.waitForServer();
    assert.deepEqual(await gu.getColumnNames(), ['D']);
    await revert();
    await gu.checkForErrors();
    assert.deepEqual(await gu.getColumnNames(), ['A', 'B', 'C', 'D']);
  });

});
