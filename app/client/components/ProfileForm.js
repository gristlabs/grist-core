/* global document */

// External dependencies
const _                     = require('underscore');
const ko                    = require('knockout');
const BackboneEvents        = require('backbone').Events;

// Grist client libs
const dispose               = require('../lib/dispose');
const dom                   = require('../lib/dom');
const kf                    = require('../lib/koForm');
const kd                    = require('../lib/koDom');
const ModalDialog           = require('./ModalDialog');

/**
 * ProfileForm - Handles dom and settings for the profile box.
 * @param {Login} login - The login instance.
 */
function ProfileForm(login) {
  this._login = login;
  this._comm = this._login.comm;
  this._gristLogin = this._login.gristLogin;
  this._errorNotify = ko.observable();
  this._successNotify = ko.observable();

  // Form data which may be filled in when modifying profile information.
  this._newName = ko.observable('');

  // Counter used to provide each edit profile sub-form with an id which indicates
  // when it is visible.
  this._formId = 1;
  this._editingId = ko.observable(null);

  this._profileDialog = this.autoDispose(ModalDialog.create({
    title: 'User profile',
    body: this._buildProfileDom(),
    width: '420px'
  }));
  this._profileDialog.show();

  // TODO: Some indication is necessary that verification is occurring between
  //  submitting the form and waiting for the box to close.
  this.listenTo(this._comm, 'clientLogout', () => this.dispose());
  this.listenTo(this._profileDialog, 'close', () => this.dispose());
}
_.extend(ProfileForm.prototype, BackboneEvents);
dispose.makeDisposable(ProfileForm);

/**
 * Builds the body of the profile modal form.
 */
ProfileForm.prototype._buildProfileDom = function() {
  return dom('div.profile-form',
    // Email
    // TODO: Allow changing email
    this._buildProfileRow('Email', {
      buildDisplayFunc: () => dom('div',
        kd.text(this._login.emailObs),
        dom.testId('ProfileForm_viewEmail')
      )
    }),
    // Name
    this._buildProfileRow('Name', {
      buildDisplayFunc: () => dom('div',
        kd.text(this._login.nameObs),
        dom.testId('ProfileForm_viewName')
      ),
      buildEditFunc: () => dom('div',
        kf.label('New name'),
        kf.text(this._newName, {}, dom.testId('ProfileForm_newName'))
      ),
      submitFunc: () => this._submitNameChange()
    }),
    // TODO: Allow editing profile image.
    kd.maybe(this._successNotify, success => {
      return dom('div.login-success-notify',
        dom('div.login-success-text', success)
      );
    }),
    kd.maybe(this._errorNotify, err => {
      return dom('div.login-error-notify',
        dom('div.login-error-text', err)
      );
    })
  );
};

/**
 * Builds a row of the profile form.
 * @param {String} label - Indicates the profile item displayed by the row.
 * @param {Function} options.buildDisplayFunc - A function which returns dom representing
 *  the value of the profile item to be displayed. If omitted, no value is visible.
 * @param {Function} options.buildEditFunc - A function which returns dom to change the
 *  value of the profile item. If omitted, the profile item may not be edited.
 * @param {Function} options.submitFunc - A function to call to save changes to the
 *  profile item. MUST be included if buildEditFunc is included.
 */
ProfileForm.prototype._buildProfileRow = function(label, options) {
  options = options || {};
  let formId = this._formId++;

  return dom('div.profile-row',
    kf.row(
      2, kf.label(label),
      5, options.buildDisplayFunc ? options.buildDisplayFunc() : '',
      1, dom('div.btn.edit-profile.glyphicon.glyphicon-pencil',
        { style: `visibility: ${options.buildEditFunc ? 'visible' : 'hidden'}` },
        dom.testId(`ProfileForm_edit${label}`),
        dom.on('click', () => {
          this._editingId(this._editingId() === formId ? null : formId);
        })
      )
    ),
    kd.maybe(() => this._editingId() === formId, () => {
      return dom('div',
        dom.on('keydown', e => {
          if (e.keyCode === 13) {
            // Current element is likely a knockout text field with changes that haven't yet been
            // saved to the observable. Blur the current element to ensure its value is saved.
            document.activeElement.blur();
            options.submitFunc();
          }
        }),
        dom('div.edit-profile-form',
          options.buildEditFunc(),
          dom('div.login-btns.flexhbox',
            kf.buttonGroup(
              kf.button(() => this._editingId(null), 'Cancel',
                dom.testId('ProfileForm_cancel'))
            ),
            kf.buttonGroup(
              kf.accentButton(() => options.submitFunc(), 'Submit',
                dom.testId('ProfileForm_submit'))
            )
          )
        )
      );
    })
  );
};

// Submits the profile name change form.
ProfileForm.prototype._submitNameChange = function() {
  if (!this._newName()) {
    throw new Error('Name may not be blank.');
  }
  return this._login.setProfileItem('name', this._newName())
  // TODO: attemptRefreshToken() should be handled in a general way for all methods
  // which require using tokens after sign in.
  .then(() => {
    this._editingId(null);
    this._successNotify('Successfully changed name.');
  })
  .catch(err => {
    console.error('Error changing name', err);
    this._errorNotify(err.message);
  });
};

module.exports = ProfileForm;
