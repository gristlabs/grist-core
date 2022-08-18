import * as csvFormat from 'app/common/csvFormat';
import {assert} from 'chai';

describe('csvFormat', function() {
  it('should encode/decode csv values correctly', function() {
    function verify(plain: string, encoded: string) {
      assert.equal(csvFormat.csvEncodeCell(plain), encoded);
      assert.equal(csvFormat.csvDecodeCell(encoded), plain);
    }
    verify("hello world", "hello world");
    verify(`Commas,, galore, `, `"Commas,, galore, "`);
    verify(`"Quote" 'me,', ""please!""`, `"""Quote"" 'me,', """"please!"""""`);
    verify(` sing"le `, `" sing""le "`);
    verify(``, ``);
    verify(`""`, `""""""`);
    verify(`\t\n'\`\\`, `"\t\n'\`\\"`);
    // The exact interpretation of invalid encodings isn't too important, but should include most
    // of the value and not throw exceptions.
    assert.equal(csvFormat.csvDecodeCell(`invalid"e\ncoding `), `invalid"e\ncoding`);
    assert.equal(csvFormat.csvDecodeCell(`"invalid"e`), `invalid"e`);
  });

  it('should encode/decode csv rows correctly', function() {
    function verify(plain: string[], encoded: string, prettier: boolean) {
      assert.equal(csvFormat.csvEncodeRow(plain, {prettier}), encoded);
      assert.deepEqual(csvFormat.csvDecodeRow(encoded), plain);
    }
    verify(["hello", "world"], "hello,world", false);
    verify(["hello", "world"], "hello, world", true);
    verify(["hello ", " world"], `"hello "," world"`, false);
    verify(["hello ", " world"], `"hello ", " world"`, true);
    verify([' '], `" "`, false);
    verify(['', ''], `,`, false);
    verify(['', ' ', ''], `, " ", `, true);
    verify([
      "Commas,, galore, ",
      `"Quote" 'me,', ""please!""`,
      ` sing"le `,
      ' ',
      '',
    ], `"Commas,, galore, ","""Quote"" 'me,', """"please!"""""," sing""le "," ",`, false);
    verify(['Medium', 'Very high', `with, comma*=~!|more`, `asdf\nsdf`],
      `Medium, Very high, "with, comma*=~!|more", "asdf\nsdf"`, true);
    // The exact interpretation of invalid encodings isn't too important, but should include most
    // of the value and not throw exceptions.
    assert.deepEqual(csvFormat.csvDecodeRow(`invalid"e\ncoding,","`),
      ['invalid"e\ncoding,', '']);
  });
});
