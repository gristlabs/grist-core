/**
 * Generic card components for setup UI sections.
 *
 * Provides reusable building blocks: HeroCard, buildItemCard, CardList,
 * and buildBadge.
 *
 * All options are data-driven: plain values or Bindable<T> for reactivity.
 */
import { basicButton } from "app/client/ui2018/buttons";
import { theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { cssRadioInput } from "app/client/ui2018/radio";
import { useBindable } from "app/common/gutil";

import {
  BindableValue, dom, DomContents, DomElementArg,
  makeTestId, MaybeObsArray, Observable, styled,
} from "grainjs";

const testId = makeTestId("test-setup-card-");

/**
 * First card in the setup - a Hero card.
 *
 * ```
 * buildHeroCard({
 *   indicator: "success",
 *   header: "OIDC",
 *   badges: [{ label: "Active", variant: "primary" }],
 *   text: "Your server authenticates users via OpenID Connect.",
 *   checkbox: labeledSquareCheckbox(myObs, "Enable feature"),
 *   buttons: [basicButton("Reconfigure", dom.on("click", reconfigure)), basicButton("Deactivate", dom.on("click", deactivate))],
 *   footer: [
 *     dom("span", "Installation admin:", dom("strong", "admin@example.com")),
 *     textButton("Change admin", dom.on("click", () => changeAdmin())),
 *   ],
 * })
 * ```
 */
export function buildHeroCard(props: {
  /** Indicator — left border color. */
  indicator: BindableValue<HeroVariant>;
  /** Radio button on the left side of the card. */
  radio?: RadioConfig;
  /** Header text. */
  header: BindableValue<string>;
  /** Header tag, like Recommended */
  tags?: TagConfig[];
  /** Header badges. */
  badges?: MaybeObsArray<BadgeConfig>;
  /** Text - main content. */
  text?: BindableValue<string>;
  /** Error message. */
  error?: BindableValue<string>;
  /** Controls / Checkbox (e.g. labeledSquareCheckbox(...)). */
  checkbox?: DomContents;
  /** Controls / Buttons (e.g. basicButton(...)). */
  buttons?: DomContents;
  /** Footer content (rendered inside a styled footer bar). */
  footer?: DomContents;
  args?: DomElementArg[];
}) {
  const hasControls = props.checkbox || props.buttons;
  const hasFooter = props.footer;

  const content = cssHeroCardContent(
    cssHeroHeader(
      cssHeroTitle(
        dom.text(props.header),
        ...(props.tags ?? []).map(t => cssTag(t.label)),
      ),
      props.badges ? dom.forEach(props.badges, b => buildBadge(b.label, b.variant)) : null,
    ),
    props.text ? cssHeroText(dom.text(props.text)) : null,
    props.error ? cssHeroError(dom.text(props.error)) : null,
    hasControls ? cssHeroControls(
      props.checkbox ?? null,
      props.buttons ? cssHeroControlButtons(props.buttons) : null,
    ) : null,
    hasFooter ? cssHeroFooter(props.footer!) : null,
  );

  return cssHeroCard(
    dom.cls(use => {
      const v = useBindable(use, props.indicator);
      return v ? `${cssHeroCard.className}-${v}` : '';
    }),
    testId("hero"),
    props.radio ? cssCardWithRadio(
      buildRadioInput(props.radio),
      content,
    ) : content,
    props.radio?.disabled ? dom.cls(DISABLED_CLASS, props.radio.disabled) : null,
    ...(props.args ?? []),
  );
}

/**
 * A row card for use inside a CardList, with indicator, header, and optional error.
 *
 * ```
 * buildItemCard({
 *   indicator: "active",
 *   header: "OIDC",
 *   badges: [{ label: "Active", variant: "primary" }],
 *   buttons: [{ label: "Configure", action: () => configure() }],
 *   text: "Works with most identity providers.",
 * })
 * ```
 */
export function buildItemCard(props: {
  /** Indicator — left border color. */
  indicator?: BindableValue<ItemBorderVariant | undefined>;
  /** Radio button on the left side of the card. */
  radio?: RadioConfig;
  /** Header — title text. */
  header: BindableValue<string>;
  /** Header › Tags (superscript accent labels). */
  tags?: TagConfig[];
  /** Header › Badges. */
  badges?: MaybeObsArray<BadgeConfig>;
  /** Header › Buttons. */
  buttons?: ItemButtonConfig[];
  /** Text — description/hint below header. */
  text?: BindableValue<string>;
  /** Error message — shown in red. */
  error?: BindableValue<string>;
  /** Info — informational text (gray). */
  info?: BindableValue<string>;
  args?: DomElementArg[];
}) {
  const content = cssItemContent(
    // Header
    cssItemHeader(
      cssItemLabel(
        dom.text(props.header),
        ...(props.tags ?? []).map(t => cssTag(t.label)),
      ),
      props.badges ? dom.forEach(props.badges, b => buildBadge(b.label, b.variant)) : null,
      cssFlex(),
      ...(props.buttons ?? []).map(b => basicButton(
        b.label,
        b.disabled ? dom.prop("disabled", true) : null,
        b.action ? dom.on("click", b.action) : null,
      )),
    ),

    props.text ? cssItemText(dom.text(props.text)) : null,
    props.error ? dom.maybe(props.error, (e) => cssErrorMessage(e)) : null,
    props.info ? cssItemInfo(dom.text(props.info)) : null,
  );

  return cssItemRow(
    props.indicator != null
      ? typeof props.indicator === "string"
        ? (props.indicator ? cssItemRow.cls(`-border-${props.indicator}`) : null)
        : dom.cls(use => {
            const val = useBindable(use, props.indicator!);
            return val ? `${cssItemRow.className}-border-${val}` : '';
          })
      : null,
    testId("item"),
    props.radio ? cssCardWithRadio(
      buildRadioInput(props.radio),
      content,
    ) : content,
    props.radio?.disabled ? dom.cls(DISABLED_CLASS, props.radio.disabled) : null,
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
 *   collapseObs: someCheckboxObs,
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
      ...(args ?? []),
    ),
    dom.maybe(use => !use(collapsed), buildCards),
  );
}

