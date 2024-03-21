import { makeT } from 'app/client/lib/localization';
import { AppModel } from "app/client/models/AppModel";
import { urlState} from "app/client/models/gristUrlState";
import { createUserImage } from 'app/client/ui/UserImage';
import { bigBasicButtonLink } from "app/client/ui2018/buttons";
import { testId, theme } from "app/client/ui2018/cssVars";
import { FullUser } from 'app/common/LoginSessionAPI';
import { getOrgName } from "app/common/UserAPI";
import * as css from 'app/client/ui/LoginPagesCss';
import { Computed, dom, DomContents, IDisposableOwner, styled } from "grainjs";

const t = makeT('WelcomeSitePicker');

export function buildWelcomeSitePicker(owner: IDisposableOwner, appModel: AppModel): DomContents {
  // We assume that there is a single domain for personal orgs, and will show a button to open
  // that domain with each of the currently signed-in users.
  const personalOrg = Computed.create(owner, (use) =>
    use(appModel.topAppModel.orgs).find(o => Boolean(o.owner))?.domain || undefined);

  return cssPageContainer(
    testId('welcome-page'),
    css.centeredFlexContainer(
      css.formContainer(
        css.gristLogo(),
        cssHeading(t('Welcome back')),
        cssMessage(t('You have access to the following Grist sites.')),
        cssColumns(
          cssColumn(
            cssColumnLabel(css.horizontalLine(), css.lightText('Personal'), css.horizontalLine()),
            dom.forEach(appModel.topAppModel.users, (user) => (
              cssOrgButton(
                cssPersonalOrg(
                  createUserImage(user, 'small'),
                  dom('div', user.email, testId('personal-org-email')),
                ),
                dom.attr('href', (use) => urlState().makeUrl({org: use(personalOrg)})),
                dom.on('click', (ev) => { void(switchToPersonalUrl(ev, appModel, personalOrg.get(), user)); }),
                testId('personal-org'),
              )
            )),
          ),
          cssColumn(
            cssColumnLabel(css.horizontalLine(), css.lightText('Team'), css.horizontalLine()),
            dom.forEach(appModel.topAppModel.orgs, (org) => (
              org.owner || !org.domain ? null : cssOrgButton(
                getOrgName(org),
                urlState().setLinkUrl({org: org.domain}),
                testId('org'),
              )
            )),
          )
        ),
        cssMessage(t("You can always switch sites using the account menu.")),
      )
    )
  );
}

// TODO This works but not for opening a link in a new tab. We currently lack and endpoint that
// would enable opening a link as a particular user, or to switch user and open as them.
async function switchToPersonalUrl(ev: MouseEvent, appModel: AppModel, org: string|undefined, user: FullUser) {
  // Only handle plain-vanilla clicks.
  if (ev.shiftKey || ev.metaKey || ev.ctrlKey || ev.altKey) { return; }
  ev.preventDefault();
  // Set the active session for the given org, then load its home page.
  await appModel.switchUser(user, org);
  window.location.assign(urlState().makeUrl({org}));
}

const cssPageContainer = styled(css.pageContainer, `
  padding-bottom: 40px;
`);

const cssHeading = styled(css.formHeading, `
  margin-top: 16px;
  text-align: center;
`);

const cssMessage = styled(css.centeredText, `
  margin: 24px 0;
`);

const cssColumns = styled('div', `
  display: flex;
  flex-wrap: wrap;
  gap: 32px;
`);

const cssColumn = styled('div', `
  flex: 1 0 0px;
  min-width: 200px;
  position: relative;
`);

const cssColumnLabel = styled('div', `
  display: flex;
  align-items: center;
  gap: 8px;
`);

const cssOrgButton = styled(bigBasicButtonLink, `
  display: block;
  margin: 8px 0;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
`);

const cssPersonalOrg = styled('div', `
  display: flex;
  align-items: center;
  margin-left: -8px;
  gap: 8px;
  color: ${theme.lightText};
`);
