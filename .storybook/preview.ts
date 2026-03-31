/**
 * Storybook preview configuration.
 *
 * Sets up the Grist theme so that components render correctly in
 * isolation — without needing the full Grist app model.
 *
 * Base styles (CSS variables, reset rules, font rendering) come from
 * `attachCssBaseStyles()` in cssVars.ts — the same code the real app uses.
 * On top of that we inject the theme-layer color values (from GristLight etc.)
 * and a few Storybook-specific body styles.
 */

import { setupLocale } from "app/client/lib/localization";
import { attachCssBaseStyles } from "app/client/ui2018/cssVars";
import {
  components,
  componentsCssMapping,
  convertThemeKeysToCssVars,
  ThemeName,
  tokens,
  tokensCssMapping,
} from "app/common/ThemePrefs";
import { getThemeTokens } from "app/common/Themes";

// Load icon CSS
// eslint-disable-next-line no-restricted-imports
import "../static/icons/icons.css";

function attachGristTheme(themeName: ThemeName = "GristLight") {
  // Base layer: CSS variables, reset rules, font rendering — shared with the real app.
  attachCssBaseStyles();

  const themeTokens = getThemeTokens(themeName);
  const appearance = themeName === "GristDark" ? "dark" : "light";
  const theme = { appearance, name: themeName, colors: themeTokens } as const;
  const themeWithCssVars = convertThemeKeysToCssVars(theme);
  const { colors: cssVarValues } = themeWithCssVars;

  // Populate the CssCustomProp singletons with actual values, so that
  // the base-layer vars (which reference them) resolve correctly.
  Object.entries(tokens).forEach(([token, cssProp]) => {
    (cssProp).value =
      cssVarValues[tokensCssMapping[token as keyof typeof tokensCssMapping]];
  });
  Object.entries(components).forEach(([component, cssProp]) => {
    (cssProp).value =
      cssVarValues[componentsCssMapping[component as keyof typeof componentsCssMapping]];
  });

  // Theme layer: --grist-theme-* vars with actual color values.
  const themeProperties = Object.entries(cssVarValues)
    .map(([name, value]) => `    --grist-theme-${name}: ${value};`)
    .join("\n");

  const style = document.createElement("style");
  style.id = "grist-storybook-theme";
  style.textContent = `
@layer grist-theme {
  :root {
${themeProperties}
  }
}
  `;
  document.head.appendChild(style);

  // Storybook-specific body styles
  document.body.style.color = "var(--grist-theme-body)";
  document.body.style.backgroundColor = "var(--grist-theme-bg-default)";
  document.body.style.margin = "0";
  document.body.style.padding = "16px";
}

// Apply the theme when the iframe loads.
attachGristTheme("GristLight");

setupLocale().catch(e => console.warn("ERROR in setupLocale", e));

/**
 * grainjs lifecycle integration via decorator + renderToCanvas.
 *
 * **Decorator** — wraps every story in `dom.create()`, which creates a
 * grainjs `owner` and attaches it to the Storybook context.  Stories can
 * access `context.owner` for Observables:
 *
 *     export const MyStory = {
 *       render: (_args: any, {owner}: any) => {
 *         const obs = Observable.create(owner, 0);
 *         return dom('div', dom.text(use => String(use(obs))));
 *       },
 *     };
 *
 * Stories that don't need owner can ignore it — the standard Storybook
 * `(args, context)` render signature is unchanged.
 *
 * **renderToCanvas** — mounts the story DOM into the canvas and returns
 * a teardown function that calls `domDispose()` so that Observables,
 * Computeds, and other disposables are cleaned up when Storybook
 * switches between stories.
 */
import { dom, domDispose } from "grainjs";

export const decorators = [
  (storyFn: any, context: any) => dom.create((owner) => {
    context.owner = owner;
    return storyFn();
  }),
];

export function renderToCanvas(
  { storyFn, showMain }: any,
  canvasElement: HTMLElement,
) {
  showMain();
  domDispose(canvasElement);
  canvasElement.innerHTML = "";
  dom.update(canvasElement, storyFn());
  return () => domDispose(canvasElement);
}

export default {
  // Enable auto-generated documentation for all stories
  tags: ["autodocs"],
  parameters: {
    docs: {
      toc: true,
    },
  },
};
