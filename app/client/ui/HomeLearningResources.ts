import { makeT } from "app/client/lib/localization";
import { urlState } from "app/client/models/gristUrlState";
import { HomeModel } from "app/client/models/HomeModel";
import { buildSectionHead, cssSectionBody, reveal, revealed } from "app/client/ui/HomeSection";
import { openVideoTour } from "app/client/ui/OpenVideoTour";
import { theme } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { unstyledButton, unstyledH2, unstyledLink } from "app/client/ui2018/unstyled";
import { commonUrls, isFeatureEnabled } from "app/common/gristUrls";
import { getGristConfig } from "app/common/urlUtils";

import {
  Computed,
  dom,
  DomContents,
  DomElementArg,
  IDisposableOwner,
  makeTestId,
  styled,
  subscribeElem,
} from "grainjs";

const t = makeT("HomeLearningResources");

const testId = makeTestId("test-intro-");

const CARD_RADIUS_PX = 8;
const CARD_ICON_PX = 44;

interface LearningResource {
  title: string;
  description: string;
  icon: () => DomContents;
  link?: DomElementArg;
  onClick?: (elem: HTMLElement) => void;
  progress?: Computed<number | undefined>;
  testId: "video-tour" | "tutorial" | "webinars" | "help-center";
}

function getLearningResources(
  owner: IDisposableOwner, homeModel: HomeModel,
): LearningResource[] {
  const { templateOrg, onboardingTutorialDocId } = getGristConfig();

  const hasTutorial = isFeatureEnabled("tutorials") &&
    Boolean(templateOrg) && Boolean(onboardingTutorialDocId);
  const hasHelpCenter = isFeatureEnabled("helpCenter");

  const percentComplete = Computed.create(owner, (use) => {
    if (!homeModel.app.currentValidUser) { return 0; }

    const tutorial = use(homeModel.onboardingTutorial);
    if (!tutorial) { return undefined; }

    return tutorial.forks?.[0]?.options?.tutorial?.percentComplete ?? 0;
  });

  const resources: LearningResource[] = [
    {
      title: t("Video Tour"),
      description: t("A 3 minute tour of Grist"),
      icon: () => cssVideoTourPlayButton(cssVideoTourPlayIcon("VideoPlay2")),
      onClick: elem => openVideoTour(elem),
      testId: "video-tour",
    },
  ];

  if (hasTutorial) {
    resources.push({
      title: t("Grist Tutorial"),
      description: t("Learn the basics, step by step"),
      icon: () => cssTutorialLogo(),
      link: urlState().setLinkUrl({
        org: templateOrg ?? undefined,
        doc: onboardingTutorialDocId,
      }),
      progress: percentComplete,
      testId: "tutorial",
    });
  }

  if (hasHelpCenter) {
    resources.push({
      title: t("Webinars"),
      description: t("Tutorials and live sessions"),
      icon: () => cssCardImage({ src: "img/webinars.svg" }),
      link: { href: commonUrls.webinars, target: "_blank" },
      testId: "webinars",
    }, {
      title: t("Help Center"),
      description: t("Tutorials, docs, guides and videos"),
      icon: () => cssCardImage({ src: "img/help-center.svg" }),
      link: { href: commonUrls.help, target: "_blank" },
      testId: "help-center",
    });
  }

  return resources;
}

interface BuildLearningResourcesOptions {
  homeModel: HomeModel;
  showIntro: boolean;
}

/**
 * Builds the home page's "Learn Grist" section.
 */
export function buildLearningResources(
  owner: IDisposableOwner, { homeModel, showIntro }: BuildLearningResourcesOptions,
): DomContents {
  const resources = getLearningResources(owner, homeModel);

  return [
    buildSectionHead("UseEducate", t("Learn Grist"), reveal(showIntro, 80)),
    cssCards(
      { "aria-label": t("Learning resources") },
      resources.map((resource, index) =>
        buildCard(resource, reveal(showIntro, 320 + (index + 1) * 60))),
      testId("cards"),
    ),
  ];
}

