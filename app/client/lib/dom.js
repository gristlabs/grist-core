// Builds a DOM tree or document fragment, easily.
//
// Usage:
//  dom('a#link.c1.c2', {href:url}, 'Hello ', dom('span', 'world'));
//      creates Node <a id="link" class="c1 c2" href={{url}}>Hello <span>world</span></a>.
//  dom.frag(dom('span', 'Hello'), ['blah', dom('div', 'world')])
//      creates document fragment with <span>Hello</span>blah<div>world</div>.
//
// Arrays among child arguments get flattened. Objects are turned into attributes.
//
// If an argument is a function it will be called with elem as the argument,
// which may be a convenient way to modify elements, set styles, or attach events.



var ko = require('knockout');

/**
 * Use the browser globals in a way that allows replacing them with mocks in tests.
 */
var G = require('./browserGlobals').get('document', 'Node', '$', 'window');

/**
 * dom('tag#id.class1.class2' | Node, other args)
 *  The first argument is typically a string consisting of a tag name, with optional #foo suffix
 *  to add the ID 'foo', and zero or more .bar suffixes to add a css class 'bar'. If the first
 *  argument is a Node, that node is used for subsequent changes without creating a new one.
 *
 *  The rest of the arguments are optional and may be:
 *
 *    Nodes - which become children of the created element;
 *    strings - which become text node children;
 *    objects - of the form {attr: val} to set additional attributes on the element;
 *    Arrays of Nodes - which are flattened out and become children of the created element;
 *    functions - which are called with elem as the argument, for a chance to modify the
 *        element as it's being created. When functions return values (other than undefined),
 *        these return values get applied to the containing element recursively.
 */
function dom(firstArg, ...args) {
  let elem;
  if (firstArg instanceof G.Node) {
    elem = firstArg;
  } else {
    elem = createElemFromString(firstArg, createDOMElement);
  }

  return handleChildren(elem, arguments, 1);
}

/**
 * dom.svg('tag#id.class1.class2', other args) behaves much like `dom`, but does not accept Node
 * as a first argument--only a tag string. Because SVG elements are created in a different
 * namespace, `dom.svg` should be used for creating SVG elements such as `polygon`.
 */
dom.svg = function (firstArg, ...args) {
  let elem = createElemFromString(firstArg, createSVGElement);
  return handleChildren(elem, arguments, 1);
};

/**
 * Given a tag string of the form 'tag#id.class1.class2' and an element creator function, returns
 * a new tag element with the id and classes properly set.
 */
function createElemFromString(tagString, elemCreator) {
  // We do careful hand-written parsing rather than use a regexp for speed. Using a regexp is
  // significantly more expensive.
  let tag, id, classes;
  let dotPos = tagString.indexOf(".");
  let hashPos = tagString.indexOf('#');
  if (dotPos === -1) {
    dotPos = tagString.length;
  } else {
    classes = tagString.substring(dotPos + 1).replace(/\./g, ' ');
  }
  if (hashPos === -1) {
    tag = tagString.substring(0, dotPos);
  } else if (hashPos > dotPos) {
    throw new Error('ID must come before classes in dom("' + tagString + '")');
  } else {
    tag = tagString.substring(0, hashPos);
    id = tagString.substring(hashPos + 1, dotPos);
  }

  let elem = elemCreator(tag);
  if (id)      { elem.setAttribute('id',    id); }
  if (classes) { elem.setAttribute('class', classes); }

  return elem;
}

function createDOMElement(tagName) {
  return G.document.createElement(tagName);
}

function createSVGElement(tagName) {
  return G.document.createElementNS('http://www.w3.org/2000/svg', tagName);
}

// Append the rest of the arguments as children, flattening arrays
function handleChildren(elem, children, index) {
  for (var i = index, len = children.length; i < len; i++) {
    var child = children[i];
    if (Array.isArray(child)) {
      child = handleChildren(elem, child, 0);
    } else if (typeof child == 'function') {
      child = child(elem);
      if (typeof child !== 'undefined') {
        handleChildren(elem, [child], 0);
      }
    } else if (child === null || child === void 0) {
      // nothing
    } else if (child instanceof G.Node) {
      elem.appendChild(child);
    } else if (typeof child === 'object') {
      for (var key in child) {
        elem.setAttribute(key, child[key]);
      }
    } else {
      elem.appendChild(G.document.createTextNode(child));
    }
  }
  return elem;
}

/**
 * Creates a DocumentFragment consisting of all arguments, flattening any arguments that are
 * arrays. If any arguments or array elements are strings, those are turned into text nodes.
 * All argument types supported by the dom() function are supported by dom.frag() as well.
 */
dom.frag = function(varArgNodes) {
  var elem = G.document.createDocumentFragment();
  return handleChildren(elem, arguments, 0);
};


/**
 * Forward all or some arguments to the dom() call. E.g.
 *
 *    dom(a, b, c, dom.fwdArgs(arguments, 2));
 *
 *      is equivalent to:
 *
 *    dom(a, b, c, arguments[2], arguments[3], arguments[4], ...)
 *
 * It is very convenient to use in other functions which want to accept arbitrary arguments for
 * dom() and forward them. See koForm.js for many examples.
 *
 *  @param {Array|Arguments} args: Array or Arguments object containing arguments to forward.
 *  @param {Number} startIndex: The index of the first element to forward.
 */
