var _ = require('underscore');
var ko = require('knockout');

/**
 * This is typed to declare that the observable/computed supports subscribable.fn methods
 * added in this utility.
 */
function withKoUtils(obj) {
  return obj;
}
exports.withKoUtils = withKoUtils;

/**
 * subscribeInit is a convenience method, equivalent to knockout's observable.subscribe(), but
 * also calls the callback immediately with the observable's current value.
 *
 * It is added to the prototype for all observables, as long as this module is included anywhere.
 */
ko.subscribable.fn.subscribeInit = function(callback, target, event) {
  var sub = this.subscribe(callback, target, event);
  callback.call(target, this.peek());
  return sub;
};

/**
 * Add a named method `assign` to knockout subscribables (including observables) to assign a new
 * value. This way we can move away from using callable objects for everything, since callable
 * objects require hacking at prototypes.
 */
ko.subscribable.fn.assign = function(value) {
  this(value);
};


/**
 * Convenience method to modify a non-primitive value and assign it back. E.g. if foo() is an
 * observable whose value is an array, then
 *
 *    foo.modifyAssign(function(array) { array.push("test"); });
 *
 * is one-liner equivalent to:
 *
 *    var array = foo.peek();
 *    array.push("text");
 *    foo(array);
 *
 * Whenever using a non-primitive value, be careful that it's not shared with other code, which
 * might modify it without any observable subscriptions getting triggered.
 */
ko.subscribable.fn.modifyAssign = function(modifierFunc) {
  var value = this.peek();
  modifierFunc(value);
  this(value);
};


/**
 * Tells a computed observable which may return non-primitive values (e.g. objects) that it should
 * only notify subscribers when the computed value is not equal to the last one (using "===").
 */
ko.subscribable.fn.onlyNotifyUnequal = function() {
  this.equalityComparer = function(a, b) { return a === b; };
  return this;
};

/**
 * Notifies only about distinct defined values. If the first value is undefined it will still be
 * returned.
 */
ko.subscribable.fn.previousOnUndefined = function() {
  this.equalityComparer = function(a, b) { return a === b || b === undefined; };
  return this;
};

let _handlerFunc = (err) => {};
let _origKoComputed = ko.computed;

/**
 * If setComputedErrorHandler is used, this wrapper catches and swallows errors from the
 * evaluation of any computed. Any exception gets passed to _handlerFunc, and the computed
 * evaluates successfully to its previous value (or _handlerFunc may rethrow the error).
 */
function _wrapComputedRead(readFunc) {
  let lastValue;
  return function() {
    try {
      return (lastValue = readFunc.call(this));
    } catch (err) {
      console.error("ERROR in ko.computed: %s", err);
      _handlerFunc(err);
      return lastValue;
    }
  };
}


/**
 * If called, exceptions thrown while evaluating any ko.computed observable will get passed to
 * handlerFunc and swallowed. Unless the handlerFunc rethrows them, the computed will evaluate
 * successfully to its previous value.
 *
 * Note that this is merely an attempt to do the best we can to keep going in the face of
 * application bugs. The returned value is not actually correct, and relying on this incorrect
 * value may cause even worse bugs elsewhere in the application. It is important that any errors
 * caught via this mechanism get reported, debugged, and fixed.
 */
function setComputedErrorHandler(handlerFunc) {
  _handlerFunc = handlerFunc;

  // Note that ko.pureComputed calls to ko.computed, so doesn't need its own override.
  ko.computed = function(funcOrOptions, funcTarget, options) {
    if (typeof funcOrOptions === 'function') {
      funcOrOptions = _wrapComputedRead(funcOrOptions);
    } else {
      funcOrOptions.read = _wrapComputedRead(funcOrOptions.read);
    }
    return _origKoComputed(funcOrOptions, funcTarget, options);
  };
}
exports.setComputedErrorHandler = setComputedErrorHandler;


/**
 * Returns an observable which mirrors the passed-in argument, but returns a default value if the
 * underlying field is falsy and has non-boolean type. Writes to the returned observable translate
 * directly to writes to the underlying one. The default may be a function, evaluated as for computed
 * observables, with optContext as the context.
 */
function observableWithDefault(obs, defaultOrFunc, optContext) {
  if (typeof defaultOrFunc !== 'function') {
    var def = defaultOrFunc;
    defaultOrFunc = function() { return def; };
  }
  return ko.pureComputed({
    read: function() {
      const value = obs();
      if (typeof value === 'boolean') {
        return value;
      }
      return value || defaultOrFunc.call(this);
    },
    write: function(val) { obs(val); },
    owner: optContext
  });
}
exports.observableWithDefault = observableWithDefault;

/**
 * Return an observable which mirrors the passed-in argument, but convert to Number value. Write to
 * to the returned observable translate to write to the underlying one a Number value.
 */
function observableNumber(obs) {
  return ko.pureComputed({
    read: () =>  Number(obs()),
    write: (val) => {
      obs(Number(val));
    }
  });
}
exports.observableNumber = observableNumber;

/**
 * Same interface as ko.computed(), except that it disposes the values it evaluates to. If an
 * observable is set to values which are created on the fly and need to be disposed (e.g.
 * components), use foo = computedAutoDispose(...). Whenever the value of foo() changes (and when
 * foo itself is disposed), the previous value's `dispose` method gets called.
 */
function computedAutoDispose(optionsOrReadFunc, target, options) {
  // Note: this isn't quite possible to do as a knockout extender, specifically to get correct the
  // pure vs non-pure distinction (sometimes the computed must be pure to avoid evaluation;
  // sometimes it has side-effects and must not be pure).
  var value = null;
  function setNewValue(newValue) {
    if (value && value !== newValue) {
      ko.ignoreDependencies(value.dispose, value);
    }
    value = newValue;
    return newValue;
  }

  var origRead;
  if (typeof optionsOrReadFunc === "object") {
    // Single-parameter syntax.
    origRead = optionsOrReadFunc.read;
    options = _.clone(optionsOrReadFunc);
  } else {
    origRead = optionsOrReadFunc;
    options = _.defaults({ owner: target }, options || {});
  }
  options.read = function() {
    return setNewValue(origRead.call(this));
  };

  var result = ko.computed(options);
  var origDispose = result.dispose;
  result.dispose = function() {
    setNewValue(null);
    origDispose.call(result);
  };
  return result;
}
exports.computedAutoDispose = computedAutoDispose;


/**
 * Helper for building disposable components that depend on a few observables. The callback is
 * evaluated as for a knockout computed observable, which creates dependencies on any observables
 * mentioned in it. But the return value of the callback should be a function ("builder"), which
 * is called to build the resulting value. Observables mentioned in the evaluation of the builder
 * do NOT create dependencies. In addition, the built value gets disposed automatically when it
 * changes.
 *
 * The optContext argument serves as the context for the callback.
 *
 * For example,
 *    var foo = ko.observable();
 *    koUtil.computedBuilder(function() {
 *      return MyComponent.create.bind(MyComponent, foo());
 *    }, this);
 *
 * In this case, whenever foo() changes, MyComponent.create(foo()) gets called, and
 * previously-returned component gets disposed. Observables mentioned during MyComponent's
 * construction do not trigger its rebuilding (as they would if a plain ko.computed() were used).
 */
function computedBuilder(callback, optContext) {
  return computedAutoDispose(function() {
    var builder = callback.call(optContext);
    return builder ? ko.ignoreDependencies(builder) : null;
  }, null, { pure: false });
}
exports.computedBuilder = computedBuilder;