function buildCard(resource: LearningResource, ...args: DomElementArg[]): DomContents {
  const { progress } = resource;
  const contents = [
    cssCardIcon(resource.icon()),
    cssCardText(
      cssCardTitle(resource.title),
      !progress ? cssCardDescription(resource.description) :
        dom.domComputed(progress, percent => percent ?
          cssTutorialProgress(
            progressBar(progress),
            cssTutorialProgressPercentage(
              dom.text(`${percent}%`),
              testId("tutorial-percent-complete"),
            ),
          ) :
          cssCardDescription(resource.description)),
    ),
    ...args,
    testId(resource.testId),
  ];
  return resource.onClick ?
    cssCardButton(
      { type: "button" },
      dom.on("click", (_ev, elem) => resource.onClick!(elem)),
      contents,
    ) :
    cssCardLink(resource.link ?? null, contents);
}

const cssCards = styled(cssSectionBody, `
  flex: 1 1 auto;
  display: grid;
  gap: 12px;
  grid-template-columns: 1fr;
  grid-auto-rows: 1fr;

  @container (min-width: 400px) {
    & {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @container (min-width: 860px) {
    & {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
`);

const cardHoverBg =
  `color-mix(in srgb, ${theme.controlPrimaryHoverBg} 12%, ${theme.announcementPopupBg})`;

const hoverTransition = `transition: background-color 150ms ease;`;

const hoverTransitionReducedMotion = `
  @media (prefers-reduced-motion: reduce) {
    & {
      transition: none;
    }
  }
`;

const cardBase = `
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  border-radius: ${CARD_RADIUS_PX}px;
  background-color: ${theme.announcementPopupBg};
  color: ${theme.announcementPopupFg};
  min-width: 0;
  cursor: pointer;
  text-decoration: none;
  outline-offset: 1px;
  text-align: left;
  ${hoverTransition}
`;

const cardHover = `
  &:hover, &:focus-visible {
    background-color: ${cardHoverBg};
  }
  ${hoverTransitionReducedMotion}
`;

const cssCardLink = styled(unstyledLink, `
  ${cardBase}
  ${revealed}
  ${cardHover}
`);

const cssCardButton = styled(unstyledButton, `
  ${cardBase}
  ${revealed}
  ${cardHover}
`);

const cssCardIcon = styled("div", `
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: ${CARD_ICON_PX}px;
  height: ${CARD_ICON_PX}px;
  border-radius: 6px;
  background-color: ${theme.mainPanelBg};

  & img {
    width: auto;
    height: auto;
    max-width: 36px;
    max-height: 28px;
  }
`);

const cssCardText = styled("div", `
  min-width: 0;
  flex: 1 1 auto;
`);

const cssCardTitle = styled(unstyledH2, `
  font-size: 15px;
  font-weight: 500;
  line-height: 20px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`);

const cssCardDescription = styled("div", `
  color: ${theme.mediumText};
  font-size: 12px;
  font-weight: 400;
  line-height: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`);

const cssCardImage = styled("img", `
  display: block;
`);

const cssTutorialLogo = styled("div", `
  width: 28px;
  height: 28px;
  background-image: var(--icon-GristLogo);
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
`);

const cssTutorialProgress = styled("div", `
  display: flex;
  align-items: center;
  gap: 8px;
  height: 16px;
`);

const cssTutorialProgressPercentage = styled("div", `
  flex: none;
  font-size: 12px;
  font-weight: 700;
  line-height: 16px;
`);

function progressBar(progress: Computed<number | undefined>, ...args: DomElementArg[]): DomContents {
  return cssTutorialProgressBar(
    elem => subscribeElem(elem, progress, (value) => {
      elem.style.setProperty("--percent-complete", String(value ?? 0));
    }),
    ...args,
  );
}

const cssTutorialProgressBar = styled("div", `
  flex: 0 1 180px;
  height: 6px;
  border-radius: 8px;
  background: ${theme.mainPanelBg};
  --percent-complete: 0;

  &::after {
    content: '';
    border-radius: 8px;
    background: ${theme.progressBarFg};
    display: block;
    height: 100%;
    width: calc((var(--percent-complete) / 100) * 100%);
  }
`);

const cssVideoTourPlayButton = styled("div", `
  display: flex;
  justify-content: center;
  align-items: center;
  width: 32px;
  height: 32px;
  background-color: ${theme.controlPrimaryBg};
  border-radius: 50%;
  ${hoverTransition}

  .${cssCardButton.className}:hover &,
  .${cssCardButton.className}:focus-visible & {
    background-color: ${theme.controlPrimaryHoverBg};
  }
  ${hoverTransitionReducedMotion}
`);

const cssVideoTourPlayIcon = styled(icon, `
  --icon-color: ${theme.controlPrimaryFg};
  width: 18px;
  height: 18px;
`);
