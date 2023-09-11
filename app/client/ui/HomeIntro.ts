import {makeT} from 'app/client/lib/localization';
import {getLoginOrSignupUrl, getLoginUrl, getSignupUrl, urlState} from 'app/client/models/gristUrlState';
import {HomeModel} from 'app/client/models/HomeModel';
import {productPill} from 'app/client/ui/AppHeader';
import * as css from 'app/client/ui/DocMenuCss';
import {createDocAndOpen, importDocAndOpen} from 'app/client/ui/HomeLeftPane';
import {manageTeamUsersApp} from 'app/client/ui/OpenUserManager';
import {bigBasicButton, cssButton} from 'app/client/ui2018/buttons';
import {testId, theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {cssLink} from 'app/client/ui2018/links';
import {commonUrls, isFeatureEnabled} from 'app/common/gristUrls';
import {FullUser} from 'app/common/LoginSessionAPI';
import * as roles from 'app/common/roles';
import {getGristConfig} from 'app/common/urlUtils';
import {Computed, dom, DomContents, styled} from 'grainjs';

const t = makeT('HomeIntro');

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
  const emptyLine = cssIntroLine(testId('empty-workspace-info'), t("This workspace is empty."));
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
      t("personal site"),
      testId('welcome-personal-url'));
  }));
  return [
    css.docListHeader(
      dom.autoDispose(personalOrg),
      t("Welcome to {{- orgName}}", {orgName: homeModel.app.currentOrgName}),
      productPill(homeModel.app.currentOrg, {large: true}),
      testId('welcome-title')
    ),
    cssIntroLine(
      testId('welcome-info'),
      t("You have read-only access to this site. Currently there are no documents."),
      dom('br'),
      t("Any documents created in this site will appear here."),
    ),
    cssIntroLine(
      t("Interested in using Grist outside of your team? Visit your free "), docLink, '.',
      testId('welcome-text')
    )
  ];
}

function makeTeamSiteIntro(homeModel: HomeModel) {
  const sproutsProgram = cssLink({href: commonUrls.sproutsProgram, target: '_blank'}, t("Sprouts Program"));
  return [
    css.docListHeader(
      t("Welcome to {{- orgName}}", {orgName: homeModel.app.currentOrgName}),
      productPill(homeModel.app.currentOrg, {large: true}),
      testId('welcome-title')
    ),
    cssIntroLine(t("Get started by inviting your team and creating your first Grist document.")),
    (!isFeatureEnabled('helpCenter') ? null :
      cssIntroLine(
        'Learn more in our ', helpCenterLink(), ', or find an expert via our ', sproutsProgram, '.',  // TODO i18n
        testId('welcome-text')
      )
    ),
    makeCreateButtons(homeModel)
  ];
}

function makePersonalIntro(homeModel: HomeModel, user: FullUser) {
  return [
    css.docListHeader(t("Welcome to Grist, {{- name}}!", {name: user.name}), testId('welcome-title')),
    cssIntroLine(t("Get started by creating your first Grist document.")),
    (!isFeatureEnabled('helpCenter') ? null :
      cssIntroLine(t("Visit our {{link}} to learn more.", { link: helpCenterLink() }),
        testId('welcome-text'))
    ),
    makeCreateButtons(homeModel),
  ];
}

function makeAnonIntroWithoutPlayground(homeModel: HomeModel) {
    return [
      (!isFeatureEnabled('helpCenter') ? null : cssIntroLine(t("Visit our {{link}} to learn more about Grist.", {
        link: helpCenterLink()
      }), testId('welcome-text-no-playground'))),
      cssIntroLine(t("To use Grist, please either sign up or sign in.")),
      cssBtnGroup(
        cssBtn(t("Sign up"), cssButton.cls('-primary'), testId('intro-sign-up'),
          dom.on('click', () => location.href = getSignupUrl())
        ),
        cssBtn(t("Sign in"), testId('intro-sign-in'),
          dom.on('click', () => location.href = getLoginUrl())
        )
      )
    ];
}

function makeAnonIntro(homeModel: HomeModel) {
  const welcomeToGrist = css.docListHeader(t("Welcome to Grist!"), testId('welcome-title'));

  if (!getGristConfig().enableAnonPlayground) {
    return [
      welcomeToGrist,
      ...makeAnonIntroWithoutPlayground(homeModel)
    ];
  }

  const signUp = cssLink({href: getLoginOrSignupUrl()}, t("Sign up"));
  return [
    welcomeToGrist,
    cssIntroLine(t("Get started by exploring templates, or creating your first Grist document.")),
    cssIntroLine(t("{{signUp}} to save your work. ", {signUp}),
      (!isFeatureEnabled('helpCenter') ? null : t("Visit our {{link}} to learn more.", { link: helpCenterLink() })),
      testId('welcome-text')),
    makeCreateButtons(homeModel),
  ];
}

function helpCenterLink() {
  return cssLink({href: commonUrls.help, target: '_blank'}, cssInlineIcon('Help'), t("Help Center"));
}

function buildButtons(homeModel: HomeModel, options: {
  invite: boolean,
  templates: boolean,
  import: boolean,
  empty: boolean,
}) {
  return cssBtnGroup(
    !options.invite ? null :
    cssBtn(cssBtnIcon('Help'), t("Invite Team Members"), testId('intro-invite'),
      cssButton.cls('-primary'),
      dom.on('click', () => manageTeamUsersApp(homeModel.app)),
    ),
    !options.templates ? null :
    cssBtn(cssBtnIcon('FieldTable'), t("Browse Templates"), testId('intro-templates'),
      cssButton.cls('-primary'),
      dom.show(isFeatureEnabled("templates")),
      urlState().setLinkUrl({homePage: 'templates'}),
    ),
    !options.import ? null :
    cssBtn(cssBtnIcon('Import'), t("Import Document"), testId('intro-import-doc'),
      dom.on('click', () => importDocAndOpen(homeModel)),
    ),
    !options.empty ? null :
    cssBtn(cssBtnIcon('Page'), t("Create Empty Document"), testId('intro-create-doc'),
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
