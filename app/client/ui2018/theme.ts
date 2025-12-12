import { createPausableObs, PausableObservable } from 'app/client/lib/pausableObs';
import { getStorage } from 'app/client/lib/storage';
import { getOrCreateStyleElement } from 'app/client/lib/getOrCreateStyleElement';
import { urlState } from 'app/client/models/gristUrlState';
import {
  components,
  componentsCssMapping,
  convertThemeKeysToCssVars,
  legacyVarsMapping,
  Theme,
  ThemeAppearance,
  ThemeName,
  themeNameAppearances,
  ThemePrefs,
  tokens,
  tokensCssMapping
} from 'app/common/ThemePrefs';
import { getThemeTokens } from 'app/common/Themes';
import { getGristConfig } from 'app/common/urlUtils';
import { isFeatureEnabled } from 'app/common/gristUrls';
import { Computed, Observable } from 'grainjs';
import isEqual from 'lodash/isEqual';

const DEFAULT_LIGHT_THEME: Theme = getThemeObject('GristLight');
const DEFAULT_DARK_THEME: Theme = getThemeObject('GristDark');

/**
 * A singleton observable for the current user's Grist theme preferences.
 *
 * Set by `AppModel`, which populates it from `UserPrefs`.
 */
export const gristThemePrefs = Observable.create<ThemePrefs | null>(null, null);

/**
 * Returns `true` if the user agent prefers a dark color scheme.
 */
export function prefersColorSchemeDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

let _prefersColorSchemeDarkObs: PausableObservable<boolean> | undefined;

/**
 * Returns a singleton observable for whether the user agent prefers a
 * dark color scheme.
 */
export function prefersColorSchemeDarkObs(): PausableObservable<boolean> {
  if (!_prefersColorSchemeDarkObs) {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const obs = createPausableObs<boolean>(null, query.matches);
    query.addEventListener('change', event => obs.set(event.matches));
    _prefersColorSchemeDarkObs = obs;
  }
  return _prefersColorSchemeDarkObs;
}

let _gristThemeObs: Computed<Theme> | undefined;

/**
 * A singleton observable for the current Grist theme.
 */
export function gristThemeObs() {
  if (!_gristThemeObs) {
    _gristThemeObs = Computed.create(null, (use) => {
      // Default to light theme if themes are disabled in config.
      if (!isFeatureEnabled('themes')) { return DEFAULT_LIGHT_THEME; }

      // If a user's preference is known, return it.
      const themePrefs = use(gristThemePrefs);
      const userAgentPrefersDarkTheme = use(prefersColorSchemeDarkObs());
      if (themePrefs) { return getThemeFromPrefs(themePrefs, userAgentPrefersDarkTheme); }

      // If user pref is not set or not yet loaded, first check the previously known theme from local storage
      // (this prevents the appearance being wrongly set for a few milliseconds while loading the page)
      const storageTheme = getStorage().getItem('grist-theme');
      if (storageTheme) {
        return getThemeObject(storageTheme as ThemeName);
      }

      // Otherwise, fall back to the user agent's preference.
      return userAgentPrefersDarkTheme ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME;
    });
  }
  return _gristThemeObs;
}

/**
 * Attaches the current theme's CSS variables to the document, and
 * re-attaches them whenever the theme changes.
 *
 * When custom CSS is enabled (and theme selection is then unavailable in the UI),
 * default light theme variables are attached.
 */
export function attachTheme() {
  // Attach the current theme's variables to the DOM.
  attachCssThemeVars(gristThemeObs().get());
  if (getGristConfig().enableCustomCss) {
    fixOldCustomCss();
  }

  // Whenever the theme changes, re-attach its variables to the DOM.
  gristThemeObs().addListener((newTheme, oldTheme) => {
    if (isEqual(newTheme, oldTheme)) { return; }

    attachCssThemeVars(newTheme);
  });
}

/**
 * Attaches the default light theme to the DOM.
 *
 * In some cases, theme choice is disabled (for example, in forms), but we still need to
 * append the theme vars to the DOM so that the UI works.
 */
export function attachDefaultLightTheme() {
  attachCssThemeVars(DEFAULT_LIGHT_THEME);
}

