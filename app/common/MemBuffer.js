const gutil = require('./gutil');
const {arrayToString, stringToArray} = require('./arrayToString');


/**
 * Class for a dynamic memory buffer. You can optionally pass the number of bytes
 * to reserve initially.
 */
function MemBuffer(optBytesToReserve) {
  this.buffer = new ArrayBuffer(optBytesToReserve || 64);
  this.asArray = new Uint8Array(this.buffer);
  this.asDataView = new DataView(this.buffer);
  this.startPos = 0;
  this.endPos = 0;
}

// These are defined in gutil now because they are used there (and to avoid a circular import),
// but were originally defined in MemBuffer and various code still uses them as MemBuffer members.
MemBuffer.arrayToString = arrayToString;
MemBuffer.stringToArray = stringToArray;

/**
 * Returns the number of bytes in the buffer.
 */
MemBuffer.prototype.size = function() {
  return this.endPos - this.startPos;
};

/**
 * Returns the number of bytes reserved in the buffer for data. This is at least size().
 */
MemBuffer.prototype.reserved = function() {
  return this.buffer.byteLength - this.startPos;
};

/**
 * Reserves enough space in the buffer to hold a nbytes of data, counting the data already in the
 * buffer.
 */
MemBuffer.prototype.reserve = function(nbytes) {
  if (this.startPos + nbytes > this.buffer.byteLength) {
    var origArray = new Uint8Array(this.buffer, this.startPos, this.size());
    if (nbytes > this.buffer.byteLength) {
      // At least double the size of the buffer.
      var newBytes = Math.max(nbytes, this.buffer.byteLength * 2);
      this.buffer = new ArrayBuffer(newBytes);
      this.asArray = new Uint8Array(this.buffer);
      this.asDataView = new DataView(this.buffer);
    }
    // If we did not allocate more space, this line will just move data to the beginning.
    this.asArray.set(origArray);
    this.endPos = this.size();
    this.startPos = 0;
  }
};

/**
 * Clears the buffer.
 */
MemBuffer.prototype.clear = function() {
  this.startPos = this.endPos = 0;
  // If the buffer has grown somewhat big, use this chance to free the memory.
  if (this.buffer.byteLength >= 256 * 1024) {
    this.buffer = new ArrayBuffer(64);
    this.asArray = new Uint8Array(this.buffer);
    this.asDataView = new DataView(this.buffer);
  }
};

/**
 * Returns a Uint8Array viewing all the data in the buffer. It is the caller's responsibility to
 * make a copy if needed to avoid it being affected by subsequent changes to the buffer.
 */
MemBuffer.prototype.asByteArray = function() {
  return new Uint8Array(this.buffer, this.startPos, this.size());
};

/**
 * Converts all buffer data to string using UTF8 encoding.
 * This is mainly for testing.
 */
MemBuffer.prototype.toString = function() {
  return arrayToString(this.asByteArray());
};

/*
 * (Dmitry 2017/03/20. Some unittests that include timing (e.g. Sandbox.js measuring serializing
 * of data using marshal.js) indicated that gutil.arrayCopyForward gets deoptimized. Narrowing it
 * down, I found it was because it was used with different argument types (Arrays, Buffers,
 * Uint8Arrays). To keep it optimized, we'll use a cloned copy of arrayCopyForward (for copying to
 * a Uint8Array) in this module.
 */
let arrayCopyForward = gutil.cloneFunc(gutil.arrayCopyForward);

/**
 * Appends an array of bytes to this MemBuffer.
 * @param {Uint8Array|Buffer} bytes: Array of bytes to append. May be a Node Buffer.
 */
MemBuffer.prototype.writeByteArray = function(bytes) {
  // Note that the implementation is identical for Uint8Array and a Node Buffer.
  this.reserve(this.size() + bytes.length);
  arrayCopyForward(this.asArray, this.endPos, bytes, 0, bytes.length);
  this.endPos += bytes.length;
};

/**
 * Encodes the given string in UTF8 and appends to the buffer.
 */
