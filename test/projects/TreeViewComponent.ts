import { delay } from 'bluebird';
import { addToRepl, assert, driver} from 'mocha-webdriver';
import { server, setupTestSuite } from './testUtils';

describe('TreeViewComponent', () => {
  setupTestSuite();
  addToRepl('findItem', findItem);

  before(async function() {
    this.timeout(60000);
    await driver.get(`${server.getHost()}/TreeViewComponent`);
  });

  it('should display correct tree view', async function() {
    // check pages shown in right order
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper', (e) => e.getText()),
      ['Page1', 'Page2', 'Page3', 'Page4', 'Page5', 'Page6']);
    // check pages shown with right indentation
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper .test-treeview-offset',
                                          (e) => e.getCssValue('width')),
      [ '0px', '10px', '10px', '20px', '0px', '0px' ]);
    // check pages shown with correct arrows
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper .test-treeview-itemArrow',
        async (e) => await e.getCssValue('visibility') === 'visible'),
      [true, false, true, false, false, false]);
  });

  it('should reflect model update', async function() {
    // test insertion
    await driver.find('input.insert').doClick();
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper', (e) => e.getText()),
      ['Page1', 'Page2', 'Page3', 'Page4', 'Page5', 'Page6', 'New Page']);
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper .test-treeview-offset',
                                          (e) => e.getCssValue('width')),
      [ '0px', '10px', '10px', '20px', '0px', '0px', '0px' ]);
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper .test-treeview-itemArrow',
        async (e) => await e.getCssValue('visibility') === 'visible'),
      [true, false, true, false, false, false, false]);

    // test insertion in a subfolder
    await driver.find('input.subInsert').doClick();
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper', (e) => e.getText()),
      ['Page1', 'Page2', 'Page3', 'Page4', 'New Page 5', 'Page5', 'Page6', 'New Page']);
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper .test-treeview-offset',
                                          (e) => e.getCssValue('width')),
      [ '0px', '10px', '10px', '20px', '10px', '0px', '0px', '0px' ]);
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper .test-treeview-itemArrow',
        async (e) => await e.getCssValue('visibility') === 'visible'),
      [true, false, true, false, false, false, false, false]);

    // removing the last of a group should remove the arrow of that group.
    assert.deepEqual(await findItem(/Page3/).find('.test-treeview-itemArrow').getCssValue('visibility'), 'visible');
    await driver.find('input.removePage4').doClick();
    assert.deepEqual(await findItem(/Page3/).find('.test-treeview-itemArrow').getCssValue('visibility'), 'hidden');

    // reset tree
    await driver.find('input.reset').doClick();
  });

  it('should have a working handle', async function() {

    // hovering shows the handle
    const handle = findItem(/Page2/).find('.test-treeview-handle');
    assert.equal(await handle.isDisplayed(), false);
    await findItem(/Page2/).mouseMove();
    assert.equal(await handle.isDisplayed(), true);

    // should slides when dragging
    await startDrag(/Page2/);

    // check that Page2 is being dragged
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper.dragged', (e) => e.getText()), ['Page2']);

     // moving cursor few pixels up should moves handle same amount up
    const oldTop = (await handle.rect()).top;
    // 1px
    await driver.mouseMoveBy({y: 1});
    assert.closeTo((await handle.rect()).top - oldTop, 1, 1);
    // 4px
    await driver.mouseMoveBy({y: 4});
    assert.closeTo((await handle.rect()).top - oldTop, 4, 1);

    // moving cursor out should hide handle
    await driver.mouseMoveBy({x: 100});
    assert.equal(await handle.isDisplayed(), false);
    await findItem(/Page2/).mouseMove();
    assert.equal(await handle.isDisplayed(), true);

    // releasing should snap handle
    await driver.withActions((actions) => actions.release());
    assert.equal(await handle.getCssValue('top'), '0px');

  });

  it('should show target and target\'s parent', async function() {

    const target = findTarget();

    assert.equal(await driver.find('.test-treeview-target').isDisplayed(), false);
    assert.deepEqual(await driver.findAll(`.test-treeview-itemHeader.highlight`, (e) => e.getText()), []);

    await startDrag(/Page6/);
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper.dragged', (e) => e.getText()), ['Page6']);

    // target below Page5
    await moveTo(/Page5/, {y: 1});
    assert.equal(await driver.find('.test-treeview-target').isDisplayed(), true);
    assert.deepEqual(await driver.findAll(`.test-treeview-itemHeader.highlight`, (e) => e.getText()), []);
    await assertTargetPos(await target.rect(), 'below', await findItemRectangles(/Page5/));

    // target above Page5
    await moveTo(/Page5/, {y: -1});
    assert.equal(await driver.find('.test-treeview-target').isDisplayed(), true);
    assert.deepEqual(await driver.findAll(`.test-treeview-itemHeader.highlight`, (e) => e.getText()), []);
    await assertTargetPos(await target.rect(), 'above', await findItemRectangles(/Page5/));

    // target first child Page1
    await moveTo(/Page1/, {y: 1});
    assert.equal(await driver.find('.test-treeview-target').isDisplayed(), true);
    assert.deepEqual(await driver.findAll(`.test-treeview-itemHeader.highlight`, (e) => e.getText()), ['Page1']);
    await assertTargetPos(await target.rect(), 'above', await findItemRectangles(/Page2/));

    // target children of Page3 should update the parent target
    await moveTo(/Page4/);
    assert.equal(await driver.find('.test-treeview-target').isDisplayed(), true);
    assert.deepEqual(await driver.findAll(`.test-treeview-itemHeader.highlight`, (e) => e.getText()), ['Page3']);
    await assertTargetPos(await target.rect(), 'above', await findItemRectangles(/Page4/));

    // leaving component hide targets
    await driver.mouseMoveBy({x: 300});
    assert.equal(await driver.find('.test-treeview-target').isDisplayed(), false);
    assert.deepEqual(await driver.findAll(`.test-treeview-itemHeader.highlight`, (e) => e.getText()), []);

    // reentering reveals targets
    await moveTo(/Page4/);
    assert.equal(await driver.find('.test-treeview-target').isDisplayed(), true);
    assert.deepEqual(await driver.findAll(`.test-treeview-itemHeader.highlight`, (e) => e.getText()), ['Page3']);
    await assertTargetPos(await target.rect(), 'above', await findItemRectangles(/Page4/));

    // releases hides targets
    await driver.actions().release().perform();
    assert.equal(await driver.find('.test-treeview-target').isDisplayed(), false);
    assert.deepEqual(await driver.findAll(`.test-treeview-itemHeader.highlight`, (e) => e.getText()), []);
  });

  it('should prevent dropping on it\'s own children', async function() {
    await startDrag(/Page1/);
    await moveTo(/Page1/, {y: 1});
    assert.equal(await driver.find('.test-treeview-target').isDisplayed(), false);
    assert.deepEqual(await driver.findAll(`.test-treeview-itemHeader.highlight`, (e) => e.getText()), []);

    await moveTo(/Page2/);
    assert.equal(await driver.find('.test-treeview-target').isDisplayed(), false);
    assert.deepEqual(await driver.findAll(`.test-treeview-itemHeader.highlight`, (e) => e.getText()), []);

    await driver.actions().release().perform();
  });


  it('should not be possible to drop above or below dragged item', async function() {
    await startDrag(/Page5/);
    await moveTo(/Page5/, {y: 1});
    assert.equal(await driver.find('.test-treeview-target').isDisplayed(), false);
    assert.deepEqual(await driver.findAll(`.test-treeview-itemHeader.highlight`, (e) => e.getText()), []);

    await moveTo(/Page5/, {y: -1});
    assert.equal(await driver.find('.test-treeview-target').isDisplayed(), false);
    assert.deepEqual(await driver.findAll(`.test-treeview-itemHeader.highlight`, (e) => e.getText()), []);

    await driver.actions().release().perform();
  });

  it('should call right callback when dropping', async function() {
    this.timeout(6000);
    await driver.find('input.clearLogs').doClick();
    await startDrag(/Page5/);
    await moveTo(/Page2/, {y: 1});
    await driver.actions().release().perform();
    assert.deepEqual(await driver.findAll('.model-calls', (e) => e.getText()), [
      'insert Page5 before Page3 in Page1']);

    // check that dropping below the above item does nothing
    await driver.find('input.clearLogs').doClick();
    await startDrag(/Page6/);
    await moveTo(/Page5/, {y: 1});
    await stopDrag();
    assert.deepEqual(await driver.findAll('.model-calls', (e) => e.getText()), []);

    // check that dropping above the below item does nothing
    await startDrag(/Page5/);
    await moveTo(/Page6/, {y: -1});
    await stopDrag();
    assert.deepEqual(await driver.findAll('.model-calls', (e) => e.getText()), []);

    // check that do not call when dropping on dragged item
    await startDrag(/Page5/);
    await driver.mouseMoveBy({x: -1});
    await stopDrag();
    assert.deepEqual(await driver.findAll('.model-calls', (e) => e.getText()), []);
  });

  it('should support selection', async function() {
    assert.deepEqual(await driver.findAll(`.test-treeview-itemHeader.selected`, (e) => e.getText()), []);

    // select one item
    await driver.findContent('.test-treeview-label', /Page1/).doClick();
    assert.deepEqual(await driver.findAll(`.test-treeview-itemHeader.selected`, (e) => e.getText()), ["Page1"]);

    // select another item
    await driver.findContent('.test-treeview-label', /Page4/).doClick();
    assert.deepEqual(await driver.findAll(`.test-treeview-itemHeader.selected`, (e) => e.getText()), ["Page4"]);
  });

  it('should support collapsing', async function() {
    // reset tree and check initial state
    await driver.find('input.reset').doClick();
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper', (e) => e.getText()),
      ['Page1', 'Page2', 'Page3', 'Page4', 'Page5', 'Page6']);
    // let's collapse Page1
    await findItem(/Page1/).find('.test-treeview-itemArrow').doClick();
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper', (e) => e.getText()),
      ['Page1', '', '', '', 'Page5', 'Page6']);
    // uncollapse
    await findItem(/Page1/).find('.test-treeview-itemArrow').doClick();
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper', (e) => e.getText()),
      ['Page1', 'Page2', 'Page3', 'Page4', 'Page5', 'Page6']);
  });

  it('highlighted item should show a solid border', async function() {
    assert.deepEqual(await driver.findAll(`.test-treeview-itemHeader.highlight`, (e) => e.getText()), []);
    await startDrag(/Page6/);

    await findItem(/Page4/).mouseMove();
    assert.deepEqual(await driver.findAll(`.test-treeview-itemHeader.highlight`, (e) => e.getText()), ["Page3"]);
  });

  it('should support auto expansion', async function() {
    this.timeout(6000);
    const target = await findTarget();
    await driver.find('input.clearLogs').doClick();

    // let's collapse Page1
    await findItem(/Page1/).find('.test-treeview-itemArrow').doClick();
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper', (e) => e.getText()),
      ['Page1', '', '', '', 'Page5', 'Page6']);
    await startDrag(/Page6/);
    await findItem(/Page1/).mouseMove();
    // Page1 not expanded yet and target is shown below Page1
    await delay(800);
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper', (e) => e.getText()),
      ['Page1', '', '', '', 'Page5', 'Page6']);
    assert.equal(await driver.find('.test-treeview-target').isDisplayed(), true);
    assert.deepEqual(await driver.findAll(`.test-treeview-itemHeader.highlight`, (e) => e.getText()), []);
    await assertTargetPos(await target.rect(), 'above', await findItemRectangles(/Page1/));
    // moving cursor over Page1 should not delay expansion
    await driver.mouseMoveBy({x: 2});
    await delay(400);
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper', (e) => e.getText()),
      ['Page1', 'Page2', 'Page3', 'Page4', 'Page5', 'Page6']);
    assert.equal(await driver.find('.test-treeview-target').isDisplayed(), true);
    assert.deepEqual(await driver.findAll(`.test-treeview-itemHeader.highlight`, (e) => e.getText()), ['Page1']);
    await assertTargetPos(await target.rect(), 'above', await findItemRectangles(/Page2/));

    // Check that there is no offset between cursor and the handle
    assert.isBelow((await findItem(/Page6/).find('.test-treeview-handle').rect()).top, 50);

    // moving cursor hover same item after expansion should not change the target
    await driver.mouseMoveBy({x: -2});
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper', (e) => e.getText()),
      ['Page1', 'Page2', 'Page3', 'Page4', 'Page5', 'Page6']);
    assert.equal(await driver.find('.test-treeview-target').isDisplayed(), true);
    assert.deepEqual(await driver.findAll(`.test-treeview-itemHeader.highlight`, (e) => e.getText()), ['Page1']);
    await assertTargetPos(await target.rect(), 'above', await findItemRectangles(/Page2/));

    await stopDrag();

    assert.deepEqual(await driver.findAll('.model-calls', (e) => e.getText()), [
      'insert Page6 before Page2 in Page1']);
    assert.equal(await target.isDisplayed(), false);
  });

  it('should not auto expand when leaving item before timeout', async function() {
    this.timeout(4000);
    // let's collapse Page1
    await findItem(/Page1/).find('.test-treeview-itemArrow').doClick();
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper', (e) => e.getText()),
      ['Page1', '', '', '', 'Page5', 'Page6']);
    await startDrag(/Page6/);
    await findItem(/Page1/).mouseMove();
    await delay(900);
    await findItem(/Page5/).mouseMove();
    await delay(400);
    // Page1 is still collapsed
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper', (e) => e.getText()),
      ['Page1', '', '', '', 'Page5', 'Page6']);
    await stopDrag();
  });

  it('auto expand should not cause target to change when the item was already expanded', async function() {
    this.timeout(4000);
    // let's expand Page1
    await findItem(/Page1/).find('.test-treeview-itemArrow').doClick();
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper', (e) => e.getText()),
      ['Page1', 'Page2', 'Page3', 'Page4', 'Page5', 'Page6']);
    const target = findTarget();
    await startDrag(/Page6/);
    await findItem(/Page1/).mouseMove();
    // target is above Page1
    assert.equal(await driver.find('.test-treeview-target').isDisplayed(), true);
    assert.deepEqual(await driver.findAll(`.test-treeview-itemHeader.highlight`, (e) => e.getText()), []);
    await assertTargetPos(await target.rect(), 'above', await findItemRectangles(/Page1/));
    await delay(1200);
    // target remains above Page1
    assert.equal(await driver.find('.test-treeview-target').isDisplayed(), true);
    assert.deepEqual(await driver.findAll(`.test-treeview-itemHeader.highlight`, (e) => e.getText()), []);
    await assertTargetPos(await target.rect(), 'above', await findItemRectangles(/Page1/));

    await stopDrag();
  });

  it('auto expand should work on item with empty list of children', async function() {
    await driver.find('input.clearLogs').doClick();
    const target = findTarget();
    await startDrag(/Page6/);
    // page5 has an empty list of children
    await findItem(/Page5/).mouseMove();
    await delay(1200);
    assert.equal(await target.isDisplayed(), true);
    assert.deepEqual(await driver.findAll(`.test-treeview-itemHeader.highlight`, (e) => e.getText()), ['Page5']);
    await stopDrag();
    assert.deepEqual(await driver.findAll('.model-calls', (e) => e.getText()), [
      'insert Page6 before null in Page5']);
  });

  it('should flatten tree if isOpen is false', async function() {
    await driver.find('input.reset').doClick();

    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper .test-treeview-offset',
                                          (e) => e.getCssValue('display')),
      ['block', 'block', 'block', 'block', 'block', 'block']);
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper .test-treeview-itemArrow',
        (e) => e.getCssValue('display')),
      ['flex', 'flex', 'flex', 'flex', 'flex', 'flex']);

    await driver.find('input.isOpen').doClick();

    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper .test-treeview-offset',
                                          (e) => e.getCssValue('display')),
      ['none', 'none', 'none', 'none', 'none', 'none']);
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper .test-treeview-itemArrow',
        (e) => e.getCssValue('display')),
      ['none', 'none', 'none', 'none', 'none', 'none']);

    // un-flatten the tree
    await driver.find('input.isOpen').doClick();
  });

  it('holding mouse down for a while should starts dragging', async function() {
    this.timeout(4000);

    // let's press mouse
    await driver.withActions((actions) => actions
      .move({origin: findItem(/Page1/)})
      .press());

    // should not start dragging just yet
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper.dragged', (e) => e.getText()), []);

    // should start dragging after timeout expired
    await delay(510);
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper.dragged', (e) => e.getText()), ['Page1']);

    // holding mouse down on the arrow should not start dragging
    await driver.withActions((actions) => actions
      .release()
      .move({origin: findItem(/Page1/).find('.test-treeview-itemArrow')})
      .press());
    await delay(510);
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper.dragged', (e) => e.getText()), []);
    await driver.withActions((actions) => actions.release());

    // click should not start dragging
    await findItem(/Page1/).doClick();
    await delay(510);
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper.dragged', (e) => e.getText()), []);

  });

  it('should reuse dom for treeItem ', async function() {
    /* Treeview should reuse dom when an item is removed from a tree node to be inserted into
     * another one. So if we collapse Page3 and then move it before Page6 it should remain
     * collapsed.
     */
    await driver.find('input.reset').doClick();
    // lets' check no pages are collapsed
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper', (e) => e.getText()),
      ['Page1', 'Page2', 'Page3', 'Page4', 'Page5', 'Page6']);

    // let's collapse Page3.
    await findItem(/Page3/).find('.test-treeview-itemArrow').doClick();
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper', (e) => e.getText()),
      // We can tell that Page3 is collapsed because '' shows instead of 'Page4'
      ['Page1', 'Page2', 'Page3', '', 'Page5', 'Page6']);

    // let's move Page3 and check that it remained collapsed.
    await driver.find('input.move').doClick();
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper', (e) => e.getText()),
      // Even though Page3 has moved we can tell it remained collapsed because '' still show in place of 'Page4'
      ['Page1', 'Page2', 'Page5', 'Page3', '', 'Page6']);

    // let's expand Page3
    await findItem(/Page3/).find('.test-treeview-itemArrow').doClick();
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper', (e) => e.getText()),
      ['Page1', 'Page2', 'Page5', 'Page3', 'Page4', 'Page6']);
  });

  it('should dispose element that are not reused', async function() {
    await driver.find('input.reset').doClick();
    await delay(100);
    await driver.find('input.clearLogs').doClick();
    assert.deepEqual(await driver.findAll('.disposed-items', (e) => e.getText()), []);
    await driver.find('input.remove').doClick();
    assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper', (e) => e.getText()),
      ['Page5', 'Page6']);
    assert.deepEqual(await driver.findAll('.disposed-items', (e) => e.getText()),
      ['Page1', 'Page2', 'Page3', 'Page4']);
  });

  describe('isReadonly mode', function() {

    it('should hide the handle', async function() {

      // reset
      await driver.find('input.reset').doClick();

      // enable isReadonly mode
      await driver.find('.isReadonly').click();

      // hover on page Page1
      await moveTo(/Page1/);

      // check that the handle is not visible
      assert.equal(await findItem(/Page1/).find('.test-treeview-handle').isDisplayed(), false);

    });

    it('should disable delayed dragging', async function() {
      this.timeout(4000);

      // let's press mouse
      await driver.withActions((actions) => (
        actions
          .move({origin: findItem(/Page1/)})
          .press()
      ));

      // should not start dragging even after timeout expired
      await delay(510);

      assert.deepEqual(await driver.findAll('.test-treeview-itemHeaderWrapper.dragged', (e) => e.getText()), []);

      // release the mouse
      await driver.withActions((actions) => (
        actions
          .release()
      ));
    });
  });

});

