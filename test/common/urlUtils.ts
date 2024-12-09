import { sanitizeUrl } from "app/common/urlUtils";
import { assert } from "chai";

describe("urlUtils", function () {
  describe("sanitizeUrl", function () {
    it("returns the provided URL if the scheme is http[s]", function () {
      assert.equal(sanitizeUrl("https://example.com"), "https://example.com/");
      assert.equal(sanitizeUrl("http://example.com"), "http://example.com/");
      assert.equal(sanitizeUrl("https://example.com"), "https://example.com/");
    });

    it("returns null if the provided URL is invalid", function () {
      assert.isNull(sanitizeUrl("www.example.com"));
      assert.isNull(sanitizeUrl(""));
      assert.isNull(sanitizeUrl("invalid"));
    });

    it("returns null if the provided URL's scheme is not http[s]", function () {
      assert.isNull(sanitizeUrl("mailto:support@getgrist.com.com"));
      assert.isNull(sanitizeUrl("ftp://getgrist.com/path"));
      assert.isNull(sanitizeUrl("javascript:alert()"));
    });
  });
});
