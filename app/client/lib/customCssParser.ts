import { ThemeWithCssVars } from "app/common/ThemePrefs";

type Vars = Record<string, string>;

/**
 * Gets CSS variables defined in the #grist-custom-css stylesheet:
 *
 * - checks only for CSS defined in the `grist-custom` CSS layer
 * - checks only for variables defined in `:root`-based selectors
 * - includes variables seemingly unrelated to the grist theme, in case they are used themselves by
 *   grist theme-related variables in the custom.css file.
 */
function getCustomCssVars(): Vars {
  const customCssSheet = document.querySelector<HTMLLinkElement>("#grist-custom-css")?.sheet;
  if (!customCssSheet) {
    return {};
  }
  const vars: Vars = {};
  for (const rule of customCssSheet.cssRules) {
    // Only check the grist-custom layer
    if (!(rule instanceof CSSLayerBlockRule) || rule.name !== "grist-custom") {
      continue;
    }

    for (const subRule of rule.cssRules) {
      // Only check direct children of the grist-custom layer
      if (!(subRule instanceof CSSStyleRule)) {
        continue;
      }

      // Important: only retrieve custom vars declared on the :root matching current theme/appearance
      if (!document.documentElement.matches(subRule.selectorText)) {
        continue;
      }

      const style = subRule.style;
      for (let i = 0; i < style.length; i++) {
        const prop = style.item(i);
        if (!prop.startsWith("--")) {
          continue;
        }
        const value = style.getPropertyValue(prop).trim();
        if (value) {
          vars[prop] = value;
        }
      }
    }
  }

  return vars;
}

const GRIST_THEME_PREFIX = "--grist-theme-";

/**
 * Takes a list of CSS variables and returns two lists: one with variables matching the grist theme namings,
 * and one with "external" variables
 */
const splitVariables = (cssVars: Vars): { grist: Vars; nonGrist: Vars } => {
  const gristThemeVars: Vars = {};
  const nonGristThemeVars: Vars = {};
  for (const [name, value] of Object.entries(cssVars)) {
    if (name.startsWith(GRIST_THEME_PREFIX)) {
      gristThemeVars[name.slice(GRIST_THEME_PREFIX.length)] = value;
    } else {
      nonGristThemeVars[name.slice(2)] = value;
    }
  }
  return { grist: gristThemeVars, nonGrist: nonGristThemeVars };
};

const CUSTOM_CSS_PREFIX = "custom-css-";

/**
 * Checks the values of the passed cssVars. When we detect a value targets a variable from the given list,
 * we prefix it.
 *
 * This is done to prevent potential naming collisions issues once grist-plugin-api appends the variables.
 *
 * Example:
 *   cssVars = { "accent-color": "var(--design-system-accent-color)" }
 *   list = ["design-system-accent-color"]
 *   returns { "accent-color": "var(--grist-theme-custom-css-design-system-accent-color)" }
 */
const prefixVariableValues = (cssVars: Vars, list: string[]): Vars => {
  const prefixedCssVars = { ...cssVars };
  for (const [name, value] of Object.entries(cssVars)) {
    if (value.startsWith("var(--") && list.includes(value.slice(6, -1))) {
      prefixedCssVars[name] = `var(${GRIST_THEME_PREFIX}${CUSTOM_CSS_PREFIX}${value.slice(6, -1)})`;
    }
  }
  return prefixedCssVars;
};

const mergeVariables = (themeVars: Vars, newGristThemeVars: Vars, nonGristThemeVars: Vars): Vars => {
  const allVars = { ...themeVars };
  for (const [name, value] of Object.entries(newGristThemeVars)) {
    allVars[name] = value;
  }
  for (const [name, value] of Object.entries(nonGristThemeVars)) {
    allVars[CUSTOM_CSS_PREFIX + name] = value;
  }
  return allVars;
};

/**
 * Takes a ThemeWithCssVars and returns a new ThemeWithCssVars that includes
 * variables defined in the #grist-custom-css stylesheet.
 */
export function withCustomCssVars(theme: ThemeWithCssVars): ThemeWithCssVars {
  const customCssVars = getCustomCssVars();

  let { grist: newGristThemeVars, nonGrist: nonGristThemeVars } = splitVariables(customCssVars);
  const nonGristThemeVarNames = Object.keys(nonGristThemeVars);

  newGristThemeVars = prefixVariableValues(newGristThemeVars, nonGristThemeVarNames);
  nonGristThemeVars = prefixVariableValues(nonGristThemeVars, nonGristThemeVarNames);

  return {
    ...theme,
    colors: mergeVariables(theme.colors, newGristThemeVars, nonGristThemeVars),
  };
}
