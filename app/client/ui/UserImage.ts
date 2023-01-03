import {colors, theme} from 'app/client/ui2018/cssVars';
import {FullUser} from 'app/common/LoginSessionAPI';
import {dom, DomElementArg, styled} from 'grainjs';
import {icon} from 'app/client/ui2018/icons';

export type Size = 'small' | 'medium' | 'large';

/**
 * Returns a DOM element showing a circular icon with a user's picture, or the user's initials if
 * picture is missing. Also varies the color of the circle when using initials.
 */
export function createUserImage(user: FullUser|'exampleUser'|null, size: Size, ...args: DomElementArg[]): HTMLElement {
  let initials: string;
  return cssUserImage(
    cssUserImage.cls('-' + size),
    (user === 'exampleUser') ? [cssUserImage.cls('-example'), cssExampleUserIcon('EyeShow')] :
    (!user || user.anonymous) ? cssUserImage.cls('-anon') :
    [
      (user.picture ? cssUserPicture({src: user.picture}, dom.on('error', (ev, el) => dom.hideElem(el, true))) : null),
      dom.style('background-color', pickColor(user)),
      (initials = getInitials(user)).length > 1 ? cssUserImage.cls('-reduced') : null,
      initials!,
    ],
    ...args,
  );
}

/**
 * Extracts initials from a user, e.g. a FullUser. E.g. "Foo Bar" is turned into "FB", and
 * "foo@example.com" into just "f".
 *
 * Exported for testing.
 */
export function getInitials(user: {name?: string, email?: string}) {
  const source = (user.name && user.name.trim()) || (user.email && user.email.trim()) || '';
  return source.split(/\s+/, 2).map(p => p.slice(0, 1)).join('');
}

/**
 * Hashes the username to return a color.
 */
function pickColor(user: FullUser): string {
  let c = hashCode(user.name + ':' + user.email) % someColors.length;
  if (c < 0) { c += someColors.length; }
  return someColors[c];
}

/**
 * Hash a string into an integer. From https://stackoverflow.com/a/7616484/328565.
 */
function hashCode(str: string): number {
  let hash: number = 0;
  for (let i = 0; i < str.length; i++) {
    // tslint:disable-next-line:no-bitwise
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

// These mostly come from https://clrs.cc/
const someColors = [
  '#0B437D',
  '#0074D9',
  '#7FDBFF',
  '#39CCCC',
  '#16DD6D',
  '#2ECC40',
  '#16B378',
  '#EFCC00',
  '#FF851B',
  '#FF4136',
  '#85144b',
  '#F012BE',
  '#B10DC9',
];

export const cssUserImage = styled('div', `
  position: relative;
  text-align: center;
  text-transform: uppercase;
  user-select: none;
  -moz-user-select: none;
  color: white;
  border-radius: 100px;
  display: flex;
  align-items: center;
  justify-content: center;

  &-small {
    width: 24px;
    height: 24px;
    font-size: 13.5px;
    --reduced-font-size: 12px;
  }
  &-medium {
    width: 32px;
    height: 32px;
    font-size: 18px;
    --reduced-font-size: 16px;
  }
  &-large {
    width: 40px;
    height: 40px;
    font-size: 22.5px;
    --reduced-font-size: 20px;
  }

  &-anon {
    border: 1px solid ${colors.slate};
    color: ${colors.slate};
  }
  &-anon::before {
    content: "?"
  }
  &-reduced {
    font-size: var(--reduced-font-size);
  }

  &-example {
    background-color: ${colors.slate};
    border: 1px solid ${colors.slate};
  }
`);

const cssUserPicture = styled('img', `
  position: absolute;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background-color: ${theme.menuBg};
  border-radius: 100px;
  box-sizing: content-box;    /* keep the border outside of the size of the image */
`);

const cssExampleUserIcon = styled(icon, `
  background-color: white;
  width: 45px;
  height: 45px;
  transform: scaleY(0.75);
`);
