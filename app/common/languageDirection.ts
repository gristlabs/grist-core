/**
 * The direction a language is written in. It is a default that comes with the language: nothing
 * stores it, and what is laid out in a language takes it unless told otherwise.
 */
export type Direction = "ltr" | "rtl";

// Languages written right-to-left in their usual script.
const RTL_LANGUAGES = new Set([
  "ar",   // Arabic
  "ckb",  // Central Kurdish (Sorani)
  "dv",   // Dhivehi
  "fa",   // Persian
  "he",   // Hebrew
  "ks",   // Kashmiri
  "ps",   // Pashto
  "sd",   // Sindhi
  "ug",   // Uyghur
  "ur",   // Urdu
  "yi",   // Yiddish
]);

// Scripts written right-to-left, for a locale that names its script (as in "pa-Arab-PK").
const RTL_SCRIPTS = new Set(["adlm", "arab", "hebr", "nkoo", "rohg", "syrc", "thaa"]);

// Languages whose script, and so whose direction, depends on the country.
const BY_COUNTRY: Record<string, Direction> = {
  "az-ir": "rtl",   // Azerbaijani, in Arabic script in Iran
  "pa-pk": "rtl",   // Punjabi, in Arabic script (Shahmukhi) in Pakistan
  "sd-in": "ltr",   // Sindhi, in Devanagari in India
};

/**
 * Returns the direction of the language of a locale such as "ar-SY", "he" or "uz-Arab-AF".
 * A locale that is missing, or not understood, is left-to-right.
 */
export function languageDirection(locale: string | null | undefined): Direction {
  const [language, ...rest] = (locale || "").toLowerCase().split(/[-_]/);
  // A script, when given, is the four-letter part after the language, and decides by itself.
  const script = rest.find(part => part.length === 4 && /^[a-z]+$/.test(part));
  if (script) { return RTL_SCRIPTS.has(script) ? "rtl" : "ltr"; }
  const country = rest.find(part => part.length === 2);
  const byCountry = country && BY_COUNTRY[`${language}-${country}`];
  if (byCountry) { return byCountry; }
  return RTL_LANGUAGES.has(language) ? "rtl" : "ltr";
}
