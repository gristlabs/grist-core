import {assert, driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';
import {DocCreationInfo} from "app/common/DocListAPI";

describe('CellFormat', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();
  let session: gu.Session, doc: DocCreationInfo, api;

  // Checks that a bug where alignment settings did not survive doc reload is gone.
  it('saves alignment settings', async function() {
    session = await gu.session().login();
    doc = await session.tempDoc(cleanup, 'Hello.grist');
    await gu.toggleSidePanel('right', 'open');
    await driver.findWait('.test-right-tab-field', 3000).click();

    // Alignment should be left.
    assert.equal(await driver.find(`.test-alignment-select .test-select-button:first-child`)
                 .matches('[class*=-selected]'), true);

    // Click on center aligmment.
    await (await driver.findAll('.test-alignment-select .test-select-button'))[1].click();
    await gu.waitForServer();

    // Alignment should no longer be left.
    assert.equal(await driver.find(`.test-alignment-select .test-select-button:first-child`)
                 .matches('[class*=-selected]'), false);

    // Reload document.
    await session.loadDocMenu('/');
    await session.loadDoc(`/doc/${doc.id}`);

    // Alignment should still not be left.
    assert.equal(await driver.find(`.test-alignment-select .test-select-button:first-child`)
                 .matches('[class*=-selected]'), false);
  });

  it('should open hyperlinks in new tabs only when needed', async function () {
    api = session.createHomeApi();
    const currentUrl = await driver.getCurrentUrl();
    const urls = [
      // Different origin, must open in new tab.
      // The driver waits for the page to load so something that loads quickly is needed.
      'about:blank',

      // Same origin, but still needs a new tab because it's not the current document
      server.getUrl(session.settings.orgDomain, '/'),

      // Same URL but with a link key, needs a new tab
      currentUrl + "?foo_=bar",

      // Shouldn't open a new tab
      currentUrl,
    ];

    // Create and open a new table in the same document containing the above URLs
    await api.applyUserActions(doc.id, [
      ['AddTable', 'Links',
        [{id: 'Link', type: 'Text'}]],
      ...urls.map(url => ['AddRecord', 'Links', null, {Link: url}]),
    ]);
    await gu.getPageItem(/Links/).click();

    // Confirm that we are on a different page from before (i.e. `currentUrl`)
    // which we will be returning to
    const newUrl = await driver.getCurrentUrl();
    assert.isTrue(newUrl.endsWith('/p/2'));
    assert.isFalse(currentUrl.endsWith('/p/2'));

    // Convert the column to hyperlink format
    await gu.getCell({rowNum: 1, col: 0}).click();
    await gu.setFieldWidgetType('HyperLink');

    // There should only be one tab open for the following checks to make sense
    assert.equal((await driver.getAllWindowHandles()).length, 1);

    async function checkExternalLink(rowNum: number) {
      const cell = gu.getCell({rowNum, col: 0});
      const url = await cell.getText();
      await cell.find('.test-tb-link').click();

      // Check that we opened the URL in the cell in a new tab
      const handles = await driver.getAllWindowHandles();
      assert.equal(handles.length, 2);
      // Use gu.switchToWindow to handle occasional selenium flakage here.
      await gu.switchToWindow(handles[1]);
      assert.equal(await driver.getCurrentUrl(), url);
      assert.equal(urls[rowNum - 1], url);
      await driver.close();

      // Return to the original tab with our document
      const [originalWindow] = await driver.getAllWindowHandles();
      await driver.switchTo().window(originalWindow);
    }

    await checkExternalLink(1);
    await checkExternalLink(2);
    await checkExternalLink(3);

    const cell = gu.getCell({rowNum: 4, col: 0});
    const url = await cell.getText();
    await cell.find('.test-tb-link').click();
    const handles = await driver.getAllWindowHandles();

    // This time no new tab should have opened,
    // but we're back to the previous page
    assert.equal(handles.length, 1);
    assert.equal(await driver.getCurrentUrl(), url);
    assert.equal(currentUrl, url);
  });

  it('can display Markdown-formatted text', async function() {
    await gu.getCell(0, 1).click();
    await gu.setFieldWidgetType('TextBox');
    await gu.sendKeys(
      Key.ENTER,
      await gu.selectAllKey(),
      Key.DELETE,
      '# Heading',
      Key.chord(Key.SHIFT, Key.ENTER),
      Key.chord(Key.SHIFT, Key.ENTER),
      '## Subheading',
      Key.chord(Key.SHIFT, Key.ENTER),
      Key.chord(Key.SHIFT, Key.ENTER),
      '1. Item 1',
      Key.chord(Key.SHIFT, Key.ENTER),
      '2. Item 2',
      Key.chord(Key.SHIFT, Key.ENTER),
      Key.chord(Key.SHIFT, Key.ENTER),
      'A paragraph with **bold** and *italicized* text.',
      Key.chord(Key.SHIFT, Key.ENTER),
      Key.chord(Key.SHIFT, Key.ENTER),
      '[Link with label](https://example.com/#1)',
      Key.chord(Key.SHIFT, Key.ENTER),
      Key.chord(Key.SHIFT, Key.ENTER),
      'Link: https://example.com/#2',
      Key.chord(Key.SHIFT, Key.ENTER),
      Key.chord(Key.SHIFT, Key.ENTER),
      'HTML is <span style="color: red;">escaped</span>.',
      Key.chord(Key.SHIFT, Key.ENTER),
      Key.chord(Key.SHIFT, Key.ENTER),
      "![Images too](https://example.com)",
      Key.ENTER
    );
    await gu.waitForServer();
    assert.equal(
      await gu.getCell(0, 1).getText(),
      `# Heading

## Subheading

1. Item 1
2. Item 2

A paragraph with **bold** and *italicized* text.

[Link with label](
)

Link: \nhttps://example.com/#2

HTML is <span style="color: red;">escaped</span>.

![Images too](
)`
    );
    assert.isFalse(await gu.getCell(0, 1).findContent('h1', 'Heading').isPresent());
    assert.isFalse(await gu.getCell(0, 1).findContent('h2', 'Subheading').isPresent());
    assert.isFalse(await gu.getCell(0, 1).findContent('ol', 'Item 1').isPresent());
    assert.isFalse(await gu.getCell(0, 1).findContent('strong', 'bold').isPresent());
    assert.isFalse(await gu.getCell(0, 1).findContent('em', 'italicized').isPresent());
    assert.isFalse(await gu.getCell(0, 1).findContent('a + span', 'Link with label').isPresent());
    assert.isTrue(await gu.getCell(0, 1).find('a[href="https://example.com/#2"]').isDisplayed());
    assert.isFalse(await gu.getCell(0, 1).findContent('span', 'escaped').isPresent());
    assert.isFalse(await gu.getCell(0, 1).find('img').isPresent());

    await gu.setFieldWidgetType('Markdown');
    await driver.find('.test-tb-wrap-text').click();
    await gu.waitForServer();
    assert.equal(
      await gu.getCell(0, 1).getText(),
      `Heading
Subheading
Item 1
Item 2
A paragraph with bold and italicized text.
Link with label
Link:
https://example.com/#2
HTML is <span style="color: red;">escaped</span>.
![Images too](https://example.com)`
    );
    assert.isTrue(await gu.getCell(0, 1).findContent('h1', 'Heading').isDisplayed());
    assert.isTrue(await gu.getCell(0, 1).findContent('h2', 'Subheading').isDisplayed());
    assert.isTrue(await gu.getCell(0, 1).findContent('ol', 'Item 1').isDisplayed());
    assert.isTrue(await gu.getCell(0, 1).findContent('strong', 'bold').isDisplayed());
    assert.isTrue(await gu.getCell(0, 1).findContent('em', 'italicized').isDisplayed());
    assert.isTrue(await gu.getCell(0, 1)
      .findContent('a[href="https://example.com/#1"] + span', 'Link with label').isDisplayed());
    assert.isTrue(await gu.getCell(0, 1).find('a[href="https://example.com/#2"]').isDisplayed());
    assert.isFalse(await gu.getCell(0, 1).findContent('span', 'escaped').isPresent());
    assert.isFalse(await gu.getCell(0, 1).find('img').isPresent());

    await gu.sendKeys(
      Key.ENTER,
      '> Editing works the same way as TextBox and HyperLink',
      Key.ENTER,
    );
    await gu.waitForServer();
    assert.equal(
      await gu.getCell(0, 2).getText(),
      'Editing works the same way as TextBox and HyperLink'
    );

    await gu.setFieldWidgetType('TextBox');
    assert.equal(
      await gu.getCell(0, 1).getText(),
      `# Heading

## Subheading

1. Item 1
2. Item 2

A paragraph with **bold** and *italicized* text.

[Link with label](
)

Link: \nhttps://example.com/#2

HTML is <span style="color: red;">escaped</span>.

![Images too](
)`
    );
    assert.equal(
      await gu.getCell(0, 2).getText(),
      '> Editing works the same way as TextBox and HyperLink'
    );
  });

  it('treats URLs in Markdown and HyperLink cells as absolute URLs', async function() {
    // Previously, URLs in Markdown cells were treated as being relative to
    // the document origin if they were missing a scheme. This was inconsistent
    // with how HyperLink cells treated such URLs (with `http://` inferred).
    await gu.setFieldWidgetType('Markdown');
    await gu.getCell(0, 3).click();
    await gu.sendKeys(Key.ENTER, '[Google](google.com)', Key.ENTER);
    assert.equal(await gu.getCell(0, 3).find('a').getAttribute('href'), 'https://google.com/');

    await gu.setFieldWidgetType('HyperLink');
    await gu.getCell(0, 3).click();
    await gu.sendKeys(Key.ENTER, await gu.selectAllKey(), Key.DELETE, 'Google google.com', Key.ENTER);
    assert.equal(await gu.getCell(0, 3).find('a').getAttribute('href'), 'https://google.com/');
  });

  it('handles invalid URLs in HyperLink cells as "about:blank"', async function() {
    await gu.getCell(0, 3).click();
    await gu.sendKeys(Key.ENTER, await gu.selectAllKey(), Key.DELETE, '[Up to no good] javascript:alert()', Key.ENTER);
    assert.equal(await gu.getCell(0, 3).find('a').getAttribute('href'), 'about:blank');
  });
});
