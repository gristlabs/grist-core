/**
 * koDom.js is an analog to Knockout.js bindings that works with our dom.js library.
 * koDom provides a suite of bindings between the DOM and knockout observables.
 *
 * For example, here's how we can create som DOM with some bindings, given a view-model object vm:
 *    dom(
 *      'div',
 *      kd.toggleClass('active', vm.isActive),
 *      kd.text(function() {
 *        return vm.data()[vm.selectedRow()][part.value.index()];
 *      })
 *    );
 */


/**
 * Use the browser globals in a way that allows replacing them with mocks in tests.
 */
var G = require('./browserGlobals').get('document', 'Node');

var ko = require('knockout');
var dom = require('./dom');
var koArray = require('./koArray');

/**
 * Creates a binding between a DOM element and an observable value, making sure that
 * updaterFunc(elem, value) is called whenever the observable changes. It also registers disposal
 * callbacks on the element so that the binding is cleared when the element is disposed with
 * ko.cleanNode() or ko.removeNode().
 *
 * @param {Node} elem: DOM element.
 * @param {Object} valueOrFunc: Either an observable, a function (to create ko.computed() with),
 *      or a constant value.
 * @param {Function} updaterFunc: Called both initially and whenever the value changes as
 *      updaterFunc(elem, value). The value is already unwrapped (so is not an observable).
 */
function setBinding(elem, valueOrFunc, updaterFunc) {
  var subscription;
  if (ko.isObservable(valueOrFunc)) {
    subscription = valueOrFunc.subscribe(function(v) { updaterFunc(elem, v); });
    ko.utils.domNodeDisposal.addDisposeCallback(elem, function() {
      subscription.dispose();
    });
    updaterFunc(elem, valueOrFunc.peek());
  } else if (typeof valueOrFunc === 'function') {
    valueOrFunc = ko.computed(valueOrFunc);
    subscription = valueOrFunc.subscribe(function(v) { updaterFunc(elem, v); });
    ko.utils.domNodeDisposal.addDisposeCallback(elem, function() {
      subscription.dispose();
      valueOrFunc.dispose();
    });
    updaterFunc(elem, valueOrFunc.peek());
  } else {
    updaterFunc(elem, valueOrFunc);
  }
}
exports.setBinding = setBinding;

/**
 * Internal helper to create a binding. Used by most simple bindings.
 * @param {Object} valueOrFunc: Either an observable, a function (to create ko.computed() with),
 *      or a constant value.
 * @param {Function} updaterFunc: Called both initially and whenever the value changes as
 *      updaterFunc(elem, value). The value is already unwrapped (so is not an observable).
 * @returns {Function} Function suitable to pass as an argument to dom(); i.e. one that takes an
 *      DOM element, and adds the bindings to it. It also registers disposal callbacks on the
 *      element, so that bindings are cleaned up when the element is disposed with ko.cleanNode()
 *      or ko.removeNode().
 */
function makeBinding(valueOrFunc, updaterFunc) {
  return function(elem) {
    setBinding(elem, valueOrFunc, updaterFunc);
  };
}
exports.makeBinding = makeBinding;

/**
 * Keeps the text content of a DOM element in sync with an observable value.
 * Just like knockout's `text` binding.
 * @param {Object} valueOrFunc An observable, a constant, or a function for a computed observable.
 */
function text(valueOrFunc) {
  return function(elem) {
    // Since setting textContent property of an element removes all its other children, we insert
    // a new text node, and change the content of that. However, we tie the binding to the parent
    // elem, i.e. make it disposed along with elem, because text nodes don't get cleaned by
    // ko.removeNode / ko.cleanNode.
    var textNode = G.document.createTextNode("");
    setBinding(elem, valueOrFunc, function(elem, value) {
      textNode.nodeValue = value;
    });

    elem.appendChild(textNode);
  };
}
exports.text = text;

// Used for replacing the static token span created by bootstrap tokenfield with the the same token
// but with its text content tied to an observable.
// To use bootstrapToken:
// 1) Get the token to make a clone of and the observable desired.
// 2) Create the new token by calling this function.
// 3) Replace the original token with this newly created token in the DOM by doing
// Ex:   var newToken = bootstrapToken(originalToken, observable);
//       parentElement.replaceChild(originalToken, newToken);
// TODO: Make templateToken optional. If not given, bind the observable to a manually created token.
function bootstrapToken(templateToken, valueOrFunc) {
  var clone = templateToken.cloneNode();
  setBinding(clone, valueOrFunc, function(e, value) {
    clone.textContent = value;
  });
  return clone;
}
exports.bootstrapToken = bootstrapToken;

