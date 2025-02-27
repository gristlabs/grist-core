import { assert, driver, Key, Origin } from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import { server, setupTestSuite } from './testUtils';

function waitEqual(func: () => Promise<boolean>, expected: boolean, waitMs: number) {
  return gu.waitToPass(async () => assert.equal(await func(), expected), waitMs);
}

function waitDeepEqual(func: () => Promise<string[]>, expected: string[], waitMs: number) {
  return gu.waitToPass(async () => assert.deepEqual(await func(), expected), waitMs);
}

describe('tooltips', function() {
  setupTestSuite();
  this.timeout(20000);      // Set a longer default timeout.

  before(async function() {
    await driver.get(`${server.getHost()}/tooltips`);
  });

  it('should select text from the tooltip', async function() {
    await driver.find(".test-visible .test-prefix-info-tooltip").click();
    await driver.find(".test-tooltip-origin").mouseMove();
    await driver.withActions((actions) => {
      // Move way beyond the tooltip.
      actions.press().move({origin: Origin.POINTER, x: 200, y: 50}).release();
    });
    assert.equal(
      await driver.executeScript(`return window.getSelection().toString()`),
      `Multi line text\nAnd a \nhttps://link.to/page.html?with=filter in it`
    );
    // It hides itself after ~2 seconds.
    await waitEqual(() => driver.find('.test-tooltip').isPresent(), false, 3000);
  });

  it('should open on hover, close on mouseout', async function() {
    await driver.find('.test-plain').mouseMove();
    await waitEqual(() => driver.find('.test-tooltip').isDisplayed(), true, 500);
    assert.equal(await driver.find('.test-tooltip').getText(), 'Tooltip1');
    await driver.mouseMoveBy({x: 200});
    await waitEqual(() => driver.find('.test-tooltip').isPresent(), false, 1000);

    // If we move into the tooltip, it shouldn't close.
    await driver.find('.test-plain').mouseMove();
    await waitEqual(() => driver.find('.test-tooltip').isDisplayed(), true, 500);
    await driver.find('.test-tooltip').mouseMove();
    await driver.sleep(600);
    assert.equal(await driver.find('.test-tooltip').isDisplayed(), true);
    await driver.mouseMoveBy({x: 200});
    await waitEqual(() => driver.find('.test-tooltip').isPresent(), false, 1000);
  });

  it('should open immediately on click if requested', async function() {
    await driver.find('.test-fancy').click();
    await waitEqual(() => driver.find('.test-tooltip').isDisplayed(), true, 500);
    assert.equal(await driver.find('.test-tooltip').getText(), 'Tooltip2');
    // This tooltip should auto-expire after 1s without moving mouse away.
    await waitEqual(() => driver.find('.test-tooltip').isPresent(), false, 1500);
  });

  it('should close immediately on click if requested', async function() {
    await driver.find('.test-close-on-click').mouseMove();
    await waitEqual(() => driver.find('.test-tooltip').isDisplayed(), true, 500);
    await driver.find('.test-close-on-click').click();
    assert.equal(await driver.find('.test-tooltip').isPresent(), false);
  });

  it('should allow a button that closes it', async function() {
    await driver.find('.test-closable').mouseMove();
    await waitEqual(() => driver.find('.test-tooltip').isDisplayed(), true, 500);
    assert.equal(await driver.find('.test-tooltip').getText(), 'Tooltip3');
    await driver.find('.test-tooltip-close').click();
    assert.equal(await driver.find('.test-tooltip').isPresent(), false);

    // It should continue working normally afterwards.
    await driver.find('.test-closable').mouseMove();
    await waitEqual(() => driver.find('.test-tooltip').isDisplayed(), true, 500);
    assert.equal(await driver.find('.test-tooltip').getText(), 'Tooltip3');
    await driver.mouseMoveBy({x: 200});
    await waitEqual(() => driver.find('.test-tooltip').isPresent(), false, 1000);
  });

  it('should close when trigger is disposed', async function() {
    await driver.find('.test-dispose').mouseMove();
    await waitDeepEqual(() => driver.findAll('.test-tooltip', (e) => e.getText()), ['Tooltip6'], 550);

    // should close after trigger get removed
    await driver.findContent('.test-dispose button', /Hide/).click();
    await waitEqual(() => driver.find('.test-tooltip').isPresent(), false, 500);

    // unhide trigger
    await driver.findContent('label', /Show trigger/).find('[type=checkbox]').click();
  });

  it('should close when trigger is disposed before the tooltip shows up', async function() {
    // hide trigger but before showing the tooltip this time
    await driver.find('.test-dispose').mouseMove();
    assert.deepEqual(await driver.findAll('.test-tooltip', (e) => e.getText()), []);
    await driver.findContent('.test-dispose button', /Hide/).click();

    // wait passed the openDelay (500ms) and check the tooltip did not showup
    await driver.sleep(550);
    await waitEqual(() => driver.find('.test-tooltip').isPresent(), false, 500);

    // unhide trigger
    await driver.findContent('label', /Show trigger/).find('[type=checkbox]').click();
  });

  it('should not show simultaneously several tooltips with same key', async function() {
    await driver.find('.test-with-key').mouseMove();
    await waitDeepEqual(() => driver.findAll('.test-tooltip', (e) => e.getText()), ['Tooltip4'], 500);

    // move to a tooltip with the same key, and check that it's immediately replaced.
    await driver.find('.test-with-same-key').mouseMove();
    assert.deepEqual(await driver.findAll('.test-tooltip', (e) => e.getText()), ['Tooltip5']);

    // check that the new tooltip still gets closed on mouseout.
    await driver.find('.test-none').mouseMove();
    await waitDeepEqual(() => driver.findAll('.test-tooltip', (e) => e.getText()), [], 500);

    // let's do it again with returning back to the first trigger (this used to catch a triggy bug)
    await driver.find('.test-with-key').mouseMove();
    await waitDeepEqual(() => driver.findAll('.test-tooltip', (e) => e.getText()), ['Tooltip4'], 500);
    await driver.find('.test-with-same-key').mouseMove();
    assert.deepEqual(await driver.findAll('.test-tooltip', (e) => e.getText()), ['Tooltip5']);
    await driver.find('.test-with-key').mouseMove();
    assert.deepEqual(await driver.findAll('.test-tooltip', (e) => e.getText()), ['Tooltip4']);
    await driver.find('.test-none').mouseMove();
    await waitDeepEqual(() => driver.findAll('.test-tooltip', (e) => e.getText()), [], 500);
  });

  it('should allow attaching info tooltips to elements', async function() {
    async function assertPopupOpensAndCloses(close: () => Promise<void>) {
      await tooltipIcon.click();
      await waitDeepEqual(() => driver.findAll('.test-info-tooltip-popup', (e) => e.getText()),
        ['Link your new widget to an existing widget on this page.\nLearn more.'], 500);
      await close();
      await waitDeepEqual(() => driver.findAll('.test-info-tooltip-popup', (e) => e.getText()),
        [], 500);
    }

    const element = await driver.find('.test-info-click');
    const tooltipIcon = await element.find('.test-info-tooltip');

    // Check that clicking the info icon button toggles the tooltip.
    await assertPopupOpensAndCloses(async () => {
      await tooltipIcon.click();
    });

    // Check that the tooltip can also be closed via the close button.
    await assertPopupOpensAndCloses(async () => {
      await driver.find('.test-info-tooltip-close').click();
    });

    // Check that pressing Enter or Escape also closed the tooltip.
    await assertPopupOpensAndCloses(async () => {
      await gu.sendKeys(Key.ENTER);
    });
    await assertPopupOpensAndCloses(async () => {
      await gu.sendKeys(Key.ESCAPE);
    });

    // Check that clicking outside the tooltip also closed it.
    await assertPopupOpensAndCloses(async () => {
      await driver.find('body').click();
    });
  });

  it('should support a hover variant of info tooltips', async function() {
    const element = await driver.find('.test-info-hover');
    const tooltipIcon = await element.find('.test-info-tooltip');

    await tooltipIcon.mouseMove();
    await waitDeepEqual(
      () => driver.findAll('.test-info-tooltip-popup', (e) => e.getText()),
      [
        'A UUID is a randomly-generated string that is useful for unique identifiers and link keys.\nLearn more.'
      ],
      500
    );
    await driver.find('.test-none').mouseMove();
    await waitDeepEqual(() => driver.findAll('.test-info-tooltip-popup', (e) => e.getText()),
      [], 500);
  });
});
