import { makeT } from "app/client/lib/localization";
import { markdown } from "app/client/lib/markdown";
import { bigPrimaryButton } from "app/client/ui2018/buttons";
import { mediaSmall, theme, vars } from "app/client/ui2018/cssVars";
import { commonUrls } from "app/common/gristUrls";

import { dom, DomContents, makeTestId, styled } from "grainjs";

const testId = makeTestId("test-automations-");

const t = makeT("TriggersPage");

export function buildAutomationsUpsell(): DomContents {
  return cssIntroSection(
    cssIntroImage({ alt: "", src: "img/process.svg" }),
    cssIntroContent(
      markdown(t(`\
## Automations

Send emails and call webhooks automatically when your data changes. \
Set conditions to control exactly which updates should trigger an action. \
More action types are on the way.`),
      ),
      cssIntroButton(
        bigPrimaryButton(t("Upgrade"),
          dom.on("click", () => window.open(commonUrls.plans, "_blank")),
        ),
      ),
    ),
    testId("upsell"),
  );
}

const cssIntroSection = styled("div", `
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 60px;
  padding: 48px;
  width: 100%;
  max-width: 900px;
  margin: 0 auto;
  color: ${theme.text};
  font-size: ${vars.introFontSize};
  line-height: 1.6;

  @media ${mediaSmall} {
    & {
      flex-direction: column;
      padding: 24px 12px;
      gap: 24px;
    }
  }
`);

const cssIntroImage = styled("img", `
  display: block;
  flex: 0 0 auto;
  width: 320px;
  max-width: 100%;

  @media ${mediaSmall} {
    & {
      width: 200px;
    }
  }
`);

const cssIntroContent = styled("div", `
  flex: 1 1 auto;
  min-width: 0;
  max-width: 420px;
`);

const cssIntroButton = styled("div", `
  margin-top: 32px;
`);
