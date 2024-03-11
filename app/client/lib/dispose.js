/**
 * dispose.js provides tools to components that needs to dispose of resources, such as
 * destroy DOM, and unsubscribe from events. The motivation with examples is presented here:
 *
 *    /documentation/disposal/disposal.md
 */


var ko = require('knockout');
var util = require('util');
var _ = require("underscore");

// Use the browser globals in a way that allows replacing them with mocks in tests.
var G = require('./browserGlobals').get('DocumentFragment', 'Node');

/**
 * Disposable is a base class for components that need cleanup (e.g. maintain DOM, listen to
 * events, subscribe to anything). It provides a .dispose() method that should be called to
 * destroy the component, and .autoDispose() method that the component should use to take
 * responsibility for other pieces that require cleanup.
 *
 * To define a disposable prototype:
 *    function Foo() { ... }
 *    dispose.makeDisposable(Foo);
 *
 * To define a disposable ES6 class:
 *    class Foo extends dispose.Disposable { create() {...} }
 *
 *    NB: Foo should not have its construction logic in a constructor but in a `create` method
 *    instead. If Foo defines a constructor (for taking advantage of type checking) the constructor
 *    should only call super `super(arg1, arg2 ...)`. Any way calling `new Foo(...args)` safely
 *    construct the component.
 *
 * In Foo's constructor or methods, take ownership of other objects:
 *    this.bar = this.autoDispose(Bar.create(...));
 * The argument will get disposed when `this` is disposed. If it's a DOM node, it will get removed
 * using ko.removeNode(). If it has a `dispose` method, it will be called.
 *
 * For more customized disposal:
 *    this.baz = this.autoDisposeWith('destroy', new Baz());
 *    this.elem = this.autoDisposeWith(ko.cleanNode, document.createElement(...));
 * When `this` is disposed, will call this.baz.destroy(), and ko.cleanNode(this.elem).
 *
 * To call another method on disposal (e.g. to add custom disposal logic):
 *    this.autoDisposeCallback(this.myUnsubscribeAllMethod);
 * The method will be called with `this` as context, and no arguments.
 *
 * To create Foo:
 *    var foo = Foo.create(args...);
 * `Foo.create` ensures that if the constructor throws an exception, any calls to .autoDispose()
 * that happened before that are honored.
 *
 * To dispose of Foo:
 *    foo.dispose();
 * Owned objects will be disposed in reverse order from which `autoDispose` were called. Note that
 * `foo` is no longer usable afterwards, and all its properties are wiped.
 * If Foo has a `stopListening` method (e.g. inherits from Backbone.Events), `dispose` will call
 * it automatically, as if it were added with `this.autoDisposeCallback(this.stopListening)`.
 *
 * To release an owned object:
 *    this.disposeRelease(this.bar);
 *
 * To dispose of an owned object early:
 *    this.disposeDiscard(this.bar);
 *
 * To determine if a reference refers to object that has already been disposed:
 *    foo.isDisposed()
 */
class Disposable {
  /**
   * A safe constructor which calls dispose() in case the creation throws an exception.
   */
  constructor(...args) {
    safelyConstruct(this.create, this, args);
  }

  /**
   * Static method to allow rewriting old classes into ES6 without modifying their
   * instantiation to use `new Foo()` (i.e. you can continue to use `Foo.create()`).
   */
  static create(...args) {
    return new this(...args);
  }
}

