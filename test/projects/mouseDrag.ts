import {assert, driver} from 'mocha-webdriver';
import {server, setupTestSuite} from './testUtils';

describe('mouseDrag', () => {
  setupTestSuite();

  before(async function() {
    this.timeout(60000);      // Set a longer default timeout.
    await driver.get(`${server.getHost()}/mouseDrag`);
  });

  it('should trigger callbacks on mouse events', async function() {
    // We run through some motions several times to ensure that we are not getting extraneous
    // events, e.g. if we were not properly removing listeners. Events are logged by single
    // characters into the "events" property recorded into .test-results).
    for (let i = 0; i < 3; i++) {
      await driver.find('.test-box').mouseMove();
      await driver.mouseDown();
      await driver.sleep(10);
      assert.deepEqual(JSON.parse(await driver.find('.test-result').getText()), {
        status: "started",
        events: 's',
        start: { pageX: 175, pageY: 150 },
      });

      await driver.mouseMoveBy({x: 100, y: 20});
      assert.deepEqual(JSON.parse(await driver.find('.test-result').getText()), {
        status: "moved",
        events: 'sm',
        start: { pageX: 175, pageY: 150 },
        move: { pageX: 275, pageY: 170 },
      });

      // Test that the mouse can move over a different element, and be released there.
      await driver.find('.test-result').mouseMove();
      assert.deepEqual(JSON.parse(await driver.find('.test-result').getText()), {
        status: "moved",
        events: 'smm',
        start: { pageX: 175, pageY: 150 },
        move: { pageX: 550, pageY: 150 },
      });

      await driver.mouseUp();
      assert.deepEqual(JSON.parse(await driver.find('.test-result').getText()), {
        status: "stopped",
        events: 'smmS',
        start: { pageX: 175, pageY: 150 },
        stop: { pageX: 550, pageY: 150 },
      });
    }
  });
});