/**
 * Returns the `Theme` from the given `themePrefs`.
 *
 * If theme query parameters are present (`themeName`, `themeAppearance`, `themeSyncWithOs`),
 * they will take precedence over their respective values in `themePrefs`.
 */
function getThemeFromPrefs(themePrefs: ThemePrefs, userAgentPrefersDarkTheme: boolean): Theme {
  let {appearance, syncWithOS} = themePrefs;

  const urlParams = urlState().state.get().params;
  if (urlParams?.themeAppearance) {
    appearance = urlParams?.themeAppearance;
  }
  if (urlParams?.themeSyncWithOs !== undefined) {
    syncWithOS = urlParams?.themeSyncWithOs;
  }

  // The themeName is stored both in themePrefs.colors.light and themePrefs.colors.dark
  // (see app/common/ThemePrefs.ts#getDefaultThemePrefs for more info).
  // So, it doesn't matter if we take the theme name from colors.light or colors.dark
  let themeName = themePrefs.colors['light'];
  if (urlParams?.themeName) {
    themeName = urlParams?.themeName;
  }
  // User might set up the theme appearance in the url params, but not the theme name:
  // make sure the theme is correctly set in that case
  if (urlParams?.themeAppearance && !urlParams?.themeName) {
    themeName = appearance === 'dark' ? 'GristDark' : 'GristLight';
  }

  if (syncWithOS) {
    appearance = userAgentPrefersDarkTheme ? 'dark' : 'light';
    themeName = userAgentPrefersDarkTheme ? 'GristDark' : 'GristLight';
  }

  return {appearance, colors: getThemeTokens(themeName), name: themeName};
}

function getThemeObject(themeName: ThemeName): Theme {
  return {
    appearance: themeNameAppearances[themeName],
    colors: getThemeTokens(themeName),
    name: themeName
  };
}

function attachCssThemeVars(theme: Theme) {
  const themeWithCssVars = convertThemeKeysToCssVars(theme);
  const {appearance, colors: cssVars} = themeWithCssVars;

  // This way of attaching css vars to the DOM is the same in grist-plugin-api and
  // should be kept in sync in any case it changes.
  // Ideally, this should stay as is, to prevent breaking changes in the grist-plugin-api file.
  const properties = Object.entries(cssVars)
    .map(([name, value]) => `--grist-theme-${name}: ${value};`);

  // Update tokens and components empty CssCustomProps with actual theme values for when we want
  // to fetch actual values at runtime instead of relying on css vars.
  Object.entries(tokens).forEach(([token, cssProp]) => {
    cssProp.value = cssVars[tokensCssMapping[token as keyof typeof tokensCssMapping]];
  });
  Object.entries(components).forEach(([component, cssProp]) => {
    cssProp.value = cssVars[componentsCssMapping[component as keyof typeof componentsCssMapping]];
  });

  // Include properties for styling the scrollbar.
  properties.push(...getCssThemeScrollbarProperties(appearance));

  // Include properties for picking an appropriate background image.
  properties.push(...getCssThemeBackgroundProperties(appearance));

  // Apply the properties to the theme style element.
  // The 'grist-theme' layer takes precedence over the 'grist-base' layer where
  // default CSS variables are defined.
  getOrCreateStyleElement('grist-theme', {
    element: document.getElementById('grist-root-css'),
    position: 'afterend'
  }).textContent = `@layer grist-theme {
  :root {
${properties.join('\n')}
  }
}`;

  // Make the browser aware of the color scheme.
  document.documentElement.style.setProperty(`color-scheme`, appearance);

  // Add data-attributes to ease up custom css overrides.
  document.documentElement.setAttribute('data-grist-theme', theme.name);
  document.documentElement.setAttribute('data-grist-appearance', theme.appearance);

  // Cache the appearance in local storage; this is currently used to apply a suitable
  // background image that's shown while the application is loading.
  getStorage().setItem('appearance', appearance);
  getStorage().setItem('grist-theme', theme.name);
}

