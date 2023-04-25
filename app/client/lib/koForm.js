/**
 * koForm provides a number of styled elements (buttons, checkbox, etc) that are tied to
 * observables to simplify and standardize the way we construct UI elements (e.g. forms).
 *
 * TODO: There is some divergence in class names that we use throughout Grist. For example,
 *    active vs mod-active and disabled vs mod-disabled. We should standardize.
 */

// Use the browser globals in a way that allows replacing them with mocks in tests.
var G = require('./browserGlobals').get('$', 'window', 'document');

const identity = require('lodash/identity');
const defaults = require('lodash/defaults');
const debounce = require('lodash/debounce');
const pick     = require('lodash/pick');
var ko      = require('knockout');
var Promise = require('bluebird');

var gutil = require('app/common/gutil');

var commands = require('../components/commands');

var dom      = require('./dom');
var kd       = require('./koDom');
var koArray  = require('./koArray');

var modelUtil = require('../models/modelUtil');

var setSaveValue = modelUtil.setSaveValue;


/**
 * Creates a button-looking div inside a buttonGroup; when clicked, clickFunc() will be called.
 * The button is not clickable if it contains the class 'disabled'.
 */
exports.button = function(clickFunc, ...moreContentArgs) {
  return dom('div.kf_button.flexitem',
    dom.on('click', function() {
      if (!this.classList.contains('disabled')) {
        clickFunc();
      }
    }),
    moreContentArgs
  );
};

/**
 * Creates a button with an accented appearance.
 * The button is not clickable if it contains the class 'disabled'.
 */
exports.accentButton = function(clickFunc, ...moreContentArgs) {
  return this.button(clickFunc,
    {'class': 'kf_button flexitem accent'},
    moreContentArgs
  );
};

/**
 * Creates a button with a minimal appearance for use in prompts.
 * The button is not clickable if it contains the class 'disabled'.
 */
exports.liteButton = function(clickFunc, ...moreContentArgs) {
  return this.button(clickFunc,
    {'class': 'kf_button flexitem lite'},
    moreContentArgs
  );
};

/**
 * Creates a bigger button with a logo, used for "sign in with google/github/etc" buttons.
 * The button is not clickable if it contains the class 'disabled'.
 */
exports.logoButton = function(clickFunc, logoUrl, text, ...moreContentArgs) {
  return this.button(clickFunc,
    {'class': 'kf_button kf_logo_button flexitem flexhbox'},
    dom('div.kf_btn_logo', { style: `background-image: url(${logoUrl})` }),
    dom('div.kf_btn_text', text),
    moreContentArgs
  );
};

/**
 * Creates a button group. Arguments should be `button` and `checkButton` objects.
 */
exports.buttonGroup = function(moreButtonArgs) {
  return dom('div.kf_button_group.kf_elem.flexhbox',
    dom.fwdArgs(arguments, 0));
};

/**
 * Creates a button group with an accented appearance.
 * Arguments should be `button` and `checkButton` objects.
 */
exports.accentButtonGroup = function(moreButtonArgs) {
  return this.buttonGroup(
    [{'class': 'kf_button_group kf_elem flexhbox accent'}].concat(dom.fwdArgs(arguments, 0))
  );
};

/**
 * Creates a button group with a minimal appearance.
 * Arguments should be `button` and `checkButton` objects.
 */
exports.liteButtonGroup = function(moreButtonArgs) {
  return this.buttonGroup(
    [{'class': 'kf_button_group kf_elem flexhbox lite'}].concat(dom.fwdArgs(arguments, 0))
  );
};

/**
 * Creates a button-looking div that acts as a checkbox, toggling `valueObservable` on click.
 */
exports.checkButton = function(valueObservable, moreContentArgs) {
  return dom('div.kf_button.kf_check_button.flexitem',
    kd.toggleClass('active', valueObservable),
    dom.on('click', function() {
      if (!this.classList.contains('disabled')) {
        setSaveValue(valueObservable, !valueObservable());
      }
    }),
    dom.fwdArgs(arguments, 1));
};

/**
 * Creates a button-looking div that acts as a checkbox, toggling `valueObservable` on click.
 * Very similar to `checkButton` but looks flat and does not need to be in a group.
 *
 * TODO: checkButton and flatCheckButton are identical in function but differ in style and
 *    class name conventions. We should reconcile them.
 */
exports.flatCheckButton = function(valueObservable, moreContentArgs) {
  return dom('div.flexnone',
    kd.toggleClass('mod-active', valueObservable),
    dom.on('click', function() {
      if (!this.classList.contains('mod-disabled')) {
        setSaveValue(valueObservable, !valueObservable());
      }
    }),
    dom.fwdArgs(arguments, 1));
};

/**
 * Creates a group of buttons of which only one may be chosen. Arguments should be `optionButton`
 * objects. The single `valueObservable` reflects the value of the selected `optionButton`.
 */
exports.buttonSelect = function(valueObservable, moreButtonArgs) {
  var groupElem = dom('div.kf_button_group.kf_elem.flexhbox', dom.fwdArgs(arguments, 1));

  // TODO: Is adding ":not(.disabled)" the best way to avoid execution?
  G.$(groupElem).on('click', '.kf_button:not(.disabled)', function() {
      setSaveValue(valueObservable, ko.utils.domData.get(this, 'kfOptionValue'));
  });

  kd.makeBinding(valueObservable, function(groupElem, value) {
    Array.prototype.forEach.call(groupElem.querySelectorAll('.kf_button'), function(elem, i) {
      var v = ko.utils.domData.get(elem, 'kfOptionValue');
      elem.classList.toggle('active', v === value);
    });
  })(groupElem);

  return groupElem;
};

