import { getGravatarUrl } from "app/common/GravatarUtils";

import { assert } from "chai";

async function hashEmail(email: string): Promise<string> {
  const enc = new TextEncoder();
  const hashAsArrayBuffer = await crypto.subtle.digest("SHA-256", enc.encode(email));
  const uint8ViewOfHash = new Uint8Array(hashAsArrayBuffer);
  const hash = Array.from(uint8ViewOfHash)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
  return hash;
}

describe("GravatarUtils", function() {
  describe("getGravatarUrl", function() {
    it("should normalize email (trim and lowercase)", async function() {
      const email = "  Test@Example.COM  ";
      const url = await getGravatarUrl(email);
      assert.include(url, await hashEmail(email.trim().toLowerCase()));
    });

    it("should use default size of 200", async function() {
      const email = "test@example.com";
      const url = await getGravatarUrl(email);
      assert.include(url, "s=200");
    });

    it("should accept custom size", async function() {
      const email = "test@example.com";
      const url = await getGravatarUrl(email, 100);
      assert.include(url, "s=100");
    });

    it("should include identicon fallback", async function() {
      const email = "test@example.com";
      const url = await getGravatarUrl(email);
      assert.include(url, "d=identicon");
    });
  });
});
