var _ = require('underscore');
var Promise = require('bluebird');
var assert = require('assert');
var gutil = require('app/common/gutil');
var ko = require('knockout');
var koUtil = require('../lib/koUtil');


/**
 * Adds a family of 'save' methods to an observable. It accepts a callback for saving a value
 * (presumably to the server), and adds the following methods:
 * @method save()           Saves the current value of the observable to the server.
 * @method saveOnly(obj)    Saves the given value, without changing the observable's value.
 * @method setAndSave(obj)  Sets a new value for the observable and saves it.
 * @returns {Observable} Returns the passed-on observable.
 */
function addSaveInterface(observable, saveFunc) {
  observable.saveOnly = function(value) {
    // Calls saveFunc and notifies subscribers of 'save' events.
    return Promise.try(() => saveFunc.call(this, value))
    .tap(() => observable.notifySubscribers(value, "save"));
  };
  observable.save = function() {
    return this.saveOnly(this.peek());
  };
  observable.setAndSave = function(value) {
    this(value);
    return this.saveOnly(value);
  };
  return observable;
}
exports.addSaveInterface = addSaveInterface;


/**
 * Creates a pureComputed with a read/write/save interface. The argument is an object with two
 * properties: `read` is the same as for a computed or a pureComputed. `write` is different: it is
 * a callback called as write(setter, value), where `setter(obs, value)` can be used with another
 * observable to write or save to it. E.g. if `foo` is an observable:
 *
 *  let bar = savingComputed({
 *    read: () => foo(),
 *    write: (setter, val) => setter(foo, val.toUpperCase())
 *  })
 *
 * Now `bar()` has the value of foo, calling `bar("hello")` will call `foo("HELLO")`, and
 * `bar.saveOnly("hello")` will call `foo.saveOnly("HELLO")`.
 */
function savingComputed(options) {
  return addSaveInterface(ko.pureComputed({
    read: options.read,
    write: val => options.write(_writeSetter, val)
  }), val => options.write(_saveSetter, val));
}
exports.savingComputed = savingComputed;

function _writeSetter(obs, val) { return obs(val); }
function _saveSetter(obs, val) { return obs.saveOnly(val); }


/**
 * Set and save the observable to the given value if it would change the value of the observable.
 * If the observable has no .save() interface, then the saving is skipped. If the save() call
 * fails, then the observable gets reset to its previous value.
 * @param {Observable} observable: Observable which may support the 'save' interface.
 * @param {Object} value: An arbitrary value. If identical to the current value of the observable,
 *    then the call is a no-op.
 * @param {Object} optOrigValue: If given, will use it as the original value of the observable: if
 *    it matches value, will skip saving; if save fails, will revert to this original.
 * @returns {undefined|Promise} If saving, a promise for when save() completes, else undefined.
 */
function setSaveValue(observable, value, optOrigValue) {
  let orig = (optOrigValue === undefined) ? observable.peek() : optOrigValue;
  if (value !== orig) {
    observable(value);
    if (observable.save) {
      return Promise.try(() => observable.save())
      .catch(err => {
        console.warn("setSaveValue %s -> %s failed: %s", orig, value, err);
        observable(orig);
        throw err;
      });
    }
  }
}
exports.setSaveValue = setSaveValue;


/**
 * Creates an observable for a field value. It accepts a callback for saving its value to the
 * server, and adds a family of 'save' methods to the returned observable (see docs for
 * addSaveInterface() above).
 */
function createField(saveFunc) {
  return addSaveInterface(ko.observable(), saveFunc);
}
exports.createField = createField;

/**
 * Returns an observable that mirrors another one but returns a default value if the underlying
 * field is falsy. Supports writing and saving, which translates directly to writing to the
 * underlying field. If the default value is a function, it's evaluated as in `computed()`, with
 * the given context.
 */
