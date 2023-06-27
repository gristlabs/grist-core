const assert = require('chai').assert;
const ko     = require('knockout');

const clientUtil = require('../clientUtil');

const ObservableMap = require('app/client/lib/ObservableMap');

describe('ObservableMap', function () {
  clientUtil.setTmpMochaGlobals();

  let factor, mapFunc, map, additive;
  let obsKey1, obsKey2, obsValue1, obsValue2;

  before(function () {
    factor = ko.observable(2);
    additive = 0;
    mapFunc = ko.computed(() => {
      let f = factor();
      return function (key) {
        return key * f + additive;
      };
    });
    map = ObservableMap.create(mapFunc);
  });

  it('should keep track of items and update values on key updates', function () {
    obsKey1 = ko.observable(1);
    obsKey2 = ko.observable(2);

    assert.isUndefined(map.get(1));
    assert.isUndefined(map.get(2));

    obsValue1 = map.add(obsKey1);
    obsValue2 = map.add(obsKey2);

    assert.equal(map.get(1).size, 1);
    assert.equal(map.get(2).size, 1);

    assert.equal(obsValue1(), 2);
    assert.equal(obsValue2(), 4);

    obsKey1(2);

    assert.isUndefined(map.get(1));
    assert.equal(map.get(2).size, 2);

    assert.equal(obsValue1(), 4);
    assert.equal(obsValue2(), 4);
  });

  it('should update all values if mapping function is updated', function () {
    assert.equal(obsValue1(), 4);
    assert.equal(obsValue2(), 4);

    factor(3);

    assert.equal(obsValue1(), 6);
    assert.equal(obsValue2(), 6);

    obsKey1(4);
    obsKey2(5);

    assert.equal(obsValue1(), 12);
    assert.equal(obsValue2(), 15);
  });

  it('updateKeys should update values for that key, but not other values', function () {
    additive = 7;

    map.updateKeys([4]);

    assert.equal(obsValue1(), 19);
    assert.equal(obsValue2(), 15);
  });

  it('updateAll should update all values for all keys', function () {
    additive = 8;

    map.updateAll();

    assert.equal(obsValue1(), 20);
    assert.equal(obsValue2(), 23);
  });

  it('should remove items when they are disposed', function () {
    let obsKey1 = ko.observable(6);
    let obsKey2 = ko.observable(6);

    assert.isUndefined(map.get(6));

    let obsValue1 = map.add(obsKey1);
    let obsValue2 = map.add(obsKey2);

    assert(map.get(6).has(obsValue1));
    assert(map.get(6).has(obsValue2));
    assert.equal(map.get(6).size, 2);
    obsValue1.dispose();
    assert.isFalse(map.get(6).has(obsValue1));
    assert.equal(map.get(6).size, 1);
    obsValue2.dispose();
    assert.isUndefined(map.get(6));
  });

  it('should unsubscribe from observables on disposal', function () {
    assert.equal(obsValue1(), 20);
    assert.equal(obsValue2(), 23);

    map.dispose();

    obsKey1(10);
    obsKey2(11);
    factor(3);

    assert.equal(obsValue1(), 20);
    assert.equal(obsValue2(), 23);
  });

});