/**
 * Creates a button-like div to use inside a `buttonSelect` group. The `value` will become the
 * value of the `buttonSelect` observable when this button is selected.
 */
exports.optionButton = function(value, moreContentArgs) {
  return dom('div.kf_button.flexitem',
    function(elem) { ko.utils.domData.set(elem, 'kfOptionValue', value); },
    dom.fwdArgs(arguments, 1));
};

/**
 * Creates a speech-bubble-like div intended to give more information and options affecting
 * its parent when hovered.
 */
exports.toolTip = function(contentArgs) {
  return dom('div.kf_tooltip',
    dom('div.kf_tooltip_pointer'),
    dom('div.kf_tooltip_content', dom.fwdArgs(arguments, 0)),
    dom.defer(function(elem) {
      var elemWidth = elem.getBoundingClientRect().width;
      var parentRect = elem.parentNode.getBoundingClientRect();
      elem.style.left = (-elemWidth/2 + parentRect.width/2) + 'px';
      elem.style.top = parentRect.height + 'px';
    })
  );
};

/**
 * Creates a prompt to provide feedback or request more information in the sidepane.
 */
exports.prompt = function(contentArgs) {
  return dom('div.kf_prompt',
    dom('div.kf_prompt_pointer'),
    dom('div.kf_prompt_pointer_overlap'),
    dom('div.kf_prompt_content', dom.fwdArgs(arguments, 0))
  );
};

/**
 * Checkbox which toggles `valueObservable`. Other arguments become part of the clickable label.
 */
exports.checkbox = function(valueObservable, moreContentArgs) {
  return dom('label.kf_checkbox_label.kf_elem',
    dom('input.kf_checkbox', {type: 'checkbox'},
      kd.makeBinding(valueObservable, function(elem, value) {
        elem.checked = value;
      }),
      dom.on('change', function() {
        setSaveValue(valueObservable, this.checked);
      })
    ),
    dom.fwdArgs(arguments, 1));
};


/**
 * Radio button for a particular value of the given observable. It is checked when the observable
 * matches the value, and selecting it sets the observable to the value. Other arguments become
 * part of the clickable label.
 */
exports.radio = function(value, valueObservable, ...domArgs) {
  return dom('label.kf_radio_label',
    dom('input.kf_radio', {type: 'radio'},
      kd.makeBinding(valueObservable, (elem, val) => { elem.checked = (val === value); }),
      dom.on('change', function() {
        if (this.checked) {
          setSaveValue(valueObservable, value);
        }
      })
    ),
    ...domArgs
  );
};

/**
 * Create and return DOM for a spinner widget.
 *  valueObservable: observable for the value, may have save interface.
 *      This value is not displayed by the created widget.
 *  getNewValue(value, dir): called with the current value and 1 or -1 direction,
 *      should return the new value for valueObservable.
 *  shouldDisable(value, dir): called with current value and 1 or -1 direction,
 *      should return whether the button in that direction should be enabled.
 */
function genSpinner(valueObservable, getNewValue, shouldDisable) {
  let timeout = null;
  let origValue = null;

  function startChange(elem, direction) {
    stopAutoRepeat();
    G.$(G.window).on('mouseup', onMouseUp);
    origValue = valueObservable.peek();
    doChange(direction, true);
  }

  function onMouseUp() {
    G.$(G.window).off('mouseup', onMouseUp);
    stopAutoRepeat();
    setSaveValue(valueObservable, valueObservable.peek(), origValue);
  }
  function doChange(direction, isFirst) {
    const newValue = getNewValue(valueObservable.peek(), direction);
    if (newValue !== valueObservable.peek()) {
      valueObservable(newValue);
      timeout = setTimeout(doChange, isFirst ? 600 : 100, direction, false);
    }
  }
  function stopAutoRepeat() {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  }

  return dom('div.kf_spinner',
    dom('div.kf_spinner_half', dom('div.kf_spinner_arrow.up'),
      kd.toggleClass('disabled', () => shouldDisable(valueObservable(), 1)),
      dom.on('mousedown', () => { startChange(this, 1); })
    ),
    dom('div.kf_spinner_half', dom('div.kf_spinner_arrow.down'),
      kd.toggleClass('disabled', () => shouldDisable(valueObservable(), -1)),
      dom.on('mousedown', () => { startChange(this, -1); })
    ),
    dom.on('dblclick', () => false)
  );
}

/**
 * Creates a spinner item linked to `valueObservable`.
 * @param {Number} optMin - Optional spinner lower bound
 * @param {Number} optMax - Optional spinner upper bound
 */
exports.spinner = function(valueObservable, stepSizeObservable, optMin, optMax) {
  var max = optMax !== undefined ? optMax : Infinity;
  var min = optMin !== undefined ? optMin : -Infinity;

  function getNewValue(value, direction) {
    const step = (ko.unwrap(stepSizeObservable) || 1) * direction;
    // Adding step quickly accumulates floating-point errors. We want to keep the value a multiple
    // of step, as well as only keep significant decimal digits. The latter is done by converting
    // to string and back using 15 digits of precision (max guaranteed to be significant).
    value = value || 0;
    value = Math.round(value / step) * step + step;
    value = parseFloat(value.toPrecision(15));
    return gutil.clamp(value, min, max);
  }
  function shouldDisable(value, direction) {
    return (direction > 0) ? (value >= max) : (value <= min);
  }
  return genSpinner(valueObservable, getNewValue, shouldDisable);
};

