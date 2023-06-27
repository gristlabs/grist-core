var assert = require('chai').assert;
var Promise = require('bluebird');

var browserGlobals = require('app/client/lib/browserGlobals');

/**
 * Set up browserGlobals to jsdom-mocked DOM globals and an empty document. Call this within test
 * suites to set the temporary browserGlobals before the suite runs, and restore them afterwards.
 *
 * Note that his does nothing when running under the browser (i.e. native globals will be used).
 * For one, jsdom doesn't work (at least not right away); more importantly, we want to be able to
 * test actual browser behavior.
 */
function setTmpMochaGlobals() {
  if (typeof window !== 'undefined') {
    return;
  }

  const {JSDOM} = require('jsdom');

  var prevGlobals;

  before(function() {
    const dom = new JSDOM("<!doctype html><html></html>");

    // Include JQuery ($) as an available global. Surprising, but it works.
    const jquery = require('jquery');
    dom.window.$ = jquery(dom.window);

    prevGlobals = browserGlobals.setGlobals(dom.window);
  });

  after(function() {
    browserGlobals.setGlobals(prevGlobals);
  });
}
exports.setTmpMochaGlobals = setTmpMochaGlobals;

/**
 * Queries `el` for `selector` and resolves when `count` of found element is reached.
 *
 * @param {Element} el - DOM element to query
 * @param {string} selector - Selector to find
 * @param {number=} count - Optional count is the minimum number of elements to wait for. Defaults
 *    to 1.
 * @returns {Promise} - NodeList of found elements whose `length` is at least `count`.
 */
function waitForSelectorAll(el, selector, count) {
  assert(el.querySelectorAll, 'Must provide a DOMElement or HTMLElement');
  count = count || 1;
  var i;
  return new Promise(function(resolve, reject) {
      i = setInterval(function() {
        var q = el.querySelectorAll(selector);
        if (q.length >= count) {
          clearInterval(i);
          resolve(q);
        }
      }, 50);
    })
    .timeout(1000)
    .catch(function(err) {
      clearInterval(i);
      throw new Error("couldn't find selector: " + selector);
    });
}
exports.waitForSelectorAll = waitForSelectorAll;

/**
 * Queries `el` for `selector` and returns when at least one is found.
 *
 * @param {Element} el - DOM element to query
 * @param {string} selector - Selector to find
 * @returns {Promise} - Node of found element.
 */
function waitForSelector(el, selector) {
  return waitForSelectorAll(el, selector, 1)
    .then(function(els) {
      return els[0];
    });
}
exports.waitForSelector = waitForSelector;

/**
 * Queries `el` for `selector` and returns the last element in the NodeList.
 */
function querySelectorLast(el, selector) {
  var rows = el.querySelectorAll(selector);
  var last_row = rows && rows[rows.length - 1];
  return last_row;
}
exports.querySelectorLast = querySelectorLast;

var SERVER_TIMEOUT = 250; // How long to wait for pending requests to resolve
var CLIENT_DELAY = 100; // How long to wait for browser to render the action

function appCommWaiter(app) {
  return function(timeout, delay) {
    return Promise.resolve(app.comm.waitForActiveRequests())
      .timeout(timeout || SERVER_TIMEOUT)
      .delay(delay || CLIENT_DELAY);
  };
}
exports.appCommWaiter = appCommWaiter;

/*
 *
 * Takes and observable and returns a promise when the observable changes.
 * it then unsubscribes from the observable
 * @param {observable} observable - Selector to find
 * @returns {Promise} - Node of found element.
 */

function waitForChange(observable, delay) {
  var sub;
  return new Promise(function(resolve, reject) {
      sub = observable.subscribe(function(val) {
        console.warn('observable changed: ' + val.toString());
          resolve(val);
      });
    })
    .timeout(delay)
    .finally(function(){
      sub.dispose();
    });
}
exports.waitForChange = waitForChange;
