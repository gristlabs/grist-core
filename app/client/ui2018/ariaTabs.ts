import { dom, Observable } from "grainjs";

export const ariaTabList = () => ({role: "tablist"});

/**
 * Returns a list of DOM arguments to generate a tab following the ARIA tab pattern.
 *
 * @param tabId - The id of the tab. It matches the value representing the tab in the state.
 * @param state - The observable that gets updated when tab changes
 */
export const ariaTab = (tabId: string, state: Observable<string>) => {
  return [
    {
      id: `aria-tab-${tabId}`,
      role: "tab",
      "data-tab-id": tabId,
      "aria-controls": `aria-tabpanel-${tabId}`,
    },
    dom.attr("aria-selected", (use) => use(state) === tabId ? "true" : "false"),
    dom.attr("tabindex", (use) => use(state) === tabId ? "0" : "-1"),
    dom.on('click', () => state.set(tabId)),
    dom.onKeyDown({
      ArrowLeft: (event) => cycle(event.target, state, -1),
      ArrowRight: (event) => cycle(event.target, state, 1),
    })
  ];
};

export const ariaTabPanel = (tabId: string) => {
  return {
    id: `aria-tabpanel-${tabId}`,
    role: "tabpanel",
    "aria-labelledby": `aria-tab-${tabId}`,
  };
};

const cycle = (fromElement: EventTarget | null, state: Observable<string>, direction: number) => {
  if (!fromElement) {
    return;
  }
  const tablist = (fromElement as HTMLElement)?.closest('[role="tablist"]');
  if (!tablist) {
    return;
  }
  const tabs = tablist.querySelectorAll('[role="tab"]');
  const currentIndex = Array.from(tabs).indexOf(fromElement as HTMLElement);
  const newIndex = (currentIndex + direction + tabs.length) % tabs.length;
  const newTabId = tabs[newIndex].getAttribute('data-tab-id');
  if (newTabId) {
    state.set(newTabId);
    const newTab = tabs[newIndex];
    (newTab as HTMLElement).focus();
  }
};
