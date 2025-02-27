import {addToRepl, assert, driver, Key, stackWrapFunc, useServer, WebElement} from 'mocha-webdriver';
import {server} from 'test/fixtures/projects/webpack-test-server';
import * as gu from 'test/nbrowser/gristUtils';

describe('tokenfield', function() {
  useServer(server);
  const clipboard = gu.getLockableClipboard();
  let modKey: string;

  before(async function() {
    modKey = await gu.modKey();
    addToRepl('gu', gu, 'gristUtils, grist-specific helpers');
    addToRepl('Key', Key, 'key values such as Key.ENTER');
    addToRepl('modKey', modKey, 'COMMAND or CONTROL key, depending on OS');
  });

  beforeEach(async function() {
    await driver.get(`${server.getHost()}/tokenfield`);
  });

  type TFType = 'plain' | 'ac';

  const checkTokenText = stackWrapFunc(async function(type: TFType, expectedValues: string[]) {
    assert.deepEqual(await driver.findAll(`.test-tokenfield-${type} .test-tokenfield-token`, el => el.getText()),
      expectedValues.map(v => v.split('=')[0]));
    assert.equal(await driver.find(`.test-tokenfield-${type} .test-json-value`).getText(),
      JSON.stringify(expectedValues));
  });

  const getSelectedTokens = stackWrapFunc(async function(type: TFType): Promise<string[]> {
    return await driver.findAll(`.test-tokenfield-${type} .test-tokenfield-token.selected`, el => el.getText());
  });

  const clickWithKey = stackWrapFunc(async function(key: string, elem: WebElement) {
    await driver.withActions(a => a.keyDown(key).click(elem).keyUp(key));
  });

  const dragToken = stackWrapFunc(async function(type: TFType, dragLabel: string, destLabel: string|null) {
    await driver.findContent(`.test-tokenfield-${type} .test-tokenfield-token`, dragLabel).mouseMove();
    await driver.mouseDown();
    if (destLabel) {
      await driver.findContent(`.test-tokenfield-${type} .test-tokenfield-token`, destLabel).mouseMove();
    } else {
      await driver.find(`.test-tokenfield-${type} .test-tokenfield-input`).mouseMove();
    }
    await driver.mouseUp();
  });

  it(`should show initial values for tokenfield`, async function() {
    await checkTokenText('plain', ['Cat=10', 'Frog=40']);
    await checkTokenText('ac', ['Cat=10', 'Frog=40']);
  });

  it("should add a token by typing into plain textbox", async function() {
    await driver.find('.test-tokenfield-plain .test-tokenfield-input').click();
    await driver.sendKeys('Pink Elephant', Key.ENTER);
    await checkTokenText('plain', ['Cat=10', 'Frog=40', 'Pink Elephant=0']);
  });

  it("should add a token by using autocomplete", async function() {
    await driver.find('.test-tokenfield-ac .test-tokenfield-input').click();

    // Check typing of an entry in the autocomplete.
    await driver.sendKeys('Pa');
    assert.equal(await driver.find('.test-autocomplete .selected').getText(), 'Parakeet');
    await driver.sendKeys(Key.ENTER);
    await checkTokenText('ac', ['Cat=10', 'Frog=40', 'Parakeet=30']);

    // Check selecting via dropdown in the autocomplete.
    await driver.sendKeys('mon');
    await driver.findContentWait('.test-autocomplete li', /Golden Monkey/, 100).click();
    await checkTokenText('ac', ['Cat=10', 'Frog=40', 'Parakeet=30', 'Golden Monkey=50']);
  });

  it("should support Tab to add a token", async function() {
    // In plain tokenfield, type something and hit Tab.
    await driver.find('.test-tokenfield-plain .test-tokenfield-input').click();
    await driver.sendKeys('tiger', Key.TAB);

    // The token should be added.
    await checkTokenText('plain', ['Cat=10', 'Frog=40', 'tiger=0']);

    // Hitting Tab again should move to next field.
    assert.isTrue(await driver.find('.test-tokenfield-plain .test-tokenfield-input').hasFocus());
    await driver.sendKeys(Key.TAB);
    assert.isFalse(await driver.find('.test-tokenfield-plain .test-tokenfield-input').hasFocus());
    assert.isTrue(await driver.find('.test-tokenfield-ac .test-tokenfield-input').hasFocus());

    // In autocomplete, use dropdown and hit Tab.
    await driver.sendKeys(Key.DOWN, Key.DOWN, Key.DOWN);    // Should get to Dog.
    await driver.sendKeys(Key.TAB);

    // The token should be added.
    await checkTokenText('ac', ['Cat=10', 'Frog=40', 'Dog=20']);

    // Hitting Tab again should move to next field.
    assert.isTrue(await driver.find('.test-tokenfield-ac .test-tokenfield-input').hasFocus());
    await driver.sendKeys(Key.TAB);
    assert.isFalse(await driver.find('.test-tokenfield-ac .test-tokenfield-input').hasFocus());
  });

  it("should allow deleting tokens by clicking their x button", async function() {
    await driver.findContent('.test-tokenfield-plain .test-tokenfield-token', /Frog/)
      .find('.test-tokenfield-delete').click();
    await checkTokenText('plain', ['Cat=10']);
    await driver.findContent('.test-tokenfield-plain .test-tokenfield-token', /Cat/)
      .find('.test-tokenfield-delete').click();
    await checkTokenText('plain', []);

    // Try the same in the autocomplete one, but in a different order.
    await driver.findContent('.test-tokenfield-ac .test-tokenfield-token', /Cat/)
      .find('.test-tokenfield-delete').click();
    await checkTokenText('ac', ['Frog=40']);
    await driver.findContent('.test-tokenfield-ac .test-tokenfield-token', /Frog/)
      .find('.test-tokenfield-delete').click();
    await checkTokenText('ac', []);
  });

  it("should support selecting multiple tokens using clicks", async function() {
    // Add a couple more tokens.
    await driver.find('.test-tokenfield-plain .test-tokenfield-input').click();
    await driver.sendKeys('Mouse', Key.ENTER);
    await driver.sendKeys('Crab', Key.ENTER);
    await checkTokenText('plain', ['Cat=10', 'Frog=40', 'Mouse=0', 'Crab=0']);

    assert.deepEqual(await getSelectedTokens('plain'), []);
    await driver.findContent('.test-tokenfield-plain .test-tokenfield-token', /Cat/).click();
    assert.deepEqual(await getSelectedTokens('plain'), ['Cat']);
    await driver.findContent('.test-tokenfield-plain .test-tokenfield-token', /Mouse/).click();
    assert.deepEqual(await getSelectedTokens('plain'), ['Mouse']);

    await clickWithKey(Key.SHIFT, driver.findContent('.test-tokenfield-plain .test-tokenfield-token', /Cat/));
    assert.deepEqual(await getSelectedTokens('plain'), ['Cat', 'Frog', 'Mouse']);
    await clickWithKey(Key.SHIFT, driver.findContent('.test-tokenfield-plain .test-tokenfield-token', /Frog/));
    assert.deepEqual(await getSelectedTokens('plain'), ['Frog', 'Mouse']);
    await clickWithKey(Key.SHIFT, driver.findContent('.test-tokenfield-plain .test-tokenfield-token', /Crab/));
    assert.deepEqual(await getSelectedTokens('plain'), ['Mouse', 'Crab']);

    await clickWithKey(modKey, driver.findContent('.test-tokenfield-plain .test-tokenfield-token', /Cat/));
    assert.deepEqual(await getSelectedTokens('plain'), ['Cat', 'Mouse', 'Crab']);
    await clickWithKey(modKey, driver.findContent('.test-tokenfield-plain .test-tokenfield-token', /Crab/));
    assert.deepEqual(await getSelectedTokens('plain'), ['Cat', 'Mouse']);
    await clickWithKey(Key.SHIFT, driver.findContent('.test-tokenfield-plain .test-tokenfield-token', /Crab/));
    assert.deepEqual(await getSelectedTokens('plain'), ['Mouse', 'Crab']);
    await clickWithKey(Key.SHIFT, driver.findContent('.test-tokenfield-plain .test-tokenfield-token', /Cat/));
    assert.deepEqual(await getSelectedTokens('plain'), ['Cat', 'Frog', 'Mouse']);
  });

  it("should support selecting tokens using Ctrl+A", async function() {
    // Add another token.
    await driver.find('.test-tokenfield-plain .test-tokenfield-input').click();
    await gu.sendKeys('Mouse', Key.ENTER);
    await checkTokenText('plain', ['Cat=10', 'Frog=40', 'Mouse=0']);
    assert.deepEqual(await getSelectedTokens('plain'), []);

    // While there is input in the textbox, Ctrl+A selects the text there. (For this test, use a
    // single character, because webdriver's Ctrl+A doesn't work for native textboxes -- we are
    // not really testing that part, but typing in longer text would make it harder to clear.)
    await gu.sendKeys('m');
    await gu.sendKeys(Key.chord(modKey, 'a'));
    assert.deepEqual(await getSelectedTokens('plain'), []);
    assert.equal(await driver.find('.test-tokenfield-plain .test-tokenfield-input').value(), 'm');
    await gu.sendKeys(Key.BACK_SPACE);
    assert.equal(await driver.find('.test-tokenfield-plain .test-tokenfield-input').value(), '');

    // Select all. With empty textbox, it selects tokens.
    await gu.sendKeys(Key.chord(modKey, 'a'));
    assert.deepEqual(await getSelectedTokens('plain'), ['Cat', 'Frog', 'Mouse']);

    // Unselect some.
    await clickWithKey(modKey, driver.findContent('.test-tokenfield-plain .test-tokenfield-token', /Cat/));
    await clickWithKey(modKey, driver.findContent('.test-tokenfield-plain .test-tokenfield-token', /Mouse/));
    assert.deepEqual(await getSelectedTokens('plain'), ['Frog']);

    // Select all again, when focus is not inside the input element.
    await gu.sendKeys(Key.chord(modKey, 'a'));
    assert.deepEqual(await getSelectedTokens('plain'), ['Cat', 'Frog', 'Mouse']);

    // Click into input, selection should be cleared.
    await driver.find('.test-tokenfield-plain .test-tokenfield-input').click();
    assert.deepEqual(await getSelectedTokens('plain'), []);
  });

  it("should delete last item on backspace with no selection", async function() {
    await driver.find('.test-tokenfield-plain .test-tokenfield-input').click();
    await gu.sendKeys("m");
    assert.equal(await driver.find('.test-tokenfield-plain .test-tokenfield-input').value(), 'm');
    await gu.sendKeys(Key.BACK_SPACE);
    assert.equal(await driver.find('.test-tokenfield-plain .test-tokenfield-input').value(), '');
    await checkTokenText('plain', ['Cat=10', 'Frog=40']);

    await gu.sendKeys(Key.BACK_SPACE);
    assert.equal(await driver.find('.test-tokenfield-plain .test-tokenfield-input').value(), '');
    await checkTokenText('plain', ['Cat=10']);
    await gu.sendKeys(Key.BACK_SPACE);
    await checkTokenText('plain', []);
    await gu.sendKeys(Key.BACK_SPACE);
    await checkTokenText('plain', []);
  });

  it("should delete and update selection using Delete or Backspace", async function() {
    // Add a few more tokens.
    await driver.find('.test-tokenfield-plain .test-tokenfield-input').click();
    await driver.sendKeys('Mouse', Key.ENTER);
    await driver.sendKeys('Crab', Key.ENTER);
    await driver.sendKeys('Ant', Key.ENTER);
    await checkTokenText('plain', ['Cat=10', 'Frog=40', 'Mouse=0', 'Crab=0', 'Ant=0']);

    // Select some tokens and press DELETE.
    await clickWithKey(modKey, driver.findContent('.test-tokenfield-plain .test-tokenfield-token', /Frog/));
    await clickWithKey(modKey, driver.findContent('.test-tokenfield-plain .test-tokenfield-token', /Crab/));
    assert.deepEqual(await getSelectedTokens('plain'), ['Frog', 'Crab']);
    await gu.sendKeys(Key.DELETE);

    // The following token should be selected after deletion.
    await checkTokenText('plain', ['Cat=10', 'Mouse=0', 'Ant=0']);
    assert.deepEqual(await getSelectedTokens('plain'), ['Ant']);

    // Hit DELETE again, and focus should return to the text input.
    await gu.sendKeys(Key.DELETE);
    await checkTokenText('plain', ['Cat=10', 'Mouse=0']);
    assert.deepEqual(await getSelectedTokens('plain'), []);
    assert.isTrue(await driver.find('.test-tokenfield-plain .test-tokenfield-input').hasFocus());

    // Add more elements, and repeat using BACKSPACE.
    await driver.sendKeys('Sloth', Key.ENTER);
    await driver.sendKeys('Bat', Key.ENTER);
    await checkTokenText('plain', ['Cat=10', 'Mouse=0', 'Sloth=0', 'Bat=0']);
    await clickWithKey(modKey, driver.findContent('.test-tokenfield-plain .test-tokenfield-token', /Mouse/));
    await clickWithKey(modKey, driver.findContent('.test-tokenfield-plain .test-tokenfield-token', /Bat/));
    await gu.sendKeys(Key.BACK_SPACE);

    // The preceding token should be selected after deletion.
    await checkTokenText('plain', ['Cat=10', 'Sloth=0']);
    assert.deepEqual(await getSelectedTokens('plain'), ['Cat']);

    // Hit backspace again, and focus should return to the text input.
    await gu.sendKeys(Key.BACK_SPACE);
    await checkTokenText('plain', ['Sloth=0']);
    assert.deepEqual(await getSelectedTokens('plain'), []);
    assert.isTrue(await driver.find('.test-tokenfield-plain .test-tokenfield-input').hasFocus());
  });

  it('should support arrow keys including with Shift', async function() {
    // Add some more tokens.
    await driver.find('.test-tokenfield-plain .test-tokenfield-input').click();
    await driver.sendKeys('Mouse', Key.ENTER);
    await driver.sendKeys('Crab', Key.ENTER);
    await driver.sendKeys('Ant', Key.ENTER);
    await checkTokenText('plain', ['Cat=10', 'Frog=40', 'Mouse=0', 'Crab=0', 'Ant=0']);
    assert.deepEqual(await getSelectedTokens('plain'), []);

    // Navigate around using arrows and shift+arrows.
    await gu.sendKeys(Key.LEFT);
    assert.deepEqual(await getSelectedTokens('plain'), ['Ant']);
    await gu.sendKeys(Key.LEFT);
    assert.deepEqual(await getSelectedTokens('plain'), ['Crab']);
    await gu.sendKeys(Key.chord(Key.SHIFT, Key.LEFT));
    assert.deepEqual(await getSelectedTokens('plain'), ['Mouse', 'Crab']);
    await gu.sendKeys(Key.LEFT);
    assert.deepEqual(await getSelectedTokens('plain'), ['Frog']);
    await gu.sendKeys(Key.chord(Key.SHIFT, Key.LEFT));
    await gu.sendKeys(Key.chord(Key.SHIFT, Key.LEFT));
    await gu.sendKeys(Key.chord(Key.SHIFT, Key.LEFT));
    assert.deepEqual(await getSelectedTokens('plain'), ['Cat', 'Frog']);

    await gu.sendKeys(Key.chord(Key.SHIFT, Key.RIGHT));
    await gu.sendKeys(Key.chord(Key.SHIFT, Key.RIGHT));
    await gu.sendKeys(Key.chord(Key.SHIFT, Key.RIGHT));
    assert.deepEqual(await getSelectedTokens('plain'), ['Frog', 'Mouse', 'Crab']);
    await gu.sendKeys(Key.chord(Key.SHIFT, Key.LEFT));
    assert.deepEqual(await getSelectedTokens('plain'), ['Frog', 'Mouse']);
    await gu.sendKeys(Key.chord(Key.SHIFT, Key.RIGHT));
    assert.deepEqual(await getSelectedTokens('plain'), ['Frog', 'Mouse', 'Crab']);
    await gu.sendKeys(Key.RIGHT);
    assert.deepEqual(await getSelectedTokens('plain'), ['Ant']);
    await gu.sendKeys(Key.RIGHT);
    assert.deepEqual(await getSelectedTokens('plain'), []);
    assert.isTrue(await driver.find('.test-tokenfield-plain .test-tokenfield-input').hasFocus());
  });

  it('should select a single item even when multiple equal ones present', async function() {
    await driver.find('.test-tokenfield-ac .test-tokenfield-input').click();
    await driver.sendKeys('Cat', Key.ENTER);
    await checkTokenText('ac', ['Cat=10', 'Frog=40', 'Cat=10']);

    await driver.findContent('.test-tokenfield-ac .test-tokenfield-token', /Cat/).click();
    assert.deepEqual(await getSelectedTokens('ac'), ['Cat']);
    await clickWithKey(modKey,
      driver.findContent('.test-tokenfield-ac .test-tokenfield-token:not(:first-child)', /Cat/));
    assert.deepEqual(await getSelectedTokens('ac'), ['Cat', 'Cat']);
    await driver.findContent('.test-tokenfield-ac .test-tokenfield-token', /Cat/).click();
    assert.deepEqual(await getSelectedTokens('ac'), ['Cat']);
    await gu.sendKeys(Key.DELETE);
    await checkTokenText('ac', ['Frog=40', 'Cat=10']);
    assert.deepEqual(await getSelectedTokens('ac'), ['Frog']);
  });

  it('should support cut-copy-paste', async function() {
    await checkTokenText('plain', ['Cat=10', 'Frog=40']);
    await checkTokenText('ac', ['Cat=10', 'Frog=40']);

    // Copy-paste a token from one tokenfield to the other.
    await driver.findContent('.test-tokenfield-plain .test-tokenfield-token', /Cat/).click();
    await clipboard.lockAndPerform(async (cb) => {
      await cb.copy();
      await driver.find('.test-tokenfield-ac .test-tokenfield-input').click();
      await cb.paste();
    });
    await checkTokenText('ac', ['Cat=10', 'Frog=40', 'Cat=10']);

    // Add another token, and select a range.
    await driver.find('.test-tokenfield-ac .test-tokenfield-input').click();
    await driver.sendKeys('Parakeet', Key.ENTER);
    await checkTokenText('ac', ['Cat=10', 'Frog=40', 'Cat=10', 'Parakeet=30']);
    await driver.findContent('.test-tokenfield-ac .test-tokenfield-token', /Parakeet/).click();
    await clickWithKey(Key.SHIFT, driver.findContent('.test-tokenfield-ac .test-tokenfield-token', /Frog/));
    assert.deepEqual(await getSelectedTokens('ac'), ['Frog', 'Cat', 'Parakeet']);

    // Copy-paste some tokens to a textbox.
    await clipboard.lockAndPerform(async (cb) => {
      await cb.copy();
      await driver.find('.test-copypaste').click();
      await cb.paste();
    });
    assert.equal(await driver.find('.test-copypaste').value(), 'Frog, Cat, Parakeet');
    await checkTokenText('ac', ['Cat=10', 'Frog=40', 'Cat=10', 'Parakeet=30']);

    // Clear the textbox and select the range of tokens again.
    await driver.find('.test-copypaste').clear();
    assert.equal(await driver.find('.test-copypaste').value(), '');
    await driver.findContent('.test-tokenfield-ac .test-tokenfield-token', /Parakeet/).click();
    await clickWithKey(Key.SHIFT, driver.findContent('.test-tokenfield-ac .test-tokenfield-token', /Frog/));
    assert.deepEqual(await getSelectedTokens('ac'), ['Frog', 'Cat', 'Parakeet']);

    // Cut-n-paste tokens into the textbox. They should be gone from the source.
    await clipboard.lockAndPerform(async (cb) => {
      await cb.cut();
      await driver.find('.test-copypaste').click();
      await cb.paste();
    });
    assert.equal(await driver.find('.test-copypaste').value(), 'Frog, Cat, Parakeet');
    await checkTokenText('ac', ['Cat=10']);
  });

  it('should support copy-pasting tokens with special characters', async function() {
    await driver.find('.test-copypaste').clear();

    // Create some tokens with special characters.
    await driver.find('.test-tokenfield-plain .test-tokenfield-input').click();
    await gu.sendKeys('With, comma', Key.ENTER);
    await gu.sendKeys('"', Key.ENTER);
    await gu.sendKeys('ωμέγα', Key.ENTER);
    await checkTokenText('plain', ['Cat=10', 'Frog=40', 'With, comma=0', '"=0', 'ωμέγα=0']);

    // Select all and copy-paste to textbox.
    await gu.sendKeys(Key.chord(modKey, 'a'));
    await clipboard.lockAndPerform(async (cb) => {
      await cb.copy();
      await driver.find('.test-copypaste').click();
      await cb.paste();
    });
    assert.equal(await driver.find('.test-copypaste').value(),
      'Cat, Frog, "With, comma", """", ωμέγα');
  });

  it('should support pasting in from CSV text', async function() {
    // Enter new text into textbox, select and copy.
    await driver.find('.test-copypaste').clear();
    await driver.find('.test-copypaste').click();
    await gu.sendKeys('Dog,Giraffe, "Golden Monkey", pájaro ');
    await gu.sendKeys(await gu.selectAllKey());
    await clipboard.lockAndPerform(async (cb) => {
      await cb.copy();

      // Clear "plain" tokenfield and paste into there. All tokens should populate.
      await driver.find('.test-tokenfield-plain .test-tokenfield-input').click();
      await cb.paste();
      await checkTokenText('plain', ['Cat=10', 'Frog=40', 'Dog=0', 'Giraffe=0', 'Golden Monkey=0', 'pájaro=0']);

      // Clear "autocomplete" tokenfield and paste into there. Only known tokens should populate.
      await driver.find('.test-tokenfield-ac .test-tokenfield-input').click();
      await cb.paste();
    });
    await checkTokenText('ac', ['Cat=10', 'Frog=40', 'Dog=20', 'Golden Monkey=50']);
  });

  it('should replace selected tokens when pasting over them', async function() {
    await driver.find('.test-copypaste').clear();
    await driver.find('.test-copypaste').click();
    await gu.sendKeys(' Dog,"Golden Monkey"');
    await gu.sendKeys(await gu.selectAllKey());
    await clipboard.lockAndPerform(async (cb) => {
      await cb.copy();

      await checkTokenText('plain', ['Cat=10', 'Frog=40']);
      await checkTokenText('ac', ['Cat=10', 'Frog=40']);

      // Paste over 'Cat' in the "autocomplete" tokenfield.
      await driver.find('.test-tokenfield-ac .test-tokenfield-input').click();
      await driver.findContent('.test-tokenfield-ac .test-tokenfield-token', /Cat/).click();
      await cb.paste();
      await checkTokenText('ac', ['Dog=20', 'Golden Monkey=50', 'Frog=40']);
      assert.deepEqual(await getSelectedTokens('ac'), ['Dog', 'Golden Monkey']);

      // Paste over all tokens in the "plain" tokenfield.
      await driver.find('.test-tokenfield-plain .test-tokenfield-input').click();
      await gu.sendKeys(await gu.selectAllKey());
      await cb.paste();
    });
    await checkTokenText('plain', ['Dog=0', 'Golden Monkey=0']);
    assert.isTrue(await driver.find('.test-tokenfield-plain .test-tokenfield-input').hasFocus());
  });

  it('should allow dragging tokens to move them', async function() {
    this.timeout(4000);

    // Add a few more tokens.
    await driver.find('.test-tokenfield-plain .test-tokenfield-input').click();
    await driver.sendKeys('Mouse', Key.ENTER);
    await driver.sendKeys('Crab', Key.ENTER);
    await driver.sendKeys('Ant', Key.ENTER);
    await checkTokenText('plain', ['Cat=10', 'Frog=40', 'Mouse=0', 'Crab=0', 'Ant=0']);

    // Grab 'Ant', and move it backward.
    await dragToken('plain', 'Ant', 'Mouse');
    await checkTokenText('plain', ['Cat=10', 'Frog=40', 'Ant=0', 'Mouse=0', 'Crab=0']);
    assert.deepEqual(await getSelectedTokens('plain'), ['Ant']);

    // Move forward
    await dragToken('plain', 'Frog', 'Crab');
    await checkTokenText('plain', ['Cat=10', 'Ant=0', 'Mouse=0', 'Frog=40', 'Crab=0']);
    assert.deepEqual(await getSelectedTokens('plain'), ['Frog']);

    // Move a multiple selection to the beginning
    await driver.findContent('.test-tokenfield-plain .test-tokenfield-token', 'Mouse').click();
    await clickWithKey(modKey, driver.findContent('.test-tokenfield-plain .test-tokenfield-token', 'Frog'));
    await dragToken('plain', 'Mouse', 'Cat');
    await checkTokenText('plain', ['Mouse=0', 'Frog=40', 'Cat=10', 'Ant=0', 'Crab=0']);
    assert.deepEqual(await getSelectedTokens('plain'), ['Mouse', 'Frog']);

    // Move element to the end.
    await dragToken('plain', 'Cat', null);
    await checkTokenText('plain', ['Mouse=0', 'Frog=40', 'Ant=0', 'Crab=0', 'Cat=10']);

    // Move a disjoint selection.
    await driver.findContent('.test-tokenfield-plain .test-tokenfield-token', 'Ant').click();
    await clickWithKey(modKey, driver.findContent('.test-tokenfield-plain .test-tokenfield-token', 'Cat'));
    await dragToken('plain', 'Cat', 'Frog');
    await checkTokenText('plain', ['Mouse=0', 'Ant=0', 'Cat=10', 'Frog=40', 'Crab=0']);
    assert.deepEqual(await getSelectedTokens('plain'), ['Ant', 'Cat']);
  });

  it('should support undo/redo', async function() {
    this.timeout(6000);
    const undoKey = Key.chord(modKey, 'z');
    // (modKey, Key.SHIFT, 'z') sent via webdriver doesn't get seen at all for some reason.
    const redoKey = Key.chord(Key.CONTROL, 'y');
    // Add a few more tokens.
    await driver.find('.test-tokenfield-plain .test-tokenfield-input').click();
    await driver.sendKeys('Mouse', Key.ENTER);
    await driver.sendKeys('Crab', Key.ENTER);
    await driver.sendKeys('Ant', Key.ENTER);
    await checkTokenText('plain', ['Cat=10', 'Frog=40', 'Mouse=0', 'Crab=0', 'Ant=0']);

    // Undo/redo the last one.
    await gu.sendKeys(undoKey);
    await checkTokenText('plain', ['Cat=10', 'Frog=40', 'Mouse=0', 'Crab=0']);
    await gu.sendKeys(redoKey);
    await checkTokenText('plain', ['Cat=10', 'Frog=40', 'Mouse=0', 'Crab=0', 'Ant=0']);

    // Delete one.
    await driver.findContent('.test-tokenfield-plain .test-tokenfield-token', 'Crab')
      .find('.test-tokenfield-delete').click();
    await checkTokenText('plain', ['Cat=10', 'Frog=40', 'Mouse=0', 'Ant=0']);

    // Undo/redo deletion.
    await gu.sendKeys(undoKey);
    await checkTokenText('plain', ['Cat=10', 'Frog=40', 'Mouse=0', 'Crab=0', 'Ant=0']);
    await gu.sendKeys(redoKey);
    await checkTokenText('plain', ['Cat=10', 'Frog=40', 'Mouse=0', 'Ant=0']);

    // Delete a selection.
    await driver.findContent('.test-tokenfield-plain .test-tokenfield-token', 'Cat').click();
    await clickWithKey(modKey, driver.findContent('.test-tokenfield-plain .test-tokenfield-token', 'Mouse'));
    await gu.sendKeys(Key.BACK_SPACE);
    await checkTokenText('plain', ['Frog=40', 'Ant=0']);

    // Undo/redo that deletion.
    await gu.sendKeys(undoKey);
    await checkTokenText('plain', ['Cat=10', 'Frog=40', 'Mouse=0', 'Ant=0']);
    await gu.sendKeys(redoKey);
    await checkTokenText('plain', ['Frog=40', 'Ant=0']);

    // Extra redos are harmless
    await gu.sendKeys(redoKey);
    await gu.sendKeys(redoKey);
    await checkTokenText('plain', ['Frog=40', 'Ant=0']);

    // Undo to return to 5 tokens.
    await gu.sendKeys(undoKey);
    await gu.sendKeys(undoKey);
    await checkTokenText('plain', ['Cat=10', 'Frog=40', 'Mouse=0', 'Crab=0', 'Ant=0']);

    // Copy-paste one set of tokens over another.
    await driver.findContent('.test-tokenfield-plain .test-tokenfield-token', 'Cat').click();
    await clickWithKey(modKey, driver.findContent('.test-tokenfield-plain .test-tokenfield-token', 'Mouse'));
    await clipboard.lockAndPerform(async (cb) => {
      await cb.copy();
      await driver.findContent('.test-tokenfield-plain .test-tokenfield-token', 'Mouse').click();
      await clickWithKey(Key.SHIFT, driver.findContent('.test-tokenfield-plain .test-tokenfield-token', 'Ant'));
      await cb.paste();
    });
    await checkTokenText('plain', ['Cat=10', 'Frog=40', 'Cat=0', 'Mouse=0']);

    // Type into input box. Redo should undo that typing.
    await gu.sendKeys('m');
    assert.equal(await driver.find('.test-tokenfield-plain .test-tokenfield-input').value(), 'm');

    // Undo shortcuts don't seem to work with webdriver for native elements on Mac, but do work on
    // Linux. So try the shortcut, and if it doesn't work, just clear the input manually. (The
    // emptiness of the input is what determines whether we intercept undo/redo.)
    await gu.sendKeys(undoKey);
    if ((await driver.find('.test-tokenfield-plain .test-tokenfield-input').value()) === 'm') {
      await gu.sendKeys(Key.BACK_SPACE);
    }

    await checkTokenText('plain', ['Cat=10', 'Frog=40', 'Cat=0', 'Mouse=0']);
    assert.equal(await driver.find('.test-tokenfield-plain .test-tokenfield-input').value(), '');

    // Subsequent undo should undo the last change.
    await gu.sendKeys(undoKey);
    await checkTokenText('plain', ['Cat=10', 'Frog=40', 'Mouse=0', 'Crab=0', 'Ant=0']);

    // Redos should redo the token change, then redo the text input change.
    await gu.sendKeys(redoKey);
    assert.equal(await driver.find('.test-tokenfield-plain .test-tokenfield-input').value(), '');
    await checkTokenText('plain', ['Cat=10', 'Frog=40', 'Cat=0', 'Mouse=0']);

    // Again, redo shortcuts may or may not work with webdriver for native elements. Try it, but
    // be prepared for it not working.
    await gu.sendKeys(redoKey);
    if ((await driver.find('.test-tokenfield-plain .test-tokenfield-input').value()) === 'm') {
      await gu.sendKeys(undoKey);
    }
    await checkTokenText('plain', ['Cat=10', 'Frog=40', 'Cat=0', 'Mouse=0']);
    assert.equal(await driver.find('.test-tokenfield-plain .test-tokenfield-input').value(), '');

    // Return to initial state.
    await gu.sendKeys(undoKey);
    await gu.sendKeys(undoKey);
    await gu.sendKeys(undoKey);
    await gu.sendKeys(undoKey);
    await checkTokenText('plain', ['Cat=10', 'Frog=40']);

    // Extra undos are harmless.
    await gu.sendKeys(undoKey);
    await checkTokenText('plain', ['Cat=10', 'Frog=40']);
  });
});
