import {StringUnion} from 'app/common/StringUnion';
import {setupTestSuite} from 'test/nbrowser/testUtils';
import * as gu from 'test/nbrowser/gristUtils';
import {buildSelectComponent} from 'test/nbrowser/gristUtils';
import {assert} from 'chai';
import {driver, Key} from 'mocha-webdriver';

describe("duplicateWidget", function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();
  const testFormula = '"Test" == "Test"';

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

      // Set as many properties on the widget as possible that we can check when duplicating.
      // Filters happen before widget change, as the gristUtils helpers are better for tables.
      const filterCtrl = await gu.openColumnFilter('C');
      await filterCtrl.none();
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

    it('preserves selectby', async function() {
      await gu.getSection('Widget 3').click();
      assert.equal(await gu.selectedBy(), 'Widget 1');
    });

    it('preserves style rules', async function() {
      await gu.openWidgetPanel('widget');
      const formula = await gu.getStyleRuleAt(0).find('.formula_field_sidepane').getText();
      assert.equal(formula.trim(), testFormula);
    });
  });

  // Test:
  // Create a doc with a widget
  // Set some custom settings
  // Duplicate that widget
  // Check settings maintained
  //
  // Change widget type
  // Set select by
  // Duplicate second widget, check select by maintained.
  // Create a new page
  // Duplicate widget 1 to new page, check.
  // Duplicate widget 2 to new page, check.
});

const CardListTheme = StringUnion('Form', 'Compact', 'Block');
async function setCardListTheme(theme: typeof CardListTheme.type) {
  await gu.openWidgetPanel('widget');
  const select = buildSelectComponent('.test-vconfigtab-detail-theme');
  await select.select(theme);
}

async function getCardListTheme(): Promise<typeof CardListTheme.type> {
  await gu.openWidgetPanel('widget');
  const select = buildSelectComponent('.test-vconfigtab-detail-theme');
  return CardListTheme.check(await select.value());
}

async function renameLastWidget(newName: string) {
  const allSections = await driver.findAll('.viewsection_content');
  await allSections.at(-1)?.click();
  await gu.renameActiveSection(newName);
  await gu.waitToPass(async () => { await gu.getSection(newName); });
}