/**
 * Keeps the attribute `attrName` of a DOM element in sync with an observable value.
 * Just like knockout's `attr` binding. Removes the attribute when the value is null or undefined.
 * @param {String} attrName The name of the attribute to bind, e.g. 'href'.
 * @param {Object} valueOrFunc An observable, a constant, or a function for a computed observable.
 */
function attr(attrName, valueOrFunc) {
  return makeBinding(valueOrFunc, function(elem, value) {
    if (value === null || value === undefined) {
      elem.removeAttribute(attrName);
    } else {
      elem.setAttribute(attrName, value);
    }
  });
}
exports.attr = attr;

/**
 * Sets or removes a boolean attribute of a DOM element. According to the spec, empty string is a
 * valid true value for the attribute, and the false value is indicated by the attribute's absence.
 * @param {String} attrName The name of the attribute to bind, e.g. 'href'.
 * @param {Object} valueOrFunc An observable, a constant, or a function for a computed observable.
 */
function boolAttr(attrName, valueOrFunc) {
  return makeBinding(valueOrFunc, function(elem, value) {
    if (!value) {
      elem.removeAttribute(attrName);
    } else {
      elem.setAttribute(attrName, '');
    }
  });
}
exports.boolAttr = boolAttr;

/**
 * Keeps the style property `property` of a DOM element in sync with an observable value.
 * Just like knockout's `style` binding.
 * @param {String} property The name of the style property to bind, e.g. 'fontWeight'.
 * @param {Object} valueOrFunc An observable, a constant, or a function for a computed observable.
 */
function style(property, valueOrFunc) {
  return makeBinding(valueOrFunc, function(elem, value) {
    // `style.setProperty` must be use to set custom property (ie: properties starting with '--').
    // However since it does not support camelCase property, we still need to use the other form
    // `elem.style[prop] = val;` for other properties.
    if (property.startsWith('--')) {
      elem.style.setProperty(property, value);
    } else {
      elem.style[property] = value;
    }
  });
}
exports.style = style;


/**
 * Shows or hides the element depending on a boolean value. Note that the element must be visible
 * initially (i.e. unsetting style.display should show it).
 * @param {Object} boolValueOrFunc An observable, a constant, or a function for a computed
 *      observable. The value is treated as a boolean.
 */
function show(boolValueOrFunc) {
  return makeBinding(boolValueOrFunc, function(elem, value) {
    elem.style.display = value ? '' : 'none';
  });
}
exports.show = show;

/**
 * The opposite of show, equivalent to show(function() { return !value(); }).
 * @param {Object} boolValueOrFunc An observable, a constant, or a function for a computed
 *      observable. The value is treated as a boolean.
 */
function hide(boolValueOrFunc) {
  return makeBinding(boolValueOrFunc, function(elem, value) {
    elem.style.display = value ? 'none' : '';
  });
}
exports.hide = hide;

/**
 * Associates some data with the DOM element, using ko.utils.domData.
 */
function domData(key, valueOrFunc) {
  return makeBinding(valueOrFunc, function(elem, value) {
    ko.utils.domData.set(elem, key, value);
  });
}
exports.domData = domData;

/**
 * Keeps the value of the given DOM form element in sync with an observable value.
 * Just like knockout's `value` binding, except that it is one-directional (for now).
 */
function value(valueOrFunc) {
  return makeBinding(valueOrFunc, function(elem, value) {
    // This conditional shouldn't be necessary, but on Electron 1.7,
    // setting unchanged value cause cursor to jump
    if (elem.value !== value) { elem.value = value; }
  });
}
exports.value = value;

/**
 * Toggles a css class `className` according to the truthiness of an observable value.
 * Similar to knockout's `css` binding with a static class.
 * @param {String} className The name of the class to toggle.
 * @param {Object} boolValueOrFunc An observable, a constant, or a function for a computed
 *      observable. The value is treated as a boolean.
 */
function toggleClass(className, boolValueOrFunc) {
  return makeBinding(boolValueOrFunc, function(elem, value) {
    elem.classList.toggle(className, !!value);
  });
}
exports.toggleClass = toggleClass;


/**
 * Toggles the `disabled` attribute on when boolValueOrFunc evaluates true. When
 * it evaluates false, the attribute is removed.
 * @param  {[type]} boolValueOrFunc boolValueOrFunc An observable, a constant, or a function for a computed
 *                                  observable. The value is treated as a boolean.
 */
