import {makeT} from 'app/client/lib/localization';
import {HomeModel} from 'app/client/models/HomeModel';
import {productPill} from 'app/client/ui/AppHeader';
import * as css from 'app/client/ui/DocMenuCss';
import {buildHomeIntroCards} from 'app/client/ui/HomeIntroCards';
import {newDocMethods} from 'app/client/ui/NewDocMethods';
import {bigBasicButton} from 'app/client/ui2018/buttons';
import {testId, theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menu, menuCssClass} from 'app/client/ui2018/menus';
import {toggleSwitch} from 'app/client/ui2018/toggleSwitch';
import {FullUser} from 'app/common/LoginSessionAPI';
import * as roles from 'app/common/roles';
import {dom, DomContents, styled} from 'grainjs';
import {defaultMenuOptions} from 'popweasel';

const t = makeT('HomeIntro');

export function buildHomeIntro(homeModel: HomeModel): DomContents {
  const user = homeModel.app.currentValidUser;
  const isAnonym = !user;
  const isPersonal = !homeModel.app.isTeamSite;
  if (isAnonym) {
    return makeAnonIntro(homeModel);
  } else if (isPersonal) {
    return makePersonalIntro(homeModel, user);
  } else {
    return makeTeamSiteIntro(homeModel);
  }
}

export function buildWorkspaceIntro(homeModel: HomeModel): DomContents {
  const isViewer = homeModel.currentWS.get()?.access === roles.VIEWER;
  const isAnonym = !homeModel.app.currentValidUser;
  const emptyLine = css.introLine(testId('empty-workspace-info'), t("This workspace is empty."));
  if (isAnonym || isViewer) {
    return emptyLine;
  } else {
    return [
      emptyLine,
      cssBtnGroup(
        cssBtn(cssBtnIcon('Import'), t("Import Document"), testId('intro-import-doc'),
          dom.on('click', () => newDocMethods.importDocAndOpen(homeModel)),
        ),
        cssBtn(cssBtnIcon('Page'), t("Create Empty Document"), testId('intro-create-doc'),
          dom.on('click', () => newDocMethods.createDocAndOpen(homeModel)),
        ),
      ),
    ];
  }
}

function makeTeamSiteIntro(homeModel: HomeModel) {
  return [
    css.docListHeaderWrap(
      cssHeader(
        t("Welcome to {{- orgName}}", {orgName: homeModel.app.currentOrgName}),
        productPill(homeModel.app.currentOrg, {large: true}),
        testId('welcome-title')
      ),
      buildPreferencesMenu(homeModel),
    ),
    dom.create(buildHomeIntroCards, {homeModel}),
  ];
}

function makePersonalIntro(homeModel: HomeModel, user: FullUser) {
  return [
    css.docListHeaderWrap(
      cssHeader(
        t("Welcome to Grist, {{- name}}!", {name: user.name}),
        testId('welcome-title'),
      ),
      buildPreferencesMenu(homeModel),
    ),
    dom.create(buildHomeIntroCards, {homeModel}),
  ];
}

function makeAnonIntro(homeModel: HomeModel) {
  const welcomeToGrist = css.docListHeaderWrap(
    cssHeader(
      t("Welcome to Grist!"),
      testId('welcome-title'),
    ),
  );

  return cssIntro(
    welcomeToGrist,
    dom.create(buildHomeIntroCards, {homeModel}),
  );
}

function buildPreferencesMenu(homeModel: HomeModel) {
  const {onlyShowDocuments} = homeModel;

  return cssDotsMenu(
    cssDots(icon('Dots')),
    menu(
      () => [
        toggleSwitch(onlyShowDocuments, {
          label: t('Only show documents'),
          args: [
            testId('welcome-menu-only-show-documents'),
          ],
        }),
      ],
      {
        ...defaultMenuOptions,
        menuCssClass: `${menuCssClass} ${cssPreferencesMenu.className}`,
        placement: 'bottom-end',
      }
    ),
    testId('welcome-menu'),
  );
}

const cssIntro = styled('div', `
  margin-bottom: 24px;
`);

const cssHeader = styled(css.listHeader, `
  font-size: 24px;
  line-height: 36px;
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

const cssPreferencesMenu = styled('div', `
  padding: 10px 16px;
`);

const cssDotsMenu = styled('div', `
  display: flex;
  cursor: pointer;
  border-radius: ${vars.controlBorderRadius};

  &:hover, &.weasel-popup-open {
    background-color: ${theme.hover};
  }
`);

const cssDots = styled('div', `
  --icon-color: ${theme.lightText};
  padding: 8px;
`);
