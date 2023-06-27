var assert = require('assert');
var MemBuffer = require('app/common/MemBuffer');

function repeat(str, n) {
  return new Array(n+1).join(str);
}

describe("MemBuffer", function() {
  describe('#reserve', function() {
    it("should reserve exponentially", function() {
      var mbuf = new MemBuffer();
      assert.equal(mbuf.size(), 0);

      var str = "";
      var lastRes = mbuf.reserved();
      var countReallocs = 0;

      // Append 1 char at a time, 1000 times, and make sure we don't have more than 10 reallocs.
      for (var i = 0; i < 1000; i++) {
        var ch = 'a'.charCodeAt(0) + (i % 10);
        str += String.fromCharCode(ch);

        mbuf.writeUint8(ch);

        assert.equal(mbuf.size(), i + 1);
        assert.equal(mbuf.toString(), str);
        assert.ok(mbuf.reserved() >= mbuf.size());
        // Count reallocs.
        if (mbuf.reserved() != lastRes) {
          lastRes = mbuf.reserved();
          countReallocs++;
        }
      }
      assert.ok(countReallocs < 10 && countReallocs >= 2);
    });

    it("should not realloc when it can move data", function() {
      var mbuf = new MemBuffer();
      mbuf.writeString(repeat("x", 100));
      assert.equal(mbuf.size(), 100);
      assert.ok(mbuf.reserved() >= 100 && mbuf.reserved() < 200);

      // Consume 99 characters, and produce 99 more, and the buffer shouldn't keep being reused.
      var cons = mbuf.makeConsumer();
      var value = mbuf.readString(cons, 99);
      mbuf.consume(cons);
      assert.equal(value, repeat("x", 99));
      assert.equal(mbuf.size(), 1);

      var prevBuffer = mbuf.buffer;
      mbuf.writeString(repeat("y", 99));
      assert.strictEqual(mbuf.buffer, prevBuffer);
      assert.equal(mbuf.size(), 100);
      assert.ok(mbuf.reserved() >= 100 && mbuf.reserved() < 200);

      // Consume the whole buffer, and produce a new one, and it's still being reused.
      cons = mbuf.makeConsumer();
      value = mbuf.readString(cons, 100);
      mbuf.consume(cons);
      assert.equal(value, "x" + repeat("y", 99));
      assert.equal(mbuf.size(), 0);

      mbuf.writeString(repeat("z", 100));
      assert.strictEqual(mbuf.buffer, prevBuffer);
      assert.equal(mbuf.size(), 100);
      assert.equal(mbuf.toString(), repeat("z", 100));

      // But if we produce enough new data (twice should do), it should have to realloc.
      mbuf.writeString(repeat("w", 100));
      assert.notStrictEqual(mbuf.buffer, prevBuffer);
      assert.equal(mbuf.size(), 200);
      assert.equal(mbuf.toString(), repeat("z", 100) + repeat("w", 100));
    });
  });

  describe('#write', function() {
    it("should append to the buffer", function() {
      var mbuf = new MemBuffer();
      mbuf.writeString("a");
      mbuf.writeString(repeat("x", 100));
      assert.equal(mbuf.toString(), "a" + repeat("x", 100));

      var y = repeat("y", 10000);
      mbuf.writeString(y);
      assert.equal(mbuf.toString(), "a" + repeat("x", 100) + y);
    });
  });

  describe('#consume', function() {
    it("should remove from start of buffer", function() {
      var mbuf = new MemBuffer();
      mbuf.writeString(repeat("x", 90));
      mbuf.writeString(repeat("y", 10));
      assert.equal(mbuf.toString(), repeat("x", 90) + repeat("y", 10));
      var cons = mbuf.makeConsumer();
      assert.equal(mbuf.readString(cons, 1), "x");
      assert.equal(mbuf.readString(cons, 90), repeat("x", 89) + "y");
      mbuf.consume(cons);
      assert.equal(mbuf.toString(), repeat("y", 9));

      // Trying to read past the end should throw.
      assert.throws(function() {
        mbuf.readString(cons, 10);
      }, function(err) {
        assert.ok(err.needMoreData);
        return true;
      });

      // Should leave the buffer empty if consume to the end.
      assert.equal(mbuf.readString(cons, 9), repeat("y", 9));
      mbuf.consume(cons);
      assert.equal(mbuf.size(), 0);
    });

    it("should read large strings", function() {
      var mbuf = new MemBuffer();
      var y = repeat("y", 10000);
      mbuf.writeString(y);
      var cons = mbuf.makeConsumer();
      assert.equal(mbuf.readString(cons, 10000), y);
      mbuf.consume(cons);
      assert.equal(mbuf.size(), 0);
    });
  });
});