function toggleDisabled(boolValueOrFunc) {
  return makeBinding(boolValueOrFunc, function(elem, disabled) {
    if (disabled) {
      elem.setAttribute('disabled', 'disabled');
    } else {
      elem.removeAttribute('disabled');
    }
  });
}
exports.toggleDisabled = toggleDisabled;

/**
 * Adds a css class (one or many) named by an observable value. If the value changes, the previous class will be
 * removed and the new one added. The value may be empty to avoid adding any class.
 * Similar to knockout's `css` binding with a dynamic class.
 * @param {Object} valueOrFunc An observable, a constant, or a function for a computed observable.
 */
function cssClass(valueOrFunc) {
  var prevClass;
  return makeBinding(valueOrFunc, function(elem, value) {
    if (prevClass) {
      for(const name of prevClass.split(' ')) {
        elem.classList.remove(name);
      }
    }
    prevClass = value;
    if (value) {
      for (const name of value.split(' ')) {
        elem.classList.add(name);
      }
    }
  });
}
exports.cssClass = cssClass;

/**
 * Scrolls a child element into view. The value should be the index of the child element to
 * consider. This function supports scrolly, and is mainly useful for scrollable container
 * elements, with a `foreach` or a `scrolly` inside.
 * @param {Object} valueOrFunc An observable, a constant, or a function for a computed observable
 *    whose value is the index of the child element to keep scrolled into view.
 */
function scrollChildIntoView(valueOrFunc) {
  return makeBinding(valueOrFunc, doScrollChildIntoView);
}
// Key at which we will store the index to scroll for async scrolling.
const indexKey = Symbol();
function doScrollChildIntoView(elem, index, sync) {
  if (index === null) {
    return Promise.resolve();
  }
  const scrolly = ko.utils.domData.get(elem, "scrolly");
  if (scrolly) {
    if (sync) {
      scrolly.scrollRowIntoView(index);
      // Clear async index for scrolling.
      elem[indexKey] = null;
      return Promise.resolve();
    } else {
      // Delay this in case it's triggered while other changes are processed (e.g. splices).

      // Scrolling is asynchronous, so in case there is already
      // active scroll queued, we will change the target index.
      // For example:
      // doScrollChildIntoView(el, 10, false) # sets the index to 10 and queues a Promise1
      // doScrollChildIntoView(el, 20, false) # updates index to 20 and queues a Promise2
      // ....
      // Promise1 moves to 20, and clears the index.
      // Promise2 checks the index is null and just returns.
      elem[indexKey] = index;
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          try {
            // If scroll was cancelled (there was another call after, that finished
            // and cleared the index) return.
            if (elem[indexKey] === null) {
              resolve();
              return;
            }
            if (!scrolly.isDisposed()) {
              scrolly.scrollRowIntoView(elem[indexKey]);
            }
            resolve();
          } catch(err) {
            reject(err);
          } finally {
            // Clear the index, any subsequent async scrolls will be cancelled (on the if test above).
            elem[indexKey] = null;
          }
        }, 0);
      });
    }
  } else {
    const child = elem.children[index];
    if (child) {
      if (index === 0) {
        // Scroll the container all the way if showing the first child.
        elem.scrollTop = 0;
      }
      const childRect = child.getBoundingClientRect();
      const parentRect = elem.getBoundingClientRect();
      if (childRect.top < parentRect.top) {
        child.scrollIntoView(true);             // Align with top if scrolling up..
      } else if (childRect.bottom > parentRect.bottom) {
        child.scrollIntoView(false);              // ..bottom if scrolling down.
      }
    }
  }
  return Promise.resolve();
}
exports.scrollChildIntoView = scrollChildIntoView;
exports.doScrollChildIntoView = doScrollChildIntoView;


/**
 * Adds to a DOM element the content returned by `contentFunc` called with the value of the given
 * observable. The content may be a Node, an array of Nodes, text, null or undefined.
 * Similar to knockout's `with` binding.
 * @param {Object} valueOrFunc An observable, a constant, or a function for a computed observable.
 * @param {Function} contentFunc Called with the value of `valueOrFunc` whenever that value
 *    changes. The returned content will replace previous content among the children of the bound
 *    DOM element in the place where the scope() call was present among arguments to dom().
 */
