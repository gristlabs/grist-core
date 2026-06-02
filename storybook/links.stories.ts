import * as buttons from "app/client/ui2018/buttons";
import { cssLink } from "app/client/ui2018/links";

import { action } from "@storybook/addon-actions";
import { dom, styled } from "grainjs";

export default {
  title: "Links",
  parameters: {
    docs: { codePanel: true, source: { type: "code" } },
  },
  args: {
    label: "Link",
    href: "https://www.getgrist.com",
    omitHref: false,
    action: action("Link"),
  },
  decorators: [
    (story: any, context: any) => {
      context.args.domArgs = [
        context.args.label,
        context.args.omitHref ? null : dom.attr("href", context.args.href),
        dom.attr("target", "_blank"),
        dom.on("click", context.args.action),
      ];
      return story();
    },
  ],
};

function source(code: string) {
  const transform = (_code: string, ctx: any) =>
    `${code}(${JSON.stringify(ctx.args.label)}, { href: ${JSON.stringify(ctx.args.href)} }, ...)`;
  return { parameters: { docs: { source: { type: "code", transform } } } };
}

function sourceCssLink() {
  const transform = (_code: string, ctx: any) =>
    `cssLink(${JSON.stringify(ctx.args.label)}, { href: ${JSON.stringify(ctx.args.href)} })`;
  return { parameters: { docs: { source: { type: "code", transform } } } };
}

function makeButtonLink(funcName: keyof typeof buttons, label: string) {
  return {
    args: { label },
    render: (args: any) => (buttons[funcName] as any)(...args.domArgs),
    ...source(funcName),
  };
}

/**
 * Links and button-styled links. Two sources:
 *
 * ```
 * import { cssLink } from "app/client/ui2018/links";
 * import { primaryButtonLink, basicButtonLink } from "app/client/ui2018/buttons";
 *
 * // Plain text link
 * cssLink("Learn more", { href: "https://...", target: "_blank" })
 *
 * // Navigation that looks like a button (renders <a>, not <button>)
 * primaryButtonLink("Open", { href: "/doc/123" }, dom.attr("target", "_blank"))
 * basicButtonLink("Download", dom.attr("href", url), dom.attr("download", filename))
 * ```
 *
 * Use **cssLink** for inline text links.
 * Use **primaryButtonLink** / **basicButtonLink** when you need a button
 * appearance but `<a>` semantics (navigation, download, external URL).
 * The "big" variants are for prominent placements (e.g. welcome screens).
 *
 * See also `gristLink()` in links.ts for links that integrate with
 * Grist's URL routing (same-document navigation without page reload).
 */
export const Overview = {
  render: (args: any, context: any) => [
    cssRow(
      cssLink(...context.args.domArgs),
      buttons.basicButtonLink(...context.args.domArgs),
      buttons.primaryButtonLink(...context.args.domArgs),
      buttons.bigBasicButtonLink(...context.args.domArgs),
      buttons.bigPrimaryButtonLink(...context.args.domArgs),
    ),
  ],
};

export const CssLink = {
  args: { label: "Learn more" },
  render: (args: any) => cssLink(...args.domArgs),
  ...sourceCssLink(),
};
export const BasicButtonLink = makeButtonLink("basicButtonLink", "Download");
export const PrimaryButtonLink = makeButtonLink("primaryButtonLink", "Open");
export const BigBasicButtonLink = makeButtonLink("bigBasicButtonLink", "Download");
export const BigPrimaryButtonLink = makeButtonLink("bigPrimaryButtonLink", "Open");

const cssRow = styled("div", `
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16px;
`);
