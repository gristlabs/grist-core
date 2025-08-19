import {UserPresenceModel} from 'app/client/models/UserPresenceModel';
import {createUserImage, cssUserImage} from 'app/client/ui/UserImage';
import {isXSmallScreenObs, theme} from 'app/client/ui2018/cssVars';
import {menu} from 'app/client/ui2018/menus';
import {hoverTooltip} from 'app/client/ui/tooltips';
import {VisibleUserProfile} from 'app/common/ActiveDocAPI';
import {FullUser} from 'app/common/LoginSessionAPI';
import {components} from 'app/common/ThemePrefs';
import {dom, domComputed, DomElementArg, styled} from 'grainjs';

export function buildActiveUserList(userPresenceModel: UserPresenceModel) {
  return domComputed(userPresenceModel.userProfiles, (userProfiles) => {
    // Need to delete id as it's incompatible with createUserImage's parameters.
    const users = userProfiles
      .slice()
      .sort(compareUserProfiles)
      .map(userProfile => ({...userProfile, id: undefined }))
      // Limits the display to the first 99 users to avoid overly long lists on public documents.
      .slice(0, 99);
    const usersToRender = users.slice(0, 3);
    const remainingUsers = users.slice(3,);

    const firstUserImage = usersToRender.length > 0 ? [createUserIndicator(usersToRender[0])] : [];
    const overlappingUserImages = usersToRender.slice(1).map(user => createUserIndicator(user, { overlapLeft: true }));
    const finalUserImage = remainingUsers.length === 0
      ? []
      : remainingUsers.length == 1
        ? createUserIndicator(remainingUsers[0])
        // The dropdown menu should show the full user list, but only show unlisted users in the counter
        : createRemainingUsersIndicator(users, remainingUsers.length);
    const userImages = firstUserImage.concat(overlappingUserImages, finalUserImage);

    // Reverses the order of user images, so that the z-index is automatically correct without manual CSS overrides.
    userImages.reverse();

    return cssActiveUserList(
      ...userImages.map(image => dom('li', image)),
    );
  });
}

function createUserIndicator(user: Partial<FullUser>, options = { overlapLeft: false }) {
  const imageConstructor = options.overlapLeft ? createOverlappingUserListImage : createUserListImage;
  return imageConstructor(
    user,
    hoverTooltip(user.name, { openDelay: 0, closeDelay: 0 })
  );
}

function createRemainingUsersIndicator(users: Partial<FullUser>[], userCount?: number) {
  const count = userCount ?? users.length;
  return cssRemainingUsersButton(
    cssRemainingUsersImage(
      `+${count}`,
      cssUserImage.cls("-medium"),
      cssUserImage.cls("-border"),
      dom.style("font-size", "12px"),
    ),
    menu(
      () => users.map(user => remainingUsersMenuItem(
        createUserImage(user, 'medium'),
        user.name,
      )),
      {
        // Avoids an issue where the menu code will infinitely loop trying to find the
        // next selectable option, when using keyboard navigation, due to having none.
        allowNothingSelected: true,
      }
    ),
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

const createUserListImage = (user: Parameters<typeof createUserImage>[0], ...args: DomElementArg[]) =>
  createUserImage(
    user,
    'medium',
    cssUserImage.cls("-border"),
    cssUserImage.cls('-reduced'),
    dom.hide(isXSmallScreenObs()),
    ...args
  );

const createOverlappingUserListImage = styled(createUserListImage, `
  margin-left: -4px;
`);

const cssRemainingUsersImage = styled(cssUserImage, `
  margin-left: -4px;
  background-color: ${components.userListRemainingUsersBg};
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
  if (!a.isAnonymous && b.isAnonymous) {
    return -1;
  }

  if (a.isAnonymous && !b.isAnonymous) {
    return 1;
  }

  // If both have the same anonymity, compare based on name
  if (a.name === b.name) {
    return 0;
  }

  return (a.name < b.name) ? -1 : 1;
}