function scope(valueOrFunc, contentFunc) {
  var marker, contentNodes = [];
  return makeBinding(valueOrFunc, function(elem, value) {
    // We keep a comment marker, so that we know where to insert the content, and numChildren, so
    // that we know how many children are part of that content.
    if (!marker) {
      marker = elem.appendChild(G.document.createComment(""));
    }

    // Create the new content before destroying the old, so that it is OK for the new content to
    // include the old (by reattaching inside the new content). If we did it after, the old
    // content would get destroyed before it gets moved. (Note that "destroyed" here means
    // clearing associated bindings and event handlers, so it's not easily visible.)
    var content = dom.frag(contentFunc(value));

    // Remove any children added last time, cleaning associated data.
    for (var i = 0; i < contentNodes.length; i++) {
      if (contentNodes[i].parentNode === elem) {
        ko.removeNode(contentNodes[i]);
      }
    }
    contentNodes.length = 0;
    var next = marker.nextSibling;
    elem.insertBefore(content, next);
    // Any number of children may have gotten added if content was a DocumentFragment.
    for (var n = marker.nextSibling; n !== next; n = n.nextSibling) {
      contentNodes.push(n);
    }
  });
}
exports.scope = scope;


/**
 * Conditionally adds to a DOM element the content returned by `contentFunc()` depending on the
 * boolean value of the given observable. The content may be a Node, an array of Nodes, text, null
 * or undefined.
 * Similar to knockout's `if` binding.
 * @param {Object} boolValueOrFunc An observable, a constant, or a function for a computed
 *    observable. The value is checked as a boolean, and passed to the content function.
 * @param {Function} contentFunc A function called with the value of `boolValueOrFunc` whenever
 *    the observable changes from false to true. The returned content is added to the bound DOM
 *    element in the place where the maybe() call was present among arguments to dom().
 */
function maybe(boolValueOrFunc, contentFunc) {
  return scope(boolValueOrFunc, function(yesNo) {
    return yesNo ? contentFunc(yesNo) : null;
  });
}
exports.maybe = maybe;


/**
 * Observes an observable array (koArray), and creates and adds as many children to the bound DOM
 * element as there are items in it. As the array is changed, children are added or removed. Also
 * works for a plain data array, creating a static list of children.
 *
 * Elements are typically added and removed by splicing data into or out of the data koArray. When
 * an item is removed, the corresponding node is removed using ko.removeNode (which also runs any
 * disposal tied to the node). If the caller retains a reference to a Node item, and removes it
 * from its parent, foreach will cope with it fine, but will not call ko.removeNode on that node
 * when the item from which it came is spliced out.
 *
 * @param {koArray} data An koArray instance.
 * @param {Function} itemCreateFunc A function called as `itemCreateFunc(item)` for each
 *    array element. Note: `index` is not passed to itemCreateFunc as it is only correct at the
 *    time the item is created, and does not reflect further changes to the array.
 */
function foreach(data, itemCreateFunc) {
  var marker;
  var children = [];
  return function(elem) {
    if (!marker) {
      marker = elem.appendChild(G.document.createComment(""));
    }
    var spliceFunc = function(splice) {
      var i, start = splice.start;

      // Remove the elements that are gone.
      var deletedElems = children.splice(start, splice.deleted.length);
      for (i = 0; i < deletedElems.length; i++) {
        // Some nodes may be null, or may have been removed elsewhere in the program. The latter
        // are no longer our responsibility, and we should not clean them up.
        if (deletedElems[i] && deletedElems[i].parentNode === elem) {
          ko.removeNode(deletedElems[i]);
        }
      }

      if (splice.added > 0) {
        // Create and insert new elements.
        var frag = G.document.createDocumentFragment();
        var spliceArgs = [start, 0];
        for (i = 0; i < splice.added; i++) {
          var itemModel = splice.array[start + i];
          var insertEl = itemCreateFunc(itemModel);
          if (insertEl) {
            ko.utils.domData.set(insertEl, "itemModel", itemModel);
            frag.appendChild(insertEl);
          }
          spliceArgs.push(insertEl);
        }

        // Add new elements to the children array we maintain.
        Array.prototype.splice.apply(children, spliceArgs);

        // Find a valid child immediately preceding the start of the splice, for DOM insertion.
        var baseElem = marker;
        for (i = start - 1; i >= 0; i--) {
          if (children[i] && children[i].parentNode === elem) {
            baseElem = children[i];
            break;
          }
        }
        elem.insertBefore(frag, baseElem.nextSibling);
      }
    };

    var array = data;
    if (koArray.isKoArray(data)) {
      var subscription = data.subscribe(spliceFunc, null, 'spliceChange');
      ko.utils.domNodeDisposal.addDisposeCallback(elem, function() {
        subscription.dispose();
      });

      array = data.all();
    } else if (!Array.isArray(data)) {
      throw new Error("koDom.foreach applied to non-array: " + data);
    }
    spliceFunc({ array: array, start: 0, added: array.length, deleted: [] });
  };
}
exports.foreach = foreach;