function buildRadioInput(radio: RadioConfig): HTMLElement {
  return cssRadioInput({ type: "radio" },
    dom.prop("checked", radio.checked),
    radio.disabled ? dom.prop("disabled", radio.disabled) : null,
    dom.on("change", () => radio.onSelect()),
    radio.name ? dom.attr("name", radio.name) : null,
  );
}

const DISABLED_CLASS = "setup-card-disabled";

export function buildBadge(label: string, variant: BadgeVariant, ...args: DomElementArg[]): HTMLElement {
  return cssBadge(label, cssBadge.cls(`-${variant}`), ...args);
}

// =========================================================================
// Types
// =========================================================================

export type HeroVariant = "success" | "pending" | "warning" | "error" | "";

export type ItemBorderVariant = "active" | "configured" | "warning" | "error";

export type BadgeVariant = "primary" | "warning" | "error" | "accent";

export interface BadgeConfig {
  label: string;
  variant: BadgeVariant;
}

export interface TagConfig {
  label: string;
}

export interface ItemButtonConfig {
  label: string;
  action?: () => void;
  disabled?: boolean;
}


export interface RadioConfig {
  /** Whether this radio is currently selected. */
  checked: BindableValue<boolean>;
  /** Called when the user clicks this radio. */
  onSelect: () => void;
  /** Shared radio group name (for native radio exclusivity). */
  name?: string;
  /** When true, radio is disabled and the whole card is grayed out. */
  disabled?: BindableValue<boolean>;
}



// =========================================================================
// Styled components
// =========================================================================

const cssBadge = styled("div", `
  padding: 2px 8px;
  color: ${theme.lightText};
  border: 1px solid ${theme.lightText};
  font-size: ${vars.xsmallFontSize};
  font-weight: 600;
  border-radius: 16px;
  text-transform: uppercase;
  white-space: nowrap;
  &-primary {
    border-color: ${theme.controlPrimaryBg};
    color: ${theme.controlPrimaryBg};
  }
  &-warning {
    border-color: #ffb535;
    color: ${theme.toastWarningBg}
  }
  &-error {
    border-color: ${theme.errorText};
    color: ${theme.errorText};
  }
  &-accent {
    border-color: ${theme.accentText};
    color: ${theme.accentText};
  }
`);

