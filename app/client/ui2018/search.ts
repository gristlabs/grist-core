/**
 * Search icon that expands to a search bar and collapse on 'x' or blur.
 * Takes a `SearchModel` that controls the search behavior.
 */
import { allCommands, createGroup } from "app/client/components/commands";
import { Panel, RegionFocusSwitcher } from "app/client/components/RegionFocusSwitcher";
import { modKeyProp } from "app/client/lib/browserInfo";
import { makeT } from "app/client/lib/localization";
import { reportError } from "app/client/models/AppModel";
import { SearchModel } from "app/client/models/SearchModel";
import { hoverTooltip } from "app/client/ui/tooltips";
import { cssHoverCircle, cssTopBarBtn } from "app/client/ui/TopBarCss";
import { unstyledButton } from "app/client/ui2018/unstyled";
import { labeledSquareCheckbox } from "app/client/ui2018/checkbox";
import { mediaSmall, theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { dom, input, styled } from "grainjs";
import { noTestId, TestId } from "grainjs";
import debounce from "lodash/debounce";

export * from "app/client/models/SearchModel";

const t = makeT("search");

const EXPAND_TIME = 0.5;

const searchWrapper = styled("div", `
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

const expandedSearch = styled("div", `
  display: none;
  flex-grow: 0;
  align-items: center;
  width: 0;
  opacity: 0;
  align-self: stretch;
  transition: width ${EXPAND_TIME}s, opacity ${EXPAND_TIME / 2}s ${EXPAND_TIME / 2}s;
  .${searchWrapper.className}-expand > & {
    display: flex;
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

const cssArrowBtn = styled(unstyledButton, `
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

const cssCloseBtnContainer = styled(unstyledButton, `
  margin-left: 4px;
  flex-shrink: 0;
`);

const cssCloseBtn = styled(icon, `
  cursor: pointer;
  background-color: ${theme.controlFg};
`);

const cssLabel = styled("span", `
  font-size: ${vars.smallFontSize};
  color: ${theme.lightText};
  white-space: nowrap;
  margin-right: 12px;
`);

const cssOptions = styled("div", `
  background: ${theme.topHeaderBg};
  position: absolute;
  right: 0;
  top: 48px;
  z-index: ${vars.menuZIndex};
  padding: 2px 4px;
  overflow: hidden;
  white-space: nowrap;
`);

const cssShortcut = styled("span", `
  color: ${theme.lightText};
`);

const wrapperClass = "grist-doc-search-bar";

export function searchBar(model: SearchModel, testId: TestId = noTestId, regionFocusSwitcher?: RegionFocusSwitcher) {
  let regionIdOnOpen: Panel | undefined;

  // when the search model triggers a page change to show the current match, the RFS region changes back to "main",
  // while we want to stay focused on the searchbar if its open: deal with that here.
  let focusedSearchElement: HTMLElement | undefined;
  model.onPageChange(() => {
    if (model.isOpen.get()) {
      regionFocusSwitcher?.focusRegion("top");
      if (focusedSearchElement) {
        focusedSearchElement.focus();
      }
      else {
        inputElem.focus();
      }
    }
  });

  let hasOutsideClicksListener = false;
  const onOutsideClicks = (event: MouseEvent) => {
    if (event.target instanceof HTMLElement && !event.target.closest(`.${wrapperClass}`)) {
      toggleMenu(false);
    }
  };

  const cleanupOutsideClicksListener = () => {
    if (hasOutsideClicksListener) {
      document.body.removeEventListener("click", onOutsideClicks);
      hasOutsideClicksListener = false;
    }
  };

  const toggleMenu = debounce((_value?: boolean) => {
    model.isOpen.set(_value === undefined ? !model.isOpen.get() : _value);

    // when we open the searchbar: focus the input, and make sure outside clicks will close the searchbar
    if (model.isOpen.get()) {
      regionIdOnOpen = regionFocusSwitcher?.getRegionId();
      regionFocusSwitcher?.focusRegion("top");
      inputElem.focus();
      inputElem.select();
      if (!hasOutsideClicksListener) {
        document.body.addEventListener("click", onOutsideClicks);
        hasOutsideClicksListener = true;
      }
    // when we close the searchbar: focus back where we were and cleanup
    }
    else {
      if (regionIdOnOpen === "main") {
        regionFocusSwitcher?.focusRegion("main");
      }
      else {
        buttonElem.focus();
      }
      regionIdOnOpen = undefined;
      focusedSearchElement = undefined;
      cleanupOutsideClicksListener();
    }
  }, 100);

  const buttonElem = cssHoverCircle(
    dom.on("click", () => toggleMenu(true)),
    cssTopBarBtn("Search",
      testId("icon"),
      hoverTooltip(t("Search"), { key: "topBarBtnTooltip" }),
    ),
  );

  const commandGroup = createGroup({
    find: () => toggleMenu(true),
    // On Mac, Firefox has a default behaviour witch causes to close the search bar on Cmd+g and
    // Cmd+shirt+G. Returning false is a Mousetrap convenience which prevents that.
    findNext: () => { model.findNext().catch(reportError); return false; },
    findPrev: () => { model.findPrev().catch(reportError); return false; },
  }, null, true);

  const inputElem: HTMLInputElement = searchInput(model.value, { onInput: true },
    {
      "type": "text",
      "placeholder": t("Search in document"),
      "aria-label": t("Search in document"),
    },
    dom.on("focus", () => {
      focusedSearchElement = inputElem;
    }),
    dom.onKeyDown({
      Enter: async (ev) => {
        // If the user is pressing the mod key, act like we trigger the "closeSearchBar" command described in
        // commandList.
        // We don't actually register this as the closeSearchBar command,
        // as it's a bit troublesome to want to both have findNext and findPrev be active all the time,
        // while at the same time have closeSearchBar be active only when model.isOpen
        if (ev[modKeyProp()] && !ev.shiftKey) {
          toggleMenu(false);
          return;
        }
        return ev.shiftKey ? model.findPrev() : model.findNext();
      },
    }),
    commandGroup.attach(),
  );

  return searchWrapper(
    testId("wrapper"),
    searchWrapper.cls("-expand", model.isOpen),
    dom.cls(wrapperClass),
    dom.autoDispose(commandGroup),
    dom.onKeyDown({
      // The $ indicates to grainjs we don't want to stop propagation of the event here.
      // This handles the case where we are kb-focused on the search icon and press Esc:
      // we want the RegionFocusSwitcher to trigger its Escape handler correctly.
      Escape$: () => {
        if (model.isOpen.get()) {
          toggleMenu(false);
        }
      },
    }),
    dom.onDispose(() => {
      toggleMenu.cancel(); // Make sure we don't attempt to call delayed callback after disposal.
      cleanupOutsideClicksListener();
    }),
    buttonElem,
    expandedSearch(
      testId("input"),
      inputElem,
      cssOptions(
        labeledSquareCheckbox(
          model.multiPage,
          dom.text(model.allLabel),
          // Prevent focus from being stolen from the input when clicking the checkbox itself
          dom.on("mousedown", event => event.preventDefault()),
        ),
        // Keep focus on the input when clicking the checkbox text label
        dom.onMatch("label", "mouseup", () => setTimeout(() => inputElem.focus(), 0)),
        testId("option-all-pages"),
      ),
      dom.domComputed((use) => {
        const noMatch = use(model.noMatch);
        const isEmpty = use(model.isEmpty);
        if (isEmpty) { return null; }
        if (noMatch) { return cssLabel(t("No results")); }
        return [
          cssArrowBtn(
            icon("Dropdown"),
            testId("next"),
            // Prevent focus from being stolen from the input
            dom.on("mousedown", event => event.preventDefault()),
            dom.on("focus", (event) => {
              focusedSearchElement = event.target as HTMLElement;
            }),
            dom.on("click", () => model.findNext()),
            hoverTooltip(
              [
                t("Find Next "),
                cssShortcut(`(${["Enter", allCommands.findNext.humanKeys].join(", ")})`),
              ],
              { key: "searchArrowBtnTooltip" },
            ),
          ),
          cssArrowBtn(
            icon("DropdownUp"),
            testId("prev"),
            // Prevent focus from being stolen from the input
            dom.on("mousedown", event => event.preventDefault()),
            dom.on("focus", (event) => {
              focusedSearchElement = event.target as HTMLElement;
            }),
            dom.on("click", () => model.findPrev()),
            hoverTooltip(
              [
                t("Find Previous "),
                cssShortcut(`(${["Shift + Enter", allCommands.findPrev.humanKeys].join(", ")})`),
              ],
              { key: "searchArrowBtnTooltip" },
            ),
          ),
        ];
      }),
      cssCloseBtnContainer(
        testId("close"),
        { "aria-label": t("Close search bar") },
        dom.on("click", () => toggleMenu(false)),
        cssCloseBtn("CrossSmall"),
      ),
    ),
  );
}
