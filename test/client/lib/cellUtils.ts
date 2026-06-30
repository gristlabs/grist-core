import { formatRawCellValue, indexToLetter } from "app/client/lib/cellUtils";

import { assert } from "chai";

describe("cellUtils", function() {
  describe("indexToLetter", function() {
    it("should convert single-letter indices (0-25)", function() {
      assert.equal(indexToLetter(0), "A");
      assert.equal(indexToLetter(1), "B");
      assert.equal(indexToLetter(25), "Z");
    });

    it("should convert two-letter indices (26-701)", function() {
      assert.equal(indexToLetter(26), "AA");
      assert.equal(indexToLetter(27), "AB");
      assert.equal(indexToLetter(51), "AZ");
      assert.equal(indexToLetter(52), "BA");
      assert.equal(indexToLetter(53), "BB");
      assert.equal(indexToLetter(701), "ZZ");
    });

    it("should convert three-letter indices (702+)", function() {
      assert.equal(indexToLetter(702), "AAA");
      assert.equal(indexToLetter(703), "AAB");
    });
  });

  describe("formatRawCellValue", function() {
    it("should return empty string for null/undefined/empty", function() {
      assert.equal(formatRawCellValue(null), "");
      assert.equal(formatRawCellValue(undefined), "");
      assert.equal(formatRawCellValue(""), "");
    });

    it("should return #ERROR for error tuples", function() {
      assert.equal(formatRawCellValue(["E", "some error"]), "#ERROR");
    });

    it("should stringify other values", function() {
      assert.equal(formatRawCellValue(42), "42");
      assert.equal(formatRawCellValue("hello"), "hello");
    });
  });
});
