import {
  assert,
  driver,
  Key,
  stackWrapFunc,
  WebElement,
} from "mocha-webdriver";
import fetch from "node-fetch";
import * as gu from "test/nbrowser/gristUtils";
import { server, setupTestSuite } from "test/nbrowser/testUtils";

describe("AttachmentsWidget", function () {
  this.timeout(20000);
  const cleanup = setupTestSuite();
  let docId: string;
  let session: gu.Session;

  before(async function () {
    session = await gu.session().user("user1").teamSite.login();
    docId = (await session.tempDoc(cleanup, "Hello.grist")).id;
  });

  afterEach(async function () {
    await gu.checkForErrors();
  });

  after(async function () {
    // Close any open cell/attachments editor, to avoid an unload alert that would interfere with
    // the next test suite.
    await driver.sendKeys(Key.ESCAPE);
  });

  // Returns the 'title' attributes of all attachments in the given cell. These should be the
  // names of the attached files.
  const getCellThumbnailTitles = stackWrapFunc(async function (
    cell: WebElement
  ) {
    return await cell.findAll(".test-pw-thumbnail", (el) =>
      el.getAttribute("title")
    );
  });

  it("should include a functioning attachment widget", async function () {
    await gu.toggleSidePanel("right", "open");
    await driver.find(".test-right-tab-field").click();

    // Move to first column
    await gu.getCell(0, 1).click();

    // Change type to Attachment.
    await gu.setType(/Attachment/);
    await driver.findWait(".test-type-transform-apply", 1000).click();
    await gu.waitForServer();
    assert.equal(
      await gu.getCell(0, 2).find(".test-attachment-widget").isDisplayed(),
      true
    );
  });

  it("should include a functioning upload button", async function () {
    // Put 'foo1' in a cell, then replace it immediately with 'foo2'.
    // This is just setting up for testing undo behaviour below.
    await gu.getCell(1, 2).click();
    await driver.sendKeys("foo1", Key.ENTER);
    await gu.waitForServer();
    await gu.getCell(1, 2).click();
    await driver.sendKeys("foo2", Key.ENTER);
    await gu.waitForServer();

    await gu.getCell(0, 2).click();
    await driver.sendKeys(Key.ENTER);

    await gu.fileDialogUpload("uploads/sample.pdf,uploads/grist.png", () =>
      driver.find(".test-pw-add").click()
    );
    await driver.findContentWait(".test-pw-counter", /of 2/, 3000);

    const href: string = await driver
      .findWait(".test-pw-download", 2000)
      .getAttribute("href");
    assert.include(href.split("name=")[1], "sample.pdf");
    assert.equal(await driver.find(".test-pw-counter").getText(), "1 of 2");
    await driver.find(".test-modal-dialog .test-pw-close").click();
    await gu.waitForServer();

    // Check that title attributes are set to file names.
    assert.deepEqual(await getCellThumbnailTitles(gu.getCell(0, 2)), [
      "sample.pdf",
      "grist.png",
    ]);

    // Check that in the absence of a thumbnail we show the extension.
    assert.deepEqual(
      await gu
        .getCell(0, 2)
        .findAll(".test-pw-thumbnail", (el) => el.getText()),
      ["PDF", ""]
    );

    async function checkState(expectedCells: string[], isSoftDeleted: boolean) {
      assert.deepEqual(
        await gu.getVisibleGridCells({ cols: [0, 1], rowNums: [2] }),
        expectedCells
      );

      // Previously, undo would remove the uploaded attachment metadata completely,
      // which could lead to hard deleting the file data and leaving broken attachments after redo.
      // Here we check that after checking for unused attachments and removing expired ones
      // (as should happen automatically every hour)
      // the metadata records (and thus files) are still there, but appropriately marked as soft deleted.

      const headers = { Authorization: `Bearer ${session.getApiKey()}` };
      const url = server.getUrl(session.orgDomain, `/api/docs/${docId}`);
      let resp = await fetch(
        url + "/attachments/removeUnused?verifyfiles=1&expiredonly=1",
        { headers, method: "POST" }
      );
      assert.equal(resp.status, 200);
      resp = await fetch(url + "/tables/_grist_Attachments/records", {
        headers,
      });
      const data = await resp.json();
      assert.lengthOf(data.records, 2);
      for (const record of data.records) {
        assert.equal(Boolean(record.fields.timeDeleted), isSoftDeleted);
      }
    }

    // Check current state before testing undo/redo
    assert.deepEqual(
      await gu.getVisibleGridCells({ cols: [0, 1], rowNums: [2] }),
      ["PDF", "foo2"]
    );
    await checkState(["PDF", "foo2"], false);

    // Check that undo once removes the attachments we just added to the cell
    await gu.undo();
    await checkState(["", "foo2"], true); // true: attachment metadata marked as soft deleted

    // Check that undo again undoes the thing we did before attaching: changing foo1 to foo2
    // (previously it would undo creating the attachment metadata, which was invisible)
    await gu.undo();
    await checkState(["", "foo1"], true);

    // Check that redoing twice restores things as expected
    await gu.redo();
    await checkState(["", "foo2"], true);
    await gu.redo();
    await checkState(["PDF", "foo2"], false); // false: attachment metadata un-deleted
  });

  it("should allow resizing thumbnails", async function () {
    const slider = await driver.find(".test-pw-thumbnail-size");
    assert.equal(
      (await driver.findWait(".test-pw-thumbnail:last-child", 1000).getRect())
        .height,
      36
    );
    for (let i = 0; i < 5; i++) {
      await slider.sendKeys(Key.RIGHT);
    }
    assert.equal(
      (await driver.find(".test-pw-thumbnail:last-child").getRect()).height,
      41
    );
    for (let i = 0; i < 3; i++) {
      await slider.sendKeys(Key.LEFT);
    }
    assert.equal(
      (await driver.find(".test-pw-thumbnail:last-child").getRect()).height,
      38
    );
    // Wait to ensure the new setting is saved.
    await driver.sleep(300);

    // Thumbnail size setting should persist across refresh
    await driver.navigate().refresh();
    await gu.waitForServer(10000);
    assert.equal(
      (await driver.findWait(".test-pw-thumbnail:last-child", 1000).getRect())
        .height,
      38
    );
  });

  it("should get correct headers from the server", async function () {
    const cell: any = gu.getCell(0, 2);
    await cell.click();
    await driver.sendKeys(Key.ENTER);

    const fetchOptions = {
      headers: { Authorization: `Bearer ${session.getApiKey()}` },
    };
    const hrefDownload = await driver
      .findWait(".test-pw-download", 500)
      .getAttribute("href");
    const respDownload = await fetch(hrefDownload, fetchOptions);
    assert.equal(
      respDownload.headers.get("Content-Disposition"),
      'attachment; filename="sample.pdf"'
    );
    assert.equal(
      respDownload.headers.get("Content-Security-Policy"),
      "sandbox; default-src: 'none'"
    );

    const hrefInline = await driver
      .find(".test-pw-attachment-content")
      .getAttribute("data");
    const respInline = await fetch(hrefInline, fetchOptions);
    assert.equal(
      respInline.headers.get("Content-Disposition"),
      'inline; filename="sample.pdf"'
    );

    // Attach an html file and ensure it doesn't get served inline.
    await gu.fileDialogUpload("uploads/htmlfile.html", () =>
      driver.findWait(".test-pw-add", 500).click()
    );
    await driver.findContentWait(".test-pw-counter", /of 3/, 3000);

    const hrefLinkHtml = await driver
      .findWait(".test-pw-download", 2000)
      .getAttribute("href");
    const respLinkHtml = await fetch(hrefLinkHtml, fetchOptions);
    // Note that the disposition here is NOT "inline" (that would be bad).
    assert.equal(
      respLinkHtml.headers.get("Content-Disposition"),
      'attachment; filename="htmlfile.html"'
    );
    await driver.find(".test-modal-dialog .test-pw-close").click();
  });

  it("should allow editing the attachments list", async function () {
    let cell = gu.getCell(0, 2);
    assert.deepEqual(await getCellThumbnailTitles(cell), [
      "sample.pdf",
      "grist.png",
      "htmlfile.html",
    ]);

    // Open an image preview.
    await driver.withActions((a) =>
      a.doubleClick(driver.find(".test-pw-thumbnail"))
    );

    assert.equal(
      await driver.findWait(".test-pw-counter", 500).getText(),
      "1 of 3"
    );

    // Assert that the attachment filename can be changed.
    await driver
      .find(".test-pw-name")
      .doClick()
      .sendKeys("renamed.pdf", Key.ENTER);
    // Wait for doc name input to lose focus, indicating that the save call completed.
    await driver.findWait(".test-bc-doc:not(:focus)", 2000);
    assert.equal(await driver.find(".test-pw-name").value(), "renamed.pdf");

    // Assert that the attachment has the correct download link.
    const href = await driver.find(".test-pw-download").getAttribute("href");
    assert.include(href, "attId=1");
    assert.include(href, "name=renamed.pdf");

    // Assert that other previews can be viewed without closing the modal.
    await driver.find(".test-pw-right").click();
    assert.equal(await driver.find(".test-pw-name").value(), "grist.png");
    await driver.find(".test-pw-left").click();
    assert.equal(await driver.find(".test-pw-name").value(), "renamed.pdf");
    await driver.sendKeys(Key.RIGHT, Key.RIGHT);
    assert.equal(await driver.find(".test-pw-name").value(), "htmlfile.html");

    // Assert that the attachment can be removed from the cell.
    assert.equal(await driver.find(".test-pw-counter").getText(), "3 of 3");
    await driver.find(".test-pw-remove").click();
    await gu.waitForServer();
    assert.equal(await driver.find(".test-pw-counter").getText(), "2 of 2");
    await driver.find(".test-modal-dialog .test-pw-close").click();
    cell = gu.getCell(0, 2);
    assert.deepEqual(await getCellThumbnailTitles(cell), [
      "renamed.pdf",
      "grist.png",
    ]);
  });

  it("should allow uploading to the add row", async function () {
    assert.equal(await gu.getCell({ col: 0, rowNum: 6 }).isPresent(), false);
    const cell = await gu.getCell({ col: 0, rowNum: 5 });

    // First upload via the attachment icon.
    await gu.fileDialogUpload("uploads/grist.png", () =>
      cell.find(".test-attachment-icon").click()
    );
    await gu.waitToPass(async () =>
      assert.lengthOf(
        await gu.getCell({ col: 0, rowNum: 5 }).findAll(".test-pw-thumbnail"),
        1
      )
    );
    assert.deepEqual(
      await getCellThumbnailTitles(gu.getCell({ col: 0, rowNum: 5 })),
      ["grist.png"]
    );
    assert.equal(await gu.getCell({ col: 0, rowNum: 6 }).isPresent(), true);

    // Then do it again via the attachment editor.
    await gu.fileDialogUpload("uploads/grist.png", async () => {
      await gu.getCell({ col: 0, rowNum: 6 }).click();
      await driver.sendKeys(Key.ENTER);
      await driver.sleep(500);
      await driver.find(".test-pw-add").click();
    });
    await gu.waitToPass(async () =>
      assert.isTrue(
        await driver.find(".test-pw-attachment-content").isDisplayed()
      )
    );
    assert.isFalse(
      await driver
        .findContent(".test-pw-attachment-content", /Preview not available/)
        .isPresent()
    );
    await driver.find(".test-pw-close").click();
    await gu.waitForServer();
    await gu.waitToPass(async () =>
      assert.deepEqual(
        await getCellThumbnailTitles(gu.getCell({ col: 0, rowNum: 6 })),
        ["grist.png"]
      )
    );
    assert.equal(await gu.getCell({ col: 0, rowNum: 7 }).isPresent(), true);
  });

  it("should not initialize as invalid when a row is added", async function () {
    // The first cell is invalid, just to check that the assert is correct.
    let cell = gu.getCell({ col: 0, rowNum: 1 });
    assert.equal(await cell.getText(), "hello");
    assert.equal(await cell.find(".field_clip").matches(".invalid"), true);
    await cell.click();
    // Add a new row and ensure it's NOT invalid.
    await driver
      .find("body")
      .sendKeys(Key.chord(await gu.modKey(), Key.SHIFT, Key.ENTER));
    await gu.waitForServer();
    cell = gu.getCell({ col: 0, rowNum: 1 });
    assert.equal(await cell.getText(), "");
    assert.equal(await cell.find(".field_clip").matches(".invalid"), false);
    await gu.undo();
  });

  it("should open preview to double-clicked attachment", async function () {
    const cell = gu.getCell({ col: 0, rowNum: 2 });
    assert.deepEqual(await getCellThumbnailTitles(cell), [
      "renamed.pdf",
      "grist.png",
    ]);

    // Double-click the first attachment.
    await driver.withActions((a) =>
      a.doubleClick(cell.find(".test-pw-thumbnail[title*=pdf]"))
    );
    assert.equal(
      await driver.findWait(".test-pw-counter", 500).getText(),
      "1 of 2"
    );
    assert.equal(await driver.find(".test-pw-name").value(), "renamed.pdf");
    await driver.sendKeys(Key.ESCAPE);

    // Double-click the second attachment.
    await driver.withActions((a) =>
      a.doubleClick(cell.find(".test-pw-thumbnail[title*=png]"))
    );
    assert.equal(
      await driver.findWait(".test-pw-counter", 500).getText(),
      "2 of 2"
    );
    assert.equal(await driver.find(".test-pw-name").value(), "grist.png");
    await driver.sendKeys(Key.ESCAPE);
  });

  it("should render various types of files appropriately", async function () {
    const cell = gu.getCell({ col: 0, rowNum: 2 });
    await cell.click();
    assert.deepEqual(await getCellThumbnailTitles(cell), [
      "renamed.pdf",
      "grist.png",
    ]);
    await gu.fileDialogUpload(
      "uploads/file1.mov,uploads/file2.mp3,uploads/file3.zip,uploads/simple_array.json",
      () => cell.find(".test-attachment-icon").click()
    );
    await gu.waitToPass(async () =>
      assert.lengthOf(await cell.findAll(".test-pw-thumbnail"), 6)
    );
    await gu.waitForServer();
    assert.deepEqual(await getCellThumbnailTitles(cell), [
      "renamed.pdf",
      "grist.png",
      "file1.mov",
      "file2.mp3",
      "file3.zip",
      "simple_array.json",
    ]);
    await driver.sendKeys(Key.ENTER);
    assert.equal(
      await driver.findWait(".test-pw-counter", 500).getText(),
      "1 of 6"
    );

    // For various recognized file types, see that a suitable element is created.
    assert.equal(await driver.find(".test-pw-name").value(), "renamed.pdf");
    assert.equal(
      await driver.find(".test-pw-attachment-content").getTagName(),
      "object"
    );
    assert.match(
      await driver.find(".test-pw-attachment-content").getAttribute("data"),
      /name=renamed.pdf&rowId=2&colId=A&tableId=Table1&maybeNew=1&attId=1&inline=1/
    );
    assert.equal(
      await driver.find(".test-pw-attachment-content").getAttribute("type"),
      "application/pdf"
    );

    await driver.sendKeys(Key.RIGHT);
    assert.equal(await driver.find(".test-pw-name").value(), "grist.png");
    assert.equal(
      await driver.find(".test-pw-attachment-content").getTagName(),
      "img"
    );
    assert.match(
      await driver.find(".test-pw-attachment-content").getAttribute("src"),
      /name=grist.png&rowId=2&colId=A&tableId=Table1&maybeNew=1&attId=2/
    );

    await driver.sendKeys(Key.RIGHT);
    assert.equal(await driver.find(".test-pw-name").value(), "file1.mov");
    assert.equal(
      await driver.find(".test-pw-attachment-content").getTagName(),
      "video"
    );
    assert.match(
      await driver.find(".test-pw-attachment-content").getAttribute("src"),
      /name=file1.mov&rowId=2&colId=A&tableId=Table1&maybeNew=1&attId=6&inline=1/
    );

    await driver.sendKeys(Key.RIGHT);
    assert.equal(await driver.find(".test-pw-name").value(), "file2.mp3");
    assert.equal(
      await driver.find(".test-pw-attachment-content").getTagName(),
      "audio"
    );
    assert.match(
      await driver.find(".test-pw-attachment-content").getAttribute("src"),
      /name=file2.mp3&rowId=2&colId=A&tableId=Table1&maybeNew=1&attId=7&inline=1/
    );

    // Test that for an unsupported file, the extension is shown along with a message.
    await driver.sendKeys(Key.RIGHT);
    assert.equal(await driver.find(".test-pw-name").value(), "file3.zip");
    assert.equal(
      await driver.find(".test-pw-attachment-content").getTagName(),
      "object"
    );
    assert.match(
      await driver.find(".test-pw-attachment-content").getAttribute("data"),
      /name=file3.zip&rowId=2&colId=A&tableId=Table1&maybeNew=1&attId=8&inline=1/
    );
    assert.equal(
      await driver.find(".test-pw-attachment-content").getText(),
      "ZIP\nPreview not available."
    );

    // Test the same for a text/json file that we also don't currently render.
    await driver.sendKeys(Key.RIGHT);
    assert.equal(
      await driver.find(".test-pw-name").value(),
      "simple_array.json"
    );
    assert.equal(
      await driver.find(".test-pw-attachment-content").getTagName(),
      "div"
    );
    assert.equal(
      await driver.find(".test-pw-attachment-content").getText(),
      "JSON\nPreview not available."
    );
    await driver.sendKeys(Key.ESCAPE);

    // Undo.
    await gu.undo();
    assert.deepEqual(await getCellThumbnailTitles(cell), [
      "renamed.pdf",
      "grist.png",
    ]);
  });

  const checkClosing = async function (
    shouldSave: boolean,
    trigger: () => Promise<void>
  ) {
    let cell = gu.getCell({ col: 1, rowNum: 2 });
    await cell.click(); // Click on the right column and move using keyboard, otherwise me might click on the thumbnail.
    await driver.sendKeys(Key.ARROW_LEFT);
    cell = gu.getCell({ col: 0, rowNum: 2 });
    assert.deepEqual(await getCellThumbnailTitles(cell), [
      "renamed.pdf",
      "grist.png",
    ]);

    // Open attachments editor.
    await driver.sendKeys(Key.ENTER);
    await driver.findWait(".test-pw-attachment-content", 500);

    // Close using the given trigger. No actions should be emitted.
    await gu.userActionsCollect();
    await trigger();
    await gu.waitAppFocus();
    await gu.userActionsVerify([]);

    // Open editor and delete a file.
    await driver.sendKeys(Key.ENTER);
    await gu.waitAppFocus(false);
    await driver.findWait(".test-pw-attachment-content", 500);
    await driver.find(".test-pw-remove").click();
    await gu.waitForServer();

    // Close using the given trigger.
    await gu.userActionsCollect();
    await trigger();
    await gu.waitAppFocus();
    await gu.waitForServer();

    await ensureDialogIsClosed();
    cell = gu.getCell({ col: 0, rowNum: 2 });
    if (shouldSave) {
      // If shouldSave is set, files should reflect the change. Check it and undo.
      await gu.userActionsCollect(false);
      assert.deepEqual(await getCellThumbnailTitles(cell), ["grist.png"]);
      await gu.undo();
    } else {
      // If shouldSave is false, there should be no actions.
      await gu.userActionsVerify([]);
    }
    assert.deepEqual(await getCellThumbnailTitles(cell), [
      "renamed.pdf",
      "grist.png",
    ]);
    await ensureDialogIsClosed();
  };

  it("should not save on Escape", async function () {
    await checkClosing(false, () => driver.sendKeys(Key.ESCAPE));
  });

  it("should save on Enter", async function () {
    await checkClosing(true, () => driver.sendKeys(Key.ENTER));
  });

  it("should save on close button", async function () {
    await checkClosing(true, () =>
      driver.find(".test-modal-dialog .test-pw-close").click()
    );
  });

  it("should preview images properly", async function () {
    const cell = await gu.getCell({ col: 0, rowNum: 2 });
    await cell.click();
    await gu.fileDialogUpload("uploads/image_with_script.svg", () =>
      cell.find(".test-attachment-icon").click()
    );
    await driver.withActions((a) => a.doubleClick(cell));
    await driver.findWait(".test-pw-attachment-content", 1000);
    assert.isFalse(await gu.isAlertShown());
    await gu.sendKeys(Key.ESCAPE);
  });

  it("should show a loading indicator when uploading via the attachment icon", async function () {
    const cell = await gu.getCell({ col: 0, rowNum: 3 });
    await driver.executeScript("window.testGrist = {fakeSlowUploads: true}");
    const thumbnailsCount = (await cell.findAll(".test-pw-thumbnail"))?.length || 0;

    await cell.click();
    await gu.fileDialogUpload("uploads/image_with_script.svg", () =>
      cell.find(".test-attachment-icon").click()
    );

    // the spinner should show up after a small delay, wait for 1 second tops
    await driver.findWait('.test-attachment-spinner', 1000);
    // then wait for the spinner to disappear
    await driver.wait(async () => !(await cell.find('.test-attachment-spinner').isPresent()), 2000);

    // check the upload was successful by comparing the number of thumbnails
    const newThumbnailsCount = (await cell.findAll(".test-pw-thumbnail"))?.length || 0;
    assert.equal(newThumbnailsCount, thumbnailsCount + 1);
    await gu.clearTestState();
  });

  it("should show a loading indicator when uploading via the attachment editor", async function () {
    const cell = await gu.getCell({ col: 0, rowNum: 3 });
    await driver.executeScript("window.testGrist = {fakeSlowUploads: true}");
    await gu.fileDialogUpload("uploads/grist.png", async () => {
      await cell.click();
      await driver.sendKeys(Key.ENTER);
      await driver.sleep(500);
      await driver.find(".test-pw-add").click();
    });

    // the spinner should show up directly
    await driver.findWait('.test-pw-spinner', 500);
    // wait for the spinner to disappear
    await driver.wait(async () => !(await cell.find('.test-pw-spinner').isPresent()), 2000);

    // check the upload was successful by checking the final counter
    await driver.findContentWait(".test-pw-counter", /of 2/, 3000);
    // exit the editor
    await driver.sendKeys(Key.ESCAPE);
    await gu.clearTestState();
  });

  it("should allow uploading from card view", async function () {
    // This was a little broken - the click event on the upload icon would
    // trigger an edit action on the field if the field had focus prior
    // to the click, causing both the file picker and the editor to be
    // shown at the same time.
    const cell = await gu.getCell({ col: 0, rowNum: 2 });
    await cell.click();
    await gu.changeWidget("Card");
    const field = await gu.getCardCell("A");
    await field.click();
    await gu.fileDialogUpload("uploads/grist.png", () =>
      field.mouseMove().find(".test-attachment-icon").click()
    );
    await gu.waitToPass(async () =>
      assert.lengthOf(
        await gu.getCardCell("A").findAll(".test-pw-thumbnail"),
        4
      )
    );
    assert.deepEqual(await getCellThumbnailTitles(gu.getCardCell("A")), [
      "renamed.pdf",
      "grist.png",
      "image_with_script.svg",
      "grist.png",
    ]);
  });

  // Test that if we have a formula column that is attachment, it supports the same things as
  // a readonly attachment column. Only when user types something or press F2/Enter it opens the formula
  // editor
  it("should show attachments editor for attachment formula column", async function () {
    const revert = await gu.begin();
    await gu.addNewPage('Table', 'Table1');
    await gu.sendActions([
      ...['B', 'C', 'D', 'E'].map(col => ['RemoveColumn', 'Table1', col]),
      ['AddVisibleColumn', 'Table1', 'B', {
        isFormula: true,
        formula: "$A",
        type: 'Attachments',
      }],
    ]);

    // Open the second attachment in preview in column B.
    const cell = gu.getCell({ col: 'B', rowNum: 2 });
    await driver.withActions((a) =>
      a.doubleClick(cell.find(".test-pw-thumbnail[title*=png]"))
    );
    assert.equal(
      await driver.findWait(".test-pw-counter", 500).getText(),
      "2 of 4"
    );
    assert.equal(await driver.find(".test-pw-name").value(), "grist.png");

    // Make sure we don't see add or remove buttons
    assert.isFalse(await driver.find(".test-pw-add").isPresent());
    assert.isFalse(await driver.find(".test-pw-remove").isPresent());

    // Close the preview
    await driver.sendKeys(Key.ESCAPE);
    await ensureDialogIsClosed();

    // Now double click on the empty cell in row 4, we should see "No attachments" message
    const emptyCell = gu.getCell({ col: 'B', rowNum: 4 });
    await gu.dbClick(emptyCell);
    assert.equal(await driver.findWait(".test-pw-attachment-content", 1000).getText(), "No attachments");
    // Close the preview
    await driver.sendKeys(Key.ESCAPE);
    await ensureDialogIsClosed();

    // Now press F2 to edit the formula
    await gu.sendKeys(Key.F2);
    await gu.checkFormulaEditor('$A');
    await gu.sendKeys(Key.ESCAPE);
    await gu.waitAppFocus();

    // Now do the same with Enter key
    await gu.sendKeys(Key.ENTER);
    await gu.checkFormulaEditor('$A');
    await gu.sendKeys(Key.ESCAPE);
    await gu.waitAppFocus();

    // Now the same with any key
    await gu.sendKeys('hello');
    await gu.checkFormulaEditor('hello');
    await gu.sendKeys(Key.ESCAPE);
    await gu.waitAppFocus();

    await revert();
  });
});

async function ensureDialogIsClosed() {
  await gu.waitToPass(async () => {
    assert.equal(
      await driver.find(".test-pw-close").isPresent(),
      false
    );
  }, 10000);
}
