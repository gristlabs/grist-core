/**
 * This file generates list of supported locales for DocumentSettings editor,
 * stored in core/app/common/LocaleCodes.ts
 *
 * To regenerate the list run this script on linux (should be the run on the same OS as the one
 * being use to host Grist):
 *  node generate_locale_list.js
 *
 * Full list of codes was taken from https://lh.2xlibre.net/locales/.
 * List was modified by:
 * - removing tl-PH (PHILIPPINES Tagalog) as it is translated the same in English as Filipino.
 * - changing KV (Kosovo) to XK as this one is supported on Chrome (also in Node, Firefox and Python)
 *
 * For node:
 * - List of supported locales is generated by Intl.DisplayNames.supportedLocalesOf(locale) method.
 *
 * For python
 * - List is generated by using locale module, by script:
 *  import locale
 *  print(", ".join(sorted(set([('"' + l.replace("_", "-").split(".")[0] + '"') for l in locale.locale_alias.values()]))))
 */

// Locale codes from https://lh.2xlibre.net/locales/
const localeCodes = [
  "aa-DJ", "aa-ER", "aa-ET", "af-ZA", "agr-PE", "ak-GH", "am-ET",
  "an-ES", "anp-IN", "ar-AE", "ar-BH", "ar-DZ", "ar-EG", "ar-IN",
  "ar-IQ", "ar-JO", "ar-KW", "ar-LB", "ar-LY", "ar-MA", "ar-OM",
  "ar-QA", "ar-SA", "ar-SD", "ar-SS", "ar-SY", "ar-TN", "ar-YE",
  "as-IN", "ast-ES", "ayc-PE", "az-AZ", "az-IR", "be-BY", "bem-ZM",
  "ber-DZ", "ber-MA", "bg-BG", "bhb-IN", "bho-IN", "bho-NP", "bi-VU",
  "bn-BD", "bn-IN", "bo-CN", "bo-IN", "br-FR", "brx-IN", "bs-BA",
  "byn-ER", "ca-AD", "ca-ES", "ca-FR", "ca-IT", "ce-RU", "chr-US",
  "ckb-IQ", "cmn-TW", "crh-UA", "csb-PL", "cs-CZ", "cv-RU", "cy-GB",
  "da-DK", "de-AT", "de-BE", "de-CH", "de-DE", "de-IT", "de-LI",
  "de-LU", "doi-IN", "dsb-DE", "dv-MV", "dz-BT", "el-CY", "el-GR",
  "en-AG", "en-AU", "en-BW", "en-CA", "en-DK", "en-GB", "en-HK",
  "en-IE", "en-IL", "en-IN", "en-NG", "en-NZ", "en-PH", "en-SC",
  "en-SG", "en-US", "en-ZA", "en-ZM", "en-ZW", "es-AR", "es-BO",
  "es-CL", "es-CO", "es-CR", "es-CU", "es-DO", "es-EC", "es-ES",
  "es-GT", "es-HN", "es-MX", "es-NI", "es-PA", "es-PE", "es-PR",
  "es-PY", "es-SV", "es-US", "es-UY", "es-VE", "et-EE", "eu-ES",
  "fa-IR", "ff-SN", "fi-FI", "fil-PH", "fo-FO", "fr-BE", "fr-CA",
  "fr-CH", "fr-FR", "fr-LU", "fur-IT", "fy-DE", "fy-NL", "ga-IE",
  "gd-GB", "gez-ER", "gez-ET", "gl-ES", "gu-IN", "gv-GB", "hak-TW",
  "ha-NG", "he-IL", "hif-FJ", "hi-IN", "hne-IN", "hr-HR", "hsb-DE",
  "ht-HT", "hu-HU", "hy-AM", "ia-FR", "id-ID", "ig-NG", "ik-CA",
  "is-IS", "it-CH", "it-IT", "iu-CA", "ja-JP", "kab-DZ", "ka-GE",
  "kk-KZ", "kl-GL", "km-KH", "kn-IN", "kok-IN", "ko-KR", "ks-IN",
  "ku-TR", "kw-GB", "ky-KG", "lb-LU", "lg-UG", "li-BE", "lij-IT",
  "li-NL", "ln-CD", "lo-LA", "lt-LT", "lv-LV", "lzh-TW", "mag-IN",
  "mai-IN", "mai-NP", "mfe-MU", "mg-MG", "mhr-RU", "mi-NZ", "miq-NI",
  "mjw-IN", "mk-MK", "ml-IN", "mni-IN", "mn-MN", "mnw-MM", "mr-IN",
  "ms-MY", "mt-MT", "my-MM", "nan-TW", "nb-NO", "nds-DE", "nds-NL",
  "ne-NP", "nhn-MX", "niu-NU", "niu-NZ", "nl-AW", "nl-BE", "nl-NL",
  "nn-NO", "nr-ZA", "nso-ZA", "oc-FR", "om-ET", "om-KE", "or-IN",
  "os-RU", "pa-IN", "pap-AN", "pap-AW", "pap-CW", "pa-PK", "pl-PL",
  "ps-AF", "pt-BR", "pt-PT", "quz-PE", "raj-IN", "ro-RO", "ru-RU",
  "ru-UA", "rw-RW", "sah-RU", "sa-IN", "sat-IN", "sc-IT", "sd-IN",
  "se-NO", "sgs-LT", "shn-MM", "shs-CA", "sid-ET", "si-LK", "sk-SK",
  "sl-SI", "sm-WS", "so-DJ", "so-ET", "so-KE", "so-SO", "sq-AL",
  "sq-XK", "sq-MK", "sr-ME", "sr-RS", "ss-ZA", "st-ZA", "sv-FI",
  "sv-SE", "sw-KE", "sw-TZ", "szl-PL", "ta-IN", "ta-LK", "tcy-IN",
  "te-IN", "tg-TJ", "the-NP", "th-TH", "ti-ER", "ti-ET", "tig-ER",
  "tk-TM", "tn-ZA", "to-TO", "tpi-PG", "tr-CY", "tr-TR",
  "ts-ZA", "tt-RU", "ug-CN", "uk-UA", "unm-US", "ur-IN", "ur-PK",
  "uz-UZ", "ve-ZA", "vi-VN", "wa-BE", "wae-CH", "wal-ET", "wo-SN",
  "xh-ZA", "yi-US", "yo-NG", "yue-HK", "yuw-PG", "zh-CN", "zh-HK",
  "zh-SG", "zh-TW", "zu-ZA"
]

