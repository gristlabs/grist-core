var ko      = require('knockout');

var dispose = require('./dispose');

/**
 * ObservableMap provides a structure to keep track of values that need to recalculate in
 * response to a key change or a mapping function change.
 *
 * @example
 * let factor = ko.observable(2);
 * let myFunc = ko.computed(() => {
 *   let f = factor();
 *   return (keyId) => key * f;
 * });
 *
 * let myMap = ObservableMap.create(myFunc);
 * let inObs1 = ko.observable(2);
 * let inObs2 = ko.observable(3);
 *
 * let outObs1 = myMap.add(inObs1);
 * let outObs2 = myMap.add(inObs2);
 * outObs1(); // 4
 * outObs2(); // 6
 *
 * inObs1(5);
 * outObs1(); // 10
 *
 * factor(3);
 * outObs1(); // 15
 * outObs2(); // 9
 *
 *
 * @param {Function} mapFunc - Computed that returns a mapping function that takes in a key and
 *  returns a value. Whenever `mapFunc` is updated, all the current values in the map will be
 *  recalculated using the new function.
 */
function ObservableMap(mapFunc) {
  this.store = new Map();
  this.mapFunc = mapFunc;

  // Recalculate all values on changes to mapFunc
  let mapFuncSub = mapFunc.subscribe(() => {
    this.updateAll();
  });

  // Disposes all stored observable and clears the map.
  this.autoDisposeCallback(() => {
    // Unsbuscribe from mapping function
    mapFuncSub.dispose();
    // Clear the store
    this.store.forEach((val, key) => val.forEach(obj => obj.dispose()));
    this.store.clear();
  });
}
dispose.makeDisposable(ObservableMap);

/**
 * Takes an observable for the key value and returns an observable for the output.
 * Subscribes to the given observable so that whenever it changes the output observable is
 * updated to the value returned by `mapFunc` when provided the new key as input.
 * If user disposes of the returned observable, it will be removed from the map.
 *
 * @param {ko.observable} obsKey
 * @return {ko.observble} Observable value equal to `mapFunc(obsKey())` that will be updated on
 *  updates to `obsKey` and `mapFunc`.
 */
ObservableMap.prototype.add = function (obsKey) {
  let currKey = obsKey();
  let ret = ko.observable(this.mapFunc()(currKey));

  // Add to map
  this._addKeyValue(currKey, ret);

  // Subscribe to changes to key
  let subs = obsKey.subscribe(newKey => {
    ret(this.mapFunc()(newKey));

    if (currKey !== newKey) {
      // If the key changed, add it to the new bucket and delete from the old one
      this._addKeyValue(newKey, ret);
      this._delete(currKey, ret);
      // And update the key
      currKey = newKey;
    }
  });
  ret.dispose = () => {
    // On dispose, delete from map unless the whole map is being disposed
    if (!this.isDisposed()) {
      this._delete(currKey, ret);
    }
    subs.dispose();
  };

  return ret;
};

/**
 * Returns the Set of observable values for the given key.
 */
ObservableMap.prototype.get = function (key) {
  return this.store.get(key);
};

ObservableMap.prototype._addKeyValue = function (key, value) {
  if (!this.store.has(key)) {
    this.store.set(key, new Set([value]));
  } else {
    this.store.get(key).add(value);
  }
};

/**
 * Triggers an update for all keys.
 */
ObservableMap.prototype.updateAll = function () {
  this.store.forEach((val, key) => this.updateKey(key));
};

/**
 * Triggers an update for all observables for given keys in the map.
 * @param {Array} keys
 */
ObservableMap.prototype.updateKeys = function (keys) {
  keys.forEach(key => this.updateKey(key));
};

/**
 * Triggers an update for all observables for the given key in the map.
 * @param {Any} key
 */
ObservableMap.prototype.updateKey = function (key) {
  if (this.store.has(key) && this.store.get(key).size > 0) {
    this.store.get(key).forEach(obj => {
      obj(this.mapFunc()(key));
    });
  }
};

/**
 * Given a key and an observable, deletes the observable from that key's bucket.
 *
 * @param {Any} key - Current value of the key.
 * @param {Any} obsValue - An observable previously returned by `add`.
 */
ObservableMap.prototype._delete = function (key, obsValue) {
  if (this.store.has(key) && this.store.get(key).size > 0) {
    this.store.get(key).delete(obsValue);
    // Clean up empty buckets
    if (this.store.get(key).size === 0) {
      this.store.delete(key);
    }
  }
};

module.exports = ObservableMap;
