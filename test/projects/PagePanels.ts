import {assert, driver, Key, Origin, stackWrapFunc} from 'mocha-webdriver';
import {server, setupTestSuite} from './testUtils';
import * as gu from 'test/nbrowser/gristUtils';

async function checkLeftPanelIsCollapsed() {
  assert.closeTo((await driver.find('.test-pp-left-panel').rect()).width, 50, 25);
}

async function checkLeftPanelIsExpanded() {
  assert.isAbove((await driver.find('.test-pp-left-panel').rect()).width, 120);
}

async function checkLeftPanelIsOverlapping() {
  assert.equal(
    (await driver.find('.test-pp-main-pane').rect()).left -
      (await driver.find('.test-pp-left-panel').rect()).left,
    48);
}

describe('PagePanels', function() {
  setupTestSuite();
  this.timeout(10000);      // Set a longer default timeout.

  before(async function() {
    this.timeout(60000);      // Set a longer default timeout.
    await driver.get(`${server.getHost()}/PagePanels`);
  });

  function dragByX(x: number) {
    return driver.withActions((a) => a.press().move({x, origin: Origin.POINTER}).release());
  }

  // Available test elements:
  //    .test-pp-left-panel
  //    .test-pp-left-resizer
  //    .test-pp-left-opener
  //    .test-pp-right-panel
  //    .test-pp-right-resizer
  //    .test-pp-right-opener
  //    .test-pp-show-right (only in fixture)

  it('should allow collapsing left panel', async function() {
    // Check that it has a reasonably large width, i.e. is open.
    assert.isAbove((await driver.find('.test-pp-left-panel').rect()).width, 120);

    // Close the panel, and wait for the transition.
    // Clicking a flipped element in chrome misses the element, the browser works better.
    await driver.executeScript("document.getElementsByClassName('test-pp-left-opener')[0].click()");
    await driver.sleep(500);
    assert.closeTo((await driver.find('.test-pp-left-panel').rect()).width, 50, 25);

    // Open the panel, and wait for the transition.
    await driver.find('.test-pp-left-opener').click();
    await driver.sleep(500);
    assert.isAbove((await driver.find('.test-pp-left-panel').rect()).width, 120);
  });

  it('should allow resizing left panel', async function() {
    // Small change is exact (i.e. not limited).
    const origWidth = (await driver.find('.test-pp-left-panel').rect()).width;
    await driver.find('.test-pp-left-resizer').mouseMove();
    await dragByX(20);
    assert.equal((await driver.find('.test-pp-left-panel').rect()).width, origWidth + 20);

    // Large change is limited.
    await dragByX(300);
    assert.isAbove((await driver.find('.test-pp-left-panel').rect()).width, origWidth + 20);
    assert.isBelow((await driver.find('.test-pp-left-panel').rect()).width, origWidth + 320);

    await driver.find('.test-pp-left-resizer').mouseMove();
    await dragByX(-300);
    assert.isBelow((await driver.find('.test-pp-left-panel').rect()).width, origWidth);
    assert.isAbove((await driver.find('.test-pp-left-panel').rect()).width, 100);
  });

  it('should allow collapsing right panel if shown', async function() {
    // Check that it has a reasonably large width, i.e. is open.
    assert.isTrue(await driver.find('.test-pp-right-panel').isDisplayed());
    assert.isAbove((await driver.find('.test-pp-right-panel').rect()).width, 120);

    // Close the panel, and wait for the transition.
    // Clicking a flipped element in chrome misses the element, the browser works better.
    await driver.executeScript("document.getElementsByClassName('test-pp-right-opener')[0].click()");
    await driver.sleep(500);
    assert.equal(await driver.find('.test-pp-right-panel').isDisplayed(), false);

    // Open the panel, and wait for the transition.
    await driver.find('.test-pp-right-opener').click();
    await driver.sleep(500);
    assert.equal(await driver.find('.test-pp-right-panel').isDisplayed(), true);
    assert.isAbove((await driver.find('.test-pp-right-panel').rect()).width, 120);

    // If no right panel, it's not shown, and no collapse icon.
    await driver.find('.test-pp-show-right').click();
    assert.equal(await driver.find('.test-pp-right-opener').isPresent(), false);
    assert.equal(await driver.find('.test-pp-right-panel').isPresent(), false);

    await driver.find('.test-pp-show-right').click();
    assert.equal(await driver.find('.test-pp-right-opener').isDisplayed(), true);
    assert.equal(await driver.find('.test-pp-right-panel').isDisplayed(), true);
  });

  it('should allow resizing right panel if shown', async function() {
    // Small change is exact (i.e. not limited).
    const origWidth = (await driver.find('.test-pp-right-panel').rect()).width;
    await driver.find('.test-pp-right-resizer').mouseMove();
    await dragByX(-20);
    assert.equal((await driver.find('.test-pp-right-panel').rect()).width, origWidth + 20);

    // Large change is limited.
    await dragByX(-300);
    assert.isAbove((await driver.find('.test-pp-right-panel').rect()).width, origWidth + 20);
    assert.isBelow((await driver.find('.test-pp-right-panel').rect()).width, origWidth + 320);

    await driver.find('.test-pp-right-resizer').mouseMove();
    await dragByX(300);
    assert.isAtMost((await driver.find('.test-pp-right-panel').rect()).width, origWidth);
    assert.isAbove((await driver.find('.test-pp-right-panel').rect()).width, 100);

    // No handle when panel not shown.
    await driver.find('.test-pp-show-right').click();
    assert.equal(await driver.find('.test-pp-right-resizer').isPresent(), false);
    assert.equal(await driver.find('.test-pp-right-panel').isPresent(), false);

    await driver.find('.test-pp-show-right').click();
    assert.equal(await driver.find('.test-pp-right-resizer').isDisplayed(), true);
    assert.equal(await driver.find('.test-pp-right-panel').isDisplayed(), true);
  });

  describe('optimized layout for narrow screen', async function() {
    let oldDimensions: gu.WindowDimensions;

    before(async () => {
      oldDimensions = await gu.getWindowDimensions();
    });

    after(async () => {
      const {width, height} = oldDimensions;
      await gu.setWindowDimensions(width, height);
    });

    it('should show bottom bar if narrow screen', async function() {

      // click optimizeNarrowScreen option and check that the bottom bar is not displayed
      await driver.find('.test-pp-optimize-narrow-screen').click();
      assert.equal(await driver.find('.test-pp-bottom-footer').isPresent(), false);

      // shrink window <768px and check the bottom bar is displayed
      await gu.setWindowDimensions(760, oldDimensions.height);
      assert.equal(await driver.find('.test-pp-bottom-footer').isDisplayed(), true);

      // check that only openers for narrow screen (-ns) shows.
      assert.equal(await driver.find('.test-pp-left-opener').isDisplayed(), false);
      assert.equal(await driver.find('.test-pp-right-opener').isDisplayed(), false);
      assert.equal(await driver.find('.test-pp-left-opener-ns').isDisplayed(), true);
      assert.equal(await driver.find('.test-pp-right-opener-ns').isDisplayed(), true);

      // enlarge window >768px and check the bottom bar is not displayed
      await gu.setWindowDimensions(770, oldDimensions.height);
      assert.equal(await driver.find('.test-pp-bottom-footer').isPresent(), false);

      // check that only regular openers shows.
      assert.equal(await driver.find('.test-pp-left-opener').isDisplayed(), true);
      assert.equal(await driver.find('.test-pp-right-opener').isDisplayed(), true);
      assert.equal(await driver.find('.test-pp-left-opener-ns').isPresent(), false);
      assert.equal(await driver.find('.test-pp-right-opener-ns').isPresent(), false);

      // shrink window again
      await gu.setWindowDimensions(760, oldDimensions.height);
    });

    it('should allow collapsing left panel', async function() {
      // When screen shrinks, panels get closed.
      assert.equal(await isSidePanelOpen('left'), false);

      // Open the panel
      await driver.find('.test-pp-left-opener-ns').click();
      await driver.sleep(500);
      assert.equal(await isSidePanelOpen('left'), true);

      // Close the panel
      await driver.find('.test-pp-left-opener-ns').click();
      await driver.sleep(500);
      assert.equal(await isSidePanelOpen('left'), false);
    });


    it('left panel should overlap main content', async function() {
      // Open left panel again.
      await driver.find('.test-pp-left-opener-ns').click();
      await driver.sleep(500);

      // Check the position of the main content
      assert.equal(
        (await driver.find('.test-pp-main-pane').rect()).left,
        (await driver.find('.test-pp-left-panel').rect()).left);

      // Check that the overlay is present
      assert.equal(await driver.find('.test-pp-overlay').isDisplayed(), true);

      // resize window
      await gu.setWindowDimensions(770, oldDimensions.height);

      // Check that the overlay is not present
      assert.equal(await driver.find('.test-pp-overlay').isDisplayed(), false);

      // shrink window again
      await gu.setWindowDimensions(760, oldDimensions.height);

      // Panel should get closed, and overlay should be absent.
      assert.equal(await isSidePanelOpen('left'), false);
      assert.equal(await driver.find('.test-pp-overlay').isDisplayed(), false);

      // Open the panel
      await driver.find('.test-pp-left-opener-ns').click();
      await driver.sleep(500);
      assert.equal(await isSidePanelOpen('left'), true);
      assert.equal(await driver.find('.test-pp-overlay').isDisplayed(), true);
    });

    it('should not allow resizing left panel', async function() {
      assert.equal(await isSidePanelOpen('left'), true);

      // check that the resizer is not displayed
      assert.equal(await driver.find('.test-pp-left-resizer').isDisplayed(), false);
    });

    it('should not allow to have the 2 panels opened', async function() {
      // check that left panel is opened:
      assert.equal(await isSidePanelOpen('left'), true);

      // Open the right panel
      await driver.find('.test-pp-right-opener-ns').click();
      await driver.sleep(500);

      // Check left is closed and right is opened
      assert.equal(await isSidePanelOpen('left'), false);
      assert.equal(await isSidePanelOpen('right'), true);

      // Close right panel
      await driver.find('.test-pp-right-opener-ns').click();
      await driver.sleep(500);

      // Check left and right are closed
      assert.equal(await isSidePanelOpen('left'), false);
      assert.equal(await isSidePanelOpen('right'), false);

      // Open right panel
      await driver.find('.test-pp-right-opener-ns').click();
      await driver.sleep(500);

      // Check left is closed and right is opened
      assert.equal(await isSidePanelOpen('left'), false);
      assert.equal(await isSidePanelOpen('right'), true);

      // Open the left panel
      await driver.find('.test-pp-left-opener-ns').click();
      await driver.sleep(500);

      // Check left is opened and right is closed
      assert.equal(await isSidePanelOpen('left'), true);
      assert.equal(await isSidePanelOpen('right'), false);
    });


    it('should allow collapsing right panel if shown', async function() {
      // If no right panel, then no collapse icon.
      await driver.find('.test-pp-show-right').click();
      assert.equal(await driver.find('.test-pp-right-opener-ns').isPresent(), false);

      await driver.find('.test-pp-show-right').click();
      assert.equal(await driver.find('.test-pp-right-opener-ns').isDisplayed(), true);

      // Open the right panel
      await driver.find('.test-pp-right-opener-ns').click();
      await driver.sleep(500);
      assert.equal(await isSidePanelOpen('right'), true);
    });

    it('right panel should overlap main content', async function() {
      // Check that left is closed and right is opened
      assert.equal(await isSidePanelOpen('left'), false);
      assert.equal(await isSidePanelOpen('right'), true);

      // Check the position of the main content
      assert.equal(
        (await driver.find('.test-pp-main-pane').rect()).right,
        (await driver.find('.test-pp-right-panel').rect()).right);

      // Check that the overlay is present
      assert.equal(await driver.find('.test-pp-overlay').isDisplayed(), true);

      // resize window and check that the overlay disappears
      await gu.setWindowDimensions(770, oldDimensions.height);
      assert.equal(await driver.find('.test-pp-overlay').isDisplayed(), false);

      // shrink window again
      await gu.setWindowDimensions(760, oldDimensions.height);

      // Check that left and right are closed
      assert.equal(await isSidePanelOpen('left'), false);
      assert.equal(await isSidePanelOpen('right'), false);

      // check the overlay disappeard
      assert.equal(await driver.find('.test-pp-overlay').isDisplayed(), false);

      // Open the panel
      await driver.find('.test-pp-right-opener-ns').click();
      await driver.sleep(500);
      assert.equal(await isSidePanelOpen('right'), true);
    });


    it('should not allow resizing right panel if shown', async function() {
      assert.equal(await isSidePanelOpen('right'), true);

      // Check resize is not displayed
      assert.equal(await driver.find('.test-pp-right-resizer').isDisplayed(), false);

      // revert to old size
      await gu.setWindowDimensions(oldDimensions.width, oldDimensions.height);

      // Ensure right panel is open (it depends on its state when the window was large previously).
      if (!await isSidePanelOpen('right')) {
        // Clicking a flipped element in chrome misses the element, the browser works better.
        await driver.executeScript("document.getElementsByClassName('test-pp-right-opener')[0].click()");
        await driver.sleep(500);
      }
      assert.equal(await isSidePanelOpen('right'), true);

      // check resizer is back
      assert.equal(await driver.find('.test-pp-right-resizer').isDisplayed(), true);
    });

    it('should closes side bars when tapping content area', async function() {
      // shrink window again
      await gu.setWindowDimensions(760, oldDimensions.height);

      await driver.find('.test-pp-right-opener-ns').click();
      await driver.sleep(500);

      // check that left is closed and right opened
      assert.equal(await isSidePanelOpen('left'), false);
      assert.equal(await isSidePanelOpen('right'), true);

      // click on the content area (the overlay)
      await driver.find('.test-pp-overlay').click();

      // check that the right panel is closed
      assert.equal(await isSidePanelOpen('left'), false);
      assert.equal(await isSidePanelOpen('right'), false);

      // open the left panel
      await driver.find('.test-pp-left-opener-ns').click();

      // check the left panel is open
      assert.equal(await isSidePanelOpen('left'), true);
      assert.equal(await isSidePanelOpen('right'), false);

      // click on the content area
      await driver.find('.test-pp-overlay').click();

      // check the left panel is closed
      assert.equal(await isSidePanelOpen('left'), false);
      assert.equal(await isSidePanelOpen('right'), false);

      // open the right panel for subsequent test
      await driver.find('.test-pp-right-opener-ns').click();
      await driver.sleep(500);
      assert.equal(await isSidePanelOpen('right'), true);
    });

    const isSidePanelOpen = stackWrapFunc(async function(which: 'left'|'right'): Promise<boolean> {
      return driver.find(`.test-pp-${which}-panel`).matches('[class*=-open]');
    });
  });

  describe('PageWidgetPicker', () => {

    const waitAssertPickerShown = stackWrapFunc(async function() {
      assert.isTrue(await driver.findWait('.test-wselect-data', 100).isDisplayed());
    });
    const assertNoPicker = stackWrapFunc(async function() {
      assert.isFalse(await driver.find('.test-wselect-data').isPresent());
    });


    it('should trigger properly from the add new menu', async () => {
      // open picker from the add new menu
      await driver.find('.test-pp-addNew').doClick();
      await driver.find('.test-pp-addNewPage').doClick();

      // check that the menu closed and the picker is visible
      await waitAssertPickerShown();
    });

    it('should close on save', async () => {

      // assert `Add to ...` button is disabled
      assert.equal(await driver.find('.test-wselect-addBtn').getAttribute('disabled'), 'true');

      // click `Add to ...' button
      await driver.find('.test-wselect-addBtn').doClick();

      // picker still there,
      await waitAssertPickerShown();

      // select 'New Table'
      await driver.findContent('.test-wselect-table', /New Table/).doClick();

      // click `Add to ...' button
      await driver.find('.test-wselect-addBtn').doClick();

      // check that the picker is gone
      await assertNoPicker();
    });

    it('should allow save on Enter, cancel on escape', async () => {
      // open Add new menu then set focus on 'Page' and press Enter
      await driver.find('.test-pp-addNew').doClick();
      await driver.executeScript(`document.querySelector('.test-pp-addNewPage').focus();`);
      await driver.sendKeys(Key.ENTER);

      // check that the picker is open
      await waitAssertPickerShown();

      // press Escape
      await driver.sendKeys(Key.ESCAPE);

      // check that the picker is gone
      await assertNoPicker();

      // re-open the picker, select 'New Table' press enter
      await driver.find('.test-pp-addNew').doClick();
      await driver.find('.test-pp-addNewPage').doClick();
      await waitAssertPickerShown();
      await driver.findContent('.test-wselect-table', /New Table/).doClick();
      await driver.sendKeys(Key.ENTER);

      // check that the picker is gone
      await assertNoPicker();

    });

    it('should trigger properly from the basic button on the right pane', async () => {
      // click on the button
      // await driver.find('.test-pp-editDataBtn').doClick();
      await driver.executeScript("document.getElementsByClassName('test-pp-editDataBtn')[0].click()");

      // check that the picker is there
      await waitAssertPickerShown();

      // close the picker and check that it's gone
      await driver.sendKeys(Key.ESCAPE);
      await assertNoPicker();
    });
  });

  describe('auto expanding left panel', async function() {

    it('should expand on mouse enter', async function() {
      await driver.find('.test-pp-right-panel').mouseMove();
      await closeLeftPanel();
      await driver.find('.test-pp-left-panel').mouseMove();
      await driver.sleep(500 + 450);
      await checkLeftPanelIsExpanded();

      // check panel is overlaping
      await checkLeftPanelIsOverlapping();
    });

    it('should collapsed on mouse leave', async function() {
      await driver.find('.test-pp-right-panel').mouseMove();
      await driver.sleep(500);
      await checkLeftPanelIsCollapsed();
    });

    it('should allow to retract for a fraction of a second', async function() {
      // move mouse in
      await driver.find('.test-pp-left-panel').mouseMove();

      // wait but not too long
      await driver.sleep(100);

      // check panel did not expand
      await checkLeftPanelIsCollapsed();

      // move mouse out
      await driver.find('.test-pp-main-pane').mouseMove();

      // check panel still collapsed
      await checkLeftPanelIsCollapsed();

      // wait another
      await driver.sleep(500 + 350);

      // check panel still collapsed
      await checkLeftPanelIsCollapsed();
    });

    it('should show the vertical resizer correctly', async function() {

      // initially disbaled resizer is visible
      assert.equal(await driver.find('.test-pp-left-disabled-resizer').isDisplayed(), true);
      assert.equal(await driver.find('.test-pp-left-resizer').isDisplayed(), false);

      // move mouse in
      await driver.find('.test-pp-left-panel').mouseMove();
      await driver.sleep(500);

      // check disbaled resizer is visible
      assert.equal(await driver.find('.test-pp-left-disabled-resizer').isDisplayed(), true);
      assert.equal(await driver.find('.test-pp-left-resizer').isDisplayed(), false);

      // leave mouse
      await driver.find('.test-pp-right-panel').mouseMove();
      await driver.sleep(500);

      // check disbaled resizer is visible
      assert.equal(await driver.find('.test-pp-left-disabled-resizer').isDisplayed(), true);
      assert.equal(await driver.find('.test-pp-left-resizer').isDisplayed(), false);

      // let's check resizers when clicking the left opener
      await driver.executeScript("document.getElementsByClassName('test-pp-left-opener')[0].click()");
      await driver.sleep(500);

      // check real resizer is visible
      assert.equal(await driver.find('.test-pp-left-disabled-resizer').isDisplayed(), false);
      assert.equal(await driver.find('.test-pp-left-resizer').isDisplayed(), true);

      // click opener again
      await driver.executeScript("document.getElementsByClassName('test-pp-left-opener')[0].click()");
      await driver.sleep(500);

      // check real resizer is visible
      assert.equal(await driver.find('.test-pp-left-disabled-resizer').isDisplayed(), true);
      assert.equal(await driver.find('.test-pp-left-resizer').isDisplayed(), false);
    });

    it('should correctly overlap on this edge case', async function () {
      // move mouse in and wait for full expansion
      await driver.find('.test-pp-left-panel').mouseMove();
      await driver.sleep(500);

      // briefly leave mouse and quickly move mouse back-in
      await driver.find('.test-pp-right-panel').mouseMove();
      await driver.sleep(100);
      await driver.find('.test-pp-left-panel').mouseMove();

      // wait for panel to expand again
      await driver.sleep(500);

      // check that panel is overlapping
      await checkLeftPanelIsOverlapping();

      // leave mouse and wait for full collapse
      await driver.find('.test-pp-right-panel').mouseMove();
      await driver.sleep(500);

      // check panels state
      await checkLeftPanelIsCollapsed();
    });

    it('should not collapse when a menu is expanded', async function() {
      // move mouse in and wait for full expansion
      await driver.find('.test-pp-left-panel').mouseMove();
      await driver.sleep(500 + 450);
      await checkLeftPanelIsExpanded();

      // open menu
      await driver.find('.test-pages-page').mouseMove();
      await driver.find('.test-docpage-dots').click();

      // move mouse to the middle of the menu
      await driver.find('.grist-floating-menu').mouseMove();
      await driver.sleep(500);

      // check panel is still expanded
      await checkLeftPanelIsExpanded();

      // move mouse outside
      await driver.find('.test-pp-right-panel').mouseMove();
      await driver.sleep(500);

      // check panel is still expanded
      await checkLeftPanelIsExpanded();

      // check the menu is still present
      assert.isTrue(await driver.find('.grist-floating-menu').isPresent());

      // click outside
      await driver.find('.test-pp-right-panel').click();
      await driver.sleep(500);

      // check panel is collapsed
      await checkLeftPanelIsCollapsed();

      // check the menu is closed
      assert.isFalse(await driver.find('.grist-floating-menu').isPresent());
    });

    it('should not collapse when renaming page (or any other input has focus)', async function() {
      // move mouse in and wait for full expansion
      await driver.find('.test-pp-left-panel').mouseMove();
      await driver.sleep(500 + 450);
      await checkLeftPanelIsExpanded();

      // open 3-dot menu and click rename
      await driver.find('.test-pages-page').mouseMove();
      await driver.find('.test-docpage-dots').click();

      // For reason I don't understand blur watch on the client does not work when triggering click
      // using driver.findContent(...).click(). But it does when using a script call.
      await driver.executeScript(
        (el: any) => el.click(),
        driver.findContent('.grist-floating-menu li', 'Rename')
      );
      await driver.sleep(20);

      // move the mouse out
      await driver.find('.test-pp-right-panel').mouseMove();
      await driver.sleep(500);

      // check the pane is expanded
      await checkLeftPanelIsExpanded();

      // check the transient input is present
      assert.isTrue(await driver.find('.test-docpage-editor').isPresent());

      // click outside
      await driver.find('.test-pp-right-panel').click();
      await driver.sleep(500);

      // check the pane is collapsed
      await checkLeftPanelIsCollapsed();

      // the transient input is gone
      assert.isFalse(await driver.find('.test-docpage-editor').isPresent());
    });

  });
});



async function closeLeftPanel() {
  if ((await driver.find('.test-pp-left-panel').rect()).width > 50) {
    await driver.executeScript("document.getElementsByClassName('test-pp-left-opener')[0].click()");
    await driver.sleep(500);
  }
}
