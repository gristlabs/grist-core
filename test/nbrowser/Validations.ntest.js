import { removePrefix } from 'app/common/gutil';
import { assert, driver } from 'mocha-webdriver';
import { $, gu, test } from 'test/nbrowser/gristUtil-nbrowser';

describe('Validations.ntest', function() {
  const cleanup = test.setupTestSuite(this);

  before(async function() {
    await gu.supportOldTimeyTestCode();
    await gu.useFixtureDoc(cleanup, "Hello.grist", true);
    await driver.executeScript(`window.gristApp.enableFeature('validationsTool', true)`);
  });

  afterEach(function() {
    return gu.checkForErrors();
  });

  it("can add empty validation, which should not show indicators", async function() {
    // Open the validations config pane (lives in the Document side pane).
    await gu.openSidePane('validate');
    await $('$Validation_addRule').wait(assert.isDisplayed);

    // There should be no validation lines to begin with.
    assert.lengthOf(await $("$Validation_rules > .kf_row").array(), 0);

    // Create one, and wait for something to appear.
    await $("$Validation_addRule").click();
    await $("$Validation_rules > .validation").wait();

    // Now there should be one validation rule.
    assert.lengthOf(await $("$Validation_rules > .validation").array(), 1);

    // Make sure there are no "validation failure" badgets.
    assert.lengthOf(await $(".gridview_row .validation_error_number").array(), 0);

    // Change rule to fail always, and ensure there is a validation failure for each cell.
    var formula = $("$Validation_rules .validation_formula").eq(0).find(".ace_editor").wait().elem();
    await formula.click();
    await gu.sendKeys('False');
    await $("$Validation_rules .kf_button:contains(Apply)").click();
    await gu.waitForServer();
    assert.lengthOf(await $(".gridview_row .validation_error_number").array(), 4);

    // Empty out the rule, and see that it now passes.
    await driver.withActions(a => a.doubleClick(formula));
    await gu.sendKeys($.DELETE);
    await $("$Validation_rules .kf_button:contains(Apply)").click();
    await gu.waitForServer();
    assert.lengthOf(await $(".gridview_row .validation_error_number").array(), 0);
  });

  /**
   * Helper to fetch information about a validation failure badge. Returns an object with .text
   * being the badge's text (count of failures), and .title being the title attribute.
   */
  async function getRowValidation(rowIndex) {
    try {
      const elem = $(".gridview_data_row_num").eq(rowIndex).find(".validation_error_number");
      const text = await elem.getText();
      const title = await elem.getAttribute('title');
      return { text: text, title: removePrefix(title, "Validation failed: ") };
    } catch (e) {
      if (/NoSuchElement/.test(String(e))) { return null; }
      throw e;
    }
  }

  it("should show correct failure counts and messages", async function() {
    // Enter some data into first column.
    await gu.enterGridValues(0, 1, [["foo", "BAR", "17", ""]]);
    await gu.waitForServer();

    // Change rule to something non-trivial.
    await $("$Validation_rules .validation_formula").eq(0).find(".ace_editor").click();
    await gu.sendKeys("$B.lower() == $B");
    await $(".validation").eq(0).findOldTimey(".kf_button:contains(Apply)").click(); // 2nd row should fail.

    // Add a rule that raises an exception.
    await $("$Validation_addRule").click();
    await gu.waitForServer();
    await $("$Validation_rules .validation_formula").eq(1).find(".ace_editor").click();
    await gu.sendKeys("int($B) > 0");
    await $(".validation").eq(1).findOldTimey(".kf_button:contains(Apply)").click(); // Rows 1,2,3 should fail.
    await gu.waitForServer();

    // Assert correct number of badges, and correct numbers in them.
    await gu.waitForServer(2000);
    assert.lengthOf(await $(".gridview_row .validation_error_number").array(), 3);
    assert.deepEqual(await getRowValidation(0), { text: "1", title: "Rule 2" });
    assert.deepEqual(await getRowValidation(1), { text: "2", title: "Rule 1, Rule 2" });
    assert.deepEqual(await getRowValidation(2), null);
    assert.deepEqual(await getRowValidation(3), { text: "1", title: "Rule 2" });

    // Now change some data and ensure badges and titles changed appropriately.
    await gu.enterGridValues(0, 1, [["FOO", "100", "-17"]]);
    assert.deepEqual(await getRowValidation(0), { text: "2", title: "Rule 1, Rule 2" });
    assert.deepEqual(await getRowValidation(1), null);
    assert.deepEqual(await getRowValidation(2), { text: "1", title: "Rule 2" });
    assert.deepEqual(await getRowValidation(3), { text: "1", title: "Rule 2" });
  });
});
