import {assert, driver, Key} from 'mocha-webdriver';
import {server, setupTestSuite} from './testUtils';

describe('sessionObs', function() {
  setupTestSuite();
  this.timeout(10000);      // Set a longer default timeout.

  before(async function() {
    this.timeout(60000);      // Set a longer default timeout.
    await driver.get(`${server.getHost()}/sessionObs`);
  });

  it('should initially show default values', async function() {
    assert.equal(await driver.find('.test-plain-obs').value(), 'Hello');
    assert.equal(await driver.find('.test-bool-obs').value(), 'true');
    assert.equal(await driver.find('.test-num-obs').value(), '100');
    assert.equal(await driver.find('.test-fruit-obs').value(), 'apples');
  });

  it('should keep values across reload', async function() {
    await driver.find('.test-plain-obs').doClear().sendKeys('World', Key.ENTER);
    await driver.find('.test-bool-obs').doClear().sendKeys('false', Key.ENTER);
    await driver.find('.test-num-obs').doClear().sendKeys('451', Key.ENTER);
    await driver.find('.test-fruit-obs').doClear().sendKeys('melons', Key.ENTER);
    await driver.find('.test-save').click();

    await driver.navigate().refresh();

    // The first (plain) value reverts to default; the rest keep their new values.
    assert.equal(await driver.findWait('.test-plain-obs', 1000).value(), 'Hello');
    assert.equal(await driver.find('.test-bool-obs').value(), 'false');
    assert.equal(await driver.find('.test-num-obs').value(), '451');
    assert.equal(await driver.find('.test-fruit-obs').value(), 'melons');
  });

  it('should treat invalid values as defaults', async function() {
    await driver.find('.test-plain-obs').doClear().sendKeys('foo', Key.ENTER);
    await driver.find('.test-bool-obs').doClear().sendKeys('foo', Key.ENTER);
    await driver.find('.test-num-obs').doClear().sendKeys('foo', Key.ENTER);
    await driver.find('.test-fruit-obs').doClear().sendKeys('foo', Key.ENTER);
    await driver.find('.test-save').click();

    // Check current values. Some are transformed to "invalid" by the fixture..
    assert.equal(await driver.find('.test-plain-obs').value(), 'foo');
    assert.equal(await driver.find('.test-bool-obs').value(), 'foo');
    assert.equal(await driver.find('.test-num-obs').value(), 'foo');
    assert.equal(await driver.find('.test-fruit-obs').value(), 'foo');

    await driver.navigate().refresh();

    // The first (plain) value reverts to default because not saved;
    // the rest revert to default because invalid.
    assert.equal(await driver.findWait('.test-plain-obs', 1000).value(), 'Hello');
    assert.equal(await driver.find('.test-bool-obs').value(), 'true');
    assert.equal(await driver.find('.test-num-obs').value(), '100');
    assert.equal(await driver.find('.test-fruit-obs').value(), 'apples');
  });
});