// Locales supported in the OS being used to run this script, which should be what's used for running Grist in production.
const inNode = new Set(Intl.DisplayNames.supportedLocalesOf(localeCodes));

// Locale supported in Python 3.8.
// Currently Python locales support is not that important, but might be in the future.
const inPython = new Set([
  "C", "aa-DJ", "aa-ER", "aa-ET", "af-ZA", "agr-PE", "ak-GH", "am-ET",
  "an-ES", "anp-IN", "ar-AA", "ar-AE", "ar-BH", "ar-DZ", "ar-EG", "ar-IN",
  "ar-IQ", "ar-JO", "ar-KW", "ar-LB", "ar-LY", "ar-MA", "ar-OM", "ar-QA",
  "ar-SA", "ar-SD", "ar-SS", "ar-SY", "ar-TN", "ar-YE", "as-IN", "ast-ES",
  "ayc-PE", "az-AZ", "az-IR", "be-BY", "bem-ZM", "ber-DZ", "ber-MA",
  "bg-BG", "bhb-IN", "bho-IN", "bho-NP", "bi-VU", "bn-BD", "bn-IN", "bo-CN",
  "bo-IN", "br-FR", "brx-IN", "bs-BA", "byn-ER", "ca-AD", "ca-ES", "ca-FR",
  "ca-IT", "ce-RU", "chr-US", "ckb-IQ", "cmn-TW", "crh-UA", "cs-CZ",
  "csb-PL", "cv-RU", "cy-GB", "da-DK", "de-AT", "de-BE", "de-CH", "de-DE",
  "de-IT", "de-LI", "de-LU", "doi-IN", "dv-MV", "dz-BT", "ee-EE", "el-CY",
  "el-GR", "en-AG", "en-AU", "en-BE", "en-BW", "en-CA", "en-DK", "en-DL",
  "en-EN", "en-GB", "en-HK", "en-IE", "en-IL", "en-IN", "en-NG", "en-NZ",
  "en-PH", "en-SC", "en-SG", "en-US", "en-ZA", "en-ZM", "en-ZS", "en-ZW",
  "eo", "eo-EO", "eo-US", "eo-XX", "es-AR", "es-BO", "es-CL", "es-CO",
  "es-CR", "es-CU", "es-DO", "es-EC", "es-ES", "es-GT", "es-HN", "es-MX",
  "es-NI", "es-PA", "es-PE", "es-PR", "es-PY", "es-SV", "es-US", "es-UY",
  "es-VE", "et-EE", "eu-ES", "eu-FR", "fa-IR", "ff-SN", "fi-FI", "fil-PH",
  "fo-FO", "fr-BE", "fr-CA", "fr-CH", "fr-FR", "fr-LU", "fur-IT", "fy-DE",
  "fy-NL", "ga-IE", "gd-GB", "gez-ER", "gez-ET", "gl-ES", "gu-IN", "gv-GB",
  "ha-NG", "hak-TW", "he-IL", "hi-IN", "hif-FJ", "hne-IN", "hr-HR",
  "hsb-DE", "ht-HT", "hu-HU", "hy-AM", "ia", "ia-FR", "id-ID", "ig-NG",
  "ik-CA", "is-IS", "it-CH", "it-IT", "iu-CA", "iw-IL", "ja-JP", "ka-GE",
  "kab-DZ", "kk-KZ", "kl-GL", "km-KH", "kn-IN", "ko-KR", "kok-IN", "ks-IN",
  "ku-TR", "kw-GB", "ky-KG", "lb-LU", "lg-UG", "li-BE", "li-NL", "lij-IT",
  "ln-CD", "lo-LA", "lt-LT", "lv-LV", "lzh-TW", "mag-IN", "mai-IN",
  "mai-NP", "mfe-MU", "mg-MG", "mhr-RU", "mi-NZ", "miq-NI", "mjw-IN",
  "mk-MK", "ml-IN", "mn-MN", "mni-IN", "mr-IN", "ms-MY", "mt-MT", "my-MM",
  "nan-TW", "nb-NO", "nds-DE", "nds-NL", "ne-NP", "nhn-MX", "niu-NU",
  "niu-NZ", "nl-AW", "nl-BE", "nl-NL", "nn-NO", "no-NO", "nr-ZA", "nso-ZA",
  "ny-NO", "oc-FR", "om-ET", "om-KE", "or-IN", "os-RU", "pa-IN", "pa-PK",
  "pap-AN", "pap-AW", "pap-CW", "pd-DE", "pd-US", "ph-PH", "pl-PL", "pp-AN",
  "ps-AF", "pt-BR", "pt-PT", "quz-PE", "raj-IN", "ro-RO", "ru-RU", "ru-UA",
  "rw-RW", "sa-IN", "sat-IN", "sc-IT", "sd-IN", "sd-PK", "se-NO", "sgs-LT",
  "sh-HR", "shn-MM", "shs-CA", "si-LK", "sid-ET", "sk-SK", "sl-CS", "sl-SI",
  "sm-WS", "so-DJ", "so-ET", "so-KE", "so-SO", "sq-AL", "sq-MK", "sr-CS",
  "sr-ME", "sr-RS", "ss-ZA", "st-ZA", "sv-FI", "sv-SE", "sw-KE", "sw-TZ",
  "szl-PL", "ta-IN", "ta-LK", "tcy-IN", "te-IN", "tg-TJ", "th-TH", "the-NP",
  "ti-ER", "ti-ET", "tig-ER", "tk-TM", "tl-PH", "tn-ZA", "to-TO", "tpi-PG",
  "tr-CY", "tr-TR", "ts-ZA", "tt-RU", "ug-CN", "uk-UA", "unm-US", "ur-IN",
  "ur-PK", "uz-UZ", "ve-ZA", "vi-VN", "wa-BE", "wae-CH", "wal-ET", "wo-SN",
  "xh-ZA", "yi-US", "yo-NG", "yue-HK", "yuw-PG", "zh-CN", "zh-HK", "zh-SG",
  "zh-TW", "zu-ZA"
]);

// Generate file content
const isSupported = (locale) => [inNode, inPython].every(set => set.has(locale));
const supportedList = localeCodes.filter(isSupported);
// Convert to text, 7 codes per line
const supportedText = supportedList
  .map(locale => `"${locale}"`)
  .reduce((list, locale) => {
    let line = list.pop() || [];
    if (line.length > 6) {
      list.push(line);
      line = []
    }
    line.push(locale);
    list.push(line);
    return list;
  }, [])
  .map(line => "  " + line.join(", "))
  .join(",\n");

const fileContent = `// This file was generated by core/buildtools/generate_locale_list.js at ${new Date().toISOString()}
export const localeCodes = [
${supportedText}
];
`
const fs = require("fs");
const path = require("path");
fs.writeFileSync(path.join(__dirname, "../app/common/LocaleCodes.ts"), fileContent);
