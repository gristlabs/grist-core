import {UserAPI} from 'app/common/UserAPI';
import {addToRepl, assert, driver, Key, WebElement, WebElementPromise} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('FormView', function() {
  this.timeout('90s');
  gu.bigScreen();

  let api: UserAPI;
  let docId: string;

  const cleanup = setupTestSuite();

  gu.withEnvironmentSnapshot({
    'GRIST_EXPERIMENTAL_PLUGINS': '1'
  });

  addToRepl('question', question);
  addToRepl('labels', readLabels);
  addToRepl('questionType', questionType);
  const clipboard = gu.getLockableClipboard();

  afterEach(() => gu.checkForErrors());

  before(async function() {
    const session = await gu.session().login();
    docId = await session.tempNewDoc(cleanup);
    api = session.createHomeApi();
    await driver.executeScript(createClipboardTextArea);
  });

  after(async function() {
    await driver.executeScript(removeClipboardTextArea);
  });

  /**
   * Adds a temporary textarea to the document for pasting the contents of
   * the clipboard.
   *
   * Used to test copying of form URLs to the clipboard.
   */
  function createClipboardTextArea() {
    const textArea = document.createElement('textarea');
    textArea.style.position = 'absolute';
    textArea.style.top = '0';
    textArea.style.height = '2rem';
    textArea.style.width = '16rem';
    textArea.id = 'clipboardText';
    window.document.body.appendChild(textArea);
  }

  function removeClipboardTextArea() {
    const textArea = document.getElementById('clipboardText');
    if (textArea) {
      window.document.body.removeChild(textArea);
    }
  }

  async function createFormWith(type: string, more = false) {
    await gu.addNewSection('Form', 'Table1');

    assert.isUndefined(await api.getTable(docId, 'Table1').then(t => t.D));

    // Add a text question
    await plusButton().click();
    if (more) {
      await clickMenu('More');
    }
    await clickMenu(type);
    await gu.waitForServer();

    // Make sure we see this new question (D).
    assert.deepEqual(await readLabels(), ['A', 'B', 'C', 'D']);

    await driver.find('.test-forms-publish').click();
    await driver.find('.test-modal-confirm').click();
    await gu.waitForServer();

    // Now open the form in external window.
    await clipboard.lockAndPerform(async (cb) => {
      await driver.find(`.test-forms-link`).click();
      await gu.waitForServer();
      await gu.waitToPass(async () => assert.match(
        await driver.find('.test-tooltip').getText(), /Link copied to clipboard/), 1000);
      await driver.find('#clipboardText').click();
      await gu.selectAll();
      await cb.paste();
    });

    // Select it
    await question('D').click();

    return await driver.find('#clipboardText').value();
  }

  async function removeForm() {
    // Remove this section.
    await gu.openSectionMenu('viewLayout');
    await driver.find('.test-section-delete').click();
    await gu.waitForServer();

    // Remove record.
    await gu.sendActions([
      ['RemoveRecord', 'Table1', 1],
      ['RemoveColumn', 'Table1', 'D']
    ]);
  }

  async function waitForConfirm() {
    await gu.waitToPass(async () => {
      assert.isTrue(await driver.findWait('.grist-form-confirm', 1000).isDisplayed());
    });
  }

  async function expectSingle(value: any) {
    assert.deepEqual(await api.getTable(docId, 'Table1').then(t => t.D), [value]);
  }

  async function expect(values: any[]) {
    assert.deepEqual(await api.getTable(docId, 'Table1').then(t => t.D), values);
  }

  it('can submit a form with Text field', async function() {
    const formUrl = await createFormWith('Text');
    // We are in a new window.
    await gu.onNewTab(async () => {
      await driver.get(formUrl);
      await driver.findWait('input[name="D"]', 1000).click();
      await gu.sendKeys('Hello World');
      await driver.find('input[type="submit"]').click();
      await waitForConfirm();
    });
    // Make sure we see the new record.
    await expectSingle('Hello World');
    await removeForm();
  });

  it('can submit a form with Numeric field', async function() {
    const formUrl = await createFormWith('Numeric');
    // We are in a new window.
    await gu.onNewTab(async () => {
      await driver.get(formUrl);
      await driver.findWait('input[name="D"]', 1000).click();
      await gu.sendKeys('1984');
      await driver.find('input[type="submit"]').click();
      await waitForConfirm();
    });
    // Make sure we see the new record.
    await expectSingle(1984);
    await removeForm();
  });

  it('can submit a form with Date field', async function() {
    const formUrl = await createFormWith('Date');
    // We are in a new window.
    await gu.onNewTab(async () => {
      await driver.get(formUrl);
      await driver.findWait('input[name="D"]', 1000).click();
      await driver.executeScript(
        () => (document.querySelector('input[name="D"]') as HTMLInputElement).value = '2000-01-01'
      );
      await driver.find('input[type="submit"]').click();
      await waitForConfirm();
    });
    // Make sure we see the new record.
    await expectSingle(/* 2000-01-01 */946684800);
    await removeForm();
  });

  it('can submit a form with Choice field', async function() {
    const formUrl = await createFormWith('Choice');
    // Add some options.
    await gu.openColumnPanel();

    await gu.choicesEditor.edit();
    await gu.choicesEditor.add('Foo');
    await gu.choicesEditor.add('Bar');
    await gu.choicesEditor.add('Baz');
    await gu.choicesEditor.save();
    await gu.toggleSidePanel('right', 'close');

    // We need to press preview, as form is not saved yet.
    await gu.scrollActiveViewTop();
    await gu.waitToPass(async () => {
      assert.isTrue(await driver.find('.test-forms-preview').isDisplayed());
    });
    // We are in a new window.
    await gu.onNewTab(async () => {
      await driver.get(formUrl);
      // Make sure options are there.
      assert.deepEqual(await driver.findAll('select[name="D"] option', e => e.getText()), ['Foo', 'Bar', 'Baz']);
      await driver.findWait('select[name="D"]', 1000).click();
      await driver.find("option[value='Bar']").click();
      await driver.find('input[type="submit"]').click();
      await waitForConfirm();
    });
    await expectSingle('Bar');
    await removeForm();
  });

  it('can submit a form with Integer field', async function() {
    const formUrl = await createFormWith('Integer', true);
    // We are in a new window.
    await gu.onNewTab(async () => {
      await driver.get(formUrl);
      await driver.findWait('input[name="D"]', 1000).click();
      await gu.sendKeys('1984');
      await driver.find('input[type="submit"]').click();
      await waitForConfirm();
    });
    // Make sure we see the new record.
    await expectSingle(1984);
    await removeForm();
  });

  it('can submit a form with Toggle field', async function() {
    const formUrl = await createFormWith('Toggle', true);
    // We are in a new window.
    await gu.onNewTab(async () => {
      await driver.get(formUrl);
      await driver.findWait('input[name="D"]', 1000).findClosest("label").click();
      await driver.find('input[type="submit"]').click();
      await waitForConfirm();
    });
    await expectSingle(true);
    await gu.onNewTab(async () => {
      await driver.get(formUrl);
      await driver.find('input[type="submit"]').click();
      await waitForConfirm();
    });
    await expect([true, false]);

    // Remove the additional record added just now.
    await gu.sendActions([
      ['RemoveRecord', 'Table1', 2],
    ]);
    await removeForm();
  });

  it('can submit a form with ChoiceList field', async function() {
    const formUrl = await createFormWith('Choice List', true);
    // Add some options.
    await gu.openColumnPanel();

    await gu.choicesEditor.edit();
    await gu.choicesEditor.add('Foo');
    await gu.choicesEditor.add('Bar');
    await gu.choicesEditor.add('Baz');
    await gu.choicesEditor.save();
    await gu.toggleSidePanel('right', 'close');
    // We are in a new window.
    await gu.onNewTab(async () => {
      await driver.get(formUrl);
      await driver.findWait('input[name="D[]"][value="Foo"]', 1000).click();
      await driver.findWait('input[name="D[]"][value="Baz"]', 1000).click();
      await driver.find('input[type="submit"]').click();
      await waitForConfirm();
    });
    await expectSingle(['L', 'Foo', 'Baz']);

    await removeForm();
  });

  it('can unpublish forms', async function() {
    const formUrl = await createFormWith('Text');
    await driver.find('.test-forms-unpublish').click();
    await driver.find('.test-modal-confirm').click();
    await gu.waitForServer();
    await gu.onNewTab(async () => {
      await driver.get(formUrl);
      assert.match(
        await driver.findWait('.test-error-header', 2000).getText(),
        /Something went wrong/
      );
      assert.match(
        await driver.findWait('.test-error-content', 2000).getText(),
        /There was an error: Form not published\./
      );
    });

    // Republish the form and check that the same URL works again.
    await driver.find('.test-forms-publish').click();
    await driver.find('.test-modal-confirm').click();
    await gu.waitForServer();
    await gu.onNewTab(async () => {
      await driver.get(formUrl);
      await driver.findWait('input[name="D"]', 1000);
    });
  });

  it('can create a form for a blank table', async function() {

    // Add new page and select form.
    await gu.addNewPage('Form', 'New Table', {
      tableName: 'Form'
    });

    // Make sure we see a form editor.
    assert.isTrue(await driver.find('.test-forms-editor').isDisplayed());

    // With 3 questions A, B, C.
    assert.deepEqual(await readLabels(), ['A', 'B', 'C']);

    // And a submit button.
    assert.isTrue(await driver.findContent('.test-forms-submit', gu.exactMatch('Submit')).isDisplayed());
  });

  it('doesnt generates fields when they are added', async function() {
    await gu.sendActions([
      ['AddVisibleColumn', 'Form', 'Choice',
        {type: 'Choice', widgetOption: JSON.stringify({choices: ['A', 'B', 'C']})}],
    ]);

    // Make sure we see a form editor.
    assert.isTrue(await driver.find('.test-forms-editor').isDisplayed());
    await driver.sleep(100);
    assert.isFalse(
      await driver.findContent('.test-forms-question-choice .test-forms-label', gu.exactMatch('Choice')).isPresent()
    );
  });

  it('supports basic drag and drop', async function() {

    // Make sure the order is right.
    assert.deepEqual(
      await readLabels(), ['A', 'B', 'C']
    );

    await driver.withActions(a =>
      a.move({origin: questionDrag('B')})
        .press()
        .move({origin: questionDrag('A')})
        .release()
    );

    await gu.waitForServer();

    // Make sure the order is right.
    assert.deepEqual(
      await readLabels(), ['B', 'A', 'C']
    );

    await driver.withActions(a =>
      a.move({origin: questionDrag('C')})
        .press()
        .move({origin: questionDrag('B')})
        .release()
    );

    await gu.waitForServer();

    // Make sure the order is right.
    assert.deepEqual(
      await readLabels(), ['C', 'B', 'A']
    );

    // Now move A on A and make sure nothing changes.
    await driver.withActions(a =>
      a.move({origin: questionDrag('A')})
        .press()
        .move({origin: questionDrag('A'), x: 50})
        .release()
    );

    await gu.waitForServer();
    assert.deepEqual(await readLabels(), ['C', 'B', 'A']);
  });

  it('can undo drag and drop', async function() {
    await gu.undo();
    assert.deepEqual(await readLabels(), ['B', 'A', 'C']);

    await gu.undo();
    assert.deepEqual(await readLabels(), ['A', 'B', 'C']);
  });

  it('adds new question at the end', async function() {
    // We should see single drop zone.
    assert.equal((await drops()).length, 1);

    // Move the A over there.
    await driver.withActions(a =>
      a.move({origin: questionDrag('A')})
        .press()
        .move({origin: plusButton().drag()})
        .release()
    );

    await gu.waitForServer();
    assert.deepEqual(await readLabels(), ['B', 'C', 'A']);
    await gu.undo();
    assert.deepEqual(await readLabels(), ['A', 'B', 'C']);

    // Now add a new question.
    await plusButton().click();

    await clickMenu('Text');
    await gu.waitForServer();

    // We should have new column D or type text.
    assert.deepEqual(await readLabels(), ['A', 'B', 'C', 'D']);
    assert.equal(await questionType('D'), 'Text');

    await gu.undo();
    assert.deepEqual(await readLabels(), ['A', 'B', 'C']);
  });

  it('adds question in the middle', async function() {
    await driver.withActions(a => a.contextClick(question('B')));
    await clickMenu('Insert question above');
    await gu.waitForServer();
    assert.deepEqual(await readLabels(), ['A', 'D', 'B', 'C']);

    // Now below C.
    await driver.withActions(a => a.contextClick(question('B')));
    await clickMenu('Insert question below');
    await gu.waitForServer();
    assert.deepEqual(await readLabels(), ['A', 'D', 'B', 'E', 'C']);

    // Make sure they are draggable.
    // Move D infront of C.
    await driver.withActions(a =>
      a.move({origin: questionDrag('D')})
        .press()
        .move({origin: questionDrag('C')})
        .release()
    );

    await gu.waitForServer();
    assert.deepEqual(await readLabels(), ['A', 'B', 'E', 'D', 'C']);

    // Remove 3 times.
    await gu.undo(3);
    assert.deepEqual(await readLabels(), ['A', 'B', 'C']);
  });

  it('selection works', async function() {

    // Click on A.
    await question('A').click();

    // Now A is selected.
    assert.equal(await selectedLabel(), 'A');

    // Click B.
    await question('B').click();

    // Now B is selected.
    assert.equal(await selectedLabel(), 'B');

    // Click on the edit button.
    await driver.find('.test-forms-submit').click();

    // Now nothing is selected.
    assert.isFalse(await isSelected(), 'Something is selected');

    // When we add new question, it is automatically selected.
    await plusButton().click();
    await clickMenu('Text');
    await gu.waitForServer();
    // Now D is selected.
    assert.equal(await selectedLabel(), 'D');

    await gu.undo();
    assert.deepEqual(await readLabels(), ['A', 'B', 'C']);
    await question('A').click();
  });

  it('hiding and revealing works', async function() {
    await gu.toggleSidePanel('left', 'close');
    await gu.openWidgetPanel();

    // We have only one hidden column.
    assert.deepEqual(await hiddenColumns(), ['Choice']);

    // Make sure we see it in the menu.
    await plusButton().click();

    // We have 1 unmapped menu item.
    assert.equal(await elementCount('menu-unmapped'), 1);

    // Now move it to the form on B
    await driver.withActions(a =>
      a.move({origin: hiddenColumn('Choice')})
        .press()
        .move({origin: questionDrag('B')})
        .release()
    );
    await gu.waitForServer();

    // It should be after A.
    await gu.waitToPass(async () => {
      assert.deepEqual(await readLabels(), ['A', 'Choice', 'B', 'C']);
    }, 500);

    // Undo to make sure it is bundled.
    await gu.undo();

    // It should be hidden again.
    assert.deepEqual(await hiddenColumns(), ['Choice']);
    assert.deepEqual(await readLabels(), ['A', 'B', 'C']);

    // And redo.
    await gu.redo();
    assert.deepEqual(await readLabels(), ['A', 'Choice', 'B', 'C']);
    assert.deepEqual(await hiddenColumns(), []);


    // Now hide it using menu.
    await question('Choice').rightClick();
    await clickMenu('Hide');
    await gu.waitForServer();

    // It should be hidden again.
    assert.deepEqual(await hiddenColumns(), ['Choice']);
    assert.deepEqual(await readLabels(), ['A', 'B', 'C']);

    // And undo.
    await gu.undo();
    assert.deepEqual(await readLabels(), ['A', 'Choice', 'B', 'C']);
    assert.deepEqual(await hiddenColumns(), []);

    // And redo.
    await gu.redo();
    assert.deepEqual(await readLabels(), ['A', 'B', 'C']);
    assert.deepEqual(await hiddenColumns(), ['Choice']);

    // Now unhide it using menu.
    await plusButton().click();
    await element('menu-unmapped').click();
    await gu.waitForServer();

    assert.deepEqual(await readLabels(), ['A', 'B', 'C', 'Choice']);
    assert.deepEqual(await hiddenColumns(), []);

    // Now hide it using Delete key.
    await driver.find('.test-forms-submit').click();
    await question('Choice').click();
    await gu.sendKeys(Key.DELETE);
    await gu.waitForServer();

    // It should be hidden again.
    assert.deepEqual(await hiddenColumns(), ['Choice']);
    assert.deepEqual(await readLabels(), ['A', 'B', 'C']);


    await gu.toggleSidePanel('right', 'close');
  });

  it('basic keyboard navigation works', async function() {
    await question('A').click();
    assert.equal(await selectedLabel(), 'A');

    // Move down.
    await arrow(Key.ARROW_DOWN);
    assert.equal(await selectedLabel(), 'B');

    // Move up.
    await arrow(Key.ARROW_UP);
    assert.equal(await selectedLabel(), 'A');

    // Move down to C.
    await arrow(Key.ARROW_DOWN, 2);
    assert.equal(await selectedLabel(), 'C');

    // Move down we should be at A (past the submit button, and titles and sections).
    await arrow(Key.ARROW_DOWN, 7);
    assert.equal(await selectedLabel(), 'A');

    // Do the same with Left and Right.
    await arrow(Key.ARROW_RIGHT);
    assert.equal(await selectedLabel(), 'B');
    await arrow(Key.ARROW_LEFT);
    assert.equal(await selectedLabel(), 'A');
    await arrow(Key.ARROW_RIGHT, 2);
    assert.equal(await selectedLabel(), 'C');
  });

  it('cutting works', async function() {
    const revert = await gu.begin();
    await question('A').click();
    // Send copy command.
    await clipboard.lockAndPerform(async (cb) => {
      await cb.cut();
      await gu.sendKeys(Key.ARROW_DOWN); // Focus on B.
      await gu.sendKeys(Key.ARROW_DOWN); // Focus on C.
      await cb.paste();
    });
    await gu.waitForServer();
    assert.deepEqual(await readLabels(), ['B', 'A', 'C']);
    await gu.undo();
    assert.deepEqual(await readLabels(), ['A', 'B', 'C']);

    // To the same for paragraph.
    await plusButton().click();
    await clickMenu('Paragraph');
    await gu.waitForServer();
    await element('Paragraph', 5).click();
    await clipboard.lockAndPerform(async (cb) => {
      await cb.cut();
      // Go over A and paste there.
      await gu.sendKeys(Key.ARROW_UP); // Focus on C.
      await gu.sendKeys(Key.ARROW_UP); // Focus on B.
      await gu.sendKeys(Key.ARROW_UP); // Focus on A.
      await cb.paste();
    });
    await gu.waitForServer();

    // Paragraph should be the first one now.
    assert.deepEqual(await readLabels(), ['A', 'B', 'C']);
    let elements = await driver.findAll('.test-forms-element');
    assert.isTrue(await elements[0].matches('.test-forms-Paragraph'));
    assert.isTrue(await elements[1].matches('.test-forms-Paragraph'));
    assert.isTrue(await elements[2].matches('.test-forms-Section'));
    assert.isTrue(await elements[3].matches('.test-forms-Paragraph'));
    assert.isTrue(await elements[4].matches('.test-forms-Paragraph'));
    assert.isTrue(await elements[5].matches('.test-forms-Paragraph'));

    // Put it back using undo.
    await gu.undo();
    elements = await driver.findAll('.test-forms-element');
    assert.isTrue(await elements[5].matches('.test-forms-Field'));
    // 0 - A, 1 - B, 2 - C, 3 - submit button.
    assert.isTrue(await elements[8].matches('.test-forms-Paragraph'));

    await revert();
  });

  const checkInitial = async () => assert.deepEqual(await readLabels(), ['A', 'B', 'C']);
  const checkNewCol = async () => {
    assert.equal(await selectedLabel(), 'D');
    assert.deepEqual(await readLabels(), ['A', 'B', 'C', 'D']);
    await gu.undo();
    await checkInitial();
  };
  const checkFieldsAtFirstLevel = (menuText: string) => {
    it(`can add ${menuText} elements from the menu`, async function() {
      await plusButton().click();
      await clickMenu(menuText);
      await gu.waitForServer();
      await checkNewCol();
    });
  };

  checkFieldsAtFirstLevel('Text');
  checkFieldsAtFirstLevel('Numeric');
  checkFieldsAtFirstLevel('Date');
  checkFieldsAtFirstLevel('Choice');

  const checkFieldInMore = (menuText: string) => {
    it(`can add ${menuText} elements from the menu`, async function() {
      await plusButton().click();
      await clickMenu('More');
      await clickMenu(menuText);
      await gu.waitForServer();
      await checkNewCol();
    });
  };

  checkFieldInMore('Integer');
  checkFieldInMore('Toggle');
  checkFieldInMore('DateTime');
  checkFieldInMore('Choice List');
  checkFieldInMore('Reference');
  checkFieldInMore('Reference List');

  const testStruct = (type: string, existing = 0) => {
    it(`can add structure ${type} element`, async function() {
      assert.equal(await elementCount(type), existing);
      await plusButton().click();
      await clickMenu(type);
      await gu.waitForServer();
      assert.equal(await elementCount(type), existing + 1);
      await gu.undo();
      assert.equal(await elementCount(type), existing);
    });
  };

  // testStruct('Section'); // There is already a section
  testStruct('Columns');
  testStruct('Paragraph', 4);

  it('basic section', async function() {
    const revert = await gu.begin();

    // Adding section is disabled for now, so this test is altered to use the existing section.
    // await drop().click();
    // await clickMenu('Section');
    // await gu.waitForServer();
    assert.equal(await elementCount('Section'), 1);

    assert.deepEqual(await readLabels(), ['A', 'B', 'C']);

    // There is a drop in that section, click it to add a new question.
    await element('Section', 1).element('plus').click();
    await clickMenu('Text');
    await gu.waitForServer();

    assert.deepEqual(await readLabels(), ['A', 'B', 'C', 'D']);

    // And the question is inside a section.
    assert.equal(await element('Section', 1).element('label', 4).value(), 'D');

    // Make sure we can move that question around.
    await driver.withActions(a =>
      a.move({origin: questionDrag('D')})
        .press()
        .move({origin: questionDrag('B')})
        .release()
    );

    await gu.waitForServer();
    assert.deepEqual(await readLabels(), ['A', 'D', 'B', 'C']);

    // Make sure that it is not inside the section anymore.
    // assert.equal(await element('Section', 1).element('label').isPresent(), false);

    await gu.undo();
    assert.deepEqual(await readLabels(), ['A', 'B', 'C', 'D']);
    assert.equal(await element('Section', 1).element('label', 4).value(), 'D');

    await revert();
    assert.deepEqual(await readLabels(), ['A', 'B', 'C']);
  });

  it('basic columns work', async function() {
    const revert = await gu.begin();
    await plusButton().click();
    await clickMenu('Columns');
    await gu.waitForServer();

    // We have two placeholders for free.
    assert.equal(await elementCount('Placeholder', element('Columns')), 2);

    // We can add another placeholder
    await element('add').click();
    await gu.waitForServer();

    // Now we have 3 placeholders.
    assert.equal(await elementCount('Placeholder', element('Columns')), 3);

    // We can click the middle one, and add a question.
    await element('Columns').element(`Placeholder`, 2).click();
    await clickMenu('Text');
    await gu.waitForServer();

    // Now we have 2 placeholders
    assert.equal(await elementCount('Placeholder', element('Columns')), 2);
    // And 4 questions.
    assert.deepEqual(await readLabels(), ['A', 'B', 'C', 'D']);

    // The question D is in the columns.
    assert.equal(await element('Columns').element('label').value(), 'D');

    // We can move it around.
    await driver.withActions(a =>
      a.move({origin: questionDrag('D')})
        .press()
        .move({origin: questionDrag('B')})
        .release()
    );
    await gu.waitForServer();
    assert.deepEqual(await readLabels(), ['A', 'D', 'B', 'C']);

    // And move it back.
    await driver.withActions(a =>
      a.move({origin: questionDrag('D')})
        .press()
        .move({origin: element('Columns').element(`Placeholder`, 2).find(`.test-forms-drag`)})
        .release()
    );
    await gu.waitForServer();
    assert.deepEqual(await readLabels(), ['A', 'B', 'C', 'D']);

    let allColumns = await driver.findAll('.test-forms-column');

    assert.lengthOf(allColumns, 3);
    assert.isTrue(await allColumns[0].matches('.test-forms-Placeholder'));
    assert.isTrue(await allColumns[1].matches('.test-forms-question'));
    assert.equal(await allColumns[1].find('.test-forms-label').value(), 'D');
    assert.isTrue(await allColumns[2].matches('.test-forms-Placeholder'));

    // Check that we can remove the question.
    await question('D').rightClick();
    await clickMenu('Hide');
    await gu.waitForServer();

    // Now we have 3 placeholders.
    assert.equal(await elementCount('Placeholder', element('Columns')), 3);
    assert.deepEqual(await readLabels(), ['A', 'B', 'C']);

    // Undo and check it goes back at the right place.
    await gu.undo();
    assert.deepEqual(await readLabels(), ['A', 'B', 'C', 'D']);

    allColumns = await driver.findAll('.test-forms-column');
    assert.lengthOf(allColumns, 3);
    assert.isTrue(await allColumns[0].matches('.test-forms-Placeholder'));
    assert.isTrue(await allColumns[1].matches('.test-forms-question'));
    assert.equal(await allColumns[1].find('.test-forms-label').value(), 'D');
    assert.isTrue(await allColumns[2].matches('.test-forms-Placeholder'));

    await revert();
    assert.lengthOf(await driver.findAll('.test-forms-column'), 0);
    assert.deepEqual(await readLabels(), ['A', 'B', 'C']);
  });

  it('changes type of a question', async function() {
    // Add text question as D column.
    await plusButton().click();
    await clickMenu('Text');
    await gu.waitForServer();
    assert.deepEqual(await readLabels(), ['A', 'B', 'C', 'D']);

    // Make sure it is a text question.
    assert.equal(await questionType('D'), 'Text');

    // Now change it to a choice, from the backend (as the UI is not clear here).
    await gu.sendActions([
      ['ModifyColumn', 'Form', 'D', {type: 'Choice', widgetOptions: JSON.stringify({choices: ['A', 'B', 'C']})}],
    ]);

    // Make sure it is a choice question.
    await gu.waitToPass(async () => {
      assert.equal(await questionType('D'), 'Choice');
    });

    // Now change it back to a text question.
    await gu.undo();
    await gu.waitToPass(async () => {
      assert.equal(await questionType('D'), 'Text');
    });

    await gu.redo();
    await gu.waitToPass(async () => {
      assert.equal(await questionType('D'), 'Choice');
    });

    await gu.undo(2);
    await gu.waitToPass(async () => {
      assert.deepEqual(await readLabels(), ['A', 'B', 'C']);
    });
  });
});

