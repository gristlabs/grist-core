import { makeT } from "app/client/lib/localization";
import { textarea } from "app/client/ui/inputs";
import { hoverTooltip } from "app/client/ui/tooltips";
import { transition } from "app/client/ui/transitions";
import { textButton } from "app/client/ui2018/buttons";
import { mediaSmall, testId, theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { toggleSwitch } from "app/client/ui2018/toggleSwitch";
import { components, tokens } from "app/common/ThemePrefs";

import { dom, DomContents, DomElementArg, IDisposableOwner, keyframes, Observable, styled } from "grainjs";

export interface AdminPanelControls {
  needsRestart: Observable<boolean>;
  restartGrist: () => Promise<void>;
}

export function HidableToggle(
  owner: IDisposableOwner,
  value: Observable<boolean | null>,
  options: { labelId?: string } = {},
) {
  return toggleSwitch(value, {
    args: [dom.hide(use => use(value) === null)],
    inputArgs: [options.labelId ? { "aria-labelledby": options.labelId } : undefined],
  });
}

export function AdminSection(owner: IDisposableOwner, title: DomContents, items: DomElementArg[]) {
  return cssSection(
    cssSectionTitle(title),
    ...items,
  );
}

/**
 * Scrolls the admin panel item with the given id into view and briefly
 * flashes it, so users notice where they landed. Safe to call with an
 * id that doesn't exist yet (no-op).
 */
export function focusAdminItem(itemId: string): void {
  const elem = document.getElementById(itemId);
  if (!elem) { return; }
  // The id lands on the tiny item name span; scroll the surrounding
  // full-width row into view so the whole item is visible, not just
  // the label.
  const row = elem.closest("." + cssItem.className);
  (row ?? elem).scrollIntoView({ behavior: "smooth", block: "center" });

  // If the item is expandable and currently collapsed, expand it by
  // clicking its header — the existing click handler toggles state.
  if (row) {
    const wrap = row.querySelector("." + cssExpandedContentWrap.className);
    const header = row.querySelector("." + cssItemShort.className);
    const isCollapsed = wrap instanceof HTMLElement &&
      (wrap.style.maxHeight === "" || wrap.style.maxHeight === "0px");
    if (header instanceof HTMLElement && isCollapsed) {
      header.click();
    }
  }

  elem.classList.remove(cssItemName.className + "-flash");
  // Force reflow so the animation restarts if it's already applied.
  void elem.offsetWidth;
  elem.classList.add(cssItemName.className + "-flash");
}

export function AdminSectionItem(owner: IDisposableOwner, options: {
  id: string,
  name?: DomContents,
  description?: DomContents,
  value?: DomElementArg,
  expandedContent?: DomContents,
  disabled?: false | string,
}) {
  let item: HTMLDivElement | undefined;
  const itemContent = (...prefix: DomContents[]) => [
    item = cssItemName(
      ...prefix,
      options.name,
      testId(`admin-panel-item-name-${options.id}`),
      dom.attr("id", options.id),  // Add an id for use as an anchor,
      // although it needs tricks (below)
      prefix.length ? cssItemName.cls("-prefixed") : null,
      cssItemName.cls("-full", options.description === undefined),
      () => {
        // If there is an anchor, check if it points to us.
        // If not, do nothing. If yes, focus here once rendered.
        const hash = window.location.hash;
        if (hash !== "#" + options.id) { return; }
        // A setTimeout seems to be the "standard" for doing focus
        // after rendering throughout the app. Feels a little hacky,
        // but appears to work reliably, and consequences of failure
        // are not extreme - we just don't autoscroll and highlight.
        setTimeout(() => {
          if (!item) { return; }
          item.scrollIntoView();
          item.focus();
          item.classList.add(cssItemName.className + "-flash");
        }, 0);
      },
    ),
    cssItemDescription(options.description, { id: `admin-panel-item-description-${options.id}` }),
    cssItemValue(options.value,
      testId(`admin-panel-item-value-${options.id}`),
      dom.on("click", ev => ev.stopPropagation())),
  ];
  if (options.expandedContent && !options.disabled) {
    const isCollapsed = Observable.create(owner, true);
    return cssItem(
      cssItemShort(
        itemContent(dom.domComputed(isCollapsed, c => cssCollapseIcon(c ? "Expand" : "Collapse"))),
        cssItemShort.cls("-expandable"),
        dom.on("click", () => isCollapsed.set(!isCollapsed.get())),
      ),
      cssExpandedContentWrap(
        transition(isCollapsed, {
          prepare(elem, close) { elem.style.maxHeight = close ? elem.scrollHeight + "px" : "0"; },
          run(elem, close) { elem.style.maxHeight = close ? "0" : elem.scrollHeight + "px"; },
          finish(elem, close) { elem.style.maxHeight = close ? "0" : "unset"; },
        }),
        cssExpandedContent(
          options.expandedContent,
        ),
      ),
      testId(`admin-panel-item-${options.id}`),
    );
  } else {
    return cssItem(
      cssItemShort(itemContent(),
        cssItemShort.cls("-disabled", Boolean(options.disabled)),
        options.disabled ? hoverTooltip(options.disabled, {
          placement: "bottom-end",
          modifiers: { offset: { offset: "0, -10" } },
        }) : null,
      ),
      testId(`admin-panel-item-${options.id}`),
    );
  }
}

export const cssSection = styled("div", `
  padding: 24px;
  max-width: 750px;
  width: 100%;
  margin: 16px auto;
  border: 1px solid ${theme.widgetBorder};
  border-radius: 4px;
  & > div + div {
    margin-top: 8px;
  }

  @media ${mediaSmall} {
    & {
      width: auto;
      padding: 12px;
      margin: 8px;
    }
  }
`);

export const cssSectionTitle = styled("div", `
  height: 32px;
  line-height: 32px;
  margin-bottom: 8px;
  font-size: ${vars.headerControlFontSize};
  font-weight: ${vars.headerControlTextWeight};
`);

export const cssItem = styled("div", `
  margin-top: 8px;
  container-type: inline-size;
  container-name: line;
`);

const cssItemShort = styled("div", `
  display: flex;
  row-gap: 4px;
  flex-wrap: nowrap;
  align-items: center;
  padding: 8px;
  margin: 0 -8px;
  border-radius: 4px;
  justify-content: space-around;
  flex-direction: row;
  &-expandable {
    cursor: pointer;
  }
  &-expandable:hover {
    background-color: ${theme.lightHover};
  }
  &-disabled {
    opacity: .5;
  }

  @container line (max-width: 500px) {
    & {
      flex-direction: column;
      align-items: stretch;
      gap: 8px;
    }
  }
`);

const cssItemName = styled("div", `
  width: 230px;
  font-weight: bold;
  display: flex;
  align-items: center;
  margin-right: 14px;
  font-size: ${vars.largeFontSize};
  padding-left: 24px;
  &-prefixed {
    padding-left: 0;
  }
  &-full {
    padding-left: 0;
    width: unset;
  }
  &-flash {
    animation: flashToTransparent 1s ease-in-out forwards;
  }
  @keyframes flashToTransparent {
    0%   { background-color: var(--grist-theme-primary-emphasis, inherit); }
    100% { background-color: inherit; }
  }
  @container line (max-width: 500px) {
    & {
      padding-left: 0;
    }
  }
  @media ${mediaSmall} {
    & {
      padding-left: 0;
    }
    &:first-child {
      margin-left: 0;
    }
  }
`);

const cssItemDescription = styled("div", `
  width: 250px;
  margin-right: auto;
  margin-bottom: -1px; /* aligns with the value */
`);

const cssItemValue = styled("div", `
  flex: none;
  margin: -8px 0;
  padding: 8px;
  cursor: auto;
  max-width: 200px;
  --admin-select-width: 176px;

  .${cssItemShort.className}-disabled & {
    pointer-events: none;
  }
`);

const cssCollapseIcon = styled(icon, `
  width: 24px;
  height: 24px;
  margin-right: 4px;
  margin-left: -4px;
  --icon-color: ${theme.lightText};
`);

const cssExpandedContentWrap = styled("div", `
  transition: max-height 0.3s ease-in-out;
  overflow: hidden;
  max-height: 0;
`);

const cssExpandedContent = styled("div", `
  margin-left: 24px;
  padding: 18px 0;
  border-bottom: 1px solid ${theme.widgetBorder};
  .${cssItem.className}:last-child & {
    padding-bottom: 0;
    border-bottom: none;
  }
  @container line (max-width: 500px) {
    & {
      margin-left: 0px;
    }
  }
`);

export const cssValueLabel = styled("div", `
  padding: 4px 8px;
  color: ${theme.text};
  border: 1px solid ${theme.inputBorder};
  border-radius: ${vars.controlBorderRadius};
`);

/** Green text for positive/success status values. */
export const cssHappyText = styled("span", `
  color: ${theme.controlFg};
`);

/** Red text for error status values. */
export const cssErrorText = styled("span", `
  color: ${theme.errorText};
`);

/** Orange/amber text for warning/danger status values. */
export const cssDangerText = styled("div", `
  color: ${theme.dangerText};
`);

export const cssTextArea = styled(textarea, `
  color: ${theme.inputFg};
  background-color: ${theme.inputBg};
  border: 1px solid ${theme.inputBorder};
  width: 100%;
  padding: 8px 12px;
  outline: none;
  resize: none;
  border-radius: 3px;

  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }
`);

export const cssWell = styled("div", `
  color: ${theme.text};
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  border-radius: 10px;
  width: 100%;

  &-warning {
    border: 1px solid ${tokens.warningLight};
    --icon-color: ${tokens.warningLight};
  }

  &-error {
    border: 1px solid ${components.errorText};
    --icon-color: ${components.errorText};
  }
`);

export const cssIconWrapper = styled("div", `
  font-size: 13px;
  flex-shrink: 0;
  margin-top: 2px;
`);

export const cssWellTitle = styled("div", `
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
  margin-bottom: 8px;
`);

export const cssWellContent = styled("div", `
  font-size: ${vars.mediumFontSize};
  line-height: 1.4;
  & > p {
    margin: 0px;
  }
  & > p + p {
    margin-top: 8px;
  }
`);

export const cssFlexSpace = styled("div", `
  flex: 1 1 0;
`);

export const cssFadeUp = keyframes(`
  from {
    opacity: 0;
    transform: translateY(12px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
`);

export const cssFadeUpGristLogo = styled("div", `
  animation: ${cssFadeUp} 0.5s ease both;
  background-image: var(--icon-GristLogo);
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
  height: 48px;
`);

export const cssFadeUpHeading = styled("div", `
  animation: ${cssFadeUp} 0.5s ease 0.08s both;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.5px;
  margin: 16px 0px 8px 0px;
  text-align: center;
`);

export const cssFadeUpSubHeading = styled("div", `
  animation: ${cssFadeUp} 0.5s ease 0.16s both;
  color: ${tokens.secondary};
  font-size: 15px;
  line-height: 1.5;
  margin-bottom: 24px;
  text-align: center;
`);

// --- Shared styles for section components (BaseUrlSection, EditionSection, etc.) ---

/** Flex column container for section content. */
export const cssSectionContainer = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 8px;
`);

/** Subdued description text within a section. */
export const cssSectionDescription = styled("div", `
  color: ${theme.lightText};
  font-size: ${vars.mediumFontSize};
  line-height: 1.5;
  margin-bottom: 4px;
`);

/** Inline status text for collapsed section display. */
export const cssSectionStatusText = styled("span", `
  display: inline-flex;
  align-items: center;
  gap: 4px;
`);

/** Inline row of small buttons (confirm, skip, etc.). */
export const cssSectionButtonRow = styled("div", `
  display: flex;
  gap: 8px;
  align-items: center;
`);

const cssSectionConfirmedRow = styled("div", `
  display: flex;
  align-items: center;
  gap: 8px;
`);

const cssSectionConfirmedPill = styled("span", `
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: ${theme.controlPrimaryBg};
  font-size: ${vars.smallFontSize};
`);

const cssSectionSkippedPill = styled("span", `
  color: ${theme.controlPrimaryBg};
  font-size: ${vars.smallFontSize};
`);

/**
 * Builds the confirmed/skipped status row with a pencil-edit button.
 * Shared by all wizard section components.
 *
 * @param confirmed - observable controlling visibility of the whole row
 * @param onEdit - callback when the pencil is clicked (should reset confirmed)
 * @param options.skipped - if set and true, renders the skipped pill instead
 *   of the "Confirmed" pill
 * @param options.skippedLabel - text for the skipped pill (default: "For later")
 * @param options.testPrefix - prefix for test IDs
 */
export function buildConfirmedRow(
  confirmed: Observable<boolean>,
  onEdit: () => void,
  options: { skipped?: Observable<boolean>; skippedLabel?: string; testPrefix?: string } = {},
) {
  const tid = options.testPrefix ? (id: string) => testId(`${options.testPrefix}-${id}`) : testId;
  return dom.domComputed((use) => {
    if (!use(confirmed)) { return null; }
    const isSkipped = options.skipped ? use(options.skipped) : false;
    return cssSectionConfirmedRow(
      isSkipped ?
        cssSectionSkippedPill(options.skippedLabel || t("For later")) :
        cssSectionConfirmedPill(t("Confirmed")),
      textButton(
        icon("Pencil"),
        dom.on("click", onEdit),
        tid("edit"),
      ),
      tid("confirmed-row"),
    );
  });
}

const t = makeT("AdminPanelCss");
