import { trustOrigin } from "app/server/lib/requestUtils";

import { assert } from "chai";

describe("requestUtils", function() {
  describe("trustOrigin", function() {
    const combinations = [
      ["http://localhost:8080", "localhost:9999", true],
      ["http://localhost:8080", "api.getgrist.com", false],
      ["https://docs.getgrist.com", "docs.getgrist.com", true],
      ["https://www.getgrist.com", "docs.getgrist.com", true],
      ["https://nytimes.com", "docs.getgrist.com", false],
      ["https://getgrist.com.co.uk", "docs.getgrist.com", false],
      ["https://efc-r.com", "docs.getgrist.com", false],
      ["https://efc-r.com", "nasa.getgrist.com", false],
      ["https://nasa.efc-r.com", "docs.getgrist.com", false],
      ["https://nasa.efc-r.com", "docs.efc-r.com", true],
      ["https://nasa.efc-r.com", "api.efc-r.com", true],
      ["null", "docs.getgrist.com", false],
      ["", "docs.getgrist.com", true],
    ];
    for (const [origin, host, permitted] of combinations) {
      it(`'${origin}' can${permitted ? "" : "not"} access '${host}' in browser`, function() {
        assert.equal(
          trustOrigin({ headers: { origin, host } } as any, { header: (a: string, b: string) => true } as any),
          permitted,
        );
      });
    }

    const apiErrorTestCases = [
      "invalid url",
    ];
    for (const origin of apiErrorTestCases) {
      it(`throws an ApiError on invalid origin '${origin}'`, function() {
        assert.throws(() => trustOrigin({ headers: { origin } } as any));
      });
    }
  });
});
