import {makeT} from 'app/client/lib/localization';
import {logTelemetryEvent} from 'app/client/lib/telemetry';
import {AppModel} from 'app/client/models/AppModel';
import {bigBasicButton, bigPrimaryButtonLink} from 'app/client/ui2018/buttons';
import {testId, theme, vars} from 'app/client/ui2018/cssVars';
import {cardPopup, cssPopupBody, cssPopupButtons, cssPopupCloseButton,
        cssPopupTitle} from 'app/client/ui2018/popups';
import {icon} from 'app/client/ui2018/icons';
import {getGristConfig} from 'app/common/urlUtils';
import {dom, styled} from 'grainjs';
import { commonUrls } from 'app/common/gristUrls';

const t = makeT('WelcomeCoachingCall');

export function shouldShowWelcomeCoachingCall(appModel: AppModel) {
  const {deploymentType} = getGristConfig();
  if (deploymentType !== 'saas') { return false; }

  // Defer showing coaching call until Add New tip is dismissed.
  const {behavioralPromptsManager, dismissedWelcomePopups} = appModel;
  if (behavioralPromptsManager.shouldShowPopup('addNew')) { return false; }

  const popup = dismissedWelcomePopups.get().find(p => p.id === 'coachingCall');
  return (
    // Only show if the user is an owner.
    appModel.isOwner() && (
      // And preferences for the popup haven't been saved before.
      popup === undefined ||
      // Or the popup has been shown before, and it's time to shown it again.
      popup.nextAppearanceAt !== null && popup.nextAppearanceAt <= Date.now()
    )
  );
}

/**
 * Shows a popup with an offer for a free coaching call.
 */
export function showWelcomeCoachingCall(triggerElement: Element, appModel: AppModel) {
  const {dismissedWelcomePopups} = appModel;

  cardPopup(triggerElement, (ctl) => {
    const dismissPopup = (scheduleNextAppearance?: boolean) => {
      const dismissedPopups = dismissedWelcomePopups.get();
      const newDismissedPopups = [...dismissedPopups];
      const coachingPopup = newDismissedPopups.find(p => p.id === 'coachingCall');
      if (!coachingPopup) {
        newDismissedPopups.push({
          id: 'coachingCall',
          lastDismissedAt: Date.now(),
          timesDismissed: 1,
          nextAppearanceAt: scheduleNextAppearance
            ? new Date().setDate(new Date().getDate() + 7)
            : null,
        });
      } else {
        Object.assign(coachingPopup, {
          lastDismissedAt: Date.now(),
          timesDismissed: coachingPopup.timesDismissed + 1,
          nextAppearanceAt: scheduleNextAppearance && coachingPopup.timesDismissed + 1 <= 1
            ? new Date().setDate(new Date().getDate() + 7)
            : null,
        });
      }
      dismissedWelcomePopups.set(newDismissedPopups);
      ctl.close();
    };

    return [
      cssPopup.cls(''),
      cssPopupHeader(
        cssLogoAndName(
          cssLogo(),
          cssName('Grist'),
        ),
        cssPopupCloseButton(
          cssCloseIcon('CrossBig'),
          dom.on('click', () => dismissPopup(true)),
          testId('popup-close-button'),
        ),
      ),
      cssPopupTitle(t('free coaching call'),
        dom.style('text-transform', 'capitalize'),
        testId('popup-title')
      ),
      cssPopupBody(
        cssBody(
          dom('div',
            t('Schedule your {{freeCoachingCall}} with a member of our team.',
              {freeCoachingCall: cssBoldText(t('free coaching call'))}
            )
          ),
          dom('div',
            t("On the call, we'll take the time to understand your needs and tailor the call to you. \
We can show you the Grist basics, or start working with your data right away to build the dashboards you need.")
          ),
        ),
        testId('popup-body'),
      ),
      cssPopupButtons(
        bigPrimaryButtonLink(
          t('Schedule Call'),
          dom.on('click', () => {
            dismissPopup(false);
            logTelemetryEvent('clickedScheduleCoachingCall');
          }),
          {
            href: commonUrls.freeCoachingCall,
            target: '_blank',
          },
          testId('popup-primary-button'),
        ),
        bigBasicButton(
          t('Maybe Later'),
          dom.on('click', () => dismissPopup(true)),
          testId('popup-basic-button'),
        ),
      ),
      testId('coaching-call'),
    ];
  });
}

const cssBody = styled('div', `
  display: flex;
  flex-direction: column;
  row-gap: 16px;
`);

const cssBoldText = styled('span', `
  font-weight: 600;
`);

const cssCloseIcon = styled(icon, `
  padding: 12px;
`);

const cssName = styled('div', `
  color: ${theme.popupCloseButtonFg};
  font-size: ${vars.largeFontSize};
  font-weight: 600;
`);

const cssLogo = styled('div', `
  flex: none;
  height: 32px;
  width: 32px;
  background-image: var(--icon-GristLogo);
  background-size: ${vars.logoSize};
  background-repeat: no-repeat;
  background-position: center;
`);

const cssLogoAndName = styled('div', `
  display: flex;
  align-items: center;
  gap: 4px;
`);

const cssPopup = styled('div', `
  display: flex;
  flex-direction: column;
`);

const cssPopupHeader = styled('div', `
  display: flex;
  justify-content: space-between;
  margin-bottom: 16px;
`);
