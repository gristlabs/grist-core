import {StringUnion} from 'app/common/StringUnion';
import {assert} from 'chai';
import {driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe("duplicateWidget", function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();
  const testFormula = '"Test" == "Test"';
  const testCellContent = "Rubber duck";
  const testCellContent2 = "Plastic boat";

  before(async function() {
    const session = await gu.session().teamSite.login();
    await session.tempNewDoc(cleanup, 'DuplicateWidget.grist');
  });

  describe("duplicating a widget on the same page", async function() {
    it('can duplicate the widget', async function() {
      // Initial setup of the base widget
      const allSections = await gu.getSectionTitles();
      await gu.selectSectionByTitle(allSections[0]);

      await gu.renameSection(allSections[0], 'Widget 1');

      await gu.getCell('A', 1).click();
      await driver.sendKeys(Key.ENTER + testCellContent + Key.ENTER);
      await driver.sendKeys(Key.DOWN);
      await driver.sendKeys(Key.ENTER + testCellContent2 + Key.ENTER);


      // Set as many properties on the widget as possible that we can check when duplicating.
      // Filters happen before widget change, as the gristUtils helpers are better for tables.
      const filterCtrl = await gu.openColumnFilter('A');
      await filterCtrl.toggleValue(testCellContent2);
      await filterCtrl.save();

      await gu.changeWidget('Card List');
      await setCardListTheme('Compact');
      await gu.moveToHidden('B');

      await gu.openWidgetPanel('sortAndFilter');
      await gu.addColumnToSort('A');
      await gu.saveSortConfig();

      await gu.duplicateWidget('Widget 1');
      // Reduces flakiness by waiting until duplication is finished and it's okay to rename.
      await gu.waitToPass(async () => assert.equal((await gu.getSectionTitles()).length, 2));
      // Rename the first widget to 'Original', as `renameSection` finds the first one.
      await renameLastWidget('Widget 2');

      assert.deepEqual(await gu.getSectionTitles(), ['Widget 1', 'Widget 2']);
    });

    it('preserves widget type and options', async function() {
      // This also verifies it's still a card list widget.
      const cardListTheme = await getCardListTheme();
      assert.equal(cardListTheme, 'Compact', 'Widget options were not preserved');
    });

    it('preserves visible columns', async function() {
      const visibleColumns = await gu.getVisibleColumns();
      assert.deepEqual(visibleColumns, ['A', 'C']);

      const hiddenColumns = await gu.getHiddenColumns();
      assert.deepEqual(hiddenColumns, ['B']);
    });

    it('preserves saved sorts', async function() {
      await gu.openSectionMenu('sortAndFilter', 'Widget 2');
      const sortColumns = await gu.getSortColumns();
      assert.deepEqual(sortColumns, [{ column: 'A', dir: 'asc' }]);
      // Close the sort menu - can overlap with filter options on CI.
      await gu.openSectionMenu('sortAndFilter', 'Widget 2');
    });

    it('preserves column filters', async function() {
      await gu.openPinnedFilter('A');
      const filterState = await gu.getFilterMenuState();
      const isChecked = (text: string) => filterState.find(entry => entry.value === text)?.checked;
      assert.isTrue(isChecked(testCellContent), `${testCellContent} should be included`);
      assert.isFalse(isChecked(testCellContent2), `${testCellContent2} should be filtered out`);
    });

    it('can duplicate a widget with selectby and style rules', async function() {
      await gu.changeWidget('Table');

      await gu.addInitialStyleRule();
      await gu.openStyleRuleFormula(0);
      await driver.sendKeys(testFormula + Key.ENTER);
      await gu.selectBy('Widget 1');

      await gu.duplicateWidget('Widget 2');
      // Reduces flakiness by waiting until duplication is finished and it's okay to rename.
      await gu.waitToPass(async () => assert.equal((await gu.getSectionTitles()).length, 3));
      await renameLastWidget('Widget 3');
    });


    it('preserves style rules', async function() {
      await gu.getSection('Widget 3').click();
      await gu.openWidgetPanel('widget');
      const formula = await gu.getStyleRuleAt(0).find('.formula_field_sidepane').getText();
      assert.equal(formula.trim(), testFormula);
    });

    it('preserves selectby', async function() {
      await gu.getSection('Widget 3').click();
      await gu.changeWidget('Card');
      assert.equal(await gu.selectedBy(), 'Widget 1');
      const text = await gu.getDetailCell('A', 1).getText();
      assert.equal(text, testCellContent);
    });
  });

  describe("duplicating a widget to a different page", async function() {
    it('can duplicate the widget to another existing page', async function() {
      await gu.addNewPage('Table', 'Table1');
      const newPageName = 'Page 2';
      await gu.renamePage('New page', newPageName);
      // Go back to the first page.
      await gu.openPage((await gu.getPageNames())[0]);
      await gu.duplicateWidget('Widget 2', newPageName);
      assert.equal(await gu.getCurrentPageName(), newPageName);
      await renameLastWidget('Widget 4');
      // Ensure the 'select by' was cleared, as it was only valid on the same page.
      assert.equal(await gu.selectedBy(), 'Select Widget');
    });

    it('can duplicate the widget to a new page', async function() {
      await gu.openPage((await gu.getPageNames())[0]);
      await gu.duplicateWidget('Widget 2', 'Create new page');
      assert.equal(await gu.getCurrentPageName(), 'New page');
    });
  });
});


const CardListTheme = StringUnion('Form', 'Compact', 'Block');
async function setCardListTheme(theme: typeof CardListTheme.type) {
  await gu.openWidgetPanel('widget');
  const select = gu.buildSelectComponent('.test-vconfigtab-detail-theme');
  await select.select(theme);
}

async function getCardListTheme(): Promise<typeof CardListTheme.type> {
  await gu.openWidgetPanel('widget');
  const select = gu.buildSelectComponent('.test-vconfigtab-detail-theme');
  return CardListTheme.check(await select.value());
}

async function renameLastWidget(newName: string) {
  const allSections = await driver.findAll('.viewsection_content');
  await allSections.at(-1)?.click();
  await gu.renameActiveSection(newName);
  await gu.waitToPass(async () => { await gu.getSection(newName); });
}
