/* global $, document, window */

var _ = require('underscore');
var ko = require('knockout');
var BackboneEvents = require('backbone').Events;
var dom = require('../lib/dom');
var kd = require('../lib/koDom');
var Base = require('./Base');

/**
 * ModalDialog constructor creates a new ModalDialog element. The dialog accepts a bunch of
 * options, and the content can be overridde when calling .show(), so that a single ModalDialog
 * component can be used for different purposes. It triggers a 'close' event (using
 * Backbone.Events) when hidden.
 *
 * The DOM of the dialog is always attached to document.body.
 *
 * @param {Boolean} [options.fade]      Include `fade` css class to fade the modal in/out.
 * @param {Boolean} [options.close]     Include a close icon in the corner (default true).
 * @param {Boolean} [options.backdrop]  Include a modal-backdrop element (default true).
 * @param {Boolean} [options.keyboard]  Close the modal on Escape key (default true).
 * @param {Boolean} [options.show]      Shows the modal when initialized (default true).
 * @param {CSS String} [options.width]  Optional css width to override default.
 * @param {DOM|String} [options.title]  The content to place in the title.
 * @param {DOM|String} [options.body]   The content to place in the body.
 * @param {DOM|String} [options.footer] The content to place in the footer.
 */
function ModalDialog(options) {
  Base.call(this, options);
  options = options || {};
  this.options = _.defaults(options, {
    fade:     false,        // Controls whether the model pops or fades into view
    close:    true,        // Determines whether the "x" dismiss icon appears in the modal
    backdrop: true,
    keyboard: true,
    show:     false,
  });

  // If the width option is set, the margins must be set to auto to keep the dialog centered.
  this.style = options.width ?
    `width: ${this.options.width}; margin-left: auto; margin-right: auto;` : '';
  this.title = ko.observable(options.title || null);
  this.body = ko.observable(options.body || null);
  this.footer = ko.observable(options.footer || null);

  this.modal = this.autoDispose(this._buildDom());
  document.body.appendChild(this.modal);
  $(this.modal).modal(_.pick(this.options, 'backdrop', 'keyboard', 'show'));

  // On applyState event, close the modal.
  this.onEvent(window, 'applyState', () => this.hide());

  // If disposed, let the underlying JQuery Modal run its hiding logic, and trigger 'close' event.
  this.autoDisposeCallback(this.hide);
}
Base.setBaseFor(ModalDialog);
_.extend(ModalDialog.prototype, BackboneEvents);

/**
 * Shows the ModalDialog. It accepts the same `title`, `body`, and `footer` options as the
 * constructor, which will replace previous content of those sections.
 */
ModalDialog.prototype.show = function(options) {
  options = options || {};
  // Allow options to specify new title, body, and footer content.
  ['title', 'body', 'footer'].forEach(function(prop) {
    if (options.hasOwnProperty(prop)) {
      this[prop](options[prop]);
    }
  }, this);

  $(this.modal).modal('show');
};

/**
 * Hides the ModalDialog. This triggers the `close` to be triggered using Backbone.Events.
 */
ModalDialog.prototype.hide = function() {
  $(this.modal).modal('hide');
};

/**
 * Internal helper to build the DOM of the dialog.
 */
ModalDialog.prototype._buildDom = function() {
  var self = this;
  // The .clipboard_focus class tells Clipboard.js to let this component have focus. Otherwise
  // it's impossible to select text.
  return dom('div.modal.clipboard_focus',
    { "role": "dialog", "tabIndex": -1 },

    // Emit a 'close' Backbone.Event whenever the dialog is hidden.
    dom.on('hidden.bs.modal', function() {
      self.trigger('close');
    }),

    dom('div.modal-dialog', { style: this.style },
      dom('div.modal-content',
        kd.toggleClass('fade', self.options.fade),

        kd.maybe(this.title, function(title) {
          return dom('div.modal-header',
            kd.maybe(self.options.close, function () {
              return dom('button.close',
                {"data-dismiss": "modal", "aria-label": "Close"},
                dom('span', {"aria-hidden": true}, '×')
              );
            }),
            dom('h4.modal-title', title)
          );
        }),

        kd.maybe(this.body, function(body) {
          return dom('div.modal-body', body);
        }),

        kd.maybe(this.footer, function(footer) {
          return dom('div.modal-footer', footer);
        })
      )
    )
  );
};

module.exports = ModalDialog;
