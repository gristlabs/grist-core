/**
 * This is webdriverjq, modified to in fact no longer
 * use jquery, but rather to work in conjunction with
 * mocha-webdriver. Works in conjunction with
 * gristUtils-nbrowser.
 *
 * Not everything webdriverjq could do is supported,
 * just enough to make porting tests easier. The
 * promise manager mechanism selenium used to have
 * that old tests depends upon is gone (and good
 * riddance).
 *   https://github.com/SeleniumHQ/selenium/blob/trunk/javascript/node/selenium-webdriver/CHANGES.md#api-changes-2
 *
 * Changes are minimized here, no modernization unless
 * strictly needed, so diff with webdriverjq.js is
 * easier to read.
 */

var _ = require('underscore');
var util = require('util');

import { driver, error, stackWrapFunc,
         WebElement, WebElementPromise } from 'mocha-webdriver';

export const driverCompanion = {
  $: null,
};

export function webdriverjqWrapper(driver) {

  /**
   * Returns a new WebdriverJQ instance.
   */
  function $(selector) {
    return new WebdriverJQ($, selector);
  }

  $.driver = driver;

  $.getPage = function(url) {
    return $.driver.get(url);
  };

  return $;
}

/**
 * The object obtained by $(...) calls. It supports nearly all the JQuery and WebElement methods,
 * and allows chaining whenever it makes sense.
 * @param {JQ} $: The $ object used to create this instance.
 * @param {String|WebElement} selector: A string selector, or a WebElement (or promise for one).
 */
function WebdriverJQ($, selector) {
  this.$ = $;
  this.driver = $.driver;
  this.selector = selector;
  this._selectorDesc = selector;
  this._callChain = [];
}

/**
 * $(...).method(...) invokes the corresponding method on the client side. Methods may be chained.
 * In reality, method calls aren't performed until the first non-chainable call. For example,
 * $(".foo").parent().toggleClass("active").text() is translated to a single call.
 *
 * Note that a few methods are overridden later: click() and submit() are performed on the server
 * as WebDriver actions instead of on the client.
 *
 * The methods listed below are all the methods from http://api.jquery.com/.
 */
var JQueryMethodNames = [
  "add", "addBack", "addClass", "after", "ajaxComplete", "ajaxError", "ajaxSend", "ajaxStart",
  "ajaxStop", "ajaxSuccess", "andSelf", "animate", "append", "appendTo", "attr", "before", "bind",
  "blur", "change", "children", "clearQueue", "click", "clone", "closest", "contents",
  "contextmenu", "css", "data", "dblclick", "delay", "delegate", "dequeue", "detach", "die",
  "each", "empty", "end", "eq", "error", "fadeIn", "fadeOut", "fadeTo", "fadeToggle", "filter",
  "find", "finish", "first", "focus", "focusin", "focusout", "get", "has", "hasClass", "height",
  "hide", "hover", "html", "index", "innerHeight", "innerWidth", "insertAfter", "insertBefore",
  "is", "keydown", "keypress", "keyup", "last", "live", "load", "load", "map", "mousedown",
  "mouseenter", "mouseleave", "mousemove", "mouseout", "mouseover", "mouseup", "next", "nextAll",
  "nextUntil", "not", "off", "offset", "offsetParent", "on", "one", "outerHeight", "outerWidth",
  "parent", "parents", "parentsUntil", "position", "prepend", "prependTo", "prev", "prevAll",
  "prevUntil", "promise", "prop", "pushStack", "queue", "ready", "remove", "removeAttr",
  "removeClass", "removeData", "removeProp", "replaceAll", "replaceWith", "resize", "scroll",
  "scrollLeft", "scrollTop", "select", "serialize", "serializeArray", "show", "siblings",
  "slice", "slideDown", "slideToggle", "slideUp", "stop", "submit", "text", "toArray", "toggle",
  "toggle", "toggleClass", "trigger", "triggerHandler", "unbind", "undelegate", "unload",
  "unwrap", "val", "width", "wrap", "wrapAll", "wrapInner",

  // Extra methods (defined below, injected into client, available to these tests only).
  "trimmedText", "classList", "subset", "filterExactText", "filterText", "getAttribute",

  "findOldTimey", // nbrowser: added
];

// Maps method name to an array of argument types. If called with matching types, this method does
// NOT return another JQuery object (i.e. it's not a chainable call).
var nonChainableMethods = {
  "attr": ["string"],
  "css": ["string"],
  "data": ["string"],
  "get": null,
  "hasClass": ["string"],
  "height": [],
  "html": [],
  "index": null,
  "innerHeight": [],
  "innerWidth": [],
  "is": null,
  "offset": [],
  "outerHeight": [],
  "outerWidth": [],
  "position": [],
  "prop": ["string"],
  "scrollLeft": [],
  "scrollTop": [],
  "serialize": null,
  "serializeArray": null,
  "text": [],
  "toArray": null,
  "val": [],
  "width": [],

  "trimmedText": null,
  "classList": null,
  "getAttribute": null,
};

