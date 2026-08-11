/**
 * Generic card components for setup UI sections.
 *
 * Provides reusable building blocks: buildHeroCard, buildItemCard, and buildCardList.
 *
 * All options are data-driven: plain values or Bindable<T> for reactivity.
 */
import { cssCardSurface } from "app/client/ui/SettingsLayout";
import { cssCheckboxCircle } from "app/client/ui2018/checkbox";
import { theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { useBindable } from "app/common/gutil";
import { tokens } from "app/common/ThemePrefs";

import {
  BindableValue, dom, DomContents, DomElementArg,
  makeTestId, Observable, styled,
} from "grainjs";

const testId = makeTestId("test-setup-card-");

/**
 * First card in the setup — the hero: an item card with hero sizing (larger padding and
 * title, bottom margin separating it from the list below), sharing the item card's
 * indicator stripe, selection styling, and whole-card click behavior.
 *
 * ```
 * buildHeroCard({
 *   indicator: "active",
 *   header: "OIDC",
 *   badges: [{ label: "Active", variant: "primary" }],
 *   text: "Your server authenticates users via OpenID Connect.",
 * })
 * ```
 */
export function buildHeroCard(props: Omit<ItemCardProps, "muted" | "onClick">) {
  return buildItemCard({
    ...props,
    args: [cssItemRow.cls("-hero"), testId("hero"), ...(props.args ?? [])],
  });
}

/**
 * The card/hero body: header (+ inline and right-aligned badges), description, and anything
 * below it (error, info, extra). buildItemCard wraps this with the card surface, radio, and
 * indicator; the authentication section's heroes wrap it with their own frame and admin-row footer.
 */
export interface ItemContentProps {
  /** Header — title text. */
  header: BindableValue<string>;
  /** Header › Badges (inline chips after the name): use buildBadge() */
  badges?: DomContents,
  /** Right-aligned label chips (e.g. "Requires activation key"): use buildBadge(). */
  rightBadges?: DomContents,
  /** Text — description/hint below header. */
  text?: BindableValue<string>;
  /** Error message — shown in red. */
  error?: BindableValue<string>;
  /** Info — informational text (gray). */
  info?: BindableValue<string>;
  /** Extra content rendered below the description (wells, env notes). */
  extra?: DomContents;
}

/**
 * A row card for use inside a CardList, with indicator, header, and optional error.
 *
 * ```
 * buildItemCard({
 *   indicator: "active",
 *   header: "OIDC",
 *   badges: [{ label: "Active", variant: "primary" }],
 *   radio: { checked: isActive, onSelect: () => activate() },
 *   text: "Works with most identity providers.",
 * })
 * ```
 */
export interface ItemCardProps extends ItemContentProps {
  /** Indicator — colored stripe on the card's left edge, tinting the left border to match. */
  indicator?: BindableValue<ItemBorderVariant | undefined>;
  /** Radio button on the left side of the card. */
  radio?: RadioConfig;
  /** Whole-card click handler. Defaults to the radio's onSelect when one is given, since
   * the radio glyph itself is presentational (see buildItemRadio) and can't receive clicks. */
  onClick?: () => void;
  /** Muted (no-auth) variant — plain background, no accent. */
  muted?: boolean;
  args?: DomElementArg[];
}

/** The shared card/hero body. */
export function buildItemContent(props: ItemContentProps) {
  return cssItemContent(
    // Header
    cssItemHeader(
      cssItemLabel(
        dom.text(props.header),
        testId("header"),
      ),
      props.badges,
      cssFlex(),
      props.rightBadges,
    ),

    props.text ? cssItemText(dom.text(props.text)) : null,
    props.error ? dom.maybe(props.error, e => buildCollapsibleError(e)) : null,
    props.info ? cssItemInfo(cssItemInfoIcon("Info"), dom.text(props.info)) : null,
    props.extra ?? null,
  );
}

export function buildItemCard(props: ItemCardProps) {
  // The radio glyph is presentational (pointer-events: none), so the card is the click target;
  // it falls back to the radio's onSelect.
  const { radio } = props;
  const cardClick = props.onClick ??
    (radio?.onSelect && !radio.disabled ? () => radio.onSelect!() : undefined);

  const content = buildItemContent(props);

  return cssItemRow(
    props.indicator != null ?
      typeof props.indicator === "string" ?
        (props.indicator ? cssItemRow.cls(`-border-${props.indicator}`) : null) :
        dom.cls((use) => {
          const val = useBindable(use, props.indicator);
          return val ? `${cssItemRow.className}-border-${val}` : "";
        }) :
      null,
    props.muted ? cssItemRow.cls("-muted") : null,
    props.radio ? cssItemRow.cls("-selected", props.radio.checked) : null,
    props.radio?.disabled && !cardClick ? cssItemRow.cls("-disabled", props.radio.disabled) : null,
    cardClick ? [
      cssItemRow.cls("-clickable"),
      // Keyboard operability: only interactive cards get a tab stop. Full radiogroup arrow-key
      // semantics (Up/Down moving selection) is a deliberate follow-up, not done here.
      { tabindex: "0", role: "button" },
      dom.on("click", cardClick),
      dom.on("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          cardClick();
        }
      }),
    ] : null,
    testId("item"),
    props.radio ? buildItemRadio(props.radio) : null,
    content,
    ...(props.args ?? []),
  );
}

