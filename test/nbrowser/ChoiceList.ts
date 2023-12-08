import {assert, driver, Key, stackWrapFunc, WebElement} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

const normalFont = { bold: false, underline: false, italic: false, strikethrough: false};
const bold = true;
const underline = true;
const italic = true;
const strikethrough = true;

function getEditorTokens() {
  return driver.findAll('.cell_editor .test-tokenfield .test-tokenfield-token', el => el.getText());
}

function getEditorTokenStyles() {
  return driver.findAll(
    '.cell_editor .test-tokenfield .test-tokenfield-token',
    async el => {
      const classList = await el.getAttribute("class");
      return {
        fillColor: await el.getCssValue('background-color'),
        textColor: await el.getCssValue('color'),
        boxShadow: await el.getCssValue('box-shadow'),
        bold: classList.includes("font-bold"),
        italic: classList.includes("font-italic"),
        underline: classList.includes("font-underline"),
        strikethrough: classList.includes("font-strikethrough"),
      };
    }
  );
}

function getCellTokens(cell: WebElement) {
  return cell.getText();
}

function getCellTokenStyles(cell: WebElement) {
  return cell.findAll(
    '.test-choice-list-cell-token',
    async el => {
      const classList = await el.getAttribute("class");
      return {
        fillColor: await el.getCssValue('background-color'),
        textColor: await el.getCssValue('color'),
        boxShadow: await el.getCssValue('box-shadow'),
        bold: classList.includes("font-bold"),
        italic: classList.includes("font-italic"),
        underline: classList.includes("font-underline"),
        strikethrough: classList.includes("font-strikethrough"),
      };
    }
  );
}

function getChoiceLabels() {
  return driver.findAll('.test-right-panel .test-choice-list-entry-label', el => el.getText());
}

function getChoiceColors() {
  return driver.findAll(
    '.test-right-panel .test-choice-list-entry-color',
    el => el.getCssValue('background-color')
  );
}

function getEditModeChoiceLabels() {
  return driver.findAll('.test-right-panel .test-tokenfield-token input', el => el.value());
}

function getEditModeFillColors() {
  return driver.findAll(
    '.test-right-panel .test-tokenfield-token .test-color-button',
    el => el.getCssValue('background-color')
  );
}

function getEditModeTextColors() {
  return driver.findAll(
    '.test-right-panel .test-tokenfield-token .test-color-button',
    el => el.getCssValue('color')
  );
}

function getEditModeFontOptions() {
  return driver.findAll(
    '.test-right-panel .test-tokenfield-token .test-color-button',
    async el => {
      const classes = await el.getAttribute("class");
      const options: any = {};
      if (classes.includes("font-bold")) {
        options['bold'] = true;
      }
      if (classes.includes("font-underline")) {
        options['underline'] = true;
      }
      if (classes.includes("font-italic")) {
        options['italic'] = true;
      }
      if (classes.includes("font-strikethrough")) {
        options['strikethrough'] = true;
      }
      return options;
    }
  );
}

function getEditorTokensIsInvalid() {
  return driver.findAll('.cell_editor .test-tokenfield .test-tokenfield-token', el => el.matches('[class*=-invalid]'));
}

function getEditorInput() {
  return driver.find('.cell_editor .test-tokenfield .test-tokenfield-input');
}

async function editChoiceEntries() {
  await driver.find(".test-choice-list-entry").click();
  await gu.waitAppFocus(false);
}

async function renameEntry(from: string, to: string) {
  await clickEntry(from);
  await gu.sendKeys(to);
  await gu.sendKeys(Key.ENTER);
}


async function clickEntry(label: string) {
  const entry = await driver.findWait(`.test-choice-list-entry .test-token-label[value='${label}']`, 100);
  await entry.click();
}

async function saveChoiceEntries() {
  await driver.find(".test-choice-list-entry-save").click();
  await gu.waitForServer();
}

