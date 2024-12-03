import {assert, driver, Key, WebElement} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';
import escapeRegExp = require('lodash/escapeRegExp');

async function setCustomDateFormat(format: string) {
  await gu.setDateFormat("Custom");
  await driver.find('[data-test-id=Widget_dateCustomFormat]').click();
  await gu.selectAll();
  await driver.sendKeys(format, Key.ENTER);
}

async function testDateFormat(initialDateStr: string, newDay: string, finalDateStr: string) {
  const cell = await gu.getCell({col: 'A', rowNum: 1});
  await cell.click();
  assert.equal(await cell.getText(), initialDateStr);

  // Open the date for editing, and check that we see it in the new format.
  await driver.sendKeys(Key.ENTER);
  await gu.checkTextEditor(new RegExp(escapeRegExp(initialDateStr)));

  // Pick a new date in the editor; check that it's shown in the new format.
  await driver.findContent('td.day', newDay).click();
  await gu.checkTextEditor(new RegExp(escapeRegExp(finalDateStr)));
  await driver.sendKeys(Key.ENTER);
  await gu.waitForServer();
  assert.equal(await gu.getCell({col: 'A', rowNum: 1}).getText(), finalDateStr);

  // Reopen the editor, check that our previously-selected date is still selected.
  await gu.getCell({col: 'A', rowNum: 1}).click();
  await driver.sendKeys(Key.ENTER);
  await gu.checkTextEditor(new RegExp(escapeRegExp(finalDateStr)));
  assert.isTrue(await driver.findContent('td.day', newDay).matches('.active'));
  await driver.sendKeys(Key.ESCAPE);
  await gu.waitAppFocus();
  await gu.undo();
}

describe('DateEditor', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();
  let session: gu.Session;

  afterEach(() => gu.checkForErrors());

  before(async function() {
    session = await gu.session().login();
    await session.tempNewDoc(cleanup, 'DateEditor');
    await gu.waitForServer();
    await driver.executeAsyncScript(async (done: () => unknown) => {
      await (window as any).loadScript('sinon.js');
      window.sinon.useFakeTimers({
        now: 1580568300000,  // Sat Feb 01 2020 14:45:00 UTC
        shouldAdvanceTime: true
      });
      done();
    });
  });

  it('should allow editing dates in standard format', async function() {
    await gu.getCell({col: 'A', rowNum: 1}).click();
    await gu.setType(/Date/);
    assert.equal(await gu.getDateFormat(), "YYYY-MM-DD");

    // Use shortcut to populate today's date, mainly to ensure that our date-mocking is working.
    await gu.getCell({col: 'A', rowNum: 1}).click();
    await gu.sendKeys(Key.chord(await gu.modKey(), ';'));
    await gu.waitForServer();
    assert.equal(await gu.getCell({col: 'A', rowNum: 1}).getText(), '2020-02-01');

    // Change the format and check that date gets updated.
    await gu.setDateFormat("MMMM Do, YYYY");
    await testDateFormat('February 1st, 2020', '18', 'February 18th, 2020');
  });

  it('should allow editing dates in rarer formats', async function() {
    await setCustomDateFormat("MMM Do, 'YY");
    await testDateFormat("Feb 1st, '20", "18", "Feb 18th, '20");

    await setCustomDateFormat("YYYY-MM-DD dd");
    await testDateFormat("2020-02-01 Sa", "18", "2020-02-18 Tu");
  });

  it('should allow editing invalid alt-text', async function() {
    let cell = await gu.getCell({col: 'A', rowNum: 2});
    await cell.click();
    await driver.sendKeys(Key.ENTER);
    await gu.waitAppFocus(false);

    // Enter an invalid date.
    await driver.sendKeys('2020-03-14pi', Key.ENTER);
    await gu.waitForServer();

    // Check that it's saved, and shows up as invalid.
    cell = await gu.getCell({col: 'A', rowNum: 2});
    assert.equal(await cell.getText(), '2020-03-14pi');
    assert.isTrue(await cell.find('.field_clip').matches('.invalid'));

    // Open for editing, and check that the invalid value is present in the editor.
    await cell.click();
    await driver.sendKeys(Key.ENTER);
    await gu.waitAppFocus(false);
    await gu.checkTextEditor(/2020-03-14pi/);

    // Edit it down to something valid, save, and check.
    await driver.sendKeys(Key.BACK_SPACE, Key.BACK_SPACE, Key.ENTER);
    await gu.waitForServer();
    cell = await gu.getCell({col: 'A', rowNum: 2});
    assert.equal(await cell.getText(), '2020-03-14 Sa');
    assert.isFalse(await cell.find('.field_clip').matches('.invalid'));
  });

  async function openCellEditor(cell: WebElement) {
    await cell.click();
    await driver.sendKeys(Key.ENTER);
    await gu.waitAppFocus(false);
  }

  it('should respect locale for datepicker', async function() {
    let cell = await gu.getCell({col: 'A', rowNum: 1});
    await cell.click();
    await gu.setDateFormat("YYYY-MM-DD");

    assert.equal(await cell.getText(), '2020-02-01');
    await openCellEditor(cell);

    // Check that the date input contains the correct date.
    assert.equal(await driver.find('.celleditor_text_editor').value(), '2020-02-01');

    // Wait for datepicker, and check that it's showing the expected (default English) locale.
    await driver.findWait('.datepicker', 200);
    assert.equal(await driver.find('.datepicker .datepicker-days .datepicker-switch').getText(), 'February 2020');
    assert.deepEqual(await driver.findAll('.datepicker .datepicker-days .dow', el => el.getText()),
      ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']);

    // Check that it works to click into it to change date.
    await driver.findContent('.datepicker .day', '19').click();
    assert.equal(await driver.find('.celleditor_text_editor').value(), '2020-02-19');
    await driver.sendKeys(Key.ENTER);
    await gu.waitForServer();
    assert.equal(await cell.getText(), '2020-02-19');
    assert.equal(await driver.find('.datepicker').isPresent(), false);

    // Change locale to something quite different.
    const api = session.createHomeApi();
    await api.updateUserLocale('fr-CA');
    cleanup.addAfterEach(() => api.updateUserLocale(null));   // Restore after this test case.
    await gu.reloadDoc();

    // Check that the datepicker now opens to show the new language.
    cell = await gu.getCell({col: 'A', rowNum: 1});
    await openCellEditor(cell);
    await driver.findWait('.datepicker', 200);
    assert.equal(await driver.find('.datepicker .datepicker-days .datepicker-switch').getText(),
      'février 2020');
    assert.deepEqual(await driver.findAll('.datepicker .datepicker-days .dow', el => el.getText()),
      ['l', 'ma', 'me', 'j', 'v', 's', 'd']);

    // Check that it can still be used to pick a new date.
    await driver.findContent('.datepicker .day', '26').click();
    assert.equal(await driver.find('.celleditor_text_editor').value(), '2020-02-26');
    await driver.sendKeys(Key.ENTER);
    await gu.waitForServer();
    assert.equal(await cell.getText(), '2020-02-26');
    assert.equal(await driver.find('.datepicker').isPresent(), false);
  });
});
