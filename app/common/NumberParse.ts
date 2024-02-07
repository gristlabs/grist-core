/**
 * Counterpart of NumberFormat.ts.
 * Generic functionality for parsing numbers formatted by Intl.NumberFormat,
 * not tied to documents or anything.
 */

import {DocumentSettings} from 'app/common/DocumentSettings';
import {getDistinctValues} from 'app/common/gutil';
import {getCurrency, NumberFormatOptions, NumMode, parseNumMode} from 'app/common/NumberFormat';
import {buildNumberFormat} from 'app/common/NumberFormat';
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

interface ParsedOptions {
  isPercent: boolean;
  isCurrency: boolean;
  isParenthesised: boolean;
  hasDigitGroupSeparator: boolean;
  isScientific: boolean;
}

export default class NumberParse {
  // Regex for whitespace and some control characters we need to remove
  // 200e = Left-to-right mark
  // 200f = Right-to-left mark
  // 061c = Arabic letter mark
  public static readonly removeCharsRegex = /[\s\u200e\u200f\u061c]/g;

  public static fromSettings(docSettings: DocumentSettings, options: NumberFormatOptions = {}) {
    return new NumberParse(docSettings.locale, getCurrency(options, docSettings));
  }

  // Many attributes are public for easy testing.
  public readonly currencySymbol: string;
  public readonly percentageSymbol: string;
  public readonly digitGroupSeparator: string;
  public readonly digitGroupSeparatorCurrency: string;
  public readonly exponentSeparator: string;
  public readonly decimalSeparator: string;
  public readonly minusSign: string;
  public readonly defaultNumDecimalsCurrency: number;

  public readonly digitsMap: Map<string, string>;

  public readonly currencyEndsInMinusSign: boolean;

  private readonly _exponentSeparatorRegex: RegExp;
  private readonly _digitGroupSeparatorRegex: RegExp;

  // Function which replaces keys of digitsMap (i.e. locale-specific digits)
  // with corresponding digits from 0123456789.
  private readonly _replaceDigits: (s: string) => string;