function fieldWithDefault(fieldObs, defaultOrFunc, optContext) {
  var obsWithDef = koUtil.observableWithDefault(fieldObs, defaultOrFunc, optContext);
  if (fieldObs.saveOnly) {
    addSaveInterface(obsWithDef, fieldObs.saveOnly);
  }
  return obsWithDef;
}
exports.fieldWithDefault = fieldWithDefault;


/**
 * Helper to create an observable for a single property of a jsonObservable. It updates whenever
 * the jsonObservable is updated, and it allows setting the property, which sets the entire object
 * of the jsonObservable. Also supports 'save' methods.
 */
function _createJsonProp(jsonObservable, propName) {
  var jsonProp = ko.pureComputed({
    read: function() { return jsonObservable()[propName]; },
    write: function(value) {
      var obj = jsonObservable.peek();
      obj[propName] = value;
      jsonObservable(obj);
    }
  });

  // Add save methods (if underlying jsonObservable supports them)
  if (jsonObservable.saveOnly) {
    addSaveInterface(jsonProp, function(value) {
      var obj = _.clone(jsonObservable.peek());
      obj[propName] = value;
      return jsonObservable.saveOnly(obj);
    });
  }
  return jsonProp;
}


/**
 * Creates an observable for an object represented by an observable JSON string. It automatically
 * parses the JSON string when it changes, and stringifies on setting the object. It also supports
 * 'save' methods, forwarding calls to the .saveOnly function of the underlying string observable.
 *
 * @param {observable[String]} stringObservable: observable for a string that should contain JSON.
 * @param [Function] modifierFunc: function called with parsed object, which can modify it
 *    at will, e.g. to set defaults. It's OK to modify in-place; only the return value is used.
 * @param [Object] optContext: Optionally a context to call modifierFunc with.
 *
 * The returned observable supports these methods:
 * @method save()           Saves the current value of the observable to the server.
 * @method saveOnly(obj)    Saves the given value, without changing the observable's value.
 * @method setAndSave(obj)  Sets a new value for the observable and saves it.
 * @method update(obj)      Updates json with new properties (caller can .save() afterwards).
 * @method prop(name)       Returns an observable for the given property of the JSON object,
 *    which also supports saving. Multiple calls to prop('foo') return the same observable.
 */
function jsonObservable(stringObservable, modifierFunc, optContext) {
  modifierFunc = modifierFunc || function(obj) { return obj || {}; };

  // Create the jsonObservable itself
  var obs = ko.pureComputed({
    read: function() { // reads the underlying string, parses, and passes through modFunc
      var json = stringObservable();
      return modifierFunc.call(optContext, json ? JSON.parse(json) : null);
    },
    write: function(obj) { // stringifies the given obj and sets the underlying string to that
      stringObservable(JSON.stringify(obj));
    }
  });

  // Create save interface if possible
  if (stringObservable.saveOnly) {
    addSaveInterface(obs, function(obj) {
      return stringObservable.saveOnly(JSON.stringify(obj));
    });
  }

  return objObservable(obs);
}
exports.jsonObservable = jsonObservable;

/**
 * Creates an observable for an object.
 *
 * @param {observable[Object]} objectObservable: observable for an object.
 *
 * The returned observable supports these methods:
 * @method update(obj)      Updates object with new properties.
 * @method prop(name)       Returns an observable for the given property of the object.
 */
function objObservable(objectObservable) {
  objectObservable.update = function(obj) {
    this(_.extend(this.peek(), obj)); // read self, _.extend, writeback
  };
  objectObservable._props = {};
  objectObservable.prop = function(propName) {
    // If created, return cached prop. Else _createJsonProp
    return this._props[propName] || (this._props[propName] = _createJsonProp(this, propName));
  };
  return objectObservable;
}
exports.objObservable = objObservable;

// Special value that indicates that a customValueField isn't set and is using the saved value.
var _sentinel = {};

/**
 * Creates a observable that reflects savedObservable() but may diverge from it when set, and has
 * a methods to revert to the saved value. Additionally, the saving methods
 * (.save/.saveOnly/.setAndSave) save savedObservable() and synchronize the values.
 */
