import { makeT } from "app/client/lib/localization";
import { getLoginOrSignupUrl } from "app/client/lib/urlUtils";
import { AppModel, reportError } from "app/client/models/AppModel";
import { urlState } from "app/client/models/gristUrlState";
import * as css from "app/client/ui/LoginPagesCss";
import { createUserImage } from "app/client/ui/UserImage";
import { bigBasicButtonLink, bigPrimaryButton, bigPrimaryButtonLink } from "app/client/ui2018/buttons";
import { testId, theme } from "app/client/ui2018/cssVars";
import { isFeatureEnabled } from "app/common/gristUrls";
import { FullUser } from "app/common/LoginSessionAPI";
import { getGristConfig } from "app/common/urlUtils";
import { getOrgName, Organization } from "app/common/UserAPI";

import { Computed, dom, DomContents, IDisposableOwner, styled } from "grainjs";

const t = makeT("WelcomeSitePicker");

export function buildWelcomeSitePicker(owner: IDisposableOwner, appModel: AppModel): DomContents {
  // We assume that there is a single domain for personal orgs, and will show a button to open
  // that domain with each of the currently signed-in users.
  const personalOrg = Computed.create(owner, use =>
    use(appModel.topAppModel.orgs).find(o => Boolean(o.owner))?.domain || undefined);

  const teamOrgs = Computed.create(owner, use =>
    use(appModel.topAppModel.orgs).filter(org => !org.owner && org.domain));

  // Nothing to offer: no team site, and no personal site either because they are turned off or
  // because nobody is signed in. Wait for the session fetch, or the initially empty orgs flash
  // "no sites" at a user who has some.
  const hasNoSites = Computed.create(owner, use =>
    use(appModel.topAppModel.sessionLoaded) &&
    use(teamOrgs).length === 0 &&
    (!getGristConfig().enablePersonalOrgs || !appModel.currentValidUser));

  return cssPageContainer(
    testId("welcome-page"),
    css.flexJustifyCenter(
      dom.domComputed(hasNoSites, isEmpty => isEmpty ?
        buildNoSites(appModel) :
        buildSiteList(appModel, personalOrg, teamOrgs),
      ),
    ),
  );
}

function buildSiteList(
  appModel: AppModel,
  personalOrg: Computed<string | undefined>,
  teamOrgs: Computed<Organization[]>,
): DomContents {
  return css.formContainer(
    css.flexJustifyCenter(css.gristLogo()),
    cssHeading(t("Welcome back")),
    cssMessage(t("You have access to the following Grist sites.")),
    cssColumns(
      dom.maybe(
        () => getGristConfig().enablePersonalOrgs,
        () => cssColumn(
          cssColumnLabel(css.horizontalLine(), css.lightText("Personal"), css.horizontalLine()),
          dom.forEach(appModel.topAppModel.users, user => (
            cssOrgButton(
              cssPersonalOrg(
                createUserImage(user, "small"),
                dom("div", user.email, testId("personal-org-email")),
              ),
              dom.attr("href", use => urlState().makeUrl({ org: use(personalOrg) })),
              dom.on("click", (ev) => { void (switchToPersonalUrl(ev, appModel, personalOrg.get(), user)); }),
              testId("personal-org"),
            )
          )),
        ),
      ),
      cssColumn(
        cssColumnLabel(css.horizontalLine(), css.lightText("Team"), css.horizontalLine()),
        dom.forEach(teamOrgs, org => (
          cssOrgButton(
            getOrgName(org),
            urlState().setLinkUrl({ org: org.domain || undefined }),
            testId("org"),
          )
        )),
      ),
    ),
    cssMessage(t("You can always switch sites using the account menu.")),
  );
}

/**
 * Shown in place of an empty list, when the user has nowhere to go from here. Install admins can
 * create the first team site (they are exempt from GRIST_ORG_CREATION_ANYONE).
 */
function buildNoSites(appModel: AppModel): DomContents {
  // Signed-out visitors reach this page too, since /welcome/teams has no login middleware. How the
  // installation is configured is nothing they can act on; signing in is.
  if (!appModel.currentValidUser) {
    return css.formContainer(
      testId("welcome-no-sites"),
      css.flexJustifyCenter(css.gristLogo()),
      cssHeading(t("Sign in to see your sites")),
      css.flexJustifyCenter(
        bigPrimaryButtonLink(t("Sign in"), { href: getLoginOrSignupUrl() }, testId("welcome-sign-in")),
      ),
    );
  }

  const isAdmin = appModel.isInstallAdmin();
  const canCreateSite = isFeatureEnabled("createSite") &&
    (isAdmin || Boolean(getGristConfig().canAnyoneCreateOrgs));

  return css.formContainer(
    testId("welcome-no-sites"),
    css.flexJustifyCenter(css.gristLogo()),
    cssHeading(t("No sites available")),
    cssMessage(
      t("Personal sites are turned off on this installation, and you aren't a member of any \
team site yet."),
    ),
    canCreateSite ? css.flexJustifyCenter(
      bigPrimaryButton(
        t("Create a team site"),
        dom.on("click", () => appModel.showNewSiteModal().catch(reportError)),
        testId("welcome-create-team-site"),
      ),
    ) : cssMessage(
      t("Ask an administrator to add you to a team site."),
      testId("welcome-ask-admin"),
    ),
  );
}

// TODO This works but not for opening a link in a new tab. We currently lack and endpoint that
// would enable opening a link as a particular user, or to switch user and open as them.
async function switchToPersonalUrl(ev: MouseEvent, appModel: AppModel, org: string | undefined, user: FullUser) {
  // Only handle plain-vanilla clicks.
  if (ev.shiftKey || ev.metaKey || ev.ctrlKey || ev.altKey) { return; }
  ev.preventDefault();
  // Set the active session for the given org, then load its home page.
  await appModel.switchUser(user, org);
  window.location.assign(urlState().makeUrl({ org }));
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

const cssColumns = styled("div", `
  display: flex;
  flex-wrap: wrap;
  gap: 32px;
`);

const cssColumn = styled("div", `
  flex: 1 0 0px;
  min-width: 200px;
  position: relative;
`);

const cssColumnLabel = styled("div", `
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

const cssPersonalOrg = styled("div", `
  display: flex;
  align-items: center;
  margin-left: -8px;
  gap: 8px;
  color: ${theme.lightText};
`);