  constructor(public readonly locale: string, public readonly currency: string) {
    const parts = new Map<NumMode, Intl.NumberFormatPart[]>();
    for (const numMode of NumMode.values) {
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

    // Default number of fractional digits for currency,
    // e.g. this is 2 for USD because 1 is formatted as $1.00
    this.defaultNumDecimalsCurrency = getPart("fraction", "currency")?.length || 0;

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
   * If the string looks like a number formatted by Grist using this parser's locale and currency (or at least close)
   * then returns an object where:
   *   - `result` is that number, the only thing most callers need
   *   - `cleaned` is a string derived from `value` which can be parsed directly by Number, although `result`
   *      is still processed a bit further than that, e.g. dividing by 100 for percentages.
   *   - `options` describes how the number was apparently formatted.
   *
   * Returns null otherwise.
   */
  public parse(value: string): { result: number, cleaned: string, options: ParsedOptions } | null {
    // Remove characters before checking for parentheses on the ends of the string.
    const [value2, isCurrency] = removeSymbol(value, this.currencySymbol);
    const [value3, isPercent] = removeSymbol(value2, this.percentageSymbol);

    // Remove whitespace and special characters, after currency because some currencies contain spaces.
    value = value3.replace(NumberParse.removeCharsRegex, "");

    const isParenthesised = value[0] === "(" && value[value.length - 1] === ")";
    if (isParenthesised) {
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
    const withExponent = value;
    value = value.replace(this._exponentSeparatorRegex, "e");
    const isScientific = withExponent !== value;

    value = this._replaceDigits(value);

    // Must come after replacing digits because the regex uses \d
    // which doesn't work for locale-specific digits.
    // This simply removes the separators, $1 is a captured group of digits which we keep.
    const withSeparators = value;
    value = value.replace(this._digitGroupSeparatorRegex, "$1");
    const hasDigitGroupSeparator = withSeparators !== value;

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
    if (isParenthesised) {
      if (result <= 0) {
        return null;
      }
      result = -result;
    }

    if (isPercent) {
      result *= 0.01;
    }

    return {
      result,
      cleaned: value,
      options: {isCurrency, isPercent, isParenthesised, hasDigitGroupSeparator, isScientific}
    };
  }

  public guessOptions(values: Array<string | null>): NumberFormatOptions {
    // null: undecided
    // true: negative numbers should be parenthesised
    // false: they should not
    let parens: boolean | null = null;

    // If any of the numbers have thousands separators, that's enough to guess that option
    let anyHasDigitGroupSeparator = false;

    // Minimum number of decimal places, guessed by looking for trailing 0s after the decimal point
    let decimals = 0;
    const decimalsRegex = /\.\d+/;
    // Maximum number of decimal places. We never actually guess a value for this option,
    // but for currencies we need to check if there are fewer decimal places than the default.
    let maxDecimals = 0;

    // Keep track of the number of modes seen to pick the most common
    const modes = {} as Record<NumMode, number>;
    for (const mode of NumMode.values) {
      modes[mode] = 0;
    }

    for (const value of getDistinctValues(values)) {
      if (!value) {
        continue;
      }
      const parsed = this.parse(value);
      if (!parsed) {
        continue;
      }
      const {
        result,
        cleaned,
        options: {isCurrency, isPercent, isParenthesised, hasDigitGroupSeparator, isScientific}
      } = parsed;

      if (result < 0 && !isParenthesised) {
        // If we see a negative number not surrounded by parens, assume that any other parens mean something else
        parens = false;
      } else if (parens === null && isParenthesised) {
        // If we're still unsure about parens (i.e. the above case hasn't been encountered)
        // then one parenthesised number is enough to guess that the parens option should be used.
        parens = true;
      }

      // If any of the numbers have thousands separators, that's enough to guess that option
      anyHasDigitGroupSeparator = anyHasDigitGroupSeparator || hasDigitGroupSeparator;

      let mode: NumMode = "decimal";
      if (isCurrency) {
        mode = "currency";
      } else if (isPercent) {
        mode = "percent";
      } else if (isScientific) {
        mode = "scientific";
      }
      modes[mode] += 1;

      const decimalsMatch = decimalsRegex.exec(cleaned);
      if (decimalsMatch) {
        // Number of digits after the '.' (which is part of the match, hence the -1)
        const numDecimals = decimalsMatch[0].length - 1;
        maxDecimals = Math.max(maxDecimals, numDecimals);
        if (decimalsMatch[0].endsWith("0")) {
          decimals = Math.max(decimals, numDecimals);
        }
      }
    }

    const maxCount = Math.max(...Object.values(modes));
    if (maxCount === 0) {
      // No numbers parsed at all, so don't guess any options
      return {};
    }

    const result: NumberFormatOptions = {};

    // Find the most common mode.
    const maxMode: NumMode = NumMode.values.find((k) => modes[k] === maxCount)!;

    // 'decimal' is the default mode above when counting,
    // but only guess it as an actual option if digit separators were used at least once.
    if (maxMode !== "decimal" || anyHasDigitGroupSeparator) {
      result.numMode = maxMode;
    }

    if (parens) {
      result.numSign = "parens";
    }

    // Specify minimum number of decimal places if we saw any trailing 0s after '.'
    // Otherwise explicitly set it to 0 if needed to suppress the default for that currency.
    if (decimals > 0 || maxMode === "currency" && maxDecimals < this.defaultNumDecimalsCurrency) {
      result.decimals = decimals;
    }

    // We should only set maxDecimals if the default maxDecimals is too low.
    const tmpNF = buildNumberFormat(result, {locale: this.locale, currency: this.currency}).resolvedOptions();
    if (maxDecimals > tmpNF.maximumFractionDigits) {
      result.maxDecimals = maxDecimals;
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
