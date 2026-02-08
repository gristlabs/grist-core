import { UserAPI } from "app/common/UserAPI";
import * as gu from "test/nbrowser/gristUtils";
import { server, setupTestSuite } from "test/nbrowser/testUtils";

import { addToRepl, assert, driver, Key } from "mocha-webdriver";

describe("ViewLayout", function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  let api: UserAPI;

  it("should update when view section's type (.parentKey) changes", async () => {
    // create api
    api = gu.createHomeApi("Chimpy", "nasa");
    addToRepl("api", api, "home api");

    // create and open new document
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", "nasa");
    const docId = await gu.createNewDoc("Chimpy", "nasa", "Horizon", "test-viewLayout");
    await gu.loadDoc(`/o/nasa/doc/${docId}`);

    // check app shows table1 as a table
    assert.equal(await gu.getActiveSectionTitle(), "TABLE1");
    await gu.checkForErrors();

    // using api changes parentKey to 'single' and check  view udpated
    await api.applyUserActions(docId, [["UpdateRecord", "_grist_Views_section", 1, { parentKey: "detail" }]]);
    assert.equal(await gu.getActiveSectionTitle(), "TABLE1 Card List");
    await gu.checkForErrors();

    // change parentKey to 'detail' and check view udpated
    await api.applyUserActions(docId, [["UpdateRecord", "_grist_Views_section", 1, { parentKey: "single" }]]);
    assert.equal(await gu.getActiveSectionTitle(), "TABLE1 Card");
    await gu.checkForErrors();

    // change parentKey to chart and check view updated
    await api.applyUserActions(docId, [["UpdateRecord", "_grist_Views_section", 1, { parentKey: "chart" }]]);
    assert.equal(await gu.getActiveSectionTitle(), "TABLE1 Chart");
    await gu.checkForErrors();

    // change parent key back to grid and check
    await api.applyUserActions(docId, [["UpdateRecord", "_grist_Views_section", 1, { parentKey: "record" }]]);
    assert.equal(await gu.getActiveSectionTitle(), "TABLE1");
    await gu.checkForErrors();
  });

  it("should allow to rename a section", async () => {
    // rename `TABLE1`
    await gu.selectSectionByTitle("TABLE1");
    await gu.renameActiveSection("renamed");
    assert.equal(await gu.getActiveSectionTitle(), "renamed");

    // check new name persists across a doc reload
    await driver.navigate().refresh();
    await gu.waitForDocToLoad();

    // empty string should revert back to default
    await gu.selectSectionByTitle("renamed");
    await gu.renameActiveSection("");
    assert.equal(await gu.getActiveSectionTitle(), "TABLE1");
  });

  it("should allow to cycle through sections using shortcuts", async () => {
    async function nextSection(count: number = 1) {
      return gu.sendKeys(...Array(count).fill(Key.chord(await gu.modKey(), "o")));
    }

    async function prevSection(count: number = 1) {
      return gu.sendKeys(...Array(count).fill(Key.chord(await gu.modKey(), Key.SHIFT, "o")));
    }

    // import World.grist
    const doc = await gu.importFixturesDoc("chimpy", "nasa", "Horizon", "World.grist", false);

    // open the Country page
    await gu.loadDoc(`/o/nasa/doc/${doc.id}/p/5`); // open Country

    // check that the active section is COUNTRY
    assert.equal(await gu.getActiveSectionTitle(), "COUNTRY");

    // go to next section
    await nextSection();

    // check the active section is COUNTRY Card List
    assert.equal(await gu.getActiveSectionTitle(), "COUNTRY Card List");

    // go to previous section
    await prevSection();

    // check the active section is COUNTRY
    assert.equal(await gu.getActiveSectionTitle(), "COUNTRY");

    // select COUNTRYLANGUAGE (last in cycle)
    await gu.getSection("COUNTRYLANGUAGE").click();

    // go to next section: now it is the left panel, then top panel, then the first section again.
    await nextSection(3);

    // check the active section is COUNTRY
    assert.equal(await gu.getActiveSectionTitle(), "COUNTRY");

    // go to previous section
    await prevSection(3);

    // check the active section is COUNTRYLANGUAGE
    assert.equal(await gu.getActiveSectionTitle(), "COUNTRYLANGUAGE");
  });

  describe("NarrowScreen", function() {
    let oldDimensions: gu.WindowDimensions;
    before(async () => { oldDimensions = await gu.getWindowDimensions(); });
    after(async () => {
      const { width, height } = oldDimensions;
      await gu.setWindowDimensions(width, height);
    });

    it("should collapse inactive view sections", async function() {
      // Open document.
      const session = await gu.session().login();
      await session.tempDoc(cleanup, "Favorite_Films.grist");

      // Check what view sections there are.
      await gu.getPageItem("All").click();
      await gu.waitForServer();
      assert.deepEqual(await gu.getSectionTitles(),
        ["Performances record", "Performances detail", "Films record", "Friends record"]);

      // Shrink window to small size (this is iPhone dimensions).
      await gu.setWindowDimensions(375, 667);

      // Check all view sections are still visible.
      assert.deepEqual(await gu.getSectionTitles(),
        ["Performances record", "Performances detail", "Films record", "Friends record"]);

      // Check that the active is the only one whose content is shown.
      assert.deepEqual(await driver.findAll(".view_data_pane_container", el => el.isDisplayed()),
        [true, false, false, false]);

      // Check that the inactive section are small.
      await gu.waitToPass(async () => {
        assert.deepInclude(await gu.getSection("Performances detail").getRect(), { width: 32 });
        assert.deepInclude(await gu.getSection("Films record").getRect(), { height: 32 });
        assert.deepInclude(await gu.getSection("Friends record").getRect(), { height: 32 });

        assert.isAbove((await gu.getSection("Performances record").getRect()).height, 100);
      });

      // Click another section.
      await gu.getSection("Friends record").click();

      // Check the clicked section is now the only one shown.
      assert.deepEqual(await driver.findAll(".view_data_pane_container", el => el.isDisplayed()),
        [false, false, false, true]);

      // Check that the other sections are small.
      await gu.waitToPass(async () => {
        assert.deepInclude(await gu.getSection("Performances record").getRect(), { height: 32 });
        assert.deepInclude(await gu.getSection("Performances detail").getRect(), { height: 32 });
        assert.deepInclude(await gu.getSection("Films record").getRect(), { width: 32 });

        assert.isAbove((await gu.getSection("Friends record").getRect()).height, 100);
      });
    });
  });
});
