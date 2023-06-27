import { assert } from 'mocha-webdriver';
import { $, gu, test } from 'test/nbrowser/gristUtil-nbrowser';

describe('Properties.ntest', function() {
  const cleanup = test.setupTestSuite(this);
  before(async function() {
    await gu.supportOldTimeyTestCode();
    await gu.useFixtureDoc(cleanup, "Hello.grist", true);
  });

  afterEach(function() {
    return gu.checkForErrors();
  });

  it("webdriver should handle parens and other keys", async function() {
    // This isn't a test of properties really, but a test of Selenium: speficically that the
    // workaround for Selenium bugs in gu.sendKeys actually works.
    await $("$GridView_columnLabel").first().click();

    // We'll undo afterwards, and verify that we got the same text back.
    var text = await gu.getCellRC(0, 0).text();

    var specialChars = "()[]{}~!@#$%^&*-_=+/?><.,'\";:";
    await gu.sendKeys(specialChars + specialChars, $.ENTER);
    await gu.waitForServer();
    assert.equal(await gu.getCellRC(0, 0).text(), specialChars + specialChars);

    // Undo and compare to previous value.
    await gu.sendKeys([$.MOD, 'z']);
    await gu.waitForServer();
    assert.equal(await gu.getCellRC(0, 0).text(), text);
  });

  it("cells should indicate when conversion fails for a value", async function() {
    await $("$GridView_columnLabel:nth-child(2)").click();

    // Fill in a column of values, some numeric, some not.
    await gu.enterGridValues(0, 1, [["17", "foo", "", "-100"]]);
    await gu.waitForServer();

    assert.deepEqual(await gu.getVisibleGridCells(1, [1, 2, 3, 4]),
      ["17", "foo", "", "-100"]);
    await $("$GridView_columnLabel:nth-child(2)").click();

    // Convert the column to Numeric.
    await gu.openSidePane('field');
    assert.equal(await $(".test-field-label").val(), 'B');
    await gu.setType('Numeric');
    await $('.test-type-transform-apply').wait().click();

    assert.deepEqual(await gu.getVisibleGridCells(1, [1, 2, 3, 4]),
      ["17", "foo", "", "-100"]);

    // Undo of conversion should restore old values.
    await gu.undo();
    await $(".test-fbuilder-type-select .test-select-row:contains(Text)").wait();
    assert.deepEqual(await gu.getVisibleGridCells(1, [1, 2, 3, 4]),
      ["17", "foo", "", "-100"]);

    // Redo should work too.
    await $(".test-redo").click();
    await $(".test-fbuilder-type-select .test-select-row:contains(Numeric)").wait();
    await gu.waitForServer();
    assert.deepEqual(await gu.getVisibleGridCells(1, [1, 2, 3, 4]),
      ["17", "foo", "", "-100"]);
  });

  it("cells should indicate when new value is wrong type", async function() {
    // Go to column "c", and change type to Numeric.
    await $("$GridView_columnLabel:nth-child(3)").click();
    assert.equal(await $(".test-field-label").val(), 'C');
    await gu.setType('Numeric');
    await $('.test-type-transform-apply').wait().click();
    await gu.waitForServer();

    // Remove focus from FieldBuilder type dropdown, so that sentKeys go to the main app.
    await $("body").click();

    // Fill in a column of values, some numeric, some not.
    await gu.enterGridValues(0, 2, [["25", "", "bar", "-123"]]);
    await gu.waitForServer();

    // TODO: The 0.00 might be wrong behavior: we probably want an empty cell here, although when
    // converting an empty text cell to numeric, we want it to become 0. In other words, not all
    // conversions are the same.
    assert.deepEqual(await gu.getVisibleGridCells(2, [1, 2, 3, 4]),
      ["25", "", "bar", "-123"]);
    assert.deepEqual(await gu.getVisibleGridCells({
      col: 2,
      rowNums: [1, 2, 3, 4],
      mapper: e => e.find('.field_clip').hasClass('invalid'),
    }), [false, false, true, false]);

    // Select the column again, and type in values in a different order. Ensure the cells change
    // appropriately.
    await $("$GridView_columnLabel:nth-child(3)").click();
    await gu.enterGridValues(0, 2, [["", "bar", "-123", "25"]]);
    await gu.waitForServer();

    // TODO: The first cell might be wrong behavior; we probably want an empty cell after DELETE.
    assert.deepEqual(await gu.getVisibleGridCells(2, [1, 2, 3, 4]),
      ["", "bar", "-123", "25"]);
    assert.deepEqual(await gu.getVisibleGridCells({
      col: 2,
      rowNums: [1, 2, 3, 4],
      mapper: e => e.find('.field_clip').hasClass('invalid')
    }), [false, true, false, false]);
  });

  it("formula errors should be indicated", async function() {
    // Go to column "E", and change formula to eval column "D".
    await $("$GridView_columnLabel:nth-child(5)").click();
    await gu.sendKeys("eval($D)", $.ENTER);
    // Fill in a bunch of formula text for the "eval" formula to try. This is a way to get a whole
    // bunch of different errors in one columns.
    await $("$GridView_columnLabel:nth-child(4)").click();
    assert.equal(await $(".test-field-label").val(), 'D');
    await gu.setType('Text');

    await gu.enterGridValues(0, 3, [[
                       "25",
                       "",
                       "asdf",
                       "ValueError()",
                       "__import__('sys').exit(3)",
                       'u"résumé 三"',
                       "12/(2-1-1)",
                       "[1,2,3]"]]);
    await gu.waitForServer();

    assert.deepEqual(await gu.getVisibleGridCells(4, [1, 2, 3, 4, 5, 6, 7, 8]), [
        "25",
        "#SyntaxError",
        "#NameError",
        "ValueError()",
        "#SystemExit",
        'résumé 三',
        "#DIV/0!",
        "1, 2, 3",
    ]);

    assert.deepEqual(
      await gu.getVisibleGridCells({
        col: 4,
        rowNums: [1, 2, 3, 4, 5, 6, 7, 8],
        mapper: e => e.find('.field_clip').hasClass("invalid")
      }),
      // Last one (list) is valid because lists are a supported type of value.
      [false, true, true, true, true, false, true, false]);
  });
});
