import { extractEmail } from "app/common/emails";

import { assert } from "chai";

describe("extractEmail", function() {
  it("keeps a plain address, trimming surrounding whitespace", function() {
    assert.equal(extractEmail(" jane@example.com "), "jane@example.com");
  });

  it("extracts an address from an unquoted display name", function() {
    assert.equal(extractEmail("Jane Doe <jane@example.com>"), "jane@example.com");
    assert.equal(extractEmail("Prénom Nom <p.nom@domain.fr>"), "p.nom@domain.fr");
  });

  it("extracts an address from a quoted display name", function() {
    assert.equal(extractEmail('"Doe, John" <john@example.com>'), "john@example.com");
  });

  it("extracts a bare bracketed address", function() {
    assert.equal(extractEmail("<jane@example.com>"), "jane@example.com");
  });
});
