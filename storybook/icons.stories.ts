import { IconList } from "app/client/ui2018/IconList";
import { icon } from "app/client/ui2018/icons";
import { tokens } from "app/common/ThemePrefs";

import { styled } from "grainjs";

const colorOptions = {
  "tokens.secondary": tokens.secondary,
  "tokens.primary": tokens.primary,
  "tokens.body": tokens.body,
  "tokens.error": tokens.error,
  "tokens.white": tokens.white,
};

export default {
  title: "Icons",
  parameters: {
    docs: { codePanel: true, source: { type: "code" } },
  },
  args: {
    color: "tokens.secondary",
  },
  argTypes: {
    color: {
      control: "select",
      options: Object.keys(colorOptions),
    },
  },
};

/**
 * All available icons from `IconList.ts` (auto-generated during build).
 *
 * ```
 * import { icon } from "app/client/ui2018/icons";
 * import { tokens } from "app/common/ThemePrefs";
 * import { styled } from "grainjs";
 *
 * icon("Plus")
 *
 * // To change color, set --icon-color in a styled parent:
 * const cssGreenIcon = styled("div", `--icon-color: ${tokens.primary}`);
 * cssGreenIcon(icon("Plus"))
 * ```
 *
 * Icons render as masked elements, so their color is controlled via
 * `--icon-color` (defaults to the current theme's icon color).
 * Use `tokens.*` from `ThemePrefs` for theme-aware color values.
 */
export const Overview = {
  render: (args: any) =>
    cssGrid(
      elem => elem.style.setProperty("--icon-color",
        `${colorOptions[args.color as keyof typeof colorOptions]}`),
      IconList.map(name =>
        cssCell(
          icon(name),
          cssLabel(name),
        ),
      ),
    ),
};

const cssGrid = styled("div", `
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
`);

const cssCell = styled("div", `
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 4px;
  border-radius: 4px;
  &:hover {
    background: rgba(0, 0, 0, 0.05);
  }
`);

const cssLabel = styled("div", `
  font-size: 11px;
  color: #666;
  text-align: center;
  word-break: break-all;
`);
