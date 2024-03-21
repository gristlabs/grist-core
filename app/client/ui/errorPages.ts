import {makeT} from 'app/client/lib/localization';
import {AppModel} from 'app/client/models/AppModel';
import {getLoginUrl, getMainOrgUrl, getSignupUrl, urlState} from 'app/client/models/gristUrlState';
import {AppHeader} from 'app/client/ui/AppHeader';
import {leftPanelBasic} from 'app/client/ui/LeftPanelCommon';
import {pagePanels} from 'app/client/ui/PagePanels';
import {createTopBarHome} from 'app/client/ui/TopBar';
import {bigBasicButtonLink, bigPrimaryButtonLink} from 'app/client/ui2018/buttons';
import {theme, vars} from 'app/client/ui2018/cssVars';
import {commonUrls, getPageTitleSuffix} from 'app/common/gristUrls';
import {getGristConfig} from 'app/common/urlUtils';
import {dom, DomElementArg, makeTestId, observable, styled} from 'grainjs';

const testId = makeTestId('test-');

const t = makeT('errorPages');

export function createErrPage(appModel: AppModel) {
  const {errMessage, errPage} = getGristConfig();
  return errPage === 'signed-out' ? createSignedOutPage(appModel) :
    errPage === 'not-found' ? createNotFoundPage(appModel, errMessage) :
    errPage === 'access-denied' ? createForbiddenPage(appModel, errMessage) :
    errPage === 'account-deleted' ? createAccountDeletedPage(appModel) :
    createOtherErrorPage(appModel, errMessage);
}

/**
 * Creates a page to show that the user has no access to this org.
 */
export function createForbiddenPage(appModel: AppModel, message?: string) {
  document.title = t("Access denied{{suffix}}", {suffix: getPageTitleSuffix(getGristConfig())});

  const isAnonym = () => !appModel.currentValidUser;
  const isExternal = () => appModel.currentValidUser?.loginMethod === 'External';
  return pagePanelsError(appModel, t("Access denied{{suffix}}", {suffix: ''}), [
    dom.domComputed(appModel.currentValidUser, user => user ? [
      cssErrorText(message || t("You do not have access to this organization's documents.")),
      cssErrorText(t("You are signed in as {{email}}. You can sign in with a different \
account, or ask an administrator for access.", {email: dom('b', user.email)})),
    ] : [
      // This page is not normally shown because a logged out user with no access will get
      // redirected to log in. But it may be seen if a user logs out and returns to a cached
      // version of this page or is an external user (connected through GristConnect).
      cssErrorText(t("Sign in to access this organization's documents.")),
    ]),
    cssButtonWrap(bigPrimaryButtonLink(
        isExternal() ? t("Go to main page") :
        isAnonym() ? t("Sign in") :
        t("Add account"),
      {href: isExternal() ? getMainOrgUrl() : getLoginUrl()},
      testId('error-signin'),
    ))
  ]);
}

/**
 * Creates a page that shows the user is logged out.
 */
export function createSignedOutPage(appModel: AppModel) {
  document.title = t("Signed out{{suffix}}", {suffix: getPageTitleSuffix(getGristConfig())});

  return pagePanelsError(appModel, t("Signed out{{suffix}}", {suffix: ''}), [
    cssErrorText(t("You are now signed out.")),
    cssButtonWrap(bigPrimaryButtonLink(
      t("Sign in again"), {href: getLoginUrl()}, testId('error-signin')
    ))
  ]);
}

/**
 * Creates a page that shows the user is logged out.
 */
export function createAccountDeletedPage(appModel: AppModel) {
  document.title = t("Account deleted{{suffix}}", {suffix: getPageTitleSuffix(getGristConfig())});

  return pagePanelsError(appModel, t("Account deleted{{suffix}}", {suffix: ''}), [
    cssErrorText(t("Your account has been deleted.")),
    cssButtonWrap(bigPrimaryButtonLink(
      t("Sign up"), {href: getSignupUrl()}, testId('error-signin')
    ))
  ]);
}

/**
 * Creates a "Page not found" page.
 */
export function createNotFoundPage(appModel: AppModel, message?: string) {
  document.title = t("Page not found{{suffix}}", {suffix: getPageTitleSuffix(getGristConfig())});

  return pagePanelsError(appModel, t("Page not found{{suffix}}", {suffix: ''}), [
    cssErrorText(message ||
      t("The requested page could not be found.{{separator}}Please check the URL and try again.", {
        separator: dom('br')
    })),
    cssButtonWrap(bigPrimaryButtonLink(t("Go to main page"), testId('error-primary-btn'),
      urlState().setLinkUrl({}))),
    cssButtonWrap(bigBasicButtonLink(t("Contact support"), {href: commonUrls.contactSupport})),
  ]);
}

/**
 * Creates a generic error page with the given message.
 */
export function createOtherErrorPage(appModel: AppModel, message?: string) {
  document.title = t("Error{{suffix}}", {suffix: getPageTitleSuffix(getGristConfig())});

  return pagePanelsError(appModel, t("Something went wrong"), [
    cssErrorText(message ? t('There was an error: {{message}}', {message: addPeriod(message)}) :
      t('There was an unknown error.')),
    cssButtonWrap(bigPrimaryButtonLink(t("Go to main page"), testId('error-primary-btn'),
      urlState().setLinkUrl({}))),
    cssButtonWrap(bigBasicButtonLink(t("Contact support"), {href: commonUrls.contactSupport})),
  ]);
}

function addPeriod(msg: string): string {
  return msg.endsWith('.') ? msg : msg + '.';
}

function pagePanelsError(appModel: AppModel, header: string, content: DomElementArg) {
  const panelOpen = observable(false);
  return pagePanels({
    leftPanel: {
      panelWidth: observable(240),
      panelOpen,
      hideOpener: true,
      header: dom.create(AppHeader, appModel),
      content: leftPanelBasic(appModel, panelOpen),
    },
    headerMain: createTopBarHome(appModel),
    contentMain: cssCenteredContent(cssErrorContent(
      cssBigIcon(),
      cssErrorHeader(header, testId('error-header')),
      content,
      testId('error-content'),
    )),
  });
}

const cssCenteredContent = styled('div', `
  width: 100%;
  height: 100%;
  overflow-y: auto;
`);

const cssErrorContent = styled('div', `
  text-align: center;
  margin: 64px 0 64px;
`);

const cssBigIcon = styled('div', `
  display: inline-block;
  width: 100%;
  height: 64px;
  background-image: var(--icon-GristLogo);
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
`);

const cssErrorHeader = styled('div', `
  font-weight: ${vars.headerControlTextWeight};
  font-size: ${vars.xxxlargeFontSize};
  margin: 24px;
  text-align: center;
  color: ${theme.text};
`);

const cssErrorText = styled('div', `
  font-size: ${vars.mediumFontSize};
  color: ${theme.text};
  margin: 0 auto 24px auto;
  max-width: 400px;
  text-align: center;
`);

const cssButtonWrap = styled('div', `
  margin-bottom: 8px;
`);
