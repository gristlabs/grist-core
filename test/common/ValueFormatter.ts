import {DocumentSettings} from 'app/common/DocumentSettings';
import {NumberFormatOptions} from 'app/common/NumberFormat';
import {parseDateTime} from 'app/common/parseDate';

import {createFormatter, DateTimeFormatOptions} from "app/common/ValueFormatter";
import {assert} from 'chai';

const defaultDocSettings = {
  locale: 'en-US'
};

const dateNumber = parseDateTime("2020-10-31 12:34:56", {});

describe("ValueFormatter", function() {
  describe("DateFormatter", function() {

    function check(expected: string, dateFormat?: string) {
      for (const value of [dateNumber, ["d", dateNumber], ["D", dateNumber, "UTC"]]) {
        const actual = createFormatter("Date", {dateFormat}, defaultDocSettings).formatAny(value);
        assert.equal(actual, expected, String(value));
      }
    }

    it("should format dates", function() {
      check("31/10/2020", "DD/MM/YYYY");
      check("10/31/2020", "MM/DD/YYYY");
      check("2020-10-31");  // ISO by default
    });
  });

  describe("DateTimeFormatter", function() {
    function check(expected: string, options: DateTimeFormatOptions, timezone: string = "UTC") {
      for (const value of [dateNumber, ["d", dateNumber], ["D", dateNumber, timezone]]) {
        const actual = createFormatter(`DateTime:${timezone}`, options, defaultDocSettings).formatAny(value);
        assert.equal(actual, expected, String(value));
      }
    }

    it("should format datetimes", function() {
      check("31/10/2020 12:34:56", {dateFormat: "DD/MM/YYYY", timeFormat: "HH:mm:ss"});
      check("10/31/2020 12:34", {dateFormat: "MM/DD/YYYY", timeFormat: "HH:mm"});
      check("2020-10-31 12:34pm", {});  // default formats

      check("31/10/2020 08:34:56", {dateFormat: "DD/MM/YYYY", timeFormat: "HH:mm:ss"}, 'America/New_York');
      check("10/31/2020 08:34", {dateFormat: "MM/DD/YYYY", timeFormat: "HH:mm"}, 'America/New_York');
      check("2020-10-31 8:34am", {}, 'America/New_York');  // default formats
    });
  });

  describe("NumericFormatter", function() {
    function fmt(options: NumberFormatOptions, value: number, docSettings: DocumentSettings) {
      return createFormatter("Numeric", options, docSettings).formatAny(value);
    }

    function checkDefault(options: NumberFormatOptions, value: number, expected: string) {
      assert.equal(fmt(options, value, defaultDocSettings), expected);
    }

    it("should support plain format", function() {
      checkDefault({}, 0, '0');
      checkDefault({}, NaN, 'NaN');
      checkDefault({}, Infinity, '∞');
      checkDefault({}, -Infinity, '-∞');
      checkDefault({}, 0.67, '0.67');
      checkDefault({}, -1234.56, '-1234.56');
      checkDefault({}, -121e+25, '-1210000000000000000000000000');
      checkDefault({}, 1.015e-8, '0.0000000102');   // maxDecimals defaults to 10 here.
    });

    it('should support min/max decimals', function() {
      checkDefault({decimals: 2, maxDecimals: 4}, 12, '12.00');
      checkDefault({decimals: 2, maxDecimals: 4}, -1.00015, '-1.0002');
      checkDefault({decimals: 2, maxDecimals: 6}, -1.00015, '-1.00015');
      checkDefault({decimals: 6, maxDecimals: 6}, -1.00015, '-1.000150');
      checkDefault({decimals: 6, maxDecimals: 0}, -1.00015, '-1.000150');
      checkDefault({decimals: 0, maxDecimals: 2}, 12.0001, '12');
      checkDefault({decimals: 0, maxDecimals: 2}, 12.001, '12');
      checkDefault({decimals: 0, maxDecimals: 2}, 12.005, '12.01');
      checkDefault({maxDecimals: 8}, 1.015e-8, '0.00000001');
      checkDefault({maxDecimals: 7}, 1.015e-8, '0');

      // Out-of-range values get clamped.
      checkDefault({decimals:-2, maxDecimals:3}, -1.2345, "-1.235");
      checkDefault({decimals:-2, maxDecimals:-3}, -1.2345, "-1");
    });

    it('should support thousand separators', function() {
      checkDefault({numMode: 'decimal', decimals: 4}, 1000000, '1,000,000.0000');
      checkDefault({numMode: 'decimal'}, -1234.56, '-1,234.56');
      checkDefault({numMode: 'decimal'}, -121e+25, '-1,210,000,000,000,000,000,000,000,000');
      checkDefault({numMode: 'decimal'}, 0.1234567, '0.123');    // maxDecimals defaults to 3 here
      checkDefault({numMode: 'decimal'}, 1.015e-8, '0');
      checkDefault({numMode: 'decimal', maxDecimals: 10}, 1.015e-8, '0.0000000102');
    });

    it('should support currency mode', function() {
      // Test currency formatting with default doc settings (locale: 'en-US').
      checkDefault({numMode: 'currency'}, 1000000, '$1,000,000.00');
      checkDefault({numMode: 'currency', decimals: 4}, 1000000, '$1,000,000.0000');
      checkDefault({numMode: 'currency'}, -1234.565, '-$1,234.57');
      checkDefault({numMode: 'currency'}, -121e+25, '-$1,210,000,000,000,000,000,000,000,000.00');
      checkDefault({numMode: 'currency'}, 0.1234567, '$0.12');    // maxDecimals defaults to 2 here
      checkDefault({numMode: 'currency', maxDecimals: 0}, 12.34567, '$12.35');
      checkDefault({numMode: 'currency', decimals: 0, maxDecimals: 0}, 12.34567, '$12');
      checkDefault({numMode: 'currency'}, 1.015e-8, '$0.00');
      checkDefault({numMode: 'currency', maxDecimals: 10}, 1.015e-8, '$0.0000000102');
      checkDefault({numMode: 'currency'}, -1.015e-8, '-$0.00');

      // Test currency formatting with custom locales.
      assert.equal(fmt({numMode: 'currency'}, 1000000, {locale: 'es-ES'}), '1.000.000,00 €');
      assert.equal(fmt({numMode: 'currency', decimals: 4}, 1000000, {locale: 'en-NZ'}), '$1,000,000.0000');
      assert.equal(fmt({numMode: 'currency'}, -1234.565, {locale: 'de-CH'}), 'CHF-1’234.57');
      assert.equal(fmt({numMode: 'currency'}, -121e+25, {locale: 'es-AR'}),
        '-$ 1.210.000.000.000.000.000.000.000.000,00');
      assert.equal(fmt({numMode: 'currency'}, 0.1234567, {locale: 'fr-BE'}), '0,12 €');
      assert.equal(fmt({numMode: 'currency', maxDecimals: 0}, 12.34567, {locale: 'en-GB'}), '£12.35');
      assert.equal(fmt({numMode: 'currency', decimals: 0, maxDecimals: 0}, 12.34567, {locale: 'en-IE'}), '€12');
      assert.equal(fmt({numMode: 'currency'}, 1.015e-8, {locale: 'af-ZA'}), 'R 0,00');
      assert.equal(fmt({numMode: 'currency', maxDecimals: 10}, 1.015e-8, {locale: 'en-CA'}), '$0.0000000102');
      assert.equal(fmt({numMode: 'currency'}, -1.015e-8, {locale: 'nl-BE'}), '€ -0,00');

      // Test currency formatting with custom currency AND locales (e.g. column-specific currency setting).
      assert.equal(fmt({numMode: 'currency'}, 1000000, {locale: 'es-ES', currency: 'USD'}), '1.000.000,00 $');
      assert.equal(
        fmt({numMode: 'currency', decimals: 4}, 1000000, {locale: 'en-NZ', currency: 'JPY'}),
        '¥1,000,000.0000');
      assert.equal(fmt({numMode: 'currency'}, -1234.565, {locale: 'de-CH', currency: 'JMD'}), '$-1’234.57');
      assert.equal(
        fmt({numMode: 'currency'}, -121e+25, {locale: 'es-AR', currency: 'GBP'}),
        '-£ 1.210.000.000.000.000.000.000.000.000,00');
      assert.equal(fmt({numMode: 'currency'}, 0.1234567, {locale: 'fr-BE', currency: 'GBP'}), '0,12 £');
      assert.equal(fmt({numMode: 'currency', maxDecimals: 0}, 12.34567, {locale: 'en-GB', currency: 'USD'}), '$12.35');
      assert.equal(
        fmt({numMode: 'currency', decimals: 0, maxDecimals: 0}, 12.34567, {locale: 'en-IE', currency: 'SGD'}),
        '$12');
      assert.equal(fmt({numMode: 'currency'}, 1.015e-8, {locale: 'af-ZA', currency: 'HKD'}), '$0,00');
      assert.equal(
        fmt({numMode: 'currency', maxDecimals: 10}, 1.015e-8, {locale: 'en-CA', currency: 'RUB'}),
        '₽0.0000000102');
      assert.equal(fmt({numMode: 'currency'}, -1.015e-8, {locale: 'nl-BE', currency: 'USD'}), '$ -0,00');
    });

    it('should support percentages', function() {
      checkDefault({numMode: 'percent'}, 0.5, '50%');
      checkDefault({numMode: 'percent'}, -0.15, '-15%');
      checkDefault({numMode: 'percent'}, 0.105, '11%');
      checkDefault({numMode: 'percent', maxDecimals: 5}, 0.105, '10.5%');
      checkDefault({numMode: 'percent', decimals: 5}, 0.105, '10.50000%');
      checkDefault({numMode: 'percent', maxDecimals: 2}, 1.2345, '123.45%');
      checkDefault({numMode: 'percent'}, -1234.567, '-123,457%');  // maxDecimals defaults to 0 here
      checkDefault({numMode: 'percent'}, 1.015e-8, '0%');
      checkDefault({numMode: 'percent', maxDecimals: 10}, 1.015e-8, '0.000001015%');
    });

    it('should support parentheses for negative numbers', function() {
      checkDefault({numSign: 'parens', numMode: 'decimal'}, -1234.56, '(1,234.56)');
      checkDefault({numSign: 'parens', numMode: 'decimal'}, +1234.56, ' 1,234.56 ');
      checkDefault({numSign: 'parens', numMode: 'decimal'}, -121e+25, '(1,210,000,000,000,000,000,000,000,000)');
      checkDefault({numSign: 'parens', numMode: 'decimal'}, 0.1234567, ' 0.123 ');
      checkDefault({numSign: 'parens', numMode: 'decimal'}, 1.015e-8, ' 0 ');
      checkDefault({numSign: 'parens', numMode: 'currency'}, -1234.565, '($1,234.57)');
      checkDefault({numSign: 'parens', numMode: 'currency'}, -121e+20, '($12,100,000,000,000,000,000,000.00)');
      checkDefault({numSign: 'parens', numMode: 'currency'}, 121e+20, ' $12,100,000,000,000,000,000,000.00 ');
      checkDefault({numSign: 'parens', numMode: 'currency'}, 1.015e-8, ' $0.00 ');
      checkDefault({numSign: 'parens', numMode: 'currency'}, -1.015e-8, '($0.00)');
      checkDefault({numSign: 'parens'}, -1234.56, '(1234.56)');
      checkDefault({numSign: 'parens'}, +1234.56, ' 1234.56 ');
      checkDefault({numSign: 'parens', numMode: 'percent'}, -0.1234, '(12%)');
      checkDefault({numSign: 'parens', numMode: 'percent'}, +0.1234, ' 12% ');
    });

    it('should support scientific mode', function() {
      checkDefault({numMode: 'scientific'}, 0.5, '5E-1');
      checkDefault({numMode: 'scientific'}, -0.15, '-1.5E-1');
      checkDefault({numMode: 'scientific'}, -1234.56, '-1.235E3');
      checkDefault({numMode: 'scientific'}, +1234.56, '1.235E3');
      checkDefault({numMode: 'scientific'}, 1.015e-8, '1.015E-8');
      checkDefault({numMode: 'scientific', maxDecimals: 10}, 1.015e-8, '1.015E-8');
      checkDefault({numMode: 'scientific', decimals: 10}, 1.015e-8, '1.0150000000E-8');
      checkDefault({numMode: 'scientific', maxDecimals: 2}, 1.015e-8, '1.02E-8');
      checkDefault({numMode: 'scientific', maxDecimals: 1}, 1.015e-8, '1E-8');
      checkDefault({numMode: 'scientific'}, -121e+25, '-1.21E27');
    });
  });
});
