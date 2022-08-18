import {arrayRepeat} from 'app/common/gutil';
import {guessColInfo, guessColInfoForImports, GuessResult} from 'app/common/ValueGuesser';
import {assert} from 'chai';

const defaultDocSettings = {
  locale: 'en-US'
};

function check(values: Array<string | null>, expectedResult: GuessResult) {
  const result = guessColInfo(values, defaultDocSettings, "America/New_York");
  assert.deepEqual(result, expectedResult);
}


describe("ValueGuesser", function() {
  it("should guess booleans and numbers correctly", function() {
    check(
      ["true", "false"],
      {
        values: [true, false],
        colInfo: {type: 'Bool'},
      },
    );

    // 1 and 0 in a boolean column would be converted to true and false,
    // but they're guessed as numbers, not booleans
    check(
      ["1", "0"],
      {
        values: [1, 0],
        colInfo: {type: 'Numeric'},
      },
    );

    // Even here, guessing booleans would be sensible, but the original values would be lost
    // if the user didn't like the guess and converted boolean column was converted back to Text.
    // Also note that when we fallback to Text without any parsing, guessColInfo doesn't return any values,
    // as sending them back to the data engine would be wasteful.
    check(
      ["true", "false", "1", "0"],
      {colInfo: {type: 'Text'}},
    );

    // Now that 90% if the values are straightforward booleans, it guesses Bool
    // "0" is still not parsed by guessColInfo as it's trying to be lossless.
    // However, it will actually be converted in Python by Bool.do_convert,
    // so this is a small way information can still be lost.
    check(
      [...arrayRepeat(9, "true"), "0"],
      {
        values: [...arrayRepeat(9, true), "0"],
        colInfo: {type: 'Bool'},
      },
    );

    // If there are blank values ("" or null) then leave them as text,
    // because the data engine would convert them to false which would lose info.
    check(
      ["true", ""],
      {colInfo: {type: 'Text'}},
    );
    check(
      ["false", null],
      {colInfo: {type: 'Text'}},
    );
  });

  it("should handle formatted numbers", function() {
    check(
      ["0.0", "1.0"],
      {
        values: [0, 1],
        colInfo: {type: "Numeric", widgetOptions: {decimals: 1}},
      }
    );

    check(
      ["$1.00"],
      {
        values: [1],
        colInfo: {type: "Numeric", widgetOptions: {numMode: "currency", decimals: 2}},
      }
    );

    check(
      ["$1"],
      {
        values: [1],
        colInfo: {type: "Numeric", widgetOptions: {numMode: "currency", decimals: 0}},
      }
    );

    // Inconsistent number of decimal places
    check(
      ["$1", "$1.00"],
      {colInfo: {type: 'Text'}},
    );

    // Inconsistent use of currency
    check(
      ["1.00", "$1.00"],
      {colInfo: {type: 'Text'}},
    );

    check(
      ["500", "6000"],
      {
        values: [500, 6000],
        colInfo: {type: "Numeric"},
      }
    );
    check(
      ["500", "6,000"],
      {
        values: [500, 6000],
        colInfo: {type: "Numeric", widgetOptions: {numMode: "decimal"}},
      }
    );
    // Inconsistent use of thousands separators
    check(
      ["5000", "6,000"],
      {colInfo: {type: 'Text'}},
    );
  });

  it("should guess dates and datetimes correctly", function() {
    check(
      ["1970-01-21", null, ""],
      {
        // The number represents 1970-01-21 parsed to a timestamp.
        // null and "" are converted to null.
        values: [20 * 24 * 60 * 60, null, null],
        colInfo: {
          type: 'Date',
          widgetOptions: {
            dateFormat: "YYYY-MM-DD",
            timeFormat: "",
            isCustomDateFormat: false,
            isCustomTimeFormat: true,
          },
        },
      },
    );

    check(
      ["1970-01-01 05:00:00"],
      {
        // 05:00 in the given timezone is 10:00 in UTC
        values: [10 * 60 * 60],
        colInfo: {
          // "America/New_York" is the timezone given by `check`
          type: 'DateTime:America/New_York',
          widgetOptions: {
            dateFormat: "YYYY-MM-DD",
            timeFormat: "HH:mm:ss",
            isCustomDateFormat: false,
            isCustomTimeFormat: false,
          },
        },
      },
    );

    // A mixture of Date and DateTime cannot be guessed as either, fallback to Text
    check(
      [
        "1970-01-01",
        "1970-01-01",
        "1970-01-01",
        "1970-01-01 05:00:00",
      ],
      {colInfo: {type: 'Text'}},
    );
  });

  it("should require 90% of values to be parsed", function() {
    // 90% of the strings can be parsed to numbers, so guess Numeric.
    check(
      [...arrayRepeat(9, "12"), "foo"],
      {
        values: [...arrayRepeat(9, 12), "foo"],
        colInfo: {type: 'Numeric'},
      },
    );

    // Less than 90% are numbers, so fallback to Text
    check(
      [...arrayRepeat(8, "12"), "foo"],
      {colInfo: {type: 'Text'}},
    );

    // Same as the previous two checks but with a bunch of blanks
    check(
      [...arrayRepeat(9, "12"), "foo", ...arrayRepeat(90, "")],
      {
        values: [...arrayRepeat(9, 12), "foo", ...arrayRepeat(90, null)],
        colInfo: {type: 'Numeric'},
      },
    );
    check(
      [...arrayRepeat(8, "12"), "foo", ...arrayRepeat(90, "")],
      {colInfo: {type: 'Text'}},
    );

    // Just a bunch of blanks and text, no numbers or anything
    check(
      [...arrayRepeat(100, null), "foo", "bar"],
      {colInfo: {type: 'Text'}},
    );
  });

  describe("guessColInfoForImports", function() {
    // Prepare dummy docData; just the minimum to satisfy the code that uses it.
    const docData: any = {
      docSettings: () => defaultDocSettings,
      docInfo: () => ({timezone: 'America/New_York'}),
    };
    it("should guess empty column when all cells are empty", function() {
      assert.deepEqual(guessColInfoForImports([null, "", "", null], docData), {
        values: [null, "", "", null],
        colMetadata: {type: 'Any', isFormula: true, formula: ''}
      });
    });
    it("should do proper numeric format guessing for a mix of number/string types", function() {
      assert.deepEqual(guessColInfoForImports([-5.5, "1,234.6", null, 0], docData), {
        values: [-5.5, 1234.6, null, 0],
        colMetadata: {type: 'Numeric', widgetOptions: '{"numMode":"decimal"}'}
      });
    });
    it("should not guess empty column when values are not actually empty", function() {
      assert.deepEqual(guessColInfoForImports([null, 0, "", false], docData), {
        values: [null, 0, "", false],
        colMetadata: {type: 'Text'}
      });
    });
    it("should do no guessing for object values", function() {
      assert.deepEqual(guessColInfoForImports(["test", ['L' as any, 1]], docData), {
        values: ["test", ['L' as any, 1]]
      });
    });
  });
});
