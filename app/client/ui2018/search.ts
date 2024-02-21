/**
 * Search icon that expands to a search bar and collapse on 'x' or blur.
 * Takes a `SearchModel` that controls the search behavior.
 */
import { allCommands, createGroup } from 'app/client/components/commands';
import { makeT } from 'app/client/lib/localization';
import { reportError } from 'app/client/models/AppModel';
import { SearchModel } from 'app/client/models/SearchModel';
import { hoverTooltip } from 'app/client/ui/tooltips';
import { cssHoverCircle, cssTopBarBtn } from 'app/client/ui/TopBarCss';
import { labeledSquareCheckbox } from 'app/client/ui2018/checkbox';
import { mediaSmall, theme, vars } from 'app/client/ui2018/cssVars';
import { icon } from 'app/client/ui2018/icons';
import { dom, input, styled } from 'grainjs';
import { noTestId, TestId } from 'grainjs';
import debounce = require('lodash/debounce');

export * from 'app/client/models/SearchModel';

const t = makeT('search');

const EXPAND_TIME = .5;

const searchWrapper = styled('div', `
  display: flex;
  flex: initial;
  align-items: center;
  box-sizing: border-box;
  border: 1px solid transparent;
  padding: 0px 16px;
  width: 50px;
  height: 100%;
  max-height: 50px;
  transition: width 0.4s;
  position: relative;
  &-expand {
    width: 100% !important;
    border: 1px solid ${theme.searchBorder};
  }
  @media ${mediaSmall} {
    & {
      width: 32px;
      padding: 0px;
    }
    &-expand {
      margin-left: 12px;
    }
  }
`);

const expandedSearch = styled('div', `
  display: flex;
  flex-grow: 0;
  align-items: center;
  width: 0;
  opacity: 0;
  align-self: stretch;
  transition: width ${EXPAND_TIME}s, opacity ${EXPAND_TIME / 2}s ${EXPAND_TIME / 2}s;
  .${searchWrapper.className}-expand > & {
    width: auto;
    flex-grow: 1;
    opacity: 1;
  }
`);

const searchInput = styled(input, `
  background-color: ${theme.topHeaderBg};
  color: ${theme.inputFg};
  outline: none;
  border: none;
  margin: 0;
  padding: 0;
  padding-left: 4px;
  box-sizing: border-box;
  align-self: stretch;
  width: 0;
  transition: width ${EXPAND_TIME}s;
  .${searchWrapper.className}-expand & {
    width: 100%;
  }
  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }
`);

const cssArrowBtn = styled('div', `
  font-size: 14px;
  padding: 3px;
  cursor: pointer;
  margin: 2px 4px;
  visibility: hidden;
  width: 24px;
  height: 24px;
  background-color: ${theme.searchPrevNextButtonBg};
  --icon-color: ${theme.searchPrevNextButtonFg};
  border-radius: 3px;
  text-align: center;
  display: flex;
  align-items: center;

  .${searchWrapper.className}-expand & {
    visibility: visible;
  }
`);

const cssCloseBtn = styled(icon, `
  cursor: pointer;
  background-color: ${theme.controlFg};
  margin-left: 4px;
  flex-shrink: 0;
`);

const cssLabel = styled('span', `
  font-size: ${vars.smallFontSize};
  color: ${theme.lightText};
  white-space: nowrap;
  margin-right: 12px;
`);

const cssOptions = styled('div', `
  background: ${theme.topHeaderBg};
  position: absolute;
  right: 0;
  top: 48px;
  z-index: ${vars.menuZIndex};
  padding: 2px 4px;
  overflow: hidden;
  white-space: nowrap;
`);

const cssShortcut = styled('span', `
  color: ${theme.lightText};
`);

export function searchBar(model: SearchModel, testId: TestId = noTestId) {
  let keepExpanded = false;

  const focusAndSelect = () => { inputElem.focus(); inputElem.select(); };

  const commandGroup = createGroup({
    find: focusAndSelect,
    // On Mac, Firefox has a default behaviour witch causes to close the search bar on Cmd+g and
    // Cmd+shirt+G. Returning false is a Mousetrap convenience which prevents that.
    findNext: () => { model.findNext().catch(reportError); return false; },
    findPrev: () => { model.findPrev().catch(reportError); return false; },
  }, null, true);

  const toggleMenu = debounce((_value?: boolean) => {
    model.isOpen.set(_value === undefined ? !model.isOpen.get() : _value);
  }, 100);
  const inputElem: HTMLInputElement = searchInput(model.value, {onInput: true},
    {type: 'text', placeholder: t("Search in document")},
    dom.on('blur', () => (
      keepExpanded ?
        setTimeout(() => inputElem.focus(), 0) :
        toggleMenu(false)
    )),
    dom.onKeyDown({
      Enter: (ev) => ev.shiftKey ? model.findPrev() : model.findNext(),
      Escape: () => { keepExpanded = false; toggleMenu(false); },
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
    // Make sure we don't attempt to call delayed callback after disposal.
    dom.onDispose(() => toggleMenu.cancel()),
    cssHoverCircle(
      cssTopBarBtn('Search',
        testId('icon'),
        dom.on('click', focusAndSelect),
        hoverTooltip(t('Search'), {key: 'topBarBtnTooltip'}),
      )
    ),
    expandedSearch(
      testId('input'),
      inputElem,
      dom.domComputed((use) => {
        const noMatch = use(model.noMatch);
        const isEmpty = use(model.isEmpty);
        if (isEmpty) { return null; }
        if (noMatch) { return cssLabel(t("No results")); }
        return [
          cssArrowBtn(
            icon('Dropdown'),
            testId('next'),
            // Prevent focus from being stolen from the input
            dom.on('mousedown', (event) => event.preventDefault()),
            dom.on('click', () => model.findNext()),
            hoverTooltip(
              [
                t("Find Next "),
                cssShortcut(`(${['Enter', allCommands.findNext.humanKeys].join(', ')})`),
              ],
              {key: 'searchArrowBtnTooltip'}
            ),
          ),
          cssArrowBtn(
            icon('DropdownUp'),
            testId('prev'),
            // Prevent focus from being stolen from the input
            dom.on('mousedown', (event) => event.preventDefault()),
            dom.on('click', () => model.findPrev()),
            hoverTooltip(
              [
                t("Find Previous "),
                cssShortcut(allCommands.findPrev.getKeysDesc()),
              ],
              {key: 'searchArrowBtnTooltip'}
            ),
          )
        ];
      }),
      cssCloseBtn('CrossSmall',
        testId('close'),
        dom.on('click', () => toggleMenu(false))),
      cssOptions(
        labeledSquareCheckbox(model.multiPage, dom.text(model.allLabel)),
        dom.on('mouseenter', () => keepExpanded = true),
        dom.on('mouseleave', () => keepExpanded = false),
        testId('option-all-pages'),
      ),
    )
  );
}
