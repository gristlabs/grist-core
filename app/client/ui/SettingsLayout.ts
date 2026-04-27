import { hoverTooltip } from "app/client/ui/tooltips";
import { transition } from "app/client/ui/transitions";
import { mediaSmall, testId, theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { tokens } from "app/common/ThemePrefs";

import { dom, DomContents, DomElementArg, IDisposableOwner, Observable, styled } from "grainjs";

/**
 * Layout primitives for settings-style pages.
 *
 * Usage:
 *
 *     SettingsPage(t("Installation"), [
 *       SectionCard(t("Security Settings"), [
 *         SectionItem({
 *           id: "sandboxing",
 *           name: t("Sandboxing"),
 *           description: t("Sandbox settings for data engine"),
 *           value: cssValueLabel("gvisor"),
 *         }),
 *         SectionItem({
 *           id: "auth",
 *           name: t("Authentication"),
 *           description: t("Current authentication method"),
 *           value: cssValueLabel("SAML"),
 *           expandedContent: dom("div", "Details here..."),
 *         }),
 *       ]),
 *     ])
 *
 * - `SettingsPage(title, content)` — scrollable page container with a title.
 * - `SectionCard(title, content)` — bordered card with a section title.
 * - `SectionItem(opts)` — label + value row with optional expand/collapse.
 *
 * Pass `null` for title to omit it (e.g. `SectionCard(null, [...])`).
 */

export function SettingsPage(title: DomContents | null, content: DomElementArg[]) {
  return cssSettingsPage(
    title !== null ? cssPageTitle(title) : null,
    ...content,
  );
}

export function SectionCard(title: DomContents | null, content: DomElementArg[]) {
  return cssSection(
    title !== null ? cssSectionTitle(title) : null,
    ...content,
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
      (wrap.style.maxHeight === "" || wrap.style.maxHeight === "0" || wrap.style.maxHeight === "0px");
    if (header instanceof HTMLElement && isCollapsed) {
      header.click();
    }
  }

  elem.classList.remove(cssItemName.className + "-flash");
  // Force reflow so the animation restarts if it's already applied.
  void elem.offsetWidth;
  elem.classList.add(cssItemName.className + "-flash");
}

export function SectionItem(options: {
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
    return dom.create((owner: IDisposableOwner) => {
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
    });
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

export const cssSettingsPage = styled("div", `
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: auto;
  padding: 32px 32px 48px 32px;
  gap: 24px;
  font-size: ${vars.introFontSize};
  color: ${theme.text};
  outline: none;

  @media ${mediaSmall} {
    & {
      padding: 24px 16px 32px 16px;
      gap: 16px;
      font-size: ${vars.mediumFontSize};
    }
  }
`);

export const cssPageTitle = styled("h1", `
  width: 100%;
  max-width: 750px;
  padding: 0;
  margin: -8px auto 0 auto;
  font-size: ${tokens.xxxlargeFontSize};
  font-weight: ${tokens.headerControlTextWeight};
`);

/**
 * Soft drop shadow shared by bordered cards and prominent buttons in the
 * admin panel and QuickSetup, so both surfaces sit at the same visual depth.
 * Use as a CSS value: `box-shadow: ${cardSurfaceShadow};`.
 */
export const cardSurfaceShadow = `2px 2px 12px 0px ${theme.widgetPickerShadow}`;

/**
 * Shared visual "card" surface: bordered, rounded, soft drop shadow,
 * solid background. Used by the admin panel's outer section card and by
 * the inner cards inside QuickSetup steps so both share the same look.
 *
 * Nested instances drop the shadow -- a card-inside-a-card would
 * otherwise stack two shadows and look heavy. This handles the case
 * where a section (e.g. AuthenticationSection) renders the same cards
 * both standalone in QuickSetup and inside the admin panel's outer
 * SectionCard.
 */
export const cssCardSurface = styled("div", `
  border: 1px solid ${theme.widgetBorder};
  border-radius: 12px;
  box-shadow: ${cardSurfaceShadow};
  background-color: ${tokens.bg};

  & & {
    box-shadow: none;
  }
`);

export const cssSection = styled(cssCardSurface, `
  padding: 16px 32px 24px 32px;
  max-width: 750px;
  width: 100%;
  margin: 0 auto;
  &-bare {
    border: none;
    padding: 0px;
    box-shadow: none;
  }
  & > div + div {
    margin-top: 8px;
  }

  @media ${mediaSmall} {
    & {
      padding: 12px;
    }
  }
`);

export const cssSectionTitle = styled("div", `
  height: 32px;
  line-height: 32px;
  margin-bottom: 8px;
  font-size: ${tokens.xxlargeFontSize};
  font-weight: ${tokens.headerControlTextWeight};
`);

export const cssValueLabel = styled("div", `
  padding: 4px 8px;
  color: ${theme.text};
  border: 1px solid ${theme.inputBorder};
  border-radius: ${vars.controlBorderRadius};
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

export const cssCollapseIcon = styled(icon, `
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
