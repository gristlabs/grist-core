import * as LocaleCurrencyMap from 'locale-currency/map';
import * as LocaleCurrency from 'locale-currency';
import {nativeCompare} from 'app/common/gutil';
import {localeCodes} from "app/common/LocaleCodes";

const DEFAULT_CURRENCY = "USD";

export interface Locale {
  name: string;
  code: string;
}

export let locales: Readonly<Locale[]>;

// Intl.DisplayNames is only supported on recent browsers, so proceed with caution.
try {
  const regionDisplay = new Intl.DisplayNames('en', {type: 'region'});
  const languageDisplay = new Intl.DisplayNames('en', {type: 'language'});
  const display = (code: string) => {
    try {
      const locale = new Intl.Locale(code);
      const regionName = regionDisplay.of(locale.region!);
      const languageName = languageDisplay.of(locale.language);
      return `${regionName} (${languageName})`;
    } catch (ex) {
      return code;
    }
  };
  // Leave only those that are supported by current system (can be translated to human readable form).
  // Though, this file is in common, it is safe to filter by current system
  // as the list should be already filtered by codes that are supported by the backend.
  locales = Intl.DisplayNames.supportedLocalesOf(localeCodes).map(code => {
    return {name: display(code), code};
  });
} catch {
  // Fall back to using the locale code as the display name.
  locales = localeCodes.map(code => ({name: code, code}));
}

export interface Currency {
  name: string;
  code: string;
}

export let currencies: Readonly<Currency[]>;

// locale-currency package doesn't have South Sudanese pound currency or a default value for Kosovo
LocaleCurrencyMap["SS"] = "SSP";
LocaleCurrencyMap["XK"] = "EUR";
const currenciesCodes = Object.values(LocaleCurrencyMap);
export function getCurrency(code: string) {
  const currency = LocaleCurrency.getCurrency(code ?? 'en-US');
  // Fallback to USD
  return currency ?? DEFAULT_CURRENCY;
}

// Intl.DisplayNames is only supported on recent browsers, so proceed with caution.
try {
  const currencyDisplay = new Intl.DisplayNames('en', {type: 'currency'});
  currencies = [...new Set(currenciesCodes)].map(code => {
    return {name: currencyDisplay.of(code)!, code};
  });
} catch {
  // Fall back to using the currency code as the display name.
  currencies = [...new Set(currenciesCodes)].map(code => {
    return {name: code, code};
  });
}

currencies = [...currencies].sort((a, b) => nativeCompare(a.code, b.code));


export function getCountryCode(locale: string) {
  // We have some defaults defined.
  if (locale === 'en') { return 'US'; }
  let countryCode = locale.split(/[-_]/)[1];
  if (countryCode) { return countryCode.toUpperCase(); }

  // Some defaults that we support and can't be read from language code.
  countryCode = {
    'uk': 'UA', // Ukraine
  }[locale] ?? locale.toUpperCase();

  // Test if we can use language as a country code.
  if (localeCodes.map(code => code.split(/[-_]/)[1]).includes(countryCode)) {
    return countryCode;
  }
  return null;
}