function startDrag(item: RegExp) {
 return driver.withActions((actions) => actions
    .move({origin: findItem(item)})
    .move({origin: findItem(item).find('.test-treeview-handle')})
    .press());
}

function stopDrag() {
  return driver.withActions((actions) => actions.release());
}

async function moveTo(item: RegExp, opt: {y: number} = {y: 0}) {
  const el = await driver.findContent('.test-treeview-itemHeaderWrapper', item);
  await el.mouseMove(opt);
}

async function assertTargetPos(targetRect: ClientRect, zone: 'above'|'below',
                               item: {header: ClientRect, label: ClientRect}) {
  // on the left, the target should starts where the label starts
  assert.closeTo(targetRect.left, item.label.left, 1, 'wrong left offset');
  // on the right, the target should end at the end of the header
  assert.closeTo(targetRect.right, item.header.right, 1, 'wrong right');
  assert.closeTo(targetRect.top, zone === 'above' ? item.header.top : item.header.bottom, 2);
}

function findItem(pattern: RegExp) {
  return driver.findContent('.test-treeview-itemHeaderWrapper', pattern);
}

async function findItemRectangles(pattern: RegExp) {
  const item = findItem(pattern);
  return {header: await item.find('.test-treeview-itemHeader').rect(),
          label: await item.find('.test-treeview-label').rect()};
}

function findTarget() {
  return driver.find('.test-treeview-target');
}
