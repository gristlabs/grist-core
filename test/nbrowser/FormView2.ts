import {UserAPI} from 'app/common/UserAPI';
import {addToRepl, assert, driver, Key} from 'mocha-webdriver';
import {element, FormElement, formSchema, labels, question, questionType} from 'test/nbrowser/formTools';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';
import {EnvironmentSnapshot} from 'test/server/testUtils';

describe('FormView2', function() {
  this.timeout('4m');
  gu.bigScreen();

  const cleanup = setupTestSuite();
  let session: gu.Session;

  let api: UserAPI;

  addToRepl('question', question);
  addToRepl('labels', labels);
  addToRepl('questionType', questionType);

  before(async function() {
    session = await gu.session().login();
    api = session.createHomeApi();
  });

  gu.withClipboardTextArea();


  it("should not allow html to escape the border", async function() {
    // Add simple HTML to paragraph with fixed layout that should cover the whole screen.
    await session.tempNewDoc(cleanup);
    await gu.addNewPage('Form', 'Table1');

    // Publish it.
    await publish.wait();
    await publish.click();
    if (await confirm.isPresent()) {
      await confirm.click();
    }
    await gu.waitForServer();

    // Get the link to the form.
    await share.click();
    await gu.waitForServer();
    const link = await driver.findWait('.test-forms-link', 100).getAttribute('value');

    await gu.dbClick(await element('Paragraph', 1));
    // Wait for the text area to appear.
    const textArea = await element('Paragraph', 1).findWait('textarea', 1000);
    await textArea.click();
    // Add some HTML that should not escape the border.
    await gu.sendKeys(
      '<div style="width: 100vw; height: 100vh; background-color: red; inset: 0; position: fixed;" />'
    );
    await gu.sendKeys(Key.ENTER);
    await gu.waitForServer();

    // Open the form.
    await driver.get(link);
    await form.wait();

    // Make sure we can click the reset button.
    await driver.find('.test-form-reset').click();
  });

  it('shows a border around a rendered form', async function() {
    await session.tempNewDoc(cleanup);
    await gu.addNewPage('Form', 'Table1');
    // Publish it.
    await publish.click();
    if (await confirm.isPresent()) {
      await confirm.click();
    }
    await gu.waitForServer();
    await unpublish.wait();

    // Open the form.
    await share.click();
    await gu.waitForServer();
    const link = await driver.findWait('.test-forms-link', 100).getAttribute('value');
    await driver.get(link);

    // By default, the form framing should be set to 'border'.
    await form.wait();
    assert.equal(await framing(), 'border', 'Form framing should be set to border');

    // Update the environment variable to turn off the border restriction.
    const snap = new EnvironmentSnapshot();
    process.env.GRIST_FEATURE_FORM_FRAMING = 'minimal';
    try {
      await session.loadDocMenu('/');
      await server.restart();
      await driver.get(link);
      await form.wait();

      // Verify that the form framing is now set to 'minimal'.
      assert.equal(await framing(), 'minimal', 'Form framing should be set to minimal');
    } finally {
      // Restore the environment variable to its original state.
      snap.restore();
      await server.restart();
    }
    await driver.get(link);
    await form.wait();

    // Verify that the form framing is back to 'border'.
    assert.equal(await framing(), 'border', 'Form framing should be set to border');
  });

  it('duplicates default form', async function() {
    session = await gu.session().teamSite.login();
    await session.tempNewDoc(cleanup);
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
    await publishForm();

    await gu.duplicatePage('Original', 'Cloned');
    await gu.openPage('Cloned');

    // Make sure we have publish button.
    assert.isTrue(await publish.isDisplayed());
    assert.isFalse(await unpublish.isPresent());

    // Now publish the clone also.
    await publishForm();

    // And unpublish the clone to make sure the original is still published.
    await unpublishForm();

    // Check original, should still be published.
    await gu.openPage('Original');
    assert.isFalse(await publish.isPresent());
    assert.isTrue(await unpublish.isDisplayed());
  });

  it('can submit a form', async function() {
    // Publish the clone and open the form.
    await gu.openPage('Cloned');
    await publishForm();

    await share.click();
    await gu.waitForServer();
    const link = await driver.findWait('.test-forms-link', 100).getAttribute('value');
    await driver.get(link);

    // Submit a record
    await driver.findWait('input[name="A"]', 2000).click();
    await driver.findWait('input[name="A"]', 100).sendKeys('Hello');
    await driver.findWait('input[type="submit"]', 1000).click();
    await driver.findWait('.test-form-success-page-text', 1000);

    // Check that the record was added to the table.
    await driver.navigate().back();
    await gu.waitForDocToLoad();
    await gu.openPage('Table1');
    assert.deepEqual(await gu.getVisibleGridCellsFast('A', [1]), ['Hello']);
  });

  it('does not load preview if doc is soft-deleted', async function() {
    const docId = await session.tempNewDoc(cleanup);
    await gu.addNewPage('Form', 'Table1');
    const formUrl = await driver.find('.test-forms-preview').getAttribute('href');
    await session.loadDocMenu('/');
    await api.softDeleteDoc(docId);
    await gu.onNewTab(async () => {
      await driver.get(formUrl);
      assert.isTrue(await driver.findWait('.test-form-error-page', 2000).isDisplayed());
      assert.equal(
        await driver.find('.test-form-error-page-text').getText(),
        "Oops! The form you're looking for doesn't exist."
      );
    });
    await api.undeleteDoc(docId);
  });

  it('does not load published form if doc is soft-deleted', async function() {
    const docId = await session.tempNewDoc(cleanup);
    await session.loadDoc(`/doc/${docId}`);
    await gu.addNewPage('Form', 'Table1');
    await publishForm();
    await share.click();
    await gu.waitForServer();
    const formUrl = await driver.findWait('.test-forms-link', 100).getAttribute('value');
    await session.loadDocMenu('/');
    await api.softDeleteDoc(docId);
    await gu.onNewTab(async () => {
      await driver.get(formUrl);
      assert.isTrue(await driver.findWait('.test-form-error-page', 2000).isDisplayed());
      assert.equal(
        await driver.find('.test-form-error-page-text').getText(),
        "Oops! The form you're looking for doesn't exist."
      );
    });
    await api.undeleteDoc(docId);
  });
});

function isField(e: FormElement) {
  return e.type === 'Field';
}

function label(e: FormElement) {
  return e.label;
}

function widget(selector: string) {
  return {
    async click() {
      await driver.findWait(selector, 1000).click();
    },
    async wait() {
      await driver.findWait(selector, 5000);
    },
    async isDisplayed() {
      return await driver.find(selector).isDisplayed();
    },
    async isPresent() {
      return await driver.find(selector).isPresent();
    }
  };
}

const publish = widget('.test-forms-publish');
const unpublish = widget('.test-forms-unpublish');
const confirm = widget('.test-modal-confirm');
const share = widget('.test-forms-share');
const form = widget('.test-form-page');

async function publishForm() {
  await publish.wait();
  await publish.click();
  await confirm.wait();
  await confirm.click();
  await gu.waitForServer();
  await unpublish.wait();
}

async function unpublishForm() {
  await unpublish.wait();
  await unpublish.click();
  await confirm.wait();
  await confirm.click();
  await gu.waitForServer();
  await publish.wait();
}

async function framing() {
  const frame = await driver.find('.test-form-framing');
  if (await frame.matches('[class*=-border]')) {
    return 'border';
  }
  if (await frame.matches('[class*=-minimal]')) {
    return 'minimal';
  }
}