Object.assign(Disposable.prototype, {
  /**
   * Take ownership of `obj`, and dispose it when `this.dispose` is called.
   * @param {Object} obj: Object to take ownership of. It can be a DOM node or an object with a
   *    `dispose` method.
   * @returns {Object} obj
   */
  autoDispose: function(obj) {
    return this.autoDisposeWith(defaultDisposer, obj);
  },

  /**
   * As for autoDispose, but we receive a promise of an object.  We wait for it to
   * resolve and then take ownership of it.  We return a promise that resolves to
   * the object, or to null if the owner is disposed in the meantime.
   */
  autoDisposePromise: function(objPromise) {
    return objPromise.then(obj => {
      if (this.isDisposed()) {
        defaultDisposer(obj);
        return null;
      }
      this.autoDispose(obj);
      return obj;
    });
  },

  /**
   * Take ownership of `obj`, and dispose it when `this.dispose` is called by calling the
   * specified function.
   * @param {Function|String} disposer: If a function, disposer(obj) will be called to dispose the
   *    object, with `this` as the context. If a string, then obj[disposer]() will be called. E.g.
   *        this.autoDisposeWith('destroy', a);     // will call a.destroy()
   *        this.autoDisposeWith(ko.cleanNode, b);  // will call ko.cleanNode(b)
   * @param {Object} obj: Object to take ownership of, on which `disposer` will be called.
   * @returns {Object} obj
   */
  autoDisposeWith: function(disposer, obj) {
    var list = this._disposalList || (this._disposalList = []);
    list.push({ obj: obj,
                disposer: typeof disposer === 'string' ? methodDisposer(disposer) : disposer });
    return obj;
  },

  /**
   * Adds the given callback to be called when `this.dispose` is called.
   * @param {Function} callback: Called on disposal with `this` as the context and no arguments.
   * @returns nothing
   */
  autoDisposeCallback: function(callback) {
    this.autoDisposeWith(callFuncHelper, callback);
  },

  /**
   * Remove `obj` from the list of owned objects; it will not be disposed on `this.dispose`.
   * @param {Object} obj: Object to release.
   * @returns {Object} obj
   */
  disposeRelease: function(obj) {
    removeObjectToDispose(this._disposalList, obj);
    return obj;
  },

  /**
   * Dispose of an owned object `obj` now, and remove it from the list of owned objects.
   * @param {Object} obj: Object to release.
   * @returns nothing
   */
  disposeDiscard: function(obj) {
    var entry = removeObjectToDispose(this._disposalList, obj);
    if (entry) {
      entry.disposer.call(this, obj);
    }
  },

  /**
   * Returns whether this object has already been disposed.
   */
  isDisposed: function() {
    return this._disposalList === WIPED_VALUE;
  },

  /**
   * Clean up `this` by disposing of all owned objects, and calling `stopListening()` if defined.
   */
  dispose: function() {
    if (this.isDisposed()) {
      return;
    }

    var disposalList = this._disposalList;
    this._disposalList = WIPED_VALUE; // This makes isDisposed() true.
    if (disposalList) {
      // Go backwards through the disposal list, and dispose of everything.
      for (var i = disposalList.length - 1; i >= 0; i--) {
        var entry = disposalList[i];
        disposeHelper(this, entry.disposer, entry.obj);
      }
    }

    // Call stopListening if it exists. This is a convenience when using Backbone.Events. It's
    // equivalent to calling this.autoDisposeCallback(this.stopListening) in constructor.
    if (typeof this.stopListening === 'function') {
      // Wrap in disposeHelper so that errors get caught.
      disposeHelper(this, callFuncHelper, this.stopListening);
    }

    // Finish by wiping out the object, since nothing should use it after dispose().
    // See /documentation/disposal.md for more motivation.
    wipeOutObject(this);
  }
});
exports.Disposable = Disposable;


/**
 * The recommended way to make an object disposable. It simply adds the methods of `Disposable` to
 * its prototype, and also adds a `Class.create()` function, for a safer way to construct objects
 * (see `safeCreate` for explanation). For instance,
 *    function Foo(args...) {...}
 *    dispose.makeDisposable(Foo);
 * Now you can create Foo objects with:
 *    var foo = Foo.create(args...);
 * And dispose of them with:
 *    foo.dispose();
 */
function makeDisposable(Constructor) {
  Object.assign(Constructor.prototype, Disposable.prototype);
  Constructor.create = safeConstructor;
}
exports.makeDisposable = makeDisposable;


/**
 * Helper to create and construct an object safely: `safeCreate(Foo, ...)` is similar to `new
 * Foo(...)`. The difference is that in case of an exception in the constructor, the dispose()
 * method will be called on the partially constructed object.
 * If you call makeDisposable(Foo), then Foo.create(...) is equivalent and more convenient.
 * @returns {Object} the newly constructed object.
 */
function safeCreate(Constructor, varArgs) {
  return safeConstructor.apply(Constructor, Array.prototype.slice.call(arguments, 1));
}
exports.safeCreate = safeCreate;


/**
 * Helper used by makeDisposable() for the `create` property of a disposable class. E.g. when
 * assigned to Foo.create, the call `Foo.create(args)` becomes similar to `new Foo(args)`, but
 * calls dispose() in case the constructor throws an exception.
 */
