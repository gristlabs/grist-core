import { assert } from 'chai';
import { driver } from 'mocha-webdriver';
import {
  checkTypeAndFormula,
  clickAddColumn,
  closeAddColumnMenu,
  hasShortcuts,
  isDisplayed,
  revertEach,
} from 'test/nbrowser/GridViewNewColumnMenuUtils';
import * as gu from 'test/nbrowser/gristUtils';
import { setupTestSuite } from 'test/nbrowser/testUtils';

describe('GridViewNewColumnMenuDateHelpers', function () {
  const STANDARD_WAITING_TIME = 1000;
  this.timeout('4m');
  const cleanup = setupTestSuite();
  gu.bigScreen();
  let session: gu.Session;

  before(async function () {
    session = await gu.session().login({ showTips: true });
    await session.tempNewDoc(cleanup, 'ColumnMenu');
    await gu.dismissBehavioralPrompts();

    // Add a table that will be used for lookups.
    await gu.sendActions([
      ['AddRecord', 'Table1', null, {}],
      ['RemoveColumn', 'Table1', 'B'],
      ['RemoveColumn', 'Table1', 'C'],
    ]);
    await gu.openColumnPanel();
  });

  describe('menu', function () {
    afterEach(async function() {
      // Leave all columns except A, B, C
      const allColumns = await gu.getColumnNames();
      const id = (x: string) => x.replace(/[^0-9a-zA-Z_]/g, '_');
      await gu.sendActions([
        ...allColumns.filter(colLabel => !['A', 'B', 'C'].includes(colLabel))
          .map(c => ['RemoveColumn', 'Table1', id(c)] as any),
      ]);
    });

    const testCases = [
      // Quick Picks
      {
        type: 'Date', menu: 'Quick Picks -> Year', column: 'Integer', columnName: 'EventDate Year',
        formula: 'YEAR($EventDate) if $EventDate else None',
        expected: '2012',
      },
      {
        type: 'Date', menu: 'Quick Picks -> Month', column: 'Text', columnName: 'EventDate Month',
        formula: '$EventDate.strftime("%Y-%m") if $EventDate else None',
        expected: '2012-12',
      },
      {
        type: 'Date', menu: 'Quick Picks -> Quarter', column: 'Text', columnName: 'EventDate Quarter',
        formula: '"{}-Q{}".format(YEAR($EventDate), (MONTH($EventDate) - 1) // 3 + 1) if $EventDate else None',
        expected: '2012-Q4',
      },
      {
        type: 'Date', menu: 'Quick Picks -> Day of week', column: 'Text', columnName: 'EventDate Day of week',
        formula: '$EventDate.strftime("%A") if $EventDate else None',
        expected: 'Wednesday',
      },
      // Calendar -> Year
      {
        type: 'Date', menu: 'Calendar -> Year', column: 'Integer', columnName: 'EventDate Year',
        formula: 'YEAR($EventDate) if $EventDate else None',
        expected: '2012',
      },
      // Calendar -> Quarter variations
      {
        type: 'Date', menu: 'Calendar -> Quarter -> Default', column: 'Text', columnName: 'EventDate Quarter',
        formula: '"Q{}".format((MONTH($EventDate) - 1) // 3 + 1) + " " + str(YEAR($EventDate)) if $EventDate else None',
        expected: 'Q4 2012',
      },
      {
        type: 'Date', menu: 'Calendar -> Quarter -> Sortable', column: 'Text', columnName: 'EventDate Quarter',
        formula: '"{}-Q{}".format(YEAR($EventDate), (MONTH($EventDate) - 1) // 3 + 1) if $EventDate else None',
        expected: '2012-Q4',
      },
      // Calendar -> Month variations
      {
        type: 'Date', menu: 'Calendar -> Month -> Full name with year', column: 'Text', columnName: 'EventDate Month',
        formula: '$EventDate.strftime("%B %Y") if $EventDate else None',
        expected: 'December 2012',
      },
      {
        type: 'Date', menu: 'Calendar -> Month -> Sortable', column: 'Text', columnName: 'EventDate Month',
        formula: '$EventDate.strftime("%Y-%m") if $EventDate else None',
        expected: '2012-12',
      },
      {
        type: 'Date', menu: 'Calendar -> Month -> Short with year', column: 'Text', columnName: 'EventDate Month',
        formula: '$EventDate.strftime("%b %Y") if $EventDate else None',
        expected: 'Dec 2012',
      },
      {
        type: 'Date', menu: 'Calendar -> Month -> Name only', column: 'Text', columnName: 'EventDate Month',
        formula: '$EventDate.strftime("%B") if $EventDate else None',
        expected: 'December',
      },
      {
        type: 'Date', menu: 'Calendar -> Month -> Number only', column: 'Integer', columnName: 'EventDate Month',
        formula: 'MONTH($EventDate) if $EventDate else None',
        expected: '12',
      },
      // Calendar -> Week variations
      {
        type: 'Date', menu: 'Calendar -> Week of year -> Default', column: 'Text', columnName: 'EventDate Week',
        formula: '"Week {}".format(WEEKNUM($EventDate)) if $EventDate else None',
        expected: 'Week 50',
      },
      {
        type: 'Date', menu: 'Calendar -> Week of year -> Sortable', column: 'Text', columnName: 'EventDate Week',
        formula: '"{}-W{:02d}".format(YEAR($EventDate), WEEKNUM($EventDate)) if $EventDate else None',
        expected: '2012-W50',
      },
      // Calendar -> Day variations
      {
        type: 'Date', menu: 'Calendar -> Day -> Day of month', column: 'Integer', columnName: 'EventDate Day of month',
        formula: 'DAY($EventDate) if $EventDate else None',
        expected: '12',
      },
      {
        type: 'Date', menu: 'Calendar -> Day -> Full date', column: 'Date', columnName: 'EventDate Full date',
        formula: 'DATE(YEAR($EventDate), MONTH($EventDate), DAY($EventDate)) if $EventDate else None',
        expected: '2012-12-12',
      },
      {
        type: 'Date', menu: 'Calendar -> Day -> Day of week (full)', column: 'Text',
        columnName: 'EventDate Day of week',
        formula: '$EventDate.strftime("%A") if $EventDate else None',
        expected: 'Wednesday',
      },
      {
        type: 'Date', menu: 'Calendar -> Day -> Day of week (abbrev)', column: 'Text',
        columnName: 'EventDate Day of week',
        formula: '$EventDate.strftime("%a") if $EventDate else None',
        expected: 'Wed',
      },
      {
        type: 'Date', menu: 'Calendar -> Day -> Day of week (numeric)', column: 'Integer',
        columnName: 'EventDate Day of week',
        formula: 'WEEKDAY($EventDate, 2) if $EventDate else None',
        expected: '3',
      },
      {
        type: 'Date', menu: 'Calendar -> Day -> Is weekend?', column: 'Toggle', columnName: 'EventDate Is weekend?',
        formula: 'WEEKDAY($EventDate, 2) >= 6 if $EventDate else None',
        expected: '',
      },
      // Intervals -> Start of
      {
        type: 'Date', menu: 'Intervals -> Start of -> Week', column: 'Date', columnName: 'EventDate Start of Week',
        formula: 'DATEADD($EventDate, days=-WEEKDAY($EventDate, 3)) if $EventDate else None',
        expected: '2012-12-10',
      },
      {
        type: 'Date', menu: 'Intervals -> Start of -> Month', column: 'Date', columnName: 'EventDate Start of Month',
        formula: 'DATE(YEAR($EventDate), MONTH($EventDate), 1) if $EventDate else None',
        expected: '2012-12-01',
      },
      {
        type: 'Date', menu: 'Intervals -> Start of -> Quarter', column: 'Date',
        columnName: 'EventDate Start of Quarter',
        formula: 'DATE(YEAR($EventDate), ((MONTH($EventDate)-1)//3)*3 + 1, 1) if $EventDate else None',
        expected: '2012-10-01',
      },
      {
        type: 'Date', menu: 'Intervals -> Start of -> Year', column: 'Date', columnName: 'EventDate Start of Year',
        formula: 'DATE(YEAR($EventDate), 1, 1) if $EventDate else None',
        expected: '2012-01-01',
      },
      // Intervals -> End of
      {
        type: 'Date', menu: 'Intervals -> End of -> Week', column: 'Date', columnName: 'EventDate End of Week',
        formula: 'DATEADD($EventDate, days=7-WEEKDAY($EventDate, 3)-1) if $EventDate else None',
        expected: '2012-12-16',
      },
      {
        type: 'Date', menu: 'Intervals -> End of -> Month', column: 'Date', columnName: 'EventDate End of Month',
        formula: 'EOMONTH($EventDate, 0) if $EventDate else None',
        expected: '2012-12-31',
      },
      {
        type: 'Date', menu: 'Intervals -> End of -> Quarter', column: 'Date',
        columnName: 'EventDate End of Quarter',
        formula: 'EOMONTH(DATE(YEAR($EventDate), ((MONTH($EventDate)-1)//3)*3 + 3, 1), 0) if $EventDate else None',
        expected: '2012-12-31',
      },
      {
        type: 'Date', menu: 'Intervals -> End of -> Year', column: 'Date', columnName: 'EventDate End of Year',
        formula: 'DATE(YEAR($EventDate), 12, 31) if $EventDate else None',
        expected: '2012-12-31',
      },
      // Intervals -> Relative (no examples here, as this has TODAY, and tests can be flaky).
      {
        type: 'Date', menu: 'Intervals -> Relative -> Days since', column: 'Integer',
        columnName: 'EventDate Days since',
        formula: 'DATEDIF($EventDate, TODAY(), "D") if $EventDate else None',
      },
      {
        type: 'Date', menu: 'Intervals -> Relative -> Days until', column: 'Integer',
        columnName: 'EventDate Days until',
        formula: 'DATEDIF(TODAY(), $EventDate, "D") if $EventDate else None',
      },
      {
        type: 'Date', menu: 'Intervals -> Relative -> Months since', column: 'Integer',
        columnName: 'EventDate Months since',
        formula: 'DATEDIF($EventDate, TODAY(), "M") if $EventDate else None',
      },
      {
        type: 'Date', menu: 'Intervals -> Relative -> Months until', column: 'Integer',
        columnName: 'EventDate Months until',
        formula: 'DATEDIF(TODAY(), $EventDate, "M") if $EventDate else None',
      },
      {
        type: 'Date', menu: 'Intervals -> Relative -> Years since', column: 'Integer',
        columnName: 'EventDate Years since',
        formula: 'DATEDIF($EventDate, TODAY(), "Y") if $EventDate else None',
      },
      {
        type: 'Date', menu: 'Intervals -> Relative -> Years until', column: 'Integer',
        columnName: 'EventDate Years until',
        formula: 'DATEDIF(TODAY(), $EventDate, "Y") if $EventDate else None',
      },
      // Time section (only for DateTime columns)
      {
        type: 'DateTime:UTC', menu: 'Time -> Hour -> 24-hour format', column: 'Text',
        columnName: 'EventDate Hour',
        formula: '$EventDate.strftime("%H") if $EventDate else None',
        expected: '00',
      },
      {
        type: 'DateTime:UTC', menu: 'Time -> Hour -> 12-hour format', column: 'Text',
        columnName: 'EventDate Hour',
        formula: '$EventDate.strftime("%I %p").lstrip("0") if $EventDate else None',
        expected: '12 AM',
      },
      {
        type: 'DateTime:UTC', menu: 'Time -> Hour -> Time bucket', column: 'Text', columnName: 'EventDate Hour',
        formula: 'if not $EventDate:\n  return None\n' +
          'hour = HOUR($EventDate)\n' +
          'if hour < 12:\n  return "Morning"\n' +
          'if hour < 18:\n  return "Afternoon"\n' +
          'return "Evening"',
        expected: 'Morning',
      },
      {
        type: 'DateTime:UTC', menu: 'Time -> Minute', column: 'Integer', columnName: 'EventDate Minute',
        formula: 'MINUTE($EventDate) if $EventDate else None',
        expected: '0',
      },
      {
        type: 'DateTime:UTC', menu: 'Time -> AM/PM', column: 'Text', columnName: 'EventDate AM/PM',
        formula: '$EventDate.strftime("%p") if $EventDate else None',
        expected: 'AM',
      },
    ];

    for (const testCase of testCases) {
      it(`has working ${testCase.menu} menu`, async function () {
        // Add test column with proper type.
        await gu.sendActions([
          ['AddVisibleColumn', 'Table1', 'EventDate', {
            type: testCase.type,
            isFormula: true,
            formula: 'DATE(2012, 12, 12)',
          }],
          ['ModifyColumn', 'Table1', 'EventDate', {
            isFormula: false,
          }],
        ]);

        // Click add column.
        await clickAddColumn();
        // Open date helpers submenu.
        await driver.findWait('.test-new-columns-menu-date-helpers', STANDARD_WAITING_TIME).click();
        // Select our new column.
        await driver.findWait('.test-date-helpers-column-EventDate', STANDARD_WAITING_TIME).click();

        // Click the menu item.
        await selectDatePart(testCase.menu, testCase.expected);
        await gu.waitForServer();

        // Check column was created with correct name
        const columns = await gu.getColumnNames();
        assert.include(columns, testCase.columnName);

        // Check that value is ok, same as example.
        const cellText = await gu.getCell(testCase.columnName, 1).getText();
        if (testCase.expected) {
          assert.equal(cellText, testCase.expected);
        }

        // Now clear the value in the cell and make sure that our helper column is also empty.
        await gu.sendActions([
          ['UpdateRecord', 'Table1', 1, { EventDate: null }],
        ]);
        const cellTextAfterClear = await gu.getCell(testCase.columnName, 1).getText();
        assert.equal(cellTextAfterClear, '', 'Helper column should be empty after clearing source date');

        // Check type and formula
        await gu.getCell(testCase.columnName, 1).click();
        await gu.waitToPass(async () => {
          // Make sure that the create panel can keep up.
          assert.equal(await driver.find('.test-field-label').value(), testCase.columnName);
        });
        await checkTypeAndFormula(testCase.column, testCase.formula);
      });
    }
  });

  describe('general', function () {
    revertEach();

    it('should not show date helpers menu when no Date/DateTime columns exist', async function () {
      await gu.openColumnPanel();
      await clickAddColumn();
      await hasShortcuts();
      // Date helpers menu should not be present when no date columns exist
      assert.isFalse(await driver.find('.test-new-columns-menu-date-helpers').isPresent());
      await closeAddColumnMenu();
    });

    it('should show date helpers menu when Date columns exist', async function () {
      // Add a Date column first
      await gu.sendActions([
        ['AddVisibleColumn', 'Table1', 'EventDate', { type: 'Date' }],
      ]);

      await clickAddColumn();
      await hasShortcuts();
      // Date helpers menu should be present
      await isDisplayed('.test-new-columns-menu-date-helpers', 'date helpers section is not present');

      // Check the menu opens and shows the date column
      await driver.findWait('.test-new-columns-menu-date-helpers', STANDARD_WAITING_TIME).click();
      await driver.findWait('.test-date-helpers-column-EventDate', STANDARD_WAITING_TIME);

      await closeAddColumnMenu();
    });

    it('should show date helpers menu when DateTime columns exist', async function () {
      // Add a DateTime column
      await gu.sendActions([
        ['AddVisibleColumn', 'Table1', 'Timestamp', { type: 'DateTime:UTC' }],
      ]);

      await clickAddColumn();
      await driver.findWait('.test-new-columns-menu-date-helpers', STANDARD_WAITING_TIME).click();
      await driver.findWait('.test-date-helpers-column-Timestamp', STANDARD_WAITING_TIME);

      await closeAddColumnMenu();
    });

    it('should work with multiple date columns', async function () {
      await gu.sendActions([
        ['AddVisibleColumn', 'Table1', 'StartDate', { type: 'Date' }],
        ['AddVisibleColumn', 'Table1', 'EndDate', { type: 'DateTime:UTC' }],
      ]);

      await clickAddColumn();
      await driver.findWait('.test-new-columns-menu-date-helpers', STANDARD_WAITING_TIME).click();

      // Should show both date columns
      await driver.findWait('.test-date-helpers-column-StartDate', STANDARD_WAITING_TIME);
      await driver.findWait('.test-date-helpers-column-EndDate', STANDARD_WAITING_TIME);

      // Create year from StartDate
      await driver.findWait('.test-date-helpers-column-StartDate', STANDARD_WAITING_TIME).click();
      await selectDatePart('Quick Picks -> Year');

      const columns = await gu.getColumnNames();
      assert.include(columns, 'StartDate Year');

      await closeAddColumnMenu();
    });
  });

});

