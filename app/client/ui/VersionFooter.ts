import { makeT } from "app/client/lib/localization";
import { hoverTooltip } from "app/client/ui/tooltips";
import { testId, vars } from "app/client/ui2018/cssVars";
import { colorIcon } from "app/client/ui2018/icons";
import { cssLink } from "app/client/ui2018/links";
import { commonUrls, isFullEditionDeployment } from "app/common/gristUrls";
import { components, tokens } from "app/common/ThemePrefs";
import { getGristConfig } from "app/common/urlUtils";
import * as version from "app/common/version";

import { dom, DomContents, Observable, styled } from "grainjs";

const t = makeT("VersionFooter");

/**
 * Builds a footer showing the Grist logo and version, with additional
 * information shown on hover.
 *
 * In the Community edition, the footer is rendered as a banner containing
 * the Grist logo, edition name, and a short note about lack of official support.
 *
 * In all other versions, the footer is rendered as an inline Grist logo and
 * version number (e.g. v1.7.8).
 */
export function createVersionFooter(panelOpen: Observable<boolean>): DomContents {
  const { deploymentType } = getGristConfig();
  const isCommunity = !isFullEditionDeployment(deploymentType);

  // Show the version without any build suffix. (The hover popup shows the full version.)
  const shortVersion = version.version.split("-")[0];

  return cssVersionFooter(
    cssVersionFooter.cls("-collapsed", use => !use(panelOpen)),
    cssVersionFooter.cls("-community", isCommunity),
    cssLogo("GristLogo"),
    cssFooterText(
      isCommunity ?
        [
          cssFooterTitle(t("Grist Community edition")),
          cssFooterSupport(t("No official support")),
        ] :
        cssFooterTitle(
          "Grist ",
          cssFooterVersion(`v${shortVersion}`),
        ),
    ),
    hoverTooltip(() => buildVersionPopup(), {
      closeDelay: 220,
      placement: "top-start",
      cssClass: cssVersionPopup.className,
    }),
    testId("version-footer"),
  );
}

function buildVersionPopup(): DomContents {
  const { deploymentType } = getGristConfig();
  const isCommunity = !isFullEditionDeployment(deploymentType);

  // Cast version.gitcommit since, depending on how Grist is compiled, tsc may believe it to be
  // a constant and believe that testing it is unnecessary.
  const fullVersion = version.version +
    ((version.gitcommit as string) !== "unknown" ? ` (${version.gitcommit})` : "");

  return dom("div",
    cssPopupTitle(
      isCommunity ? t("Grist Community edition") : "Grist",
      testId("version-footer-popup-title"),
    ),
    cssPopupVersion(
      t("Version {{- version}}", { version: fullVersion }),
      testId("version-footer-popup-version"),
    ),
    isCommunity || deploymentType === "enterprise" ?
      cssPopupLinks(buildReleaseNotesLink()) : null,
    isCommunity ?
      [
        cssPopupDivider(),
        cssPopupBody(
          dom("div", t("Not the full edition")),
          dom("div", t("Only community support")),
        ),
        cssPopupLinks(buildEditionComparisonLink()),
      ] : null,
    testId("version-footer-popup"),
  );
}

function buildReleaseNotesLink(): DomContents {
  return cssPopupLink(
    t("Release notes") + " →",
    {
      href: `${commonUrls.githubGristCore}/releases/tag/v${version.version}`,
      target: "_blank",
      rel: "noopener noreferrer",
    },
    testId("version-footer-popup-link"),
  );
}

function buildEditionComparisonLink(): DomContents {
  return cssPopupLink(
    t("Compare editions") + " →",
    {
      href: commonUrls.editionComparison,
      target: "_blank",
      rel: "noopener noreferrer",
    },
    testId("version-footer-popup-link"),
  );
}

const cssVersionFooter = styled("div", `
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px 8px 24px;
  border-top: 1px solid ${components.pagePanelsBorder};
  cursor: default;

  &-community {
    background-color: ${tokens.bgWarningSubtle};
    border-top-color: ${tokens.borderWarningSubtle};
  }
  &-collapsed {
    padding: 8px 0;
    justify-content: center;
  }
`);

const cssLogo = styled(colorIcon, `
  flex: none;
  width: 16px;
  height: 16px;
`);

const cssFooterText = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;

  .${cssVersionFooter.className}-collapsed & {
    display: none;
  }
`);

const cssFooterTitle = styled("span", `
  font-size: ${vars.smallFontSize};
  font-weight: 600;
  color: ${components.mediumText};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`);

const cssFooterVersion = styled("span", `
  font-weight: 400;
  color: ${components.lightText};
`);

const cssFooterSupport = styled("span", `
  font-size: ${vars.xsmallFontSize};
  color: ${tokens.warning};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`);

const cssVersionPopup = styled("div", `
  width: 250px;
  padding: 12px 14px;
  text-align: left;
  background-color: ${components.popupBg};
  color: ${components.text};
  font-family: ${vars.fontFamily};
  font-size: ${vars.smallFontSize};
  border: 1px solid ${components.menuBorder};
  border-radius: 6px;
  box-shadow: 0 2px 20px 0 ${components.menuShadow};
`);

const cssPopupTitle = styled("div", `
  font-size: ${vars.mediumFontSize};
  font-weight: 600;
  color: ${components.darkText};
`);

const cssPopupVersion = styled("div", `
  font-size: ${vars.xsmallFontSize};
  color: ${components.lightText};
  margin-top: 2px;
  word-break: break-all;
`);

const cssPopupDivider = styled("div", `
  height: 1px;
  background-color: ${components.menuBorder};
  margin: 10px -14px;
`);

const cssPopupBody = styled("div", `
  font-size: ${vars.smallFontSize};
  line-height: 1.6;
`);

const cssPopupLinks = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
  margin-top: 8px;
`);

const cssPopupLink = styled(cssLink, `
  font-size: ${vars.smallFontSize};
  font-weight: 600;
`);
