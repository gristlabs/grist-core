import {AppModel} from 'app/client/models/AppModel';
import {getLoginUrl, getMainOrgUrl, urlState} from 'app/client/models/gristUrlState';
import {appHeader} from 'app/client/ui/AppHeader';
import {leftPanelBasic} from 'app/client/ui/LeftPanelCommon';
import {pagePanels} from 'app/client/ui/PagePanels';
import {createTopBarHome} from 'app/client/ui/TopBar';
import {bigBasicButtonLink, bigPrimaryButtonLink} from 'app/client/ui2018/buttons';
import {colors, vars} from 'app/client/ui2018/cssVars';
import {GristLoadConfig} from 'app/common/gristUrls';
import {dom, DomElementArg, makeTestId, observable, styled} from 'grainjs';

const testId = makeTestId('test-');

export function createErrPage(appModel: AppModel) {
  const gristConfig: GristLoadConfig = (window as any).gristConfig || {};
  const message = gristConfig.errMessage;
  return gristConfig.errPage === 'signed-out' ? createSignedOutPage(appModel) :
    gristConfig.errPage === 'verified' ? createVerifiedPage(appModel) :
    gristConfig.errPage === 'not-found' ? createNotFoundPage(appModel, message) :
    gristConfig.errPage === 'access-denied' ? createForbiddenPage(appModel, message) :
    createOtherErrorPage(appModel, message);
}

/**
 * Creates a page to show that the user has no access to this org.
 */
export function createForbiddenPage(appModel: AppModel, message?: string) {
  return pagePanelsError(appModel, 'Access denied', [
    dom.domComputed(appModel.currentValidUser, user => user ? [
      cssErrorText(message || "You do not have access to this organization's documents."),
      cssErrorText("You are signed in as ", dom('b', user.email),
        ". You can sign in with a different account, or ask an administrator for access."),
    ] : [
      // This page is not normally shown because a logged out user with no access will get
      // redirected to log in. But it may be seen if a user logs out and returns to a cached
      // version of this page.
      cssErrorText("Sign in to access this organization's documents."),
    ]),
    cssButtonWrap(bigPrimaryButtonLink(
      appModel.currentValidUser ? 'Add account' : 'Sign in',
      {href: getLoginUrl()},
      testId('error-signin'),
    ))
  ]);
}

/**
 * Creates a page that shows the user is logged out.
 */
export function createSignedOutPage(appModel: AppModel) {
  return pagePanelsError(appModel, 'Signed out', [
    cssErrorText("You are now signed out."),
    cssButtonWrap(bigPrimaryButtonLink(
      'Sign in again', {href: getLoginUrl()}, testId('error-signin')
    ))
  ]);
}

/**
 * Creates a page that shows the user is verified.
 */
export function createVerifiedPage(appModel: AppModel) {
  return pagePanelsError(appModel, 'Verified', [
    cssErrorText("Your email is now verified."),
    cssButtonWrap(bigPrimaryButtonLink(
      'Sign in', {href: getLoginUrl(getMainOrgUrl())}, testId('error-signin')
    ))
  ]);
}

/**
 * Creates a "Page not found" page.
 */
export function createNotFoundPage(appModel: AppModel, message?: string) {
  return pagePanelsError(appModel, 'Page not found', [
    cssErrorText(message || "The requested page could not be found.", dom('br'),
      "Please check the URL and try again."),
    cssButtonWrap(bigPrimaryButtonLink('Go to main page', testId('error-primary-btn'),
      urlState().setLinkUrl({}))),
    cssButtonWrap(bigBasicButtonLink('Contact support', {href: 'https://getgrist.com/contact'})),
  ]);
}

/**
 * Creates a generic error page with the given message.
 */
export function createOtherErrorPage(appModel: AppModel, message?: string) {
  return pagePanelsError(appModel, 'Something went wrong', [
    cssErrorText(message ? `There was an error: ${addPeriod(message)}` :
      "There was an unknown error."),
    cssButtonWrap(bigPrimaryButtonLink('Go to main page', testId('error-primary-btn'),
      urlState().setLinkUrl({}))),
    cssButtonWrap(bigBasicButtonLink('Contact support', {href: 'https://getgrist.com/contact'})),
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
      header: appHeader(appModel.currentOrgName, appModel.topAppModel.productFlavor),
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
  color: ${colors.dark};
`);

const cssErrorText = styled('div', `
  font-size: ${vars.mediumFontSize};
  color: ${colors.dark};
  margin: 0 auto 24px auto;
  max-width: 400px;
  text-align: center;
`);

const cssButtonWrap = styled('div', `
  margin-bottom: 8px;
`);
