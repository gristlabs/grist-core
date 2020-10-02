/**
 * Our version of knockout's ko.observableArray(), similar but more efficient. It
 * supports fewer methods (mainly because we don't need other methods at the moment). Instead of
 * emitting 'arrayChange' events, it emits 'spliceChange' events.
 */


var ko = require('knockout');
var Promise = require('bluebird');
var dispose = require('./dispose');
var gutil = require('app/common/gutil');

require('./koUtil');   // adds subscribeInit method to observables.

/**
 * Event indicating that a koArray has been modified. This reflects changes to which objects are
 * in the array, not the state of those objects. A `spliceChange` event is emitted after the array
 * has been modified.
 * @event spliceChange
 * @property {Array} data - The underlying array, already modified.
 * @property {Number} start - The start index at which items were inserted or deleted.
 * @property {Number} added - The number of items inserted.
 * @property {Array} deleted - The array of items that got deleted.
 */

/**
 * Creates and returns a new koArray, either empty or with the given initial values.
 * Unlike a ko.observableArray(), you access the values using array.all(), and set values using
 * array.assign() (or better, by using push() and splice()).
 */
function koArray(optInitialValues) {
  return KoArray.create(optInitialValues);
}

// The koArray function is the main export.
module.exports = exports = koArray;
exports.default = koArray;

/**
 * Checks if an object is an instance of koArray.
 */
koArray.isKoArray = function(obj) {
  return (obj && typeof obj.subscribe === 'function' && typeof obj.all === 'function');
};
exports.isKoArray = koArray.isKoArray;

/**
 * Given an observable which evaluates to different arrays or koArrays, returns a single koArray
 * observable which mirrors whichever array is the current value of the observable. If a callback
 * is given, all elements are mapped through it. See also map().
 * @param {ko.observable} koArrayObservable: observable whose value is a koArray or plain array.
 * @param {Function} optCallback: If given, maps elements from original arrays.
 * @param {Object} optCallbackTarget: If callback is given, this becomes the `this` value for it.
 * @returns {koArray} a single koArray that mirrors the current value of koArrayObservable,
 *    optionally mapping them through optCallback.
 */
koArray.syncedKoArray = function(koArrayObservable, optCallback, optCallbackTarget) {
  var ret = koArray();
  optCallback = optCallback || identity;
  ret.autoDispose(koArrayObservable.subscribeInit(function(currentArray) {
    if (koArray.isKoArray(currentArray)) {
      ret.syncMap(currentArray, optCallback, optCallbackTarget);
    } else if (currentArray) {
      ret.syncMapDisable();
      ret.assign(currentArray.map(function(item, i) {
        return optCallback.call(optCallbackTarget, item, i);
      }));
    }
  }));
  return ret;
};
exports.syncedKoArray = koArray.syncedKoArray;


function SyncedState(constructFunc, key) {
  constructFunc(this, key);
}
dispose.makeDisposable(SyncedState);

/**
 * Create and return a new Map that's kept in sync with koArrayObj. The keys are the array items
 * themselves. The values are constructed using constructFunc(state, item), where state is a new
 * Disposable object, allowing to associate other disposable state with the item. The returned Map
 * should itself be disposed when no longer needed.
 * @param {KoArray} koArrayObj: A KoArray object to watch.
 * @param {Function} constructFunc(state, item): called for each item in the array, with a new
 *    disposable state object, on which all Disposable methods are available. The state object
 *    will be disposed when an item is removed or the returned map itself disposed.
 * @param [Number] options.addDelay: (optional) If numeric, delay calls to add items
 *    by this many milliseconds (except initialization, which is always immediate).
 * @return {Map} map object mapping array items to state objects, and with a dispose() method.
 */
koArray.syncedMap = function(koArrayObj, constructFunc, options) {
  var map = new Map();
  var sub = koArrayObj.subscribeForEach({
    add: item => map.set(item, SyncedState.create(constructFunc, item)),
    remove: item => gutil.popFromMap(map, item).dispose(),
    addDelay: options && options.addDelay
  });
  map.dispose = () => {
    sub.dispose();
    map.forEach((stateObj, item) => stateObj.dispose());
  };
  return map;
};


/**
 * The actual constructor for koArray. To create a new instance, simply use koArray() (without
 * `new`). The constructor might be needed, however, to inherit from this class.
 */
function KoArray(initialValues) {
  this._array = ko.observable(initialValues || []);
  this._preparedSpliceEvent = null;
  this._syncSubscription = null;
  this._disposeElements = noop;

  this.autoDispose(this._array.subscribe(this._emitPreparedEvent, this, 'spectate'));

  this.autoDisposeCallback(function() {
    this._disposeElements(this.peek());
  });
}
exports.KoArray = KoArray;

dispose.makeDisposable(KoArray);

/**
 * If called on a koArray, it will dispose of its contained items as they are removed or when the
 * array is itself disposed.
 * @returns {koArray} itself.
 */
KoArray.prototype.setAutoDisposeValues = function() {
  this._disposeElements = this._doDisposeElements;
  return this;
};