function customValue(savedObservable) {
  var options = { read: () => savedObservable() };
  if (savedObservable.saveOnly) {
    options.save = (val => savedObservable.saveOnly(val));
  }
  return customComputed(options);
}
exports.customValue = customValue;

/**
 * Creates an observable whose value defaults to options.read() but may diverge from it when set,
 * and has a method to revert to the default value. If options.save(val) is provided, the saving
 * methods (.save/.saveOnly/.setAndSave) call it and reset the observable to its default value.
 * @param {Function} options.read: Returns the default value for the observable.
 * @param {Function} options.save(val): Saves a new value of the observable. May return a Promise.
 *
 * @returns {Observable} A writable observable value with some extra properties:
 *   @property {Observable} isSaved: Computed for whether customComputed() has its default value.
 *   @method revert(): Revert the customComputed() to its default value.
 *   @method save(val): If val is different from the current value of read(), call
 *      options.save(val), then revert the observable to its (possibly new) default value.
 */
function customComputed(options) {
  var current = ko.observable(_sentinel);
  var read = options.read;
  var save = options.save;

  // This is our main interface: just an observable, which defaults to the one at fieldName.
  var active = ko.pureComputed({
    read: () => (current() !== _sentinel ? current() : read()),
    write: val => current(val !== read() ? val : _sentinel),
  });

  // .isSaved is an observable that returns whether the saved value has not been overridden.
  active.isSaved = ko.pureComputed(() => (current() === _sentinel));

  // .revert reverts to the saved value, discarding whatever custom value was set.
  active.revert = function() { current(_sentinel); };

  // When any of the .save/.saveOnly/.setAndSave functions are called on the customValueField,
  // they save the underlying value and (when that resolves), discard the current value.
  if (save) {
    addSaveInterface(active, val => (
      Promise.try(() => val !== read() ? save(val) : null).finally(active.revert)
    ));
  }
  return active;
}
exports.customComputed = customComputed;


function bulkActionExpand(bulkAction, callback, context) {
  assert(gutil.startsWith(bulkAction[0], "Bulk"));

  var rowIds = bulkAction[2];
  var columnValues = bulkAction[3];
  var indivAction = bulkAction.slice(0);
  indivAction[0] = indivAction[0].slice(4);
  var colValues = indivAction[3] = columnValues && _.clone(columnValues);
  for (var i = 0; i < rowIds.length; i++) {
    indivAction[2] = rowIds[i];
    if (colValues) {
      for (var col in colValues) {
        colValues[col] = columnValues[col][i];
      }
    }
    callback.call(context, indivAction);
  }
}
exports.bulkActionExpand = bulkActionExpand;


/**
 * Helper class which provides a `dispatchAction` method that can be subscribed to listen to
 * actions received from the server. It dispatches each action to `this._process_{ActionType}`
 * method, e.g. `this._process_UpdateRecord`.
 *
 * Implementation methods `_process_*` are called with the action as the first argument, and with
 * the action arguments as additional method arguments, for convenience.
 */
var ActionDispatcher = {
  dispatchAction: function(action) {
    console.assert(!(typeof this.isDisposed === 'function' && this.isDisposed()),
      `Dispatching action ${action[0]} on disposed object`, this);

    var methodName = "_process_" + action[0];
    var func = this[methodName];
    if (typeof func === 'function') {
      var args = action.slice(0);
      args[0] = action;
      return func.apply(this, args);
    } else {
      console.warn("Received unknown action %s", action[0]);
    }
  },

  /**
   * Generic handler for bulk actions (Bulk{Add,Remove,Update}Record) which forwards the bulk call
   * to multiple per-record calls. Intended to be used as:
   *    Foo.prototype._process_BulkUpdateRecord = Foo.prototype.dispatchBulk;
   */
  dispatchBulk: function(action, tableId, rowIds, columnValues) {
    bulkActionExpand(action, this.dispatchAction, this);
  },
};
exports.ActionDispatcher = ActionDispatcher;
