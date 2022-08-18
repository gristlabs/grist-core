import {assert} from 'chai';

import {tsvDecode, tsvEncode} from 'app/common/tsvFormat';

const sampleData = [
  ['plain value', 'plain value'],
  ['quotes "inside" hello', 'quotes "inside" hello'],
  ['"half" quotes', '"half" quotes'],
  ['half "quotes"', 'half "quotes"'],
  ['"full quotes"', '"full quotes"'],
  ['"extra" "quotes"', '"extra" "quotes"'],
  ['"has" ""double"" quotes"', '"has" ""double"" quotes"'],
  ['"more ""double""', '"more ""double""'],
  ['tab\tinside', 'tab\tinside'],
  ['\ttab first', '\ttab first'],
  ['tab last\t', 'tab last\t'],
  [' space first', ' space first'],
  ['space last ', 'space last '],
  ['\nnewline first', '\nnewline first'],
  ['newline last\n', 'newline last\n'],
  ['newline\ninside', 'newline\ninside'],
  ['"tab\tinside quotes outside"', '"tab\tinside quotes outside"'],
  ['"tab"\tbetween "quoted"', '"tab"\tbetween "quoted"'],
  ['"newline\ninside quotes outside"', '"newline\ninside quotes outside"'],
  ['"newline"\nbetween "quoted"', '"newline"\nbetween "quoted"'],
  ['"', '"'],
  ['""', '""'],
  // A few special characters on their own that should work correctly.
  ['', ' ', '\t', '\n', "'", "\\"],
  // Some non-string values
  [0, 1, false, true, undefined, null, Number.NaN],
];

// This is the encoding produced by Excel (latest version on Mac as of March 2017).
const sampleEncoded = `plain value\tplain value
quotes "inside" hello\tquotes "inside" hello
"half" quotes\t"half" quotes
half "quotes"\thalf "quotes"
"full quotes"\t"full quotes"
"extra" "quotes"\t"extra" "quotes"
"has" ""double"" quotes"\t"has" ""double"" quotes"
"more ""double""\t"more ""double""
"tab\tinside"\t"tab\tinside"
"\ttab first"\t"\ttab first"
"tab last\t"\t"tab last\t"
 space first\t space first
space last \tspace last ` /* the trailing space is intentional */ + `
"\nnewline first"\t"\nnewline first"
"newline last\n"\t"newline last\n"
"newline\ninside"\t"newline\ninside"
"""tab\tinside quotes outside"""\t"""tab\tinside quotes outside"""
"""tab""\tbetween ""quoted"""\t"""tab""\tbetween ""quoted"""
"""newline\ninside quotes outside"""\t"""newline\ninside quotes outside"""
"""newline""\nbetween ""quoted"""\t"""newline""\nbetween ""quoted"""
"\t"
""\t""
\t \t"\t"\t"\n"\t'\t\\
0\t1\tfalse\ttrue\t\t\tNaN`;

const sampleDecoded = [
  ['plain value', 'plain value'],
  ['quotes "inside" hello', 'quotes "inside" hello'],
  ['half quotes', 'half quotes'],         // not what was encoded, but matches Excel
  ['half "quotes"', 'half "quotes"'],
  ['full quotes', 'full quotes'],         // not what was encoded, but matches Excel
  ['extra "quotes"', 'extra "quotes"'],   // not what was encoded, but matches Excel
  ['has ""double"" quotes"', 'has ""double"" quotes"'], // not what was encoded, but matches Excel
  ['more "double"\tmore ""double""'],     // not what was encoded, but matches Excel
  ['tab\tinside', 'tab\tinside'],
  ['\ttab first', '\ttab first'],
  ['tab last\t', 'tab last\t'],
  [' space first', ' space first'],
  ['space last ', 'space last '],
  ['\nnewline first', '\nnewline first'],
  ['newline last\n', 'newline last\n'],
  ['newline\ninside', 'newline\ninside'],
  ['"tab\tinside quotes outside"', '"tab\tinside quotes outside"'],
  ['"tab"\tbetween "quoted"', '"tab"\tbetween "quoted"'],
  ['"newline\ninside quotes outside"', '"newline\ninside quotes outside"'],
  ['"newline"\nbetween "quoted"', '"newline"\nbetween "quoted"'],
  ['\t'],                                 // not what was encoded, but matches Excel
  ['', ''],                               // not what was encoded, but matches Excel
  // A few special characters on their own that should work correctly.
  ['', ' ', '\t', '\n', "'", "\\"],
  // All values get parsed as strings.
  ['0', '1', 'false', 'true', '', '', 'NaN'],
];

describe('tsvFormat', function() {
  it('should encode tab-separated values as Excel does', function() {
    assert.deepEqual(tsvEncode(sampleData), sampleEncoded);
  });

  it('should decode tab-separated values as Excel does', function() {
    assert.deepEqual(tsvDecode(sampleEncoded), sampleDecoded);
  });
});
