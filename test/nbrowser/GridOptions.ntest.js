/**
 * NOTE: This test is migrated to new UI as test/nbrowser/GridOptions.ts.
 * Remove this version once old UI is no longer supported.
 */


import { assert, driver } from 'mocha-webdriver';
import { $, gu, test } from 'test/nbrowser/gristUtil-nbrowser';

describe("GridOptions.ntest", function() {
  const cleanup = test.setupTestSuite(this);


  // ====== Some Helpers ======

  let secNames = ["COUNTRY", "CITY", "COUNTRYLANGUAGE"];
  let switchTo = (i) =>
        gu.actions.viewSection(secNames[i]).selectSection();

  /* Test that styles on the given section match the specified flags
   * sec: index into secNames
   * hor/vert/zebra: boolean flags
   */
  async function assertHVZ(sec, hor, vert, zebra) {
    let testClasses =
        ['record-hlines', 'record-vlines', 'record-zebra'];
    let flags = [hor, vert, zebra];

    let cell = await gu.getCell({rowNum: 1, col: 0, section: secNames[sec]});
    let row = await cell.findClosest('.record');
    const rowClasses = await row.classList();
    testClasses.forEach( (cls, i) => {
      if(flags[i])  { assert.include(rowClasses, cls);}
      else          { assert.notInclude(rowClasses, cls); }
    });
  }


  // ====== Prepare Document ======

  before(async function() {
    await gu.supportOldTimeyTestCode();
    await gu.useFixtureDoc(cleanup, "World-v10.grist", true);
    await $('.test-gristdoc').wait();
    await gu.hideBanners();
  });

  beforeEach(async function() {
    //Prepare consistent view
    await gu.actions.selectTabView("Country");
    await gu.openSidePane('view');
    await $(".test-grid-options").wait(assert.isDisplayed);
  });

  afterEach(function() {
    return gu.checkForErrors();
  });


  // ====== MAIN TESTS ======


  it('should only be visible on grid view/summary view', async function() {

    let getOptions = () => $(".test-grid-options");
    await assert.isPresent(getOptions());

    // check that it doesnt show up in detail view
    await gu.actions.viewSection("COUNTRY Card List").selectSection();
    await assert.isPresent(getOptions(), false);

    // check that it shows up on the grid-views
    await gu.actions.viewSection("COUNTRY").selectSection();
    await assert.isDisplayed(getOptions());
    await gu.actions.viewSection("CITY").selectSection();
    await assert.isDisplayed(getOptions());
    await gu.actions.viewSection("COUNTRYLANGUAGE").selectSection();
    await assert.isDisplayed(getOptions());

  });

  it('should set and persist styles on a grid', async function() {

    // get handles on elements
    let h = ".test-h-grid-button input";
    let v = ".test-v-grid-button input";
    let z = ".test-zebra-stripe-button input";

    // should start with v+h gridlines, no zebra
    await assertHVZ(0, true, true, false);

    // change values on all the sections
    await switchTo(0);
    await $(z).scrollIntoView().click();

    await switchTo(1);
    await $(h).click();
    await $(v).click();

    await switchTo(2);
    await $(h).click(); // turn off
    await $(z).click(); // turn on
    await gu.waitForServer();

    await assertHVZ(0, true, true, true);     // all on
    await assertHVZ(1, false, false, false);  // all off
    await assertHVZ(2, false, true, true);    // -h +v +z

    // ensure that values persist after reload
    await driver.navigate().refresh();
    //await $.injectIntoPage();
    await gu.waitForDocToLoad();
    await gu.hideBanners();
    await assertHVZ(0, true, true, true);     // all on
    await assertHVZ(1, false, false, false);  // all off
    await assertHVZ(2, false, true, true);    // -h +v +z
  });


  it('should set .record-even on even-numbered rows', async function() {
    let rowClasses = row =>
        gu.getCell({rowNum: row, col: 0}).closest('.record').classList();

    await switchTo(0);
    assert.notInclude(await rowClasses(1), 'record-even', "row 1 should be odd");
    assert.include(await rowClasses(2), 'record-even', "row 2 should be even");
  });
});
