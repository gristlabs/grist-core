import LocaleCurrency = require('locale-currency/map');
import {nativeCompare} from 'app/common/gutil';

const localeCodes = [
  "es-AR", "hy-AM", "en-AU", "az-AZ", "be-BY", "quz-BO", "pt-BR",
  "bg-BG", "en-CA", "arn-CL", "es-CO", "hr-HR", "cs-CZ", "da-DK",
  "es-EC", "ar-EG", "fi-FI", "fr-FR", "ka-GE", "de-DE", "el-GR", "en-HK",
  "hu-HU", "hi-IN", "id-ID", "ga-IE", "ar-IL", "it-IT", "ja-JP", "kk-KZ",
  "lv-LV", "lt-LT", "es-MX", "mn-MN", "my-MM", "nl-NL", "nb-NO",
  "es-PY", "ceb-PH", "pl-PL", "pt-PT", "ro-RO", "ru-RU", "sr-RS",
  "sk-SK", "sl-SI", "ko-KR", "es-ES", "sv-SE", "de-CH", "zh-TW", "th-TH",
  "tr-TR", "uk-UA", "en-GB", "en-US", "es-UY", "es-VE", "vi-VN"
];

export interface Locale {
  name: string;
  code: string;
}

export let locales: Readonly<Locale[]>;

// Intl.DisplayNames is only supported on recent browsers, so proceed with caution.
try {
  const localeDisplay = new Intl.DisplayNames('en', {type: 'region'});
  locales = localeCodes.map(code => {
    return { name: localeDisplay.of(new Intl.Locale(code).region), code };
  });
} catch {
  // Fall back to using the locale code as the display name.
  locales = localeCodes.map(code => ({ name: code, code }));
}

export interface Currency {
  name: string;
  code: string;
}

export let currencies: Readonly<Currency[]>;

// Intl.DisplayNames is only supported on recent browsers, so proceed with caution.
try {
  const currencyDisplay = new Intl.DisplayNames('en', {type: 'currency'});
  currencies = [...new Set(Object.values(LocaleCurrency))].map(code => {
    return { name: currencyDisplay.of(code), code };
  });
} catch {
  // Fall back to using the currency code as the display name.
  currencies = [...new Set(Object.values(LocaleCurrency))].map(code => {
    return { name: code, code };
  });
}

currencies = [...currencies].sort((a, b) => nativeCompare(a.code, b.code));
