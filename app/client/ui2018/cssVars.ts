/**
 * CSS Variables.
 *
 * This file has two roles:
 *  - appending theme-agnosticCSS variables and global CSS rules to the DOM with `attachCssRootVars`.
 *  - (deprecated) exposing the design tokens to the rest of the codebase.
 *    Prefer using the {@link tokens} object directly.
 *
 * Theme-related CSS variables (like colors and font families) are added to the DOM with `theme.ts#attachCssThemeVars`.
 */
import {CssCustomProp as CustomProp} from 'app/common/CssCustomProp';
import {legacyVariables, tokens} from 'app/common/ThemePrefs';
import {urlState} from 'app/client/models/gristUrlState';
import {getTheme, ProductFlavor} from 'app/client/ui/CustomThemes';
import {getOrCreateStyleElement} from 'app/client/lib/getOrCreateStyleElement';
import {DomElementMethod, makeTestId, Observable, styled, TestId} from 'grainjs';
import debounce = require('lodash/debounce');
import values = require('lodash/values');

/**
 * @deprecated Consume the {@link tokens} object directly
 *
 * Before having most cssVars theme-related (listed in `tokens`), we had a list of colors
 * defined here, consumed by the whole codebase.
 *
 * To prevent having to update the whole codebase to target the new `tokens` structure for now,
 * we just make the tokens available through this `colors` object, and match the legacy variables here.
 */
export const colors = {
  ...tokens,
  darkBg: tokens.dark,
  orange: tokens.warningLight,
  warning: tokens.warningLight,
  lighterGreen: tokens.primaryLighter,
  lightGreen: tokens.primaryLight,
  darkGreen: tokens.primaryDark,
  darkerGreen: tokens.primaryDarker,
  lighterBlue: tokens.secondaryLighter,
  lightBlue: tokens.secondaryLight,
};

/**
 * zIndexes are listed on their own and can't be modified by themes.
 */
export const zIndexes = {
  insertColumnLineZIndex: new CustomProp('insert-column-line-z-index', '20'),
  popupSectionBackdropZIndex: new CustomProp('popup-section-backdrop-z-index', '100'),
  menuZIndex: new CustomProp('menu-z-index', '999'),
  modalZIndex: new CustomProp('modal-z-index', '999'),
  onboardingBackdropZIndex: new CustomProp('onboarding-backdrop-z-index', '999'),
  onboardingPopupZIndex: new CustomProp('onboarding-popup-z-index', '1000'),
  floatingPopupZIndex: new CustomProp('floating-popup-z-index', '1002'),
  tutorialModalZIndex: new CustomProp('tutorial-modal-z-index', '1003'),
  pricingModalZIndex: new CustomProp('pricing-modal-z-index', '1004'),
  floatingPopupMenuZIndex: new CustomProp('floating-popup-menu-z-index', '1004'),
  notificationZIndex: new CustomProp('notification-z-index', '1100'),
  browserCheckZIndex: new CustomProp('browser-check-z-index', '5000'),
  tooltipZIndex: new CustomProp('tooltip-z-index', '5000'),
  // TODO: Add properties for remaining hard-coded z-indexes.
};

/**
 * @deprecated Consume the {@link tokens} object directly.
 *
 * Before having most cssVars theme-related (listed in `tokens`), we had a list of various
 * design tokens here, consumed by the whole codebase.
 *
 * To prevent having to update the whole codebase to target the new `tokens` structure,
 * for now we just make the tokens available through this `vars` object.
 */
export const vars = {
  ...tokens,
  ...zIndexes,
};


/**
 * @deprecated Consume the {@link tokens} object directly when creating new component-specific theme variables.
 */
export const theme = {
  ...legacyVariables
};

const cssVars = values(vars).map(v => v.decl()).filter(v => !!v).join('\n');

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

const cssRootVars = cssVars;
const cssReset = cssBorderBox + cssInputFonts + cssFontStyles;

const cssBody = styled('body', `
  margin: 0;
  height: 100%;
`);

const cssRoot = styled('html', `
  height: 100%;
  overflow: hidden;
  font-family: ${vars.fontFamily};
  font-size: ${vars.mediumFontSize};
  -moz-osx-font-smoothing: grayscale;
  -webkit-font-smoothing: antialiased;
`);

// Also make a globally available testId, with a simple "test-" prefix (i.e. in tests, query css
// class ".test-{name}". Ideally, we'd use noTestId() instead in production.
export const testId: TestId = makeTestId('test-');

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

let _isNarrowScreenObs: Observable<boolean>|undefined;

// Returns a singleton observable for whether the screen is a small one.
export function isNarrowScreenObs(): Observable<boolean> {
  if (!_isNarrowScreenObs) {
    const obs = Observable.create<boolean>(null, isNarrowScreen());
    window.addEventListener('resize', () => obs.set(isNarrowScreen()));
    _isNarrowScreenObs = obs;
  }
  return _isNarrowScreenObs;
}

export function isXSmallScreen() {
  return window.innerWidth < smallScreenWidth;
}

let _isXSmallScreenObs: Observable<boolean>|undefined;

// Returns a singleton observable for whether the screen is an extra small one.
export function isXSmallScreenObs(): Observable<boolean> {
  if (!_isXSmallScreenObs) {
    const obs = Observable.create<boolean>(null, isXSmallScreen());
    window.addEventListener('resize', () => obs.set(isXSmallScreen()));
    _isXSmallScreenObs = obs;
  }
  return _isXSmallScreenObs;
}

export const cssHideForNarrowScreen = styled('div', `
  @media ${mediaSmall} {
    & {
      display: none !important;
    }
  }
`);

let _isScreenResizingObs: Observable<boolean>|undefined;

// Returns a singleton observable for whether user is currently resizing the window. (listen to
// `resize` events and uses a timer of 1000ms).
export function isScreenResizing(): Observable<boolean> {
  if (!_isScreenResizingObs) {
    const obs = Observable.create<boolean>(null, false);
    const ping = debounce(() => obs.set(false), 1000);
    window.addEventListener('resize', () => { obs.set(true); ping(); });
    _isScreenResizingObs = obs;
  }
  return _isScreenResizingObs;
}

/**
 * Attaches the global css properties to the document's root to make them available in the page.
 */
export function attachCssRootVars(productFlavor: ProductFlavor, varsOnly: boolean = false) {
  /* Apply all base grist rules and styles in the grist-base layer.
   * See app/client/app.css for layers order */
  getOrCreateStyleElement('grist-root-css').textContent = `
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
  const interfaceStyle = urlState().state.get().params?.style || 'full';
  document.body.classList.add(`interface-${interfaceStyle}`);
}

// A dom method to hide element in print view
export function hideInPrintView(): DomElementMethod {
  return cssHideInPrint.cls('');
}

const cssHideInPrint = styled('div', `
  @media print {
    & {
      display: none !important;
    }
  }
`);
