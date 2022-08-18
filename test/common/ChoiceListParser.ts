import {DocumentSettings} from 'app/common/DocumentSettings';
import {createParserRaw} from 'app/common/ValueParser';
import {assert} from 'chai';


const parser = createParserRaw("ChoiceList", {}, {} as DocumentSettings);

function testParse(input: string, expected?: string[]) {
  const result = parser.cleanParse(input);
  if (expected) {
    assert.deepEqual(result, ["L", ...expected], input);
  } else {
    assert.isNull(result, input);
  }
}

describe('ChoiceListParser', function() {

  it('should handle empty values', function() {
    testParse("");
    testParse(" ");
    testParse(" , ");
    testParse(",,,");
    testParse(" , , , ");
    testParse("[]");
    testParse('[""]');
    testParse('["", null, null, ""]');
    testParse('""');
  });

  it('should parse JSON', function() {
    testParse("[1]", ["1"]);
    testParse('["a"]', ["a"]);
    testParse('["a", "aa"]', ["a", "aa"]);
    testParse('   ["a", "aa"]   ', ["a", "aa"]);
    testParse("[0, 1, 2]", ["0", "1", "2"]);
    testParse('[0, 1, 2, "a", "b", "c"]', ["0", "1", "2", "a", "b", "c"]);

    // Remove nulls and empty strings
    testParse('["a", null, "aa", "", null]', ["a", "aa"]);

    // Format nested JSON arrays and objects with formatDecoded
    testParse('[0, 1, 2, "a", "b", "c", ["d", "x", "y, z"], [["e"], "f"], {"g": ["h"]}]',
      ["0", "1", "2", "a", "b", "c", 'd, x, "y, z"', '[["e"], "f"]', '{"g": ["h"]}']);

    // These are valid JSON but they're not arrays so _parseJSON doesn't touch them
    testParse('null', ["null"]);
    testParse('123', ["123"]);
    testParse('"123"', ["123"]);
    testParse('"abc"', ["abc"]);
  });

  it('should parse CSVs', function() {
    testParse('"a", "aa"', ["a", "aa"]);
    testParse('"a", aa', ["a", "aa"]);
    testParse('  "  a  " , aa', ["a", "aa"]);
    testParse('a, aa', ["a", "aa"]);
    testParse('a,aa', ["a", "aa"]);
    testParse('a,aa b c', ["a", "aa b c"]);
    testParse('   "a", "aa"  ', ["a", "aa"]);
    testParse("0, 1, 2", ["0", "1", "2"]);
    testParse('0, 1, 2, "a", "b", "c"', ["0", "1", "2", "a", "b", "c"]);

    testParse('"a", null, "aa", "", null', ["a", "null", "aa", "null"]);
  });

  it('should split on newlines', function() {
    testParse('a,b \r\n c,d \n e \n\n\n f \n \n\n \n g', ["a", "b", "c", "d", "e", "f", "g"]);
  });
});
