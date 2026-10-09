import LinkifyIt from "linkify-it";

// Markdown cells also use linkify-it, so links end in the same place in both. Here we only
// recognize explicit http(s) links, not bare domains like "might.it", emails, or other schemas.
const linkify = new LinkifyIt({}, { fuzzyLink: false, fuzzyEmail: false, fuzzyIP: false });
const linkSchemas = new Set(["http:", "https:"]);

/**
 * Detects URLs in a text and returns list of tokens { value, isLink }. Links will be at
 * odd-number indices.
 */
export function findLinks(text: string): { value: string, isLink: boolean }[] {
  if (!text) {
    return [{ value: text, isLink: false }];
  }
  const tokens = [];
  let pos = 0;
  for (const match of linkify.match(text) || []) {
    if (!linkSchemas.has(match.schema)) { continue; }
    tokens.push({ value: text.slice(pos, match.index), isLink: false });
    tokens.push({ value: match.raw, isLink: true });
    pos = match.lastIndex;
  }
  tokens.push({ value: text.slice(pos), isLink: false });
  return tokens;
}

/**
 * Based on https://stackoverflow.com/a/22429679/2482744
 * -----------------------------------------------------
 * Calculate a 32 bit FNV-1a hash
 * Found here: https://gist.github.com/vaiorabbit/5657561
 * Ref.: http://isthe.com/chongo/tech/comp/fnv/
 */
export function hashFnv32a(str: string): string {
  let hval = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hval ^= str.charCodeAt(i);
    hval += (hval << 1) + (hval << 4) + (hval << 7) + (hval << 8) + (hval << 24);
  }
  // Convert to 8 digit hex string
  return ("0000000" + (hval >>> 0).toString(16)).substr(-8);
}

/**
 * A poor man's hash for when proper crypto isn't worth it.
 */
export function simpleStringHash(str: string) {
  let result = "";
  // Crudely convert 32 bits to 128 bits to reduce collisions
  for (let i = 0; i < 4; i++) {
    result += hashFnv32a(result + str);
  }
  return result;
}