function isNonChainable(methodName, args) {
  var argTypes = nonChainableMethods[methodName];
  return argTypes === null ||
    _.isEqual(argTypes, args.map(function(a) { return typeof a; }));
}

JQueryMethodNames.forEach(function(methodName) {
  WebdriverJQ.prototype[methodName] = function() {
    var args = Array.prototype.slice.call(arguments, 0);
    var methodCallInfo = [methodName].concat(args);
    var newObj = this.clone();
    newObj._callChain.push(methodCallInfo);
    if (isNonChainable(methodName, args)) {
      return newObj.resolve();
    } else {
      return newObj;
    }
  };
});

// .length property is a special case.
Object.defineProperty(WebdriverJQ.prototype, 'length', {
  configurable: false,
  enumerable: false,
  get: function() {
    var newObj = this.clone();
    newObj._callChain.push(['length']);
    return newObj.resolve();
  }
});


/**
 * WebdriverJQ objects also support various WebDriver.WebElement methods, namely the ones
 * below. These operate on the first of the selected elements. Those without a meaningful return
 * value may be chained. E.g. $(".foo").click().val() will trigger a click on the selected
 * element, then return its 'value' property.
 */
// This maps each supported method name to whether or not it should be chainable.
var WebElementMethodNames = {
  "getId":        false,
  "getRawId":     false,
  "click":        true,
  "sendKeys":     true,
  "getTagName":   false,
  "getCssValue":  false,
  "getText":      false,
  "getSize":      false,
  "getLocation":  false,
  "isEnabled":    false,
  "isSelected":   false,
  "submit":       true,
  "clear":        true,
  "isDisplayed":  false,
  "isPresent":    false,  // nbrowser: added
  "getOuterHtml": false,
  "getInnerHtml": false,
  "scrollIntoView": true,
  "sendNewText":  true,   // Added below.
};

Object.keys(WebElementMethodNames).forEach(function(methodName) {
  function runMethod(self, methodName, elem, ...argList) {
    var result = elem[methodName].apply(elem, argList)
    .then(function(value) {
      // Chrome makes some values unprintable by including a bogus .toString property.
      if (value && typeof value.toString !== 'function') { delete value.toString; }
      return value;
    }, function(err) {
      throw err;
    });
    return result;
  }
  const runThisMethod = stackWrapFunc(runMethod.bind(null, this, methodName));
  WebdriverJQ.prototype[methodName] = function() {
    const elem = this.elem();
    const result = runThisMethod(elem, ...arguments);
    if (WebElementMethodNames[methodName]) {
      // If chainable, create a new WebdriverJQ object (that waits for the result).
      return this._chain(() => elem, result);
    } else {
      // If not a chainable method, then we are done.
      return result;
    }
  };
});


/**
 * Helper for chaining. Creates a new WebdriverJQ instance from the current one for the given
 * element, but which resolves only when the given promise resolves.
 */
WebdriverJQ.prototype._chain = function(elemFn, optPromise) {
  const getElemAndUpdateDesc = () => {
    const elem = elemFn();
    // Let the chained object start with the previous object's description, but once we have
    // resolved the element, update it with the resolved element.
    chainable._selectorDesc = this._selectorDesc + " [pending]";
    elem.then(function(resolvedElem) {
      chainable._selectorDesc = resolvedElem.toString();
    }, function(err) {});
    return elem;
  };
  var chainable = new WebdriverJQ(this.$,
    optPromise ? optPromise.then(getElemAndUpdateDesc) : getElemAndUpdateDesc());

  return chainable;
};


/**
 * Return a friendly string representation of this WebdriverJQ instance.
 * E.g. $('.foo').next() will be represented as "$('.foo').next()".
 */
