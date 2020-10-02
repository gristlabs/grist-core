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
  var ko = require('knockout');

  // Minus is different on Gecko:
  // see https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/keyCode
  // and https://github.com/ccampbell/mousetrap/pull/215
  Mousetrap.addKeycodes({173: '-'});

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
    var cmdGroup = ko.utils.domData.get(element, 'mousetrapCommandGroup');
    if (cmdGroup) {
      return !cmdGroup.knownKeys.hasOwnProperty(combo);
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

  module.exports = Mousetrap;
}
