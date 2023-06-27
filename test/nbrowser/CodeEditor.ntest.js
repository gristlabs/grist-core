/* global window */

import { assert, driver } from 'mocha-webdriver';
import { $, gu, test } from 'test/nbrowser/gristUtil-nbrowser';

describe('CodeEditor.ntest', function() {
  const cleanup = test.setupTestSuite(this);

  before(async function() {
    await gu.supportOldTimeyTestCode();
    await gu.useFixtureDoc(cleanup, '../uploads/CodeEditor.test.csv', true);
  });

  afterEach(function() {
    return gu.checkForErrors();
  });

  it('Should activate on click of `Code View` button', async function() {
    await gu.openSidePane('code');
    assert.match(await $('.g-code-viewer').wait().getText(),
      /class CodeEditor_test:[^]*A = grist.Text\(\)[^]*B = grist.Numeric\(\)/);
  });

  it('Should update to reflect changes in schema', async function() {
    await gu.actions.selectTabView('CodeEditor.test');
    // open the side menu
    await gu.openSidePane('field');

    await gu.getCellRC(0, 0).click();
    await $(".test-field-label").wait(assert.isDisplayed);
    await $(".test-field-label").sendNewText('foo');
    await gu.waitForServer();

    await gu.getCellRC(0, 1).click();
    await $(".test-field-label").sendNewText('bar');
    await gu.waitForServer(); // Must wait for colId change to finish

    await gu.setType('Reference');
    await gu.applyTypeConversion();
    await gu.setVisibleCol('foo');
    await gu.waitForServer();

    // Check that type conversion worked correctly.
    assert.equal(await gu.getCellRC(1, 1).text(), 'Bob');

    await gu.openSidePane('code');
    assert.match(await $('.g-code-viewer').wait().getText(),
      /foo = grist.Text\(\)[^]*bar = grist.Reference\('CodeEditor_test'\)/);
  });

  it('should filter out helper columns', async function() {
    assert.notInclude(await $('.g-code-viewer').wait().getText(), 'gristHelper');
  });

  it('should allow text selection', async function() {
    const textElem = $('.hljs-title:contains(CodeEditor)');
    await textElem.click();
    await driver.withActions(a => a.doubleClick(textElem.elem()));
    assert.equal(await driver.executeScript(() => window.getSelection().toString()), 'CodeEditor_test');
  });
});
