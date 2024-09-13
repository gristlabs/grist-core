import {makeT} from 'app/client/lib/localization';
import {urlState} from 'app/client/models/gristUrlState';
import {HomeModel} from 'app/client/models/HomeModel';
import {openVideoTour} from 'app/client/ui/OpenVideoTour';
import {bigPrimaryButtonLink} from 'app/client/ui2018/buttons';
import {colors, theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {isFeatureEnabled} from 'app/common/gristUrls';
import {getGristConfig} from 'app/common/urlUtils';
import {Computed, dom, IDisposableOwner, makeTestId, styled, subscribeElem} from 'grainjs';

interface BuildOnboardingCardsOptions {
  homeModel: HomeModel;
}

const t = makeT('OnboardingCards');

const testId = makeTestId('test-onboarding-');

export function buildOnboardingCards(
  owner: IDisposableOwner,
  {homeModel}: BuildOnboardingCardsOptions
) {
  const {templateOrg, onboardingTutorialDocId} = getGristConfig();
  if (!isFeatureEnabled('tutorials') || !templateOrg || !onboardingTutorialDocId) { return null; }

  const percentComplete = Computed.create(owner, (use) => {
    if (!homeModel.app.currentValidUser) { return 0; }

    const tutorial = use(homeModel.onboardingTutorial);
    if (!tutorial) { return undefined; }

    return tutorial.forks?.[0]?.options?.tutorial?.percentComplete ?? 0;
  });

  const shouldShowCards = Computed.create(owner, (use) =>
    !use(homeModel.app.dismissedPopups).includes('onboardingCards'));

  let videoPlayButtonElement: HTMLElement;

  return dom.maybe(shouldShowCards, () =>
    cssOnboardingCards(
      cssTutorialCard(
        cssDismissCardsButton(
          icon('CrossBig'),
          dom.on('click', () => homeModel.app.dismissPopup('onboardingCards', true)),
          testId('dismiss-cards'),
        ),
        cssTutorialCardHeader(
          t('Complete our basics tutorial'),
        ),
        cssTutorialCardSubHeader(
          t('Learn the basics of reference columns, linked widgets, column types, & cards.')
        ),
        cssTutorialCardBody(
          cssTutorialProgress(
            cssTutorialProgressText(
              cssProgressPercentage(
                dom.domComputed(percentComplete, (percent) => percent !== undefined ? `${percent}%` : null),
                testId('tutorial-percent-complete'),
              ),
              cssStarIcon('Star'),
            ),
            cssTutorialProgressBar(
              (elem) => subscribeElem(elem, percentComplete, (val) => {
                elem.style.setProperty('--percent-complete', String(val ?? 0));
              })
            ),
          ),
          bigPrimaryButtonLink(
            t('Complete the tutorial'),
            urlState().setLinkUrl({org: templateOrg, doc: onboardingTutorialDocId}),
          ),
        ),
        testId('tutorial-card'),
      ),
      cssVideoCard(
        cssVideoThumbnail(
          cssVideoThumbnailSpacer(),
          videoPlayButtonElement = cssVideoPlayButton(
            cssPlayIcon('VideoPlay2'),
          ),
          cssVideoThumbnailText(t('3 minute video tour')),
        ),
        dom.on('click', () => openVideoTour(videoPlayButtonElement)),
      ),
    )
  );
}

const cssOnboardingCards = styled('div', `
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, max-content));
  gap: 24px;
  margin: 24px 0;
`);

const cssTutorialCard = styled('div', `
  position: relative;
  border-radius: 4px;
  color: ${theme.announcementPopupFg};
  background-color: ${theme.announcementPopupBg};
  padding: 16px 24px;
`);

const cssTutorialCardHeader = styled('div', `
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  font-size: 18px;
  font-style: normal;
  font-weight: 700;
`);

const cssDismissCardsButton = styled('div', `
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;
  --icon-color: ${theme.popupCloseButtonFg};

  &:hover {
    background-color: ${theme.hover};
  }
`);

const cssTutorialCardSubHeader = styled('div', `
  font-size: 14px;
  font-style: normal;
  font-weight: 500;
  margin: 8px 0;
`);

const cssTutorialCardBody = styled('div', `
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  margin: 16px 0;
  align-items: end;
`);

const cssTutorialProgress = styled('div', `
  flex: auto;
  min-width: 120px;
`);

const cssTutorialProgressText = styled('div', `
  display: flex;
  justify-content: space-between;
`);

const cssProgressPercentage = styled('div', `
  font-size: 20px;
  font-style: normal;
  font-weight: 700;
`);

const cssStarIcon = styled(icon, `
  --icon-color: ${theme.accentIcon};
  width: 24px;
  height: 24px;
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

const cssVideoCard = styled('div', `
  width: 220px;
  height: 158px;
  overflow: hidden;
  cursor: pointer;
  border-radius: 4px;
`);

const cssVideoThumbnail = styled('div', `
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

const cssVideoThumbnailSpacer = styled('div', ``);

const cssVideoPlayButton = styled('div', `
  display: flex;
  justify-content: center;
  align-items: center;
  align-self: center;
  width: 32px;
  height: 32px;
  background-color: ${theme.controlPrimaryBg};
  border-radius: 50%;

  .${cssVideoThumbnail.className}:hover & {
    background-color: ${theme.controlPrimaryHoverBg};
  }
`);

const cssPlayIcon = styled(icon, `
  --icon-color: ${theme.controlPrimaryFg};
  width: 24px;
  height: 24px;
`);

const cssVideoThumbnailText = styled('div', `
  color: ${colors.light};
  font-weight: 700;
  text-align: center;
`);