const cssTag = styled("span", `
  text-transform: uppercase;
  vertical-align: super;
  font-size: ${vars.xsmallFontSize};
  font-weight: 600;
  line-height: 1;
  color: ${theme.accentText};
  margin-left: 6px;
`);

const cssHeroCard = styled("div", `
  padding: 16px 20px;
  border-radius: 8px;
  border: 1px solid ${theme.menuBorder};
  border-left-width: 4px;
  margin-bottom: 24px;

  &-success {
    border-left-color: ${theme.toastSuccessBg};
  }
  &-pending {
    border-left-color: ${theme.controlPrimaryBg};
  }
  &-warning {
    border-left-color: ${theme.toastWarningBg};
  }
  &-error {
    border-left-color: ${theme.errorText};
  }

  &.${DISABLED_CLASS} {
    background-color: ${theme.pageBg};
    pointer-events: none;
  }
`);

const cssHeroHeader = styled("div", `
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 8px;
`);

const cssHeroTitle = styled("div", `
  font-size: ${vars.largeFontSize};
  font-weight: 600;
  color: ${theme.text};
`);

const cssHeroText = styled("div", `
  color: ${theme.lightText};
  font-size: ${vars.mediumFontSize};
  line-height: 1.4;
  margin-bottom: 8px;
`);

const cssHeroError = styled("div", `
  color: ${theme.errorText};
  font-size: ${vars.mediumFontSize};
  margin-bottom: 8px;
`);

const cssHeroControls = styled("div", `
  margin-top: 12px;
`);

const cssHeroControlButtons = styled("div", `
  display: flex;
  gap: 8px;
  margin-top: 8px;
`);

const cssHeroFooter = styled("div", `
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid ${theme.menuBorder};
  font-size: ${vars.mediumFontSize};
  color: ${theme.lightText};
`);

const cssItemsContainer = styled("div", `
  display: flex;
  flex-direction: column;
  border: 1px solid ${theme.menuBorder};
  border-radius: 8px;
  overflow: hidden;
`);

const cssItemRow = styled("div", `
  display: flex;
  gap: 16px;
  flex-direction: column;
  padding: 16px;
  background-color: ${theme.mainPanelBg};
  border-bottom: 1px solid ${theme.menuBorder};
  border-left: 3px solid transparent;
  &:last-child {
    border-bottom: none;
  }
  &-border-active {
    border-left-color: ${theme.toastSuccessBg};
  }
  &-border-configured {
    border-left-color: ${theme.controlPrimaryBg};
  }
  &-border-warning {
    border-left-color: ${theme.toastWarningBg};
  }
  &-border-error {
    border-left-color: ${theme.errorText};
  }

  &.${DISABLED_CLASS} {
    background-color: ${theme.pageBg};
    pointer-events: none;
  }
`);

const cssCardWithRadio = styled("div", `
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 12px;

  & > input[type="radio"] {
    margin-top: 2px;
  }
`);

const cssHeroCardContent = styled("div", `
  flex: 1;
  min-width: 0;
`);

const cssItemContent = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
  min-width: 0;
`);

const cssItemHeader = styled("div", `
  display: flex;
  flex-direction: row;
  align-items: center;
  flex: 1;
  gap: 16px;
`);

const cssItemLabel = styled("div", `
  font-size: ${vars.mediumFontSize};
  color: ${theme.text};
`);

const cssItemText = styled("div", `
  color: ${theme.lightText};
  font-size: ${vars.smallFontSize};
  & a {
    color: ${theme.controlFg};
  }
`);

const cssItemInfo = styled("div", `
  color: ${theme.lightText};
`);

const cssErrorMessage = styled("div", `
  color: ${theme.errorText};
  margin-top: 4px;
`);

const cssFlex = styled("div", `
  flex: 1;
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
`);

const cssCollapseIcon = styled(icon, `
  width: 16px;
  height: 16px;
  --icon-color: ${theme.lightText};
`);