/**
 * Returns the underlying array, creating a dependency when used from a computed observable.
 * Note that you must not modify the returned array directly; you should use koArray methods.
 */
KoArray.prototype.all = function() {
  return this._array();
};

/**
 * Returns the underlying array without creating a dependency on it.
 * Note that you must not modify the returned array directly; you should use koArray methods.
 */
KoArray.prototype.peek = function() {
  return this._array.peek();
};

/**
 * Returns the underlying observable whose value is a plain array.
 */
KoArray.prototype.getObservable = function() {
  return this._array;
};

/**
 * The `peekLength` property evaluates to the length of the underlying array. Using it does NOT
 * create a dependency on the array. Use array.all().length to create a dependency.
 */
Object.defineProperty(KoArray.prototype, 'peekLength', {
  configurable: false,
  enumerable: false,
  get: function() { return this._array.peek().length; },
});

/**
 * A shorthand for the itemModel at a given index. Returns null if the index is invalid or out of
 * range. Create a dependency on the array itself.
 */
KoArray.prototype.at = function(index) {
  var arr = this._array();
  return index >= 0 && index < arr.length ? arr[index] : null;
};

/**
 * Assigns a new underlying array. This is analogous to observableArray(newValues).
 */
KoArray.prototype.assign = function(newValues) {
  var oldArray = this.peek();
  this._prepareSpliceEvent(0, newValues.length, oldArray);
  this._array(newValues.slice());
  this._disposeElements(oldArray);
};


/**
 * Subscribe to events for this koArray. To be notified of splice details, subscribe to
 * 'spliceChange', which will always follow the plain 'change' events.
 */
KoArray.prototype.subscribe = function(callback, callbackTarget, event) {
  return this._array.subscribe(callback, callbackTarget, event);
};


/**
 * @private
 * Internal method to prepare a 'spliceChange' event.
 */
KoArray.prototype._prepareSpliceEvent = function(start, numAdded, deleted) {
  this._preparedSpliceEvent = {
    array: null,
    start: start,
    added: numAdded,
    deleted: deleted
  };
};

/**
 * @private
 * Internal method to emit and reset a prepared 'spliceChange' event, if there is one.
 */
KoArray.prototype._emitPreparedEvent = function() {
  var event = this._preparedSpliceEvent;
  if (event) {
    event.array = this.peek();
    this._preparedSpliceEvent = null;
    this._array.notifySubscribers(event, 'spliceChange');
  }
};

/**
 * @private
 * Internal method called before the underlying array is modified. This copies how knockout emits
 * its default events internally.
 */
KoArray.prototype._preChange = function() {
  this._array.valueWillMutate();
};

/**
 * @private
 * Internal method called before the underlying array is modified. This copies how knockout emits
 * its default events internally.
 */
KoArray.prototype._postChange = function() {
  this._array.valueHasMutated();
};

/**
 * @private
 * Internal method to call dispose() for each item in the passed-in array. It's only used when
 * autoDisposeValues option is given to koArray.
 */
KoArray.prototype._doDisposeElements = function(elements) {
  for (var i = 0; i < elements.length; i++) {
    elements[i].dispose();
  }
};

/**
 * The standard array `push` method, which emits all expected events.
 */
KoArray.prototype.push = function() {
  var array = this.peek();
  var start = array.length;

  this._preChange();
  var ret = array.push.apply(array, arguments);
  this._prepareSpliceEvent(start, arguments.length, []);
  this._postChange();
  return ret;
};

/**
 * The standard array `unshift` method, which emits all expected events.
 */
KoArray.prototype.unshift = function() {
  var array = this.peek();
  this._preChange();
  var ret = array.unshift.apply(array, arguments);
  this._prepareSpliceEvent(0, arguments.length, []);
  this._postChange();
  return ret;
};

/**
 * The standard array `splice` method, which emits all expected events.
 */
KoArray.prototype.splice = function(start, optDeleteCount) {
  return this.arraySplice(start, optDeleteCount, Array.prototype.slice.call(arguments, 2));
};

KoArray.prototype.arraySplice = function(start, optDeleteCount, arrToInsert) {
  var array = this.peek();
  var len = array.length;
  var startIndex = Math.min(len, Math.max(0, start < 0 ? len + start : start));

  this._preChange();
  var ret = (optDeleteCount === void 0 ? array.splice(start) :
             array.splice(start, optDeleteCount));
  gutil.arraySplice(array, startIndex, arrToInsert);
  this._prepareSpliceEvent(startIndex, arrToInsert.length, ret);
  this._postChange();
  this._disposeElements(ret);
  return ret;
};

/**
 * The standard array `slice` method. Creates a dependency when used from a computed observable.
 */
KoArray.prototype.slice = function() {
  var array = this.all();
  return array.slice.apply(array, arguments);
};


/**
 * Returns a new KoArray instance, subscribed to the current one to stay parallel to it. The new
 * element are set to the result of calling `callback(orig, i)` on each original element. Note
 * that the index argument is only correct as of the time the callback got called.
 */
