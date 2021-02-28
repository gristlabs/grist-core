/**
 * Search icon that expands to a search bar and collapse on 'x' or blur.
 * Takes a `SearchModel` that controls the search behavior.
 */
import { createGroup } from 'app/client/components/commands';
import { reportError } from 'app/client/models/AppModel';
import { SearchModel } from 'app/client/models/SearchModel';
import { cssHoverCircle, cssTopBarBtn } from 'app/client/ui/TopBarCss';
import { colors, mediaSmall } from 'app/client/ui2018/cssVars';
import { icon } from 'app/client/ui2018/icons';
import { dom, input, styled } from 'grainjs';
import { noTestId, TestId } from 'grainjs';
import debounce = require('lodash/debounce');

export * from 'app/client/models/SearchModel';

const EXPAND_TIME = .5;

const searchWrapper = styled('div', `
  display: flex;
  flex: initial;
  align-items: center;
  box-sizing: border-box;
  border: 1px solid transparent;
  padding: 16px;
  width: 50px;
  height: 100%;
  max-height: 50px;
  transition: width 0.4s;
  &-expand {
    width: 100% !important;
    border: 1px solid grey;
  }
  @media ${mediaSmall} {
    & {
      width: 32px;
      padding: 0px;
    }
  }
`);

const expandedSearch = styled('div', `
  display: flex;
  flex-grow: 0;
  align-items: center;
  width: 0;
  opacity: 0;
  transition: width ${EXPAND_TIME}s, opacity ${EXPAND_TIME / 2}s ${EXPAND_TIME / 2}s;
  .${searchWrapper.className}-expand > & {
    width: auto;
    flex-grow: 1;
    opacity: 1;
  }
`);

const searchInput = styled(input, `
  outline: none;
  border: none;
  margin: 0;
  padding: 0;
  padding-left: 4px;
  box-sizing: border-box;
  width: 0;
  transition: width ${EXPAND_TIME}s;
  .${searchWrapper.className}-expand & {
    width: 100%;
  }
`);

const cssArrowBtn = styled('div', `
  font-size: 14px;
  padding: 3px;
  cursor: pointer;
  margin: 2px;
  visibility: hidden;

  &.disabled {
    color: ${colors.darkGrey};
    cursor: default;
  }

  .${searchWrapper.className}-expand & {
    visibility: visible;
  }
`);

const cssCloseBtn = styled(icon, `
  cursor: pointer;
`);

export function searchBar(model: SearchModel, testId: TestId = noTestId) {
  const commandGroup = createGroup({
    find: () => { inputElem.focus(); inputElem.select(); },
    // On Mac, Firefox has a default behaviour witch causes to close the search bar on Cmd+g and
    // Cmd+shirt+G. Returning false is a Mousetrap convenience which prevents that.
    findNext: () => {model.findNext().catch(reportError); return false; },
    findPrev: () => {model.findPrev().catch(reportError); return false; },
  }, null, true);

  const toggleMenu = debounce((_value?: boolean) => {
    model.isOpen.set(_value === undefined ? !model.isOpen.get() : _value);
  }, 100);
  const inputElem = searchInput(model.value, {onInput: true},
    {type: 'text', placeholder: 'Search in document'},
    dom.on('blur', () => toggleMenu(false)),
    dom.onKeyDown({
      Enter: () => model.findNext(),
      Escape: () => toggleMenu(false),
      // Catch both Tab and Shift+Tab to prevent focus entering unrelated editable label.
      Tab: () => toggleMenu(false),
    }),
    dom.on('focus', () => toggleMenu(true)),
    commandGroup.attach(),
  );

  // Releases focus when closing the search bar, otherwise users could keep typing in without
  // noticing.
  const lis = model.isOpen.addListener(val => val || inputElem.blur());

  return searchWrapper(
    testId('wrapper'),
    searchWrapper.cls('-expand', model.isOpen),
    dom.autoDispose(commandGroup),
    dom.autoDispose(lis),
    cssHoverCircle(
      cssTopBarBtn('Search',
        testId('icon'),
        dom.on('click', () => inputElem.focus())
      )
    ),
    expandedSearch(
      testId('input'),
      inputElem,
      cssArrowBtn('\u2329',
        testId('prev'),
        // Prevent focus from being stolen from the input
        dom.on('mousedown', (event) => event.preventDefault()),
        dom.on('click', () => model.findPrev()),
        dom.cls('disabled', model.noMatch)),
      cssArrowBtn('\u232A',
        testId('next'),
        // Prevent focus from being stolen from the input
        dom.on('mousedown', (event) => event.preventDefault()),
        dom.on('click', () => model.findNext()),
        dom.cls('disabled', model.noMatch)),
      cssCloseBtn('CrossSmall',
        testId('close'),
        dom.on('click', () => toggleMenu(false)))
    )
  );
}
