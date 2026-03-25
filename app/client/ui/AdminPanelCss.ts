import { textarea } from "app/client/ui/inputs";
import { hoverTooltip } from "app/client/ui/tooltips";
import { transition } from "app/client/ui/transitions";
import { mediaSmall, testId, theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { toggleSwitch } from "app/client/ui2018/toggleSwitch";
import { components, tokens } from "app/common/ThemePrefs";

import { dom, DomContents, DomElementArg, IDisposableOwner, Observable, styled } from "grainjs";

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
        itemContent(),
        cssExpandIndicator(
          cssExpandChevron("Dropdown"),
          cssExpandChevron.cls("-open", use => !use(isCollapsed)),
        ),
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
  padding: 28px 32px;
  max-width: 750px;
  width: 100%;
  margin: 16px auto;
  border: 1px solid ${theme.widgetBorder};
  border-radius: 10px;
  background: ${theme.mainPanelBg};
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.04),
              0 2px 8px 0 rgba(0, 0, 0, 0.03);
  transition: box-shadow 0.2s ease;
  & > div + div {
    margin-top: 8px;
  }

  animation: adminFadeUp 0.3s ease both;

  @keyframes adminFadeUp {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* Stagger entrance: each section gets a slightly later start. */
  &:nth-child(2) { animation-delay: 0.06s; }
  &:nth-child(3) { animation-delay: 0.12s; }
  &:nth-child(4) { animation-delay: 0.18s; }
  &:nth-child(5) { animation-delay: 0.24s; }
  &:nth-child(6) { animation-delay: 0.30s; }
  &:nth-child(7) { animation-delay: 0.36s; }

  @media ${mediaSmall} {
    & {
      width: auto;
      padding: 16px;
      margin: 8px;
    }
  }
`);

export const cssSectionTitle = styled("div", `
  height: 32px;
  line-height: 32px;
  margin-bottom: 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: ${theme.lightText};
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
  padding: 10px 12px;
  margin: 0 -12px;
  border-radius: 8px;
  justify-content: space-around;
  flex-direction: row;
  transition: background-color 0.15s ease;
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
  font-weight: 600;
  display: flex;
  align-items: center;
  margin-right: 14px;
  font-size: ${vars.largeFontSize};
  &-prefixed {
    padding-left: 0;
  }
  &-full {
    width: unset;
  }
  &-flash {
    animation: flashToTransparent 1s ease-in-out forwards;
  }
  @keyframes flashToTransparent {
    0%   { background-color: var(--grist-theme-primary-emphasis, inherit); }
    100% { background-color: inherit; }
  }
  @media ${mediaSmall} {
    &:first-child {
      margin-left: 0;
    }
  }
`);

const cssItemDescription = styled("div", `
  width: 250px;
  margin-right: auto;
  margin-bottom: -1px; /* aligns with the value */
  color: ${theme.lightText};
  font-size: 13px;
  line-height: 1.4;
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

const cssExpandIndicator = styled("div", `
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  margin-left: 8px;
  transition: background-color 0.15s ease;
  .${cssItemShort.className}:hover & {
    background-color: color-mix(in srgb, ${theme.lightText} 12%, transparent);
  }
`);

const cssExpandChevron = styled(icon, `
  width: 16px;
  height: 16px;
  --icon-color: ${theme.lightText};
  transform: rotate(-90deg);
  transition: transform 0.2s ease;
  &-open {
    transform: rotate(0deg);
  }
`);

const cssExpandedContentWrap = styled("div", `
  transition: max-height 0.3s ease-in-out;
  overflow: hidden;
  max-height: 0;
`);

const cssExpandedContent = styled("div", `
  margin-left: 8px;
  padding: 16px 0 18px;
  border-bottom: 1px solid color-mix(in srgb, ${theme.widgetBorder} 50%, transparent);
  .${cssItem.className}:last-child & {
    padding-bottom: 0;
    border-bottom: none;
  }
`);

export const cssValueLabel = styled("div", `
  padding: 4px 10px;
  color: ${theme.text};
  border: 1px solid ${theme.inputBorder};
  border-radius: 10px;
  font-size: 12px;
  font-weight: 500;
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
