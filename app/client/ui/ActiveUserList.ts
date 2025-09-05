import {makeT} from 'app/client/lib/localization';
import {UserPresenceModel} from 'app/client/models/UserPresenceModel';
import {hoverTooltip} from 'app/client/ui/tooltips';
import {createUserImage, cssUserImage} from 'app/client/ui/UserImage';
import {isXSmallScreenObs, theme} from 'app/client/ui2018/cssVars';
import {menu} from 'app/client/ui2018/menus';
import {visuallyHidden} from 'app/client/ui2018/visuallyHidden';
import {VisibleUserProfile} from 'app/common/ActiveDocAPI';
import {nativeCompare} from 'app/common/gutil';
import {components, tokens} from 'app/common/ThemePrefs';
import {getGristConfig} from 'app/common/urlUtils';

import {
  Computed,
  dom,
  domComputed,
  DomElementArg, IDisposableOwner,
  makeTestId,
  Observable,
  styled
} from 'grainjs';

const t = makeT('ActiveUserList');
const testId = makeTestId('test-aul-');

export function buildActiveUserList(owner: IDisposableOwner, userPresenceModel: UserPresenceModel) {
  const totalUserIconSlots = 4;

  const visibleUserProfilesObs = Computed.create(owner, (use) => {
    const userProfiles = use(userPresenceModel.userProfiles);
    // Clamps max users between 0 and 99 to prevent display issues and errors
    const maxUsers = Math.min(Math.max(0, getGristConfig().userPresenceMaxUsers ?? 99), 99);
    return userProfiles
      .slice()
      .sort(compareUserProfiles)
      // Limits the display to avoid overly long lists on public documents.
      .slice(0, maxUsers);
  });

  const userMetadataObs = Computed.create(owner, (use) => {
    const visibleUsers = use(visibleUserProfilesObs);
    const totalVisibleUserIcons =
      visibleUsers.length < totalUserIconSlots ? totalUserIconSlots : totalUserIconSlots - 1;
    return {
      totalUsers: visibleUsers.length,
      totalVisibleUserIcons,
    };
  });

  const userIconProfilesObs = Computed.create(owner, (use) => {
    const totalIcons = use(userMetadataObs).totalVisibleUserIcons;
    const profiles = use(visibleUserProfilesObs).slice(0, totalIcons);
    // Reverses the order of user images, so that the z-index is automatically correct without explicitly setting it
    profiles.reverse();
    return profiles;
  });

  const showRemainingUsersIconObs = Computed.create(owner, (use) => {
    return totalUserIconSlots < use(visibleUserProfilesObs).length;
  });

  const computedUserIcons = dom.forEach(userIconProfilesObs, (user) => {
    return dom('li', createUserIndicator(user));
  });

  const remainingUsersIndicator = dom.maybe(showRemainingUsersIconObs, () => {
    return dom('li', createRemainingUsersIndicator(visibleUserProfilesObs, userMetadataObs));
  });

  return cssActiveUserList(
    remainingUsersIndicator,
    computedUserIcons,
    { "aria-label": t("active user list") },
    testId('container')
  );
}

function createUserIndicator(user: VisibleUserProfile) {
  return createUserListImage(
    user,
    hoverTooltip(createTooltipContent(user), { key: "topBarBtnTooltip" }),
    { 'aria-label': `${t('active user')}: ${user.name}`},
    testId('user-icon')
  );
}

function createRemainingUsersIndicator(
  usersObs: Observable<VisibleUserProfile[]>, metadataObs: Observable<UsersMetadata>
) {
  return cssRemainingUsersButton(
    cssRemainingUsersImage(
      dom.text(use => `+${use(metadataObs).totalUsers}`),
      cssUserImage.cls("-medium"),
      dom.style("font-size", "12px"),
    ),
    menu(
      () => domComputed(usersObs, users => users.map(user => remainingUsersMenuItem(
        createUserImage(user, 'medium'),
        dom('div', createUsername(user.name), createEmail(user.email)),
        testId('user-list-user')
      ))),
      {
        // Avoids an issue where the menu code will infinitely loop trying to find the
        // next selectable option, when using keyboard navigation, due to having none.
        allowNothingSelected: true,
      }
    ),
    { 'aria-label': t('open full active user list') },
    testId('all-users-button')
  );
}

const createTooltipContent = (user: VisibleUserProfile) => {
  return [createUsername(user.name), createEmail(user.email)];
};

function createUsername(name: string) {
  return cssUsername(visuallyHidden('Name: '), dom('span', testId('user-name'), name));
}

function createEmail(email?: string) {
  if (!email) {
    return null;
  }
  return cssEmail(visuallyHidden('Email: '), dom('span', testId('user-email'), email));
}

const cssUsername = styled('div', `
  font-weight: ${tokens.headerControlTextWeight};
`);

const cssEmail = styled('div', `
  font-size: ${tokens.smallFontSize};
`);

// Flex-direction is reversed to give us the correct overlaps without messing with z-indexes.
const cssActiveUserList = styled('ul', `
  display: flex;
  align-items: center;
  justify-content: end;
  list-style: none;

  margin: 0;
  padding: 0;
  border: 0 solid;

  flex-direction: row-reverse;

  & > * {
    margin-left: -4px
  }

  & > :last-child {
    margin-left: 0px;
  }
`);

const userImageBorderCss = `
  border: 2px solid ${components.topHeaderBg};
  box-sizing: content-box;
`;

const createStyledUserImage = styled(createUserImage, `
  ${userImageBorderCss};
`);

const createUserListImage = (user: Parameters<typeof createUserImage>[0], ...args: DomElementArg[]) =>
  createStyledUserImage(
    user,
    'medium',
    cssUserImage.cls('-reduced'),
    dom.hide(isXSmallScreenObs()),
    ...args
  );

const cssRemainingUsersImage = styled(cssUserImage, `
  margin-left: -4px;
  background-color: ${components.userListRemainingUsersBg};
  ${userImageBorderCss};
`);

const cssRemainingUsersButton = styled('button', `
  margin: 0;
  padding: 0;
  border: 0 solid;
  font: inherit;
  letter-spacing: inherit;
  color: inherit;
  border-radius: 0;
  background-color: transparent;
  opacity: 1;
  appearance: button;
`);

export const remainingUsersMenuItem = styled(`div`, `
  display: flex;
  justify-content: flex-start;
  padding: var(--weaseljs-menu-item-padding, 8px 24px);
  align-items: center;
  color: ${theme.menuItemFg};
  --icon-color: ${theme.accentIcon};
  text-transform: none;

  & > :first-child {
    margin-right: 5px;
  }
`);

function compareUserProfiles(a: VisibleUserProfile, b: VisibleUserProfile) {
  return nativeCompare(a.isAnonymous, b.isAnonymous) || nativeCompare(a.name, b.name);
}

interface UsersMetadata {
  totalUsers: number;
  totalVisibleUserIcons: number;
}
