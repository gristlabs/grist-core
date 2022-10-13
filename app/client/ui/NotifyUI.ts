import {beaconOpenMessage, IBeaconOpenOptions} from 'app/client/lib/helpScout';
import {t} from 'app/client/lib/localization';
import {AppModel} from 'app/client/models/AppModel';
import {ConnectState} from 'app/client/models/ConnectState';
import {urlState} from 'app/client/models/gristUrlState';
import {Expirable, IAppError, Notification, Notifier, NotifyAction, Progress} from 'app/client/models/NotifyModel';
import {cssHoverCircle, cssTopBarBtn} from 'app/client/ui/TopBarCss';
import {theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {IconName} from "app/client/ui2018/IconList";
import {menuCssClass} from 'app/client/ui2018/menus';
import {commonUrls, shouldHideUiElement} from 'app/common/gristUrls';
import {dom, makeTestId, styled} from 'grainjs';
import {cssMenu, defaultMenuOptions, IOpenController, setPopupToCreateDom} from 'popweasel';

const translate = (x: string, args?: any): string => t(`NotifyUI.${x}`, args);

const testId = makeTestId('test-notifier-');


function buildAction(action: NotifyAction, item: Notification, options: IBeaconOpenOptions): HTMLElement|null {
  const appModel = options.appModel;
  switch (action) {
    case 'upgrade':
      if (appModel) {
        return cssToastAction(translate('UpgradePlan'), dom.on('click', () =>
          appModel.showUpgradeModal()));
      } else {
        return dom('a', cssToastAction.cls(''), translate('UpgradePlan'), {target: '_blank'},
          {href: commonUrls.plans});
      }
    case 'renew':
      // If already on the billing page, nothing to return.
      if (urlState().state.get().billing === 'billing') { return null; }
      // If not a billing manager, nothing to return.
      if (appModel && appModel.currentOrg && appModel.currentOrg.billingAccount &&
          !appModel.currentOrg.billingAccount.isManager) { return null; }
      // Otherwise return a link to the billing page.
      return dom('a', cssToastAction.cls(''), translate('Renew'), {target: '_blank'},
                 {href: urlState().makeUrl({billing: 'billing'})});

    case 'personal':
      if (!appModel) { return null; }
      return cssToastAction(translate('GoToPersonalSite'), dom.on('click', async () => {
        const info = await appModel.api.getSessionAll();
        const orgs = info.orgs.filter(org => org.owner && org.owner.id === appModel.currentUser?.id);
        if (orgs.length !== 1) {
          throw new Error(translate('ErrorCannotFindPersonalSite'));
        }
        window.location.assign(urlState().makeUrl({org: orgs[0].domain || undefined}));
      }));

    case 'report-problem':
      return cssToastAction(translate('ReportProblem'), testId('toast-report-problem'),
        dom.on('click', () => beaconOpenMessage({...options, includeAppErrors: true})));

    case 'ask-for-help': {
      const errors: IAppError[] = [{
        error: new Error(item.options.message as string),
        timestamp: item.options.timestamp,
      }];
      return cssToastAction(translate('AskForHelp'),
        dom.on('click', () => beaconOpenMessage({...options, includeAppErrors: true, errors})));
    }
  }
}

function notificationIcon(item: Notification) {
 let iconName: IconName|null = null;
  switch(item.options.level) {
    case "error":   iconName = "Warning"; break;
    case "warning": iconName = "Warning"; break;
    case "success": iconName = "TickSolid"; break;
    case "info": iconName = "Info"; break;
  }
  return iconName ? icon(iconName, dom.cls(cssToastIcon.className)) : null;
}

function buildNotificationDom(item: Notification, options: IBeaconOpenOptions) {
  const iconElement = notificationIcon(item);
  const hasLeftIcon = Boolean(!item.options.title && iconElement);
  return cssToastWrapper(testId('toast-wrapper'),
    cssToastWrapper.cls(use => `-${use(item.status)}`),
    cssToastWrapper.cls(`-${item.options.level}`),
    cssToastWrapper.cls(hasLeftIcon ? '-left-icon' : ''),
    item.options.title ? null : iconElement,
    cssToastBody(
      item.options.title ? cssToastTitle(notificationIcon(item), cssToastTitle(item.options.title)) : null,
      cssToastText(testId('toast-message'),
        item.options.message,
      ),
      item.options.actions.length ? cssToastActions(
        item.options.actions.map((action) => buildAction(action, item, options))
      ) : null,
      item.options.memos.length ? cssToastMemos(
        item.options.memos.map(memo => cssToastMemo(memo))
      ) : null,
    ),
    dom.maybe(item.options.canUserClose, () =>
      cssToastClose(testId('toast-close'),
        '✕',
        dom.on('click', () => item.dispose())
      )
    )
  );
}

function buildProgressDom(item: Progress) {
  return cssToastWrapper(testId('progress-wrapper'),
    cssToastBody(
      cssToastText(testId('progress-message'),
        dom.text(item.options.name),
        dom.maybe(item.options.size, size => cssProgressBarSize(` (${size})`))
      ),
      cssProgressBarWrapper(
        cssProgressBarStatus(
          dom.style('width', use => `${use(item.progress)}%`)
        )
      )
    )
  );
}

export function buildNotifyMenuButton(notifier: Notifier, appModel: AppModel|null) {
  const {connectState} = notifier.getStateForUI();
  return cssHoverCircle({style: `margin: 5px;`},
    dom.domComputed(connectState, (state) => buildConnectStateButton(state)),
    (elem) => {
      setPopupToCreateDom(elem, (ctl) => buildNotifyDropdown(ctl, notifier, appModel),
        {...defaultMenuOptions, placement: 'bottom-end'});
    },
    testId('menu-btn'),
  );
}

function buildNotifyDropdown(ctl: IOpenController, notifier: Notifier, appModel: AppModel|null): Element {
  const {connectState, disconnectMsg, dropdownItems} = notifier.getStateForUI();

  return cssDropdownWrapper(
    // Reuse css classes for menus (combination of popweasel classes and those from Grist menus)
    dom.cls(cssMenu.className),
    dom.cls(menuCssClass),

    // Close on Escape.
    dom.onKeyDown({Escape: () => ctl.close()}),
    // Once attached, focus this element, so that it accepts keyboard events.
    (elem) => { setTimeout(() => elem.focus(), 0); },

    cssDropdownContent(
      cssDropdownHeader(
        cssDropdownHeaderTitle(translate('Notifications')),
        shouldHideUiElement("helpCenter") ? null :
        cssDropdownFeedbackLink(
          cssDropdownFeedbackIcon('Feedback'),
          translate('GiveFeedback'),
          dom.on('click', () => beaconOpenMessage({appModel, onOpen: () => ctl.close(), route: '/ask/message/'})),
          testId('feedback'),
        )
      ),
      dom.maybe(disconnectMsg, (msg) =>
        cssDropdownStatus(
          buildConnectStateButton(connectState.get()),
          dom('div', cssDropdownStatusText(msg.message), testId('disconnect-msg')),
        )
      ),
      dom.maybe((use) => use(dropdownItems).length === 0 && !use(disconnectMsg), () =>
        cssDropdownStatus(
          dom('div', cssDropdownStatusText(translate('NoNotifications'))),
        )
      ),
      dom.forEach(dropdownItems, item =>
        buildNotificationDom(item, {appModel, onOpen: () => ctl.close()})),
    ),
    testId('dropdown'),
  );
}

export function buildSnackbarDom(notifier: Notifier, appModel: AppModel|null): Element {
  const {progressItems, toasts} = notifier.getStateForUI();
  return cssSnackbarWrapper(testId('snackbar-wrapper'),
    dom.forEach(progressItems, item => buildProgressDom(item)),
    dom.forEach(toasts, toast => buildNotificationDom(toast, {appModel})),
  );
}

function buildConnectStateButton(state: ConnectState): Element {
  switch (state) {
    case ConnectState.JustDisconnected: return cssTopBarBtn('Notification', cssTopBarBtn.cls('-slate'));
    case ConnectState.RecentlyDisconnected: return cssTopBarBtn('Offline', cssTopBarBtn.cls('-slate'));
    case ConnectState.ReallyDisconnected: return cssTopBarBtn('Offline', cssTopBarBtn.cls('-error'));
    case ConnectState.Connected:
    default:
      return cssTopBarBtn('Notification');
  }
}


const cssDropdownWrapper = styled('div', `
  background-color: ${theme.notificationsPanelBodyBg};
  border: 1px solid ${theme.notificationsPanelBorder};
  padding: 0px;
`);

const cssDropdownContent = styled('div', `
  min-width: 320px;
  max-width: 320px;
`);

const cssDropdownHeader = styled('div', `
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px;
  background-color: ${theme.notificationsPanelHeaderBg};
  outline: 1px solid ${theme.notificationsPanelBorder};
`);

const cssDropdownHeaderTitle = styled('span', `
  color: ${theme.text};
  font-weight: bold;
`);

const cssDropdownFeedbackLink = styled('div', `
  display: flex;
  color: ${theme.controlFg};
  cursor: pointer;
  user-select: none;
  &:hover {
    text-decoration: underline;
  }
`);

const cssDropdownFeedbackIcon = styled(icon, `
  background-color: ${theme.controlFg};
  margin-right: 4px;
`);

const cssDropdownStatus = styled('div', `
  padding: 16px 48px 24px 48px;
  text-align: center;
  border-top: 1px solid ${theme.notificationsPanelBorder};
`);

const cssDropdownStatusText = styled('div', `
  display: inline-block;
  margin: 8px 0 0 0;
  text-align: left;
  color: ${theme.lightText};
`);

// z-index below is set above other assorted children of <body> which include z-index such as 999
// and 1050 (for new-style and old-style modals, for example).
const cssSnackbarWrapper = styled('div', `
  position: fixed;
  bottom: 8px;
  right: 8px;
  z-index: 1100;

  display: flex;
  flex-direction: column;
  align-items: flex-end;

  font-size: ${vars.mediumFontSize};

  pointer-events: none; /* Allow mouse clicks through */
`);

const cssToastBody = styled('div', `
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  padding: 0 12px;
  overflow-wrap: anywhere;
`);

const cssToastIcon = styled('div', `
  flex-shrink: 0;
  height: 18px;
  width: 18px;
`);

const cssToastActions = styled('div', `
  display: flex;
  align-items: flex-end;
  margin-top: 16px;
  color: ${theme.toastControlFg};
`);

const cssToastWrapper = styled('div', `
  display: flex;
  min-width: 240px;
  max-width: 320px;
  overflow: hidden;

  margin: 4px;
  padding: 12px;
  border-radius: 3px;

  color: ${theme.toastText};
  background-color: ${theme.toastBg};

  pointer-events: auto;

  opacity: 1;
  transition: opacity ${Expirable.fadeDelay}ms;

  &-error {
    border-left: 6px solid ${theme.toastErrorBg};
    padding-left: 6px;
    --icon-color: ${theme.toastErrorIcon};
  }

  &-success {
    border-left: 6px solid ${theme.toastSuccessBg};
    padding-left: 6px;
    --icon-color: ${theme.toastSuccessIcon};
  }
  &-warning {
    border-left: 6px solid ${theme.toastWarningBg};
    padding-left: 6px;
    --icon-color: ${theme.toastWarningIcon};
  }
  &-info {
    border-left: 6px solid ${theme.toastInfoBg};
    padding-left: 6px;
    --icon-color: ${theme.toastInfoIcon};
  }
  &-info .${cssToastActions.className} {
    color: ${theme.toastInfoControlFg};
  }

  &-left-icon {
    padding-left: 12px;
  }
  &-left-icon > .${cssToastBody.className} {
    padding-left: 10px;
  }

  &-expiring, &-expired {
    opacity: 0;
  }
  .${cssDropdownContent.className} > & > .notification-icon {
    display: none;
  }
  .${cssDropdownContent.className} > & {
    background-color: unset;
    color: ${theme.text};
    border-radius: 0px;
    border-top: 1px solid ${theme.notificationsPanelBorder};
    margin: 0px;
    padding: 16px 20px;
  }
`);


const cssToastText = styled('div', `
`);

const cssToastTitle = styled(cssToastText, `
  display: flex;
  gap: 8px;
  font-weight: bold;
  margin-bottom: 8px;
`);

const cssToastClose = styled('div', `
  cursor: pointer;
  user-select: none;
  width: 16px;
  height: 16px;
  line-height: 16px;
  text-align: center;
  margin: -4px -4px -4px 4px;
`);

const cssToastAction = styled('div', `
  cursor: pointer;
  user-select: none;
  margin-right: 24px;
  &, &:hover, &:focus {
    color: inherit;
  }
  &:hover {
    text-decoration: underline;
  }
`);

const cssToastMemos = styled('div', `
  margin-top: 16px;
  display: flex;
  flex-direction: column;
`);

const cssToastMemo = styled('div', `
  margin: 3px;
  color: ${theme.text};
  background: ${theme.notificationsPanelBodyBg};
  padding: 3px;
`);

const cssProgressBarWrapper = styled('div', `
  margin-top: 18px;
  margin-bottom: 11px;
  height: 3px;
  border-radius: 3px;
  background-color: ${theme.progressBarBg};
`);

const cssProgressBarSize = styled('span', `
  color: ${theme.toastLightText};
`);

const cssProgressBarStatus = styled('div', `
  height: 3px;
  min-width: 3px;
  border-radius: 3px;
  background-color: ${theme.progressBarFg};
`);
