import { ReferencePreviewCache } from "app/server/lib/ReferencePreviewCache";

import { assert } from "chai";

describe("ReferencePreviewCache", function() {
  it("expires, isolates documents, replaces reviews and bounds pending data", function() {
    let now = 0;
    const cache = new ReferencePreviewCache<{ expiresAt: string; data: string }>(100, () => now);
    const value = { expiresAt: new Date(1000).toISOString(), data: "first" };
    cache.set("doc-a:sub", value);
    assert.isUndefined(cache.get("doc-b:sub"));
    cache.set("doc-a:sub", { ...value, data: "new" });
    assert.equal(cache.get("doc-a:sub")?.data, "new");
    cache.set("doc-b:sub", value); // Evicts oldest when serialized previews exceed the budget.
    assert.isUndefined(cache.get("doc-a:sub"));
    assert.equal(cache.get("doc-b:sub")?.data, "first");
    assert.throws(() => cache.set("large", { ...value, data: "x".repeat(100) }), /cache limit/);
    now = 1000;
    assert.isUndefined(cache.get("doc-b:sub"));
    cache.set("other", { ...value, expiresAt: new Date(2000).toISOString() });
    cache.clear();
    assert.isUndefined(cache.get("other"));
  });
});
