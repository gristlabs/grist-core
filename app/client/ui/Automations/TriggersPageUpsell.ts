import { makeT } from "app/client/lib/localization";
import { markdown } from "app/client/lib/markdown";
import { AppModel } from "app/client/models/AppModel";
import { bigPrimaryButton, bigPrimaryButtonLink } from "app/client/ui2018/buttons";
import { mediaSmall, theme } from "app/client/ui2018/cssVars";
import { cssNestedLinks } from "app/client/ui2018/links";
import { commonUrls } from "app/common/gristUrls";
import { tokens } from "app/common/ThemePrefs";
import { getGristConfig } from "app/common/urlUtils";

import { dom, DomContents, makeTestId, styled } from "grainjs";

const testId = makeTestId("test-automations-");

const t = makeT("TriggersPage");

export function buildAutomationsUpsell(appModel: AppModel): DomContents {
  const { deploymentType } = getGristConfig();
  const canUpgrade = deploymentType === "saas" && appModel.isOwner() && appModel.isBillingManager();

  return cssIntroSection({ tabIndex: "-1" },
    cssNestedLinks(markdown(`\
## ${t("Automate workflows from within Grist")}

![${t("Automations Screenshot")}](img/automation-triggers.png)

${t("Trigger automations based on data changes, and design actions such as custom email notifications\
 and webhook integrations.")} [${t("Learn more.")}](${commonUrls.helpAutomations})`),
    ),
    (canUpgrade ?
      bigPrimaryButton(t("Try for free"), dom.on("click", () => appModel.showUpgradeModal())) :
      bigPrimaryButtonLink(
        deploymentType === "core" ? t("Try full Grist") : t("Try for free"),
        { href: commonUrls.plans, target: "_blank" },
      )
    ),
    testId("upsell"),
  );
}

const cssIntroSection = styled("div", `
  padding: 24px;
  width: 100%;
  max-width: 600px;
  margin: 16px auto;
  color: ${theme.text};
  font-size: ${tokens.introFontSize};
  line-height: 1.6;
  text-align: center;

  & img {
    max-width: 100%;
    box-shadow: 0px 0px 4px 0px rgba(0, 0, 0, .3);
    border-radius: 4px 4px 0 0;
  }

  @media ${mediaSmall} {
    & {
      width: auto;
      padding: 12px;
      margin: 8px;
    }
  }
`);
