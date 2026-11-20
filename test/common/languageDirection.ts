import { languageDirection } from "app/common/languageDirection";
import { localeCodes } from "app/common/LocaleCodes";

import { assert } from "chai";

describe("languageDirection", function() {
  it("knows the languages written right-to-left", function() {
    for (const locale of ["ar", "ar-SY", "ar_EG", "he-IL", "fa-IR", "ur-PK", "ps-AF", "ckb-IQ", "yi", "AR-sy"]) {
      assert.equal(languageDirection(locale), "rtl", locale);
    }
    for (const locale of ["en-US", "fr-FR", "de", "tr-TR", "zh-CN", "ja-JP", "ru-RU", "hi-IN"]) {
      assert.equal(languageDirection(locale), "ltr", locale);
    }
  });

  it("lets a script named in the locale decide", function() {
    assert.equal(languageDirection("pa-Arab-PK"), "rtl");
    assert.equal(languageDirection("uz-Arab-AF"), "rtl");
    assert.equal(languageDirection("uz-Latn-UZ"), "ltr");
    assert.equal(languageDirection("ks-Deva-IN"), "ltr");
    assert.equal(languageDirection("sr-Cyrl-RS"), "ltr");
  });

  it("knows the languages whose script depends on the country", function() {
    assert.equal(languageDirection("pa-PK"), "rtl");
    assert.equal(languageDirection("pa-IN"), "ltr");
    assert.equal(languageDirection("az-IR"), "rtl");
    assert.equal(languageDirection("az-AZ"), "ltr");
    assert.equal(languageDirection("sd-IN"), "ltr");
    assert.equal(languageDirection("sd-PK"), "rtl");
  });

  it("is left-to-right when there is no locale, or one it does not understand", function() {
    assert.equal(languageDirection(undefined), "ltr");
    assert.equal(languageDirection(null), "ltr");
    assert.equal(languageDirection(""), "ltr");
    assert.equal(languageDirection("zz-ZZ"), "ltr");
  });

  // Skipped where the runtime cannot tell; it is a check of the list, not of the function.
  it("agrees with the runtime for every locale a document can be given", function() {
    const info = (code: string) => {
      const locale: any = new Intl.Locale(code);
      return (locale.getTextInfo?.() ?? locale.textInfo)?.direction as string | undefined;
    };
    if (!info("en-US")) { this.skip(); }
    for (const code of localeCodes) {
      assert.equal(languageDirection(code), info(code), code);
    }
  });
});
