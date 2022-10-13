import {t} from 'app/client/lib/localization';
import {getLoginOrSignupUrl, urlState} from 'app/client/models/gristUrlState';
import {HomeModel} from 'app/client/models/HomeModel';
import {productPill} from 'app/client/ui/AppHeader';
import * as css from 'app/client/ui/DocMenuCss';
import {createDocAndOpen, importDocAndOpen} from 'app/client/ui/HomeLeftPane';
import {manageTeamUsersApp} from 'app/client/ui/OpenUserManager';
import {bigBasicButton, cssButton} from 'app/client/ui2018/buttons';
import {testId, theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {cssLink} from 'app/client/ui2018/links';
import {commonUrls, shouldHideUiElement} from 'app/common/gristUrls';
import {FullUser} from 'app/common/LoginSessionAPI';
import * as roles from 'app/common/roles';
import {Computed, dom, DomContents, styled} from 'grainjs';

const translate = (x: string, args?: any): string => t(`HomeIntro.${x}`, args);

export function buildHomeIntro(homeModel: HomeModel): DomContents {
  const isViewer = homeModel.app.currentOrg?.access === roles.VIEWER;
  const user = homeModel.app.currentValidUser;
  const isAnonym = !user;
  const isPersonal = !homeModel.app.isTeamSite;
  if (isAnonym) {
    return makeAnonIntro(homeModel);
  } else if (isPersonal) {
    return makePersonalIntro(homeModel, user);
  } else { // isTeamSite
    if (isViewer) {
      return makeViewerTeamSiteIntro(homeModel);
    } else {
      return makeTeamSiteIntro(homeModel);
    }
  }
}

export function buildWorkspaceIntro(homeModel: HomeModel): DomContents {
  const isViewer = homeModel.currentWS.get()?.access === roles.VIEWER;
  const isAnonym = !homeModel.app.currentValidUser;
  const emptyLine = cssIntroLine(testId('empty-workspace-info'), translate('EmptyWorkspace'));
  if (isAnonym || isViewer) {
    return emptyLine;
  } else {
    return [
      emptyLine,
      buildButtons(homeModel, {
        invite: false,
        templates: false,
        import: true,
        empty: true
      })
    ];
  }
}

function makeViewerTeamSiteIntro(homeModel: HomeModel) {
  const personalOrg = Computed.create(null, use => use(homeModel.app.topAppModel.orgs).find(o => o.owner));
  const docLink = (dom.maybe(personalOrg, org => {
    return cssLink(
      urlState().setLinkUrl({org: org.domain ?? undefined}),
      translate('PersonalSite'),
      testId('welcome-personal-url'));
  }));
  return [
    css.docListHeader(
      dom.autoDispose(personalOrg),
      translate('WelcomeTo', {orgName: homeModel.app.currentOrgName}),
      productPill(homeModel.app.currentOrg, {large: true}),
      testId('welcome-title')
    ),
    cssIntroLine(
      testId('welcome-info'),
      translate('WelcomeInfoNoDocuments'),
      dom('br'),
      translate('WelcomeInfoAppearHere'),
    ),
    cssIntroLine(
      translate('WelcomeTextVistGrist'), docLink, '.',
      testId('welcome-text')
    )
  ];
}

function makeTeamSiteIntro(homeModel: HomeModel) {
  const sproutsProgram = cssLink({href: commonUrls.sproutsProgram, target: '_blank'}, translate('SproutsProgram'));
  return [
    css.docListHeader(
      translate('WelcomeTo', {orgName: homeModel.app.currentOrgName}),
      productPill(homeModel.app.currentOrg, {large: true}),
      testId('welcome-title')
    ),
    cssIntroLine(translate('TeamSiteIntroGetStarted')),
    (shouldHideUiElement('helpCenter') ? null :
      cssIntroLine(
        translate('TeamSiteIntroLearnMore', {link: helpCenterLink(), sproutsProgram}),  // TODO i18n
        testId('welcome-text')
      )
    ),
    makeCreateButtons(homeModel)
  ];
}

function makePersonalIntro(homeModel: HomeModel, user: FullUser) {
  return [
    css.docListHeader(translate('WelcomeUser', {name: user.name}), testId('welcome-title')),
    cssIntroLine(translate('PersonalIntroGetStarted')),
    (shouldHideUiElement('helpCenter') ? null :
      cssIntroLine(translate('IntroVisitOur', {link: helpCenterLink()}),  // TODO i18n
        testId('welcome-text'))
    ),
    makeCreateButtons(homeModel),
  ];
}

function makeAnonIntro(homeModel: HomeModel) {
  const signUp = cssLink({href: getLoginOrSignupUrl()}, translate('SignUp'));
  return [
    css.docListHeader(translate('Welcome'), testId('welcome-title')),
    cssIntroLine(translate('AnonIntroGetStarted')),
    cssIntroLine(translate('AnonIntroSignUpSave', {signUp}),
      (shouldHideUiElement('helpCenter') ? null : translate('IntroVisitOur', {link: helpCenterLink()})),  // TODO i18n
      testId('welcome-text')),
    makeCreateButtons(homeModel),
  ];
}

function helpCenterLink() {
  return cssLink({href: commonUrls.help, target: '_blank'}, cssInlineIcon('Help'), translate('HelpCenter'));
}

function buildButtons(homeModel: HomeModel, options: {
  invite: boolean,
  templates: boolean,
  import: boolean,
  empty: boolean,
}) {
  return cssBtnGroup(
    !options.invite ? null :
    cssBtn(cssBtnIcon('Help'), translate('InviteTeamMembers'), testId('intro-invite'),
      cssButton.cls('-primary'),
      dom.on('click', () => manageTeamUsersApp(homeModel.app)),
    ),
    !options.templates ? null :
    cssBtn(cssBtnIcon('FieldTable'), translate('BrowseTemplates'), testId('intro-templates'),
      cssButton.cls('-primary'),
      dom.hide(shouldHideUiElement("templates")),
      urlState().setLinkUrl({homePage: 'templates'}),
    ),
    !options.import ? null :
    cssBtn(cssBtnIcon('Import'), translate('ImportDocument'), testId('intro-import-doc'),
      dom.on('click', () => importDocAndOpen(homeModel)),
    ),
    !options.empty ? null :
    cssBtn(cssBtnIcon('Page'), translate('CreateEmptyDocument'), testId('intro-create-doc'),
      dom.on('click', () => createDocAndOpen(homeModel)),
    ),
  );
}

function makeCreateButtons(homeModel: HomeModel) {
  const canManageTeam = homeModel.app.isTeamSite &&
    roles.canEditAccess(homeModel.app.currentOrg?.access || null);
  return buildButtons(homeModel, {
    invite: canManageTeam,
    templates: !canManageTeam,
    import: true,
    empty: true
  });
}

const cssParagraph = styled(css.docBlock, `
  color: ${theme.text};
  line-height: 1.6;
`);

const cssIntroLine = styled(cssParagraph, `
  font-size: ${vars.introFontSize};
  margin-bottom: 8px;
`);

const cssBtnGroup = styled('div', `
  display: inline-flex;
  flex-direction: column;
  align-items: stretch;
`);

const cssBtn = styled(bigBasicButton, `
  display: flex;
  align-items: center;
  margin-right: 16px;
  margin-top: 16px;
  text-align: left;
`);

const cssBtnIcon = styled(icon, `
  margin-right: 8px;
`);

const cssInlineIcon = styled(icon, `
  margin: -2px 4px 2px 4px;
`);
