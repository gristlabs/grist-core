import { guessExt } from "app/server/lib/guessExt";

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { assert } from "chai";

// A small but valid 1x1 PNG, enough for file-type to recognize it.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64");

const SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>
`;

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<root><child/></root>
`;

describe("guessExt", function() {
  let tmpDir: string;

  beforeEach(async function() {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "grist-guess-ext-"));
  });

  afterEach(async function() {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function check(fileName: string, contents: string | Buffer, mimeType: string | null,
    expected: string) {
    const filePath = path.join(tmpDir, fileName);
    await fs.writeFile(filePath, contents);
    assert.equal(await guessExt(filePath, fileName, mimeType), expected,
      `${fileName} with MIME type ${mimeType}`);
  }

  describe("SVG files", function() {
    // file-type reports SVG files as XML, so we must not lose the SVG extension or MIME type.
    it("keeps an .svg extension when the MIME type is missing", async function() {
      await check("image.svg", SVG, null, ".svg");
    });

    it("keeps an .svg extension when the MIME type is generic", async function() {
      await check("image.svg", SVG, "application/octet-stream", ".svg");
    });

    it("keeps an .svg extension when the MIME type claims XML", async function() {
      await check("image.svg", SVG, "application/xml", ".svg");
    });

    it("uses an SVG MIME type when the file name has no extension", async function() {
      await check("image", SVG, "image/svg+xml", ".svg");
    });

    it("recognizes SVG contents when the name and MIME type are unhelpful", async function() {
      await check("upload", SVG, "application/octet-stream", ".svg");
    });
  });

  describe("other files", function() {
    it("still recognizes plain XML as .xml", async function() {
      await check("data.xml", XML, null, ".xml");
    });

    it("still detects a PNG from its contents", async function() {
      await check("image.png", PNG_1X1, null, ".png");
    });

    it("still trusts a .csv extension over a misleading MIME type", async function() {
      await check("data.csv", "a,b\n1,2\n", "application/vnd.ms-excel", ".csv");
    });

    it("still uses a JSON MIME type over the file name", async function() {
      await check("upload", "{\"a\":1}", "application/json", ".json");
    });
  });
});
