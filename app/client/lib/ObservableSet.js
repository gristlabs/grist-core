var _ = require('underscore');
var ko = require('knockout');
var dispose = require('./dispose');

/**
 * An ObservableSet keeps track of a set of values whose membership is controlled by a boolean
 * observable.
 * @property {ko.observable<Number>} count: Count of items that are currently included.
 */
function ObservableSet() {
  this._items = {};
  this.count = ko.observable(0);
}
dispose.makeDisposable(ObservableSet);

/**
 * Adds an item to keep track of. The value is added to the set whenever isIncluded observable is
 * true. To stop keeping track of this item, call dispose() on the returned object.
 *
 * @param {ko.observable<Boolean>} isIncluded: observable for whether to include the value.
 * @param {Object} value: Arbitrary value. May be omitted if you only care about the count.
 * @return {Object} Object with dispose() method, which can be called to unsubscribe from
 *    isIncluded, and remove the value from the set.
 */
ObservableSet.prototype.add = function(isIncluded, value) {
  var uniqueKey = _.uniqueId();
  var sub = this.autoDispose(isIncluded.subscribe(function(include) {
    if (include) {
      this._add(uniqueKey, value);
    } else {
      this._remove(uniqueKey);
    }
  }, this));

  if (isIncluded.peek()) {
    this._add(uniqueKey, value);
  }

  return {
    dispose: function() {
      this._remove(uniqueKey);
      this.disposeDiscard(sub);
    }.bind(this)
  };
};

/**
 * Returns an array of all the values that are currently included in the set.
 */
ObservableSet.prototype.all = function() {
  return _.values(this._items);
};

/**
 * Internal helper to add a value to the set.
 */
ObservableSet.prototype._add = function(key, value) {
  if (!this._items.hasOwnProperty(key)) {
    this._items[key] = value;
    this.count(this.count() + 1);
  }
};

/**
 * Internal helper to remove a value from the set.
 */
ObservableSet.prototype._remove = function(key) {
  if (this._items.hasOwnProperty(key)) {
    delete this._items[key];
    this.count(this.count() - 1);
  }
};

module.exports = ObservableSet;