/**
 * Creates a select spinner item to loop through the `optionObservable` array,
 * setting visible value to `valueObservable`.
 */
exports.selectSpinner = function(valueObservable, optionObservable) {
  function getNewValue(value, direction) {
    const choices = optionObservable.peek();
    const index = choices.indexOf(value);
    const newIndex = gutil.mod(index + direction, choices.length);
    return choices[newIndex];
  }
  function shouldDisable(value, direction) {
    return optionObservable().length <= 1;
  }
  return genSpinner(valueObservable, getNewValue, shouldDisable);
};

/**
 * Creates an alignment selector linked to `valueObservable`.
 */
exports.alignmentSelector = function(valueObservable) {
  return this.buttonSelect(valueObservable,
    this.optionButton("left", dom('span.glyphicon.glyphicon-align-left'),
      dom.testId('koForm_alignLeft')),
    this.optionButton("center", dom('span.glyphicon.glyphicon-align-center'),
      dom.testId('koForm_alignCenter')),
    this.optionButton("right", dom('span.glyphicon.glyphicon-align-right'),
      dom.testId('koForm_alignRight'))
  );
};

/**
 * Label with a collapser triangle in front, which may be clicked to toggle `isCollapsedObs`
 * observable.
 */
exports.collapserLabel = function(isCollapsedObs, moreContentArgs) {
  return dom('div.kf_collapser.kf_elem',
    dom('span.kf_triangle_toggle',
      kd.text(function() {
        return isCollapsedObs() ? '\u25BA' : '\u25BC';
      })
    ),
    dom.on('click', function() {
      isCollapsedObs(!isCollapsedObs.peek());
    }),
    dom.fwdArgs(arguments, 1));
};

/**
 * Creates a collapsible section. The argument must be a function which takes a boolean observable
 * (isCollapsed) as input, and should return an array of elements. The first element is always
 * shown, while the rest will be toggled by `isCollapsed` observable. The isMountedCollapsed
 * parameter controls the initial state of the collapsible. When true or omitted, the collapsible
 * will be closed on load. Otherwise, the collapsible will initialize expanded/uncollapsed.
 *
 *    kf.collapsible(function(isCollapsed) {
 *      return [
 *        kf.collapserLabel(isCollapsed, 'Indents'),
 *        kf.row(...),
 *        kf.row(...)
 *      ];
 *    });
 *  Returns an array of two items: the always-shown element, and a div containing the rest.
 */
exports.collapsible = function(contentFunc, isMountedCollapsed) {
  var isCollapsed = ko.observable(isMountedCollapsed === undefined ? true : isMountedCollapsed);
  var content = contentFunc(isCollapsed);
  return [
    content[0],
    dom('div',
      kd.hide(isCollapsed),
      dom.fwdArgs(content, 1))
  ];
};


/**
 * Creates a draggable list of rows. The contentArray argument must be an observable array.
 * The callbackObj argument should include some or all of the following methods:
 * reorder, remove, and receive.
 * The reorder callback is executed if an item is dragged and dropped to a new position
 * within the same collection or draggable container. The remove and receive callbacks
 * are executed together only when an item from one collection is dropped on a different
 * collection. The remove callback may be executed alone when users click on the "minus" icon
 * for draggable items. The connectAllDraggables function must be called on draggables to
 * enable the remove/receive operation between separate draggables.
 *
 * Each callback must update the respective model tied to the draggable component,
 * or the equivalency between the UI and the observable array may be broken. When
 * a method is implemented, but the callback cannot update the model for any reason
 * (e.g., failure), then this failure should be communicated to the component either
 * by throwing an Error in the callback, or by returning a rejected Promise.
 *
 *
 *   reorder(item, nextItem)
 *     @param   {Object} item     The item being relocated/moved
 *     @param   {Object} nextItem The next item immediately following the new position,
 *                                or null, when the item is moved to the end of the collection.
 *   remove(item)
 *     @param   {Object} item     The item that should be removed from the collection.
 *     @returns {Object}          The item removed from the observable array. This
 *                                    value is passed to the receive function as the
 *                                    its item parameter. This value must include all the
 *                                    necessary data required for connected draggables
 *                                    to successfully insert the new value within their
 *                                    respective receive functions.
 *   receive(item, nextItem)
 *     @param   {Object} item      The item to insert in the collection.
 *     @param   {Object} nextItem  The next item from item's new position. This value
 *                                 will be null when item is moved to the end of the list.
 *
 * @param {Array}    contentArray         KoArray of model items
 * @param {Function} itemCreateFunc       Identical to koDom.foreach's itemCreateFunc, this
 *                                        function is called as `itemCreateFunc(item)` for each
 *                                        array element. Must return a single Node, or null or
 *                                        undefined to omit that node.
 * @param {Object}   options              An object containing the reorder, remove, receive
 *                                        callback functions, and all other draggable configuration
 *                                        options --
 * @param {Boolean}  options.removeButton Controls whether the clickable remove/minus icon is
 *                                        displayed. If true, this button triggers the remove
 *                                        function on click.
 * @param {String}   options.axis         Determines if the list is displayed vertically 'y' or
 *                                        horizontally 'x'.
 * @param {Boolean|Function} drag_indicator Include the drag indicator. Defaults to true. Accepts
 *                                          also a function that returns a dom element. In which
 *                                          case, it will be used to create the drag indicator.
 * @returns {Node} The DOM Node for the draggable container
 */
