import {assert, driver, Key,  useServer} from 'mocha-webdriver';
import {server} from 'test/fixtures/projects/webpack-test-server';

describe('simpleList', function() {
  useServer(server);

  beforeEach(async function() {
    await driver.get(`${server.getHost()}/simpleList`);
  });

  function getLogs() {
    return driver.findAll('.test-logs div', e => e.getText());
  }

  function toggle() {
    return driver.find('input').click();
  }

  function getSelected() {
    return driver.findAll('.grist-floating-menu [class*=-sel]', e => e.getText());
  }

  it('should support keyboard navigation without stealing focus', async function() {
    await toggle();
    await driver.sendKeys(Key.ARROW_DOWN);
    assert.deepEqual(await getSelected(), ['foo']);
    await driver.sendKeys(Key.ENTER);
    assert.deepEqual(await getLogs(), ['foo']);
  });

  it('should trigger action on click', async function() {
    await toggle();
    await driver.findContent('.grist-floating-menu li', 'bar').click();
    assert.deepEqual(await getLogs(), ['bar']);
  });

  it('should update selected on mouse hover', async function() {
    await toggle();
    await driver.findContent('.grist-floating-menu li', 'bar').mouseMove();
    assert.deepEqual(await getSelected(), ['bar']);
  });

});
