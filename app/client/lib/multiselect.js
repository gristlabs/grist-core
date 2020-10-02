/* global $ */
var ko = require('knockout');
var kf = require('./koForm');
var dom = require('./dom');
var kd = require('./koDom');

/**
 * Creates a multi-select implemented with a draggable list of selected items followed by
 * an autocomplete input containing the remaining selectable items.
 *
 * Items in `selected` list can be arbitrary objects, and get passed to remove()/reorder().
 * Items for auto-complete should have 'value' and 'label' properties, and are passed to add().
 *
 * @param {Function} source(request, response):
 *    Called with the autocomplete request, containing .term with the search term entered so far.
 *    The response callback must be called with a list of suggested items (with 'value' and
 *    'label' properties). The selected item is passed to add(). The caller should filter out
 *    items already selected if appropriate.
 * @param {koArray}  selected:
 *    KoArray of selected items.
 * @param {Function} itemCreateFunc:
 *    Called as `itemCreateFunc(item)` for each element of the `selected` array. Should return a
 *    single Node, or null or undefined to omit that node.
 * @param {Function} options.add(autoCompleteItem):
 *    Called to add a new item.
 * @param {Function} options.remove(item):
 *    Called to remove a selected item.
 * @param {Function} options.reorder(item, nextItem):
 *    Optional. Called to move item to just before nextItem (or to the end when nextItem is null).
 *    If omitted, items are not draggable. The callback must update the 'selected' array to
 *    match the UI. See koForm.draggableList for more details.
 * @param {String} options.hint:
 *    Optional. Text to display above the input if nothing is selected.
 */
function multiselect(source, selected, itemCreateFunc, options) {
  options = options || {};
  var noneSelected = ko.computed(() => selected.all().length === 0);
  var selector;
  var input;

  // Calls add on the item, closes the autocomplete and clears the input.
  function selectItem(item) {
    options.add(item);
    $(input).autocomplete("close");
    input.value = '';
  }

  // Searches for the item by label in the source and selects the first match.
  function searchItem(searchTerm) {
    source({ term: searchTerm }, resp => {
      var item = resp.find(respItem => respItem.label === searchTerm);
      if (item) { selectItem(item); }
    });
  }

  // Main selector dom with draggable list.
  selector = dom('div.multiselect',
    dom.autoDispose(noneSelected),
    dom('div.multiselect-selected',
      kf.draggableList(selected, item => itemCreateFunc(item), {
        drag_indicator: Boolean(options.reorder),
        removeButton: true,
        reorder: options.reorder,
        remove: options.remove
      }),
      kd.toggleClass('multiselect-empty', noneSelected),
      kd.maybe(noneSelected, () => dom('div.multiselect-hint', options.hint || ""))
    ),
    input = dom('input.multiselect-input',
      dom.on('focus', () => { $(input).autocomplete("search"); }),
      dom.on('change', () => { searchItem(input.value); })
    )
  );

  // Set up the auto-complete widget.
  $(input).autocomplete({
    source: source,
    minLength: 0,
    delay: 10,
    focus: () => false, // Keeps input empty on focus
    select: function(event, ui) {
      selectItem(ui.item);
      return false;
    }
  });

  return selector;
}
module.exports = multiselect;