exports.draggableList = function(contentArray, itemCreateFunc, options) {
  options = options || {};
  defaults(options, {
    removeButton: true,
    axis: "y",
    drag_indicator: true,
    itemClass: 'kf_draggable__item'
  });

  var reorderFunc, removeFunc;
  itemCreateFunc = itemCreateFunc || identity;
  var list = dom('div.kf_drag_container',
    function(elem) {
      if (options.reorder) {
        reorderFunc = Promise.method(options.reorder);
        ko.utils.domData.set(elem, 'reorderFunc', reorderFunc);
      }
      if (options.remove) {
        removeFunc = Promise.method(options.remove);
        ko.utils.domData.set(elem, 'removeFunc', removeFunc);
      }
      if (options.receive) {
        ko.utils.domData.set(elem, 'receiveFunc', Promise.method(options.receive));
      }
    },
    kd.foreach(contentArray, item => {
      var row = itemCreateFunc(item);
      if (row) {
        return dom('div.kf_draggable',
          // Fix for JQueryUI bug where mousedown on draggable elements fail to blur
          // active element. See: https://bugs.jqueryui.com/ticket/4261
          dom.on('mousedown', () => G.document.activeElement.blur()),
          kd.cssClass(options.itemClass),
          (options.drag_indicator ?
           (typeof options.drag_indicator === 'boolean' ?
            dom('span.kf_drag_indicator.glyphicon.glyphicon-option-vertical') :
            options.drag_indicator()
           ) : null),
          kd.style('display', options.axis === 'x' ? 'inline-block' : 'block'),
          kd.domData('model', item),
          kd.maybe(removeFunc !== undefined && options.removeButton, function() {
            return dom('span.drag_delete.glyphicon.glyphicon-remove',
              dom.on('click', function() {
                removeFunc(item)
                .catch(function(err) {
                  console.warn('Failed to remove item', err);
                });
              })
            );
          }),
          dom('span.kf_draggable_content.flexauto', row));
      } else {
        return null;
      }
    })
  );

  G.$(list).sortable({
    axis: options.axis,
    tolerance: "pointer",
    forcePlaceholderSize: true,
    placeholder: 'kf_draggable__placeholder--' + (options.axis === 'x' ? 'horizontal' : 'vertical')
  });
  if (reorderFunc === undefined) {
    G.$(list).sortable("option", {disabled: true});
  }

  G.$(list).on('sortstart', function(e, ui) {
    ko.utils.domData.set(ui.item[0], 'originalParent', ui.item.parent());
    ko.utils.domData.set(ui.item[0], 'originalPrev', ui.item.prev());
  });
  G.$(list).on('sortstop', function(e, ui) {
    if (!ko.utils.domData.get(ui.item[0], 'crossedContainers')) {
      handleReorderStop.bind(null, list).call(this, e, ui);
    } else {
      handleConnectedStop.call(list, e, ui);
    }
  });

  return list;
};

function handleReorderStop(container, e, ui) {
  var reorderFunc = ko.utils.domData.get(container, 'reorderFunc');
  var originalPrev = ko.utils.domData.get(ui.item[0], 'originalPrev');
  if (reorderFunc && !ui.item.prev().is(originalPrev)) {
    var movingItem = ko.utils.domData.get(ui.item[0], 'model');
    reorderFunc(movingItem, getNextDraggableItemModel(ui.item))
    .catch(function(err) {
      console.warn('Failed to reorder item', err);
      G.$(container).sortable('cancel');
    });
  }
  resetDraggedItem(ui.item[0]);
}


function handleConnectedStop(e, ui) {
  var originalParent = ko.utils.domData.get(ui.item[0], 'originalParent');
  var removeOriginal = ko.utils.domData.get(originalParent[0], 'removeFunc');
  var receive = ko.utils.domData.get(ui.item.parent()[0], 'receiveFunc');

  if (removeOriginal && receive) {
    removeOriginal(ko.utils.domData.get(ui.item[0], 'model'))
    .then(function(removedItem) {
      return receive(removedItem, getNextDraggableItemModel(ui.item))
      .then(function() {
        ui.item.remove();
      })
      .catch(revertRemovedItem.bind(null, ui, originalParent, removedItem));
    })
    .catch(function(err) {
      console.warn('Error removing item', err);
      G.$(originalParent).sortable('cancel');
    })
    .finally(function() {
      resetDraggedItem(ui.item[0]);
    });
  } else {
    console.warn('Missing remove or receive');
  }
}

function revertRemovedItem(ui, parent, item, err) {
  console.warn('Error receiving item. Trying to return removed item.', err);
  var originalReceiveFunc = ko.utils.domData.get(parent[0], 'receiveFunc');
  if (originalReceiveFunc) {
    var originalPrev = ko.utils.domData.get(ui.item[0], 'originalPrev');
    var originalNextItem = originalPrev.length > 0 ?
      getNextDraggableItemModel(originalPrev) :
      getDraggableItemModel(parent.children('.kf_draggable').first());
    originalReceiveFunc(item, originalNextItem)
    .catch(function(err) {
      console.warn('Failed to receive item in original collection.', err);
    }).finally(function() {
      ui.item.remove();
    });
  }
}