/**
 * A collapsible list of ItemCards with a section header.
 *
 * ```
 * buildCardList({
 *   header: "Other authentication methods",
 *   collapsible: true,
 *   initiallyCollapsed: true,
 *   items: [
 *     buildItemCard({ header: "OIDC", ... }),
 *     buildItemCard({ header: "SAML", ... }),
 *   ],
 * })
 * ```
 */
export function buildCardList(props: {
  header: string;
  items: DomContents[];
  collapsible?: boolean;
  initiallyCollapsed?: boolean;
  args?: DomElementArg[];
}) {
  const { header, items, collapsible, args } = props;
  if (items.length === 0) { return dom("div"); }

  const buildCards = () => cssItemsContainer(...items);

  if (!collapsible) {
    return dom("div",
      cssListHeader(header, ...(args ?? [])),
      buildCards(),
    );
  }

  const collapsed = Observable.create(null, props.initiallyCollapsed ?? false);
  const toggle = () => collapsed.set(!collapsed.get());

  return dom("div",
    dom.autoDispose(collapsed),
    cssListHeaderClickable(
      dom.domComputed(collapsed, c => cssCollapseIcon(c ? "Expand" : "Collapse")),
      header,
      dom.on("click", toggle),
      dom.on("keydown", (ev: KeyboardEvent) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggle(); }
      }),
      dom.attr("tabindex", "0"),
      dom.attr("role", "button"),
      dom.attr("aria-expanded", use => String(!use(collapsed))),
      ...(args ?? []),
    ),
    dom.maybe(use => !use(collapsed), buildCards),
  );
}

/**
 * The check-glyph radio used by item cards: a status circle carrying the whole state in one
 * glyph (checked = active, disabled = grayed out). Presentational only — the card itself
 * drives selection (see buildItemCard's cardClick). A checkbox input rather than a radio:
 * an unchecked radio whose group has no selection matches :indeterminate, triggering the
 * checkbox CSS's filled minus-glyph look.
 */
export function buildItemRadio(radio: RadioConfig): HTMLElement {
  return cssItemRadio({ "type": "checkbox", "tabindex": "-1", "aria-hidden": "true" },
    dom.prop("checked", radio.checked),
    radio.disabled ? dom.prop("disabled", radio.disabled) : null,
  );
}

function buildCollapsibleError(error: BindableValue<string>): DomContents {
  const expanded = Observable.create(null, false);
  return cssErrorContainer(
    dom.autoDispose(expanded),
    cssErrorToggle(
      dom.on("click", () => expanded.set(!expanded.get())),
      dom.domComputed(expanded, e => cssCollapseIcon(e ? "Collapse" : "Expand")),
      cssErrorToggleLabel("Error details"),
    ),
    dom.maybe(expanded, () => cssErrorText(dom.text(error))),
  );
}

// Outside a cssLabel, so it sets the base --color itself. The margin-top centers the 16px
// glyph on the name row's 22px first line (see cssItemLabel).
const cssItemRadio = styled(cssCheckboxCircle, `
  flex: none;
  margin-top: 3px !important;
  pointer-events: none;
  --color: ${theme.checkboxBorder};
`);

export function buildBadge(label: string, variant: BadgeVariant, ...args: DomElementArg[]): HTMLElement {
  return cssBadge(label, cssBadge.cls(`-${variant}`), testId("badge"), ...args);
}

const cssBadge = styled("span", `
  display: inline-block;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: ${tokens.smallFontSize};
  font-weight: 600;
  white-space: nowrap;
  border: 1px solid transparent;

  &-primary {
    background-color: ${tokens.primary};
    color: ${tokens.white};
  }
  &-pending {
    background-color: #ffb535;
    color: white;
  }
  &-grey {
    background-color: ${tokens.secondary};
    color: white;
  }
  &-accent {
    border-color: ${tokens.primary};
    color: ${tokens.primary};
  }
  &-warning {
    border-color: #ffb535;
    color: ${tokens.body};
  }
  &-error {
    border-color: ${theme.errorText};
    color: ${theme.errorText};
  }
`);

// =========================================================================
// Types
// =========================================================================

export type ItemBorderVariant = "active" | "configured" | "warning" | "error";

export type BadgeVariant = "primary" | "warning" | "error" | "accent" | "pending" | "grey";

