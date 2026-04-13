/**
 * Generic card components for setup UI sections.
 *
 * Provides reusable building blocks: HeroCard, ItemCard, CardList,
 * and buildBadge. No domain-specific logic — callers compose these
 * to build section-specific UIs.
 *
 * All options are data-driven: plain values or Bindable<T> for reactivity.
 */
import { basicButton, textButton } from "app/client/ui2018/buttons";
import { labeledSquareCheckbox } from "app/client/ui2018/checkbox";
import { theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { useBindable } from "app/common/gutil";

import {
  BindableValue, Disposable, dom, DomContents, DomElementArg,
  makeTestId, Observable, styled,
} from "grainjs";

const testId = makeTestId("test-setup-card-");

// =========================================================================
// Components
// =========================================================================

/**
 * A prominent status card with indicator, header, controls, and footer.
 *
 * ```
 * dom.create(HeroCard, {
 *   indicator: "success",
 *   header: "OIDC",
 *   badges: [{ label: "Active", variant: "primary" }],
 *   text: "Your server authenticates users via OpenID Connect.",
 *   buttons: [
 *     { label: "Reconfigure", action: () => reconfigure() },
 *     { label: "Deactivate", action: () => deactivate() },
 *   ],
 *   footer: {
 *     text: "Installation admin:",
 *     boldText: "admin@example.com",
 *     actions: [{ label: "Change admin", action: () => changeAdmin() }],
 *   },
 * })
 * ```
 */
export class HeroCard extends Disposable {
  constructor(private _options: HeroCardOptions) {
    super();
  }

  public buildDom() {
    const o = this._options;
    const hasControls = o.checkbox || o.buttons;
    const hasFooter = o.footer;

    return cssHeroCard(
      // Indicator
      dom.cls(use => `${cssHeroCard.className}-${useBindable(use, o.indicator)}`),
      testId("hero"),

      // Header
      cssHeroHeader(
        cssHeroTitle(dom.text(o.header)),
        ...(o.badges ?? []).map(b => buildBadge(b.label, b.variant)),
      ),

      // Text
      o.text ? cssHeroText(dom.text(o.text)) : null,

      // Error
      o.error ? cssHeroError(dom.text(o.error)) : null,

      // Controls
      hasControls ? cssHeroControls(
        o.checkbox
          ? labeledSquareCheckbox(o.checkbox.checked, o.checkbox.label)
          : null,
        o.buttons?.length
          ? cssHeroControlButtons(
              ...o.buttons.map(b => basicButton(b.label, dom.on("click", b.action))),
            )
          : null,
      ) : null,

      // Footer
      hasFooter ? cssHeroFooter(
        o.footer!.text ? dom("span", o.footer!.text,
          o.footer!.boldText ? dom("strong", o.footer!.boldText) : null,
        ) : null,
        ...(o.footer!.actions ?? []).map(a => textButton(a.label, dom.on("click", a.action))),
      ) : null,

      ...(o.args ?? []),
    );
  }
}

/**
 * A row card for use inside a CardList, with indicator, header, and optional error.
 *
 * ```
 * dom.create(ItemCard, {
 *   indicator: "active",
 *   header: "OIDC",
 *   badges: [{ label: "Active", variant: "primary" }],
 *   buttons: [
 *     { label: "Configure", action: () => configure() },
 *   ],
 *   text: "Works with most identity providers.",
 *   error: { header: "Error details", message: "Missing GRIST_OIDC_IDP_CLIENT_ID" },
 * })
 * ```
 */
export class ItemCard extends Disposable {
  constructor(private _options: ItemCardOptions) {
    super();
  }

  public buildDom() {
    const o = this._options;

    return cssItemRow(
      // Indicator
      o.indicator ? cssItemRow.cls(`-border-${o.indicator}`) : null,
      testId("item"),

      // Header
      cssItemHeader(
        cssItemLabel(dom.text(o.header)),
        ...(o.badges ?? []).map(b => buildBadge(b.label, b.variant)),
        cssFlex(),
        ...(o.buttons ?? []).map(b => basicButton(
          b.label,
          b.disabled ? dom.prop("disabled", true) : null,
          b.action ? dom.on("click", b.action) : null,
        )),
      ),

      // Text
      o.text ? cssItemText(dom.text(o.text)) : null,

      // Error
      o.error ? dom("div",
        cssErrorHeader(dom.text(o.error.header)),
        cssErrorMessage(dom.text(o.error.message)),
      ) : null,

      // Info
      o.info ? cssItemInfo(dom.text(o.info)) : null,

      ...(o.args ?? []),
    );
  }
}

/**
 * A collapsible list of ItemCards with a section header.
 *
 * ```
 * dom.create(CardList, {
 *   header: "Other authentication methods",
 *   collapsible: true,
 *   initiallyCollapsed: true,
 *   collapseObs: someCheckboxObs,
 *   items: [
 *     dom.create(ItemCard, { header: "OIDC", ... }),
 *     dom.create(ItemCard, { header: "SAML", ... }),
 *   ],
 * })
 * ```
 */
export class CardList extends Disposable {
  private _collapsed: Observable<boolean> | null = null;

  constructor(private _options: CardListOptions) {
    super();

    if (_options.collapsible) {
      this._collapsed = Observable.create(this, _options.initiallyCollapsed ?? false);

      if (_options.collapseObs) {
        this.autoDispose(_options.collapseObs.addListener(val => this._collapsed!.set(val)));
      }
    }
  }

  public buildDom() {
    const { header, items, collapsible, args } = this._options;
    if (items.length === 0) { return dom("div"); }

    const buildCards = () => cssItemsContainer(...items);

    if (!collapsible || !this._collapsed) {
      return dom("div",
        cssListHeader(header, ...(args ?? [])),
        buildCards(),
      );
    }

    const collapsed = this._collapsed;
    const toggle = () => collapsed.set(!collapsed.get());

    return dom("div",
      cssListHeaderClickable(
        dom.domComputed(collapsed, c => cssCollapseIcon(c ? "Expand" : "Collapse")),
        header,
        dom.on("click", toggle),
        dom.on("keydown", (ev: KeyboardEvent) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            toggle();
          }
        }),
        dom.attr("tabindex", "0"),
        dom.attr("role", "button"),
        dom.attr("aria-expanded", use => String(!use(collapsed))),
        ...(args ?? []),
      ),
      dom.maybe(use => !use(collapsed), buildCards),
    );
  }
}

