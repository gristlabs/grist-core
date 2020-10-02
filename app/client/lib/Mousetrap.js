/**
 * This file adds some includes tweaks to the behavior of Mousetrap.js, the keyboard bindings
 * library. It exports the mousetrap library itself, so you may use it in mousetrap's place.
 */


/* global document */

if (typeof window === 'undefined') {
  // We can't require('mousetrap') in a browserless environment (specifically for unittests)
  // because it uses global variables right on require, which are not available with jsdom.
  // So to use mousetrap in unittests, we need to stub it out.
  module.exports = {
    bind: function() {},
    unbind: function() {},
  };
} else {

  var Mousetrap = require('mousetrap');

  // Minus is different on Gecko:
  // see https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/keyCode
  // and https://github.com/ccampbell/mousetrap/pull/215
  Mousetrap.addKeycodes({173: '-'});

  var customStopCallbacks = new WeakMap();

  var MousetrapProtype = Mousetrap.prototype;
  var origStopCallback = MousetrapProtype.stopCallback;

  /**
   * Enhances Mousetrap's stopCallback filter. Normally, mousetrap ignores key events in input
   * fields and textareas. This replacement allows individual CommandGroups to be activated in such
   * elements. See also 'attach' method of commands.CommandGroup.
   */
  MousetrapProtype.stopCallback = function(e, element, combo, sequence) {
    if (mousetrapBindingsPaused) {
      return true;
    }
    // If we have a custom stopCallback, use it now.
    const custom = customStopCallbacks.get(element);
    if (custom) {
      return custom(combo);
    }
    try {
      return origStopCallback.call(this, e, element, combo, sequence);
    } catch (err) {
      if (!document.body.contains(element)) {
        // Mousetrap throws a pointless error in this case, which we ignore. It happens when
        // element gets removed by a non-mousetrap keyboard handler.
        return;
      }
      throw err;
    }
  };


  var mousetrapBindingsPaused = false;

  /**
   * Globally pause or unpause mousetrap bindings. This is useful e.g. while a context menu is being
   * shown, which has its own keyboard handling.
   */
  Mousetrap.setPaused = function(yesNo) {
    mousetrapBindingsPaused = yesNo;
  };

  /**
   * Set a custom stopCallback for an element. When a key combo is pressed for this element,
   * callback(combo) is called. If it returns true, Mousetrap should NOT process the combo.
   */
  Mousetrap.setCustomStopCallback = function(element, callback) {
    customStopCallbacks.set(element, callback);
  };

  module.exports = Mousetrap;
}
