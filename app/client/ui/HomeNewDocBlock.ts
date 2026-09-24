import { makeT } from "app/client/lib/localization";
import { urlState } from "app/client/models/gristUrlState";
import { HomeModel } from "app/client/models/HomeModel";
import { revealed } from "app/client/ui/HomeSection";
import { newDocMethods } from "app/client/ui/NewDocMethods";
import { bigPrimaryButton } from "app/client/ui2018/buttons";
import { theme } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { isFeatureEnabled } from "app/common/gristUrls";
import { getGristConfig } from "app/common/urlUtils";

import { dom, DomElementArg, makeTestId, styled } from "grainjs";

const t = makeT("HomeNewDocBlock");

const testId = makeTestId("test-intro-");

/**
 * Builds the home page's buttons for creating a new document.
 */
export function buildNewDocumentBlock(homeModel: HomeModel, ...args: DomElementArg[]) {
  const { templateOrg } = getGristConfig();
  const hasTemplates = isFeatureEnabled("templates") && Boolean(templateOrg);

  return cssNewDocBlock(
    cssNewDocAction(
      cssNewDocActionIcon("Page"),
      t("Blank document"),
      dom.on("click", () => newDocMethods.createDocAndOpen(homeModel)),
      dom.boolAttr("disabled", use => !use(homeModel.newDocWorkspace)),
      testId("create-doc"),
    ),
    cssNewDocAction(
      cssNewDocActionIcon("Import"),
      t("Import file"),
      dom.on("click", () => newDocMethods.importDocAndOpen(homeModel)),
      dom.boolAttr("disabled", use => !use(homeModel.newDocWorkspace)),
      testId("import-doc"),
    ),
    hasTemplates ? cssNewDocAction(
      cssNewDocActionIcon("FieldTable"),
      t("Templates"),
      urlState().setLinkUrl({ homePage: "templates" }),
      testId("templates"),
    ) : null,
    ...args,
    testId("new-doc-actions"),
  );
}

export const cssNewDocBlock = styled("div", `
  display: flex;
  gap: 12px;
  color: ${theme.text};
  ${revealed}

  & > * {
    flex: 1 1 0;
    min-width: 0;
  }

  @container (max-width: 469.98px) {
    & {
      flex-direction: column;
    }
  }
`);

const cssNewDocAction = styled(bigPrimaryButton, `
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 6px 12px;
  white-space: nowrap;
  overflow: hidden;
  transition: background-color 150ms ease, border-color 150ms ease;

  @media (prefers-reduced-motion: reduce) {
    & {
      transition: none;
    }
  }
`);

const cssNewDocActionIcon = styled(icon, `
  flex-shrink: 0;
`);
