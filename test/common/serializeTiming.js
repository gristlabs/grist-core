var _ = require('underscore');
var assert = require('assert');
var Chance = require('chance');
var utils = require('../utils');
var marshal = require('app/common/marshal');

/**
 * This test measures the complete encoding/decoding time of several ways to serialize an array of
 * data. This is intended both to choose a good serialization format, and to optimize its
 * implementation. This test is supposed to work both in Node and in browsers.
 */
describe("Serialization", function() {

  function marshalV0(data) {
    var m = new marshal.Marshaller({stringToBuffer: true, version: 0});
    m.marshal(data);
    return m.dump();
  }

  function marshalV2(data) {
    var m = new marshal.Marshaller({stringToBuffer: true, version: 2});
    m.marshal(data);
    return m.dump();
  }

  function unmarshal(buffer) {
    var m = new marshal.Unmarshaller({bufferToString: true});
    var value;
    m.on('value', function(v) { value = v; });
    m.push(buffer);
    m.removeAllListeners();
    return value;
  }

  var encoders = {
    "marshal_v0":  {enc: marshalV0,      dec: unmarshal},
    "marshal_v2":  {enc: marshalV2,      dec: unmarshal},
    "json":        {enc: JSON.stringify, dec: JSON.parse},
  };

  describe("correctness", function() {
    var data;
    before(function() {
      // Generate an array of random data using the Chance module
      var chance = new Chance(1274323391); // seed is arbitrary
      data = {
        'floats1k': chance.n(chance.floating, 1000),
        'strings1k': chance.n(chance.string, 1000),
      };
    });

    _.each(encoders, function(encoder, name) {
      it(name, function() {
        assert.deepEqual(encoder.dec(encoder.enc(data.floats1k)), data.floats1k);
        assert.deepEqual(encoder.dec(encoder.enc(data.strings1k)), data.strings1k);
      });
    });
  });

  utils.timing.describe("timings", function() {
    var data, encoded = {}, results = {};
    before(function() {
      this.timeout(10000);
      // Generate an array of random data using the Chance module
      var chance = new Chance(1274323391); // seed is arbitrary
      data = {
        'floats100k': chance.n(chance.floating, 100000),
        'strings100k': chance.n(chance.string, 100000),
      };
      // And prepare an encoded version for each encoder so that we can time decoding.
      _.each(data, function(values, key) {
        _.each(encoders, function(encoder, name) {
          encoded[key + ":" + name] = encoder.enc(values);
        });
      });
    });

    function test_encode(name, key, expectedMs) {
      utils.timing.it(expectedMs, "encodes " + key + " with " + name, function() {
        utils.repeat(5, encoders[name].enc, data[key]);
      });
    }

    function test_decode(name, key, expectedMs) {
      utils.timing.it(expectedMs, "decodes " + key + " with " + name, function() {
        var ret = utils.repeat(5, encoders[name].dec, encoded[key + ":" + name]);
        results[key + ":" + name] = ret;
      });
    }

    after(function() {
      // Verify the results of decoding tests outside the timed test case.
      _.each(results, function(result, keyName) {
        var key = keyName.split(":")[0];
        assert.deepEqual(result, data[key], "wrong result decoding " + keyName);
      });
    });

    // Note that these tests take quite a bit longer when running ALL tests than when running them
    // separately, so the expected times are artificially inflated below to let them pass. This
    // may be because memory allocation is slower due to memory fragmentation. Just running gc()
    // before the tests doesn't remove the discrepancy.
    // Also note that the expected time needs to be high enough for both node and browser.
    test_encode('marshal_v0', 'floats100k', 1600);
    test_decode('marshal_v0', 'floats100k', 600);
    test_encode('marshal_v0', 'strings100k', 1000);
    test_decode('marshal_v0', 'strings100k', 800);

    test_encode('marshal_v2', 'floats100k', 160);
    test_decode('marshal_v2', 'floats100k', 160);
    test_encode('marshal_v2', 'strings100k', 1000);
    test_decode('marshal_v2', 'strings100k', 800);

    test_encode('json', 'floats100k', 120);
    test_decode('json', 'floats100k', 120);
    test_encode('json', 'strings100k', 80);
    test_decode('json', 'strings100k', 80);
  });
});
