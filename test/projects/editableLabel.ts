import {assert, driver, Key, useServer, WebElement} from 'mocha-webdriver';
import {server} from '../fixtures/projects/webpack-test-server';

describe('editableLabel', function() {
  useServer(server);

  before(async function() {
    await driver.get(`${server.getHost()}/editableLabel`);
  });

  beforeEach(async function() {
    await driver.find('.test-reset').click();
  });

  // Webdriver has elem.clear(), but it doesn't seem to work with editableLabel. Simulate with a
  // key combination (might be Mac-Chrome-specific).
  async function clear(elem: WebElement) {
    await elem.sendKeys(Key.HOME, Key.chord(Key.SHIFT, Key.END), Key.DELETE);
  }

  describe('test editableLabel component', function() {

    before(async function() {
      await driver.findContent('.test-select-component option', 'editableLabel').click();
    });

    testInput();

    it("should select the full value on click", async function() {
      // Click the label, and enter text -- it should be the only text in it.
      await driver.find('.test-edit-label').doClick().sendKeys('foo');
      assert.equal(await driver.find('.test-edit-label').value(), 'foo');
      await driver.find('.test-edit-label').sendKeys(Key.ESCAPE);
    });

  });

  describe('test textInput component', function() {
    before(async function() {
      await driver.findContent('.test-select-component option', 'textInput').click();
    });

    testInput();

  });

  function testInput() {
    it("should save value on change", async function() {
      assert.equal(await driver.find('.test-edit-label').value(), "Hello");
      assert.equal(await driver.find('.test-saved-value').getText(), "Hello");

      // Click, type a new value, and hit Enter.
      // Ideally we'd use `.doClear()` here, but that loses focus
      await clear(driver.find('.test-edit-label').doClick());
      await driver.find('.test-edit-label').sendKeys("foo", Key.ENTER);

      // Update the value on the server and resolve the server call(s).
      await driver.find('.test-server-value').doClear().sendKeys("foo");
      await driver.find('.test-server-update').click();
      await driver.findAll('.test-call-resolve', (el) => el.click());

      // We should have the new value in the editableLabel, and in the plain text box.
      assert.equal(await driver.find('.test-edit-label').value(), "foo");
      assert.equal(await driver.find('.test-saved-value').getText(), "foo");
    });

    it("should make a single call to save", async function() {
      // Same as above, but verify that only one call is made to the server.
      await clear(driver.find('.test-edit-label').doClick());
      await driver.find('.test-edit-label').sendKeys("foo", Key.ENTER);

      await driver.find('.test-server-value').doClear().sendKeys("foo");
      await driver.find('.test-server-update').click();
      await driver.findAll('.test-call-resolve', (el) => el.click());

      assert.equal(await driver.find('.test-edit-label').value(), "foo");
      assert.equal(await driver.find('.test-saved-value').getText(), "foo");

      assert.deepEqual(await driver.findAll('.test-call-log li', (el) => el.getText()),
                       ['Called: foo', 'Resolved']);
    });

    it("should save on blur", async function() {
      // Same as above, but verify that only one call is made to the server.
      await clear(driver.find('.test-edit-label').doClick());
      await driver.find('.test-edit-label').sendKeys("BlurTest");

      // At this point the textbox has the new value, but it's not yet saved.
      assert.equal(await driver.find('.test-edit-label').value(), "BlurTest");
      assert.equal(await driver.find('.test-saved-value').getText(), "Hello");
      assert.deepEqual(await driver.findAll('.test-call-log li', (el) => el.getText()), []);

      // Click away (on a text label): a call should be made.
      await driver.find('.test-saved-value').click();
      assert.deepEqual(await driver.findAll('.test-call-log li', (el) => el.getText()), ['Called: BlurTest']);

      // Resolve the server call.
      await driver.find('.test-server-value').doClear().sendKeys("BlurTest");
      await driver.find('.test-server-update').click();
      await driver.findAll('.test-call-resolve', (el) => el.click());

      // Check that both values are now updated.
      assert.equal(await driver.find('.test-edit-label').value(), "BlurTest");
      assert.equal(await driver.find('.test-saved-value').getText(), "BlurTest");
      assert.deepEqual(await driver.findAll('.test-call-log li', (el) => el.getText()),
                       ['Called: BlurTest', 'Resolved']);
    });


    it("should not make a save call on Escape", async function() {
      // Click, hit Escape.
      await driver.find('.test-edit-label').doClick().sendKeys(Key.ESCAPE);

      // Check that no calls are made.
      assert.deepEqual(await driver.findAll('.test-call-log li', (el) => el.getText()),
                       []);
    });

    it("should revert on Escape", async function() {
      // Click, change value, hit Escape.
      await driver.find('.test-edit-label').doClick().sendKeys(Key.END, "-foo", Key.ESCAPE);

      // Value in editableLabel should revert to what it was.
      assert.equal(await driver.find('.test-edit-label').value(), "Hello");
      assert.equal(await driver.find('.test-saved-value').getText(), "Hello");

      // Check that no calls are made.
      assert.deepEqual(await driver.findAll('.test-call-log li', (el) => el.getText()),
                       []);
    });

    it("should reflect the value on the server", async function() {
      // Update server value.
      await driver.find('.test-server-value').doClear().sendKeys("foo");
      await driver.find('.test-server-update').click();

      // Check that editableLabel reflects it.
      assert.equal(await driver.find('.test-saved-value').getText(), "foo");
      assert.equal(await driver.find('.test-edit-label').value(), "foo");
    });

    it("should reflect changes to the server value after save", async function() {
      // Every test case starts with hello. Change it to something else and save.
      await driver.find('.test-edit-label').doClick().sendKeys('Hola', Key.ENTER);
      await driver.find('.test-server-value').doClear().sendKeys("Hola");
      await driver.find('.test-server-update').click();
      await driver.findAll('.test-call-resolve', (el) => el.click());

      // Check that editableLabel reflects it.
      assert.equal(await driver.find('.test-saved-value').getText(), "Hola");
      assert.equal(await driver.find('.test-edit-label').value(), "Hola");

      // Update the value on the server, and check that editableLabel reflects it.
      await driver.find('.test-server-value').doClear().sendKeys("World");
      await driver.find('.test-server-update').click();
      assert.equal(await driver.find('.test-saved-value').getText(), "World");
      assert.equal(await driver.find('.test-edit-label').value(), "World");
    });

    it("should show the server value if different when save returns", async function() {
      // Click, type a new value, and hit Enter.
      await clear(driver.find('.test-edit-label').doClick());
      await driver.find('.test-edit-label').sendKeys("foo", Key.ENTER);

      // Check that we show the desired value while waiting for the save.
      assert.equal(await driver.find('.test-edit-label').value(), "foo");

      // Update the value on the server to something else, and resolve.
      await driver.find('.test-server-value').doClear().sendKeys("foo2");
      await driver.find('.test-server-update').click();
      await driver.findAll('.test-call-resolve', (el) => el.click());

      // We should have the server value in the editableLabel, and in the plain text box
      assert.equal(await driver.find('.test-saved-value').getText(), "foo2");
      assert.equal(await driver.find('.test-edit-label').value(), "foo2");

      assert.deepEqual(await driver.findAll('.test-call-log li', (el) => el.getText()),
                       ['Called: foo', 'Resolved']);
    });

    it("should show the server value if save failed", async function() {
      // Click, change value, hit Enter.
      await clear(driver.find('.test-edit-label').doClick());
      await driver.find('.test-edit-label').sendKeys("foo", Key.ENTER);

      // Reject the server call.
      await driver.findAll('.test-call-reject', (el) => el.click());

      // server value and editableLabel should have the previous server value.
      assert.equal(await driver.find('.test-saved-value').getText(), "Hello");
      assert.equal(await driver.find('.test-edit-label').value(), "Hello");

      assert.deepEqual(await driver.findAll('.test-call-log li', (el) => el.getText()),
                       ['Called: foo', 'Rejected: FakeError']);
    });

    it("should not reflect server changes while being edited", async function() {
      // Prepare a new server value.
      await driver.find('.test-server-value').doClear().sendKeys("bar");

      // Click, start typing a new value.
      await driver.find('.test-edit-label').doClick().sendKeys(Key.END, "-foo");

      // Update the value on the server via keyboard shortcut to avoid changing focus.
      await driver.find('.test-edit-label').sendKeys(Key.chord(Key.CONTROL, 'U'));

      // We should have the new value in the plain textbox, but not in editableLabel.
      assert.equal(await driver.find('.test-saved-value').getText(), "bar");
      assert.equal(await driver.find('.test-edit-label').value(), "Hello-foo");

      // Check that no calls are made.
      assert.deepEqual(await driver.findAll('.test-call-log li', (el) => el.getText()), []);
    });

    it("should be disabled while a call is pending", async function() {
      // Click, change value, hit Enter.
      await clear(driver.find('.test-edit-label').doClick());
      await driver.find('.test-edit-label').sendKeys("foo", Key.ENTER);

      // editableLabel should now be disabled, and show the expected value.
      assert.equal(await driver.find('.test-edit-label').value(), "foo");
      assert.equal(await driver.find('.test-edit-label').getAttribute('disabled'), 'true');

      // Resolve the server call.
      await driver.find('.test-server-value').doClear().sendKeys("foo");
      await driver.find('.test-server-update').click();
      await driver.findAll('.test-call-resolve', (el) => el.click());

      // editableLabel should now be enabled again.
      assert.equal(await driver.find('.test-edit-label').getAttribute('disabled'), null);

      // We should have the new value in the editableLabel, and in the plain text box.
      assert.equal(await driver.find('.test-edit-label').value(), "foo");
      assert.equal(await driver.find('.test-saved-value').getText(), "foo");
    });

  }
});