WebdriverJQ.prototype.toString = function() {
  var sel = this._selectorDesc;
  if (typeof sel === 'string') {
    sel = "'" + sel.replace(/'/g, "\\'")  + "'";
  } else {
    sel = sel.toString();
  }
  var desc = "$(" + sel + ")";
  desc += this._callChain.map(function(methodCallInfo) {
    var method = methodCallInfo[0], args = util.inspect(methodCallInfo.slice(1));
    return "." + method + "(" + args.slice(1, args.length - 1).trim() + ")";
  }).join("");
  return desc;
};


/**
 * Returns a copy of the WebdriverJQ object.
 */
WebdriverJQ.prototype.clone = function() {
  var newObj = new WebdriverJQ(this.$, this.selector);
  newObj._selectorDesc = this._selectorDesc;
  newObj._callChain = this._callChain.slice(0);
  return newObj;
};


/**
 * Convert the matched elements to an array and apply all further chained calls to each elemet of
 * the array separately, so that the result will be an array.
 *
 * E.g. $(".foo").array().text() will return an array of text for each of the elements matching
 * ".foo", and $(".foo").array().height() will return an array of heights (unlike
 * $(".foo").height() which would return the height of the first matching element).
 */
WebdriverJQ.prototype.array = function() {
  this._callChain.push(["array"]);
  return this;
};


/**
 * Make the call to the browser, returning a promise for the values (typically an array) returned
 * by the browser.
 */
WebdriverJQ.prototype.resolve = function() {
  var self = this;
  if (isPromise(this.selector)) {
    // Update our selector description once we know what it resolves to.
    this.selector.then(function(resolvedSelector) {
      self._selectorDesc = resolvedSelector.toString();
    }, function(err) {});

    if (this._callChain.length === 0) {
      // If the selector is a promise and there are no chained calls, there is no need to execute
      // anything, we just need for the promise to resolve.
      return this.selector.then(function(value) {
        return Array.isArray(value) ? value : [value];
      });
    }
  }

  return executeChain(this.selector, this._callChain);
};


/**
 * Make a call to the browser now, expecting a single element returned, and returning
 * WebElementPromise for that element. If no elements match, the promise will be rejected.
 */
WebdriverJQ.prototype.elem = function() {
  const doElem = stackWrapFunc(() => {
    var self = this;
    // TODO: we could limit results to a single value for efficiency.
    var result = this.resolve().then(function(elems) {
      if (!elems[0]) { throw new Error(self + " matched no element"); }
      return elems[0];
    });
    return result;
  });
  return new WebElementPromise(driver, doElem());
};


/**
 * Check if the element is considered stale by WebDriver. An element is considered stale once it
 * is removed from the DOM, or a new page has loaded.
 */
WebdriverJQ.prototype.isStale = function() {
  return this.getTagName().then(function() { return false; }, function(err) {
    if (err instanceof error.StaleElementReferenceError) {
      return true;
    }
    throw err;
  });
};

/**
 * Helper that allows a WebdriverJQ to act as a promise, but really just forwarding calls to
 * this.resolve().then(...)
 */
WebdriverJQ.prototype.then = function(success, failure) {
  // In selenium-webdriver 2.46, it was important not to call this.resolve().then(...) directly,
  // but to start a new promise chain, to avoid a deadlock in ControlFlow. In selenium-webdriver
  // 2.48, starting a new promise chain is wrong since the webdriver doesn't wait for the new
  // promise chain on errors, and fails without a chance to catch them.
  return this.resolve().then(success, failure);
};

// webdriver.promise.Thenable.addImplementation(WebdriverJQ);


/**
 * Wait for a condition, represented by func(elem) returning true. The function may use asserts to
 * indicate that the condition isn't met yet. E.g.
 *
 *    $(...).wait().click()   // Wait for a matching element to be present, then click it.
 *    $(...).wait(assert.isPresent).click()   // Equivalent to the previous line.
 *    $(...).wait(assert.isDisplayed)         // Wait for the matching element to be displayed.
 *    $(...).wait(assert.isDisplayed, false)  // Wait for the element to NOT be displayed.
 *    $(...).wait(assert.hasClass, 'foo')     // Wait for the element to have class 'foo'
 *    $(...).wait(assert.hasClass, 'foo', false)  // Wait for the element to NOT have class 'foo'
 *
 * @param [Number] optTimeoutMs: First numerical argument is interpreted as a timeout in seconds.
 *    Default is 10. You may pass in a longer timeout, but infinite wait isn't supported.
 * @param [Function] func: Optional condition function called as func(wjq, args...), where `wjq`
 *    is a WebdriverJQ instance. If a string is given, then `wjq[func](args...)` is called
 *    instead. If omitted, wait until the selector matches at least one element.
 *    The function must not return undefined, but may throw chai.AssertionError.
 * @param [Objects] args...: Optional additional arguments to pass to func.
 * @returns WebdriverJQ, which may be chained further.
 */
WebdriverJQ.prototype.waitCore = function(chained, optTimeoutSec, func, ...extraArgs) {
  var timeoutMs;
  if (typeof optTimeoutSec === 'number') {
    timeoutMs = optTimeoutSec * 1000;
    if (arguments.length === 2) { func = null; }
  } else {
    timeoutMs = 10000;
    extraArgs.unshift(func);
    func = (arguments.length === 1) ? null : optTimeoutSec;
  }
  if (_.isUndefined(func)) {
    var failed = Promise.reject(
      new Error("WebdriverJQ: wait called with undefined condition"));
    return this._chain(() => failed);
  }
  func = func || "isPresent";

  var self = this;
  async function conditionFunc() {
    const result = await (typeof func === 'string' ?
                          self[func].apply(self, extraArgs) :
                          func.apply(null, [self].concat(extraArgs)));
    return result === undefined ? true : result;
  }
  var waitPromise = waitImpl(timeoutMs, conditionFunc);
  return chained ? this._chain(() => this.resolve(), waitPromise) :
    waitPromise;
};

WebdriverJQ.prototype.wait = function(...args) {
  return this.waitCore(true, ...args);
}

WebdriverJQ.prototype.waitDrop = function(...args) {
  return this.waitCore(false, ...args);
}


/**
 * Send keyboard keys to the element as if typed by the user. This allows the use of arrays as
 * arguments to scope modifier keys. The method allows chaining.
 */
WebdriverJQ.prototype.sendKeys = function(varKeys) {
  var keys = processKeys(Array.prototype.slice.call(arguments, 0));
  var elem = this.elem();
  return this._chain(() => elem, elem.sendKeys.apply(elem, keys));
};

/**
 * Replaces the value in a text <input> by sending the keys to select all text, type
 * the given string, and hit Enter.
 */
WebdriverJQ.prototype.sendNewText = function(string) {
  return this.sendKeys(this.$.SELECT_ALL || driverCompanion.$.SELECT_ALL,
                       string,
                       this.$.ENTER || driverCompanion.$.ENTER);
};

/**
 * Transform the given array of keys to prepare for sending to the browser:
 * (1) If an argument is an array, its elements are grouped using webdriver.Key.chord()
 *     (in other words, modifier keys present in the array are released after the array).
 * (2) Transforms certain keys to work around a selenium bug where they don't get processed
 *     properly.
 */
function processKeys(keyArray) {
  return keyArray.map(function(arg) {
    if (Array.isArray(arg)) {
      arg = driver.Key.chord.apply(driver.Key, arg);
    }
    return arg;
  });
}

//----------------------------------------------------------------------
// Enhancements to webdriver's own objects.
//----------------------------------------------------------------------
WebElement.prototype.toString = function() {
  if (this._description) {
    return "<" + this._description + ">";
  } else {
    return "<WebElement>";
  }
};

//----------------------------------------------------------------------
// "Client"-side code.
//----------------------------------------------------------------------

// Run a command chain. Basically just find the initial element, and
// apply methods to it. We try to match quirks of old system, which
// are a bit hard to explain, and can't easily be matched exactly -
// but well enough to cover a lot of test code it seems (and the
// rest can just be rewritten).
async function executeChain(selector, callChain) {
  const cc = callChain.map(c => c[0]);
  let result = selector;
  if (typeof selector === 'string') {
    result = await findOldTimey(driver, selector,
                                cc.includes('array') ||
                                cc.includes('length') ||
                                cc.includes('toArray') ||
                                cc.includes('eq') ||
                                cc.includes('last'));
  }
  result = await applyCallChain(callChain, result);
  if (result instanceof WebElement) {
    result = [result];
  }
  return result;
}

async function applyCallChain(callChain, value) {
  value = await value;
  for (var i = 0; i < callChain.length; i++) {
    var method = callChain[i][0], args = callChain[i].slice(1).map(translateTestId);
    if (method === "toArray") {
      return Promise.all(value);
    } else if (method === "array") {
      return Promise.all(value.map(applyCallChain.bind(null, callChain.slice(i + 1))));
    } else if (method === "last") {
      return applyCallChain(callChain.slice(i + 1), value[value.length - 1]);
    } else if (method === "eq") {
      const idx = args[0];
      return applyCallChain(callChain.slice(i + 1), value[idx]);
    } else if (method === "length") {
      return value.length;
    } else {
      if (!value[method] && value[0]?.[method]) {
        value = value[0];
      }
      value = await value[method].apply(value, args);
    }
  }
  return value;
}

function translateTestId(selector) {
  return (typeof selector === 'string' ?
          selector.replace(/\$(\w+)/, '[data-test-id="$1"]', 'g') :
          selector);
}

export function findOldTimey(obj, key, multiple, multipleOptions) {
  key = translateTestId(key);
  const contains = key.split(':contains');
  if (contains.length === 2) {
    const content = contains[1].replace(/["'()]/g, '');
    return obj.findContent(contains[0], content);
  }
  if (multiple) {
    return obj.findAll(key, multipleOptions);
  }
  return obj.find(key);
}

// Similar to gu.waitToPass (copied to simplify import structure).
export async function waitImpl(timeoutMs, conditionFunc) {
  try {
    await driver.wait(async () => {
      try {
        return await conditionFunc();
      } catch (e) {
        return false;
      }
    }, timeoutMs);
  } catch (e) {
    await conditionFunc();
  }
}

function isPromise(obj) {
  if (typeof obj !== 'object') {
    return false;
  }
  if (typeof obj['then'] !== 'function') {
    return false;
  }
  return true;
}
