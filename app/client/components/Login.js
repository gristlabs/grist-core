/* global window */


// External dependencies
const Promise               = require('bluebird');
const ko                    = require('knockout');

// Grist client libs
const dispose               = require('../lib/dispose');
const ProfileForm           = require('./ProfileForm');

/**
 * Login - Handles dom and settings for the login box.
 * @param {app} app - The app instance.
 */
function Login(app) {
  this.app = app;
  this.comm = this.app.comm;

  // When logged in, an object containing user profile properties.
  this._profile = ko.observable();
  this.isLoggedIn = ko.observable(false);
  this.emailObs = this.autoDispose(ko.computed(() => ((this._profile() && this._profile().email) || '')));
  this.nameObs = this.autoDispose(ko.computed(() => ((this._profile() && this._profile().name) || '')));
  this.buttonText = this.autoDispose(ko.computed(() =>
    this.isLoggedIn() ? this.emailObs() : 'Log in'));

  // Instantialized with createLoginForm() and createProfileForm()
  this.profileForm = null;
}
dispose.makeDisposable(Login);

/**
 * Returns the current profile object.
 */
Login.prototype.getProfile = function() {
  return this._profile();
};

/**
 * Opens the Cognito login form in a new browser window to allow the user to log in.
 * The login tokens are sent back to the server to which this client belongs.
 */
Login.prototype.login = function() {
  if (window.isRunningUnderElectron) {
    // Under electron, we open the login URL (it opens in a user's default browser).
    // With null for redirectUrl, it will close automatically when login completes.
    return this.comm.getLoginUrl(null)
    .then((loginUrl) => window.open(loginUrl));
  } else {
    // In hosted / dev version, we redirect to the login URL, and it will redirect back to the
    // starting URL when login completes.
    return this.comm.getLoginUrl(window.location.href)
    .then((loginUrl) => { window.location.href = loginUrl; });
  }
};

/**
 * Tells the server to log out, and also opens a new window to the logout URL to get Cognito to
 * clear its cookies. The new window will hit our page which will close the window automatically.
 */
Login.prototype.logout = function() {
  // We both log out the server, and for hosted version, visit a logout URL to clear AWS cookies.
  if (window.isRunningUnderElectron) {
    // Under electron, only clear the server state. Don't open the user's default browser
    // to clear cookies there because it serves dubious purpose and is annoying to the user.
    return this.comm.logout(null);
  } else {
    // In hosted / dev version, we redirect to the logout URL, which will clear cookies and
    // redirect back to the starting URL when logout completes.
    return this.comm.logout(window.location.href)
    .then((logoutUrl) => { window.location.href = logoutUrl; });
  }
};

/**
 * Retrieves the updated user profile from DynamoDB and creates the profile form.
 * Also sends the fetched user profile to the server to keep it up to date.
 */
Login.prototype.createProfileForm = function() {
  // ProfileForm disposes itself, no need to handle disposal.
  this.profileForm = ProfileForm.create(this);
};

// Called when the user logs out in this or another tab.
Login.prototype.onLogout = function() {
  this._profile(null);
  this.isLoggedIn(false);
};

/**
 * Update the internally-stored profile given a profile object from the server.
 */
Login.prototype.updateProfileFromServer = function(profileObj) {
  this._profile(profileObj);
  this.isLoggedIn(Boolean(this._profile.peek()));
};

Login.prototype.setProfileItem = function(key, val) {
  return this.comm.updateProfile({[key]: val});
};

/**
 * Returns an array of tableIds in the basket of the current document. If the current
 *  document has no basket, an empty array is returned.
 */
Login.prototype.getBasketTables = function(docComm) {
  return docComm.getBasketTables();
};

// Execute func if the user is logged in. Otherwise, prompt the user to log in
//  and then execute the function. Attempts refresh if the token is expired.
Login.prototype.tryWithLogin = function(func) {
  return Promise.try(() => {
    if (!this.isLoggedIn()) {
      return this.login();
    }
  })
  .then(() => func())
  .catch(err => {
    if (err.code === 'LoginClosedError') {
      console.log("Login#tryWithLogin", err);
    } else {
      throw err;
    }
  });
};

module.exports = Login;