export interface RadioConfig {
  /** Whether this radio is currently selected. */
  checked: BindableValue<boolean>;
  /** Select this option. The glyph itself is presentational; this is the whole-card click's
   * default handler (see buildItemCard). Omit for a pure status glyph, as in Auth's hero. */
  onSelect?: () => void;
  /** When true, radio is disabled; the card is also grayed out unless it has its own onClick. */
  disabled?: boolean;
}

// =========================================================================
// Styled components
// =========================================================================

/** Hero sizing, reused by the authentication section's hand-built hero. */
export const cssHeroCard = styled(cssCardSurface, `
  padding: 16px 20px;
  margin-bottom: 24px;
`);

export const cssItemsContainer = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 8px;
`);

const cssItemRow = styled(cssCardSurface, `
  align-items: flex-start;
  display: flex;
  gap: 12px;
  padding: 14px 18px;
  transition: border-color 0.2s, background-color 0.2s;
  position: relative;
  overflow: hidden;

  &-clickable {
    cursor: pointer;
  }
  &-clickable:hover {
    border-color: ${tokens.primary};
  }
  &-selected {
    border-color: ${tokens.primary};
  }
  &-disabled {
    border-color: ${tokens.decorationSecondary};
    cursor: not-allowed;
  }
  &-disabled:hover {
    border-color: ${tokens.decorationSecondary};
    box-shadow: none;
  }
  &-muted {
    background-color: ${tokens.bgSecondary};
  }
  &:focus-visible {
    outline: 2px solid ${tokens.primary};
    outline-offset: 1px;
  }
  &-hero {
    padding: 16px 20px;
    margin-bottom: 24px;
  }
  &-border-active {
    --indicator-color: ${theme.toastSuccessBg};
  }
  &-border-configured {
    --indicator-color: ${theme.controlPrimaryBg};
  }
  &-border-warning {
    --indicator-color: ${theme.toastWarningBg};
  }
  &-border-error {
    --indicator-color: ${theme.errorText};
  }
  /* The stripe tints the left border to match, so it doesn't clash with the selected/hover
   * border color; !important because -clickable:hover outranks this selector's specificity. */
  &-border-active, &-border-configured, &-border-warning, &-border-error {
    border-left-color: var(--indicator-color) !important;
  }
  &-border-active::before, &-border-configured::before, &-border-warning::before, &-border-error::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    width: 3px;
    background-color: var(--indicator-color);
  }
`);

export const cssItemContent = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
`);

export const cssItemHeader = styled("div", `
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`);

export const cssItemLabel = styled("span", `
  font-weight: 600;
  line-height: 22px;

  .${cssItemRow.className}-hero & {
    font-size: ${vars.largeFontSize};
  }
`);

export const cssItemText = styled("div", `
  color: ${tokens.secondary};
  font-size: ${vars.mediumFontSize};
  line-height: 1.5;
`);

/** A status annotation (e.g. why a card is unavailable), set apart from the description
 * by its Info icon. */
export const cssItemInfo = styled("div", `
  display: flex;
  align-items: flex-start;
  gap: 6px;
  color: ${tokens.secondary};
  font-size: ${vars.mediumFontSize};
  margin-top: 2px;
`);

const cssItemInfoIcon = styled(icon, `
  flex: none;
  --icon-color: ${tokens.decoration};
`);

export const cssFlex = styled("div", `
  flex: 1;
`);

/** Action-button row inside a hero card's body. */
export const cssHeroActions = styled("div", `
  display: flex;
  gap: 8px;
  &:not(:empty) {
    margin-top: 12px;
  }
`);

export const cssItemError = styled("div", `
  color: ${theme.errorText};
  font-size: ${vars.mediumFontSize};
`);

const cssListHeader = styled("div", `
  font-size: ${vars.mediumFontSize};
  font-weight: 600;
  color: ${theme.lightText};
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
`);

const cssListHeaderClickable = styled(cssListHeader, `
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 4px;
  &:hover {
    color: ${theme.text};
  }
  /* Inset the focus ring with box-shadow so it isn't clipped by ancestor
     overflow boundaries (the section sits inside a card with overflow:hidden). */
  &:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px ${theme.controlFg};
    border-radius: 4px;
  }
`);

const cssCollapseIcon = styled(icon, `
  width: 16px;
  height: 16px;
  --icon-color: ${theme.lightText};
`);

const cssErrorContainer = styled("div", `
  margin-top: 4px;
`);

const cssErrorToggle = styled("div", `
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  color: ${theme.errorText};
  font-size: ${vars.smallFontSize};
  user-select: none;
  &:hover {
    text-decoration: underline;
  }
`);

const cssErrorToggleLabel = styled("span", `
  font-weight: 600;
`);

const cssErrorText = styled("div", `
  color: ${theme.errorText};
  font-size: ${vars.smallFontSize};
  margin-top: 4px;
  padding: 8px;
  background: ${theme.mainPanelBg};
  border-radius: 4px;
  word-break: break-word;
`);
