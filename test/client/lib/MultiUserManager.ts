import { parseEmailList } from "app/client/lib/MultiUserManager";

import { assert } from "chai";

describe("MultiUserManager", function() {
  it("parseEmailList should split emails on newlines, commas, semicolons, and spaces", function() {
    assert.deepEqual(parseEmailList(" A@example.com\r\n\nb@example.com, c@example.com;d@example.com e@example.com\n"),
      ["a@example.com", "b@example.com", "c@example.com", "d@example.com", "e@example.com"]);
    assert.deepEqual(parseEmailList(" ,\n; "), []);
  });

  it("parseEmailList should keep only the address from entries with display names", function() {
    assert.deepEqual(
      parseEmailList('"Prénom Nom" <p.nom@domain.fr>, John Doe <john@example.com>; <bare@example.com>'),
      ["p.nom@domain.fr", "john@example.com", "bare@example.com"]);
    assert.deepEqual(parseEmailList("Jane Doe <jane@example.com>"), ["jane@example.com"]);
  });

  it("parseEmailList should handle quoted display names containing separators", function() {
    assert.deepEqual(parseEmailList('"Doe, John" <john@example.com>'), ["john@example.com"]);
    assert.deepEqual(parseEmailList('owner@example.com, "Doe, John" <john@example.com>'),
      ["owner@example.com", "john@example.com"]);
  });
});
