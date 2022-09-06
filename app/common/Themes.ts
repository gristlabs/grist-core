import {ThemeColors, ThemeName} from 'app/common/ThemePrefs';
import {GristDark} from 'app/common/themes/GristDark';
import {GristLight} from 'app/common/themes/GristLight';

const THEMES: Readonly<Record<ThemeName, ThemeColors>> = {
  GristLight,
  GristDark,
};

export function getThemeColors(themeName: ThemeName): ThemeColors {
  return THEMES[themeName];
}

/**
 * A simple JS script that handles setting an appropriate background image
 * based on the appearance setting most recently set by the client.
 *
 * The motivation for this snippet is to avoid the FOUC-like effect that can
 * occur when Grist is loading a page, typically manifesting as a momentary flash
 * from a light background to a dark background (and vice versa). By predicting what
 * the appearance should be based on what was last stored in local storage, we can set
 * a suitable background image before the application (and consequently, the user's
 * theme preferences) have loaded, which should avoid the flash in most cases.
 *
 * Simpler alternatives exist, like using the user agent's preferred color scheme, but
 * don't account for the fact that Grist allows users to manually set their preferred
 * appearance. While this solution isn't perfect, it's a significant improvement over the
 * default behavior.
 */
export function getThemeBackgroundSnippet() {
  /* Note that we only need to set the property if the appearance is dark; a fallback
   * to the light background (gplaypattern.png) already exists in App.css. */
  return `
<script>
try {
  if (localStorage.getItem('appearance') === 'dark' && !window.gristConfig.enableCustomCss) {
    const style = document.createElement('style');
    style.setAttribute('id', 'grist-theme');
    style.textContent = ':root {\\n' +
      '  --grist-theme-bg: url("img/prismpattern.png");\\n' +
      '  --grist-theme-bg-color: #333333;\\n' +
      '}';
    document.head.append(style);
  }
} catch {
  /* Do nothing. */
}
</script>
`;
}
