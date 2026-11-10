import { readFileSync } from "fs";
import { runInNewContext } from "vm";

import { assert } from "chai";

describe("Reference connection landing bootstrap", function() {
  const html = readFileSync("static/referenceConnect.html", "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  const key = "grist-reference-pending";
  const fragment = `#grist-reference=12345678-1234-1234-1234-123456789abc.${"a".repeat(64)}`;
  const base = "https://grist.example/reference-connect";

  function open(hash: string, deniedStorage = false) {
    const storage = new Map<string, string>([[key, "obsolete"]]);
    let replaced = "";
    let hashChanged = () => {};
    let reloads = 0;
    const location = { href: base + hash, hash, pathname: "/reference-connect", reload: () => reloads++ };
    runInNewContext(script, {
      window: { location,
        addEventListener: (_event: string, listener: () => void) => { hashChanged = listener; },
        history: { replaceState: (_state: unknown, _title: string, url: string) => {
          replaced = url;
          location.hash = "";
        } } },
      sessionStorage: {
        removeItem: (name: string) => {
          assert.equal(location.hash, "", "scrub the URL before touching storage");
          if (deniedStorage) { throw new Error("Storage disabled"); }
          storage.delete(name);
        },
        setItem: (name: string, value: string) => storage.set(name, value),
      },
    });
    return { storage, replaced, location, hashChanged, get reloads() { return reloads; } };
  }

  it("scrubs capabilities before loading any other script, preserving only a short-lived tab value", () => {
    assert.isBelow(html.indexOf("history.replaceState"), html.indexOf("<!-- INSERT BASE -->"));
    const before = Date.now();
    const { storage, replaced } = open(fragment);
    assert.equal(replaced, "/reference-connect");
    const pending = JSON.parse(storage.get(key)!);
    assert.equal(pending.url, base + fragment);
    assert.isAtLeast(pending.expires, before + 30 * 60_000);
    assert.isAtMost(pending.expires, Date.now() + 30 * 60_000);
  });

  it("discards invalid fragments and any previous pending link", () => {
    const { storage, replaced } = open("#grist-reference=invalid");
    assert.equal(replaced, "/reference-connect");
    assert.isFalse(storage.has(key));
  });

  it("still scrubs the URL when browser tab storage is denied", () => {
    assert.equal(open(fragment, true).replaced, "/reference-connect");
  });
  it("also scrubs and replaces a second capability opened in the same tab", () => {
    const page = open(fragment);
    const second = fragment.replace(/a{64}/, "b".repeat(64));
    page.location.hash = second;
    page.location.href = base + second;
    page.hashChanged();
    assert.equal(page.location.hash, "");
    assert.equal(JSON.parse(page.storage.get(key)!).url, base + second);
    assert.equal(page.reloads, 1);
  });
});
