import { assert, driver } from 'mocha-webdriver';
import { $, gu, test } from 'test/nbrowser/gristUtil-nbrowser';

const fse = require('fs-extra');
const path = require('path');
const axios = require('axios');

// Authentication headers to include into axios requests.
const headers = {Authorization: 'Bearer api_key_for_userz'};

describe('Export.ntest', function() {
  const cleanup = test.setupTestSuite(this);
  const pathsExpected = {
    base: path.resolve(gu.fixturesRoot, "export-csv", "CCTransactions.csv"),
    sorted: path.resolve(gu.fixturesRoot, "export-csv", "CCTransactions-DBA-desc.csv")
  };
  let dataExpected = {};

  before(async function() {
    await gu.supportOldTimeyTestCode();
    await gu.useFixtureDoc(cleanup, "CCTransactions.grist", true);

    // Read the expected contents before the test case starts, to simplify the promises there.
    // (don't really need that simplification any more though).
    for (const [key, fname] of Object.entries(pathsExpected)) {
      dataExpected[key] = await fse.readFile(fname, {encoding: 'utf8'});
    }
  });

  afterEach(function() {
    return gu.checkForErrors();
  });

  it('should export correct data', async function() {
    await $('.test-tb-share').click();
    // Once the menu opens, get the href of the link.
    await $('.grist-floating-menu').wait();
    const submenu = $('.test-tb-share-option:contains(Export as...)');
    await driver.withActions(a => a.move({origin: submenu.elem()}));
    const href = await $('.grist-floating-menu a:contains(Comma Separated Values)').wait()
      .getAttribute('href');
    // Download the data at the link and compare to expected.
    const resp = await axios.get(href, {responseType: 'text', headers});
    assert.equal(resp.headers['content-disposition'],
                 'attachment; filename="CCTransactions.csv"');
    assert.equal(resp.data, dataExpected.base);
    await $('.test-tb-share').click();
  });

  it('should respect active sort', async function() {
    await gu.openColumnMenu('Doing Business As');
    await $('.grist-floating-menu .test-sort-dsc').click()
    await $('.test-tb-share').click();
    // Once the menu opens, get the href of the link.
    await $('.grist-floating-menu').wait();
    const submenu = $('.test-tb-share-option:contains(Export as...)');
    await driver.withActions(a => a.move({origin: submenu.elem()}));
    const href = await $('.grist-floating-menu a:contains(Comma Separated Values)').wait()
      .getAttribute('href');
    // Download the data at the link and compare to expected.
    const resp = await axios.get(href, {responseType: 'text', headers});
    assert.equal(resp.data, dataExpected.sorted);
  });

  // TODO: We should have a test case with multiple sections on the screen, that checks that
  // export runs for the currently selected section.
});
