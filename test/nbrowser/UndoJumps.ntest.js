import { assert } from 'mocha-webdriver';
import { $, gu, test } from 'test/nbrowser/gristUtil-nbrowser';

describe('UndoJumps.ntest', function() {
  const cleanup = test.setupTestSuite(this);

  before(async function() {
    await gu.supportOldTimeyTestCode();
    await gu.useFixtureDoc(cleanup, "WorldUndo.grist", true);
  });

  afterEach(function() {
    return gu.checkForErrors();
  });

  async function clickCellAndCheck(pos, text) {
    let cell = gu.getCell(pos);
    await cell.click();
    assert.equal(await cell.text(), text);
  }

  async function getSectionAndCursor() {
    let section = await $('.active_section .test-viewsection-title').wait().text();
    let cursorPos = await gu.getCursorPosition();
    let text = await gu.getActiveCell().text();
    return Object.assign({section, text}, cursorPos);
  }

  function beforePos(pos) { return Object.assign({}, pos, {text: pos.text[0]}); }
  function afterPos(pos) { return Object.assign({}, pos, {text: pos.text[1]}); }

  let positions = [];

  it("test setup", async function() {
    // In this pseudo-testcase, we do a bunch of actions, whose undo will require jumping around.
    // We store expected positions along the way, to make it easier to know what to expect.
    this.timeout(Math.max(this.timeout(), 20000));    // Long-running test, unfortunately

    // In City view, record section, change a cell on screen (row 3, col 1).
    await gu.actions.selectTabView('City');
    positions.push({section: 'CITY', rowNum: 3, col: 0, text: ['Aalborg', 'rec-update1']});
    await clickCellAndCheck({section: 'City', rowNum: 3, col: 0}, 'Aalborg');
    await gu.sendKeys('rec-update1', $.ENTER);
    await gu.waitForServer();

    // Then scroll and change another cell off screen, near the bottom (row 4070, col 3).
    await gu.sendKeys([$.MOD, $.DOWN]);
    positions.push({section: 'CITY', rowNum: 4070, col: 2, text: ['Çorum', 'upd-2']});
    await clickCellAndCheck({section: 'CITY', rowNum: 4070, col: 2}, 'Çorum');
    await gu.sendKeys('upd-2', $.ENTER);
    await gu.waitForServer();

    // In City view, detail section, change a cell too (row 20, col 'Name').
    await gu.actions.viewSection('CITY Card List').selectSection();
    await gu.sendKeys([$.MOD, $.UP]);
    await gu.sendKeys([$.MOD, 'F'], 'bogotá', $.ESCAPE);
    // discard notification
    await $(".test-notifier-toast-close").wait(100).click();
    positions.push({section: 'CITY Card List', rowNum: 20, col: 'Name',
                    text: ['Santafé de Bogotá', 'det-update']});
    let cell = gu.getDetailCell('Name', 20);
    await cell.click();
    assert.equal(await cell.text(), 'Santafé de Bogotá');
    await gu.sendKeys('det-update', $.ENTER);
    await gu.waitForServer();

    // Switch to different view (Country), scroll to bottom and add a record (row 240, col 2).
    await gu.actions.selectTabView('Country');
    await gu.sendKeys([$.MOD, $.DOWN], $.RIGHT);
    positions.push({section: 'COUNTRY', rowNum: 240, col: 1, text: ['', 'country-add']});
    await gu.sendKeys('country-add', $.ENTER);
    await gu.waitForServer();

    // Switch back to City view, and add a record by inserting before row 10.
    await gu.actions.selectTabView('City');
    await gu.actions.viewSection('City').selectSection();
    await gu.sendKeys([$.MOD, $.UP]);
    positions.push({section: 'CITY', rowNum: 10, col: 1, text: ['United Kingdom', '']});
    await gu.clickCell({section: 'City', rowNum: 10, col: 1});
    await gu.sendKeys([$.MOD, $.SHIFT, $.ENTER]);
    await gu.waitForServer();

    // Switch back to Country view, delete a record (row 6)
    await gu.actions.selectTabView('Country');
    await gu.sendKeys([$.MOD, $.UP]);
    positions.push({section: 'COUNTRY', rowNum: 5, col: 1, text: ['Albania', 'Andorra']});
    await clickCellAndCheck({section: 'Country', rowNum: 5, col: 1}, 'Albania');
    await gu.sendKeys([$.MOD, $.DELETE]);
    await gu.confirm(true, true); // confirm and remember
    await gu.waitForServer();

    // Switch back to City view, place cursor onto (row 8, col 'District'), delete column.
    await gu.actions.selectTabView('City');
    await gu.sendKeys([$.MOD, $.UP]);
    positions.push({section: 'CITY', rowNum: 7, col: 2, text: ['Hakassia', '169200']});
    await clickCellAndCheck({section: 'City', rowNum: 7, col: 2}, 'Hakassia');
    await gu.sendKeys([$.ALT, '-']);
    await gu.waitForServer();

    // Switch to Country view, and add a column.
    await gu.actions.selectTabView('Country');
    positions.push({section: 'COUNTRY', rowNum: 4, col: 2, text: ['North America', '']});
    await clickCellAndCheck({section: 'Country', rowNum: 4, col: 2}, 'North America');
    await gu.sendKeys([$.ALT, $.SHIFT, '=']);
    await gu.waitForServer();
    await gu.sendKeys($.ENTER);
  });

  async function check_undos() {
    // Initial position, at the end of the setup (on a newly-added column).
    assert.deepEqual(await getSectionAndCursor(),
      {section: 'COUNTRY', rowNum: 4, col: 2, text: ''});

    // Move to a different place.
    await gu.clickCell({section: 'CountryLanguage', rowNum: 1, col: 'Percentage'});

    // Now call undo repeatedly, comparing positions recorded in the `positions` list.
    for (let i = positions.length - 1; i >= 0; i--) {
      await gu.undo();
      assert.deepEqual(await getSectionAndCursor(), beforePos(positions[i]),
        `Undo position #${i} doesn't match`);
    }

    // Just to make sure these checks actually ran, verify where we are.
    assert.deepEqual(await getSectionAndCursor(),
      {section: 'CITY', rowNum: 3, col: 0, text: 'Aalborg'});
    assert.equal(positions.length, 8);
  }

  it("should jump to position of last action on undo", async function() {
    // Undo each action, verifying cursor position each time.
    await check_undos();
  });

  it("should jump to position of last action on redo", async function() {
    // Redo each action, verifying cursor position each time.

    // Move to a different view/place.
    await gu.actions.selectTabView('Country');
    await gu.clickCell({section: 'Country', rowNum: 239, col: 'Name'});
    await gu.clickCell({section: 'CountryLanguage', rowNum: 1, col: 'Percentage'});

    // Now call redo repeatedly, verifying recorded positions.
    for (let i = 0; i < positions.length; i++) {
      await gu.redo();
      assert.deepEqual(await getSectionAndCursor(), afterPos(positions[i]),
        `Redo position #${i} doesn't match`);
    }

    // To make sure checks ran, verify where we are.
    assert.deepEqual(await getSectionAndCursor(),
      {section: 'COUNTRY', rowNum: 4, col: 2, text: ''});
    assert.equal(positions.length, 8);
  });

  it("should jump again on second undo after redo", async function() {
    // Undo again, it should work the same way.
    await check_undos();
  });
});
