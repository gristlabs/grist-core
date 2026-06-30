import { Banner } from "app/client/components/Banner";
import { makeT } from "app/client/lib/localization";
import { inlineMarkdown } from "app/client/lib/markdown";
import { AppModel } from "app/client/models/AppModel";
import { theme } from "app/client/ui2018/cssVars";
import { colorIcon } from "app/client/ui2018/icons";
import { commonUrls } from "app/common/gristUrls";

import { Disposable, dom, makeTestId, styled } from "grainjs";

const t = makeT("McpConnectBanner");

const testId = makeTestId("test-mcp-connect-banner-");

export class McpConnectBanner extends Disposable {
  constructor(private _app: AppModel) {
    super();
  }

  public buildDom() {
    return dom.domComputed((use) => {
      // Advertised in every edition, whether or not the MCP server is enabled.
      if (!this._app.currentValidUser) { return null; }
      // Only on doc list page.
      if (use(this._app.pageType) !== "home") { return null; }
      // Only when the banner was not dismissed.
      if (use(this._app.dismissedPopups).includes("mcpConnectBanner")) { return null; }

      return dom.create(Banner, {
        content: cssMessage(
          cssSparks("Sparks"),
          cssText(inlineMarkdown(t(
            "**New!** Connect Grist to Claude and ChatGPT. [Try it now]({{mcp}})",
            { mcp: commonUrls.mcp },
          ))),
          testId("text"),
        ),
        style: "info",
        showCloseButton: true,
        bannerCssClass: cssBanner.className,
        onClose: () => this._app.dismissPopup("mcpConnectBanner"),
      });
    });
  }
}

const cssBanner = styled("div", `
  & a {
    color: ${theme.controlFg};
  }
  & .test-banner-close {
    background-color: ${theme.text};
  }
`);

const cssMessage = styled("div", `
  display: flex;
  align-items: center;
  gap: 8px;
  flex-grow: 1;
  justify-content: center;
`);

const cssSparks = styled(colorIcon, `
  flex-shrink: 0;
  width: 16px;
  height: 16px;
`);

const cssText = styled("div", `
  font-weight: 500;
`);
