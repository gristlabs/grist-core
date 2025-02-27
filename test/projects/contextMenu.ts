import { server, setupTestSuite } from './testUtils';
import { addToRepl, assert, driver, Key } from 'mocha-webdriver';
import { waitToPass } from 'test/nbrowser/gristUtils';

async function contextMenu(x?: number, y?: number) {
  const rect = await driver.find('body').getRect();
  return driver.withActions(actions => {
    if (x !== undefined && y !== undefined) {
      // passing {orign: 'viewport'} to `actions.move` does not work in bridge mode, so we need to
      // adjust x, y to position relative to body
      x = Math.ceil(x - rect.width * 0.5);
      y = Math.ceil(y - rect.height * 0.5);
      actions.move({x, y, origin: driver.find('body')});
    }
    actions.contextClick();
  });
}

describe('contextMenu', function() {
  setupTestSuite();

  before(async function() {
    this.timeout(20000);
    await driver.get(`${server.getHost()}/contextMenu`);
    addToRepl('contextMenu', contextMenu);
  });

  it('should open on contextmenu and work properly', async function() {
    await waitToPass(async () =>  {
      await contextMenu(10, 10);
      assert.equal(await driver.find('.grist-floating-menu').isPresent(), true);
    });

    // click Foo
    await driver.findContent('.grist-floating-menu li', 'Foo').click();

    // check menu is gone
    assert.equal(await driver.find('.grist-floating-menu').isPresent(), false);

    // check action worked
    assert.deepEqual(
      await driver.findAll('.test-logs', e => e.getText()),
      ['foo added']
    );

    // click Bar
    await contextMenu();

    // check action worked
    await driver.findContent('.grist-floating-menu li', 'Bar').click();
    assert.deepEqual(
      await driver.findAll('.test-logs', e => e.getText()),
      ['foo added', 'bar added']
    );

    // click Reset
    await contextMenu();

    // check action worked
    await driver.findContent('.grist-floating-menu li', 'Reset').click();
    assert.deepEqual(
      await driver.findAll('.test-logs', e => e.getText()),
      []
    );

    // open context menu
    await contextMenu();

    // check menu is open
    assert.equal(await driver.find('.grist-floating-menu').isPresent(), true);

    // send Escape
    await driver.sendKeys(Key.ESCAPE);

    // check menu is closed
    assert.equal(await driver.find('.grist-floating-menu').isPresent(), false);
  });

  it('should support arrow navigation', async function() {
    // check logs is empty
    assert.deepEqual(
      await driver.findAll('.test-logs', e => e.getText()),
      []
    );

    // open context menu
    await contextMenu();

    // send down arrow and ENTER
    await driver.sendKeys(Key.DOWN, Key.ENTER);

    // check foo was added
    assert.deepEqual(
      await driver.findAll('.test-logs', e => e.getText()),
      ['foo added']
    );
  });

  it('should keep menu within viewport', async function() {
    // open menu
    await contextMenu(10, 10);

    // get viewport width and height
    const width = await driver.executeScript(`return window.innerWidth`) as any;
    const height = await driver.executeScript(`return window.innerHeight`) as any;

    // reopen closer the edge of the window
    await contextMenu(width - 10, 10);
    await checkWithinViewport();

    // reopen closer to the bottom of the window
    await contextMenu(10, height - 10);
    await checkWithinViewport();

    async function checkWithinViewport() {
      const rect = await driver.find('.grist-floating-menu').getRect();
      assert.isAbove(rect.x, 0);
      assert.isBelow(rect.x + rect.width, width);
      assert.isAbove(rect.y, 0);
      assert.isBelow(rect.y + rect.height, height);
    }
  });

  it('should close on click anywhere outside content', async function() {
    // open context menu
    await contextMenu(10, 10);

    // check menu is open
    assert.equal(await driver.find('.grist-floating-menu').isPresent(), true);

    // click anywhere outside
    await driver.mouseMoveBy({x: -5, y: -5});
    await driver.withActions(actions => actions.click());

    // check menu is closed
    assert.equal(await driver.find('.grist-floating-menu').isPresent(), false);
  });

  it('context click inside menu should not do unexpected behaviour', async function() {
    // open context menu
    await contextMenu(10, 10);

    // context click on top of menu
    await driver.find('.grist-floating-menu').mouseMove();
    await driver.withActions(actions => actions.contextClick());

    // check only one context menu open
    assert.equal((await driver.findAll('.grist-floating-menu')).length, 1);

    // send escape to close context menu
    await driver.sendKeys(Key.ESCAPE);

    // check no context menu
    assert.equal((await driver.findAll('.grist-floating-menu')).length, 0);
  });

});
