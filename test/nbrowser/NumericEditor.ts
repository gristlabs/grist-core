import type {UserAPI} from 'app/common/UserAPI';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';
import {assert, driver, Key} from 'mocha-webdriver';

describe('NumericEditor', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();
  afterEach(() => gu.checkForErrors());

  interface Entry {
    initial: string;
    workaround?: () => Promise<void>;
    expect: string;
    exp0: string;
    expPlain: string;
    expFmt: string;
  }
  interface TestOpts {
    localeCode: string;
    locale: string;
    entriesByColumn: Entry[];
    valPlain: string;
    valFmt: string;
  }

  describe('locale en-US', testSuite({
    localeCode: 'en-US',
    locale: 'United States (English)',
    entriesByColumn: [
      {initial: '17',       expect: '17',      exp0: '0',     expPlain: '-4.4',   expFmt: '-1234.56'  },
      {initial: '17.500',   expect: '17.500',  exp0: '0.000', expPlain: '-4.400', expFmt: '-1234.560' },
      {initial: '(1.2)',    expect: '(1.2)',   exp0: ' 0 ',   expPlain: '(4.4)',  expFmt: '(1234.56)' },
      {initial: '1000.456', expect: '1000.456', exp0: '0',    expPlain: '-4.4',   expFmt: '-1234.56'  },
      {initial: '1,000.0',  expect: '1,000.0', exp0: '0.0',   expPlain: '-4.4',   expFmt: '-1,234.56' },
      {initial: '$5.00',    expect: '$5.00',   exp0: '$0.00', expPlain: '-$4.40', expFmt: '-$1,234.56'},
      {initial: '4.5%',     expect: '4.5%',    exp0: '0%',    expPlain: '-440%',  expFmt: '-123,456%' },
    ],
    valPlain: '-4.4',
    valFmt: '(1,234.56)',
  }));

  describe('locale de-DE', testSuite({
    localeCode: 'de-DE',
    locale: 'Germany (German)',
    entriesByColumn: [
      {initial: '17',       expect: '17',      exp0: '0',      expPlain: '-4,4',    expFmt: '-1234,56'    },
      {initial: '17,500',   expect: '17,500',  exp0: '0,000',  expPlain: '-4,400',  expFmt: '-1234,560'   },
      {initial: '(1,2)',    expect: '(1,2)',   exp0: ' 0 ',    expPlain: '(4,4)',   expFmt: '(1234,56)'   },
      {initial: '1000,456', expect: '1000,456', exp0: '0',     expPlain: '-4,4',    expFmt: '-1234,56'    },
      {initial: '1.000,0',  expect: '1.000,0', exp0: '0,0',    expPlain: '-4,4',    expFmt: '-1.234,56',  },
      {initial: '5,00€',    expect: '5,00 €',  exp0: '0,00 €', expPlain: '-4,40 €', expFmt: '-1.234,56 €' },
      {initial: '4,5%',     expect: '4,5 %',   exp0: '0 %',    expPlain: '-440 %',   expFmt: '-123.456 %' },
    ],
    valPlain: '-4,4',
    valFmt: '(1.234,56)',
  }));

  function testSuite(options: TestOpts) {
    const {entriesByColumn} = options;

    return function() {
      let docId: string;
      let api: UserAPI;
      let MODKEY: string;

      before(async function() {
        MODKEY = await gu.modKey();
        const session = await gu.session().login();
        docId = await session.tempNewDoc(cleanup, `NumericEditor-${options.localeCode}`);
        api = session.createHomeApi();

        await api.applyUserActions(docId, [
          // Make sure there are as many columns as entriesByColumn.
          ...entriesByColumn.slice(3).map(() => ['AddVisibleColumn', 'Table1', '', {}]),
        ]);

        // Set locale for the document.
        await gu.openDocumentSettings();
        await driver.findWait('.test-locale-autocomplete', 500).click();
        await driver.sendKeys(options.locale, Key.ENTER);
        await gu.waitForServer();
        assert.equal(await driver.find('.test-locale-autocomplete input').value(), options.locale);
        await gu.openPage('Table1');
      });

      beforeEach(async function() {
        // Scroll grid to the left before each test case.
        await gu.sendKeys(Key.HOME);
      });

      it('should create Numeric columns with suitable format', async function() {
        // Entering a value into an empty column should switch it to a suitably formatted Numeric.
        for (const [i, entry] of Object.entries(entriesByColumn)) {
          await gu.getCell({rowNum: 1, col: Number(i)}).click();
          await entry.workaround?.();
          await gu.enterCell(entry.initial);
          assert.equal(await gu.getCell({rowNum: 1, col: Number(i)}).getText(), entry.expect);
        }

        // Add a new row, which should be filled with 0's. Check what formatted 0's look like.
        await gu.sendKeys(Key.chord(MODKEY, Key.ENTER));
        await gu.waitForServer();

        // Check what 0's look like.
        for (const [i, entry] of Object.entries(entriesByColumn)) {
          assert.equal(await gu.getCell({rowNum: 2, col: Number(i)}).getText(), entry.exp0);
        }
      });

      it('should support entering plain numbers into a formatted column', async function() {
        const rowNum = 3;
        const cols = entriesByColumn.map((_, i) => i);

        await gu.enterGridRows({rowNum, col: 0},
          [ entriesByColumn.map(() => options.valPlain) ]);

        assert.deepEqual(await gu.getVisibleGridCells({rowNums: [rowNum], cols}),
          entriesByColumn.map((entry) => entry.expPlain));
      });

      it('should support entering formatted numbers into a formatted column', async function() {
        const rowNum = 4;
        const cols = entriesByColumn.map((_, i) => i);

        await gu.enterGridRows({rowNum, col: 0},
          [ entriesByColumn.map(() => options.valFmt) ]);

        assert.deepEqual(await gu.getVisibleGridCells({rowNums: [rowNum], cols}),
          entriesByColumn.map((entry) => entry.expFmt));
      });

      it('should allow editing and saving a formatted value', async function() {
        for (const [i, entry] of Object.entries(entriesByColumn)) {
          await gu.getCell({rowNum: 1, col: Number(i)}).click();
          await gu.sendKeys(Key.ENTER);
          await gu.waitAppFocus(false);
          // Save the value the way it's opened in the editor. It's important that it doesn't
          // change interpretation (there was a bug related to this, when a value with "," decimal
          // separator would open with a "." decimal separator, and get saved back incorrectly).
          await gu.sendKeys(Key.ENTER);
          await gu.waitForServer();
          await gu.waitAppFocus(true);
          assert.equal(await gu.getCell({rowNum: 1, col: Number(i)}).getText(), entry.expect);
        }
      });
    };
  }
});
