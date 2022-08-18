/**
 * Array-like data structure that lets you push elements to it, but holds only the last N of them.
 */
function CircularArray(maxLength) {
  this.maxLength = maxLength;
  this._data = [];
  this._offset = 0;
}

/**
 * @property {Number} - the number of items in the CircularArray.
 */
Object.defineProperty(CircularArray.prototype, "length", {
  get: function() { return this._data.length; }
});

/**
 * @param {Number} index - An index to fetch, between 0 and length - 1.
 * @returns {Object} The item at the given index.
 */
CircularArray.prototype.get = function(index) {
  return this._data[(this._offset + index) % this.maxLength];
};

/**
 * @param {Object} item - An item to push onto the end of the CircularArray.
 */
CircularArray.prototype.push = function(item) {
  if (this._data.length < this.maxLength) {
    this._data.push(item);
  } else {
    this._data[this._offset] = item;
    this._offset = (this._offset + 1) % this.maxLength;
  }
};

/**
 * Returns the entire content of CircularArray as a plain array.
 */
CircularArray.prototype.getArray = function() {
  return this._data.slice(this._offset).concat(this._data.slice(0, this._offset));
};

module.exports = CircularArray;
