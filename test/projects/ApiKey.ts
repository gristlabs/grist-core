import * as bluebird from 'bluebird';
import {assert, driver} from 'mocha-webdriver';
import {server, setupTestSuite} from './testUtils';

const delay = () => bluebird.delay(350);

describe('ApiKeyWidget', function() {
  setupTestSuite();

  before(async function() {
    this.timeout(60000);      // Set a longer default timeout.
    await driver.get(`${server.getHost()}/ApiKey`);
  });

  it('should show only the create button when the api key has not been created', async function() {
    assert.deepEqual(await driver.findAll('.test-apikey-key', (e) => e.getText()), []);
    assert.deepEqual(await driver.findAll('.test-apikey-container button', (e) => e.getText()), ['Create']);
    assert.deepEqual(await driver.findAll('.test-apikey-description', (e) => e.getText()), [
      'By generating an API key, you will be able to make API calls for your own account.']);
  });

  it('click `create` button should call onCreate()', async function() {
    await driver.find('.test-apikey-create').click();
    // button should be disabled
    assert.deepEqual(await driver.findAll('.test-apikey-container button',
      (e) => e.getAttribute('disabled')), ['true']);
    await delay();
    const apiKey = await driver.find('.test-apikey-key');
    // should show Delete button the new api key
    assert.equal(await apiKey.value(), 'e03ab513535137a7ec60978b40c9a896db6d8706');
    // should have type 'password' by default, causing the key to be hidden
    assert.equal(await apiKey.getAttribute('type'), 'password');
    assert.deepEqual(await driver.findAll('.test-apikey-container button',
      (e) => e.getText()), ['Remove']);
    assert.deepEqual(await driver.findAll('.test-apikey-container button',
      (e) => e.getAttribute('disabled')), [null as any]);
    assert.deepEqual(await driver.findAll('.test-apikey-description', (e) => e.getText()), [
`This API key can be used to access your account via the API. Don’t share your API key with anyone.`
]);
  });

  it('should show key when selected and hide when unselected', async function() {
    // Click the key, and check that the type is now 'text', causing it to be shown.
    const apiKey = await driver.find('.test-apikey-key');
    await apiKey.click();
    assert.equal(await apiKey.getAttribute('type'), 'text');

    // Click it again, just to make sure it's still shown on repeated clicks.
    await apiKey.click();
    assert.equal(await apiKey.getAttribute('type'), 'text');

    // Cause the selection to be lost by clicking the description.
    await driver.find('.test-apikey-description').click();

    // Check that the key now has type 'password', and is hidden again.
    assert.equal(await apiKey.getAttribute('type'), 'password');
  });

  it('click `delete` button should call onDelete()', async function() {
    await driver.find('.test-apikey-delete').click();

    // should show confirmation message
    assert.isTrue(await driver.find('.test-modal-dialog').isPresent());
    assert.match(await driver.find('.test-modal-dialog').getText(), /Do you still want to delete?/);

    // cancel should removes warning
    await driver.find('.test-modal-cancel').click();
    assert.deepEqual(await driver.findAll('.test-apikey-warning', (e) => e.getText()), []);

    // let's Delete for good
    await driver.find('.test-apikey-delete').click();
    await driver.find('.test-modal-confirm').click();

    // buttons should be disabled
    assert.deepEqual(await driver.findAll('.test-apikey-container button',
      (e) => e.getAttribute('disabled')), ['true']);
    await delay();
    // should show Create button and no api key
    assert.deepEqual(await driver.findAll('.test-apikey-key', (e) => e.getText()), []);
    assert.deepEqual(await driver.findAll('.test-apikey-container button', (e) => e.getText()), ['Create']);
    assert.deepEqual(await driver.findAll('.test-apikey-container button',
      (e) => e.getAttribute('disabled')), [null as any]);
    assert.deepEqual(await driver.findAll('.test-apikey-description', (e) => e.getText()), [
      'By generating an API key, you will be able to make API calls for your own account.']);
  });

});
