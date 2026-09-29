import { makeT } from "app/client/lib/localization";
import { HomeModel } from "app/client/models/HomeModel";
import { productPill } from "app/client/ui/AppHeader";
import * as css from "app/client/ui/DocMenuCss";
import { buildHomeAssistantComposer, hasHomeAssistantComposer } from "app/client/ui/HomeAssistant";
import { buildLearningResources } from "app/client/ui/HomeLearningResources";
import { buildNewDocumentBlock, cssNewDocBlock } from "app/client/ui/HomeNewDocBlock";
import { buildSectionHead, cssSectionBody, reveal, revealed } from "app/client/ui/HomeSection";
import { isNarrowScreenObs, testId, theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { menu, menuCssClass } from "app/client/ui2018/menus";
import { toggleSwitch } from "app/client/ui2018/toggleSwitch";
import { FullUser } from "app/common/LoginSessionAPI";

import { dom, DomContents, DomElementArg, styled } from "grainjs";
import { defaultMenuOptions } from "popweasel";

const t = makeT("HomeIntro");

const MAX_ANIMATED_VISITS = 10;

function shouldAnimateIntro(homeModel: HomeModel): boolean {
  return hasHomeAssistantComposer() &&
    homeModel.app.impressions.getCount("assistantIntro") < MAX_ANIMATED_VISITS;
}

function countIntroImpression(homeModel: HomeModel): DomElementArg {
  return dom.on("animationstart", () =>
    homeModel.app.impressions.incrementCount("assistantIntro", MAX_ANIMATED_VISITS));
}

export function buildHomeIntro(homeModel: HomeModel): DomContents {
  const user = homeModel.app.currentValidUser;
  const isAnonym = !user;
  const isPersonal = !homeModel.app.isTeamSite;
  const animate = shouldAnimateIntro(homeModel);
  if (isAnonym) {
    return makeAnonIntro(homeModel, animate);
  } else if (isPersonal) {
    return makePersonalIntro(homeModel, user, animate);
  } else {
    return makeTeamSiteIntro(homeModel, animate);
  }
}

function makeTeamSiteIntro(homeModel: HomeModel, animate: boolean) {
  return [
    cssGreetingHeader(
      cssHeaderWithPill(
        cssHeader(
          dom.text(use =>
            use(isNarrowScreenObs()) ?
              homeModel.app.currentOrgName :
              t("Welcome to {{- orgName}}", { orgName: homeModel.app.currentOrgName }),
          ),
        ),
        cssPill(productPill(homeModel.app.currentOrg, { large: true })),
        testId("welcome-title"),
      ),
      buildPreferencesMenu(homeModel),
      reveal(animate, 0),
    ),
    buildIntroBody(homeModel, animate),
  ];
}

function makePersonalIntro(homeModel: HomeModel, user: FullUser, animate: boolean) {
  return [
    cssGreetingHeader(
      cssHeader(
        // this is like using a `<h1>` element, but in our case it's easier to use aria attributes than changing
        // some common `styled` components in order to use a specific h1 here
        { "role": "heading", "aria-level": "1" },
        dom.text(use =>
          use(isNarrowScreenObs()) ?
            t("Welcome to Grist!") :
            t("Welcome to Grist, {{- name}}!", { name: user.name }),
        ),
        testId("welcome-title"),
      ),
      buildPreferencesMenu(homeModel),
      reveal(animate, 0),
    ),
    buildIntroBody(homeModel, animate),
  ];
}

function makeAnonIntro(homeModel: HomeModel, animate: boolean) {
  return [
    cssGreetingHeader(
      cssHeader(
        t("Welcome to Grist!"),
        testId("welcome-title"),
      ),
      reveal(animate, 0),
    ),
    buildIntroBody(homeModel, animate),
  ];
}

function buildIntroBody(homeModel: HomeModel, animate: boolean): DomContents {
  return dom.maybe(use => !use(homeModel.onlyShowDocuments), () => {
    return cssIntroFlow(
      cssCreateSection(
        buildSectionHead(
          hasHomeAssistantComposer() ? "Sparkle" : "Plus",
          t("Create a document"),
          reveal(animate, 80),
        ),
        cssCreateBody(
          cssCreateBody.cls("-with-assistant", hasHomeAssistantComposer()),
          dom.create(buildHomeAssistantComposer, { homeModel, showIntro: animate }),
          buildNewDocumentBlock(homeModel, reveal(animate, 320)),
        ),
        animate ? countIntroImpression(homeModel) : null,
        testId("intro-create-section"),
      ),
      cssLearnSection(
        dom.create(buildLearningResources, { homeModel, showIntro: animate }),
        testId("intro-learn-section"),
      ),
    );
  });
}

function buildPreferencesMenu(homeModel: HomeModel) {
  const { onlyShowDocuments } = homeModel;

  return cssDotsMenu(
    cssDots(icon("Dots")),
    menu(
      () => [
        toggleSwitch(onlyShowDocuments, {
          label: t("Only show documents"),
          args: [
            testId("welcome-menu-only-show-documents"),
          ],
        }),
      ],
      {
        ...defaultMenuOptions,
        menuCssClass: `${menuCssClass} ${cssPreferencesMenu.className}`,
        placement: "bottom-end",
      },
    ),
    testId("welcome-menu"),
  );
}

const cssGreetingHeader = styled(css.headerWrap, `
  padding: 16px 0px 24px 0px;
  ${revealed}
`);

const cssHeader = styled(css.listHeaderNoWrap, `
  font-size: 24px;
  line-height: 36px;
`);

const cssHeaderWithPill = styled("div", `
  display: flex;
  align-items: center;
  overflow: hidden;
`);

const cssIntroFlow = styled("div", `
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  column-gap: 40px;
  row-gap: 32px;
  width: 100%;
  margin-bottom: 24px;
`);

const cssCreateSection = styled("div", `
  flex: 1 1 470px;
  min-width: 0;
  container-type: inline-size;
`);

const cssLearnSection = styled("div", `
  flex: 1 1 412px;
  min-width: 0;
  container-type: inline-size;
  display: flex;
  flex-direction: column;
`);

const cssCreateBody = styled(cssSectionBody, `
  display: flex;
  flex-direction: column;
  gap: 12px;

  & > * {
    width: 100%;
  }

  @container (min-width: 832px) {
    &-with-assistant {
      flex-direction: row;
      align-items: stretch;
      gap: 20px;
    }
    &-with-assistant > * {
      flex: 1 1 auto;
      width: auto;
    }
    &-with-assistant > .${cssNewDocBlock.className} {
      flex: 0 0 240px;
      flex-direction: column;
    }
    &-with-assistant > .${cssNewDocBlock.className} > * {
      flex: 1 1 0;
      min-height: 0;
    }
  }
`);

const cssPill = styled("div", `
  flex-shrink: 0;
`);

const cssPreferencesMenu = styled("div", `
  padding: 10px 16px;
`);

const cssDotsMenu = styled("div", `
  display: flex;
  cursor: pointer;
  border-radius: ${vars.controlBorderRadius};

  &:hover, &.weasel-popup-open {
    background-color: ${theme.hover};
  }
`);

const cssDots = styled("div", `
  --icon-color: ${theme.lightText};
  padding: 8px;
`);
