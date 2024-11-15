var assert = require('chai').assert;
var net = require('net');
var Promise = require('bluebird');

var serverUtils = require('app/server/lib/serverUtils');

describe('serverUtils', function() {
  describe("#getAvailablePort", function() {
    var tmpServers = [];

    function holdPort(port) {
      return new Promise((resolve, reject) => {
        let server = net.createServer();
        server.on('error', reject);
        server.listen(port, 'localhost', resolve);
        tmpServers.push(server);
      });
    }

    afterEach(function() {
      tmpServers.forEach(server => server.close());
    });

    it("should find an available port number", function() {
      this.timeout(60000);
      var port1;
      // Try getting a somewhat random port.
      return serverUtils.getAvailablePort(9123, 20)
      .then(port => {
        port1 = port;
        assert.isAtLeast(port, 9123);
        assert.isAtMost(port, 9143);
        return holdPort(port);
      })
      .then(() => {
        // While holding the port we got, do it again.
        return serverUtils.getAvailablePort(9123, 20);
      })
      .then(port => {
        assert.isAtLeast(port, 9123);
        assert.isAtMost(port, 9143);
        // Ensure that the new port is different from the first one.
        assert.notEqual(port, port1);
        return holdPort(port);
      })
      .then(() => {
        return serverUtils.getAvailablePort(port1, 2)
        .then(() => {
          assert(false, "Ports " + port1 + " and next should not be available");
        }, err => {
          assert.match(err.toString(), /No available ports/);
        });
      })
      .then(() => {
        return serverUtils.getAvailablePort();
      })
      .then(port => {
        assert.isAtLeast(port, 8000);
        assert.isAtMost(port, 8200);
      });
    });
  });

  describe('isPathWithin', function() {
    it("should return when on path is within another", function() {
      assert.strictEqual(serverUtils.isPathWithin("/foo/bar", "/foo/bar/baz"), true);
      assert.strictEqual(serverUtils.isPathWithin("/foo/bar", "/foo/bar"), true);
      assert.strictEqual(serverUtils.isPathWithin("/foo/bar", "/foo/baz/bar"), false);
      assert.strictEqual(serverUtils.isPathWithin("/foo/bar", "/foo/barbaz"), false);
      assert.strictEqual(serverUtils.isPathWithin("/foo/bar", "/foo/baz"), false);
      assert.strictEqual(serverUtils.isPathWithin("/foo/bar", "/foo/ba"), false);
      assert.strictEqual(serverUtils.isPathWithin("/foo/bar", "/foo"), false);
      assert.strictEqual(serverUtils.isPathWithin("/foo/bar", "/"), false);

      // Paths get normalized.
      assert.strictEqual(serverUtils.isPathWithin("///foo/.//bar//./", "/foo/bar/baz"), true);
      assert.strictEqual(serverUtils.isPathWithin("///foo/.//bar//./", "/foo/baz"), false);

      // Works with all relative paths.
      assert.strictEqual(serverUtils.isPathWithin("foo/bar", "foo/bar/baz"), true);
      assert.strictEqual(serverUtils.isPathWithin("foo/bar", "./foo/bar"), true);
      assert.strictEqual(serverUtils.isPathWithin("foo/bar", "foo/baz/bar"), false);
      assert.strictEqual(serverUtils.isPathWithin("foo/bar", "foo/barbaz"), false);
      assert.strictEqual(serverUtils.isPathWithin("foo/bar", "./foo/baz"), false);
      assert.strictEqual(serverUtils.isPathWithin("foo/bar", "foo/ba"), false);
      assert.strictEqual(serverUtils.isPathWithin("foo/bar", "foo"), false);
      assert.strictEqual(serverUtils.isPathWithin("foo/bar", "."), false);
      assert.strictEqual(serverUtils.isPathWithin("foo/bar", ""), false);
    });
  });
});
