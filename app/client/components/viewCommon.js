/* global $ */

var koDom = require('../lib/koDom');

/**
 * This adds `.isFlex` option to JQuery's $.ui.resizable to make it work better with flexbox.
 * Specifically, when resizing to the left, JQuery adjusts both `width` and `left` properties. If
 * the element is part of a flexbox, it's wrong to adjust `left`. This widget adds `.isFlex`
 * option: when set to true, the `left` (also `top`) adjustments get ignored.
 */
var _respectSize = $.ui.resizable.prototype._respectSize;
$.ui.resizable.prototype._respectSize = function() {
  var data = _respectSize.apply(this, arguments);
  if (this.options.isFlex) {
    console.log("Ignoring left, top");
    data.left = data.top = undefined;
  }
  return data;
};

/**
 * When used as an argument to dom() function, makes the containing element resizable, with the
 * size written into the given observable. If the observable has a .save() method, it's called
 * by default when the resize is complete (to save the new size to the server).
 * @param {Object} options.enabled: An observable, a constant, or a function for a computed
 *      observable. The value is treated as a boolean, and determined whether resizable
 *      functionality is enabled.
 * @param {String} options.handles: Same as for jqueryui's `resizable`, e.g. 'e' to resize right
 *      edge (east), 'w' to resize left edge (west).
 * @param {Function} options.stop: Additional callback to call when resizing stops.
 * @param {Boolean} options.isFlex: If true, will avoid changing 'left' when resizing the left edge.
 * @param {Number} options.minWidth: The minimum width the element can be resized to.
 *      Defaults to 10 (JQuery default).
 * @param {Boolean} options.shouldSave: Whether .save() on `widthObservable` should be called.
 *      Defaults to true.
 */
function makeResizable(widthObservable, options) {
  options = options || {};
  function onEvent(e, ui) {
    widthObservable(ui.size.width);
    if (e.type === 'resizestop') {
      if (options.stop) {
        options.stop(e, ui);
      }
      if (widthObservable.save && options.shouldSave !== false) {
        widthObservable.save();
      }
    }
  }

  return function(elem) {
    $(elem).resizable({
      handles: options.handles || 'e',
      resize: onEvent,
      stop: onEvent,
      isFlex: options.isFlex,
      minWidth: options.minWidth || 10
    });

    if (options.hasOwnProperty('enabled')) {
      koDom.setBinding(elem, options.enabled, function(elem, value) {
        if (value) {
          $(elem).resizable('enable');
        } else {
          $(elem).resizable('disable').removeClass('ui-state-disabled');
        }
      });
    }
  };
}
exports.makeResizable = makeResizable;
