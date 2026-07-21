# UI Theming Guide

This guide explains how to theme Grist UI using the current token/component-based system.

## Quick glossary

To avoid ambiguity in this document:

* Token (the API idea): a value from `tokens` in [app/common/ThemePrefs.ts](../app/common/ThemePrefs.ts), used for global design values (for example base background, emphasis, hover, font sizes).
* Components (the API object name): values from `components` in [app/common/ThemePrefs.ts](../app/common/ThemePrefs.ts), used for specific UI roles (for example modal border, table header, primary button colors).

In short: use `components` first for role-specific styling, and use `tokens` for shared/global styling.

## How theming works

Grist themes are defined in [app/common/ThemePrefs.ts](../app/common/ThemePrefs.ts). The main theme shapes are:

* `tokens` for app-wide design tokens such as colors, font sizes, and other shared values.
* `components` for UI-role-specific theme values such as buttons, panels, tooltips, and modals.

At runtime, theme values are attached to the DOM as CSS custom properties. The attachment logic lives in [app/client/ui2018/theme.ts](../app/client/ui2018/theme.ts), and the generated CSS variables use the `--grist-theme-...` prefix.

Built-in theme names are `GristLight`, `GristDark`, and `HighContrastLight`.

## What new code should use

For new UI code, import theme values directly from [app/common/ThemePrefs.ts](../app/common/ThemePrefs.ts):

```ts
import { components, tokens } from "app/common/ThemePrefs";
```

Use `tokens` for global design values and `components` for UI-role-specific surface and control colors.

Examples:

```ts
const titleStyle = styled("div", `
  color: ${components.text};
  background: ${tokens.bg};
  border-color: ${tokens.decorationSecondary};
`);
```

```ts
const primaryButtonStyle = styled("button", `
  color: ${components.controlPrimaryFg};
  background: ${components.controlPrimaryBg};
  border: 1px solid ${components.controlBorder};
`);
```

When styling one UI element, first try a role-specific value from `components`.
If there is no good  match, use a shared/global value from `tokens`.

Examples:

* Modal border: `components.modalBorder`
* Primary button background: `components.controlPrimaryBg`
* Generic page background: `tokens.bg`
* Generic hover color: `tokens.hover`

## Modern vs. deprecated API

The old compatibility layer lives in [app/client/ui2018/cssVars.ts](../app/client/ui2018/cssVars.ts). It still exports legacy names like `colors`, `vars`, and `theme`, but those are deprecated.

Prefer this pattern for new code:

```ts
import { components, tokens } from "app/common/ThemePrefs";
```

Avoid this pattern in new code:

```ts
import { theme, colors, vars } from "app/client/ui2018/cssVars";
```

The legacy layer remains for backward compatibility and for older custom CSS or plugin code. It should not be the default choice for any new UI work. If you are using the old API, there will be a deprecated warning in the console, and you should plan to migrate to the new API when possible.

## Migration examples (old -> modern)

Use these examples when converting existing code from [app/client/ui2018/cssVars.ts](../app/client/ui2018/cssVars.ts) to [app/common/ThemePrefs.ts](../app/common/ThemePrefs.ts).

### 1) Import migration

Old:

```ts
import { theme, colors, vars } from "app/client/ui2018/cssVars";
```

New:

```ts
import { components, tokens } from "app/common/ThemePrefs";
```

### 2) UI-role values (`theme` -> `components`)

Old:

```ts
const cssModal = styled("div", `
  background: ${theme.modalBg};
  border: 1px solid ${theme.modalBorder};
  color: ${theme.text};
`);
```

New:

```ts
const cssModal = styled("div", `
  background: ${components.modalBg};
  border: 1px solid ${components.modalBorder};
  color: ${components.text};
`);
```

### 3) Global values (`colors` -> `tokens`)

Old:

```ts
const cssCell = styled("div", `
  background: ${colors.lightGrey};
  border-color: ${colors.darkGrey};
  color: ${colors.dark};
`);
```

New:

```ts
const cssCell = styled("div", `
  background: ${tokens.bgSecondary};
  border-color: ${tokens.decoration};
  color: ${tokens.body};
`);
```

### 4) Text and size values (`vars` -> `tokens`)

Old:

```ts
const cssLabel = styled("label", `
  font-family: ${vars.fontFamily};
  font-size: ${vars.mediumFontSize};
  border-radius: ${vars.controlBorderRadius};
`);
```

New:

```ts
const cssLabel = styled("label", `
  font-family: ${tokens.fontFamily};
  font-size: ${tokens.mediumFontSize};
  border-radius: ${tokens.controlBorderRadius};
`);
```

### 5) Mixed example (`vars`/`colors` -> `tokens` + `components`)

Old:

```ts
const cssButton = styled("button", `
  color: ${vars.controlFg};
  background: ${vars.controlBg};
  border: 1px solid ${vars.controlBorder};
`);
```

New:

```ts
const cssButton = styled("button", `
  color: ${components.controlFg};
  background: ${tokens.white};
  border: 1px solid ${components.controlBorder};
`);
```

Notes:

* `theme.*` values usually become `components.*`.
* `colors.*` values usually become `tokens.*`.
* `vars.*` may map to either `tokens.*` or `components.*`, depending on whether the value is global or tied to a specific UI role.

## Practical guidance

When choosing a token, ask what kind of UI element you are styling:

* Text and foreground emphasis: use `components.text`, `components.lightText`, `components.darkText`, or the closest semantic  token.
* Page and panel surfaces: use `components.pageBg`, `components.mainPanelBg`, `components.leftPanelBg`, or similar surface tokens.
* Borders and separators: use `tokens.decoration`, `tokens.decorationSecondary`, or border tokens like `components.modalBorder` and `components.controlBorder`.
* Hover, selection, and active states: use the matching interaction tokens such as `tokens.hover`, `tokens.selection`, or component-specific hover tokens.

The rule of thumb is to favor semantic tokens over hard-coded color values. That keeps components consistent across light, dark, and high-contrast themes.

## Extending themes

When you add a new visual need that is not covered by existing tokens:

1. Check whether an existing token or UI-role token already matches the intent.
2. If not, add a new token in [app/common/ThemePrefs.ts](../app/common/ThemePrefs.ts).
3. Define its value for each built-in theme.
4. Use the new token in UI code rather than duplicating color values locally.

If a change affects old custom CSS or plugins, keep the compatibility behavior in mind and update the legacy mappings only when necessary.

## Migration notes

If you see code importing from [app/client/ui2018/cssVars.ts](../app/client/ui2018/cssVars.ts), it is usually old code that should be migrated gradually.

Suggested replacements:

* `theme` -> `components`
* `colors` -> `tokens`
* `vars` -> `tokens` or `components`, depending on whether the value is global or UI-role-specific

This does not mean every old file must be rewritten at once. The compatibility layer exists to keep the app stable while the codebase moves toward the newer API.

## References

* [app/common/ThemePrefs.ts](../app/common/ThemePrefs.ts)
* [app/client/ui2018/theme.ts](../app/client/ui2018/theme.ts)
* [app/client/ui2018/cssVars.ts](../app/client/ui2018/cssVars.ts)
