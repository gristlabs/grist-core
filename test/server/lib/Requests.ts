import { SandboxRequest } from "app/common/ActionBundle";
import { delay } from "app/common/delay";
import { ActiveDoc } from "app/server/lib/ActiveDoc";
import { DocRequests } from "app/server/lib/Requests";
import { assert } from "test/server/testUtils";
import * as testUtils from "test/server/testUtils";

import * as os from "os";
import * as path from "path";

import * as fse from "fs-extra";

describe("Requests", function() {
  testUtils.setTmpLogLevel("error");

  // The cache key comes from the sandbox, so it must not be able to name a path
  // outside the cache dir.
  const request: SandboxRequest = { url: "https://example.com", method: "GET" } as SandboxRequest;

  // Only _activeDoc.docName is used, so a stub suffices.
  function makeRequests() {
    return new DocRequests({ docName: "test-doc" } as ActiveDoc);
  }

  it("rejects a cache key that is not a plain SHA-256 hash", async function() {
    const requests = makeRequests();
    const outside = path.join(os.tmpdir(), `grist-requests-test-${process.pid}-should-not-exist.json`);
    await fse.remove(outside);
    for (const badKey of [outside, "../escape", "..", "abc", "A".repeat(64), `${"a".repeat(64)}/../x`]) {
      await assert.isRejected(requests.handleSingleRequestWithCache(badKey, request), /invalid request cache key/);
    }
    // Let any stray fire-and-forget write land before asserting absence.
    await delay(50);
    assert.isFalse(await fse.pathExists(outside), "must not write outside the cache dir");
  });

  it("accepts a well-formed hash key", async function() {
    const requests = makeRequests();
    const goodKey = "a".repeat(64);
    // REQUEST is off by default, so this returns an error object rather than throwing.
    const result = await requests.handleSingleRequestWithCache(goodKey, request);
    assert.property(result, "error");
  });
});
