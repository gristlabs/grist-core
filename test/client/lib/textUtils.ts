import { stripLinks } from "app/client/lib/markdown";
import { findLinks, hashFnv32a, simpleStringHash } from "app/client/lib/textUtils";

import { assert } from "chai";

describe("textUtils", function() {
  it("hashFnv32a should produce correct hashes", function() {
    // Test 32-bit for various strings
    function check(s: string, expected: number) {
      assert.equal(hashFnv32a(s), expected.toString(16).padStart(8, "0"));
    }

    // Based on https://github.com/sindresorhus/fnv1a/blob/053a8cb5a0f99212e71acb73a47823f26081b6e9/test.js
    check((""), 2_166_136_261);
    check(("h"), 3_977_000_791);
    check(("he"), 1_547_363_254);
    check(("hel"), 179_613_742);
    check(("hell"), 477_198_310);
    check(("hello"), 1_335_831_723);
    check(("hello "), 3_801_292_497);
    check(("hello w"), 1_402_552_146);
    check(("hello wo"), 3_611_200_775);
    check(("hello wor"), 1_282_977_583);
    check(("hello worl"), 2_767_971_961);
    check(("hello world"), 3_582_672_807);
    check("Lorem ipsum dolor sit amet, consectetuer adipiscing elit. " +
      "Aenean commodo ligula eget dolor. Aenean massa. " +
      "Cum sociis natoque penatibus et magnis dis parturient montes, " +
      "nascetur ridiculus mus. Donec quam felis, ultricies nec, " +
      "pellentesque eu, pretium quis, sem. Nulla consequat massa quis enim. " +
      "Donec pede justo, fringilla vel, aliquet nec, vulputate eget, arcu. " +
      "In enim justo, rhoncus ut, imperdiet a, venenatis vitae, justo. " +
      "Nullam dictum felis eu pede mollis pretium. " +
      "Lorem ipsum dolor sit amet, consectetuer adipiscing elit. " +
      "Aenean commodo ligula eget dolor. Aenean massa. " +
      "Cum sociis natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. " +
      "Donec quam felis, ultricies nec, pellentesque eu, pretium quis, sem. " +
      "Nulla consequat massa quis enim. Donec pede justo, fringilla vel, aliquet nec, " +
      "vulputate eget, arcu. In enim justo, rhoncus ut, imperdiet a, venenatis vitae, justo. " +
      "Nullam dictum felis eu pede mollis pretium. Lorem ipsum dolor sit amet, consectetuer adipiscing elit. " +
      "Aenean commodo ligula eget dolor. Aenean massa. Cum sociis natoque penatibus et magnis dis parturient " +
      "montes, nascetur ridiculus mus. Donec quam felis, ultricies nec, pellentesque eu, pretium quis, sem. " +
      "Nulla consequat massa quis enim. Donec pede justo, fringilla vel, aliquet nec, vulputate eget, arcu. " +
      "In enim justo, rhoncus ut, imperdiet a, venenatis vitae, justo. Nullam dictum felis eu pede mollis pretium.",
    2_964_896_417);
  });

  it("simpleStringHash should produce correct hashes", function() {
    // Not based on anything, just need to know if it changes
    assert.equal(simpleStringHash("hello"), "4f9f2cab3cfabf04ee7da04597168630");
  });

  it("removes links from markdown text", function() {
    // This test checks if the function stripLinks can successfully remove links from markdown text leaving any
    // other text intact.

    // Test data, markdown text and expected result
    const testData: [string, string][] = [
      ["[link](https://example.com)", "link"],
      // In bold
      ["**[link](https://example.com)**", "**link**"],
      // Itallic
      ["*[link](https://example.com)*", "*link*"],
      // In bold and itallic
      ["***[link](https://example.com)***", "***link***"],
      // Line breaks
      ["[link](https://example.com)\n[link](https://example.com/page?arg=%20&)", "link\nlink"],
      // Line breaks in brakcets
      ["[first\nsecond](https://example.com)", "first\nsecond"],
      // Multiple line in brackets
      ["[first\n\nsecond](https://example.com)", "first\n\nsecond"],
      // Tables with links in headers
      [`
| [link](https://example.com) | [link](https://example.com) |
| --- | --- |
| [link](https://example.com) | [link](https://example.com) |`.trim(),
      `
| link | link |
| --- | --- |
| link | link |`.trim()],
    ];

    testData.forEach(([markdownText, expected]) => assert.equal(
      stripLinks(markdownText),
      expected,
      `failed for ${markdownText}`,
    ));
  });

  it("should find links in text", function() {
    const testData: [string, { value: string, isLink: boolean }[]][] = [
      ["", [{ value: "", isLink: false }]],
      ["Plain text", [{ value: "Plain text", isLink: false }]],
      ["might.it be a link", [{ value: "might.it be a link", isLink: false }]],
      ["Visit https://www.uk/docs now.", [
        { value: "Visit ", isLink: false },
        { value: "https://www.uk/docs", isLink: true },
        { value: " now.", isLink: false },
      ]],
      ["Link (in http://www.uk?)", [
        { value: "Link (in ", isLink: false },
        { value: "http://www.uk", isLink: true },
        { value: "?)", isLink: false },
      ]],
      ["http://www.uk,http://www.uk", [
        { value: "", isLink: false },
        { value: "http://www.uk", isLink: true },
        { value: ",", isLink: false },
        { value: "http://www.uk", isLink: true },
        { value: "", isLink: false },
      ]],
      ["https://www.uk:8080/a?b=c2", [
        { value: "", isLink: false },
        { value: "https://www.uk:8080/a?b=c2", isLink: true },
        { value: "", isLink: false },
      ]],
      ["https://www.uk/a?b=c-", [
        { value: "", isLink: false },
        { value: "https://www.uk/a?b=c-", isLink: true },
        { value: "", isLink: false },
      ]],
      ["See https://www.uk/some-page- for details.", [
        { value: "See ", isLink: false },
        { value: "https://www.uk/some-page-", isLink: true },
        { value: " for details.", isLink: false },
      ]],
      ["See https://www.uk/some-page for details.", [
        { value: "See ", isLink: false },
        { value: "https://www.uk/some-page", isLink: true },
        { value: " for details.", isLink: false },
      ]],
      ["See https://www.uk/s-o-m-e-p-a-g-e for details.", [
        { value: "See ", isLink: false },
        { value: "https://www.uk/s-o-m-e-p-a-g-e", isLink: true },
        { value: " for details.", isLink: false },
      ]],
      // A hostname can't end in a dash, so this isn't a link.
      ["See https://www.uk- for details.", [
        { value: "See https://www.uk- for details.", isLink: false },
      ]],
      ["https://en.wikipedia.org/wiki/Saint-%C3%89tienne", [
        { value: "", isLink: false },
        { value: "https://en.wikipedia.org/wiki/Saint-%C3%89tienne", isLink: true },
        { value: "", isLink: false },
      ]],
      ["https://www.uk/a-/b and https://www.uk/page-?q=1", [
        { value: "", isLink: false },
        { value: "https://www.uk/a-/b", isLink: true },
        { value: " and ", isLink: false },
        { value: "https://www.uk/page-?q=1", isLink: true },
        { value: "", isLink: false },
      ]],
      ["(see https://www.uk/page)-", [
        { value: "(see ", isLink: false },
        { value: "https://www.uk/page", isLink: true },
        { value: ")-", isLink: false },
      ]],
      ["Wiki https://en.wikipedia.org/wiki/Grist_(disambiguation).", [
        { value: "Wiki ", isLink: false },
        { value: "https://en.wikipedia.org/wiki/Grist_(disambiguation)", isLink: true },
        { value: ".", isLink: false },
      ]],
      // Only http(s) links are recognized.
      ["mailto:me@www.uk ftp://www.uk //www.uk me@www.uk", [
        { value: "mailto:me@www.uk ftp://www.uk //www.uk me@www.uk", isLink: false },
      ]],
      ["HTTPS://WWW.UK/DOCS", [
        { value: "", isLink: false },
        { value: "HTTPS://WWW.UK/DOCS", isLink: true },
        { value: "", isLink: false },
      ]],
      ["https://127.0.0.1:8080/api", [
        { value: "", isLink: false },
        { value: "https://127.0.0.1:8080/api", isLink: true },
        { value: "", isLink: false },
      ]],
    ];

    testData.forEach(([text, expected]) => assert.deepEqual(
      findLinks(text),
      expected,
      `failed for ${text}`,
    ));
  });
});
