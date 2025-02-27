import {assert, driver, Origin} from 'mocha-webdriver';
import {server, setupTestSuite} from './testUtils';

describe('resizeHandle', function() {
  setupTestSuite();
  this.timeout(10000);      // Set a longer default timeout.

  before(async function() {
    this.timeout(60000);      // Set a longer default timeout.
    await driver.get(`${server.getHost()}/resizeHandle`);
  });

  function dragByX(x: number) {
    return driver.withActions((a) => a.press().move({x, origin: Origin.POINTER}).release());
  }
  function reset() {
    return driver.find('.test-reset').click();
  }

  it('should be possible to grab on either side of edge', async function() {
    // Make sure we can grab a bit to the right and to the left of the expected position.
    await driver.find('.test-left').mouseMove({x: 75});   // right edge
    await dragByX(-1);
    assert.deepEqual(await driver.find('.test-left').getText(), `width 149`);
    await reset();

    await driver.find('.test-left').mouseMove({x: 77});   // 2px right of right edge
    await dragByX(5);
    assert.deepEqual(await driver.find('.test-left').getText(), `width 155`);
    await reset();

    await driver.find('.test-left').mouseMove({x: 73});   // 2px left of right edge
    await dragByX(-10);
    assert.deepEqual(await driver.find('.test-left').getText(), `width 140`);
    await reset();

    // Same for the right side.
    await driver.find('.test-right').mouseMove({x: -75});   // left edge
    await dragByX(-2);
    assert.deepEqual(await driver.find('.test-right').getText(), `width 152`);
    await reset();

    await driver.find('.test-right').mouseMove({x: -77});   // 2px left of left edge
    await dragByX(10);
    assert.deepEqual(await driver.find('.test-right').getText(), `width 140`);
    await reset();

    await driver.find('.test-right').mouseMove({x: -73});   // 2px right of left edge
    await dragByX(-25);
    assert.deepEqual(await driver.find('.test-right').getText(), `width 175`);
    await reset();
  });

  it('should resize and respect limits', async function() {
    // Left panel, limited to (50, 275) range
    await driver.find('.test-left').mouseMove({x: 75});
    await dragByX(-120);
    assert.deepEqual(await driver.find('.test-left').getText(), `width 50`);
    await reset();

    await driver.find('.test-left').mouseMove({x: 75});
    await dragByX(120);
    assert.deepEqual(await driver.find('.test-left').getText(), `width 270`);
    await dragByX(10);
    assert.deepEqual(await driver.find('.test-left').getText(), `width 275`);
    await reset();

    // Right panel, limited to (50, 275) range
    await driver.find('.test-right').mouseMove({x: -75});
    await dragByX(120);
    assert.deepEqual(await driver.find('.test-right').getText(), `width 50`);
    await reset();

    await driver.find('.test-right').mouseMove({x: -75});
    await dragByX(-120);
    assert.deepEqual(await driver.find('.test-right').getText(), `width 270`);
    await dragByX(-10);
    assert.deepEqual(await driver.find('.test-right').getText(), `width 275`);
    await reset();
  });
});
