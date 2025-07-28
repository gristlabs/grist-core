import {domComputed, DomElementMethod, styled} from 'grainjs';
import {createUserImage} from 'app/client/ui/UserImage';
import {UserPresenceModel} from 'app/client/models/UserPresenceModel';
import {menu} from 'app/client/ui2018/menus';
import {hoverTooltip} from 'app/client/ui/tooltips';
import {FullUser} from 'app/common/LoginSessionAPI';
import {theme} from 'app/client/ui2018/cssVars';

// TODO - Shrink this list on smaller screens
export function buildActiveUserList(userPresenceModel: UserPresenceModel) {
  return domComputed(userPresenceModel.userProfiles, (userProfiles) => {
    // Need to delete id as it's incompatible with createUserImage's parameters.
    const users = userProfiles.map(userProfile => ({...userProfile, id: undefined }));
    const usersToRender = users.slice(0, 3);
    const remainingUsers = users.slice(3);

    const firstUserImage = usersToRender.length > 0 ? [createUserIndicator(usersToRender[0])] : [];
    const overlappingUserImages = usersToRender.slice(1).map(user => createUserIndicator(user, { overlapLeft: true }));
    const finalUserImage = remainingUsers.length === 0
      ? []
      : remainingUsers.length == 1
        ? createUserIndicator(remainingUsers[0])
        : createRemainingUsersIndicator(remainingUsers);
    const userImages = firstUserImage.concat(overlappingUserImages, finalUserImage);

    // Reverses the order of user images, so that the z-index is automatically correct without manual CSS overrides.
    userImages.reverse();

    return cssActiveUserList(
      ...userImages,
    );
  });
}

function createUserIndicator(user: Partial<FullUser>, options = { overlapLeft: false }) {
  const imageConstructor = options.overlapLeft ? createOverlappingUserImage : createUserImage;
  return imageConstructor(user, 'medium', hoverTooltip(user.name, { openDelay: 0, closeDelay: 0 }));
}

function createRemainingUsersIndicator(users: Partial<FullUser>[]) {
  return createOverlappingUserImage({
      // TODO - make this behave sensibly with many other users
      //        this is a quick hack for now and only works for single digits.
      name: `+ ${users.length}`,
    },
    'medium',
    hoverMenu(
      () => users.map(user => remainingUsersMenuItem(
        () => {},
        createUserImage(user, 'medium'),
        user.name,
      )),
    )
  );
}


function hoverMenu(...args: Parameters<typeof menu>): DomElementMethod {
  return (elem) => {
    const options = args[1];
    const newArgs: typeof args = [...args];
    // Hover menu needs to be attached to the element itself, otherwise it closes when moused over.
    newArgs[1] = { ...options, trigger: ['hover'], attach: elem, hideDelay: 100 };
    return menu(...newArgs);
  };
}

// Flex-direction is reversed to give us the correct overlaps without messing with z-indexes.
const cssActiveUserList = styled('div', `
  display: flex;
  align-items: center;
  justify-content: end;

  flex-direction: row-reverse;
`);

const createOverlappingUserImage = styled(createUserImage, `
  margin-left: -4px;
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
