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
  IDomArgs,
  makeTestId,
  Observable,
  styled
} from 'grainjs';

const t = makeT('ActiveUserList');
const testId = makeTestId('test-aul-');

export function buildActiveUserList(owner: IDisposableOwner, userPresenceModel: UserPresenceModel) {
  const usersObs = Computed.create(owner, (use) => {
    const userProfiles = use(userPresenceModel.userProfiles);
    // Clamps max users between 0 and 99 to prevent display issues and errors
    const maxUsers = Math.min(Math.max(0, getGristConfig().userPresenceMaxUsers ?? 99), 99);
    return userProfiles
      .slice()
      .sort(compareUserProfiles)
      // Limits the display to avoid overly long lists on public documents.
      .slice(0, maxUsers);
  });

  const totalUserIconSlots = 4;
  const computedUserIcons: IDomArgs<HTMLUListElement> = [];
  const showRemainingUsersIconObs = Computed.create(owner, (use) => {
    return totalUserIconSlots < use(usersObs).length;
  });

  for (let i = 0; i < (totalUserIconSlots - 1); i++) {
    computedUserIcons.push(domComputed(use => {
      const users = use(usersObs);
      const user = users[i];
      if (!user) {
        return null;
      }
      return dom('li', createUserIndicator(user, { overlapLeft: i > 0 }));
    }));
  }

  computedUserIcons.push(domComputed(use => {
    const users = use(usersObs);
    if (users.length !== totalUserIconSlots) { return null; }
    const user = users[totalUserIconSlots - 1];
    return dom('li', createUserIndicator(user));
  }));

  computedUserIcons.push(dom.maybe(showRemainingUsersIconObs, () => {
    return domComputed(() => {
      return dom('li', createRemainingUsersIndicator(
        usersObs,
        Computed.create(owner,
          (use) => use(usersObs).length - (totalUserIconSlots - 1)))
      );
    });
  }));

  // Reverses the order of user images, so that the z-index is automatically correct without manual CSS overrides.
  computedUserIcons.reverse();

  return cssActiveUserList(
    ...computedUserIcons,
    { "aria-label": t("active user list") },
    testId('container')
  );
}

function createUserIndicator(user: VisibleUserProfile, options = { overlapLeft: false }) {
  return createUserListImage(
    user,
    hoverTooltip(createTooltipContent(user), { key: "topBarBtnTooltip" }),
    options.overlapLeft ? createStyledUserImage.cls("-overlapping") : undefined,
    { 'aria-label': `${t('active user')}: ${user.name}`},
    testId('user-icon')
  );
}

function createRemainingUsersIndicator(usersObs: Observable<VisibleUserProfile[]>, userCountObs?: Observable<number>) {
  return cssRemainingUsersButton(
    cssRemainingUsersImage(
      domComputed(use => `+${userCountObs ? use(userCountObs) : use(usersObs).length}`),
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