if (typeof TextDecoder !== 'undefined') {
  MemBuffer.prototype.writeString = function(string) {
    this.writeByteArray(stringToArray(string));
  };
} else {
  // We can write faster without using stringToArray, to avoid allocating new buffers.
  // We'll encode data in chunks reusing a single buffer. The buffer is a multiple of chunk size
  // to have enough space for multi-byte characters.
  var encodeChunkSize = 1024;
  var encodeBufferPad = Buffer.alloc(encodeChunkSize * 4);

  MemBuffer.prototype.writeString = function(string) {
    // Reserve one byte per character initially (common case), but we'll reserve more below as
    // needed.
    this.reserve(this.size() + string.length);
    for (var i = 0; i < string.length; i += encodeChunkSize) {
      var bytesWritten = encodeBufferPad.write(string.slice(i, i + encodeChunkSize));
      this.reserve(this.size() + bytesWritten);
      arrayCopyForward(this.asArray, this.endPos, encodeBufferPad, 0, bytesWritten);
      this.endPos += bytesWritten;
    }
  };
}


function makeWriteFunc(typeName, bytes, optLittleEndian) {
  var setter = DataView.prototype['set' + typeName];
  return function(value) {
    this.reserve(this.size() + bytes);
    setter.call(this.asDataView, this.endPos, value, optLittleEndian);
    this.endPos += bytes;
  };
}

/**
 * The following methods append a value of the given type to the buffer.
 * These are analogous to Node Buffer's write* family of methods.
 */
MemBuffer.prototype.writeInt8 = makeWriteFunc('Int8', 1);
MemBuffer.prototype.writeUint8 = makeWriteFunc('Uint8', 1);
MemBuffer.prototype.writeInt16LE = makeWriteFunc('Int16', 2, true);
MemBuffer.prototype.writeInt16BE = makeWriteFunc('Int16', 2, false);
MemBuffer.prototype.writeUint16LE = makeWriteFunc('Uint16', 2, true);
MemBuffer.prototype.writeUint16BE = makeWriteFunc('Uint16', 2, false);
MemBuffer.prototype.writeInt32LE = makeWriteFunc('Int32', 4, true);
MemBuffer.prototype.writeInt32BE = makeWriteFunc('Int32', 4, false);
MemBuffer.prototype.writeUint32LE = makeWriteFunc('Uint32', 4, true);
MemBuffer.prototype.writeUint32BE = makeWriteFunc('Uint32', 4, false);
MemBuffer.prototype.writeFloat32LE = makeWriteFunc('Float32', 4, true);
MemBuffer.prototype.writeFloat32BE = makeWriteFunc('Float32', 4, false);
MemBuffer.prototype.writeFloat64LE = makeWriteFunc('Float64', 8, true);
MemBuffer.prototype.writeFloat64BE = makeWriteFunc('Float64', 8, false);

/**
 * To consume data from an mbuf, the following pattern is recommended:
 *    var consumer = mbuf.makeConsumer();
 *    try {
 *      mbuf.readInt8(consumer);
 *      mbuf.readByteArray(consumer, len);
 *      ...
 *    } catch (e) {
 *      if (e.needMoreData) {
 *        ...
 *      }
 *    }
 *    mbuf.consume(consumer);
 */
MemBuffer.prototype.makeConsumer = function() {
  return new Consumer(this);
};

/**
 * After some data has been read via a consumer, mbuf.consume(consumer) will clear out the
 * consumed data from the buffer.
 */
MemBuffer.prototype.consume = function(consumer) {
  this.startPos = consumer.pos;
  if (this.size() === 0) {
    this.clear();
    consumer.pos = this.startPos;
  }
};

/**
 * Helper class for reading data from the buffer. It keeps track of an offset into the buffer
 * without changing anything in the MemBuffer itself. To affect the MemBuffer,
 * mbuf.consume(consumer) should be called.
 */
function Consumer(mbuf) {
  this.mbuf = mbuf;
  this.pos = mbuf.startPos;
}

/**
 * Helper for reading data, used by MemBuffer's read* methods.
 */
