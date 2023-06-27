var assert  = require('chai').assert;
var marshal = require('app/common/marshal');
var MemBuffer = require('app/common/MemBuffer');


describe("marshal", function() {
  function binStringToArray(binaryString) {
    var a = new Uint8Array(binaryString.length);
    for (var i = 0; i < binaryString.length; i++) {
      a[i] = binaryString.charCodeAt(i);
    }
    return a;
  }
  function arrayToBinString(array) {
    return String.fromCharCode.apply(String, array);
  }
  var samples = [
    [null, 'N'],
    [1, 'i\x01\x00\x00\x00'],
    [1000000, 'i@B\x0f\x00'],
    [-123456, 'i\xc0\x1d\xfe\xff'],
    [1.23, 'g\xae\x47\xe1\x7a\x14\xae\xf3\x3f', 2],
    [-625e-4, 'g\x00\x00\x00\x00\x00\x00\xb0\xbf', 2],
    [12.34, 'f\x0512.34', 0],
    [6.02e23, 'f\x086.02e+23', 0],
    [true, 'T'],
    [false, 'F'],
    [MemBuffer.stringToArray('Hello world'), 's\x0b\x00\x00\x00Hello world'],
    ['Résumé', 's\x08\x00\x00\x00R\xc3\xa9sum\xc3\xa9'],
    [[1, 2, 3],
      '[\x03\x00\x00\x00i\x01\x00\x00\x00i\x02\x00\x00\x00i\x03\x00\x00\x00'],
    [{'This': 4, 'is': 0, 'a': MemBuffer.stringToArray('test')},
      '{s\x04\x00\x00\x00Thisi\x04\x00\x00\x00s\x01\x00\x00\x00as\x04\x00\x00\x00tests\x02\x00\x00\x00isi\x00\x00\x00\x000'],
  ];

  describe('basic data structures', function() {
    it("should serialize correctly", function() {
      var m0 = new marshal.Marshaller({ stringToBuffer: true, version: 0 });
      var m2 = new marshal.Marshaller({ stringToBuffer: true, version: 2 });
      for (var i = 0; i < samples.length; i++) {
        var value = samples[i][0];
        var expected = binStringToArray(samples[i][1]);
        var version = samples[i].length === 3 ? samples[i][2] : 0;
        var currentMarshaller = version >= 2 ? m2 : m0;
        currentMarshaller.marshal(value);
        var marshalled = currentMarshaller.dump();
        assert.deepEqual(marshalled, expected,
                         "Wrong serialization of " + JSON.stringify(value) +
                           "\n        actual: " + escape(arrayToBinString(marshalled)) + "\n" +
                           "\n      expected: " + escape(arrayToBinString(expected)));
      }
    });

    it("should deserialize correctly", function() {
      var m = new marshal.Unmarshaller();
      var values = [];
      m.on('value', function(val) { values.push(val); });

      for (var i = 0; i < samples.length; i++) {
        values.length = 0;
        var expected = samples[i][0];
        m.push(binStringToArray(samples[i][1]));
        assert.strictEqual(values.length, 1);
        var value = values[0];
        if (typeof expected === 'string') {
          // This tests marshals JS strings to Python strings, but unmarshalls to Uint8Arrays. So
          // when the source is a string, we need to tweak the returned value for comparison.
          value = MemBuffer.arrayToString(value);
        }
        assert.deepEqual(value, expected);
      }
    });

    it("should support stringToBuffer and bufferToString", function() {
      var mY = new marshal.Marshaller({ stringToBuffer: true });
      var mN = new marshal.Marshaller({ stringToBuffer: false });
      var uY = new marshal.Unmarshaller({ bufferToString: true });
      var uN = new marshal.Unmarshaller({ bufferToString: false });
      var helloBuf = MemBuffer.stringToArray("hello");
      function passThrough(m, u, value) {
        var ret = null;
        u.on('value', function(v) { ret = v; });
        m.marshal(value);
        u.push(m.dump());
        return ret;
      }
      // No conversion, no change.
      assert.deepEqual(passThrough(mN, uN, "hello"), "hello");
      assert.deepEqual(passThrough(mN, uN, helloBuf), helloBuf);

      // If convert to strings on the way back, then see all strings.
      assert.deepEqual(passThrough(mN, uY, "hello"), "hello");
      assert.deepEqual(passThrough(mN, uY, helloBuf), "hello");

      // If convert to buffers on the way forward, and no conversion back, then see all buffers.
      assert.deepEqual(passThrough(mY, uN, "hello"), helloBuf);
      assert.deepEqual(passThrough(mY, uN, helloBuf), helloBuf);

      // If convert to buffers on the way forward, and to strings back, then see all strings.
      assert.deepEqual(passThrough(mY, uY, "hello"), "hello");
      assert.deepEqual(passThrough(mY, uY, helloBuf), "hello");
    });

  });


  function mkbuf(arg) { return new Uint8Array(arg); }

  function dumps(codeStr, value) {
    var m = new marshal.Marshaller();
    m.marshal(marshal.wrap(codeStr, value));
    return m.dump();
  }

  describe('int64', function() {
    it("should serialize 32-bit values correctly", function() {
      assert.deepEqual(dumps('INT64', 0x7FFFFFFF), mkbuf([73, 255, 255, 255, 127, 0, 0, 0, 0]));
      assert.deepEqual(dumps('INT64', -0x80000000), mkbuf([73, 0, 0, 0, 128, 255, 255, 255, 255]));

      // TODO: larger values fail now, but of course it's better to fix, and change this test.
      assert.throws(function() { dumps('INT64', 0x7FFFFFFF+1); }, /int64/);
      assert.throws(function() { dumps('INT64', -0x80000000-1); }, /int64/);
    });

    it("should deserialize 32-bit values correctly", function() {
      assert.strictEqual(marshal.loads([73, 255, 255, 255, 127, 0, 0, 0, 0]), 0x7FFFFFFF);
      assert.strictEqual(marshal.loads([73, 0, 0, 0, 128, 255, 255, 255, 255]), -0x80000000);

      // Can be verified in Python with: marshal.loads("".join(chr(r) for r in [73, 255, ...]))
      assert.strictEqual(marshal.loads([73, 255, 255, 255, 127, 255, 255, 255, 255]), -0x80000001);
      assert.strictEqual(marshal.loads([73, 0, 0, 0, 128, 0, 0, 0, 0]), 0x80000000);

      // Be sure to test with low and high 32-bit words being positive or negative. Note that
      // integers that are too large to be safely represented are currently returned as strings.
      assert.strictEqual(marshal.loads([73, 1, 2, 3, 190, 4, 5, 6, 200]), '-4033530898337824255');
      assert.strictEqual(marshal.loads([73, 1, 2, 3, 190, 4, 5, 6,  20]), '1442846248544698881');
      assert.strictEqual(marshal.loads([73, 1, 2, 3,  90, 4, 5, 6, 200]), '-4033530900015545855');
      assert.strictEqual(marshal.loads([73, 1, 2, 3,  90, 4, 5, 6,  20]), '1442846246866977281');
    });
  });

  describe('interned strings', function() {
    it("should parse interned strings correctly", function() {
      var testData = '{t\x03\x00\x00\x00aaat\x03\x00\x00\x00bbbR\x01\x00\x00\x00R\x00\x00\x00\x000';
      assert.deepEqual(marshal.loads(binStringToArray(testData)),
        { 'aaa': MemBuffer.stringToArray('bbb'),
          'bbb': MemBuffer.stringToArray('aaa')
        });
    });
  });

  describe('longs', function() {
    // This is generated as [991**i for i in xrange(10)] + [-678**i for i in xrange(10)].
    // Note how overly large values currently get stringified.
    const sampleData = [1, 991, 982081, 973242271, 964483090561, 955802742745951,
      '947200518061237441', '938675713398686304031', '930227631978098127294721',
      '921855583290295244149068511',
      -1, -678, -459684, -311665752, -211309379856, -143267759542368, '-97135540969725504',
      '-65857896777473891712', '-44651654015127298580736', '-30273821422256308437739008'];

    const serialized = "[\x14\x00\x00\x00i\x01\x00\x00\x00i\xdf\x03\x00\x00iA\xfc\x0e\x00i\x9f\x7f\x02:I\x81\x08\xac\x8f\xe0\x00\x00\x00I_\xeb\xf4*Le\x03\x00I\xc1$\x1bJ\xda!%\rl\x05\x00\x00\x00\x1fG&>\x130\xf0\x15.\x03l\x06\x00\x00\x00\x01Q@\x17n\x1b\x84m\xbbO\x18\x00l\x06\x00\x00\x00\xdf\x123\x03\x86/\xd0r4(Q_i\xff\xff\xff\xffiZ\xfd\xff\xffi\\\xfc\xf8\xffi\xa8[l\xedI\xf0\xbe\xfa\xcc\xce\xff\xff\xffI\xa0\xaf\x15\xe0\xb2}\xff\xffI\xc0!oy\xbd\xe7\xa6\xfel\xfb\xff\xff\xff\x80\x1dYG\xc1\x00\xb2\x0f9\x00l\xfa\xff\xff\xff\x00!Rv\x9f\x00p\x11I\x17\x01\x00l\xfa\xff\xff\xff\x00f\xda]\x8c'\xa3.\xb2+!\x03";

    it("should deserialize arbitrarily long integers correctly", function() {
      assert.deepEqual(marshal.loads(binStringToArray(serialized)), sampleData);
    });
  });
});