function element(type: string, parent?: WebElement): ExtraElement;
function element(type: string, index: number, parent?: WebElement): ExtraElement;
function element(type: string, arg1?: number | WebElement, arg2?: WebElement): ExtraElement {
  if (typeof arg1 === 'number') {
    if (arg1 === 1) {
      return extra((arg2 ?? driver).find(`.test-forms-${type}`));
    }
    const nth = ((arg2 ?? driver).findAll(`.test-forms-${type}`).then(els => els[arg1 - 1])).then(el => {
      if (!el) { throw new Error(`No element of type ${type} at index ${arg1}`); }
      return el;
    });
    return extra(new WebElementPromise(driver, nth));
  } else {
    return extra((arg1 ?? driver).find(`.test-forms-${type}`));
  }
}

async function elementCount(type: string, parent?: WebElement) {
  return await (parent ?? driver).findAll(`.test-forms-${type}`).then(els => els.length);
}

async function readLabels() {
  return await driver.findAll('.test-forms-question .test-forms-label', el => el.value());
}

function question(label: string) {
  return extra(gu.findValue(`.test-forms-label`, label).findClosest('.test-forms-editor'));
}

function questionDrag(label: string) {
  return question(label).find('.test-forms-drag');
}

function questionType(label: string) {
  return question(label).find('.test-forms-type').value();
}

