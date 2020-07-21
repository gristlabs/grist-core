/**
 * Here are the most relevant formats we want to support.
 *   -1234.56     Plain
 *   -1,234.56    Number (with separators)
 *   12.34%       Percent
 *   1.23E3       Scientific
 *   $(1,234.56)  Accounting
 *   (1,234.56)   Financial
 *   -$1,234.56   Currency
 *
 * We implement a button-based UI, using one selector button to choose mode:
 *    none  = NumMode undefined (plain number, no thousand separators)
 *    `$`   = NumMode 'currency'
 *    `,`   = NumMode 'decimal' (plain number, with thousand separators)
 *    `%`   = NumMode 'percent'
 *    `Exp` = NumMode 'scientific'
 * A second toggle button is `(-)` for Sign, to use parentheses rather than "-" for negative
 * numbers. It is Ignored and disabled when mode is 'scientific'.
 */

import {clamp} from 'app/common/gutil';

// Options for number formatting.
export type NumMode = 'currency' | 'decimal' | 'percent' | 'scientific';
export type NumSign = 'parens';

// TODO: In the future, locale should be a value associated with the document or the user.
const defaultLocale = 'en-US';

// TODO: The currency to use for currency formatting could be made configurable.
const defaultCurrency = 'USD';

export interface NumberFormatOptions {
  numMode?: NumMode;
  numSign?: NumSign;
  decimals?: number;      // aka minimum fraction digits
  maxDecimals?: number;
}

export function buildNumberFormat(options: NumberFormatOptions): Intl.NumberFormat {
  const nfOptions: Intl.NumberFormatOptions = parseNumMode(options.numMode);

  // numSign is implemented outside of Intl.NumberFormat since the latter's similar 'currencySign'
  // option is not well-supported, and doesn't apply to non-currency formats.

  if (options.decimals !== undefined) {
    // Should be at least 0
    nfOptions.minimumFractionDigits = clamp(Number(options.decimals), 0, 20);
  }

  // maximumFractionDigits must not be less than the minimum, so we need to know the minimum
  // implied by numMode.
  const tmp = new Intl.NumberFormat(defaultLocale, nfOptions).resolvedOptions();

  if (options.maxDecimals !== undefined) {
    // Should be at least 0 and at least minimumFractionDigits.
    nfOptions.maximumFractionDigits = clamp(Number(options.maxDecimals), tmp.minimumFractionDigits || 0, 20);
  } else if (!options.numMode) {
    // For the default format, keep max digits at 10 as we had before.
    nfOptions.maximumFractionDigits = clamp(10, tmp.minimumFractionDigits || 0, 20);
  }

  return new Intl.NumberFormat(defaultLocale, nfOptions);
}

function parseNumMode(numMode?: NumMode): Intl.NumberFormatOptions {
  switch (numMode) {
    case 'currency': return {style: 'currency', currency: defaultCurrency};
    case 'decimal': return {useGrouping: true};
    case 'percent': return {style: 'percent'};
    // TODO 'notation' option (and therefore numMode 'scientific') works on recent Firefox and
    // Chrome, not on Safari or Node 10.
    case 'scientific': return {notation: 'scientific'} as Intl.NumberFormatOptions;
    default: return {useGrouping: false};
  }
}
