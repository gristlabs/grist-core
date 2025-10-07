import {assert, driver} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('CardView', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();
  let session: gu.Session;
  let docId: string;

  before(async function() {
    session = await gu.session().login();
    docId = (await session.tempDoc(cleanup, "Favorite_Films.grist")).id;

    await gu.toggleSidePanel('right');
    await driver.find('.test-config-data').click();
  });

  it('should not show card view controls when section is scroll-linked', async function() {
    // Select the card section.
    await driver.findContent('.test-treeview-itemHeader', /All/).click();
    await driver.find('.detailview_single').click();

    // Assert that the controls are initially displayed.
    await assertCardViewControls(true);

    // Change the section to be scroll-linked.
    await driver.find('.test-right-select-by').click();
    await driver.findContent('.test-select-menu li', /Performances record/).click();
    await gu.waitForServer();

    // Assert that the controls are now not displayed.
    await assertCardViewControls(false);

    // Change the section to be filter-linked.
    await driver.find('.test-right-select-by').click();
    await driver.findContent('.test-select-menu li', /Performances record • Film/).click();
    await gu.waitForServer();

    // Assert that the controls are displayed again.
    await assertCardViewControls(true);

    // Reset linking.
    await driver.find('.test-right-select-by').click();
    await driver.findContent('.test-select-menu li', /Select Widget/).click();
    await gu.waitForServer();

    // Assert that the controls are still displayed.
    await assertCardViewControls(true);

    // Now let's change a section to be column scroll-linked (not just section scroll-linked)
    // and check that the controls are not displayed.
    await gu.getSection('Films record').click();
    await driver.find('.test-pwc-editDataSelection').click();
    await driver.findContentWait('.test-wselect-type', /Card/, 100).click();
    await driver.find('.test-wselect-addBtn').click();
    await gu.waitForServer();
    await driver.find('.test-right-select-by').click();
    await driver.findContent('.test-select-menu li', /Performances record • Film/).click();
    await gu.waitForServer();

    // Assert that the controls are not displayed.
    await assertCardViewControls(false);

    // Reset linking and section type.
    await driver.find('.test-right-select-by').click();
    await driver.findContent('.test-select-menu li', /Select Widget/).click();
    await driver.find('.test-pwc-editDataSelection').click();
    await driver.findContentWait('.test-wselect-type', /Table/, 100).click();
    await driver.find('.test-wselect-addBtn').click();
    await gu.waitForServer();
  });

  it('should save theme changes', async function() {
    // Change the theme and check that it persists across refresh.
    await gu.getSection('Performances detail').click();
    await driver.find('.test-config-widget').click();
    await driver.find('.test-vconfigtab-detail-theme').click();
    await driver.findContentWait('.test-select-row', /Compact/, 100).click();
    await gu.waitForServer();
    await driver.navigate().refresh();
    await gu.waitForDocToLoad();
    await gu.getSection('Performances detail').click();
    await driver.find('.test-config-widget').click();
    const themeSelect = await driver.findWait('.test-vconfigtab-detail-theme', 10000);
    assert(await themeSelect.getText(), 'Compact');

    // Change it back.
    await themeSelect.click();
    await driver.findContentWait('.test-select-row', /Form/, 100).click();
    await gu.waitForServer();
  });

  it('should render widgets with reasonably consistent heights', async function() {
    // Add a few more fields of different types.
    const api = session.createHomeApi();
    await api.applyUserActions(docId, [
      ['AddColumn', 'Performances', 'Files', {type: 'Attachments'}],
      ['AddColumn', 'Performances', 'Choice', {type: 'Choice'}],
      ['AddColumn', 'Performances', 'ChoiceList', {type: 'ChoiceList'}],
      ['AddColumn', 'Performances', 'Bool', {type: 'Bool'}],
    ]);
    await gu.getSection('Performances detail').click();
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-config-widget').click();

    // Show all fields in the one Card section we have.
    while (true) {  // eslint-disable-line no-constant-condition
      try {
        await driver.find('.test-vfc-hidden-fields .kf_draggable').mouseMove().find('.test-vfc-hide').click();
        await gu.waitForServer();
      } catch (e) {
        if (e.name === 'NoSuchElementError') { break; }
        throw e;
      }
    }

    // Get the heights all the fields in our section.
    await gu.getSection('Performances detail').click();
    // Actor and Film are wrapped
    await driver.find('.test-right-tab-field').click();
    await gu.getDetailCell('Actor', 1).click();
    await driver.find('.test-tb-wrap-text').click();
    await gu.getDetailCell('Film', 1).click();
    await driver.find('.test-tb-wrap-text').click();
    const cols = ['Actor', 'Film', 'Character', 'Files', 'Choice', 'ChoiceList', 'Bool'];
    const fields = await Promise.all(cols.map((col) =>
      gu.getVisibleDetailCells({col, rowNums: [1], mapper: (e) => e.getRect()})));

    // Make sure the heights are close to each other.
    const heights = fields.map(f => f[0].height);
    const minHeight = Math.min(...heights);
    const maxHeight = Math.max(...heights);
    assert.isAtLeast(minHeight, maxHeight - 1, "Too wide a range of heights");
  });
});

async function assertCardViewControls(visible: boolean) {
  const section = await driver.find('.active_section');
  assert.equal(await section.find('.grist-single-record__menu .detail-left').isPresent(), visible);
  assert.equal(await section.find('.grist-single-record__menu .detail-right').isPresent(), visible);
  assert.equal(await section.find('.grist-single-record__menu .detail-add-btn').isPresent(), visible);
  assert.equal(await section.find('.grist-single-record__menu .grist-single-record__menu__count').isPresent(), visible);
}
