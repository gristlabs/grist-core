/**
 * koSession offers observables whose values are tied to the browser session or history:
 *
 *    sessionValue(key)   - an observable preserved across history entries and reloads.
 *
 * Note: we could also support "browserValue", shared across all tabs and across browser restarts
 * (same as sessionValue but using window.localStorage), but it seems more appropriate to store
 * such values on the server.
 */

/* global window, $ */

var _ = require('underscore');
var ko = require('knockout');

/**
 * Maps a string key to an observable. The space of keys is shared for all kinds of observables,
 * and they differ only in where they store their state. Each observable gets several extra
 * properties:
 * @property {String} ksKey The key used for storage. It should be unique across koSession values.
 * @property {Object} ksDefault The default value if the storage doesn't have one.
 * @property {Function} ksFetch The method to fetch the value from storage.
 * @property {Function} ksSave The method to save the value to storage.
 */
var _sessionValues = {};

function createObservable(key, defaultValue, methods) {
  var obs = _sessionValues[key];
  if (!obs) {
    _sessionValues[key] = obs = ko.observable();
    obs.ksKey = key;
    obs.ksDefaultValue = defaultValue;
    obs.ksFetch = methods.fetch;
    obs.ksSave = methods.save;
    obs.dispose = methods.dispose;

    // We initialize the observable before setting rateLimit, to ensure that the initialization
    // doesn't end up triggering subscribers that are about to be added (which seems to be a bit
    // of a problem with rateLimit extender, and possibly deferred). This workaround relies on the
    // fact that the extender modifies its target without creating a new one.
    obs(obs.ksFetch());
    obs.extend({deferred: true});

    obs.subscribe(function(newValue) {
      if (newValue !== this.ksFetch()) {
        console.log("koSession: %s changed %s -> %s", this.ksKey, this.ksFetch(), newValue);
        this.ksSave(newValue);
      }
    }, obs);
  }
  return obs;
}

/**
 * Returns an observable whose value sticks across reloads and navigation, but is different for
 * different browser tabs. E.g. it may be used to reflect whether a side pane is open.
 * The `key` isn't visible to the user, so pick any unique string name.
 */
function sessionValue(key, optDefault) {
  return createObservable(key, optDefault, sessionValueMethods);
}
exports.sessionValue = sessionValue;

var sessionValueMethods = {
  'fetch': function() {
    var value = window.sessionStorage.getItem(this.ksKey);
    if (!value) {
      return this.ksDefaultValue;
    }
    try {
      return JSON.parse(value);
    } catch (e) {
      return this.ksDefaultValue;
    }
  },
  'save': function(value) {
    window.sessionStorage.setItem(this.ksKey, JSON.stringify(value));
  },
  'dispose': function(value) {
    window.sessionStorage.removeItem(this.ksKey);
  }
};

function onApplyState() {
  _.each(_sessionValues, function(obs, key) {
    obs(obs.ksFetch());
  });
}

$(window).on('applyState', onApplyState);
