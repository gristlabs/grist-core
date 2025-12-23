/**
 * CSS Variables.
 *
 * This file has two roles:
 *  - appending theme-agnostic CSS variables and global CSS rules to the DOM with `attachCssRootVars`.
 *  - (deprecated) exposing the design tokens to the rest of the codebase.
 *    Prefer using the {@link tokens} object directly.
 *
 * Note that theme-related CSS variables (like colors and font families) are added to the DOM
 * with `theme.ts#attachCssThemeVars` and are required to be attached, as most theme-agnostic
 * CSS variables described below consume those variables.
 */
import { getOrCreateStyleElement } from "app/client/lib/getOrCreateStyleElement";
import { urlState } from "app/client/models/gristUrlState";
import { getTheme, ProductFlavor } from "app/client/ui/CustomThemes";
import { CssCustomProp as CustomProp } from "app/common/CssCustomProp";
import { components, tokens } from "app/common/ThemePrefs";

import { DomElementMethod, makeTestId, Observable, styled, TestId } from "grainjs";
import debounce from "lodash/debounce";
import values from "lodash/values";

/**
 * @deprecated Consume the {@link tokens} object directly
 *
 * Before having most cssVars theme-related (listed in `tokens`), we had a list of colors
 * defined here, consumed by the whole codebase.
 *
 * This is kept for now:
 * - to prevent having to update the whole codebase to target the new `tokens` structure for now,
 * - to make old css variables still work in case people used them in plugins or custom css.
 */
export const colors = {
  lightGrey: new CustomProp("color-light-grey", tokens.bgSecondary),
  mediumGrey: new CustomProp("color-medium-grey", tokens.bgTertiary),
  mediumGreyOpaque: new CustomProp("color-medium-grey-opaque", tokens.decorationSecondary),
  darkGrey: new CustomProp("color-dark-grey", tokens.decoration),

  light: new CustomProp("color-light", tokens.white),
  dark: new CustomProp("color-dark", tokens.body),
  darkText: new CustomProp("color-dark-text", "#494949"),
  darkBg: new CustomProp("color-dark-bg", tokens.bgEmphasis),
  slate: new CustomProp("color-slate", tokens.secondary),

  lighterGreen: new CustomProp("color-lighter-green", tokens.primaryEmphasis),
  lightGreen: new CustomProp("color-light-green", tokens.primary),
  darkGreen: new CustomProp("color-dark-green", tokens.primaryMuted),
  darkerGreen: new CustomProp("color-darker-green", tokens.primaryDim),

  lighterBlue: new CustomProp("color-lighter-blue", tokens.infoLight),
  lightBlue: new CustomProp("color-light-blue", tokens.info),
  orange: new CustomProp("color-orange", tokens.warningLight),

  cursor: new CustomProp("color-cursor", tokens.cursor),
  selection: new CustomProp("color-selection", tokens.selection),
  selectionOpaque: new CustomProp("color-selection-opaque", tokens.selectionOpaque),
  selectionDarkerOpaque: new CustomProp("color-selection-darker-opaque", tokens.selectionDarkerOpaque),

  inactiveCursor: new CustomProp("color-inactive-cursor", tokens.cursorInactive),

  hover: new CustomProp("color-hover", tokens.hover),
  error: new CustomProp("color-error", tokens.error),
  warning: new CustomProp("color-warning", tokens.warningLight),
  warningBg: new CustomProp("color-warning-bg", tokens.warning),
  backdrop: new CustomProp("color-backdrop", tokens.backdrop),
};

/**
 * zIndexes are listed on their own and can't be modified by themes.
 */
export const zIndexes = {
  stickyHeaderZIndex: new CustomProp("sticky-header-z-index", "20"),
  insertColumnLineZIndex: new CustomProp("insert-column-line-z-index", "20"),
  emojiPickerZIndex: new CustomProp("modal-z-index", "20"),
  newRecordButtonZIndex: new CustomProp("new-record-button-z-index", "30"),
  popupSectionBackdropZIndex: new CustomProp("popup-section-backdrop-z-index", "100"),
  menuZIndex: new CustomProp("menu-z-index", "999"),
  modalZIndex: new CustomProp("modal-z-index", "999"),
  onboardingBackdropZIndex: new CustomProp("onboarding-backdrop-z-index", "999"),
  onboardingPopupZIndex: new CustomProp("onboarding-popup-z-index", "1000"),
  floatingPopupZIndex: new CustomProp("floating-popup-z-index", "1002"),
  tutorialModalZIndex: new CustomProp("tutorial-modal-z-index", "1003"),
  pricingModalZIndex: new CustomProp("pricing-modal-z-index", "1004"),
  floatingPopupMenuZIndex: new CustomProp("floating-popup-menu-z-index", "1004"),
  notificationZIndex: new CustomProp("notification-z-index", "1100"),
  browserCheckZIndex: new CustomProp("browser-check-z-index", "5000"),
  tooltipZIndex: new CustomProp("tooltip-z-index", "5000"),
  // TODO: Add properties for remaining hard-coded z-indexes.
};

