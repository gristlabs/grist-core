import {AppModel} from 'app/client/models/AppModel';
import {bigPrimaryButton} from 'app/client/ui2018/buttons';
import {isNarrowScreenObs, theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {commonUrls, isFeatureEnabled} from 'app/common/gristUrls';
import {Computed, dom, IDisposableOwner, makeTestId, styled} from 'grainjs';

const testId = makeTestId('test-tutorial-card-');

interface Options {
  app: AppModel,
}

export function buildTutorialCard(owner: IDisposableOwner, options: Options) {
  if (!isFeatureEnabled('tutorials')) { return null; }

  const {app} = options;
  function onClose() {
    app.dismissPopup('tutorialFirstCard', true);
  }
  const visible = Computed.create(owner, (use) =>
       !use(app.dismissedPopups).includes('tutorialFirstCard')
    && !use(isNarrowScreenObs())
  );
  return dom.maybe(visible, () => {
    return cssCard(
      cssCaption(
        dom('div', cssNewToGrist("New to Grist?")),
        cssRelative(
          cssStartHere("Start here."),
          cssArrow()
        ),
      ),
      cssContent(
        testId('content'),
        cssImage({src: commonUrls.basicTutorialImage}),
        cssCardText(
          cssLine(cssTitle("Grist Basics Tutorial")),
          cssLine("Learn the basics of reference columns, linked widgets, column types, & cards."),
          cssLine(cssSub('Beginner - 10 mins')),
          cssButtonWrapper(
            cssButtonWrapper.cls('-small'),
            cssHeroButton("Start Tutorial"),
            {href: commonUrls.basicTutorial, target: '_blank'},
          ),
        ),
      ),
      cssButtonWrapper(
        cssButtonWrapper.cls('-big'),
        cssHeroButton("Start Tutorial"),
        {href: commonUrls.basicTutorial, target: '_blank'},
      ),
      cssCloseButton(icon('CrossBig'), dom.on('click', () => onClose?.()), testId('close')),
    );
  });
}

const cssContent = styled('div', `
  position: relative;
  display: flex;
  align-items: flex-start;
  padding-top: 24px;
  padding-bottom: 20px;
  padding-right: 20px;
  max-width: 460px;
`);

const cssCardText = styled('div', `
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-self: stretch;
  margin-left: 12px;
`);

const cssRelative = styled('div', `
  position: relative;
`);

const cssNewToGrist = styled('span', `
  font-style: normal;
  font-weight: 400;
  font-size: 24px;
  line-height: 16px;
  letter-spacing: 0.2px;
  white-space: nowrap;
`);

const cssStartHere = styled('span', `
  font-style: normal;
  font-weight: 700;
  font-size: 24px;
  line-height: 16px;
  letter-spacing: 0.2px;
  white-space: nowrap;
`);

const cssCaption = styled('div', `
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-left: 32px;
  margin-top: 42px;
  margin-right: 64px;
`);

const cssTitle = styled('span', `
  font-weight: 600;
  font-size: 20px;
`);

const cssSub = styled('span', `
  font-size: 12px;
  color: ${theme.lightText};
`);

const cssLine = styled('div', `
  margin-bottom: 6px;
`);

const cssHeroButton = styled(bigPrimaryButton, `
`);

const cssButtonWrapper = styled('a', `
  flex-grow: 1;
  display: flex;
  justify-content: flex-end;
  margin-right: 60px;
  align-items: center;
  text-decoration: none;
  &:hover {
    text-decoration: none;
  }
  &-big .${cssHeroButton.className} {
    padding: 16px 28px;
    font-weight: 600;
    font-size: 20px;
    line-height: 1em;
  }
`);

const cssCloseButton = styled('div', `
  flex-shrink: 0;
  align-self: flex-end;
  cursor: pointer;
  --icon-color: ${theme.controlSecondaryFg};
  margin: 8px 8px 4px 0px;
  padding: 2px;
  border-radius: 4px;
  position: absolute;
  top: 0;
  right: 0;
  &:hover {
    background-color: ${theme.lightHover};
  }
  &:active {
    background-color: ${theme.hover};
  }
`);

const cssImage = styled('img', `
  width: 187px;
  height: 145px;
  flex: none;
`);

const cssArrow = styled('div', `
  position: absolute;
  background-image: var(--icon-GreenArrow);
  width: 94px;
  height: 12px;
  top: calc(50% - 6px);
  left: calc(100% - 12px);
  z-index: 1;
`);


const cssCard = styled('div', `
  display: flex;
  position: relative;
  color: ${theme.text};
  border-radius: 3px;
  margin-bottom: 24px;
  max-width: 1000px;
  box-shadow: 0 2px 18px 0 ${theme.modalInnerShadow}, 0 0 1px 0 ${theme.modalOuterShadow};
  & .${cssButtonWrapper.className}-small {
    display: none;
  }
  @media (max-width: 1320px) {
    & .${cssButtonWrapper.className}-small {
      flex-direction: column;
      display: flex;
      margin-top: 14px;
      align-self: flex-start;
    }
    & .${cssButtonWrapper.className}-big {
      display: none;
    }
  }
  @media (max-width: 1000px) {
    & .${cssArrow.className} {
      display: none;
    }
    & .${cssCaption.className} {
      flex-direction: row;
      margin-bottom: 24px;
    }
    & {
      flex-direction: column;
    }
    & .${cssContent.className} {
      padding: 12px;
      max-width: 100%;
      margin-bottom: 28px;
    }
  }
`);