Consumer.prototype._consume = function(nbytes) {
  var offset = this.pos;
  if (this.pos + nbytes > this.mbuf.endPos) {
    var err = new RangeError("MemBuffer: read past end");
    err.needMoreData = true;
    err.consumedData = this.pos - this.mbuf.startPos;
    throw err;
  }
  this.pos += nbytes;
  return offset;
};

/**
 * Reads length bytes from the buffer using the passed-in consumer, as created by
 * mbuf.makeConsumer(). Returns a view on the underlying data.
 * @returns {Uint8Array} array of bytes viewing underlying MemBuffer data.
 */
MemBuffer.prototype.readByteArraySlice = function(cons, length) {
  return new Uint8Array(this.buffer, cons._consume(length), length);
};

/**
 * Reads length bytes from the buffer using the passed-in consumer.
 * @returns {Uint8Array} array of bytes that's a copy of the underlying data.
 */
MemBuffer.prototype.readByteArray = function(cons, length) {
  return new Uint8Array(this.readByteArraySlice(cons, length));
};

/**
 * Reads length bytes from the buffer using the passed-in consumer.
 * @returns {Buffer} copy of data as a Node Buffer.
 */
MemBuffer.prototype.readBuffer = function(cons, length) {
  return Buffer.from(this.readByteArraySlice(cons, length));
};

/**
 * Decodes byteLength bytes from the buffer using UTF8 and returns the resulting string. Uses the
 * passed-in consumer, as created by mbuf.makeConsumer().
 * @returns {string}
 */
if (typeof TextDecoder !== 'undefined') {
  MemBuffer.prototype.readString = function(cons, byteLength) {
    return arrayToString(this.readByteArraySlice(cons, byteLength));
  };
} else {
  var decodeBuffer = Buffer.alloc(1024);
  MemBuffer.prototype.readString = function(cons, byteLength) {
    var offset = cons._consume(byteLength);
    if (byteLength <= decodeBuffer.length) {
      gutil.arrayCopyForward(decodeBuffer, 0, this.asArray, offset, byteLength);
      return decodeBuffer.toString('utf8', 0, byteLength);
    } else {
      return Buffer.from(new Uint8Array(this.buffer, offset, byteLength)).toString();
    }
  };
}

function makeReadFunc(typeName, bytes, optLittleEndian) {
  var getter = DataView.prototype['get' + typeName];
  return function(cons) {
    return getter.call(this.asDataView, cons._consume(bytes), optLittleEndian);
  };
}

/**
 * The following methods read and return a value of the given type from the buffer using the
 * passed-in consumer, as created by mbuf.makeConsumer(). E.g.
 *    var consumer = mbuf.makeConsumer();
 *    mbuf.readInt8(consumer);
 *    mbuf.consume(consumer);
 * These are analogous to Node Buffer's read* family of methods.
 */
MemBuffer.prototype.readInt8 = makeReadFunc('Int8', 1);
MemBuffer.prototype.readUint8 = makeReadFunc('Uint8', 1);
MemBuffer.prototype.readInt16LE = makeReadFunc('Int16', 2, true);
MemBuffer.prototype.readUint16LE = makeReadFunc('Uint16', 2, true);
MemBuffer.prototype.readInt16BE = makeReadFunc('Int16', 2, false);
MemBuffer.prototype.readUint16BE = makeReadFunc('Uint16', 2, false);
MemBuffer.prototype.readInt32LE = makeReadFunc('Int32', 4, true);
MemBuffer.prototype.readUint32LE = makeReadFunc('Uint32', 4, true);
MemBuffer.prototype.readInt32BE = makeReadFunc('Int32', 4, false);
MemBuffer.prototype.readUint32BE = makeReadFunc('Uint32', 4, false);
MemBuffer.prototype.readFloat32LE = makeReadFunc('Float32', 4, true);
MemBuffer.prototype.readFloat32BE = makeReadFunc('Float32', 4, false);
MemBuffer.prototype.readFloat64LE = makeReadFunc('Float64', 8, true);
MemBuffer.prototype.readFloat64BE = makeReadFunc('Float64', 8, false);

module.exports = MemBuffer;
