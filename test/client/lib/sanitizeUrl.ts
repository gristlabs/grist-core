import {
  Deps,
  sanitizeHttpUrl,
  sanitizeLinkUrl,
} from "app/client/lib/sanitizeUrl";
import { assert } from "chai";
import DOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import * as sinon from "sinon";

describe("sanitizeUrl", function () {
  let sandbox: sinon.SinonSandbox;

  beforeEach(function () {
    // These grainjs browserGlobals are needed for using dom() in tests.
    const jsdomDoc = new JSDOM("<!doctype html><html><body></body></html>");
    sandbox = sinon.createSandbox();
    sandbox.stub(Deps, "DOMPurify").value(DOMPurify(jsdomDoc.window));
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe("sanitizeHttpUrl", function () {
    it("returns the provided URL if valid", function () {
      assert.equal(
        sanitizeHttpUrl("https://example.com"),
        "https://example.com/"
      );
      assert.equal(
        sanitizeHttpUrl("http://example.com"),
        "http://example.com/"
      );
    });

    it("returns null if the provided URL is invalid", function () {
      assert.isNull(sanitizeHttpUrl("www.example.com"));
      assert.isNull(sanitizeHttpUrl(""));
      assert.isNull(sanitizeHttpUrl("invalid"));
      assert.isNull(sanitizeHttpUrl("mailto:support@getgrist.com"));
      assert.isNull(sanitizeHttpUrl("ftp://getgrist.com/path"));
      assert.isNull(sanitizeHttpUrl("javascript:alert()"));
    });
  });

  describe("sanitizeLinkUrl", function () {
    it("returns the provided URL if valid", function () {
      assert.equal(
        sanitizeLinkUrl("https://example.com"),
        "https://example.com"
      );
      assert.equal(sanitizeLinkUrl("http://example.com"), "http://example.com");
      assert.equal(sanitizeLinkUrl("www.example.com"), "www.example.com");
      assert.equal(sanitizeLinkUrl(""), "");
      assert.equal(
        sanitizeLinkUrl("mailto:support@getgrist.com"),
        "mailto:support@getgrist.com"
      );
      assert.equal(sanitizeLinkUrl("tel:0123456789"), "tel:0123456789");
      assert.equal(
        sanitizeLinkUrl("ftp://getgrist.com/path"),
        "ftp://getgrist.com/path"
      );
    });

    it("returns null if the provided URL is unsafe", function () {
      assert.isNull(sanitizeLinkUrl("javascript:alert()"));
    });
  });
});
