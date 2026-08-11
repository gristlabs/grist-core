import { copyToClipboard } from "app/client/lib/clipboardUtils";
import { makeT } from "app/client/lib/localization";
import { hoverTooltip, showTransientTooltip } from "app/client/ui/tooltips";
import { testId, theme } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { tokens } from "app/common/ThemePrefs";
import { getAdminConfig } from "app/common/urlUtils";

import { dom, DomElementArg, styled } from "grainjs";

const t = makeT("InstallationIdBlock");
const TOOLTIP_KEY = "copy-installation-id";

/**
 * This installation's identity, for wherever the user has to hand it to Grist Labs
 * (activation key requests). Shown redacted; Copy puts the full value on the clipboard.
 * Hidden (returns null) when the page config carries no installation ID.
 * Extra arguments are appended inside the block, for caller-specific help text.
 */
export function buildInstallationIdBlock(...domArgs: DomElementArg[]) {
  const installationId = getAdminConfig().installationId;
  if (!installationId) { return null; }
  return cssIdBlock(
    cssIdLabel(t("Installation ID")),
    cssIdValueRow(
      cssIdValue(redactInstallationId(installationId), testId("installation-id-value")),
      cssIdCopyButton(
        icon("Copy"),
        dom("span", t("Copy")),
        copyInstallationId(() => installationId),
        testId("installation-id-copy"),
      ),
    ),
    ...domArgs,
    testId("installation-id-block"),
  );
}

function copyHandler(value: () => string, confirmation: string) {
  return dom.on("click", async (e, d) => {
    e.stopImmediatePropagation();
    e.preventDefault();
    showTransientTooltip(d as Element, confirmation, {
      key: TOOLTIP_KEY,
    });
    await copyToClipboard(value());
  });
}

function copyInstallationId(getId: () => string) {
  return [
    copyHandler(getId, t("Installation ID copied to clipboard")),
    hoverTooltip(t("Copy to clipboard"), { key: TOOLTIP_KEY }),
  ];
}

function redactInstallationId(id: string): string {
  if (id.length <= 6) { return id; }
  return id.slice(0, 6) + "*".repeat(id.length - 6);
}

const cssIdBlock = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 16px 0;
`);

const cssIdLabel = styled("div", `
  font-weight: 600;
`);

const cssIdValueRow = styled("div", `
  display: flex;
  align-items: stretch;
  gap: 8px;
`);

const cssIdValue = styled("div", `
  flex: 1;
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 8px 12px;
  font-family: ${tokens.fontFamilyMono};
  color: ${theme.inputFg};
  background-color: ${theme.inputDisabledBg};
  border: 1px solid ${theme.inputBorder};
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`);

const cssIdCopyButton = styled("div", `
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  cursor: pointer;
  color: ${theme.controlFg};
  --icon-color: ${theme.controlFg};
  border: 1px solid ${theme.inputBorder};
  border-radius: 4px;
  white-space: nowrap;
  &:hover {
    background-color: ${theme.lightHover};
  }
`);
