import {assert, driver, Key, stackWrapFunc, WebElement} from 'mocha-webdriver';
import {server, setupTestSuite} from './testUtils';

describe('transitions', function() {
  setupTestSuite();
  this.timeout(60000);      // Set a longer default timeout.

  // This is a constant for interval between operations, giving enough time for a few asserts to
  // fit safely inside it.
  const kDelayMs = 250;

  let leftDiv: WebElement;
  let countFinishedDiv: WebElement;

  // Helper to check the state of the transitioning leftDiv and count of finished transitions.
  // When a pair of numbers is given, it's the expected range (a closed interval).
  const assertState = stackWrapFunc(async function(
    expected: {width: number|[number, number], opacity: number|[number, number], finished: number}
  ) {
    const [widthStr, opacityStr, countStr] = await Promise.all([
      leftDiv.getCssValue('width'),
      leftDiv.getCssValue('opacity'),
      countFinishedDiv.getText(),
    ]);
    if (Array.isArray(expected.width)) {
      assert.isAbove(parseFloat(widthStr), expected.width[0]);
      assert.isBelow(parseFloat(widthStr), expected.width[1]);
    } else {
      assert.equal(parseFloat(widthStr), expected.width);
    }
    if (Array.isArray(expected.opacity)) {
      assert.isAbove(parseFloat(opacityStr), expected.opacity[0]);
      assert.isBelow(parseFloat(opacityStr), expected.opacity[1]);
    } else {
      assert.equal(parseFloat(opacityStr), expected.opacity);
    }
    assert.equal(parseFloat(countStr), expected.finished);
  });

  it('should run callbacks and transition properties', async function() {
    await driver.get(`${server.getHost()}/transitions`);
    await driver.find('.test-duration').doClear().doSendKeys(`${kDelayMs * 2}ms`, Key.ENTER);
    leftDiv = driver.find('.test-left');
    countFinishedDiv = driver.find('.test-finished');
    await assertState({width: 30, opacity: 1, finished: 0});

    // Start the transition and wait for its middle. Note that on click, width increases 30px to
    // 470px, while opacity goes from 0 to 1.
    await driver.find('.test-toggle').doClick();
    await driver.sleep(kDelayMs);

    // Assert that the transitioning properties are above the min and below the max
    await assertState({width: [35, 465], opacity: [0.05, 0.95], finished: 0});

    // Wait for it to end.
    await driver.sleep(kDelayMs * 1.5);
    await assertState({width: 470, opacity: 1, finished: 1});

    // Toggle again, and watch the reverse transition.
    await driver.find('.test-toggle').doClick();
    await driver.sleep(kDelayMs);
    await assertState({width: [35, 465], opacity: [0.05, 1.95], finished: 1});
    await driver.sleep(kDelayMs * 1.5);
    await assertState({width: 30, opacity: 1, finished: 2});
  });

  it('should handle interrupted transitions well', async function() {
    // Load the page fresh (for new counts) and give more time for this transition.
    await driver.get(`${server.getHost()}/transitions`);
    await driver.find('.test-duration').doClear().doSendKeys(`${kDelayMs * 4}ms`, Key.ENTER);

    leftDiv = driver.find('.test-left');
    countFinishedDiv = driver.find('.test-finished');
    await assertState({width: 30, opacity: 1, finished: 0});

    // What the test does is this.
    // Initial
    //        [|- - - - - - - - ]
    // Full transition takes 4X time.
    // Toggle and wait 3X time, get to here:
    //        [ - - - - - -|- - ]
    // Toggle again and wait 2X time:
    //        [ - -|- - - - - - ]
    // Toggle again and wait 3X+ time:
    //        [ - - - - - - - -|]

    // Start the transition (takes 4X time); at 3X time check, and toggle again to reverse it.
    await driver.find('.test-toggle').doClick();
    await driver.sleep(kDelayMs * 3);

    // Check that the styles are transitioning but the transition hasn't ended.
    await assertState({width: [35, 465], opacity: [0.05, 1.95], finished: 0});
    await driver.find('.test-toggle').doClick();

    // After 2X time more, check here that the transition still hasn't ended, despite duration of
    // 4X and 5X time has now passed. Opacity value should have finished transitioning though.
    await driver.sleep(kDelayMs * 2);
    await assertState({width: [35, 465], opacity: 1, finished: 0});

    // Toggle again, and wait 3X+ time more to finish the transition.
    await driver.find('.test-toggle').doClick();
    await driver.sleep(kDelayMs * 3.5);

    // Assert that all properties transitioned and the count has updated.
    await assertState({width: 470, opacity: 1, finished: 1});
  });
});
