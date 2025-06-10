import {StringUnion} from 'app/common/StringUnion';
import {setupTestSuite} from 'test/nbrowser/testUtils';
import * as gu from 'test/nbrowser/gristUtils';
import {buildSelectComponent} from 'test/nbrowser/gristUtils';
import {assert} from 'chai';
import {driver, Key} from 'mocha-webdriver';

describe("duplicateWidget", function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  before(async function() {
    const session = await gu.session().teamSite.login();
    await session.tempNewDoc(cleanup, 'DuplicateWidget.grist');
  });

  it("can duplicate a widget", async function() {
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

    // Rename the first widget to 'Original', as `renameSection` finds the first one.
    await gu.renameSection('Widget 1', 'Original widget');
    // This also verifies it's still a card list widget.
    const cardListTheme = await getCardListTheme();
    assert.equal(cardListTheme, 'Compact', 'Widget options were not preserved');

    const visibleColumns = await gu.getVisibleColumns();
    assert.deepEqual(visibleColumns, ['A', 'C']);

    const hiddenColumns = await gu.getHiddenColumns();
    assert.deepEqual(hiddenColumns, ['B']);

    await gu.openSectionMenu('sortAndFilter', 'Widget 1');
    const sortColumns = await gu.getSortColumns();
    assert.deepEqual(sortColumns, [{ column: 'A', dir: 'asc' }]);

    // Second copy now.
    await gu.changeWidget('Table');

    await driver.sleep(5000);

    await gu.addInitialStyleRule();
    await gu.openStyleRuleFormula(0);
    await driver.sendKeys('True' + Key.ENTER);

    await gu.selectBy('Original widget');

    await driver.sleep(5000);

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
