/**
 * RecentItems maintains a list of maxCount most recently added items.
 * If an existing item is added, it is moved to the end of the list.
 *
 * @constructor
 * @param {Int} options.maxCount - The maximum number of objects that will be maintained.
 * @param {Function} options.keyFunc -  Function that returns a key identifying an item;
 * If an item is added with an existing key, it replaces the previous item in the list but is
 * moved to the end of the list.  Defaults to the identity function.
 * @param {Array} options.intialItems - A list of items to populate the list on initialization
 */

class RecentItems {
  constructor(options) {
    this._items = new Map();
    this._maxCount = options.maxCount || 0;
    this._keyFunc = options.keyFunc || (item => item);
    if (options.intialItems) this.addItems(options.intialItems);
  }

  addItem(item) {
    // Map maintains entries in the order of insertion, so by deleting and reinserting an entry,
    // we move it to the end of the list.
    this._items.delete(this._keyFunc(item));
    this._items.set(this._keyFunc(item), item);
    // Now that the list is correctly ordered we may need to remove the oldest entry which is
    // the first item.
    if (this._items.size > this._maxCount && this._maxCount !== 0) {
      this._items.delete(this._items.keys().next().value);
    }
  }

  addItems(items) {
    items.forEach(item => {
      this.addItem(item);
    });
  }

  /**
   * Returns a list of the current items in the map.  The list is starts with oldest
   * added item and ends with the most recently inserted.
   *
   * @returns {Array} A list of items.
   */
  listItems() {
    return Array.from(this._items.values());
  }
}

module.exports = RecentItems;
