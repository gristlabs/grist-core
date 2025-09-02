import {makeT} from 'app/client/lib/localization';
import {UserPresenceModel} from 'app/client/models/UserPresenceModel';
import {hoverTooltip} from 'app/client/ui/tooltips';
import {createUserImage, cssUserImage} from 'app/client/ui/UserImage';
import {isXSmallScreenObs, theme} from 'app/client/ui2018/cssVars';
import {menu} from 'app/client/ui2018/menus';
import {VisibleUserProfile} from 'app/common/ActiveDocAPI';
import {nativeCompare} from 'app/common/gutil';
import {FullUser} from 'app/common/LoginSessionAPI';
import {components} from 'app/common/ThemePrefs';
import {getGristConfig} from 'app/common/urlUtils';

import {dom, domComputed, DomElementArg, makeTestId, styled} from 'grainjs';

const t = makeT('ActiveUserList');
const testId = makeTestId('test-aul-');

export function buildActiveUserList(userPresenceModel: UserPresenceModel) {
  return domComputed(userPresenceModel.userProfiles, (userProfiles) => {
    // Clamps max users between 0 and 99 to prevent display issues and errors
    const maxUsers = Math.min(Math.max(0, getGristConfig().userPresenceMaxUsers ?? 99), 99);
    const users = userProfiles
      .slice()
      .sort(compareUserProfiles)
      // Need to delete id as it's incompatible with createUserImage's parameters.
      .map(userProfile => ({...userProfile, id: undefined }))
      // Limits the display to avoid overly long lists on public documents.
      .slice(0, maxUsers);

    const maxUserImages = 4;
    const renderAllUsersButton = users.length > maxUserImages;
    const usersToRender = users.slice(0, renderAllUsersButton ? 3 : 4);

    const userImages = usersToRender.map((user, index) => createUserIndicator(user, { overlapLeft: index > 0 }));
    const allUsersButtons = renderAllUsersButton
      ? [createRemainingUsersIndicator(users, (users.length - usersToRender.length))]
      : [];

    // Reverses the order of user images, so that the z-index is automatically correct without manual CSS overrides.
    userImages.reverse();

    return cssActiveUserList(
      ...allUsersButtons.map(button => dom('li', button)),
      ...userImages.map(image => dom('li', image)),
      { "aria-label": t("active user list") },
      testId('container')
    );
  });
}

function createUserIndicator(user: Partial<FullUser>, options = { overlapLeft: false }) {
  return createUserListImage(
    user,
    hoverTooltip(user.name, { key: "topBarBtnTooltip" }),
    options.overlapLeft ? createStyledUserImage.cls("-overlapping") : undefined,
    { 'aria-label': `${t('active user')}: ${user.name}`},
    testId('user-icon')
  );
}

function createRemainingUsersIndicator(users: Partial<FullUser>[], userCount?: number) {
  const count = userCount ?? users.length;
  return cssRemainingUsersButton(
    cssRemainingUsersImage(
      `+${count}`,
      cssUserImage.cls("-medium"),
      dom.style("font-size", "12px"),
    ),
    menu(
      () => users.map(user => remainingUsersMenuItem(
        createUserImage(user, 'medium'),
        dom('div', testId('user-list-user-name'), user.name),
        testId('user-list-user')
      )),
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
`);

const userImageBorderCss = `
  border: 2px solid ${components.topHeaderBg};
  box-sizing: content-box;
`;

const createStyledUserImage = styled(createUserImage, `
  ${userImageBorderCss};

  &-overlapping {
    margin-left: -4px;
  }
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
