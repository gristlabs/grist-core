import { parseEmailList } from "app/client/lib/MultiUserManager";

import { assert } from "chai";

describe("MultiUserManager", function() {
  it("parseEmailList should split emails on newlines, commas, semicolons, and spaces", function() {
    assert.deepEqual(parseEmailList(" A@example.com\r\n\nb@example.com, c@example.com;d@example.com e@example.com\n"),
      ["a@example.com", "b@example.com", "c@example.com", "d@example.com", "e@example.com"]);
    assert.deepEqual(parseEmailList(" ,\n; "), []);
  });
});