function getDraggableItemModel(elem) {
  if (elem.length && elem.length > 0) {
    return ko.utils.domData.get(elem[0], 'model');
  }
  return null;
}

function getNextDraggableItemModel(elem) {
  return elem.next ? getDraggableItemModel(elem.next('.kf_draggable')) : null;
}

function resetDraggedItem(elem) {
  ko.utils.domData.set(elem, 'originalPrev', null);
  ko.utils.domData.set(elem, 'originalParent', null);
  ko.utils.domData.set(elem, 'crossedContainers', false);
}

function enableDraggableConnection(draggable) {
  G.$(draggable).on('sortremove', function(e, ui) {
    ko.utils.domData.set(ui.item[0], 'crossedContainers', true);
    ko.utils.domData.set(ui.item[0], 'stopIndex', ui.item.index());
  });

  if (G.$(draggable).sortable("option", "disabled") && (
      ko.utils.domData.get(draggable, 'receiveFunc') ||
      ko.utils.domData.get(draggable, 'removeFunc')
      )) {
    G.$(draggable).sortable( "option", { disabled: false });
  }
}

function connectDraggableToClass(draggable, className) {
  enableDraggableConnection(draggable);
  G.$(draggable).addClass(className);
  G.$(draggable).sortable("option", {connectWith: "." + className});
}

/**
 * Connects 2 or more draggableList components together. This connection allows any of the
 * draggable components to drag & drop items into and out of any other connected draggable.
 * @param  {Object} draggableArgs 2 or more draggableList objects
 */
var connectedDraggables = 0;
exports.connectAllDraggables = function(draggableArgs) {
  if (draggableArgs.length < 2) {
    console.warn('connectAllDraggables requires at least 2 draggable components');
  }
  var className = "connected-draggable-" + connectedDraggables++;
  for (var i=0; i<arguments.length; i++) {
    connectDraggableToClass(arguments[i], className);
  }
};

/**
 * Connects 1 draggable to another, without the inverse. Elements may be dragged from
 * the fromDraggable to the toDraggable, but not in the other direction.
 * @param  {Object} fromDraggable A source draggableList object
 * @param  {Object} toDraggable   A destination draggableList object
 */
exports.connectDraggableOneWay = function(fromDraggable, toDraggable) {
  fromDraggable.id  = "connected-draggable-" + connectedDraggables++;
  toDraggable.id    = "connected-draggable-" + connectedDraggables++;
  enableDraggableConnection(fromDraggable);
  enableDraggableConnection(toDraggable);
  G.$(fromDraggable).sortable("option", {connectWith: "#" + toDraggable.id});
};

/**
 * A bold label. Typically takes a string argument, but accepts any children.
 */
exports.label = function(moreContentArgs) {
  return dom('div.kf_label.kf_elem', dom.fwdArgs(arguments, 0));
};

/**
 * A regular (not bold) label. Typically takes a string argument, but accepts any children.
 */
exports.lightLabel = function(moreContentArgs) {
  return dom('div.kf_light_label.kf_elem', dom.fwdArgs(arguments, 0));
};


/**
 * Creates a set of tabs, with a look suitable for the middle of a pane. It takes no arguments,
 * and should be followed by `midTab()` calls under the same DOM element.
 * @param {Observable} optObservable The observable for the index of the selected tab, will be
 *    created if omitted.
 */
exports.midTabs = function(optObservable) {
  return _initTabs(optObservable, '.kf_mid_tab_label',
    dom('div.flexitem.kf_mid_tabs',
      dom('div.flexhbox.flexnone.kf_mid_tab_labels'),
      exports.scrollable()
    )
  );
};

/**
 * Adds a tab to the `midTabs` container created previously under the same DOM element. The
 * `label` is a label or Node for the tab label; the rest is the content of the tab.
 * The content is created once, but is hidden when a different tab is selected.
 */
exports.midTab = function(label, moreContentArgs) {
  return _addTab('.kf_mid_tabs',
    dom('div.kf_mid_tab_label.flexitem', label),
    dom('div.kf_mid_tab_content', dom.fwdArgs(arguments, 1)));
};


/**
 * A textbox for entering numbers, although the tied `valueObservable` is a string.
 * We may want to replace it with a widget with up-down arrows to change the values, and support
 * for units (such as px, in, %, etc).
 * @param {Object} options.placeholder  Placeholder text for the textbox
 * @param {Object} options.min  The minimum (numeric or date-time) value for the item, which must not be greater than its maximum (max attribute) value.
 * @param {Object} options.max The maximum (numeric or date-time) value for this item, which must not be less than its minimum (min attribute) value.
 */
exports.numText = function(valueObservable, options) {
  var attr = {type: 'number'};
  options = options || {};
  if (options.placeholder) attr.placeholder = options.placeholder;
  if (typeof options.min !== 'undefined') attr.min = options.min;
  if (typeof options.max !== 'undefined') attr.max = options.max;
  return dom('div.kf_elem', dom('input.kf_num_text', attr,
    kd.value(valueObservable),
    // while 'change' seems better suited, sometimes it does not fire when user click on the spinner
    // arrow before it moves the cursor away.
    dom.on('input', function() {
      setSaveValue(valueObservable, Number(this.value));
    })
  ));
};

