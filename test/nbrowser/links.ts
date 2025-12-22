import { assert, driver, Key } from "mocha-webdriver";
import * as gu from "test/nbrowser/gristUtils";
import { setupExternalSite } from 'test/server/customUtil';
import { server, setupTestSuite } from "test/nbrowser/testUtils";

describe("links", function () {
  this.timeout(20000);
  const cleanup = setupTestSuite();
  let session: gu.Session;
  let docId: string;
  let urlId: string;

  const externalSite = setupExternalSite('Dolphins are cool.');

  before(async function () {
    session = await gu.session().login();
    docId = await session.tempNewDoc(cleanup, "links");
    urlId = (await gu.getCurrentUrlId())!;
    await gu.openColumnPanel();
    await gu.setType("Text");
  });

  async function assertSameDocumentLink(value: string, expected: RegExp) {
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.ARROW_UP));
    await gu.enterCell(value);
    const link = await gu.getCell(0, 1).find("a");
    const href = await link.getAttribute("href");
    assert.match(href, expected);
    const tabs = await driver.getAllWindowHandles();
    await link.click();
    assert.lengthOf(await driver.getAllWindowHandles(), tabs.length);
    await gu.waitToPass(async () => {
      assert.equal(await driver.getCurrentUrl(), href.split("#")[0]);
    }, 1000);
    await driver.navigate().back();
  }

  async function assertNotSameDocumentLink(
    value: string,
    expected: RegExp | null,
  ) {
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.ARROW_UP));
    await gu.enterCell(value);
    if ((await gu.getFieldWidgetType()) === "TextBox" && expected === null) {
      assert.isFalse(await gu.getCell(0, 1).find("a").isPresent());
      return;
    }

    const link = await gu.getCell(0, 1).find("a");
    const href = await link.getAttribute("href");
    if (expected === null) {
      assert.isNull(href);
      return;
    }

    assert.match(href, expected);
    const currentTab = await driver.getWindowHandle();
    const tabs = await driver.getAllWindowHandles();
    await link.click();
    const newTabs = await driver.getAllWindowHandles();
    assert.lengthOf(newTabs, tabs.length + 1);
    await driver.switchTo().window(newTabs[newTabs.length - 1]);
    try {
      await gu.waitToPass(async () => {
        assert.equal(await driver.getCurrentUrl(), href.split("#")[0]);
      }, 1000);
    }
    finally {
      await driver.close();
      await driver.switchTo().window(currentTab);
    }
  }

  for (const type of ["TextBox", "HyperLink", "Markdown"] as any) {
    function makeLink(href: string) {
      if (type === "TextBox") {
        return href;
      }
      else if (type === "HyperLink") {
        return `Link ${href}`;
      }
      else {
        return `[Link](${href})`;
      }
    }

    describe(`in ${type} cells`, function () {
      before(async function () {
        await gu.setFieldWidgetType(type);
        await gu.getCell(0, 1).click();
      });

      beforeEach(async function () {
        await gu.sendKeys(Key.chord(await gu.modKey(), Key.ARROW_UP));
      });

      it("have absolute URLs", async function () {
        // Previously, URLs in Markdown cells were treated as being relative to
        // the document origin if they were missing a scheme. This was inconsistent
        // with how HyperLink cells treated such URLs (with `http://` inferred).
        await gu.enterCell(makeLink("google.com"));
        if (type !== "TextBox") {
          assert.equal(
            await gu.getCell(0, 1).find("a").getAttribute("href"),
            "https://google.com/",
          );
        }
        else {
          assert.isFalse(await gu.getCell(0, 1).find("a").isPresent());
        }
      });

      it(`have ${
        type === "Markdown" ? "a null" : 'an "about:blank"'
      } URL when invalid`, async function () {
        await gu.enterCell(makeLink("javascript:alert()"));
        if (type !== "TextBox") {
          assert.equal(
            await gu.getCell(0, 1).find("a").getAttribute("href"),
            type === "Markdown" ? null : "about:blank",
          );
        }
        else {
          assert.isFalse(await gu.getCell(0, 1).find("a").isPresent());
        }
      });

      it("open without reloading if the URL is in the same document", async function () {
        await assertSameDocumentLink(
          makeLink(server.getUrl(session.orgDomain, `/${urlId}/links/p/acl`)),
          new RegExp(`\\/${urlId}\\/links\\/p\\/acl$`),
        );
        await assertSameDocumentLink(
          makeLink(await gu.getAnchor()),
          /links#a1\.s1\.r1\.c2$/,
        );
        return;
        await assertNotSameDocumentLink(
          makeLink(externalSite.getUrl().href),
          /localtest.datagrist.com/,
        );
        await assertNotSameDocumentLink(
          makeLink("about:blank"),
          type !== "HyperLink" ? null : /about:blank$/,
        );
        await assertNotSameDocumentLink(
          makeLink("somewhere"),
          type === "TextBox" ? null : /somewhere\/$/,
        );
        await assertNotSameDocumentLink(
          makeLink(server.getUrl(session.orgDomain, "/docs/7pRKGiJGiuvZ")),
          /\/docs\/7pRKGiJGiuvZ$/,
        );
        await assertNotSameDocumentLink(
          makeLink(
            server.getUrl(session.orgDomain, `/${urlId}/links?Foo_=123`),
          ),
          new RegExp(`\\/${urlId}\\/links\\?Foo_=123$`),
        );
        await assertNotSameDocumentLink(
          makeLink(server.getUrl(session.orgDomain, `/docs/${docId}`)),
          new RegExp(`\\/docs\\/${docId}$`),
        );
      });

      it("include aclAsUser when viewing a document as another user", async function () {
        await gu.openAccessRulesDropdown();
        await gu.waitToPass(() => gu.findOpenMenuItem('a', /Editor 1/, 500).click());
        await gu.waitForDocToLoad();
        await assertSameDocumentLink(
          makeLink(server.getUrl(session.orgDomain, `/${urlId}/links/p/acl`)),
          new RegExp(
            `\\/${urlId}\\/links\\/p\\/acl\\?aclAsUser_=editor1%40example\\.com$`,
          ),
        );
        await assertSameDocumentLink(
          makeLink(await gu.getAnchor()),
          /links\?aclAsUser_=editor1%40example.com#a1\.s1\.r1\.c2$/,
        );
        await assertNotSameDocumentLink(
          makeLink(externalSite.getUrl().href),
          /localtest.datagrist.com/,
        );
        await assertNotSameDocumentLink(
          makeLink("about:blank"),
          type !== "HyperLink" ? null : /about:blank$/,
        );
        await assertNotSameDocumentLink(
          makeLink("somewhere"),
          type === "TextBox" ? null : /somewhere\/$/,
        );
        await assertNotSameDocumentLink(
          makeLink(server.getUrl(session.orgDomain, "/docs/7pRKGiJGiuvZ")),
          /\/docs\/7pRKGiJGiuvZ$/,
        );
        await assertNotSameDocumentLink(
          makeLink(
            server.getUrl(session.orgDomain, `/${urlId}/links?Foo_=123`),
          ),
          new RegExp(`\\/${urlId}\\/links\\?Foo_=123$`),
        );
        await assertNotSameDocumentLink(
          makeLink(server.getUrl(session.orgDomain, `/docs/${docId}`)),
          new RegExp(`\\/docs\\/${docId}$`),
        );
        await assertNotSameDocumentLink(
          makeLink(
            server.getUrl(
              session.orgDomain,
              `/docs/${docId}/links?aclAsUser_=editor2@example.com`,
            ),
          ),
          /links\?aclAsUser_=editor2@example.com$/,
        );

        await driver.find(".test-revert").click();
        await gu.waitForDocToLoad();
      });
    });
  }
});