async function selectDatePart(text: string, example?: string) {
  const parts = text.split('->').map(s => s.trim());
  const section = parts[0];
  const firstLevel = parts[1];
  const secondLevel = parts[2];

  // Helper to create test ID (matches the implementation exactly)
  const makeTestPart = (s: string) => s.toLowerCase().replace(/\s+/g, '-').replace(/[^0-9a-z-]/g, '');

  if (secondLevel) {
    // Three levels: section -> submenu -> item
    const submenuTestId = `date-helpers-item-${makeTestPart(section)}-${makeTestPart(firstLevel)}`;
    const itemTestId = `${submenuTestId}-${makeTestPart(secondLevel)}`;

    // First hover over the submenu to open it
    await driver.findWait(`.test-${submenuTestId}`, 500).mouseMove();

    // If we have example to check
    if (example) {
      const textContent = await driver.findWait(`.test-${itemTestId} .test-date-helpers-item-example`, 500).getText();
      assert.equal(textContent, example, `Unexpected example for ${text}`);
    }

    // Then click the item
    await driver.findWait(`.test-${itemTestId}`, 500).click();
  }
  else {
    // Two levels: section -> item (direct item, no submenu)
    const itemTestId = `date-helpers-item-${makeTestPart(section)}-${makeTestPart(firstLevel)}`;
    await driver.findWait(`.test-${itemTestId}`, 500).click();
  }

  await gu.waitForServer();
}
