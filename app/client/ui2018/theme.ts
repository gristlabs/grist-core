import { createPausableObs, PausableObservable } from 'app/client/lib/pausableObs';
import { getStorage } from 'app/client/lib/storage';
import { urlState } from 'app/client/models/gristUrlState';
import { Theme, ThemeAppearance, ThemeColors, ThemePrefs } from 'app/common/ThemePrefs';
import { getThemeColors } from 'app/common/Themes';
import { getGristConfig } from 'app/common/urlUtils';
import { Computed, Observable } from 'grainjs';
import isEqual from 'lodash/isEqual';

const DEFAULT_LIGHT_THEME: Theme = {appearance: 'light', colors: getThemeColors('GristLight')};
const DEFAULT_DARK_THEME: Theme = {appearance: 'dark', colors: getThemeColors('GristDark')};

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
      // Custom CSS is incompatible with custom themes.
      if (getGristConfig().enableCustomCss) { return DEFAULT_LIGHT_THEME; }

      // If a user's preference is known, return it.
      const themePrefs = use(gristThemePrefs);
      const userAgentPrefersDarkTheme = use(prefersColorSchemeDarkObs());
      if (themePrefs) { return getThemeFromPrefs(themePrefs, userAgentPrefersDarkTheme); }

      // Otherwise, fall back to the user agent's preference.
      return userAgentPrefersDarkTheme ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME;
    });
  }
  return _gristThemeObs;
}

/**
 * Attaches the current theme's CSS variables to the document, and
 * re-attaches them whenever the theme changes.
 */
export function attachTheme() {
  // Custom CSS is incompatible with custom themes.
  if (getGristConfig().enableCustomCss) { return; }

  // Attach the current theme's variables to the DOM.
  attachCssThemeVars(gristThemeObs().get());

  // Whenever the theme changes, re-attach its variables to the DOM.
  gristThemeObs().addListener((newTheme, oldTheme) => {
    if (isEqual(newTheme, oldTheme)) { return; }

    attachCssThemeVars(newTheme);
  });
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

  if (syncWithOS) {
    appearance = userAgentPrefersDarkTheme ? 'dark' : 'light';
  }

  let nameOrColors = themePrefs.colors[appearance];
  if (urlParams?.themeName) {
    nameOrColors = urlParams?.themeName;
  }

  let colors: ThemeColors;
  if (typeof nameOrColors === 'string') {
    colors = getThemeColors(nameOrColors);
  } else {
    colors = nameOrColors;
  }

  return {appearance, colors};
}

function attachCssThemeVars({appearance, colors: themeColors}: Theme) {
  // Prepare the custom properties needed for applying the theme.
  const properties = Object.entries(themeColors)
    .map(([name, value]) => `--grist-theme-${name}: ${value};`);

  // Include properties for styling the scrollbar.
  properties.push(...getCssThemeScrollbarProperties(appearance));

  // Include properties for picking an appropriate background image.
  properties.push(...getCssThemeBackgroundProperties(appearance));

  // Apply the properties to the theme style element.
  getOrCreateStyleElement('grist-theme').textContent = `:root {
${properties.join('\n')}
  }`;

  // Make the browser aware of the color scheme.
  document.documentElement.style.setProperty(`color-scheme`, appearance);

  // Cache the appearance in local storage; this is currently used to apply a suitable
  // background image that's shown while the application is loading.
  getStorage().setItem('appearance', appearance);
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
 * Gets or creates a style element in the head of the document with the given `id`.
 *
 * Useful for grouping CSS values such as theme custom properties without needing to
 * pollute the document with in-line styles.
 */
function getOrCreateStyleElement(id: string) {
  let style = document.head.querySelector(`#${id}`);
  if (style) { return style; }
  style = document.createElement('style');
  style.setAttribute('id', id);
  document.head.append(style);
  return style;
}