/**
 * Helper function for textboxes tied to `valueObservable`.
 * @param {Number}    [options.maxSize]             The max length of the text, which
 *                                                  also affects the box size.
 * @param {String}    [options.placeholder]         Placeholder text for the textbox
 * @param {Function}  [options.disabled]            Plain boolean or observable
 *                                                  boolean value or Function returning
 *                                                  a Boolean that controls whether
 *                                                  the "disabled" attribute is true or false
 *                                                  for the input element.
 * @param {Number}    [option.delay]                Wait interval in milliseconds until user stops
 *                                                  typing before save its input. Using this options
 *                                                  allows user to not change focus for saving input.
 * @return  {Object}                                Constructed DOM
 */
function textInput(valueObservable, options, moreArgs) {
  var attr = {};
  if (options) {
    if (options.type) {
      attr.type = options.type;
    }
    if (options.maxSize) {
      attr.maxlength = options.maxSize;
      attr.style = 'max-width: ' + (options.maxSize + 2) + 'em';
    }
    if (options.placeholder) {
      attr.placeholder = options.placeholder;
    }
  }

  var saveValue = e => setSaveValue(valueObservable, e.target.value);
  var debounced = debounce(saveValue, options.delay);

  var setValue = elem => {
    if (options && options.delay) {
      dom(elem,
        dom.on('input', debounced),
        dom.on('change', e => {
          debounced(e);
          debounced.flush();
        }));
    } else {
      dom(elem, dom.on('change', saveValue));
    }
  };

  return dom('div.kf_elem',
    dom('input.kf_text',
      attr,
      kd.toggleDisabled(options.disabled || false),
      kd.value(valueObservable),
      setValue,
      dom.fwdArgs(arguments, 2))
  );
}


/**
 * A regular textbox tied to `valueObservable`.
 */
exports.text = function(valueObservable, options, ...moreArgs) {
  options = Object.assign({type: 'text'}, options || {});
  return textInput(valueObservable, options, moreArgs);
};

/**
 * A color picker tied to `valueObservable`.
 */
exports.color = function(valueObservable, ...moreArgs) {
  // On some machine (seen on chrome running on a Mac) the `change` event fires as many times as the `input` event, hence debounce.
  const saveValue = debounce(e => setSaveValue(valueObservable, e.target.value), 300);
  return dom('div.kf_elem',
    dom('input.kf_color',
      {type: 'color'},
      kd.value(valueObservable),
      dom.on('change', saveValue),
      ...moreArgs
    ));
};

/**
 * Identical to koForm.text, but with input type=password
 */
exports.password = function(valueObservable, options, ...moreArgs) {
  options = Object.assign({type: 'password'}, options || {});
  return textInput(valueObservable, options, moreArgs);
};

/**
 * A status panel which reflects 1 of 4 possible states based on the value of valueObservable.
 * Users provide a mapping between possible valueObservable values and the 4 possible states
 * of this status panel: `success`, `info`, `warning`, and `error`. The status panel
 * displays circle icon or indicator reflecting the state of valueObservable (success=green,
 * info=blue, warning=orange, error=red).
 *
 * Users may provide either a strings or an objects with "value" and "label" properties
 * for each of the state properties. Each of these strings (or object.value properties)
 * must represent a possible value of valueObservable.
 *
 * For example:
 *   statusPanel(
 *     ko.observable('OK'),
 *     {
 *       success: 'OK',
 *       info: {value: 'Unknown', label: 'Status unknown'}
 *     }
 *   )
 *
 * @param  {string}         valueObservable A knockout observable containing a string
 * @param  {string|Object}  options.success
 * @param  {string|Object}  options.info
 * @param  {string|Object}  options.warning
 * @param  {string|Object}  options.error
 * @param  {string}         options.heading When present, the heading string appears
 *                                          as a header within the panel above the
 *                                          status label (if any).
 * @return {Object}                         DOM
 */
exports.statusPanel = function(valueObservable, options) {
  var statusMap = {};
  ['success', 'info', 'warning', 'error'].forEach(function(key) {
    var statusLookupValue;
    if (options[key]) {
      statusLookupValue = options[key].value !== undefined ? options[key].value : options[key];
      statusMap[statusLookupValue] = {};
      statusMap[statusLookupValue].className = 'kf_status_' + key;
      statusMap[statusLookupValue].label = options[key].label || null;
    }
  });
  var hasLabel = ko.pureComputed(function() {
    return statusMap[valueObservable()].label !== undefined;
  });
  return dom('div.kf_status_panel.flexhbox',
    dom.autoDispose(hasLabel),
    dom('div.kf_status_indicator.flexauto',
      kd.cssClass(function() {
        if (statusMap[valueObservable()]) {
          return statusMap[valueObservable()].className;
        }
        console.error('Status must match an available status code', Object.keys(statusMap));
      }),
      '\u25CF' // solid circle
    ),
    dom('div.kf_status_detail.flexauto',
      kd.maybe(options.heading, function() {
        return exports.row(exports.label(options.heading));
      }),
      kd.maybe(hasLabel, function() {
        return exports.row(exports.lightLabel(
          kd.text(ko.pureComputed(function() {
            return statusMap[valueObservable()].label;
          }))
        ));
      })
    )
  );
};

