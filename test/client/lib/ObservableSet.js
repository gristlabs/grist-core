var assert = require('chai').assert;
var ko = require('knockout');

var clientUtil = require('../clientUtil');
var ObservableSet = require('app/client/lib/ObservableSet');

describe('ObservableSet', function() {
  clientUtil.setTmpMochaGlobals();

  it("should keep track of items", function() {
    var set = ObservableSet.create();
    assert.equal(set.count(), 0);
    assert.deepEqual(set.all(), []);

    var obs1 = ko.observable(true), val1 = { foo: 5 },
        obs2 = ko.observable(false), val2 = { foo: 17 };

    var sub1 = set.add(obs1, val1),
        sub2 = set.add(obs2, val2);

    assert.equal(set.count(), 1);
    assert.deepEqual(set.all(), [val1]);

    obs1(false);
    assert.equal(set.count(), 0);
    assert.deepEqual(set.all(), []);

    obs2(true);
    assert.equal(set.count(), 1);
    assert.deepEqual(set.all(), [val2]);

    obs1(true);
    assert.equal(set.count(), 2);
    assert.deepEqual(set.all(), [val1, val2]);

    sub1.dispose();
    assert.equal(set.count(), 1);
    assert.deepEqual(set.all(), [val2]);
    assert.equal(obs1.getSubscriptionsCount(), 0);
    assert.equal(obs2.getSubscriptionsCount(), 1);

    sub2.dispose();
    assert.equal(set.count(), 0);
    assert.deepEqual(set.all(), []);
    assert.equal(obs1.getSubscriptionsCount(), 0);
    assert.equal(obs2.getSubscriptionsCount(), 0);
  });
});