describe('ChoiceList', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();
  const clipboard = gu.getLockableClipboard();

  const WHITE_FILL = 'rgba(255, 255, 255, 1)';
  const UNSET_FILL = WHITE_FILL;
  const INVALID_FILL = WHITE_FILL;
  const DEFAULT_FILL = 'rgba(232, 232, 232, 1)';
  const GREEN_FILL = 'rgba(225, 254, 222, 1)';
  const DARK_GREEN_FILL = 'rgba(18, 110, 14, 1)';
  const BLUE_FILL = 'rgba(204, 254, 254, 1)';
  const BLACK_FILL = 'rgba(0, 0, 0, 1)';
  const BLACK_TEXT = 'rgba(0, 0, 0, 1)';
  const WHITE_TEXT = 'rgba(255, 255, 255, 1)';
  const APRICOT_FILL = 'rgba(254, 204, 129, 1)';
  const APRICOT_TEXT = 'rgba(70, 13, 129, 1)';
  const DEFAULT_TEXT = BLACK_TEXT;
  const INVALID_TEXT = BLACK_TEXT;
  const VALID_CHOICE = {
    boxShadow: 'none',
    ...normalFont,
  };
  const INVALID_CHOICE = {
    fillColor: INVALID_FILL,
    textColor: INVALID_TEXT,
    boxShadow: 'rgb(208, 2, 27) 0px 0px 0px 1px inset',
    ...normalFont,
  };

  afterEach(() => gu.checkForErrors());

  it('should support basic editing', async () => {
    const mainSession = await gu.session().teamSite.login();
    const api = mainSession.createHomeApi();
    const docId = await mainSession.tempNewDoc(cleanup, 'FormulaCounts', {load: true});

    // Make a ChoiceList column and add some data.
    await api.applyUserActions(docId, [
      ['ModifyColumn', 'Table1', 'B', {
        type: 'ChoiceList',
        widgetOptions: JSON.stringify({
          choices: ['Green', 'Blue', 'Black'],
          choiceOptions: {
            'Green': {
              fillColor: '#e1fede',
              textColor: '#000000',
              fontBold: true
            },
            'Blue': {
              fillColor: '#ccfefe',
              textColor: '#000000'
            },
            'Black': {
              fillColor: '#000000',
              textColor: '#ffffff'
            }
          }
        })
      }],
      ['BulkAddRecord', 'Table1', [null, null, null], {}],
    ]);

    // Enter by typing into an empty cell: valid value, invalue value, then check the editor.
    await gu.getCell({rowNum: 1, col: 'B'}).click();
    await driver.sendKeys('Gre', Key.ENTER);
    await driver.sendKeys('fake', Key.ENTER);
    assert.deepEqual(await getEditorTokens(), ['Green', 'fake']);
    assert.deepEqual(await getEditorTokensIsInvalid(), [false, true]);
    assert.deepEqual(
      await getEditorTokenStyles(),
      [
        {fillColor: GREEN_FILL, textColor: BLACK_TEXT, ...VALID_CHOICE, bold},
        INVALID_CHOICE,
      ]
    );

    // Escape to cancel; check nothing got saved.
    await driver.sendKeys(Key.ESCAPE);
    await gu.waitForServer();
    assert.equal(await driver.find('.cell_editor').isPresent(), false);
    assert.equal(await gu.getCell({rowNum: 1, col: 'B'}).getText(), '');

    // Type invalid value, then select from dropdown valid
    await gu.getCell({rowNum: 1, col: 'B'}).click();
    await driver.sendKeys('fake', Key.ENTER);
    await getEditorInput().click();
    const blueChoice = await driver.findContent('.test-autocomplete li', /Blue/);
    assert.equal(
      await blueChoice.find('.test-choice-list-editor-item-label').getCssValue('background-color'),
      BLUE_FILL
    );
    assert.equal(
      await blueChoice.find('.test-choice-list-editor-item-label').getCssValue('color'),
      BLACK_TEXT
    );
    await blueChoice.click();

    // Type another valid, check what's in editor
    await driver.sendKeys('black', Key.ENTER);
    assert.deepEqual(await getEditorTokens(), ['fake', 'Blue', 'Black']);
    assert.deepEqual(await getEditorTokensIsInvalid(), [true, false, false]);
    assert.deepEqual(
      await getEditorTokenStyles(),
      [
        INVALID_CHOICE,
        {fillColor: BLUE_FILL, textColor: BLACK_TEXT, ...VALID_CHOICE},
        {fillColor: BLACK_FILL, textColor: WHITE_TEXT, ...VALID_CHOICE}
      ]
    );

    // Enter to save; check values got saved.
    await driver.sendKeys(Key.ENTER);
    await gu.waitForServer();
    assert.equal(await driver.find('.cell_editor').isPresent(), false);
    assert.equal(await getCellTokens(await gu.getCell({rowNum: 1, col: 'B'})), 'fake\nBlue\nBlack');
    assert.deepEqual(
      await getCellTokenStyles(await gu.getCell({rowNum: 1, col: 'B'})),
      [
        INVALID_CHOICE,
        {fillColor: BLUE_FILL, textColor: BLACK_TEXT, ...VALID_CHOICE},
        {fillColor: BLACK_FILL, textColor: WHITE_TEXT, ...VALID_CHOICE}
      ]
    );

    // Enter to edit. Enter token, remove two tokens, with a key and with an x-click.
    await gu.getCell({rowNum: 1, col: 'B'}).click();
    await driver.sendKeys(Key.ENTER);
    assert.deepEqual(await getEditorTokens(), ['fake', 'Blue', 'Black']);
    await driver.sendKeys('Gre', Key.TAB);
    assert.deepEqual(await getEditorTokens(), ['fake', 'Blue', 'Black', 'Green']);
    await driver.sendKeys(Key.LEFT, Key.LEFT, Key.BACK_SPACE);
    assert.deepEqual(await getEditorTokens(), ['fake', 'Blue', 'Green']);
    const tok1 = driver.findContent('.cell_editor .test-tokenfield .test-tokenfield-token', /fake/);
    await tok1.mouseMove();
    await tok1.find('.test-tokenfield-delete').click();
    assert.deepEqual(await getEditorTokens(), ['Blue', 'Green']);

    // Enter to save; check values got saved.
    await driver.sendKeys(Key.ENTER);
    await gu.waitForServer();
    assert.equal(await driver.find('.cell_editor').isPresent(), false);
    assert.equal(await getCellTokens(gu.getCell({rowNum: 1, col: 'B'})), 'Blue\nGreen');

    // Start typing to replace content with a token; check values.
    await gu.getCell({rowNum: 1, col: 'B'}).click();
    await driver.sendKeys('foo');
    assert.deepEqual(await getEditorTokens(), []);
    assert.equal(await getEditorInput().value(), 'foo');
    await driver.sendKeys(Key.TAB);
    assert.deepEqual(await getEditorTokens(), ['foo']);

    // Escape to cancel; check nothing got saved.
    await driver.sendKeys(Key.ESCAPE);
    await gu.waitForServer();
    assert.equal(await driver.find('.cell_editor').isPresent(), false);
    assert.equal(await gu.getCell({rowNum: 1, col: 'B'}).getText(), 'Blue\nGreen');

    // Double-click to open dropdown and select a token.
    await driver.withActions(a => a.doubleClick(gu.getCell({rowNum: 1, col: 'B'})));
    await driver.findContent('.test-autocomplete li', /Black/).click();
    assert.deepEqual(await getEditorTokens(), ['Blue', 'Green', 'Black']);

    // Click away to save: new token should be added.
    await gu.getCell({rowNum: 2, col: 'B'}).click();
    await gu.waitForServer();
    assert.equal(await driver.find('.cell_editor').isPresent(), false);
    assert.equal(await gu.getCell({rowNum: 1, col: 'B'}).getText(), 'Blue\nGreen\nBlack');


    // Starting to type names without accents should match the actual choices
    await gu.addColumn("Accents");
    await api.applyUserActions(docId, [
      ['ModifyColumn', 'Table1', 'Accents', {
        type: 'ChoiceList',
        widgetOptions: JSON.stringify({
          choices: ['Adélaïde', 'Adèle', 'Agnès', 'Amélie'],
        })
      }],
    ]);
    await gu.getCell({rowNum: 1, col: 'Accents'}).click();
    await driver.sendKeys('Ade', Key.ENTER);
    await driver.sendKeys('Agne', Key.ENTER);
    await driver.sendKeys('Ame', Key.ENTER);
    assert.deepEqual(await getEditorTokens(), ['Adélaïde', 'Agnès', 'Amélie']);
  });

  it('should be visible in formulas', async () => {
    // Add a formula that returns tokens reversed
    await gu.getCell({rowNum: 1, col: 'C'}).click();
    await gu.enterFormula('":".join($B)');

    // Check value
    assert.deepEqual(await gu.getVisibleGridCells({rowNums: [1, 2, 3], cols: ['B', 'C']}), [
      'Blue\nGreen\nBlack', 'Blue:Green:Black',
      '', '',
      '', '',
    ]);

    // Hit enter, click to delete a token, save.
    await gu.getCell({rowNum: 1, col: 'B'}).click();
    await driver.sendKeys(Key.ENTER);
    await driver.sendKeys(Key.BACK_SPACE);
    await driver.sendKeys(Key.ENTER);
    await gu.waitForServer();

    // Check formula got updated
    assert.deepEqual(await gu.getVisibleGridCells({rowNums: [1], cols: ['B', 'C']}), [
      'Blue\nGreen', 'Blue:Green',
    ]);

    // Type a couple new tokens.
    await gu.getCell({rowNum: 1, col: 'B'}).click();
    await driver.sendKeys(Key.ENTER);
    await driver.sendKeys('fake', Key.TAB, 'Bla', Key.TAB);

    // Enter to save; check formula got updated
    await driver.sendKeys(Key.ENTER);
    await gu.waitForServer();
    assert.deepEqual(await gu.getVisibleGridCells({rowNums: [1], cols: ['B', 'C']}), [
      'Blue\nGreen\nfake\nBlack', 'Blue:Green:fake:Black',
    ]);

    // Hit delete. ChoiceList cell and formula should clear.
    await gu.getCell({rowNum: 1, col: 'B'}).click();
    await driver.sendKeys(Key.DELETE);
    await gu.waitForServer();
    assert.deepEqual(await gu.getVisibleGridCells({rowNums: [1, 2, 3], cols: ['B', 'C']}), [
      '', '',
      '', '',
      '', '',
    ]);
  });

  it('should allow adding new values', async () => {
    // Check what choices are configured.
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-right-tab-field').click();
    assert.deepEqual(await getChoiceLabels(), ['Green', 'Blue', 'Black']);
    assert.deepEqual(
      await getChoiceColors(),
      [GREEN_FILL, BLUE_FILL, BLACK_FILL]
    );

    // Select a token from autocomplete
    const cell = gu.getCell({rowNum: 1, col: 'B'});
    assert.equal(await cell.getText(), '');
    await cell.click();
    await driver.sendKeys(Key.ENTER);
    await driver.findContent('.test-autocomplete li', /Green/).click();
    assert.deepEqual(await getEditorTokens(), ['Green']);

    // Type token that's not in autocomplete
    await driver.sendKeys("Orange");

    // Enter should add invalid token.
    await driver.sendKeys(Key.ENTER);
    assert.deepEqual(await getEditorTokens(), ['Green', 'Orange']);
    assert.deepEqual(await getEditorTokensIsInvalid(), [false, true]);

    // Type another token, and click the "+" button in autocomplete. New token should be valid.
    await driver.sendKeys("Apricot");
    const newChoice = await driver.find('.test-autocomplete .test-choice-list-editor-new-item');
    assert.equal(await newChoice.getText(), 'Apricot');
    assert.equal(
      await newChoice.find('.test-choice-list-editor-item-label').getCssValue('background-color'),
      DEFAULT_FILL
    );
    assert.equal(
      await newChoice.find('.test-choice-list-editor-item-label').getCssValue('color'),
      DEFAULT_TEXT
    );
    await driver.find('.test-autocomplete .test-choice-list-editor-new-item').click();
    assert.deepEqual(await getEditorTokens(), ['Green', 'Orange', 'Apricot']);
    assert.deepEqual(await getEditorTokensIsInvalid(), [false, true, false]);
    assert.deepEqual(
      await getEditorTokenStyles(),
      [
        {fillColor: GREEN_FILL, textColor: BLACK_TEXT, ...VALID_CHOICE, bold},
        INVALID_CHOICE,
        {fillColor: DEFAULT_FILL, textColor: DEFAULT_TEXT, ...VALID_CHOICE}
      ]
    );

    // Save: check tokens
    await driver.sendKeys(Key.ENTER);
    await gu.waitForServer();
    assert.equal(await getCellTokens(gu.getCell({rowNum: 1, col: 'B'})), 'Green\nOrange\nApricot');
    assert.deepEqual(
      await getCellTokenStyles(gu.getCell({rowNum: 1, col: 'B'})),
      [
        {fillColor: GREEN_FILL, textColor: BLACK_TEXT, ...VALID_CHOICE, bold},
        INVALID_CHOICE,
        {fillColor: DEFAULT_FILL, textColor: DEFAULT_TEXT, ...VALID_CHOICE}
      ]
    );

    // New option should be listed in config.
    assert.deepEqual(await getChoiceLabels(), ['Green', 'Blue', 'Black', 'Apricot']);
    assert.deepEqual(
      await getChoiceColors(),
      [GREEN_FILL, BLUE_FILL, BLACK_FILL, UNSET_FILL]
    );
  });

  const convertColumn = stackWrapFunc(async function(typeRe: RegExp) {
    await gu.setType(typeRe);
    await gu.waitForServer();
    await driver.findContent('.test-type-transform-apply', /Apply/).click();
    await gu.waitForServer();
  });

  it('should allow reasonable conversions between ChoiceList and other types', async function() {
    await gu.enterGridRows({rowNum: 1, col: 'A'},
      [['Hello'], ['World'], ['Foo,Bar;Baz!,"Qux, quux corge", "80\'s",']]);
    await testTextChoiceListConversions();
  });

  it('should allow ChoiceList conversions for column used in summary', async function() {
    // Add a widget with a summary on column A.
    await gu.addNewSection(/Table/, /Table1/, {dismissTips: true, summarize: [/^A$/]});
    await testTextChoiceListConversions();
    await gu.undo();
  });

  async function testTextChoiceListConversions() {
    await gu.getCell({section: 'TABLE1', rowNum: 3, col: 'A'}).click();

    // Convert this text column to ChoiceList.
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-right-tab-field').click();
    await convertColumn(/Choice List/);

    // Check that choices got populated.
    await driver.find('.test-right-tab-field').click();
    assert.deepEqual(await getChoiceLabels(), ['Hello', 'World', 'Foo', 'Bar;Baz!', 'Qux, quux corge', '80\'s']);
    assert.deepEqual(
      await getChoiceColors(),
      [UNSET_FILL, UNSET_FILL, UNSET_FILL, UNSET_FILL, UNSET_FILL, UNSET_FILL]
    );

    // Check that the result contains the right tags.
    assert.deepEqual(await gu.getVisibleGridCells({rowNums: [1, 2, 3], cols: ['A']}), [
      'Hello',
      'World',
      'Foo\nBar;Baz!\nQux, quux corge\n80\'s'
    ]);
    await gu.checkForErrors();

    // Check that the result contains the right colors.
    for (const rowNum of [1, 2]) {
      assert.deepEqual(
        await getCellTokenStyles(await gu.getCell({rowNum, col: 'A'})),
        [{fillColor: DEFAULT_FILL, textColor: DEFAULT_TEXT, ...VALID_CHOICE}]
      );
    }
    assert.deepEqual(
      await getCellTokenStyles(await gu.getCell({rowNum: 3, col: 'A'})),
      [
        {fillColor: DEFAULT_FILL, textColor: DEFAULT_TEXT, ...VALID_CHOICE},
        {fillColor: DEFAULT_FILL, textColor: DEFAULT_TEXT, ...VALID_CHOICE},
        {fillColor: DEFAULT_FILL, textColor: DEFAULT_TEXT, ...VALID_CHOICE},
        {fillColor: DEFAULT_FILL, textColor: DEFAULT_TEXT, ...VALID_CHOICE},
      ]
    );

    // Open a cell to see the actual tags.
    await gu.getCell({rowNum: 3, col: 'A'}).click();
    await driver.sendKeys(Key.ENTER);
    assert.deepEqual(await getEditorTokens(), ['Foo', 'Bar;Baz!', 'Qux, quux corge', '80\'s']);
    assert.deepEqual(await getEditorTokensIsInvalid(), [ false, false, false, false ]);
    assert.deepEqual(
      await getEditorTokenStyles(),
      [
        {fillColor: DEFAULT_FILL, textColor: DEFAULT_TEXT, ...VALID_CHOICE},
        {fillColor: DEFAULT_FILL, textColor: DEFAULT_TEXT, ...VALID_CHOICE},
        {fillColor: DEFAULT_FILL, textColor: DEFAULT_TEXT, ...VALID_CHOICE},
        {fillColor: DEFAULT_FILL, textColor: DEFAULT_TEXT, ...VALID_CHOICE}
      ]
    );
    await driver.sendKeys("hooray", Key.TAB, Key.ENTER);
    await gu.waitForServer();
    await gu.checkForErrors();

    // Convert back to text.
    await convertColumn(/Text/);

    // Check that values turn into comma-separated values.
    assert.deepEqual(await gu.getVisibleGridCells({rowNums: [1, 2, 3], cols: ['A']}), [
      'Hello',
      'World',
      'Foo, Bar;Baz!, "Qux, quux corge", 80\'s, hooray'
    ]);

    // Undo the cell change and both conversions (back to ChoiceList, back to Text), and check
    // that UNDO also works correctly and without errors.
    await gu.undo(3);
    assert.deepEqual(await gu.getVisibleGridCells({rowNums: [1, 2, 3], cols: ['A']}), [
      'Hello',
      'World',
      'Foo,Bar;Baz!,"Qux, quux corge", "80\'s",',   // That's the text originally entered into this Text cell.
    ]);
  }

  it('should keep choices when converting between Choice and ChoiceList', async function() {
    // Column B starts off as ChoiceList with the following choices.
    await gu.getCell({rowNum: 1, col: 'B'}).click();
    await driver.find('.test-right-tab-field').click();
    assert.deepEqual(await getChoiceLabels(), ['Green', 'Blue', 'Black', 'Apricot']);

    // Add some more values to this columm.
    await gu.getCell({rowNum: 2, col: 'B'}).click();
    await driver.sendKeys('Black', Key.ENTER, Key.ENTER);
    await gu.waitForServer();
    await driver.sendKeys('Green', Key.ENTER, Key.ENTER);
    await gu.waitForServer();
    assert.deepEqual(await gu.getVisibleGridCells({rowNums: [1, 2, 3], cols: ['B']}), [
      "Green\nOrange\nApricot",
      "Black",
      "Green",
    ]);

    // Convert to Choice. Configured Choices should stay the same.
    await convertColumn(/^Choice$/);
    assert.deepEqual(await getChoiceLabels(), ['Green', 'Blue', 'Black', 'Apricot']);
    assert.deepEqual(await getChoiceColors(), [GREEN_FILL, BLUE_FILL, BLACK_FILL, UNSET_FILL]);

    // Cells which contain multiple choices become CSVs.
    assert.deepEqual(await gu.getVisibleGridCells({rowNums: [1, 2, 3], cols: ['B']}), [
      "Green, Orange, Apricot",
      "Black",
      "Green",
    ]);
    const cell1 = gu.getCell('B', 1);
    assert.equal(await cell1.find('.field_clip').matches('.invalid'), false);
    assert.equal(await cell1.find('.test-choice-token').getCssValue('background-color'), INVALID_FILL);
    assert.equal(await cell1.find('.test-choice-token').getCssValue('color'), INVALID_TEXT);
    const cell2 = gu.getCell('B', 2);
    assert.equal(await cell2.find('.field_clip').matches('.invalid'), false);
    assert.equal(await cell2.find('.test-choice-token').getCssValue('background-color'), BLACK_FILL);
    assert.equal(await cell2.find('.test-choice-token').getCssValue('color'), WHITE_TEXT);

    // Convert back to ChoiceList. Choices should stay the same.
    await convertColumn(/Choice List/);
    assert.deepEqual(await getChoiceLabels(), ['Green', 'Blue', 'Black', 'Apricot']);
    assert.deepEqual(await getChoiceColors(), [GREEN_FILL, BLUE_FILL, BLACK_FILL, UNSET_FILL]);

    // Cell and editor data should be restored too.
    assert.deepEqual(await gu.getVisibleGridCells({rowNums: [1, 2, 3], cols: ['B']}), [
      "Green\nOrange\nApricot",
      "Black",
      "Green",
    ]);
    assert.deepEqual(
      await getCellTokenStyles(await gu.getCell({rowNum: 1, col: 'B'})),
      [
        {fillColor: GREEN_FILL, textColor: BLACK_TEXT, ...VALID_CHOICE, bold},
        INVALID_CHOICE,
        {fillColor: DEFAULT_FILL, textColor: DEFAULT_TEXT, ...VALID_CHOICE},
      ]
    );
    await gu.getCell({rowNum: 1, col: 'B'}).click();
    await driver.sendKeys(Key.ENTER);
    assert.deepEqual(await getEditorTokens(), ['Green', 'Orange', 'Apricot']);
    assert.deepEqual(await getEditorTokensIsInvalid(), [false, true, false]);
    assert.deepEqual(
      await getEditorTokenStyles(),
      [
        {fillColor: GREEN_FILL, textColor: BLACK_TEXT, ...VALID_CHOICE,  bold},
        INVALID_CHOICE,
        {fillColor: DEFAULT_FILL, textColor: DEFAULT_TEXT, ...VALID_CHOICE},
      ]
    );
    await driver.sendKeys(Key.ESCAPE);
  });

  it('should allow setting choice style', async function() {
    // Open the choice editor.
    await driver.find('.test-choice-list-entry').click();
    await gu.waitAppFocus(false);

    // Change 'Apricot' to a light shade of orange with purple text.
    const [greenColorBtn, , , apricotColorBtn] = await driver
      .findAll('.test-tokenfield .test-color-button');
    await apricotColorBtn.click();
    await gu.setColor(driver.find('.test-fill-input'), 'rgb(254, 204, 129)');
    await gu.setColor(driver.find('.test-text-input'), 'rgb(70, 13, 129)');
    await gu.setFont('bold', true);
    await gu.setFont('italic', true);
    await driver.sendKeys(Key.ENTER);

    // Change 'Green' to a darker shade with white text.
    await greenColorBtn.click();
    await gu.setColor(driver.find('.test-fill-input'), 'rgb(18, 110, 14)');
    await gu.setColor(driver.find('.test-text-input'), 'rgb(255, 255, 255)');
    await gu.setFont('strikethrough', true);
    await gu.setFont('underline', true);
    await driver.sendKeys(Key.ENTER);

    // Check that the old colors are still being used in the grid
    assert.deepEqual(
      await getCellTokenStyles(await gu.getCell({rowNum: 1, col: 'B'})),
      [
        {fillColor: GREEN_FILL, textColor: BLACK_TEXT, ...VALID_CHOICE, bold},
        INVALID_CHOICE,
        {fillColor: DEFAULT_FILL, textColor: DEFAULT_TEXT, ...VALID_CHOICE}
      ]
    );
    assert.deepEqual(
      await getCellTokenStyles(await gu.getCell({rowNum: 3, col: 'B'})),
      [
        {fillColor: GREEN_FILL, textColor: BLACK_TEXT, ...VALID_CHOICE, bold}
      ]
    );

    // Click save, and check that the new colors are now used in the grid
    await driver.find('.test-choice-list-entry-save').click();
    await gu.waitForServer();
    assert.deepEqual(
      await getCellTokenStyles(await gu.getCell({rowNum: 1, col: 'B'})),
      [
        {fillColor: DARK_GREEN_FILL, textColor: WHITE_TEXT, ...VALID_CHOICE, strikethrough, underline, bold},
        INVALID_CHOICE,
        {fillColor: APRICOT_FILL, textColor: APRICOT_TEXT, ...VALID_CHOICE, bold, italic}
      ]
    );
    assert.deepEqual(
      await getCellTokenStyles(await gu.getCell({rowNum: 3, col: 'B'})),
      [
        {fillColor: DARK_GREEN_FILL, textColor: WHITE_TEXT, ...VALID_CHOICE,
         strikethrough, underline, bold}
      ]
    );
  });

  it('should discard changes on cancel', async function() {
    for (const method of ['button', 'shortcut']) {
      // Open the editor.
      await driver.find('.test-choice-list-entry').click();
      await gu.waitAppFocus(false);

      // Delete 'Apricot', then cancel the change.
      await gu.sendKeys(Key.BACK_SPACE);
      assert.deepEqual(await getEditModeChoiceLabels(), ['Green', 'Blue', 'Black']);
      if (method === 'button') {
        await driver.find('.test-choice-list-entry-cancel').click();
      } else {
        await gu.sendKeys(Key.ESCAPE);
      }

      // Check that 'Apricot' is still there and the change wasn't saved.
      assert.deepEqual(await getChoiceLabels(), ['Green', 'Blue', 'Black', 'Apricot']);
    }
  });

  it('should support undo/redo shortcuts in the choice config editor', async function() {
    // Open the choice editor.
    await driver.find('.test-choice-list-entry').click();
    await gu.waitAppFocus(false);

    // Add a few choices.
    await driver.sendKeys('Foo', Key.ENTER, 'Bar', Key.ENTER, 'Baz', Key.ENTER);
    assert.deepEqual(await getEditModeChoiceLabels(), ['Green', 'Blue', 'Black', 'Apricot', 'Foo', 'Bar', 'Baz']);

    // Undo, verifying the contents of the choice config editor are correct after each invocation.
    const modKey = await gu.modKey();
    await gu.sendKeys(Key.chord(modKey, 'z'));
    assert.deepEqual(await getEditModeChoiceLabels(), ['Green', 'Blue', 'Black', 'Apricot', 'Foo', 'Bar']);
    await gu.sendKeys(Key.chord(modKey, 'z'));
    assert.deepEqual(await getEditModeChoiceLabels(), ['Green', 'Blue', 'Black', 'Apricot', 'Foo']);
    await gu.sendKeys(Key.chord(modKey, 'z'));
    assert.deepEqual(await getEditModeChoiceLabels(), ['Green', 'Blue', 'Black', 'Apricot']);

    // Redo, then undo, verifying at each step.
    await gu.sendKeys(Key.chord(Key.CONTROL, 'y'));
    assert.deepEqual(await getEditModeChoiceLabels(), ['Green', 'Blue', 'Black', 'Apricot', 'Foo']);
    await gu.sendKeys(Key.chord(modKey, 'z'));
    assert.deepEqual(await getEditModeChoiceLabels(), ['Green', 'Blue', 'Black', 'Apricot']);

    // Change the color of 'Apricot' to white with black text, and modify font options
    const [, , , apricotColorBtn] = await driver
      .findAll('.test-tokenfield .test-color-button');
    await apricotColorBtn.click();
    await gu.setColor(driver.find('.test-fill-input'), 'rgb(255, 255, 255)');
    await gu.setColor(driver.find('.test-text-input'), 'rgb(0, 0, 0)');
    await gu.setFont('bold', false);
    await gu.setFont('italic', false);
    await gu.setFont('underline', true);

    await driver.sendKeys(Key.ENTER);
    assert.deepEqual(await getEditModeFillColors(), [DARK_GREEN_FILL, BLUE_FILL,  BLACK_FILL, WHITE_FILL]);
    assert.deepEqual(await getEditModeTextColors(), [WHITE_TEXT,      BLACK_TEXT, WHITE_TEXT, BLACK_TEXT]);
    assert.deepEqual(await getEditModeFontOptions(), [{bold, underline, strikethrough}, {}, {}, {underline}]);

    // Undo, then re-do, verifying after each invocation
    await driver.find('.test-choice-list-entry .test-tokenfield .test-tokenfield-input').click();
    await gu.sendKeys(Key.chord(modKey, 'z'));
    assert.deepEqual(await getEditModeFillColors(), [DARK_GREEN_FILL, BLUE_FILL, BLACK_FILL, APRICOT_FILL]);
    assert.deepEqual(await getEditModeTextColors(), [WHITE_TEXT, BLACK_TEXT, WHITE_TEXT, APRICOT_TEXT]);
    assert.deepEqual(await getEditModeFontOptions(), [{bold, underline, strikethrough}, {}, {}, {bold, italic}]);
    await gu.sendKeys(Key.chord(Key.CONTROL, 'y'));
    assert.deepEqual(await getEditModeFillColors(), [DARK_GREEN_FILL, BLUE_FILL, BLACK_FILL, WHITE_FILL]);
    assert.deepEqual(await getEditModeTextColors(), [WHITE_TEXT, BLACK_TEXT, WHITE_TEXT, BLACK_TEXT]);
    assert.deepEqual(await getEditModeFontOptions(), [{bold, underline, strikethrough}, {}, {}, {underline}]);
  });

  it('should support rich copy/paste in the choice config editor', async function() {
    // Remove all choices
    const modKey = await gu.modKey();
    await gu.sendKeys(Key.chord(modKey, 'a'), Key.BACK_SPACE);

    // Add a few new choices
    await gu.sendKeys('Choice 1', Key.ENTER, 'Choice 2', Key.ENTER, 'Choice 3', Key.ENTER);

    // Copy all the choices
    await gu.sendKeys(await gu.selectAllKey());
    await clipboard.lockAndPerform(async (cb) => {
      await cb.copy();

      // Delete all the choices, then paste them back
      await driver.sendKeys(Key.BACK_SPACE);
      assert.deepEqual(await getEditModeChoiceLabels(), []);
      await cb.paste();
    });

    // Verify no data was lost
    assert.deepEqual(await getEditModeChoiceLabels(), ['Choice 1', 'Choice 2', 'Choice 3']);

    // In Jenkins, clipboard contents are pasted from the system clipboard, which only copies
    // choices as newline-separated labels. For this reason, we can't check that the color
    // information also got pasted, because the data is stored elsewhere. In actual use, the
    // workflow above would copy all the choice data as well, and use it for pasting in the editor.
  });

  it('should save and close the choice config editor on focusout', async function() {
    // Click outside of the editor.
    await driver.find('.test-gristdoc').click();
    await gu.waitAppFocus(true);

    // Check that the changes were saved.
    assert.deepEqual(await getChoiceLabels(), ['Choice 1', 'Choice 2', 'Choice 3']);

    await gu.undo();
  });

  it('should add a new element on a fresh ChoiceList column', async function() {
    await gu.addColumn("ChoiceList");
    await gu.setType(gu.exactMatch("Choice List"));
    const cell = await gu.getCell("ChoiceList", 1);
    await cell.click();
    await gu.sendKeys("foo");
    const plus = await driver.findWait(".test-choice-list-editor-new-item", 100);
    await plus.click();
    await gu.sendKeys(Key.ENTER);
    await gu.waitForServer();
    assert.equal(await cell.getText(), "foo");
  });

  it('should add a new element on a fresh Choice column', async function() {
    await gu.addColumn("Choice");
    await gu.setType(gu.exactMatch("Choice"));
    const cell = await gu.getCell("Choice", 1);
    await cell.click();
    await gu.sendKeys("foo");
    const plus = await driver.findWait(".test-choice-editor-new-item", 100);
    await plus.click();
    await gu.waitForServer();
    assert.equal(await cell.getText(), "foo");
  });

  for (const columnName of ["ChoiceList", "Choice"]) {
    it(`should allow renaming tokens on ${columnName} column`, gu.revertChanges(async function () {
      // Helper that converts ChoiceList to choice-list
      const editorDashedName = columnName.toLowerCase().replace(/list/, "-list");
      // Add two new options: one, two.
      await gu.getCell(columnName, 2).click();
      await gu.sendKeys("one");
      await driver.findWait(`.test-${editorDashedName}-editor-new-item`, 300).click();
      if (columnName === "ChoiceList") {
        await gu.sendKeys(Key.ENTER);
      }
      await gu.waitForServer();
      await gu.getCell(columnName, 3).click();
      await gu.sendKeys("two");
      await driver.findWait(`.test-${editorDashedName}-editor-new-item`, 300).click();
      if (columnName === "ChoiceList") {
        await gu.sendKeys(Key.ENTER);
      }
      await gu.waitForServer();

      // Make sure right panel is open and has right focus.
      await gu.toggleSidePanel("right", "open");
      await driver.find(".test-right-tab-field").click();
      // Rename one to three.
      await editChoiceEntries();
      await renameEntry("one", "three");
      await saveChoiceEntries();
      assert.deepEqual(await gu.getVisibleGridCells({ rowNums: [1, 2, 3], cols: [columnName] }), [
        "foo",
        "three",
        "two",
      ]);

      // Rename foo to bar, two to four, and three to eight, press undo 3 times
      // and make sure nothing changes.
      await editChoiceEntries();
      await renameEntry("foo", "bar");
      await renameEntry("three", "eight");
      await renameEntry("two", "four");
      assert.deepEqual(await getEditModeChoiceLabels(), ["bar", "eight", "four"]);
      const undoKey = Key.chord(await gu.modKey(), "z");
      await gu.sendKeys(undoKey);
      await gu.sendKeys(undoKey);
      await gu.sendKeys(undoKey);
      assert.deepEqual(await getEditModeChoiceLabels(), ["foo", "three", "two"]);

      // Make sure we can copy and paste without adding new item
      await clickEntry('foo');
      await clipboard.lockAndPerform(async (cb) => {
        await cb.cut();
        await cb.paste();
        await cb.paste();
      });
      await gu.sendKeys(Key.ENTER);
      await clickEntry('two');
      await clipboard.lockAndPerform(async (cb) => {
        await cb.copy();
        await gu.sendKeys(Key.ARROW_RIGHT);
        await cb.paste();
      });
      await gu.sendKeys(Key.ENTER);
      assert.deepEqual(await getEditModeChoiceLabels(), ["foofoo", "three", "twotwo"]);
      await saveChoiceEntries();
      assert.deepEqual(await gu.getVisibleGridCells({ rowNums: [1, 2, 3], cols: [columnName] }), [
        "foofoo",
        "three",
        "twotwo",
      ]);

      // Rename to bar, four and eight and do the change.
      await editChoiceEntries();
      await renameEntry("foofoo", "bar");
      await renameEntry("twotwo", "four");
      await renameEntry("three", "eight");
      await saveChoiceEntries();
      assert.deepEqual(await gu.getVisibleGridCells({ rowNums: [1, 2, 3], cols: [columnName] }), [
        "bar",
        "eight",
        "four",
      ]);

      // Add color to bar, save it, change to foo and make sure the color is still there.
      await editChoiceEntries();
      const [barColor] = await driver.findAll(".test-tokenfield .test-color-button");
      await barColor.click();
      await gu.setColor(driver.find(".test-text-input"), "rgb(70, 13, 129)");
      await driver.sendKeys(Key.ENTER);
      await renameEntry("bar", "foo");
      await saveChoiceEntries();
      await editChoiceEntries();
      const [fooColorText] = await getEditModeTextColors();
      assert.equal(fooColorText, "rgba(70, 13, 129, 1)");

      // Start renaming, but cancel out of the editor with two presses of the Escape key;
      // a previous bug caused focus to be lost after the first Escape, making it impossible
      // to close the editor with a subsequent press of Escape.
      await editChoiceEntries();
      await clickEntry("foo");
      await gu.sendKeys("food");
      await gu.sendKeys(Key.ESCAPE, Key.ESCAPE);
      assert.isFalse(await driver.find(".test-choice-list-entry-save").isPresent());

    },
    // Test if the column is reverted to state before the test
    () => gu.getVisibleGridCells({rowNums: [1, 2, 3], cols: [columnName]})));
  }

  it('should allow renaming multiple tokens on ChoiceList', gu.revertChanges(async function() {
    // Work on ChoiceList column, add one new option "one"
    await gu.getCell("ChoiceList", 2).click();
    await gu.sendKeys("one");
    await driver.findWait(`.test-choice-list-editor-new-item`, 300).click();
    await gu.sendKeys(Key.ENTER);
    await gu.waitForServer();
    await gu.getCell("ChoiceList", 3).click();
    await gu.sendKeys("one", Key.ENTER, "foo", Key.ENTER);
    await gu.waitForServer();

    // Make sure right panel is open and has right focus.
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-right-tab-field').click();

    // rename one to three
    await editChoiceEntries();
    await renameEntry("one", "three");
    await renameEntry("foo", "four");
    await saveChoiceEntries();
    assert.deepEqual(await gu.getVisibleGridCells({rowNums: [1, 2, 3], cols: ['ChoiceList']}), [
      'four',
      'three',
      'three\nfour',
    ]);
  },
  // Test if the column is reverted to state before the test
  () => gu.getVisibleGridCells({rowNums: [1, 2, 3], cols: ['ChoiceList']})));

  it('should rename saved filters', gu.revertChanges(async function() {
    // Make sure right panel is open and has focus.
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-right-tab-field').click();

    // Work on ChoiceList column, add two new options: one, two
    await gu.getCell("ChoiceList", 2).click();
    await gu.sendKeys("one");
    await driver.findWait(`.test-choice-list-editor-new-item`, 300).click();
    await gu.sendKeys(Key.ENTER);
    await gu.getCell("ChoiceList", 3).click();
    await gu.sendKeys("one", Key.ENTER, "foo", Key.ENTER, Key.ENTER);
    await gu.waitForServer();
    // Make sure column looks like this:
    assert.deepEqual(await gu.getVisibleGridCells({rowNums: [1, 2, 3, 4], cols: ['ChoiceList']}), [
      'foo',
      'one',
      'one\nfoo',
      '' // add row
    ]);

    // Filter by single value and save.
    await gu.filterBy('ChoiceList', true, [/one/]);

    // Duplicate page, to make sure filters are also renamed in a new section.
    await gu.openPageMenu('Table1');
    await driver.find('.test-docpage-duplicate').click();
    await driver.find('.test-modal-confirm').click();
    await driver.findContentWait('.test-docpage-label', /copy/, 2000);
    await gu.waitForServer();

    // Go back to Table1
    await gu.getPageItem('Table1').click();
    // Make sure grid is filtered
    assert.deepEqual(await gu.getVisibleGridCells({rowNums: [1, 2, 3], cols: ['ChoiceList']}), [
      'one',
      'one\nfoo',
      '' // new row
    ]);
    // Rename one to five, foo to bar
    await editChoiceEntries();
    await renameEntry("one", "five");
    await renameEntry("foo", "bar");
    await saveChoiceEntries();
    // Make sure that there are still two records - filter should be changed to new values.
    assert.deepEqual(await gu.getVisibleGridCells({rowNums: [1, 2, 3], cols: ['ChoiceList']}), [
      'five',
      'five\nbar',
      '' // new row
    ]);
    // Make sure that it also renamed filters in diffrent section.
    await gu.getPageItem('Table1 (copy)').click();
    assert.deepEqual(await gu.getVisibleGridCells({rowNums: [1, 2, 3], cols: ['ChoiceList']}), [
      'five',
      'five\nbar',
      '' // new row
    ]);
    // Go back to previous names, filter still should work.
    await gu.undo();
    assert.deepEqual(await gu.getVisibleGridCells({rowNums: [1, 2, 3], cols: ['ChoiceList']}), [
      'one',
      'one\nfoo',
      '' // new row
    ]);
  },
  // Test if the column is reverted to state before the test
  () => gu.getVisibleGridCells({rowNums: [1, 2, 3], cols: ['ChoiceList']})));
});
