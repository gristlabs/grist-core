import { dom, DomContents, Observable } from "grainjs";

/**
 * Helper to simplify building tabs following the ARIA Tabs pattern.
 *
 * This uses `ariaTabList`, `ariaTab` and `ariaTabPanel` internally,
 * exposing functions with the correct `tabListId` and `state` arguments already set.
 *
 * @param tabListId - The id of the tablist. Unique name that is used to generate various `id` dom attributes.
 * @param state - The observable that contains the current active tab id. It gets updated when tab changes.
 */
export const ariaTabs = (tabListId: string, state: Observable<string>) => {
  return {
    tabList: ariaTabList,
    tab: (tabId: string) => ariaTab(tabListId, tabId, state),
    tabPanel: (tabId: string, children: DomContents) => ariaTabPanel(tabListId, tabId, state, children),
  };
};

/**
 * Returns a list of DOM args to attach to an element we want to expose as a "tab list",
 * following the ARIA Tabs pattern. https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
 *
 * A "tab list" is a dom element containing multiple "tabs" (see `ariaTab`).
 */
export const ariaTabList = () => ({role: "tablist"});

/**
 * Returns a list of DOM args to attach to an element we want to expose as a "tab",
 * following the ARIA Tabs pattern. https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
 *
 * A "tab" is a button that is a child of a "tablist". It is used to switch the current active tab
 * of the tablist.
 *
 * For tab content, see `ariaTabPanel`.
 *
 * @param tabListId - The id of the tablist. It helps building the final element `id` attribute of the tab.
 * @param tabId - The id for this tab. It matches the value representing the tab in the state.
 *                It helps building the final element `id` attribute of the tab.
 * @param state - The observable that contains the current active tab id. It gets updated when tab changes.
 */
export const ariaTab = (tabListId: string, tabId: string, state: Observable<string>) => {
  return [
    {
      id: `aria-tab-${tabListId}-${tabId}`,
      role: "tab",
      "data-tab-id": tabId,
      "aria-controls": `aria-tabpanel-${tabListId}-${tabId}`,
    },
    dom.attr("aria-selected", use => use(state) === tabId ? "true" : "false"),
    dom.attr("tabindex", use => use(state) === tabId ? "0" : "-1"),
    // this is important to bypass default handling of tabindex in the RegionFocusSwitcher and Clipboard
    dom.cls("ignore_tabindex"),
    dom.on('click', () => state.set(tabId)),
    dom.onKeyDown({
      // Only horizontal tabs are currently implemented.
      ArrowLeft: event => cycle(event.target, state, -1),
      ArrowRight: event => cycle(event.target, state, 1),
    })
  ];
};

/**
 * Returns a list of DOM args to attach to an element we want to expose as a "tab panel",
 * and automatically renders its content only when the tab is active.
 *
 * This follows the ARIA Tabs pattern: https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
 *
 * A "tab panel" is a content area containing children elements that are displayed only
 * when the tied `ariaTab` is the active one.
 *
 * Note that the tab panel itself must always be in the DOM, whether or not it is the active one.
 * This helper takes care of rendering the tab panel content or not based on the current active tab state.
 *
 * For tab buttons, see `ariaTab`.
 *
 * @param tabListId - The id of the tablist. It helps building the final element `id` attribute of the tabpanel.
 * @param tabId - The id for this tabpanel. It matches the value representing the tab in the state of the tied
 *                `ariaTab`. It helps building the final element `id` attribute of the tabpanel.
 * @param state - The observable that contains the current active tab id. It gets updated when tab changes.
 * @param children - The tab content, automatically appended in the DOM only when the tab is active.
 */
export const ariaTabPanel = (tabListId: string, tabId: string, state: Observable<string>, children: DomContents) => {
  return [
    {
      id: `aria-tabpanel-${tabListId}-${tabId}`,
      role: "tabpanel",
      "aria-labelledby": `aria-tab-${tabListId}-${tabId}`,
    },
    dom.attr('aria-hidden', use => use(state) !== tabId ? "true" : "false"),
    dom.domComputed(state, currentTabId => currentTabId === tabId ? children : null),
  ];
};

const cycle = (fromElement: EventTarget | null, state: Observable<string>, direction: number) => {
  if (!fromElement) {
    return;
  }
  const tabList = (fromElement as HTMLElement)?.closest('[role="tablist"]');
  if (!tabList) {
    return;
  }
  const tabs = tabList.querySelectorAll('[role="tab"]');
  const currentIndex = Array.from(tabs).indexOf(fromElement as HTMLElement);
  const newIndex = (currentIndex + direction + tabs.length) % tabs.length;
  const newTabId = tabs[newIndex].getAttribute('data-tab-id');
  if (newTabId) {
    state.set(newTabId);
    const newTab = tabs[newIndex];
    (newTab as HTMLElement).focus();
  }
};