dom.fwdArgs = function(args, startIndex) {
  return function(elem) {
    handleChildren(elem, args, startIndex);
  };
};


/**
 * Wraps the given function to make it easy to use as an argument to dom(). The passed-in function
 * must take a DOM Node as the first argument, and the returned wrapped function may be called
 * without this argument when used as an argument to dom(), in which case the original function
 * will be called with the element being constructed.
 *
 * For example, if we define:
 *    foo.method = dom.inlinable(function(elem, a, b) { ... });
 * then the call
 *    dom('div', foo.method(1, 2))
 * translates to
 *    dom('div', function(elem) { foo.method(elem, 1, 2); })
 * which causes foo.method(elem, 1, 2) to be called with elem set to the DIV being constructed.
 *
 * When the first argument is a DOM Node, calls to the wrapped function proceed as usual. In both
 * cases, `this` context is passed along to the wrapped function as expected.
 */
dom.inlinable = dom.inlineable = function inlinable(func) {
  return function(optElem) {
    if (optElem instanceof G.Node) {
      return func.apply(this, arguments);
    } else {
      return wrapInlinable(func, this, arguments);
    }
  };
};

function wrapInlinable(func, context, args) {
  // The switch is an optimization which speeds things up substantially.
  switch (args.length) {
    case 0: return function(elem) { return func.call(context, elem); };
    case 1: return function(elem) { return func.call(context, elem, args[0]); };
    case 2: return function(elem) { return func.call(context, elem, args[0], args[1]); };
    case 3: return function(elem) { return func.call(context, elem, args[0], args[1], args[2]); };
  }
  return function(elem) {
    Array.prototype.unshift.call(args, elem);
    return func.apply(context, args);
  };
}


/**
 * Shortcut for document.getElementById.
 */
dom.id = function(id) {
  return G.document.getElementById(id);
};

/**
 * Hides the given element. Can be passed into dom(), e.g. dom('div', dom.hide, ...).
 */
dom.hide = function(elem) {
  elem.style.display = 'none';
};

/**
 * Shows the given element, assuming that it's not hidden by a class.
 */
dom.show = function(elem) {
  elem.style.display = '';
};

/**
 * Toggles the given element, assuming that it's not hidden by a class. The second argument is
 * optional, and if provided will make toggle() behave as either show() or hide().
 * @returns {Boolean} Whether the element is visible after toggle.
 */
dom.toggle = function(elem, optYesNo) {
  if (optYesNo === undefined)
    optYesNo = (elem.style.display === 'none');
  elem.style.display = optYesNo ? '' : 'none';
  return elem.style.display !== 'none';
};


/**
 * Set the given className on the element while it is being dragged over.
 * Can be used inlined as in `dom(..., dom.dragOverClass('foo'))`.
 * @param {String} className: Class name to set while a drag-over is in progress.
 */
dom.dragOverClass = dom.inlinable(function(elem, className) {
  // Note: This is hard to get correct on both FF and Chrome because of dragenter/dragleave events that
  // occur for contained elements. See
  // http://stackoverflow.com/questions/7110353/html5-dragleave-fired-when-hovering-a-child-element.
  // Here we use a reference count, and filter out duplicate dragenter events on the same target.
  let counter = 0;
  let lastTarget = null;

  dom.on(elem, 'dragenter', ev => {
    if (Array.from(ev.originalEvent.dataTransfer.types).includes('text/html')) {
      // This would not be present when dragging in an actual file. We return undefined, to avoid
      // suppressing normal behavior (which is suppressed below when we return false).
      return;
    }
    if (ev.target !== lastTarget) {
      lastTarget = ev.target;
      ev.originalEvent.dataTransfer.dropEffect = 'copy';
      if (!counter) { elem.classList.add(className); }
      counter++;
    }
    return false;
  });

  dom.on(elem, 'dragleave', () => {
    lastTarget = null;
    counter = Math.max(0, counter - 1);
    if (!counter) { elem.classList.remove(className); }
  });

  dom.on(elem, 'drop', () => {
    lastTarget = null;
    counter = 0;
    elem.classList.remove(className);
  });
});


/**
 * Change a Node's childNodes similarly to Array splice. This allows removing and adding nodes.
 * It translates to calls to replaceChild, insertBefore, removeChild, and appendChild, as
 * appropriate.
 * @param {Number} index Index at which to start changing the array.
 * @param {Number} howMany Number of old array elements to remove or replace.
 * @param {Node} optNewChildren This is an optional parameter specifying a new node to insert,
 *    and may be repeated to insert multiple nodes. Null values are ignored.
 * @returns {Array[Node]} array of removed nodes.
 * TODO: this desperately needs a unittest.
 */
