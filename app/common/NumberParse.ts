/**
 * Counterpart of NumberFormat.ts.
 * Generic functionality for parsing numbers formatted by Intl.NumberFormat,
 * not tied to documents or anything.
 */

import { NumMode, parseNumMode } from 'app/common/NumberFormat';
import escapeRegExp = require('lodash/escapeRegExp');
import last = require('lodash/last');

// Possible values of Intl.NumberFormat.formatToParts[i].type
// Seems Intl.NumberFormatPartTypes is not quite complete
type NumberFormatPartTypes = Intl.NumberFormatPartTypes | 'exponentSeparator';

/**
 * Returns a map converting the decimal digits used in the given formatter
 * to the digits 0123456789.
 * Excludes digits which don't need conversion, so for many locales this is empty.
 */
function getDigitsMap(locale: string) {
  const formatter = Intl.NumberFormat(locale);
  const result = new Map<string, string>();
  for (let i = 0; i < 10; i++) {
    const digit = String(i);
    const localeDigit = formatter.format(i);
    if (localeDigit !== digit) {
      result.set(localeDigit, digit);
    }
  }
  return result;
}

export default class NumberParse {
  // Regex for whitespace and some control characters we need to remove
  // 200e = Left-to-right mark
  // 200f = Right-to-left mark
  // 061c = Arabic letter mark
  public static readonly removeCharsRegex = /[\s\u200e\u200f\u061c]/g;

  // Many attributes are public for easy testing.
  public readonly currencySymbol: string;
  public readonly percentageSymbol: string;
  public readonly digitGroupSeparator: string;
  public readonly digitGroupSeparatorCurrency: string;
  public readonly exponentSeparator: string;
  public readonly decimalSeparator: string;
  public readonly minusSign: string;

  public readonly digitsMap: Map<string, string>;

  public readonly currencyEndsInMinusSign: boolean;

  private readonly _exponentSeparatorRegex: RegExp;
  private readonly _digitGroupSeparatorRegex: RegExp;

  // Function which replaces keys of digitsMap (i.e. locale-specific digits)
  // with corresponding digits from 0123456789.
  private readonly _replaceDigits: (s: string) => string;

  constructor(locale: string, currency: string) {
    const numModes: NumMode[] = ['currency', 'percent', 'scientific', 'decimal'];
    const parts = new Map<NumMode, Intl.NumberFormatPart[]>();
    for (const numMode of numModes) {
      const formatter = Intl.NumberFormat(locale, parseNumMode(numMode, currency));
      const formatParts = formatter.formatToParts(-1234567.5678);
      parts.set(numMode, formatParts);
    }

    function getPart(partType: NumberFormatPartTypes, numMode: NumMode = "decimal"): string {
      const part = parts.get(numMode)!.find(p => p.type === partType);
      // Only time we expect `part` to be undefined is for digitGroupSeparatorCurrency
      return part?.value || '';
    }

    this.currencySymbol = getPart('currency', 'currency');
    this.percentageSymbol = getPart('percentSign', 'percent');
    this.exponentSeparator = getPart('exponentSeparator', 'scientific');
    this.minusSign = getPart('minusSign');
    this.decimalSeparator = getPart('decimal');

    // Separators for groups of digits, typically groups of 3, i.e. 'thousands separators'.
    // A few locales have different separators for currency and non-currency.
    // We check for both but don't check which one is used, currency or not.
    this.digitGroupSeparator = getPart('group');
    this.digitGroupSeparatorCurrency = getPart('group', 'currency');

    // A few locales format negative currency amounts ending in '-', e.g. '€ 1,00-'
    this.currencyEndsInMinusSign = last(parts.get('currency'))!.type === 'minusSign';

    // Since JS and Python allow both e and E for scientific notation, it seems fair that other
    // locales should be case insensitive for this.
    this._exponentSeparatorRegex = new RegExp(escapeRegExp(this.exponentSeparator), 'i');

    // Overall the parser is quite lax about digit separators.
    // We only require that the separator is followed by at least 2 digits,
    // because India groups digits in pairs after the first 3.
    // More careful checking is probably more complicated than is worth it.
    this._digitGroupSeparatorRegex = new RegExp(
      `[${escapeRegExp(
        this.digitGroupSeparator +
        this.digitGroupSeparatorCurrency
      )}](\\d\\d)`,
      'g'
    );

    const digitsMap = this.digitsMap = getDigitsMap(locale);
    if (digitsMap.size === 0) {
      this._replaceDigits = (s: string) => s;
    } else {
      const digitsRegex = new RegExp([...digitsMap.keys()].join("|"), "g");
      this._replaceDigits = (s: string) => s.replace(digitsRegex, d => digitsMap.get(d) || d);
    }
  }

  /**
   * Returns a number if the string looks like that number formatted by Grist using this parser's locale and currency
   * (or at least close).
   * Returns null otherwise.
   */
  public parse(value: string): number | null {
    // Remove characters before checking for parentheses on the ends of the string.
    const [value2, isCurrency] = removeSymbol(value, this.currencySymbol);
    const [value3, isPercent] = removeSymbol(value2, this.percentageSymbol);

    // Remove whitespace and special characters, after currency because some currencies contain spaces.
    value = value3.replace(NumberParse.removeCharsRegex, "");

    const parenthesised = value[0] === "(" && value[value.length - 1] === ")";
    if (parenthesised) {
      value = value.substring(1, value.length - 1);
    }

    // Must check for empty string directly because Number('') is 0 :facepalm:
    // Check early so we can return early for performance.
    // Nothing after this should potentially produce an empty string.
    if (value === '') {
      return null;
    }

    // Replace various symbols with the standard versions recognised by JS Number.
    // Note that this also allows the 'standard' symbols ('e', '.', '-', and '0123456789')
    // even if the locale doesn't use them when formatting,
    // although '.' will still be removed if it's a digit separator.

    // Check for exponent separator before replacing digits
    // because it can contain locale-specific digits representing '10' as in 'x10^'.
    value = value.replace(this._exponentSeparatorRegex, "e");
    value = this._replaceDigits(value);

    // Must come after replacing digits because the regex uses \d
    // which doesn't work for locale-specific digits.
    // This simply removes the separators, $1 is a captured group of digits which we keep.
    value = value.replace(this._digitGroupSeparatorRegex, "$1");

    // Must come after the digit separator replacement
    // because the digit separator might be '.'
    value = value.replace(this.decimalSeparator, '.');

    // .replace with a string only replaces once,
    // and a number can contain two minus signs when using scientific notation
    value = value.replace(this.minusSign, "-");
    value = value.replace(this.minusSign, "-");

    // Move '-' from the end to the beginning when appropriate (which is rare)
    if (isCurrency && this.currencyEndsInMinusSign && value.endsWith("-")) {
      value = "-" + value.substring(0, value.length - 1);
    }

    // Number is more strict than parseFloat which allows extra trailing characters.
    let result = Number(value);
    if (isNaN(result)) {
      return null;
    }

    // Parentheses represent a negative number, e.g. (123) -> -123
    // (-123) is treated as an error
    if (parenthesised) {
      if (result <= 0) {
        return null;
      }
      result = -result;
    }

    if (isPercent) {
      result *= 0.01;
    }

    return result;
  }
}

/**
 * Returns a tuple [removed, wasPresent]
 * - `removed` is the given string `value` with `symbol` removed at most once.
 * - `wasPresent` is `true` if `symbol` was present in `value` and was thus removed.
 */
function removeSymbol(value: string, symbol: string): [string, boolean] {
  const removed = value.replace(symbol, "");
  const wasPresent = removed.length < value.length;
  return [removed, wasPresent];
}
