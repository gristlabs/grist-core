import { buildURL, getLoginUrl } from "app/client/lib/urlUtils";
import { assert } from "chai";
import { popGlobals, pushGlobals } from "grainjs/dist/cjs/lib/browserGlobals";
import { JSDOM } from "jsdom";

describe("urlUtils", function() {
  let originalWindow: any;

  beforeEach(function() {
    originalWindow = (global as any).window;
    const jsdomDoc = new JSDOM("<!doctype html><html><body></body></html>");
    (global as any).window = jsdomDoc.window;
    pushGlobals(jsdomDoc.window);
  });

  afterEach(function() {
    (global as any).window = originalWindow;
    popGlobals();
  });

  function setWindowLocation(href: string) {
    (global as any).window = { location: { href } };
  }

  describe("buildURL", function() {
    it("returns appropriate urls", async function() {
      assert.equal(
        buildURL("/", {
          base: "https://example.com",
          searchParams: new URLSearchParams({ foo: "A" }),
          hash: "bar",
        }).href,
        "https://example.com/?foo=A#bar",
      );
      assert.equal(
        buildURL("/", {
          base: "https://example.com?foo=A#bar",
        }).href,
        "https://example.com/?foo=A#bar",
      );
      assert.equal(
        buildURL("/", {
          base: "https://example.com?foo=A#bar",
          searchParams: new URLSearchParams({ foo: "B" }),
          hash: "baz",
        }).href,
        "https://example.com/?foo=B#baz",
      );
      assert.equal(
        buildURL("/bar", {
          base: "https://foo.example.com",
        }).href,
        "https://foo.example.com/bar",
      );
      assert.equal(
        buildURL("/bar", {
          base: "https://example.com/foo",
        }).href,
        "https://example.com/bar",
      );
      assert.equal(
        buildURL("/bar", {
          base: "https://example.com/o/foo",
        }).href,
        "https://example.com/o/foo/bar",
      );

      setWindowLocation("http://localhost:8080/");
      assert.equal(
        buildURL("/", {
          searchParams: new URLSearchParams({ foo: "A" }),
          hash: "bar",
        }).href,
        "http://localhost:8080/?foo=A#bar",
      );
    });
  });

  describe("getLoginUrl", function() {
    it("returns appropriate login urls", function() {
      setWindowLocation("http://localhost:8080");
      assert.equal(getLoginUrl(), "http://localhost:8080/login?next=%2F");
      setWindowLocation("https://docs.getgrist.com/");
      assert.equal(getLoginUrl(), "https://docs.getgrist.com/login?next=%2F");
      setWindowLocation("https://foo.getgrist.com?foo=1&bar=2#baz");
      assert.equal(
        getLoginUrl(),
        "https://foo.getgrist.com/login?next=%2F%3Ffoo%3D1%26bar%3D2%23baz",
      );
      setWindowLocation("https://example.com");
      assert.equal(getLoginUrl(), "https://example.com/login?next=%2F");
    });

    it("encodes redirect url in next param", function() {
      setWindowLocation("http://localhost:8080/o/docs/foo");
      assert.equal(
        getLoginUrl(),
        "http://localhost:8080/o/docs/login?next=%2Ffoo",
      );
      setWindowLocation("https://docs.getgrist.com/RW25C4HAfG/Test-Document");
      assert.equal(
        getLoginUrl(),
        "https://docs.getgrist.com/login?next=%2FRW25C4HAfG%2FTest-Document",
      );
    });

    it("includes query params and hashes in next param", function() {
      setWindowLocation(
        "https://foo.getgrist.com/Y5g3gBaX27D/With-Hash/p/1/#a1.s8.r2.c23",
      );
      assert.equal(
        getLoginUrl(),
        "https://foo.getgrist.com/login?next=%2FY5g3gBaX27D%2FWith-Hash%2Fp%2F1%2F%23a1.s8.r2.c23",
      );
      setWindowLocation(
        "https://example.com/rHz46S3F77DF/With-Params?compare=RW25C4HAfG",
      );
      assert.equal(
        getLoginUrl(),
        "https://example.com/login?next=%2FrHz46S3F77DF%2FWith-Params%3Fcompare%3DRW25C4HAfG",
      );
      setWindowLocation(
        "https://example.com/rHz46S3F77DF/With-Params?compare=RW25C4HAfG#a1.s8.r2.c23",
      );
      assert.equal(
        getLoginUrl(),
        "https://example.com/login?next=%2FrHz46S3F77DF%2FWith-Params%3Fcompare%3DRW25C4HAfG%23a1.s8.r2.c23",
      );
    });

    it("skips encoding redirect url on signed-out page", function() {
      setWindowLocation("http://localhost:8080/o/docs/signed-out");
      assert.equal(
        getLoginUrl(),
        "http://localhost:8080/o/docs/login?next=%2F",
      );
      setWindowLocation("https://docs.getgrist.com/signed-out");
      assert.equal(getLoginUrl(), "https://docs.getgrist.com/login?next=%2F");
    });
  });
});
