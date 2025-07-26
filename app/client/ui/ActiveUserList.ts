import {domComputed, styled} from 'grainjs';
import {createUserImage} from 'app/client/ui/UserImage';
import {UserPresenceModel} from 'app/client/models/UserPresenceModel';

// TODO: Parameters. Will need a partial-user profile, so that dictates what info needs sharing.
export function buildActiveUserList(userPresenceModel: UserPresenceModel) {
  return domComputed(userPresenceModel.userDetails, (users) => {
    const usersToRender = users.slice(0, 4);

    if (users.length > 4) {
        usersToRender[usersToRender.length - 1] = {
          // TODO - make this behave sensibly with many other users, this is a quick hack for now.
          name: `+ ${users.length - (usersToRender.length - 1)}`,
        };
    }

    const firstUserImage = usersToRender.length > 0 ? [createUserImage(usersToRender[0], 'medium')] : [];
    const overlappingUserImages = usersToRender.slice(1).map(user => createOverlappingUserImage(user, 'medium'));
    const userImages = firstUserImage.concat(overlappingUserImages);

    // Reverses the order of user images, so that the z-index is automatically correct without manual CSS overrides.
    userImages.reverse();

    return cssActiveUserList(
      ...userImages,
    );
  });
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
