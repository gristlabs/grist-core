/**
 * This is a helper for producing autocomplete suggestions (aka completions) for the ACE code
 * editor. In particular, it's used for Access Rules formulas.
 */

// Suggestions are based on a prefix that's a dot-separated chain of attribute lookups (like
// "foo.bar.baz"). Each suggestion may offer additional attribute lookups via subAttributes().
export interface ISuggestionWithSubAttrs {
  value: string;        // The suggestion itself.
  example?: string;     // An optional example value to show on the right.

  // Once this suggestion is the prefix, its subAttributes() will be offered.
  subAttributes?: () => ISuggestionWithSubAttrs[];
}

/**
 * Expands a list of suggestions with sub-attributes, and filters it by prefix. E.g. if
 * "user.Email" suggestion includes a subAttributes() method that returns "upper()" and "lower()"
 * suggestions, then expanding "user.Email.u" would find and return "user.Email.upper()".
 */
export function expandAndFilterSuggestions(
  prefix: string, suggestions: ISuggestionWithSubAttrs[],
): ISuggestionWithSubAttrs[] {
  const result: ISuggestionWithSubAttrs[] = [];

  // Add all suggestions that start directly with prefix.
  for (const s of suggestions) {
    if (s.value.startsWith(prefix)) {
      result.push(s);
    }
  }

  // Next, look for suggestions that match some complete part of the prefix: those may have
  // subattributes we should consider. We split prefix (e.g. "foo.bar.ba") into [expr, attr]
  // e.g. ["foo.bar", "ba"], then look up the exact match for expr ("foo.bar") recursively, and
  // see if that match includes a subAttributes() function that returns anything matching "ba".
  const [expr, attr] = splitAttr(prefix);
  const exprResult = findMatchingSuggestion(expr, suggestions);
  const attrSuggestions = exprResult?.subAttributes?.();
  if (attrSuggestions) {
    for (const s of attrSuggestions) {
      if (s.value.startsWith(attr)) {
        // Prepend back the expr that precedes the attribute.
        result.push({...s, value: expr + "." + s.value});
      }
    }
  }
  return result;
}

// Given a list of suggestions, finds if any is an exact match for the given text. This may
// examine higher-level suggestions and their subattributes. E.g. if suggestions don't include
// an exact match for "foo.bar.baz", but include an exact match for "foo.bar", then its
// subAttributes() result will be checked for "baz", which would be considered an exact match.
function findMatchingSuggestion(text: string, suggestions: ISuggestionWithSubAttrs[]): ISuggestionWithSubAttrs|null {
  const match = suggestions.find(s => s.value === text);
  if (match) { return match; }
  if (!text.includes(".")) { return null; }
  const [expr, attr] = splitAttr(text);
  const exprResult = findMatchingSuggestion(expr, suggestions);
  const attrSuggestions = exprResult?.subAttributes?.();
  return attrSuggestions?.find(s => s.value === attr) || null;
}

// Splits a string like "foo.bar.baz" into ["foo.bar", "baz"]. Either half could be empty.
function splitAttr(text: string): [string, string] {
  const parts = text.split(".");
  return [parts.slice(0, -1).join("."), parts[parts.length - 1]];
}
