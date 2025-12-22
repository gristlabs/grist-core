import { assert, driver, Key } from "mocha-webdriver";
import { describe } from "mocha";
import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

// Check that the focus is on the clipboard element, with a short wait in case it's not entirely
// synchronous. You may set waitMs to 0.
const expectClipboardFocus = (yesNo: boolean, waitMs: number = 100) => {
  return gu.waitForFocus('textarea.copypaste.mousetrap', yesNo, waitMs);
};

const isNormalElementFocused = async (containerSelector?: string) => {
  const activeElement = await driver.switchTo().activeElement();
  const isException = await activeElement.matches(
    '.test-left-panel, .test-top-header, .test-right-panel, .test-main-content, body, textarea.copypaste.mousetrap',
  );
  const isInContainer = containerSelector ?
    await activeElement.matches(`${containerSelector} *`) :
    true;
  return !isException && isInContainer;
};

/**
 * tab twice: if we managed to focus things we consider "normal elements", we assume we can use tab to navigate
 */
const assertTabToNavigate = async (containerSelector?: string) => {
  await driver.sendKeys(Key.TAB);
  assert.isTrue(await isNormalElementFocused(containerSelector));

  await driver.sendKeys(Key.TAB);
  assert.isTrue(await isNormalElementFocused(containerSelector));
};

const cycle = async (dir: 'forward' | 'backward' = 'forward') => {
  const modKey = await gu.modKey();
  const shortcut = dir === 'forward' ?
    Key.chord(modKey, 'o') :
    Key.chord(modKey, Key.SHIFT, 'O');

  await gu.sendKeys(shortcut);
};

const toggleCreatorPanelFocus = async () => {
  const modKey = await gu.modKey();
  await gu.sendKeys(Key.chord(modKey, Key.ALT, 'o'));
};

const panelMatchs = {
  left: '.test-left-panel',
  top: '.test-top-header',
  right: '.test-right-panel',
  main: '.test-main-content',
};
const assertPanelFocus = async (panel: 'left' | 'top' | 'right' | 'main', expected: boolean = true) => {
  assert.equal(await gu.hasFocus(panelMatchs[panel]), expected);
};

const assertSectionFocus = async (sectionId: number, expected: boolean = true) => {
  await expectClipboardFocus(expected);
  assert.equal(await gu.getSectionId() === sectionId, expected);
};

/**
 * check if we can do a full cycle through regions with nextRegion/prevRegion commands
 *
 * `sections` is the number of view sections currently on the page.
 */
const assertCycleThroughRegions = async ({ sections = 1 }: { sections?: number } = {}) => {
  await cycle();
  await assertPanelFocus('left');

  await cycle();
  await assertPanelFocus('top');

  if (sections) {
    let sectionsCount = 0;
    while (sectionsCount < sections) {
      await cycle();
      await expectClipboardFocus(true);
      sectionsCount++;
    }
  }
  else {
    await cycle();
    await assertPanelFocus('main');
  }

  await cycle();
  await assertPanelFocus('left');

  if (sections) {
    let sectionsCount = 0;
    while (sectionsCount < sections) {
      await cycle('backward');
      await expectClipboardFocus(true);
      sectionsCount++;
    }
  }
  else {
    await cycle('backward');
    await assertPanelFocus('main');
  }

  await cycle('backward');
  await assertPanelFocus('top');

  await cycle('backward');
  await assertPanelFocus('left');
};

