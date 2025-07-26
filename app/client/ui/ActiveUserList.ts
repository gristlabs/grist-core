import {styled} from 'grainjs';
import {createUserImage} from 'app/client/ui/UserImage';

// TODO: Parameters. Will need a partial-user profile, so that dictates what info needs sharing.
export function buildActiveUserList() {
  return cssActiveUserList(
    // User 4 or +X users
    createOverlappingUserImage(null, 'medium'),
    // User 3
    createOverlappingUserImage(null, 'medium'),
    // User 2
    createOverlappingUserImage(null, 'medium'),
    // User 1
    createUserImage(null, 'medium'),
  );
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
