import {hashCode} from 'app/client/lib/hashUtils';
import {colors} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {UserProfile} from 'app/common/LoginSessionAPI';
import {components} from 'app/common/ThemePrefs';
import {dom, DomElementArg, styled} from 'grainjs';

export type User = Partial<UserProfile> | "exampleUser" | "addUser" | null;

export type Size = 'small' | 'medium' | 'large';

/**
 * Returns a DOM element showing a circular icon with a user's picture, or the user's initials if
 * picture is missing. Also varies the color of the circle when using initials.
 */
export function createUserImage(user: User, size: Size, ...args: DomElementArg[]): HTMLElement {
  return cssUserImage(
    cssUserImage.cls('-' + size),
    ...(function*() {
      if (user === 'exampleUser') {
        yield [cssUserImage.cls('-example'), cssExampleUserIcon('EyeShow')];
      } else if (user === 'addUser') {
        yield [cssUserImage.cls('-add'), cssUserIcon('AddUser')];
      } else if (!user || user.anonymous) {
        yield cssUserImage.cls('-anon');
      } else {
        if (user.picture) {
          yield cssUserPicture({src: user.picture}, dom.on('error', (ev, el) => dom.hideElem(el, true)));
        }
        yield dom.style('background-color', pickColor(user));
        const initials = getInitials(user);
        if (initials.length > 1) {
          yield cssUserImage.cls('-reduced');
        }
        yield initials;
      }
    })(),
    ...args,
  );
}

/**
 * Extracts initials from a user, e.g. a FullUser. E.g. "Foo Bar" is turned into "FB", and
 * "foo@example.com" into just "f".
 *
 * Exported for testing.
 */
export function getInitials(user: Partial<UserProfile>) {
  const source = (user.name && user.name.trim()) || (user.email && user.email.trim()) || '';
  return source.split(/\s+/, 2).map(p => p.slice(0, 1)).join('');
}

/**
 * Hashes the username to return a color.
 */
function pickColor(user: Partial<UserProfile>): string {
  let c = hashCode(user.name + ':' + user.email) % someColors.length;
  if (c < 0) { c += someColors.length; }
  return someColors[c];
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
  --text-color: white;
  position: relative;
  text-align: center;
  text-transform: uppercase;
  user-select: none;
  -moz-user-select: none;
  color: var(--text-color);
  border-radius: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
  --border-size: 0px;
  width: calc(var(--icon-size, 24px) - var(--border-size));
  height: calc(var(--icon-size, 24px) - var(--border-size));
  flex-shrink: 0;
  flex-grow: 0;
  line-height: 1em;

  background-color: ${components.topHeaderBg};

  &-small {
    --icon-size: 24px;
    font-size: 13.5px;
    --reduced-font-size: 12px;
  }
  &-medium {
    --icon-size: 32px;
    font-size: 18px;
    --reduced-font-size: 16px;
  }
  &-border {
    --border-size: 2px;
  }
  &-large {
    --icon-size: 40px;
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
  &-square {
    border-radius: 0px;
  }
  &-example, &-add {
    background-color: ${colors.slate};
    border: 1px solid ${colors.slate};
  }
  /* make sure the kb highlight is on top of the image when used in app logo */
  &-inAppLogo {
    z-index: -1;
  }
`);

const cssUserPicture = styled('img', `
  position: absolute;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background-color: ${components.menuBg};
  border-radius: inherit;
  box-sizing: content-box;    /* keep the border outside of the size of the image */
`);

const cssUserIcon = styled(icon, `
  background-color: white;
`);

const cssExampleUserIcon = styled(cssUserIcon, `
  width: 45px;
  height: 45px;
  transform: scaleY(0.75);
`);