/**
 * A label which can have editing turned on and off
 * When clicked a input area is created on top of the text.
 * The Enter key or a blur event calls save() on the observable.
 * The input area is removed if the user presses Esc without triggering any change.
 * @param {Observable} valueObservable - If the observable has a save interface it will be used to
 *   save changes.  see modelUtil.addSaveInterface
 * @param {Observable} optToggleObservable - If another observable is provided, it will be used to
 *   toggle whether or not the field is editable. It will also prevent clicks from affecting whether
 *   the label is editable.
 */
exports.editableLabel = function(valueObservable, optToggleObservable) {
  var isEditing = optToggleObservable || ko.observable(false);
  var cancelEdit = false;

  var editingCommands = {
    cancel: function() {
      cancelEdit = true;
      isEditing(false);
    },
    accept: function() {
      cancelEdit = false;
      isEditing(false);
    }
  };

  var contentSizer;
  return dom('div.kf_editable_label',
    dom('div.kf_elabel_text',
      kd.text(valueObservable),
      kd.hide(isEditing)
    ),
    contentSizer = dom('div.elabel_content_measure'),
    (!optToggleObservable ? dom.on('click', () => isEditing(true)) : null),
    kd.maybe(isEditing, function() {
      var commandGroup = commands.createGroup(editingCommands, this, true);
      return dom('input.kf_elabel_input', {type: 'text'},
        elem => dom.hide(elem), // Don't display until we've had a chance to resize
        kd.value(valueObservable),
        dom.autoDispose(commandGroup),
        commandGroup.attach(),
        dom.on('blur', function() { isEditing(false); }),
        dom.on('change', function() { isEditing(false); }),
        dom.on('input', function() {
          // Resize the textbox whenever user types in it.
          _resizeElem(this, contentSizer);
        }),
        dom.onDispose(elem => {
          if (!cancelEdit && valueObservable() !== elem.value) {
            setSaveValue(valueObservable, elem.value);
          }
        }),
        dom.defer(function(elem) {
          cancelEdit = false;
          _resizeElem(elem, contentSizer);
          dom.show(elem); // Once resized, display the input
          elem.focus();
          elem.select();
        })
      );
    })
  );
};

function _resizeElem(elem, contentSizer) {
  contentSizer.textContent = elem.value;
  var rect = contentSizer.getBoundingClientRect();
  elem.style.width = Math.ceil(rect.width) + 'px';
}

/**
 * Accepts any number of children. If an argument is numeric, it specifies the number of columns
 * the next child should occupy (defaults to 1). All columns are equally spaced.
 */
exports.row = function(childOrColSpanArgs) {
  var colSpan = 1;
  var elem = dom('div.kf_row.flexhbox');
  for (var i = 0; i < arguments.length; i++) {
    var arg = arguments[i];
    if (typeof arg === 'number') {
      colSpan = arg;
    } else if (typeof arg === 'function') {
      arg(elem);
    } else if (typeof arg !== 'undefined') {
      if (typeof arg === 'string' || Array.isArray(arg)) {
        arg = dom('div', arg);
      }
      arg.style.flex = arg.style.webkitFlex = colSpan + " 1 0px";
      elem.appendChild(arg);
      colSpan = 1;
    }
  }
  return elem;
};

/**
 * Creates a row of help labels. Takes the same arguments as `row()`, but the content is typically
 * short descriptive strings. Use it immediately after a `row()` call, with same column-span
 * values, to place descriptions under the elements of the row.
 */
exports.helpRow = function(childOrColSpan) {
  var elem = exports.row.apply(null, arguments);
  elem.classList.add('kf_help_row');
  return elem;
};

/**
 * Creates a scrollable pane, with a shadow over the top edge.
 */
exports.scrollable = function(contentArgs) {
  var elem, shadow;
  return [
    dom('div.flexnone.kf_scroll_shadow_outer',
      shadow = dom('div.kf_scroll_shadow', dom.hide)
    ),
    elem = dom('div.flexitem.kf_scrollable',
      dom.on('scroll', function() {
        shadow.style.display = (elem.scrollTop > 0 ? '' : 'none');
      }),
      dom.fwdArgs(arguments, 0)
    )
  ];
};

/**
 * Creates a select (or dropdown) widget. The `valueObservable` reflects the value of the selected
 * option, `optionArray` is an array (regular or observable) of option values and labels.
 * may be either strings (used for both values and labels) or objects with "value", "label", and
 * "disabled" properties.
 *
 * @param {observable} valueObservable - An observable whose value will be set to the value of the
 *    corresponding option from `optionArray` when the selection changes, or an array of sorted
 *    values if `options.multiple` is enabled. A string representation of the value is also made
 *    accessible as in the <option>'s value attribute, and is what would be submitted if, for
 *    example, the element is used in a submitted form.
 * @param {Array<string|Object>} optionArray - Array of options as strings or objects. If string,
 *    the same value will be used for key (i.e. value) and label. If object, its properties will be
 *    used to populate `value`, `label`, and `disabled`. A koArray may be used.
 * @property {Any} value - Value of the option that, when selected, will be set as the value of
 *    valueObservable (or included into an array of selected values with `multiple: true`).
 *    The string representation of this value will also be set on the `<option>` DOM, but
 *    valueObservable will receive the raw JavaScript value. This should not mutate.
 * @property {string|observable} label - Visible label for the option. Can be an observable.
 * @property {boolean|observable} disabled - Optional disabled flag. Can be an observable.
 *
 * @param {Object} options
 * @property {Number}  [options.size]       The number of rows in the select list that
 * @property {Boolean} [options.disabled]   Whether the select control is disabled.
 * @property {Boolean} [options.multiple]   Whether the select control supports multiple selection.
 *    If true, `valueObservable` should be an array of values.
 */