export function buildBadge(label: string, variant: BadgeVariant, ...args: DomElementArg[]): HTMLElement {
  return cssBadge(label, cssBadge.cls(`-${variant}`), ...args);
}

// =========================================================================
// Types
// =========================================================================

export type HeroVariant = "success" | "pending" | "warning" | "error";

export type ItemBorderVariant = "active" | "configured" | "error";

export type BadgeVariant = "primary" | "warning" | "error";

export interface BadgeConfig {
  label: string;
  variant: BadgeVariant;
}

export interface ButtonConfig {
  label: string;
  action: () => void;
}

export interface ItemButtonConfig {
  label: string;
  action?: () => void;
  disabled?: boolean;
}

export interface HeroCardOptions {
  /** Indicator — left border color. */
  indicator: BindableValue<HeroVariant>;
  /** Header — title text. */
  header: BindableValue<string>;
  /** Header › Badges. */
  badges?: BadgeConfig[];
  /** Text — description below header. */
  text?: BindableValue<string>;
  /** Error — error message. */
  error?: BindableValue<string>;
  /** Controls › Checkbox. */
  checkbox?: { label: string; checked: Observable<boolean> };
  /** Controls › Buttons. */
  buttons?: ButtonConfig[];
  /** Footer. */
  footer?: {
    text?: string;
    boldText?: string;
    actions?: ButtonConfig[];
  };
  args?: DomElementArg[];
}

export interface ItemCardOptions {
  /** Indicator — left border color. */
  indicator?: ItemBorderVariant;
  /** Header — title text. */
  header: BindableValue<string>;
  /** Header › Badges. */
  badges?: BadgeConfig[];
  /** Header › Buttons. */
  buttons?: ItemButtonConfig[];
  /** Text — description/hint below header. */
  text?: BindableValue<string>;
  /** Error — header + message. */
  error?: { header: BindableValue<string>; message: BindableValue<string> };
  /** Info — informational text. */
  info?: BindableValue<string>;
  args?: DomElementArg[];
}

export interface CardListOptions {
  header: string;
  items: DomContents[];
  collapsible?: boolean;
  initiallyCollapsed?: boolean;
  /** External observable to drive collapse state. */
  collapseObs?: Observable<boolean>;
  args?: DomElementArg[];
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
`);

const cssHeroHeader = styled("div", `
  display: flex;
  align-items: center;
  gap: 12px;
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
  &-border-error {
    border-left-color: ${theme.errorText};
  }
`);

const cssItemHeader = styled("div", `
  display: flex;
  flex-direction: row;
  align-items: center;
  flex: 1;
  gap: 12px;
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

const cssErrorHeader = styled("div", `
  color: ${theme.errorText};
  font-weight: 600;
  font-size: ${vars.smallFontSize};
  margin-top: 8px;
  margin-bottom: 4px;
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
  &:focus-visible {
    outline: 2px solid ${theme.controlFg};
    outline-offset: 2px;
    border-radius: 2px;
  }
`);

const cssCollapseIcon = styled(icon, `
  width: 16px;
  height: 16px;
  --icon-color: ${theme.lightText};
`);