dom.splice = function(node, index, howMany, optNewChildren) {
  var end = Math.min(index + howMany, node.childNodes.length);
  for (var i = 3; i < arguments.length; i++) {
    if (arguments[i] !== null) {
      if (index < end) {
        node.replaceChild(arguments[i], node.childNodes[index]);
        index++;
      } else if (index < node.childNodes.length) {
        node.insertBefore(arguments[i], node.childNodes[index]);
      } else {
        node.appendChild(arguments[i]);
      }
    }
  }
  var ret = Array.prototype.slice.call(node.childNodes, index, end);
  while (end > index) {
    node.removeChild(node.childNodes[--end]);
  }
  return ret;
};

/**
 * Returns the index of the given node among its parent's children (i.e. its siblings).
 */
dom.childIndex = function(node) {
  return Array.prototype.indexOf.call(node.parentNode.childNodes, node);
};


function makeFilterFunc(selectorOrFunc) {
  if (typeof selectorOrFunc === 'string') {
    return function(elem) { return elem.matches && elem.matches(selectorOrFunc); };
  }
  return selectorOrFunc;
}

/**
 * Iterates backwards through the children of `parent`, returning the first one matching the given
 * selector or filter function. Returns null if no matching node is found.
 */
dom.findLastChild = function(parent, selectorOrFunc) {
  var filterFunc = makeFilterFunc(selectorOrFunc);
  for (var c = parent.lastChild; c; c = c.previousSibling) {
    if (filterFunc(c)) {
      return c;
    }
  }
  return null;
};


/**
 * Iterates up the DOM tree from `child` to `container`, returning the first Node matching the
 * given selector or filter function. Returns null for no match.
 * If `container` is given, the returned node will be non-null only if contained in it.
 * If `container` is omitted, the search will go all the way up.
 */
dom.findAncestor = function(child, optContainer, selectorOrFunc) {
  if (arguments.length === 2) {
    selectorOrFunc = optContainer;
    optContainer = null;
  }
  var filterFunc = makeFilterFunc(selectorOrFunc);
  var match = null;
  while (child) {
    if (!match && filterFunc(child)) {
      match = child;
      if (!optContainer) {
        return match;
      }
    }
    if (child === optContainer) {
      return match;
    }
    child = child.parentNode;
  }
  return null;
};


/**
 * Detaches a Node from its parent, and returns the Node passed in.
 */
dom.detachNode = function(node) {
  if (node.parentNode) {
    node.parentNode.removeChild(node);
  }
  return node;
};


/**
 * Use JQuery to attach an event handler to the given element. For documentation, see
 * http://api.jquery.com/on/. You may use this inline while building dom, as:
 *    dom(..., dom.on(events, args...))
 * E.g.
 *    dom('div',
 *      dom.on('click', function(ev) {
 *        console.log(ev);
 *      })
 *    );
 */
dom.on = dom.inlinable(function(elem, events, optSelector, optData, handler) {
  G.$(elem).on(events, optSelector, optData, handler);
});

dom.once = dom.inlinable(function(elem, events, optSelector, optData, handler) {
  G.$(elem).one(events, optSelector, optData, handler);
});

/**
 * Helper to do some processing on a DOM element after the current call stack has cleared. E.g.
 *    dom('input',
 *      dom.defer(function(elem) {
 *        elem.focus();
 *      })
 *    );
 * will cause elem.focus() to be called for the INPUT element after a setTimeout of 0.
 *
 * This is often useful for dealing with focusing and selection.
 */
dom.defer = function(func, optContext) {
  return function(elem) {
    setTimeout(func.bind(optContext, elem), 0);
  };
};


/**
 * Call the given function with the given context when the element is cleaned up using
 * ko.removeNode or ko.cleanNode. This may be used inline as an argument to dom(), without the
 * first argument, to apply to the element being constructed. The function called will receive the
 * element as the sole argument.
 * @param {Node} elem Element whose destruction should trigger a call to func. It
 *    should be omitted when used as an argument to dom().
 * @param {Function} func Function to call, with elem as an argument, when elem is cleaned up.
 * @param {Object} optContext Optionally `this` context to call the function with.
 */
dom.onDispose = dom.inlinable(function(elem, func, optContext) {
  ko.utils.domNodeDisposal.addDisposeCallback(elem, func.bind(optContext));
});


/**
 * Tie the disposal of the given value to the given element, so that value.dispose() gets called
 * when the element is cleaned up using ko.removeNode or ko.cleanNode. This may be used inline as
 * an argument to dom(), without the first argument, to apply to the element being constructed.
 * @param {Node} elem Element whose destruction should trigger the disposal of the value. It
 *    should be omitted when used as an argument to dom().
 * @param {Object} disposableValue A value with a dispose() method, such as a computed observable.
 */
dom.autoDispose = dom.inlinable(function(elem, disposableValue) {
  ko.utils.domNodeDisposal.addDisposeCallback(elem, function() {
    disposableValue.dispose();
  });
});


/**
 * Set an identifier for the given element for identifying the element in automated browser tests.
 * @param {String} ident: Arbitrary string; convention is to name it as "ModuleName.nameInModule".
 */
dom.testId = dom.inlinable(function(elem, ident) {
  elem.setAttribute('data-test-id', ident);
});

module.exports = dom;