KoArray.prototype.map = function(callback, optThis) {
  var newArray = new KoArray();
  newArray.syncMap(this, callback, optThis);
  return newArray;
};


function noop() {}
function identity(x) { return x; }

/**
 * Keep this array in sync with another koArray, optionally mapping all elements through the given
 * callback. If callback is omitted, the current array will just mirror otherKoArray.
 * See also map().
 *
 * The subscription is disposed when the koArray is disposed.
 */
KoArray.prototype.syncMap = function(otherKoArray, optCallback, optCallbackTarget) {
  this.syncMapDisable();

  optCallback = optCallback || identity;

  this.assign(otherKoArray.peek().map(function(item, i) {
    return optCallback.call(optCallbackTarget, item, i);
  }));

  this._syncSubscription = this.autoDispose(otherKoArray.subscribe(function(splice) {
    var arr = splice.array;
    var newValues = [];
    for (var i = splice.start, n = 0; n < splice.added; i++, n++) {
      newValues.push(optCallback.call(optCallbackTarget, arr[i], i));
    }
    this.arraySplice(splice.start, splice.deleted.length, newValues);
  }, this, 'spliceChange'));
};

/**
 * Disable previously created syncMap subscription, if any.
 */
KoArray.prototype.syncMapDisable = function() {
  if (this._syncSubscription) {
    this.disposeDiscard(this._syncSubscription);
    this._syncSubscription = null;
  }
};


/**
 * Analog to forEach for regular arrays, but that stays in sync with array changes.
 * @param {Function} options.add: func(item, index, koarray) is called for each item present,
 *    and whenever an item is added.
 * @param {Function} options.remove: func(item, koarray) is called whenever an item is removed.
 * @param [Object] options.context: (optional) `this` value to use in add/remove callbacks.
 * @param [Number] options.addDelay: (optional) If numeric, delay calls to the add
 *    callback by this many milliseconds (except initialization calls which are always immediate).
 */
KoArray.prototype.subscribeForEach = function(options) {
  var context = options.context;
  var onAdd = options.add || noop;
  var onRemove = options.remove || noop;
  var shouldDelay = (typeof options.addDelay === 'number');

  var subscription = this.subscribe(function(splice) {
    var i, arr = splice.array;
    for (i = 0; i < splice.deleted.length; i++) {
      onRemove.call(context, splice.deleted[i], this);
    }
    var callAdd = () => {
      var end = splice.start + splice.added;
      for (i = splice.start; i < end; i++) {
        onAdd.call(context, arr[i], i, this);
      }
    };
    if (!shouldDelay) {
      callAdd();
    } else if (options.addDelay > 0) {
      setTimeout(callAdd, options.addDelay);
    } else {
      // Promise library invokes the callback much sooner than setTimeout does, i.e. it's much
      // closer to "nextTick", which is what we want here.
      Promise.resolve(null).then(callAdd);
    }
  }, this, 'spliceChange');

  this.peek().forEach(function(item, i) {
    onAdd.call(context, item, i, this);
  }, this);

  return subscription;
};

/**
 * Given a numeric index, returns an index that's valid for this array, clamping it if needed.
 * If the array is empty, returns null. If the index given is null, treats it as 0.
 */
KoArray.prototype.clampIndex = function(index) {
  var len = this.peekLength;
  return len === 0 ? null : gutil.clamp(index || 0, 0, len - 1);
};

/**
 * Returns a new observable representing an index into this array. It can be read and written, and
 * its value is clamped to be a valid index. The index is only null if the array is empty.
 *
 * As the array changes, the index is adjusted to continue pointing to the same element. If the
 * pointed element is deleted, the index is adjusted to after the deletion point.
 *
 * The returned observable has an additional .setLive(bool) method. While set to false, the
 * observale will not be adjusted as the array changes, except to keep it valid.
 */
KoArray.prototype.makeLiveIndex = function(optInitialIndex) {
  // The underlying observable index. Not exposed directly.
  var index = ko.observable(this.clampIndex(optInitialIndex));
  var isLive = true;

  // Adjust the index when data is spliced before it.
  this.subscribe(function(splice) {
    var idx = index.peek();
    if (!isLive) {
      index(this.clampIndex(idx));
    } else if (idx === null) {
      index(this.clampIndex(0));
    } else if (idx >= splice.start + splice.deleted.length) {
      // Adjust the index if it was beyond the deleted region.
      index(this.clampIndex(idx + splice.added - splice.deleted.length));
    } else if (idx >= splice.start + splice.added) {
      // Adjust the index if it was inside the deleted region (and not replaced).
      index(this.clampIndex(splice.start + splice.added));
    }
  }, this, 'spliceChange');

  // The returned value, which is a writable computable, constraining the value to the valid range
  // (or null if the range is empty).
  var ret = ko.pureComputed({
    read: index,
    write: function(val) { index(this.clampIndex(val)); },
    owner: this
  });
  ret.setLive = (val => { isLive = val; });
  return ret;
};
