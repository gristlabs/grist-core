import {addToRepl, assert, driver} from 'mocha-webdriver';
import {FormElement, formSchema, labels, question, questionType} from 'test/nbrowser/formTools';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('FormView2', function() {
  this.timeout('4m');
  gu.bigScreen();

  const cleanup = setupTestSuite();

  addToRepl('question', question);
  addToRepl('labels', labels);
  addToRepl('questionType', questionType);

  before(async function() {
    const session = await gu.session().login();
    await session.tempNewDoc(cleanup);
  });

  gu.withClipboardTextArea();

  it('duplicates default form', async function() {
    // Create a default form for an empty table.
    await gu.addNewPage('Form', 'Table1');
    // Go to this page, to make sure we wait for it.
    await gu.openPage('New page');
    await gu.renamePage('New page', 'Original');
    const revert = await gu.begin();

    // Read the schema overall.
    const origStruct1 = await formSchema();
    // Now duplicate it.
    await gu.duplicatePage('Original', 'Cloned');
    // Check that the new page has the same form.
    await gu.openPage('Cloned');
    // Read the schema again.
    const cloned = await formSchema();
    assert.deepEqual(origStruct1, cloned);

    // Make sure that when changed the original form isn't changed.
    // Hide columns A and B
    assert.equal(cloned[2].children.length, 5);
    assert.deepEqual(cloned[2].children.filter(isField).map(label), ['A', 'B', 'C']);
    await question('A').hover();
    await question('A').remove();
    await gu.waitForServer();
    await question('B').hover();
    await question('B').remove();
    await gu.waitForServer();
    // Read the schema again.
    const clonedWithoutBC = await formSchema();
    assert.notDeepEqual(origStruct1, clonedWithoutBC);
    // Make sure we don't see those fields there.
    assert.deepEqual(clonedWithoutBC[2].children.filter(isField).map(label), ['C']);

    // Now go to the original page and make sure it still has all fields.
    await gu.openPage('Original');
    const origStruct2 = await formSchema();
    assert.deepEqual(origStruct1, origStruct2);
    // No remove column C here, to make sure duplicate is not affected.
    await question('C').hover();
    await question('C').remove();
    await gu.waitForServer();
    await gu.openPage('Cloned');

    // Check that the new page has the same form.
    const cloneAfterRemoval2 = await formSchema();
    assert.deepEqual(clonedWithoutBC, cloneAfterRemoval2);

    await revert();
  });

  it('duplicates modified form', async function() {
    const revert = await gu.begin();

    await gu.openPage('Original');
    // Hide column A
    await question('A').hover();
    await question('A').remove();
    await gu.waitForServer();
    // Read schema
    const origBC = await formSchema();
    // Sanity check.
    assert.deepEqual(origBC[2].children.filter(isField).map(label), ['B', 'C']);
    // Now duplicate it.
    await gu.duplicatePage('Original', 'Cloned');
    // Check that the new page has the same form.
    await gu.openPage('Cloned');
    // Read the schema again.
    const clonedBC = await formSchema();
    assert.deepEqual(origBC, clonedBC);
    // Sanity check.
    assert.deepEqual(clonedBC[2].children.filter(isField).map(label), ['B', 'C']);

    // Now remove column B from original, and make sure clone is not affected.
    await gu.openPage('Original');
    await question('B').hover();
    await question('B').remove();
    await gu.waitForServer();
    const origC = await formSchema();
    // Sanity check.
    assert.deepEqual(origC[2].children.filter(isField).map(label), ['C']);
    // Make sure clone is not affected.
    await gu.openPage('Cloned');
    assert.deepEqual(clonedBC, await formSchema());

    // Cloned still has B and C, remove the C to make sure original is not affected.
    await question('C').hover();
    await question('C').remove();
    await gu.waitForServer();

    // Make sure original still has C
    await gu.openPage('Original');
    assert.deepEqual(origC, await formSchema());
    await revert();

  });

  it('clones default form without publishing', async function() {
    // Original form is not yet changed.
    // Publish it.
    await publish.click();
    await confirm.click();
    await gu.waitForServer();
    await unpublish.wait();

    await gu.duplicatePage('Original', 'Cloned');
    await gu.openPage('Cloned');

    // Make sure we have publish button.
    assert.isTrue(await publish.isDisplayed());
    assert.isFalse(await unpublish.isPresent());

    // Now publish the clone also.
    await publish.click();
    await confirm.click();
    await gu.waitForServer();
    await unpublish.wait();

    // And unpublish the clone to make sure the original is still published.
    await unpublish.click();
    await confirm.click();
    await gu.waitForServer();
    await publish.wait();

    // Check original, should still be published.
    await gu.openPage('Original');
    assert.isFalse(await publish.isPresent());
    assert.isTrue(await unpublish.isDisplayed());
  });

  it('can submit a form', async function() {
    // Publish the clone and open the form.
    await gu.openPage('Cloned');
    await publish.click();
    await confirm.click();
    await gu.waitForServer();
    await unpublish.wait();

    await share.click();
    await gu.waitForServer();
    const link = await driver.findWait('.test-forms-link', 100).getAttribute('value');
    await driver.get(link);

    // Submit a record
    await driver.findWait('input[name="A"]', 100).click();
    await driver.findWait('input[name="A"]', 100).sendKeys('Hello');
    await driver.findWait('input[type="submit"]', 1000).click();
    await driver.findWait('.test-form-success-page-text', 1000);

    // Check that the record was added to the table.
    await driver.navigate().back();
    await gu.waitForDocToLoad();
    await gu.openPage('Table1');
    assert.deepEqual(await gu.getVisibleGridCellsFast('A', [1]), ['Hello']);
  });
});

function isField(e: FormElement) {
  return e.type === 'Field';
}

function label(e: FormElement) {
  return e.label;
}

function button(selector: string) {
  return {
    async click() {
      await driver.findWait(selector, 1000).click();
    },
    async wait() {
      await driver.findWait(selector, 1000);
    },
    async isDisplayed() {
      return await driver.find(selector).isDisplayed();
    },
    async isPresent() {
      return await driver.find(selector).isPresent();
    }
  };
}


const publish = button('.test-forms-publish');
const unpublish = button('.test-forms-unpublish');
const confirm = button('.test-modal-confirm');
const share = button('.test-forms-share');
