import { localeFromRequest } from "app/server/lib/ServerLocale";

import { IncomingMessage } from "http";

import { assert } from "chai";

function req(acceptLanguage: string): IncomingMessage {
  return { headers: { "accept-language": acceptLanguage } } as IncomingMessage;
}

describe("ServerLocale", function() {
  describe("localeFromRequest", function() {
    it("gets locale from Accept-Language header", function() {
      assert.equal(localeFromRequest(req("fr-FR,fr;q=0.7,es;q=0.5")), "fr-FR");
      assert.equal(localeFromRequest(req("fr,fr-FR;q=0.7,es-ES;q=0.5")), "fr-FR");
      assert.equal(localeFromRequest(req("fr-FR,en-US;q=0.9")), "fr-FR");
      assert.equal(localeFromRequest(req("en-US;q=0.8,fr-FR;q=0.9,en")), "fr-FR");
    });

    it("returns defaultLocale when Accept-Language is missing", function() {
      assert.equal(localeFromRequest(req("")), "en-US");
    });

    it("returns defaultLocale when Accept-Language has unsupported locales", function() {
      assert.equal(localeFromRequest(req("fr,es;q=0.5")), "en-US");
      assert.equal(localeFromRequest(req("zz-ZZ,fr;q=0.7,es;q=0.5")), "en-US");
    });

    it("honors the defaultLocale argument", function() {
      assert.equal(localeFromRequest(req("fr,es;q=0.5"), "de-DE"), "de-DE");
      assert.equal(localeFromRequest(req("zz-ZZ,fr;q=0.7,es;q=0.5"), "de-DE"), "de-DE");
    });

    it("understands GRIST_DEFAULT_LOCALE", function() {
      process.env.GRIST_DEFAULT_LOCALE = "es-ES";
      assert.equal(localeFromRequest(req("fr-FR,fr;q=0.7,es;q=0.5")), "fr-FR");
      assert.equal(localeFromRequest(req("")), "es-ES");
      assert.equal(localeFromRequest(req("fr,es;q=0.5")), "es-ES");
      assert.equal(localeFromRequest(req("zz-ZZ,fr;q=0.7,es;q=0.5")), "es-ES");
      process.env.GRIST_DEFAULT_LOCALE = undefined;
    });
  });
});
