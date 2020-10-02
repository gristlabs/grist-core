/**
 * This is the base class for components. The purpose is to abstract away several
 * common idioms to make derived components simpler.
 *
 * Usage:
 *    function Component(gristDoc) {
 *      Base.call(this, gristDoc);
 *      ...
 *    }
 *    Base.setBaseFor(Component);
 *
 * To create an object:
 *    var obj = Component.create(constructor_args...);
 */

/* global $ */

var dispose = require('../lib/dispose');

/**
 * gristDoc may be null when there is no active document.
 */
function Base(gristDoc) {
  this.gristDoc = gristDoc;

  this._debugName = this.constructor.name + '[' + Base._nextObjectId + ']';
  // TODO: devise a logging system that allows turning on/off different debug tags and levels.
  //console.log(this._debugName, "Base constructor");

  this._eventNamespace = '.Events_' + (Base._nextObjectId++);
  this._eventSources = [];

  this.autoDisposeCallback(this.clearEvents);
}

Base._nextObjectId = 1;

/**
 * Sets ctor to inherit prototype methods from Base.
 * @param {function} ctor Constructor function which needs to inherit Base's prototype.
 */
Base.setBaseFor = function(ctor) {
  ctor.prototype = Object.create(Base.prototype, {
    constructor: {
      value: ctor,
      enumerable: false,
      writable: true,
      configurable: true
    }
  });
  dispose.makeDisposable(ctor);
};


/**
 * Subscribe to eventType on source, similarly to $(source).on(eventType, optSelector, method).
 * In fact, this uses JQuery internally. The convenience is that it allows unsubscribing in bulk.
 * Also, method is called with the context of `this`.
 */
Base.prototype.onEvent = function(source, eventType, optSelector, method) {
  if (typeof optSelector != 'string') {
    method = optSelector;
    optSelector = null;
  }
  if (this._eventSources.indexOf(source) === -1)
    this._eventSources.push(source);

  var self = this;
  $(source).on(eventType + this._eventNamespace, optSelector, function(event_args) {
    Array.prototype.unshift.call(arguments, this);    // Unshift is generic enough for 'arguments'.
    if (self._eventSources)
      return method.apply(self, arguments);
  });
};

/**
 * Unsubscribes this object from eventType on source, similarly to $(source).off(eventType).
 */
Base.prototype.clearEvent = function(source, eventType) {
  $(source).off(eventType + this._eventNamespace);
};

/**
 * Unsubscribes this object from all events that it subscribed to via onEvent().
 */
Base.prototype.clearEvents = function() {
  var sources = this._eventSources;
  for (var i = 0; i < sources.length; i++) {
    $(sources[i]).off(this._eventNamespace);
  }
  this._eventSources.length = 0;
};

module.exports = Base;