describe("RegionFocusSwitcher", function () {
  this.timeout(60000);
  const cleanup = setupTestSuite();

  it("should tab though elements in non-document pages", async () => {
    const session = await gu.session().teamSite.login();

    await session.loadDocMenu("/");
    await assertTabToNavigate();

    await gu.openProfileSettingsPage();
    await assertTabToNavigate();
  });

  it("should keep the active section focused at document page load", async () => {
    const session = await gu.session().teamSite.login();
    await session.tempDoc(cleanup, 'Hello.grist');

    await expectClipboardFocus(true, 0);
    assert.equal(await gu.getActiveCell().getText(), 'hello');
    await driver.sendKeys(Key.TAB);
    // after pressing tab once, we should be on the [first row, second column]-cell
    const secondCellText = await gu.getCell(1, 1).getText();
    const activeCellText = await gu.getActiveCell().getText();
    assert.equal(activeCellText, secondCellText);
    await expectClipboardFocus(true, 0);
  });

  it("should cycle through regions with (Shift+)Ctrl+O", async () => {
    const session = await gu.session().teamSite.login();
    await session.loadDocMenu("/");

    await assertCycleThroughRegions({ sections: 0 });

    await session.tempNewDoc(cleanup);
    await assertCycleThroughRegions({ sections: 1 });

    await gu.addNewSection(/Card List/, /Table1/);
    await gu.reloadDoc();
    await assertCycleThroughRegions({ sections: 2 });
  });

  it("should toggle creator panel with Alt+Ctrl+O", async () => {
    const session = await gu.session().teamSite.login();
    await session.tempNewDoc(cleanup);

    const firstSectionId = await gu.getSectionId();

    // test if shortcut works with one view section:
    // press the shortcut two times to focus creator panel, then focus back the view section
    await toggleCreatorPanelFocus();
    await assertPanelFocus('right');

    await toggleCreatorPanelFocus();
    await assertSectionFocus(firstSectionId);

    // add a new section, make sure it's the active section/focus after creation
    await gu.addNewSection(/Card List/, /Table1/);
    const secondSectionId = await gu.getSectionId();
    await assertSectionFocus(secondSectionId);

    // toggle creator panel again: make sure it goes back to the new section
    await toggleCreatorPanelFocus();
    await assertPanelFocus('right');

    await toggleCreatorPanelFocus();
    await assertSectionFocus(secondSectionId);

    // combine with cycle shortcut: when focus is on a panel, toggling creator panel focuses back the current view
    await cycle();
    await assertPanelFocus('left');

    await toggleCreatorPanelFocus();
    await assertPanelFocus('right');

    await toggleCreatorPanelFocus();
    await assertSectionFocus(secondSectionId);

    // cycle to previous section and make sure all focus is good
    await cycle('backward');
    await assertSectionFocus(firstSectionId);

    await toggleCreatorPanelFocus();
    await assertPanelFocus('right');

    await toggleCreatorPanelFocus();
    await assertSectionFocus(firstSectionId);

    await toggleCreatorPanelFocus();
    await assertPanelFocus('right');

    await cycle();
    await assertSectionFocus(secondSectionId);

    await toggleCreatorPanelFocus();
    await toggleCreatorPanelFocus();
    await assertSectionFocus(secondSectionId);
  });

  it("should tab through elements when inside a region", async function() {
    const session = await gu.session().teamSite.login();
    await session.tempNewDoc(cleanup);

    await cycle();
    await assertTabToNavigate('.test-left-panel');

    await cycle();
    await assertTabToNavigate('.test-top-header');

    await toggleCreatorPanelFocus();
    await assertTabToNavigate('.test-right-panel');

    await toggleCreatorPanelFocus();
    await driver.sendKeys(Key.TAB);
    await expectClipboardFocus(true);
  });

  it("should exit from a region when pressing Esc", async function() {
    const session = await gu.session().teamSite.login();
    await session.tempNewDoc(cleanup);

    await cycle();
    await driver.sendKeys(Key.ESCAPE);
    await assertPanelFocus('left', false);
    await expectClipboardFocus(true);
  });

  it("should remember the last focused element in a panel", async function() {
    const session = await gu.session().teamSite.login();
    await session.tempNewDoc(cleanup);

    await cycle();
    await driver.sendKeys(Key.TAB);
    assert.isTrue(await isNormalElementFocused('.test-left-panel'));

    await cycle(); // top
    await cycle(); // main
    await cycle(); // back to left
    assert.isTrue(await isNormalElementFocused('.test-left-panel'));

    // when pressing escape in that case, first focus back to the panel…
    await driver.sendKeys(Key.ESCAPE);
    await assertPanelFocus('left');

    // … then reset the kb focus as usual
    await driver.sendKeys(Key.ESCAPE);
    await expectClipboardFocus(true);
  });

  it("should focus a panel-region when clicking an input child element", async function() {
    const session = await gu.session().teamSite.login();
    await session.tempNewDoc(cleanup);

    // Click on an input on the top panel
    await driver.find('.test-bc-doc').click();
    await driver.sendKeys(Key.TAB);
    assert.isTrue(await isNormalElementFocused('.test-top-header'));

    // in that case (mouse click) when pressing esc, we directly focus back to view section
    await driver.sendKeys(Key.ESCAPE);
    await assertPanelFocus('top', false);
    await expectClipboardFocus(true, 0);
  });

  it("should focus a section-region when clicking on it", async function() {
    const session = await gu.session().teamSite.login();
    await session.tempNewDoc(cleanup);

    await cycle(); // left
    await driver.sendKeys(Key.TAB);
    assert.isTrue(await isNormalElementFocused('.test-left-panel'));

    await gu.getActiveCell().click();

    await assertPanelFocus('left', false);
    await expectClipboardFocus(true, 0);
  });

  it("should keep the active section focused when clicking a link or button of a panel-region", async function() {
    const session = await gu.session().teamSite.login();
    await session.tempNewDoc(cleanup);

    await gu.enterCell('test');
    await driver.find('.test-undo').click();
    await assertPanelFocus('top', false);
    await expectClipboardFocus(true, 0);
  });

  afterEach(() => gu.checkForErrors());
});
