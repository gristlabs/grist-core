import {getCurrency, locales} from 'app/common/Locales';
import {NumMode, parseNumMode} from 'app/common/NumberFormat';
import NumberParse from 'app/common/NumberParse';
import {assert} from 'chai';
import * as _ from 'lodash';

describe("NumberParse", function() {
  let parser = new NumberParse("en", "USD");

  function check(str: string, expected: number | null) {
    const parsed = parser.parse(str);
    assert.equal(parsed?.result ?? null, expected);
  }

  it("can do basic parsing", function() {
    check("123", 123);
    check("-123", -123);
    check("-123.456", -123.456);
    check("-1.234e56", -1.234e56);
    check("1.234e-56", 1.234e-56);
    check("(1.234e56)", -1.234e56);
    check("($1.23)", -1.23);
    check("($ 1.23)", -1.23);
    check("$ 1.23", 1.23);
    check("$1.23", 1.23);
    check("12.34%", 0.1234);
    check("1,234,567.89", 1234567.89);
    check(".89", .89);
    check(".89000", .89);
    check("0089", 89);

    // The digit separator is ',' but spaces are always removed anyway
    check("1 234 567.89", 1234567.89);

    assert.equal(parser.parse(""), null);
    check(" ", null);
    check("()", null);
    check(" ( ) ", null);
    check(" (,) ", null);
    check(" (.) ", null);
    check(",", null);
    check(",.", null);
    check(".,", null);
    check(",,,", null);
    check("...", null);
    check(".", null);
    check("%", null);
    check("$", null);
    check("(ABC)", null);
    check("ABC", null);
    check("USD", null);

    check("NaN", null);
    check("NAN", null);
    check("nan", null);

    // Currency symbol can only appear once
    check("$$1.23", null);

    // Other currency symbols not allowed
    check("USD 1.23", null);
    check("€ 1.23", null);
    check("£ 1.23", null);
    check("$ 1.23", 1.23);

    // Parentheses represent negative numbers,
    // so the number inside can't also be negative or 0
    check("(0)", null);
    check("(-1.23)", null);
    check("(1.23)", -1.23);
    check("-1.23", -1.23);

    // Only one % allowed
    check("12.34%%", null);
    check("12.34%", 0.1234);
  });

  it("can handle different minus sign positions", function() {
    parser = new NumberParse("fy", "EUR");
    let formatter = Intl.NumberFormat("fy", {style: "currency", currency: "EUR"});

    assert.isTrue(parser.currencyEndsInMinusSign);

    // Note the '-' is at the end
    assert.equal(formatter.format(-1), "€ 1,00-");

    // The parser can handle this, it also allows the '-' in the beginning as usual
    check("€ 1,00-", -1);
    check("€ -1,00", -1);
    check("-€ 1,00", -1);

    // But it's only allowed at the end for currency amounts, to match the formatter
    check("1,00-", null);
    check("-1,00", -1);

    // By contrast, this locale doesn't put '-' at the end so the parser doesn't allow that
    parser = new NumberParse("en", "USD");
    formatter = Intl.NumberFormat("en", {style: "currency", currency: "USD"});

    assert.isFalse(parser.currencyEndsInMinusSign);

    assert.equal(formatter.format(-1), "-$1.00");

    check("-$1.00", -1);
    check("$-1.00", -1);
    check("$1.00-", null);

    check("-1.00", -1);
    check("1.00-", null);
  });

  it("can handle different separators", function() {
    let formatter = Intl.NumberFormat("en", {useGrouping: true});
    assert.equal(formatter.format(123456789.123), "123,456,789.123");

    parser = new NumberParse("en", "USD");

    assert.equal(parser.digitGroupSeparator, ",");
    assert.equal(parser.digitGroupSeparatorCurrency, ",");
    assert.equal(parser.decimalSeparator, ".");

    check("123,456,789.123", 123456789.123);

    // The typical separator is ',' but spaces are always removed anyway
    check("123 456 789.123", 123456789.123);

    // There must be at least two digits after the separator
    check("123,456", 123456);
    check("12,34,56", 123456);
    check("1,2,3,4,5,6", null);
    check("123,,456", null);
    check("1,234", 1234);
    check("123,4", null);

    // This locale uses 'opposite' separators to the above, i.e. ',' and '.' have swapped roles
    formatter = Intl.NumberFormat("de-AT", {useGrouping: true, currency: "EUR", style: "currency"});
    assert.equal(formatter.format(123456789.123), '€ 123.456.789,12');

    // But only for currency amounts! Non-currency amounts use NBSP (non-breaking space) for the digit separator
    formatter = Intl.NumberFormat("de-AT", {useGrouping: true});
    assert.equal(formatter.format(123456789.123), '123 456 789,123');

    parser = new NumberParse("de-AT", "EUR");

    assert.equal(parser.digitGroupSeparator, " ");
    assert.equal(parser.digitGroupSeparatorCurrency, ".");
    assert.equal(parser.decimalSeparator, ",");

    check("€ 123.456.789,123", 123456789.123);
    check("€ 123 456 789,123", 123456789.123);
    // The parser allows the currency separator for non-currency amounts
    check("  123.456.789,123", 123456789.123);
    check("  123 456 789,123", 123456789.123);  // normal space
    check("  123 456 789,123", 123456789.123);  // NBSP

    formatter = Intl.NumberFormat("af-ZA", {useGrouping: true});
    assert.equal(formatter.format(123456789.123), '123 456 789,123');

    parser = new NumberParse("af-ZA", "ZAR");

    assert.equal(parser.digitGroupSeparator, " ");
    assert.equal(parser.digitGroupSeparatorCurrency, " ");
    assert.equal(parser.decimalSeparator, ",");

    // ',' is the official decimal separator of this locale,
    // but in general '.' will also work as long as it's not the digit separator.
    check("123 456 789,123", 123456789.123);
    check("123 456 789.123", 123456789.123);
  });

  it("returns basic info about formatting options for a single string", function() {
    parser = new NumberParse("en", "USD");

    assert.isNull(parser.parse(""));
    assert.isNull(parser.parse("a b"));

    const defaultOptions = {
      isCurrency: false,
      isParenthesised: false,
      hasDigitGroupSeparator: false,
      isScientific: false,
      isPercent: false,
    };
    assert.deepEqual(parser.parse("1"),
      {result: 1, cleaned: "1", options: defaultOptions});
    assert.deepEqual(parser.parse("$1"),
      {result: 1, cleaned: "1", options: {...defaultOptions, isCurrency: true}});
    assert.deepEqual(parser.parse("100%"),
      {result: 1, cleaned: "100", options: {...defaultOptions, isPercent: true}});
    assert.deepEqual(parser.parse("1,000"),
      {result: 1000, cleaned: "1000", options: {...defaultOptions, hasDigitGroupSeparator: true}});
    assert.deepEqual(parser.parse("1E2"),
      {result: 100, cleaned: "1e2", options: {...defaultOptions, isScientific: true}});
    assert.deepEqual(parser.parse("$1,000"),
      {result: 1000, cleaned: "1000", options: {...defaultOptions, isCurrency: true, hasDigitGroupSeparator: true}});
  });

  it("guesses formatting options", function() {
    parser = new NumberParse("en", "USD");

    assert.deepEqual(parser.guessOptions([]), {});
    assert.deepEqual(parser.guessOptions([""]), {});
    assert.deepEqual(parser.guessOptions([null]), {});
    assert.deepEqual(parser.guessOptions(["", null]), {});
    assert.deepEqual(parser.guessOptions(["abc"]), {});
    assert.deepEqual(parser.guessOptions(["1"]), {});
    assert.deepEqual(parser.guessOptions(["1", "", null, "abc"]), {});

    assert.deepEqual(parser.guessOptions(["$1,000"]), {numMode: "currency", decimals: 0});
    assert.deepEqual(parser.guessOptions(["1,000%"]), {numMode: "percent"});
    assert.deepEqual(parser.guessOptions(["1,000"]), {numMode: "decimal"});
    assert.deepEqual(parser.guessOptions(["1E2"]), {numMode: "scientific"});

    // Choose the most common mode when there are several candidates
    assert.deepEqual(parser.guessOptions(["$1", "$2", "3%"]), {numMode: "currency", decimals: 0});
    assert.deepEqual(parser.guessOptions(["$1", "2%", "3%"]), {numMode: "percent"});

    assert.deepEqual(parser.guessOptions(["(2)"]), {numSign: 'parens'});
    assert.deepEqual(parser.guessOptions(["(2)", "3"]), {numSign: 'parens'});
    // If we see a negative number not surrounded by parens, assume that other parens mean something else
    assert.deepEqual(parser.guessOptions(["(2)", "-3"]), {});
    assert.deepEqual(parser.guessOptions(["($2)"]), {numSign: 'parens', numMode: "currency", decimals: 0});

    // Guess 'decimal' (i.e. with thousands separators) even if most numbers don't have separators
    assert.deepEqual(parser.guessOptions(["1", "10", "100", "1,000"]), {numMode: "decimal"});

    // For USD, currencies are formatted with minimum 2 decimal places by default,
    // so if the data doesn't have that many decimals we have to explicitly specify the number of decimals, default 0.
    // The number of digits for other currencies is defaultNumDecimalsCurrency, tested a bit further down.
    assert.deepEqual(parser.guessOptions(["$1"]), {numMode: "currency", decimals: 0});
    assert.deepEqual(parser.guessOptions(["$1.2"]), {numMode: "currency", decimals: 0});
    assert.deepEqual(parser.guessOptions(["$1.23"]), {numMode: "currency"});
    assert.deepEqual(parser.guessOptions(["$1.234"]), {numMode: "currency", maxDecimals: 3});

    // Otherwise decimal places are guessed based on trailing zeroes
    assert.deepEqual(parser.guessOptions(["$1.0"]), {numMode: "currency", decimals: 1});
    assert.deepEqual(parser.guessOptions(["$1.00"]), {numMode: "currency", decimals: 2});
    assert.deepEqual(parser.guessOptions(["$1.000"]), {numMode: "currency", decimals: 3});

    assert.deepEqual(parser.guessOptions(["1E2"]), {numMode: "scientific"});
    assert.deepEqual(parser.guessOptions(["1.3E2"]), {numMode: "scientific"});
    assert.deepEqual(parser.guessOptions(["1.34E2"]), {numMode: "scientific"});
    assert.deepEqual(parser.guessOptions(["1.0E2"]), {numMode: "scientific", decimals: 1});
    assert.deepEqual(parser.guessOptions(["1.30E2"]), {numMode: "scientific", decimals: 2});

    assert.equal(parser.defaultNumDecimalsCurrency, 2);
    parser = new NumberParse("en", "TND");
    assert.equal(parser.defaultNumDecimalsCurrency, 3);
    parser = new NumberParse("en", "ZMK");
    assert.equal(parser.defaultNumDecimalsCurrency, 0);
  });

  // Nice mixture of numbers of different sizes and containing all digits
  const numbers = [
    ..._.range(1, 12),
    ..._.range(3, 20).map(n => Math.pow(3, n)),
    ..._.range(10).map(n => Math.pow(10, -n) * 1234560798),
  ];
  numbers.push(...numbers.map(n => -n));
  numbers.push(...numbers.map(n => 1 / n));
  numbers.push(0);  // added at the end because of the division just before

  // Formatter to compare numbers that only differ because of floating point precision errors
  const basicFormatter = Intl.NumberFormat("en", {
    maximumSignificantDigits: 15,
    useGrouping: false,
  });

  // All values supported by parseNumMode
  const numModes: Array<NumMode | undefined> = ['currency', 'decimal', 'percent', 'scientific', undefined];

  // Generate a test suite for every supported locale
  for (const locale of locales) {
    describe(`with ${locale.code} locale (${locale.name})`, function() {
      const currency = getCurrency(locale.code);

      beforeEach(() => {
        parser = new NumberParse(locale.code, currency);
      });

      it("has sensible parser attributes", function() {
        // These don't strictly need to have length 1, but it's nice to know
        assert.lengthOf(parser.percentageSymbol, 1);
        assert.lengthOf(parser.minusSign, 1);
        assert.lengthOf(parser.decimalSeparator, 1);

        // These *do* need to be a single character since the regex uses `[]`.
        assert.lengthOf(parser.digitGroupSeparator, 1);
        // This is the only symbol that's allowed to be empty
        assert.include([0, 1], parser.digitGroupSeparatorCurrency.length);

        assert.isNotEmpty(parser.exponentSeparator);
        assert.isNotEmpty(parser.currencySymbol);

        const symbols = [
          parser.percentageSymbol,
          parser.minusSign,
          parser.decimalSeparator,
          parser.digitGroupSeparator,
          parser.exponentSeparator,
          parser.currencySymbol,
          ...parser.digitsMap.keys(),
        ];

        // All the symbols must be distinct
        assert.equal(symbols.length, new Set(symbols).size);

        // The symbols mustn't contain characters that the parser removes (e.g. spaces)
        // or they won't be replaced correctly.
        // The digit group separators are OK because they're removed anyway, and often the separator is a space.
        // Currency is OK because it gets removed before these characters.
        for (const symbol of symbols) {
          if (![
            parser.digitGroupSeparator,
            parser.digitGroupSeparatorCurrency,
            parser.currencySymbol,
          ].includes(symbol)) {
            assert.equal(symbol, symbol.replace(NumberParse.removeCharsRegex, "REMOVED"));
          }
        }

        // Decimal and digit separators have to be different.
        // We checked digitGroupSeparator already with the Set above,
        // but not digitGroupSeparatorCurrency because it can equal digitGroupSeparator.
        assert.notEqual(parser.decimalSeparator, parser.digitGroupSeparator);
        assert.notEqual(parser.decimalSeparator, parser.digitGroupSeparatorCurrency);

        for (const key of parser.digitsMap.keys()) {
          assert.lengthOf(key, 1);
          assert.lengthOf(parser.digitsMap.get(key)!, 1);
        }
      });

      it("can parse formatted numbers", function() {
        for (const numMode of numModes) {
          const formatter = Intl.NumberFormat(locale.code, {
            ...parseNumMode(numMode, currency),
            maximumFractionDigits: 15,
            maximumSignificantDigits: 15,
          });
          for (const num of numbers) {
            const fnum = formatter.format(num);
            const formattedNumbers = [fnum];

            if (num > 0 && fnum[0] === "0") {
              // E.g. test that '.5' is parsed as '0.5'
              formattedNumbers.push(fnum.substring(1));
            }

            if (num < 0) {
              formattedNumbers.push(`(${formatter.format(-num)})`);
            }

            for (const formatted of formattedNumbers) {
              const parsed = parser.parse(formatted)?.result;

              // Fast check, particularly to avoid formatting the numbers
              // Makes the tests about 1.5s/30% faster.
              if (parsed === num) {
                continue;
              }

              try {
                assert.exists(parsed);
                assert.equal(
                  basicFormatter.format(parsed!),
                  basicFormatter.format(num),
                );
              } catch (e) {
                // Handy information for understanding failures
                // tslint:disable-next-line:no-console
                console.log({
                  num, formatted, parsed, numMode, parser,
                  parts: formatter.formatToParts(num),
                  formattedChars: [...formatted].map(char => ({
                    char,
                    // To see invisible characters, e.g. RTL/LTR marks
                    codePoint: char.codePointAt(0),
                    codePointHex: char.codePointAt(0)!.toString(16),
                  })),
                  formatterOptions: formatter.resolvedOptions(),
                });
                throw e;
              }
            }
          }
        }
      });

    });
  }
});