exports.select = function(valueObservable, optionArray, options) {
  // Wrap the returned element into a div, since otherwise it doesn't respect
  // dimensions as well.
  options = options || {};
  // Sets elem.value to value. Useful for setting the displayed multiselect value.
  var setValue = (elem, value) => {
    let valuesSet = new Set(options.multiple ? value : [value]);
    for (let option of elem.querySelectorAll('option')) {
      option.selected = valuesSet.has(ko.utils.domData.get(option, 'value'));
    }
  };
  return dom('div.kf_elem',
    dom('div.kf_select_arrow',
      dom('select.kf_select',
        pick(options, ['size', 'multiple']),
        kd.toggleDisabled(options.disabled || false),
        kd.foreach(optionArray, function(option) {
          if (!option) {
            return null;
          }

          let value = (typeof option === 'string' ? option : option.value);
          let label = (typeof option === 'string' ? option : option.label);
          let disabled = (typeof option === 'string' ? false : option.disabled);

          return dom(
            'option',
            { value }, // To keep older browser tests from breaking, store stringified value in DOM
            kd.domData('value', value),
            kd.toggleDisabled(disabled),
            kd.text(label)
          );
        }),
        // If the optionArray changes, the selected option may become different than the
        // option displayed. This is fixed by re-setting elem.value on optionArray changes.
        kd.makeBinding(koArray.isKoArray(optionArray) ? optionArray.getObservable() : optionArray,
          elem => setValue(elem, valueObservable())),
        kd.makeBinding(valueObservable, (elem, value) => setValue(elem, value)),
        dom.on('change', function() {
          let valuesArray = [];
          let optionElements = this.querySelectorAll('option');
          for (let i = 0; i < optionElements.length; i++) {
            if (optionElements[i].selected) {
              let value = ko.utils.domData.get(optionElements[i], 'value');
              valuesArray.push(value);
              if (!options.multiple) { break; }
            }
          }
          valuesArray.sort();
          setSaveValue(valueObservable, options.multiple ? valuesArray : valuesArray[0]);
        })
      )
    )
  );
};

/**
 * A separator (thin horizontal line).
 */
exports.separator = function() {
  return dom('hr.kf_separator');
};

/**
 * Creates a set of tabs for the top of a pane. It takes no arguments, and should be followed by
 * `topTab()` calls under the same DOM element.
 * @param {Observable} optObservable The observable for the index of the selected tab, will be
 *    created if omitted.
 */
exports.topTabs = function(optObservable) {
  return _initTabs(optObservable, '.kf_top_tab_label',
    dom('div.flexvbox.kf_top_tabs',
      dom('div.flexhbox.flexnone.kf_top_tab_labels'),
      dom('div.flexitem.kf_top_tab_container')
    )
  );
};

/**
 * Adds a tab to the `topTabs` container created previously under the same DOM element. The
 * `label` is a label or Node for the tab label; the rest is the content of the tab.
 * The content is created once, but is hidden when a different tab is selected.
 */
exports.topTab = function(label, moreContentArgs) {
  return _addTab('.kf_top_tabs',
    dom('div.kf_top_tab_label.flexitem', label),
    dom('div.kf_top_tab_content.flexvbox', dom.fwdArgs(arguments, 1)));
};

/**
 * Helper function for creating a set of tabs.
 * @param {Observable} optObservable The observable for the index of the selected tab, will be
 *    created if omitted.
 * @param {String} labelSelector The selector (e.g. ".className") for the tab label elements that
 *    will be given to _addTab.
 * @param {Node} elem The tabs container element. Its first child must be the container for the
 *    labels, and its last child, the container for the content panes.
 */
function _initTabs(optObservable, labelSelector, elem) {
  var selectedTab = optObservable || ko.observable(0);
  G.$(elem).on('click', labelSelector, function() {
    selectedTab(dom.childIndex(this));
  });
  ko.utils.domData.set(elem, 'kfSelectedTab', selectedTab);
  return elem;
}

/**
 * Helper function for adding a tab to a set of tabs created with _initTabs.
 * @param {String} tabsSelector The selector of the tabs container that was given to _initTab.
 *    It's needed to find that element.
 * @param {Node} labelElem The label element to add to the container of labels.
 * @param {Node} contentElem The content element to add to the container of content panes.
 */
function _addTab(tabsSelector, labelElem, contentElem) {
  return function(elem) {
    var tabsEl = dom.findLastChild(elem, tabsSelector);
    if (!tabsEl) {
      console.log("koForm: Attempting to add tab without an existing tabs container");
      return;
    }
    var selectedTab = ko.utils.domData.get(tabsEl, 'kfSelectedTab');
    var labels = tabsEl.firstChild;
    var container = tabsEl.lastChild;
    var index = labels.childNodes.length;
    var isSelected = ko.computed(function() { return selectedTab() === index; });

    // These methods are indended to be used as arguments to dom() function, so they return a
    // function that should be applied to the target element.
    kd.toggleClass('active', isSelected)(labelElem);
    dom.autoDispose(labelElem, isSelected);
    kd.show(isSelected)(contentElem);

    labels.appendChild(labelElem);
    container.appendChild(contentElem);
  };
}
