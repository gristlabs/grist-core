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
import * as LocaleCurrency from "locale-currency";
import {FormatOptions} from 'app/common/ValueFormatter';
import {DocumentSettings} from 'app/common/DocumentSettings';

// Options for number formatting.
export type NumMode = 'currency' | 'decimal' | 'percent' | 'scientific';
export type NumSign = 'parens';

export interface NumberFormatOptions extends FormatOptions {
  numMode?: NumMode;
  numSign?: NumSign;
  decimals?: number;      // aka minimum fraction digits
  maxDecimals?: number;
  currency?: string;
}

export function getCurrency(options: NumberFormatOptions, docSettings: DocumentSettings): string {
  return options.currency || docSettings.currency || LocaleCurrency.getCurrency(docSettings.locale);
}

export function buildNumberFormat(options: NumberFormatOptions, docSettings: DocumentSettings): Intl.NumberFormat {
  const currency = getCurrency(options, docSettings);
  const nfOptions: Intl.NumberFormatOptions = parseNumMode(options.numMode, currency);

  // numSign is implemented outside of Intl.NumberFormat since the latter's similar 'currencySign'
  // option is not well-supported, and doesn't apply to non-currency formats.

  if (options.decimals !== undefined) {
    // Should be at least 0
    nfOptions.minimumFractionDigits = clamp(Number(options.decimals), 0, 20);
  }

  // maximumFractionDigits must not be less than the minimum, so we need to know the minimum
  // implied by numMode.
  const tmp = new Intl.NumberFormat(docSettings.locale, nfOptions).resolvedOptions();

  if (options.maxDecimals !== undefined) {
    // Should be at least 0 and at least minimumFractionDigits.
    nfOptions.maximumFractionDigits = clamp(Number(options.maxDecimals), tmp.minimumFractionDigits || 0, 20);
  } else if (!options.numMode) {
    // For the default format, keep max digits at 10 as we had before.
    nfOptions.maximumFractionDigits = clamp(10, tmp.minimumFractionDigits || 0, 20);
  }

  return new Intl.NumberFormat(docSettings.locale, nfOptions);
}

export function parseNumMode(numMode?: NumMode, currency?: string): Intl.NumberFormatOptions {
  switch (numMode) {
    case 'currency': return {style: 'currency', currency, currencyDisplay: 'narrowSymbol' };
    case 'decimal': return {useGrouping: true};
    case 'percent': return {style: 'percent'};
    // TODO 'notation' option (and therefore numMode 'scientific') works on recent Firefox and
    // Chrome, not on Safari or Node 10.
    case 'scientific': return {notation: 'scientific'} as Intl.NumberFormatOptions;
    default: return {useGrouping: false};
  }
}
