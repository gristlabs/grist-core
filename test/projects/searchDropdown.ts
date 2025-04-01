import { assert, driver, Key, useServer } from 'mocha-webdriver';
import { server } from 'test/fixtures/projects/webpack-test-server';

describe('searchDropdown', function() {
  useServer(server);

  beforeEach(async function() {
    await driver.find('.test-reset').click();
  });

  before(async function() {
    await driver.get(`${server.getHost()}/searchDropdown`);
  });

  function open() {
    return driver.findContent('button', 'Add column').click();
  }

  function isOpened() {
    return driver.find('.grist-floating-menu').isPresent();
  }

  function findItem(name: string) {
    return driver.findContent('li', name);
  }

  function getLogs() {
    return driver.findAll('.test-logs', e => e.getText());
  }

  async function getOptions(count?: number) {
    const opts = await  driver.findAll('.test-sd-searchable-list-item', e => e.getText());
    return opts.slice(0, count);
  }

  async function getSelected() {
    const sel = driver.find('.test-sd-searchable-list-item[class*=-sel]');
    return (await sel.isPresent()) ? sel.getText() : '';
  }

  it('click should log item', async function() {
    await open();
    await findItem('Santa').click();
    assert.deepEqual(await getLogs(), ['click: Santa']);
  });

  it('typing should select first match', async function() {
    await open();
    assert.equal(await driver.find('.test-sd-searchable-list-item').getText(), 'Foo');
    await driver.sendKeys('Rome');
    assert.equal(await driver.find('.test-sd-searchable-list-item').getText(), 'Romeo');
    assert.equal(await getSelected(), 'Romeo');
  });

  it('enter should log selected', async function() {
    await open();
    await driver.sendKeys('Rome', Key.ENTER);
    assert.deepEqual(await getLogs(), ['click: Romeo']);
  });

  it('Escape should close', async function() {
    await open();
    await driver.sendKeys(Key.ESCAPE);
    assert.equal(await isOpened(), false);
  });

  it('Should support arrow navigation', async function() {
    await open();
    assert.deepEqual(await getOptions(5), ['Foo', 'Bar', 'Fusion', 'Maya', 'Santa']);
    assert.equal(await getSelected(), '');
    await driver.sendKeys(Key.ARROW_DOWN);
    assert.equal(await getSelected(), 'Foo');
    await driver.sendKeys(Key.ARROW_DOWN);
    assert.equal(await getSelected(), 'Bar');
    await driver.sendKeys(Key.ARROW_UP);
    assert.equal(await getSelected(), 'Foo');
    await driver.sendKeys(Key.ARROW_UP);
    assert.equal(await getSelected(), '');
  });

  it('Typing should always update search string', async function() {
    await open();
    await driver.sendKeys('Rome');
    assert.equal(await driver.find('.grist-floating-menu input').value(), 'Rome');
    await driver.sendKeys(Key.ARROW_DOWN, 'ZZ');
    assert.equal(await driver.find('.grist-floating-menu input').value(), 'RomeZZ');
  });

  it('Should support mouse selection', async function() {
    await open();
    assert.equal(await getSelected(), '');
    await findItem('Clara').mouseMove();
    assert.equal(await getSelected(), 'Clara');

    // should unselect on mouse leave
    await driver.find('.test-reset').mouseMove();
    assert.equal(await getSelected(), '');
  });

  it('Should trigger action on click', async function() {
    await open();
    await findItem('Romeo').doClick();
    assert.deepEqual(await getLogs(), ['click: Romeo']);
  });

  it('click on header shouldn\'t close popup', async function() {
    await open();
    await driver.sendKeys('Rome');
    await driver.find('div[style*=icon-Search]').click();
    assert.equal(await isOpened(), true);
    await driver.sendKeys(Key.ESCAPE);
    assert.equal(await isOpened(), false);
  });

});