/**
 * Gets scrollbar-related css properties that are appropriate for the given `appearance`.
 *
 * Note: Browser support for customizing scrollbars is still a mixed bag; the bulk of customization
 * is non-standard and unsupported by Firefox. If support matures, we could expose some of these in
 * custom themes, but for now we'll just go with reasonable presets.
 */
function getCssThemeScrollbarProperties(appearance: ThemeAppearance) {
  return [
    '--scroll-bar-fg: ' +
      (appearance === 'dark' ? '#6B6B6B;' : '#A8A8A8;'),
    '--scroll-bar-hover-fg: ' +
      (appearance === 'dark' ? '#7B7B7B;' : '#8F8F8F;'),
    '--scroll-bar-active-fg: ' +
      (appearance === 'dark' ? '#8B8B8B;' : '#7C7C7C;'),
    '--scroll-bar-bg: ' +
      (appearance === 'dark' ? '#2B2B2B;' : '#F0F0F0;'),
  ];
}

/**
 * Gets background-related css properties that are appropriate for the given `appearance`.
 *
 * Currently, this sets a property for showing a background image that's visible while a page
 * is loading.
 */
function getCssThemeBackgroundProperties(appearance: ThemeAppearance) {
  const value = appearance === 'dark'
    ? 'url("img/prismpattern.png")'
    : 'url("img/gplaypattern.png")';
  return [`--grist-theme-bg: ${value};`];
}

/**
 * In case custom css is enabled and it only overrides "old" "--grist-color-*" variables and the likes,
 * make sure to add missing matching variables ourselves.
 *
 * A warning is logged to the console to help the user migrate to the new theme variables.
 */
function fixOldCustomCss() {
  // Find the custom css stylesheet
  const customCss = Array.from(document.styleSheets)
    .find(sheet => (sheet.ownerNode as Element)?.id === 'grist-custom-css');
  if (!customCss) {
    return;
  }

  const cssRulesArray = Array.from(customCss.cssRules);

  // Find existing `grist-custom` layers
  const gristCustomLayers = cssRulesArray
    // current TS version doesn't know about CSSLayerBlockRule type
    .filter(rule => rule.constructor.name === 'CSSLayerBlockRule' && (rule as any).name === 'grist-custom');

  // Find all `:root` rules at the root of the custom css file or in the `grist-custom` layers
  const rootCssRules = [
    ...cssRulesArray,
    ...gristCustomLayers.map(layer => Array.from((layer as any).cssRules)).flat()
  ].filter(rule => {
    return (rule as CSSRule).constructor.name === 'CSSStyleRule' && (rule as CSSStyleRule).selectorText === ':root';
  }) as CSSStyleRule[];
  if (!rootCssRules.length) {
    return;
  }

  // Find all the --grist-* variables declared in the `:root` rules
  const overridenVars: Record<string, string> = {};
  rootCssRules.forEach(rootBlock => {
    for (const key in rootBlock.style) { // eslint-disable-line @typescript-eslint/no-for-in-array
      const value = rootBlock.style[key];
      if (rootBlock.style.hasOwnProperty(key) && value.startsWith('--grist-')) {
        overridenVars[value] = rootBlock.style.getPropertyValue(value).trim();
      }
    }
  });

  // Create missing variables to match old custom css vars with new theme vars
  const missingVars: any[] = [];
  legacyVarsMapping.forEach(({old, new: newVariable}) => {
    const found = !!overridenVars[old];
    if (found
      && !overridenVars[old].startsWith('var(--grist-')
      && !missingVars.find(v => v.name === newVariable)
    ) {
      missingVars.push({
        name: newVariable,
        value: `var(${old}) !important`
      });
    }
  });

  if (!missingVars.length) {
    return;
  }

  // Add the missing variables to the dom
  getOrCreateStyleElement('grist-custom-css-fixes', {
    element: document.getElementById('grist-custom-css'),
    position: 'afterend'
  }).textContent = `@layer grist-custom {
  :root {
${missingVars.map(({name, value}) => `${name}: ${value};`).join('\n')}
  }
}`;
  console.warn(
    'The custom.css file uses deprecated variables that will be removed in the future. '
    + '\nPlease follow the example custom.css file to update the variables: https://support.getgrist.com/self-managed/#how-do-i-customize-styling.'
  );
}