function plusButton() {
  return element('plus');
}

function drops() {
  return driver.findAll('.test-forms-plus');
}

async function clickMenu(label: string) {
  // First try command as it will also contain the keyboard shortcut we need to discard.
  if (await driver.findContent('.grist-floating-menu li .test-cmd-name', gu.exactMatch(label)).isPresent()) {
    return driver.findContent('.grist-floating-menu li .test-cmd-name', gu.exactMatch(label)).click();
  }
  return driver.findContentWait('.grist-floating-menu li', gu.exactMatch(label), 100).click();
}

function isSelected() {
  return driver.findAll('.test-forms-field-editor-selected').then(els => els.length > 0);
}

function selected() {
  return driver.find('.test-forms-field-editor-selected');
}

function selectedLabel() {
  return selected().find('.test-forms-label').value();
}

function hiddenColumns() {
  return driver.findAll('.test-vfc-hidden-field', e => e.getText());
}

function hiddenColumn(label: string) {
  return driver.findContent('.test-vfc-hidden-field', gu.exactMatch(label));
}

type ExtraElement = WebElementPromise & {
  rightClick: () => Promise<void>,
  element: (type: string, index?: number) => ExtraElement,
  /**
   * A draggable element inside. This is 2x2px div to help with drag and drop.
   */
  drag: () => WebElementPromise,
};

function extra(el: WebElementPromise): ExtraElement {
  const webElement: any = el;

  webElement.rightClick = async function() {
    await driver.withActions(a => a.contextClick(webElement));
  };

  webElement.element = function(type: string, index?: number) {
    return element(type, index ?? 1, webElement);
  };

  webElement.drag = function() {
    return webElement.find('.test-forms-drag');
  };

  return webElement;
}

async function arrow(key: string, times: number = 1) {
  for (let i = 0; i < times; i++) {
    await gu.sendKeys(key);
  }
}
