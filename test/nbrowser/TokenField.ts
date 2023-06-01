import {assert, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('TokenField', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();
  let session: gu.Session;

  before(async function() {
    session = await gu.session().login();
    await session.tempDoc(cleanup, "Favorite_Films.grist");
    await gu.toggleSidePanel('right', 'open');

    // Prepare test table, as a base for following tests.
    await gu.addNewPage('Table', 'New Table');
    await gu.sendKeys('one', Key.ENTER);
    await gu.waitForServer();
    await gu.sendKeys('two', Key.ENTER);
    await gu.waitForServer();
    await gu.sendKeys('three', Key.ENTER);
    await gu.waitForServer();
  });

  it('should clear choice list on card view', async function() {
    // Test for a bug. In Card or Card List widgets, if the cursor is on a Ref List or Choice List field and you
    // hit Backspace or Delete , the behavior is the same as hitting enter (pulls up list of references/choices to add
    // one more, does not clear cell).

    // The bug was there because choice list editor and ref list editor didn't handle empty string as an edit value,
    // which is a signal to clear the value. In a grid view, DELETE and BACKSPACE were handled by the grid itself.

    const revert = await gu.begin();
    await gu.getCell('A', 1).click();

    // Convert A column to Choice List.
    await gu.openColumnPanel();
    await gu.setType('Choice List', {apply: true});

    // Add a second value to the first row.
    await gu.getCell('A', 1).click();
    await gu.sendKeys(Key.ENTER);
    await gu.sendKeys('two', Key.ENTER);
    await gu.sendKeys(Key.ENTER);
    await gu.waitForServer();
    await gu.getCell('A', 1).click();
    assert.equal(await gu.getCell('A', 1).getText(), 'one\ntwo');

    // Change it to card view.
    await gu.changeWidget('Card');

    // Test that DELETE opens the editor and clears the value.
    // Clicking on the cell twice will put it in edit mode, so we will first click other cell.
    await gu.getDetailCell('B', 1).click();
    await gu.getDetailCell('A', 1).click();
    await gu.sendKeys(Key.DELETE);
    await gu.checkTokenEditor('');
    await gu.sendKeys(Key.ESCAPE);

    // Now test BACKSPACE.
    await gu.getDetailCell('B', 1).click();
    await gu.getDetailCell('A', 1).click();
    await gu.sendKeys(Key.BACK_SPACE);
    await gu.checkTokenEditor('');
    await gu.sendKeys(Key.ESCAPE);

    // Value should still be there.
    assert.equal(await gu.getDetailCell('A', 1).getText(), 'one\ntwo');
    // But ENTER works fine, it just opens the editor.
    await gu.sendKeys(Key.ENTER);
    await gu.checkTokenEditor('one\ntwo');
    await gu.sendKeys(Key.ESCAPE);
    // Any other key also works
    await gu.sendKeys('a');
    await gu.checkTokenEditor('a');
    await gu.sendKeys(Key.ESCAPE);
    await revert();
  });

  it('should clear ref list on card view', async function() {
    await gu.getCell(0, 1).click();
    await gu.changeBehavior('Clear and reset');
    // This is an empty column, so no transformation is needed.
    await gu.setType('Reference List', {apply: false});
    await gu.waitForServer();
    await gu.setRefTable('Films');
    await gu.waitForServer();
    await gu.setRefShowColumn('Title');
    await gu.waitForServer();

    // Add two films.
    await gu.sendKeys(Key.ENTER);
    await gu.sendKeys('Toy', Key.ENTER);
    await gu.sendKeys('Alien', Key.ENTER);
    // Save.
    await gu.sendKeys(Key.ENTER);
    await gu.waitForServer();

    // Make sure it works in Grid view.
    await gu.getCell(0, 1).click();
    await gu.sendKeys(Key.DELETE);
    await gu.waitForServer();
    assert.equal(await gu.getCell(0, 1).getText(), '');
    await gu.undo();
    await gu.sendKeys(Key.BACK_SPACE);
    await gu.waitForServer();
    assert.equal(await gu.getCell(0, 1).getText(), '');
    await gu.undo();

    // Now make sure it works in Card view.
    await gu.changeWidget('Card');
    assert.equal(await gu.getDetailCell('A', 1).getText(), 'Toy Story\nAlien');
    await gu.sendKeys(Key.DELETE);
    await gu.checkTokenEditor('');
    await gu.sendKeys(Key.ESCAPE);
    await gu.sendKeys(Key.BACK_SPACE);
    await gu.checkTokenEditor('');
    await gu.sendKeys(Key.ESCAPE);
    await gu.waitForServer();
    // Nothing should have changed.
    assert.equal(await gu.getDetailCell('A', 1).getText(), 'Toy Story\nAlien');
  });
});
