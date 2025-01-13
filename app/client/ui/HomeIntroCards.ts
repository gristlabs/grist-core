import {makeT} from 'app/client/lib/localization';
import {urlState} from 'app/client/models/gristUrlState';
import {HomeModel} from 'app/client/models/HomeModel';
import {newDocMethods} from 'app/client/ui/NewDocMethods';
import {openVideoTour} from 'app/client/ui/OpenVideoTour';
import {basicButtonLink, bigPrimaryButton, primaryButtonLink} from 'app/client/ui2018/buttons';
import {colors, theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {commonUrls, isFeatureEnabled} from 'app/common/gristUrls';
import {getGristConfig} from 'app/common/urlUtils';
import {Computed, dom, IDisposableOwner, makeTestId, styled, subscribeElem} from 'grainjs';

interface BuildHomeIntroCardsOptions {
  homeModel: HomeModel;
}

const t = makeT('HomeIntroCards');

const testId = makeTestId('test-intro-');

export function buildHomeIntroCards(
  owner: IDisposableOwner,
  {homeModel}: BuildHomeIntroCardsOptions
) {
  const {onboardingTutorialDocId, templateOrg} = getGristConfig();

  const percentComplete = Computed.create(owner, (use) => {
    if (!homeModel.app.currentValidUser) { return 0; }

    const tutorial = use(homeModel.onboardingTutorial);
    if (!tutorial) { return undefined; }

    return tutorial.forks?.[0]?.options?.tutorial?.percentComplete ?? 0;
  });

  let videoPlayButtonElement: HTMLElement;

  return dom.maybe(use => !use(homeModel.onlyShowDocuments), () => cssHomeIntroCards(
    cssVideoTour(
      cssVideoTourThumbnail(
        cssVideoTourThumbnailSpacer(),
        videoPlayButtonElement = cssVideoTourPlayButton(
          cssVideoTourPlayIcon('VideoPlay2'),
        ),
        cssVideoTourThumbnailText(t('3 minute video tour')),
      ),
      dom.on('click', () => openVideoTour(videoPlayButtonElement)),
      testId('video-tour'),
    ),
    cssTutorial(
      dom.hide(() => !isFeatureEnabled('tutorials') || !templateOrg || !onboardingTutorialDocId),
      cssTutorialHeader(t('Finish our basics tutorial')),
      cssTutorialBody(
        cssTutorialProgress(
          cssTutorialProgressText(
            cssTutorialProgressPercentage(
              dom.domComputed(percentComplete, (percent) => percent !== undefined ? `${percent}%` : null),
              testId('tutorial-percent-complete'),
            ),
          ),
          cssTutorialProgressBar(
            (elem) => subscribeElem(elem, percentComplete, (val) => {
              elem.style.setProperty('--percent-complete', String(val ?? 0));
            })
          ),
        ),
        dom('div',
          primaryButtonLink(
            t('Tutorial'),
            urlState().setLinkUrl({org: templateOrg!, doc: onboardingTutorialDocId}),
          ),
        )
      ),
      testId('tutorial'),
    ),
    cssNewDocument(
      cssNewDocumentHeader(t('Start a new document')),
      cssNewDocumentBody(
        cssNewDocumentButton(
          cssNewDocumentButtonIcon('Page'),
          t('Blank document'),
          dom.on('click', () => newDocMethods.createDocAndOpen(homeModel)),
          dom.boolAttr('disabled', use => !use(homeModel.newDocWorkspace)),
          testId('create-doc'),
        ),
        cssNewDocumentButton(
          cssNewDocumentButtonIcon('Import'),
          t('Import file'),
          dom.on('click', () => newDocMethods.importDocAndOpen(homeModel)),
          dom.boolAttr('disabled', use => !use(homeModel.newDocWorkspace)),
          testId('import-doc'),
        ),
        cssNewDocumentButton(
          dom.show(isFeatureEnabled("templates") && Boolean(templateOrg)),
          cssNewDocumentButtonIcon('FieldTable'),
          t('Templates'),
          urlState().setLinkUrl({homePage: 'templates'}),
          testId('templates'),
        ),
      ),
    ),
    cssWebinars(
      dom.show(isFeatureEnabled('helpCenter')),
      cssWebinarsImage({src: 'img/webinars.svg'}),
      t('Learn more {{webinarsLinks}}', {
        webinarsLinks: cssWebinarsButton(
          t('Webinars'),
          {href: commonUrls.webinars, target: '_blank'},
          testId('webinars'),
        ),
      }),
    ),
    cssHelpCenter(
      dom.show(isFeatureEnabled('helpCenter')),
      cssHelpCenterImage({src: 'img/help-center.svg'}),
      t('Find solutions and explore more resources {{helpCenterLink}}', {
        helpCenterLink: cssHelpCenterButton(
          t('Help center'),
          {href: commonUrls.help, target: '_blank'},
          testId('help-center'),
        ),
      }),
    ),
    testId('cards'),
  ));
}

// Cards are hidden at specific breakpoints; we use non-standard ones
// here, as they work better than the ones defined in `cssVars.ts`.
const mediaXLarge = `(max-width: ${1440 - 0.02}px)`;
const mediaLarge = `(max-width: ${1280 - 0.02}px)`;
const mediaMedium = `(max-width: ${1048 - 0.02}px)`;
const mediaSmall = `(max-width: ${828 - 0.02}px)`;

const cssHomeIntroCards = styled('div', `
  display: grid;
  gap: 24px;
  margin-bottom: 24px;
  display: grid;
  grid-template-columns: 239px minmax(0, 437px) minmax(196px, 1fr) minmax(196px, 1fr);
  grid-template-rows: repeat(2, 1fr);

  @media ${mediaLarge} {
    & {
      grid-template-columns: 239px minmax(0, 437px) minmax(196px, 1fr);
    }
  }
  @media ${mediaMedium} {
    & {
      grid-template-columns: 239px minmax(0, 437px);
    }
  }
  @media ${mediaSmall} {
    & {
      display: flex;
      flex-direction: column;
    }
  }
`);

const cssVideoTour = styled('div', `
  grid-area: 1 / 1 / 2 / 2;
  flex-shrink: 0;
  width: 239px;
  overflow: hidden;
  cursor: pointer;
  border-radius: 4px;
  aspect-ratio: 16 / 9;

  @media ${mediaSmall} {
    & {
      width: unset;
      aspect-ratio: unset;
      min-height: 120px;
    }
  }
`);

const cssVideoTourThumbnail = styled('div', `
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 36px 32px;
  background-image: url("img/youtube-screenshot.png");
  background-color: rgba(0, 0, 0, 0.4);
  background-blend-mode: multiply;
  background-size: cover;
  transform: scale(1.2);
  width: 100%;
  height: 100%;
`);

const cssVideoTourThumbnailSpacer = styled('div', ``);

const cssVideoTourPlayButton = styled('div', `
  display: flex;
  justify-content: center;
  align-items: center;
  align-self: center;
  width: 32px;
  height: 32px;
  background-color: ${theme.controlPrimaryBg};
  border-radius: 50%;

  .${cssVideoTourThumbnail.className}:hover & {
    background-color: ${theme.controlPrimaryHoverBg};
  }
`);

const cssVideoTourPlayIcon = styled(icon, `
  --icon-color: ${theme.controlPrimaryFg};
  width: 24px;
  height: 24px;
`);

const cssVideoTourThumbnailText = styled('div', `
  color: ${colors.light};
  font-weight: 700;
  text-align: center;
`);

const cssTutorial = styled('div', `
  grid-area: 1 / 2 / 2 / 3;
  position: relative;
  border-radius: 4px;
  color: ${theme.announcementPopupFg};
  background-color: ${theme.announcementPopupBg};
  padding: 16px;
`);

const cssTutorialHeader = styled('div', `
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  font-size: 16px;
  font-style: normal;
  font-weight: 500;
  margin-bottom: 8px;
`);

const cssTutorialBody = styled('div', `
  display: flex;
  flex-direction: column;
  gap: 16px;
`);

const cssTutorialProgress = styled('div', `
  display
  flex: auto;
  min-width: 120px;
`);

const cssTutorialProgressText = styled('div', `
  display: flex;
  justify-content: space-between;
`);

const cssTutorialProgressPercentage = styled('div', `
  font-size: 18px;
  font-style: normal;
  font-weight: 700;
  min-height: 21.5px;
`);

const cssTutorialProgressBar = styled('div', `
  margin-top: 4px;
  height: 10px;
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

const cssNewDocument = styled('div', `
  grid-area: 2 / 1 / 3 / 3;
  grid-column: span 2;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  position: relative;
  border-radius: 4px;
  color: ${theme.announcementPopupFg};
  background-color: ${theme.announcementPopupBg};
  padding: 24px;
  min-height: 140px;
`);

const cssNewDocumentHeader = styled('div', `
  font-weight: 500;
  font-size: ${vars.xxlargeFontSize};
`);

const cssNewDocumentBody = styled('div', `
  display: flex;
  gap: 16px;
  margin-top: 16px;

  @media ${mediaSmall} {
    & {
      flex-direction: column;
    }
  }
`);

const cssNewDocumentButton = styled(bigPrimaryButton, `
  display: flex;
  align-items: center;
  justify-content: center;
  flex-grow: 1;
  padding: 6px;
`);

const cssNewDocumentButtonIcon = styled(icon, `
  flex-shrink: 0;
  margin-right: 8px;

  @media ${mediaXLarge} {
    & {
      display: none;
    }
  }
`);

const cssSecondaryCard = styled('div', `
  font-weight: 500;
  font-size: 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  justify-content: center;
  min-width: 196px;
  color: ${theme.text};
  background-color: ${theme.popupSecondaryBg};
  position: relative;
  border-radius: 4px;
  padding: 16px;
  min-height: 140px;
`);

const cssSecondaryCardImage = styled('img', `
  display: block;
  height: auto;
`);

const cssSecondaryCardButton = styled(basicButtonLink, `
  font-weight: 400;
  font-size: ${vars.mediumFontSize};
  margin-top: 8px;
`);

const cssWebinars = styled(cssSecondaryCard, `
  grid-area: 2 / 3 / 3 / 4;

  @media ${mediaMedium} {
    & {
      display: none;
    }
  }
`);

const cssWebinarsImage = styled(cssSecondaryCardImage, `
  width: 105.78px;
  margin-bottom: 8px;
`);

const cssWebinarsButton = cssSecondaryCardButton;

const cssHelpCenter = styled(cssSecondaryCard, `
  grid-area: 2 / 4 / 3 / 5;

  @media ${mediaLarge} {
    & {
      display: none;
    }
  }
`);

const cssHelpCenterImage = styled(cssSecondaryCardImage, `
  width: 67.77px;
`);

const cssHelpCenterButton = cssSecondaryCardButton;
