import {t} from 'app/client/lib/localization';
import {AppModel} from 'app/client/models/AppModel';
import {getLoginUrl, getMainOrgUrl, urlState} from 'app/client/models/gristUrlState';
import {AppHeader} from 'app/client/ui/AppHeader';
import {leftPanelBasic} from 'app/client/ui/LeftPanelCommon';
import {pagePanels} from 'app/client/ui/PagePanels';
import {createTopBarHome} from 'app/client/ui/TopBar';
import {bigBasicButtonLink, bigPrimaryButtonLink} from 'app/client/ui2018/buttons';
import {theme, vars} from 'app/client/ui2018/cssVars';
import {getPageTitleSuffix, GristLoadConfig} from 'app/common/gristUrls';
import {getGristConfig} from 'app/common/urlUtils';
import {dom, DomElementArg, makeTestId, observable, styled} from 'grainjs';

const testId = makeTestId('test-');

const translate = (x: string, args?: any): string => t(`errorPages.${x}`, args);

export function createErrPage(appModel: AppModel) {
  const gristConfig: GristLoadConfig = (window as any).gristConfig || {};
  const message = gristConfig.errMessage;
  return gristConfig.errPage === 'signed-out' ? createSignedOutPage(appModel) :
    gristConfig.errPage === 'not-found' ? createNotFoundPage(appModel, message) :
    gristConfig.errPage === 'access-denied' ? createForbiddenPage(appModel, message) :
    createOtherErrorPage(appModel, message);
}

/**
 * Creates a page to show that the user has no access to this org.
 */
export function createForbiddenPage(appModel: AppModel, message?: string) {
  document.title = translate('AccessDenied', {suffix: getPageTitleSuffix(getGristConfig())});

  const isAnonym = () => !appModel.currentValidUser;
  const isExternal = () => appModel.currentValidUser?.loginMethod === 'External';
  return pagePanelsError(appModel, translate('AccessDenied'), [
    dom.domComputed(appModel.currentValidUser, user => user ? [
      cssErrorText(message || translate("DeniedOrganizationDocuments")),
      cssErrorText(translate("SignInWithDifferentAccount", {email: dom('b', user.email)})), // TODO: i18next
    ] : [
      // This page is not normally shown because a logged out user with no access will get
      // redirected to log in. But it may be seen if a user logs out and returns to a cached
      // version of this page or is an external user (connected through GristConnect).
      cssErrorText(translate("SignInToAccess")),
    ]),
    cssButtonWrap(bigPrimaryButtonLink(
        isExternal() ? translate("GoToMainPage") :
        isAnonym() ? translate("SignIn") :
        translate("AddAcount"),
      {href: isExternal() ? getMainOrgUrl() : getLoginUrl()},
      testId('error-signin'),
    ))
  ]);
}

/**
 * Creates a page that shows the user is logged out.
 */
export function createSignedOutPage(appModel: AppModel) {
  document.title = translate('SignedOut', {suffix: getPageTitleSuffix(getGristConfig())});

  return pagePanelsError(appModel, translate('SignedOut'), [ 
    cssErrorText(translate('SignedOutNow')),
    cssButtonWrap(bigPrimaryButtonLink(
      translate('SignedInAgain'), {href: getLoginUrl()}, testId('error-signin')
    ))
  ]);
}

/**
 * Creates a "Page not found" page.
 */
export function createNotFoundPage(appModel: AppModel, message?: string) {
  document.title = translate('PageNotFound', {suffix: getPageTitleSuffix(getGristConfig())});//`Page not found${getPageTitleSuffix(getGristConfig())}`;

  return pagePanelsError(appModel, translate('PageNotFound'), [
    cssErrorText(message || translate('NotFoundMainText', {separator: dom('br')})),  // TODO: i18next
    cssButtonWrap(bigPrimaryButtonLink(translate('GoToMainPage'), testId('error-primary-btn'),
      urlState().setLinkUrl({}))),
    cssButtonWrap(bigBasicButtonLink(translate('ContactSupport'), {href: 'https://getgrist.com/contact'})),
  ]);
}

/**
 * Creates a generic error page with the given message.
 */
export function createOtherErrorPage(appModel: AppModel, message?: string) {
  document.title = `Error${getPageTitleSuffix(getGristConfig())}`;

  return pagePanelsError(appModel, translate('SomethingWentWrong'), [
    cssErrorText(message ? translate('ErrorHappend', {context: 'message', message: addPeriod(message)}) :
      translate('ErrorHappened', {context: 'unkown'})),
    cssButtonWrap(bigPrimaryButtonLink(translate('GoToMainPage'), testId('error-primary-btn'),
      urlState().setLinkUrl({}))),
    cssButtonWrap(bigBasicButtonLink(translate('ContactSupport'), {href: 'https://getgrist.com/contact'})),
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
      header: dom.create(AppHeader, appModel.currentOrgName, appModel),
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
