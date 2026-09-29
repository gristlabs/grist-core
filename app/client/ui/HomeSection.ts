import { theme } from "app/client/ui2018/cssVars";
import { IconName } from "app/client/ui2018/IconList";
import { icon } from "app/client/ui2018/icons";
import { unstyledH2 } from "app/client/ui2018/unstyled";

import { dom, DomContents, DomElementArg, keyframes, styled } from "grainjs";

const fadeUp = keyframes(`
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
`);

/**
 * Styles for fading an element up into place. Use with {@link reveal}.
 */
export const revealed = `
  animation: ${fadeUp} 500ms cubic-bezier(0, 0, 0.2, 1) backwards;

  @media (prefers-reduced-motion: reduce) {
    & {
      animation: none;
    }
  }
`;

/**
 * Delays a {@link revealed} element's animation by `delayMs`, or disables it
 * if `showIntro` is false.
 */
export function reveal(showIntro: boolean, delayMs: number): DomElementArg {
  return showIntro ? dom.style("animation-delay", `${delayMs}ms`) : dom.style("animation", "none");
}

/**
 * Builds a home page section heading with an icon and title.
 */
export function buildSectionHead(
  iconName: IconName, title: string, ...args: DomElementArg[]
): DomContents {
  return cssSectionHead(
    cssSectionHeadIcon(iconName),
    cssSectionTitle(title),
    ...args,
  );
}

const cssSectionHead = styled("div", `
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;

  ${revealed}
`);

const cssSectionHeadIcon = styled(icon, `
  flex: none;
  width: 18px;
  height: 18px;
  align-self: center;
  --icon-color: ${theme.controlFg};
`);

const cssSectionTitle = styled(unstyledH2, `
  min-width: 0;
  font-weight: 500;
  font-size: 17px;
  line-height: 24px;
  white-space: nowrap;
`);

export const cssSectionBody = styled("div", `
  margin-top: 8px;
`);
