import { DocAPIImpl, UserAPIImpl } from "app/common/UserAPI";

import { assert } from "chai";

describe("UserAPI", function() {
  // A dummy fetch so that BaseAPI's constructor doesn't reach for window.fetch in node.
  const noopFetch = (() => Promise.reject(new Error("not used"))) as unknown as typeof fetch;

  function makeDocApi(extraParameters?: Map<string, string>) {
    return new DocAPIImpl("https://worker.example.com", "docId", { fetch: noopFetch, extraParameters });
  }

  describe("getAttachmentDownloadUrl", function() {
    it("omits View as parameters when none are configured", function() {
      const url = makeDocApi().getAttachmentDownloadUrl(7);
      assert.equal(url, "https://worker.example.com/api/docs/docId/attachments/7/download");
    });

    it("passes along the aclAsUser_ extra parameter (View as by email)", function() {
      const url = makeDocApi(new Map([["aclAsUser_", "someone@example.com"]]))
        .getAttachmentDownloadUrl(7, { name: "pic.png" });
      const params = new URL(url).searchParams;
      assert.equal(params.get("aclAsUser_"), "someone@example.com");
      assert.equal(params.get("name"), "pic.png");
    });

    it("passes along the aclAsUserId_ extra parameter (View as by id)", function() {
      const url = makeDocApi(new Map([["aclAsUserId_", "42"]])).getAttachmentDownloadUrl(7);
      assert.equal(new URL(url).searchParams.get("aclAsUserId_"), "42");
    });

    it("keeps extra parameters alongside cell and inline params", function() {
      const url = makeDocApi(new Map([["aclAsUser_", "someone@example.com"]]))
        .getAttachmentDownloadUrl(7, {
          cell: { rowId: 3, colId: "A", tableId: "Table1" },
          inline: true,
        });
      const params = new URL(url).searchParams;
      assert.equal(params.get("aclAsUser_"), "someone@example.com");
      assert.equal(params.get("rowId"), "3");
      assert.equal(params.get("colId"), "A");
      assert.equal(params.get("tableId"), "Table1");
      assert.equal(params.get("inline"), "1");
    });
  });

  describe("download URLs", function() {
    it("include extraParameters (e.g. View as) when configured", function() {
      const docApi = makeDocApi(new Map([["aclAsUser_", "someone@example.com"]]));
      const urls = [
        docApi.getDownloadXlsxUrl(),
        docApi.getDownloadCsvUrl({ tableId: "T" }),
        docApi.getDownloadUrl({ template: false, removeHistory: false }),
        docApi.getDownloadAttachmentsArchiveUrl({ format: "tar" }),
      ];
      for (const url of urls) {
        assert.equal(new URL(url).searchParams.get("aclAsUser_"), "someone@example.com", url);
      }
    });

    it("omit them when none are configured", function() {
      assert.isNull(new URL(makeDocApi().getDownloadXlsxUrl()).searchParams.get("aclAsUser_"));
    });
  });

  describe("getDocAPI", function() {
    it("threads options (extraParameters) into the returned DocAPI's URLs", function() {
      const api = new UserAPIImpl("https://home.example.com", { fetch: noopFetch });
      const url = api
        .getDocAPI("docId", { extraParameters: new Map([["aclAsUser_", "someone@example.com"]]) })
        .getDownloadXlsxUrl();
      assert.equal(new URL(url).searchParams.get("aclAsUser_"), "someone@example.com");
    });

    it("does not let an absent option clobber the base API's extraParameters", function() {
      const base = new UserAPIImpl("https://home.example.com",
        { fetch: noopFetch, extraParameters: new Map([["showRemoved", "1"]]) });
      const url = base.getDocAPI("docId").getDownloadXlsxUrl();
      assert.equal(new URL(url).searchParams.get("showRemoved"), "1");
    });
  });

  describe("propagateViewAs", function() {
    // Stub a browser-like window with the given query string for the duration of `fn`.
    function withWindowSearch(search: string, fn: () => void) {
      const saved = (global as any).window;
      (global as any).window = { location: { pathname: "/doc", search } };
      try {
        fn();
      } finally {
        if (saved === undefined) { delete (global as any).window; } else { (global as any).window = saved; }
      }
    }

    it("picks up aclAsUser_ from the page URL", function() {
      withWindowSearch("?aclAsUser_=someone@example.com", function() {
        const url = new DocAPIImpl("https://worker.example.com", "docId",
          { fetch: noopFetch, propagateViewAs: true }).getDownloadXlsxUrl();
        assert.equal(new URL(url).searchParams.get("aclAsUser_"), "someone@example.com");
      });
    });

    it("prefers aclAsUserId_ over aclAsUser_", function() {
      withWindowSearch("?aclAsUser_=someone@example.com&aclAsUserId_=42", function() {
        const params = new URL(new DocAPIImpl("https://worker.example.com", "docId",
          { fetch: noopFetch, propagateViewAs: true }).getDownloadXlsxUrl()).searchParams;
        assert.equal(params.get("aclAsUserId_"), "42");
        assert.isNull(params.get("aclAsUser_"));
      });
    });

    it("adds nothing when the page URL is not in View as mode", function() {
      withWindowSearch("?foo=bar", function() {
        const params = new URL(new DocAPIImpl("https://worker.example.com", "docId",
          { fetch: noopFetch, propagateViewAs: true }).getDownloadXlsxUrl()).searchParams;
        assert.isNull(params.get("aclAsUser_"));
        assert.isNull(params.get("aclAsUserId_"));
      });
    });
  });
});