/**
 * @deprecated Consume the {@link tokens} and {@link zIndexes} object directly.
 *
 * Before having most cssVars theme-related (listed in `tokens`), we had a list of various
 * design tokens here, consumed by the whole codebase.
 *
 * Some tokens were not migrated to `tokens` as they are not used in this codebase, but were
 * kept in case they are used by plugins or custom css.
 *
 * This is kept for now:
 * - to prevent having to update the whole codebase to target the new `tokens` structure for now,
 * - to make old css variables still work in case people used them in plugins or custom css.
 */
export const vars = {
  fontFamily: new CustomProp("font-family", tokens.fontFamily),
  fontFamilyData: new CustomProp("font-family-data", tokens.fontFamilyData),

  xxsmallFontSize: new CustomProp("xx-font-size", tokens.xxsmallFontSize),
  xsmallFontSize: new CustomProp("x-small-font-size", tokens.xsmallFontSize),
  smallFontSize: new CustomProp("small-font-size", tokens.smallFontSize),
  mediumFontSize: new CustomProp("medium-font-size", tokens.mediumFontSize),
  introFontSize: new CustomProp("intro-font-size", tokens.introFontSize),
  largeFontSize: new CustomProp("large-font-size", tokens.largeFontSize),
  xlargeFontSize: new CustomProp("x-large-font-size", tokens.xlargeFontSize),
  xxlargeFontSize: new CustomProp("xx-large-font-size", tokens.xxlargeFontSize),
  xxxlargeFontSize: new CustomProp("xxx-large-font-size", tokens.xxxlargeFontSize),

  controlFontSize: new CustomProp("control-font-size", "12px"),
  smallControlFontSize: new CustomProp("small-control-font-size", "10px"),
  bigControlFontSize: new CustomProp("big-control-font-size", tokens.bigControlFontSize),
  headerControlFontSize: new CustomProp("header-control-font-size", tokens.headerControlFontSize),
  bigControlTextWeight: new CustomProp("big-text-weight", tokens.bigControlTextWeight),
  headerControlTextWeight: new CustomProp("header-text-weight", tokens.headerControlTextWeight),

  labelTextSize: new CustomProp("label-text-size", "medium"),
  labelTextBg: new CustomProp("label-text-bg", "#ffffff"),
  labelActiveBg: new CustomProp("label-active-bg", "#f0f0f0"),

  controlMargin: new CustomProp("normal-margin", "2px"),
  controlPadding: new CustomProp("normal-padding", "3px 5px"),
  tightPadding: new CustomProp("tight-padding", "1px 2px"),
  loosePadding: new CustomProp("loose-padding", "5px 15px"),

  primaryBg: new CustomProp("primary-fg", tokens.primary),
  primaryBgHover: new CustomProp("primary-fg-hover", tokens.primaryMuted),
  primaryFg: new CustomProp("primary-bg", tokens.white),

  controlBg: new CustomProp("control-bg", tokens.white),
  controlFg: new CustomProp("control-fg", tokens.primary),
  controlFgHover: new CustomProp("primary-fg-hover", tokens.primaryMuted),

  controlBorder: new CustomProp("control-border", components.controlBorder),
  controlBorderRadius: new CustomProp("border-radius", tokens.controlBorderRadius),

  logoBg: new CustomProp("logo-bg", tokens.logoBg),
  logoSize: new CustomProp("logo-size", tokens.logoSize),
  toastBg: new CustomProp("toast-bg", "#040404"),

  ...zIndexes,
};

/**
 * @deprecated Consume and update the {@link components} object directly
 * when handling component-specific theme variables.
 *
 * This is here only to keep the old export and prevent having to update the whole codebase
 * to target the new `components` structure.
 */
export const theme = {
  ...components,
};

const cssColors = values(colors).map(v => v.decl()).join("\n");
const cssVars = values(vars).map(v => v.decl()).join("\n");

// We set box-sizing globally to match bootstrap's setting of border-box, since we are integrating
// into an app which already has it set, and it's impossible to make things look consistently with
// AND without it. This duplicates bootstrap's setting.
const cssBorderBox = `
  *, *:before, *:after {
  -webkit-box-sizing: border-box;
     -moz-box-sizing: border-box;
          box-sizing: border-box;
  }
`;

// These styles duplicate bootstrap's global settings, which we rely on even on pages that don't
// have bootstrap.
const cssInputFonts = `
  button, input, select, textarea {
    font-family: inherit;
    font-size: inherit;
    line-height: inherit;
  }
`;

// Font style classes used by style selector.
const cssFontStyles = `
  .font-italic {
    font-style: italic;
  }
  .font-bold {
    font-weight: 800;
  }
  .font-underline {
    text-decoration: underline;
  }
  .font-strikethrough {
    text-decoration: line-through;
  }
  .font-strikethrough.font-underline {
    text-decoration: line-through underline;
  }
`;