var safeConstructor = function(varArgs) {
  var Constructor = this;
  var obj = Object.create(Constructor.prototype);
  return safelyConstruct(Constructor, obj, arguments);
};

var safelyConstruct = function(Constructor, obj, args) {
  try {
    Constructor.apply(obj, args);
    return obj;
  } catch (e) {
    // Be a bit more helpful and concise in reporting errors: print error as an object (that
    // includes its stacktrace in FF and Chrome), and avoid printing it multiple times as it
    // bubbles up through the stack of safeConstructor calls.
    if (!e.printed) {
      let name = obj.constructor.name || Constructor.name;
      console.error("Error constructing %s:", name, e);
      // assigning printed to a string throws: TypeError: Cannot create property 'printed' on [...]
      if (_.isObject(e)) {
        e.printed = true;
      }
    }
    obj.dispose();
    throw e;
  }
};

// It doesn't matter what the value is, but some values cause more helpful errors than others.
// E.g. if x = "disposed", then x.foo() throws "undefined is not a function", while when x = null,
// x.foo() throws "Cannot read property 'foo' of null", which seems more helpful.
var WIPED_VALUE = null;


/**
 * Wipe out the given object by setting each property to a dummy value. This is helpful for
 * objects that are disposed and should be ready to be garbage-collected. The goals are:
 * - If anything still refers to the object and uses it, we'll get an early error, rather than
 *   silently keep going, potentially doing useless work (or worse) and wasting resources.
 * - If anything still refers to the object but doesn't use it, the fields of the object can
 *   still be garbage-collected.
 * - If there are circular references between the object and its properties, they get broken,
 *   making the job easier for the garbage collector.
 */
function wipeOutObject(obj) {
  for (var k in obj) {
    if (obj.hasOwnProperty(k)) {
      obj[k] = WIPED_VALUE;
    }
  }
}

/**
 * Internal helper used by disposeDiscard() and disposeRelease(). It finds, removes, and returns
 * an entry from the given disposalList.
 */
function removeObjectToDispose(disposalList, obj) {
  if (disposalList) {
    for (var i = 0; i < disposalList.length; i++) {
      if (disposalList[i].obj === obj) {
        var entry = disposalList[i];
        disposalList.splice(i, 1);
        return entry;
      }
    }
  }
  return null;
}

/**
 * Internal helper to allow adding cleanup callbacks to the disposalList. It acts as the
 * "disposer" for callback, by simply calling them with the same context that it is called with.
 */
var callFuncHelper = function(callback) {
  callback.call(this);
};

/**
 * Internal helper to dispose objects that need a differently-named method to be called on them.
 * It's used by `autoDisposeWith` when the disposer is a string method name.
 */
function methodDisposer(methodName) {
  return function(obj) {
    obj[methodName]();
  };
}

/**
 * Internal helper to call a disposer on an object. It swallows errors (but reports them) to make
 * sure that when we dispose of an object, an error in disposing of one owned part doesn't stop
 * the disposal of the other parts.
 */
function disposeHelper(owner, disposer, obj) {
  try {
    disposer.call(owner, obj);
  } catch (e) {
    console.error("While disposing %s, error disposing %s: %s",
      describe(owner), describe(obj), e);
  }
}

/**
 * Helper for reporting errors during disposal. Try to report the type of the object.
 */
function describe(obj) {
  return (obj && obj.constructor && obj.constructor.name ? obj.constructor.name :
    util.inspect(obj, {depth: 1}));
}

/**
 * Internal helper that implements the default disposal for an object. It just supports removing
 * DOM nodes with ko.removeNode, and calling dispose() on any part that has a `dispose` method.
 */
function defaultDisposer(obj) {
  if (obj instanceof G.Node) {
    // This does both knockout- and jquery-related cleaning, and removes the node from the DOM.
    ko.removeNode(obj);
  } else if (typeof obj.dispose === 'function') {
    obj.dispose();
  } else {
    throw new Error("Object has no 'dispose' method");
  }
}

/**
 * Removes all children of the given node, and all knockout bindings. You can use it as
 *    this.autoDisposeWith(dispose.emptyNode, node);
 */
function emptyNode(node) {
  ko.virtualElements.emptyNode(node);
  ko.cleanNode(node);
}

exports.emptyNode = emptyNode;
