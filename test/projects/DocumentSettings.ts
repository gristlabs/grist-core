import { assert, driver, Key } from 'mocha-webdriver';
import { server, setupTestSuite } from './testUtils';

describe('DocumentSettings', () => {
  setupTestSuite();

  before(async function() {
    this.timeout(60000);      // Set a longer default timeout.
    await driver.get(`${server.getHost()}/DocumentSettings`);
  });

  it('should call save() with new settings when changing values', async function() {
    this.timeout(4000);

    await driver.findWait('.test-tz-autocomplete', 500).click();
    await driver.findContent('.test-acselect-dropdown li', /Europe\/Paris/).click();
    assert.equal(await driver.find('.test-result-timezone').value(), "Europe/Paris");

    await driver.findWait('.test-settings-locale-autocomplete', 500).click();
    await driver.findContent('.test-acselect-dropdown li', /Spain \(Spanish\)/).click();
    assert.equal(await driver.find('.test-result-locale').value(), "es-ES");

    await driver.findWait('.test-currency-autocomplete', 500).click();
    await driver.findContent('.test-acselect-dropdown li', /Yen/).click();
    assert.equal(await driver.find('.test-result-currency').value(), "JPY");
  });

  it('should reflect changes from server', async function() {
    // Set new value for timezone, then open the dialog.
    await driver.find('.test-result-timezone').doClear().sendKeys('America/Los_Angeles', Key.ENTER);

    // Check that timezone has the new value.
    assert.equal(await driver.find('.test-tz-autocomplete input').value(), 'America/Los_Angeles');

    // Check that locale and currency have the values from earlier.
    assert.equal(await driver.find('.test-settings-locale-autocomplete input').value(), 'Spain (Spanish)');
    assert.equal(await driver.find('.test-currency-autocomplete input').value(), 'JPY');
  });
});