const cssRootVars = cssColors + cssVars;
const cssReset = cssBorderBox + cssInputFonts + cssFontStyles;

const cssBody = styled("body", `
  margin: 0;
  height: 100%;
`);

const cssRoot = styled("html", `
  height: 100%;
  overflow: hidden;
  font-family: ${vars.fontFamily};
  font-size: ${vars.mediumFontSize};
  -moz-osx-font-smoothing: grayscale;
  -webkit-font-smoothing: antialiased;
`);

// Also make a globally available testId, with a simple "test-" prefix (i.e. in tests, query css
// class ".test-{name}". Ideally, we'd use noTestId() instead in production.
export const testId: TestId = makeTestId("test-");

// Min width for normal screen layout (in px). Note: <768px is bootstrap's definition of small
// screen (covers phones, including landscape, but not tablets).
const largeScreenWidth = 992;
const mediumScreenWidth = 768;
const smallScreenWidth = 576;   // Anything below this is extra-small (e.g. portrait phones).

// Fractional width for max-query follows https://getbootstrap.com/docs/4.0/layout/overview/#responsive-breakpoints
export const mediaMedium = `(max-width: ${largeScreenWidth - 0.02}px)`;
export const mediaSmall = `(max-width: ${mediumScreenWidth - 0.02}px)`;
export const mediaNotSmall = `(min-width: ${mediumScreenWidth}px)`;
export const mediaXSmall = `(max-width: ${smallScreenWidth - 0.02}px)`;

export const mediaDeviceNotSmall = `(min-device-width: ${mediumScreenWidth}px)`;

export function isNarrowScreen() {
  return window.innerWidth < mediumScreenWidth;
}

let _isNarrowScreenObs: Observable<boolean> | undefined;

// Returns a singleton observable for whether the screen is a small one.
export function isNarrowScreenObs(): Observable<boolean> {
  if (!_isNarrowScreenObs) {
    const obs = Observable.create<boolean>(null, isNarrowScreen());
    window.addEventListener("resize", () => obs.set(isNarrowScreen()));
    _isNarrowScreenObs = obs;
  }
  return _isNarrowScreenObs;
}

export function isXSmallScreen() {
  return window.innerWidth < smallScreenWidth;
}

let _isXSmallScreenObs: Observable<boolean> | undefined;

// Returns a singleton observable for whether the screen is an extra small one.
export function isXSmallScreenObs(): Observable<boolean> {
  if (!_isXSmallScreenObs) {
    const obs = Observable.create<boolean>(null, isXSmallScreen());
    window.addEventListener("resize", () => obs.set(isXSmallScreen()));
    _isXSmallScreenObs = obs;
  }
  return _isXSmallScreenObs;
}

export const cssHideForNarrowScreen = styled("div", `
  @media ${mediaSmall} {
    & {
      display: none !important;
    }
  }
`);

let _isScreenResizingObs: Observable<boolean> | undefined;

// Returns a singleton observable for whether user is currently resizing the window. (listen to
// `resize` events and uses a timer of 1000ms).
export function isScreenResizing(): Observable<boolean> {
  if (!_isScreenResizingObs) {
    const obs = Observable.create<boolean>(null, false);
    const ping = debounce(() => obs.set(false), 1000);
    window.addEventListener("resize", () => { obs.set(true); ping(); });
    _isScreenResizingObs = obs;
  }
  return _isScreenResizingObs;
}

/**
 * Attaches the global css properties to the document's root to make them available in the page.
 */
export function attachCssRootVars(productFlavor: ProductFlavor, varsOnly: boolean = false) {
  /* Initiate the grist-layers before any other css to make sure it's understood by all styles,
   * and apply all base grist rules and styles in the grist-base layer. */
  getOrCreateStyleElement("grist-root-css", {
    position: "beforebegin",
    element: document.head.querySelector('style, link[rel="stylesheet"]'),
  }).textContent = `
@layer grist-base, grist-theme, grist-custom;
@layer grist-base {
  :root {
    ${cssRootVars}
  }
  ${!varsOnly && cssReset}
}`;

  document.documentElement.classList.add(cssRoot.className);
  document.body.classList.add(cssBody.className);
  const customTheme = getTheme(productFlavor);
  if (customTheme.bodyClassName) {
    document.body.classList.add(customTheme.bodyClassName);
  }
  const interfaceStyle = urlState().state.get().params?.style || "full";
  document.body.classList.add(`interface-${interfaceStyle}`);
}

// A dom method to hide element in print view
export function hideInPrintView(): DomElementMethod {
  return cssHideInPrint.cls("");
}

const cssHideInPrint = styled("div", `
  @media print {
    & {
      display: none !important;
    }
  }
`);
