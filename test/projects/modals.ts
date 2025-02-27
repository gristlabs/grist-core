import { assert, driver, Key } from 'mocha-webdriver';
import { server, setupTestSuite } from './testUtils';

describe('modals', function() {
  setupTestSuite();

  before(async function() {
    this.timeout(20000);      // Set a longer default timeout.
    await driver.get(`${server.getHost()}/modals`);
  });

  async function checkClosed() {
    assert.equal(await driver.find('.test-modal-dialog').isPresent(), false);
  }
  async function checkOpen() {
    assert.equal(await driver.find('.test-modal-dialog').isDisplayed(), true);
  }

  it('should close on click-away, OK, Cancel, Escape, Enter', async function() {
    // Modal is initially reported as "Cancelled" and isn't present.
    assert.match(await driver.find('.testui-confirm-modal-text').getText(), /Cancelled/);
    await checkClosed();

    // Click on Cancel closes.
    await driver.find('.testui-confirm-modal-opener').click();
    await checkOpen();
    await driver.find('.test-modal-cancel').click();
    await checkClosed();
    assert.match(await driver.find('.testui-confirm-modal-text').getText(), /Cancelled/);

    // OK button closes and marks as Confirmed.
    await driver.find('.testui-confirm-modal-opener').click();
    await checkOpen();
    await driver.find('.test-modal-confirm').click();
    await checkClosed();
    assert.match(await driver.find('.testui-confirm-modal-text').getText(), /Confirmed/);

    // Click on modal's header does not close.
    await driver.find('.testui-confirm-modal-opener').click();
    await checkOpen();
    await driver.findContent('.test-modal-dialog div', /Default modal header/).click();
    await checkOpen();

    // Click above the area of the modal closes.
    await driver.findContent('.test-modal-dialog div', /Default modal header/).mouseMove();
    await driver.mouseMoveBy({y: -100});
    await driver.withActions((actions) => actions.click());
    await checkClosed();
    assert.match(await driver.find('.testui-confirm-modal-text').getText(), /Cancelled/);

    // Escape closes and marks Cancelled
    await driver.find('.testui-confirm-modal-opener').click();
    await checkOpen();
    await driver.sendKeys(Key.ESCAPE);
    await checkClosed();
    assert.match(await driver.find('.testui-confirm-modal-text').getText(), /Cancelled/);

    // Enter closes and marks Confirmed
    await driver.find('.testui-confirm-modal-opener').click();
    await checkOpen();
    await driver.sendKeys(Key.ENTER);
    await checkClosed();
    assert.match(await driver.find('.testui-confirm-modal-text').getText(), /Confirmed/);
  });

  it('should dispose on close', async function() {
    assert.match(await driver.find('.testui-custom-modal-text').getText(), /Closed/);
    await checkClosed();
    await driver.find('.testui-custom-modal-opener').click();
    await checkOpen();
    assert.match(await driver.find('.testui-custom-modal-text').getText(), /Open/);

    // Click button to close
    await driver.find('.testui-custom-modal-btn').click();
    await checkClosed();
    assert.match(await driver.find('.testui-custom-modal-text').getText(), /Closed/);

    await driver.find('.testui-custom-modal-opener').click();
    assert.match(await driver.find('.testui-custom-modal-text').getText(), /Open/);

    // Hit Escape to close
    await driver.sendKeys(Key.ESCAPE);
    await checkClosed();
    assert.match(await driver.find('.testui-custom-modal-text').getText(), /Closed/);
  });

  describe('saveModal', function() {
    it('should support arbitrary dom arguments', async () => {
      // Title and saveLabel both include dynamic DOM; check that it works.
      await driver.find('.testui-save-modal-opener').click();
      await checkOpen();
      assert.equal(await driver.find('.test-modal-title').getText(), "Title [Hello] (saving=0)");
      assert.equal(await driver.find('.test-modal-confirm').getText(), "Save [Hello]");

      // Type something else.
      await driver.find('.testui-save-modal-input').doClear().sendKeys("foo");
      assert.equal(await driver.find('.test-modal-title').getText(), "Title [foo] (saving=0)");
      assert.equal(await driver.find('.test-modal-confirm').getText(), "Save [foo]");
    });

    it('should disable save button when saveDisabled is set', async () => {
      await checkOpen();    // Still open from last test case.
      assert.equal(await driver.find('.test-modal-confirm').getAttribute('disabled'), null);

      // Clear the value; saveDisabled should turn to true, and the button should become disbled.
      await driver.find('.testui-save-modal-input').clear();
      assert.equal(await driver.find('.test-modal-confirm').getAttribute('disabled'), 'true');

      // Clicking a disabled button does nothing.
      await driver.find('.test-modal-confirm').click();
      await checkOpen();

      // Note: still have "(saving=0)" text, which confirms that saveFunc() is not pending.
      assert.equal(await driver.find('.test-modal-title').getText(), "Title [] (saving=0)");

      // Type something else; the button should be enabled again.
      await driver.find('.testui-save-modal-input').sendKeys('Hello');
      assert.equal(await driver.find('.test-modal-confirm').getAttribute('disabled'), null);
    });

    it('should respect modalArgs argument', async () => {
      await checkOpen();    // Still open from last test case.
      assert.equal(await driver.find('.test-modal-dialog').getCssValue('opacity'), '1');

      // Dialog is set up to change opacity when input has the text "translucent".
      await driver.find('.testui-save-modal-input').doClear().sendKeys('translucent');
      assert.equal(await driver.find('.test-modal-dialog').getCssValue('opacity'), '0.5');

      await driver.find('.testui-save-modal-input').doClear().sendKeys('Hello');
      assert.equal(await driver.find('.test-modal-dialog').getCssValue('opacity'), '1');
    });

    it('should disable Save button while saving', async () => {
      await checkOpen();    // Still open from last test case.

      // Check that the Save button is enabled; then click it.
      assert.equal(await driver.find('.test-modal-confirm').getAttribute('disabled'), null);
      await driver.find('.test-modal-confirm').click();

      // Check that there is a "(saving=1)" suffix in the title, and that the button is disabled.
      assert.equal(await driver.find('.test-modal-title').getText(), "Title [Hello] (saving=1)");
      assert.equal(await driver.find('.test-modal-confirm').getAttribute('disabled'), 'true');

      // A second click does nothing, in particular, does not call saveFunc() again.
      await driver.find('.test-modal-confirm').click();
      assert.equal(await driver.find('.test-modal-title').getText(), "Title [Hello] (saving=1)");
      assert.equal(await driver.find('.test-modal-confirm').getAttribute('disabled'), 'true');

      // Neither does hitting Enter.
      await driver.sendKeys(Key.ENTER);
      assert.equal(await driver.find('.test-modal-title').getText(), "Title [Hello] (saving=1)");
      assert.equal(await driver.find('.test-modal-confirm').getAttribute('disabled'), 'true');

      // If rejected, dialog stays open and Save button reenabled. We reject by typing "n" key.
      await driver.sendKeys("n");
      await checkOpen();
      assert.equal(await driver.find('.test-modal-title').getText(), "Title [Hello] (saving=0)");
      assert.equal(await driver.find('.test-modal-confirm').getAttribute('disabled'), null);

      // Click Save again.
      await driver.find('.test-modal-confirm').click();
      assert.equal(await driver.find('.test-modal-title').getText(), "Title [Hello] (saving=1)");
      assert.equal(await driver.find('.test-modal-confirm').getAttribute('disabled'), 'true');

      // If fulfilled, the dialog closes. We fulfill by typing "y".
      await driver.sendKeys("y");
      await checkClosed();

      // Open again and save via Enter.
      await driver.find('.testui-save-modal-opener').click();
      await checkOpen();
      await driver.sendKeys(Key.ENTER);
      assert.equal(await driver.find('.test-modal-title').getText(), "Title [Hello] (saving=1)");
      assert.equal(await driver.find('.test-modal-confirm').getAttribute('disabled'), 'true');
      await driver.sendKeys("y");
      await checkClosed();
    });

    it('should run disposers associated with owner argument', async () => {
      await checkClosed();
      assert.equal(await driver.find('.testui-save-modal-is-open').getText(), 'Modal Closed');

      // While open, the 'is-open' span turns to 'Open'.
      await driver.find('.testui-save-modal-opener').click();
      await checkOpen();
      assert.equal(await driver.find('.testui-save-modal-is-open').getText(), 'Modal Open');

      // Close via Escape.
      await driver.sendKeys(Key.ESCAPE);
      assert.equal(await driver.find('.testui-save-modal-is-open').getText(), 'Modal Closed');

      // Open again.
      await driver.find('.testui-save-modal-opener').click();
      await checkOpen();
      assert.equal(await driver.find('.testui-save-modal-is-open').getText(), 'Modal Open');

      // Close via Enter, and resolving the promise.
      await driver.sendKeys(Key.ENTER);
      await driver.sendKeys("y");
      assert.equal(await driver.find('.testui-save-modal-is-open').getText(), 'Modal Closed');
    });
  });

  describe('spinner modal', async function() {
    it('should show spinner until taks resolves', async function() {
      // open the modal
      await driver.find('.testui-spinner-modal-opener').click();
      await checkOpen();

      // check modal is shown with a spinner
      assert.equal(await driver.find('.test-modal-spinner').isPresent(), true);

      // press Escape
      await driver.sendKeys(Key.ESCAPE);

      // check modal is still there
      assert.equal(await driver.find('.test-modal-spinner').isPresent(), true);

      // click the resolve button
      await driver.find('.testui-resolve-spinner-task').click();

      // check the modal is hidden
      await checkClosed();

      // check the after spinner message is shown
      assert.equal(await driver.find('.testui-after-spinner').isPresent(), true);
    });
  });
});
