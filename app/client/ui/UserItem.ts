import {colors, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {input, styled} from 'grainjs';
import {cssMenuItem} from 'popweasel';

// Styled elements used for rendering a user, e.g. in the UserManager, Billing, etc.
// There is a general structure, but enough small variation that there is no helper at this point.
//
//   cssMemberListItem(
//     cssMemberImage(
//       createUserImage(getFullUser(member), 'large')
//     ),
//     cssMemberText(
//       cssMemberPrimary(NAME),
//       cssMemberSecondary(EMAIL),
//       cssMemberType(DESCRIPTION),
//     )
//   )

export const cssMemberListItem = styled('div', `
  display: flex;
  width: 460px;
  min-height: 64px;
  margin: 0 auto;
  padding: 12px 0;
`);

export const cssMemberImage = styled('div', `
  width: 40px;
  height: 40px;
  margin: 0 4px;
  border-radius: 20px;
  background-color: ${colors.lightGreen};
  background-size: cover;

  .${cssMemberListItem.className}-removed & {
    opacity: 0.4;
  }
`);

export const cssMemberText = styled('div', `
  display: flex;
  flex-direction: column;
  justify-content: center;
  margin: 2px 12px;
  flex: 1 1 0;
  min-width: 0px;
  font-size: ${vars.mediumFontSize};

  .${cssMemberListItem.className}-removed & {
    opacity: 0.4;
  }
`);

export const cssMemberPrimary = styled('span', `
  font-weight: bold;
  color: ${colors.dark};
  padding: 2px 0;

  .${cssMenuItem.className}-sel & {
    color: white;
  }
`);

export const cssMemberSecondary = styled('span', `
  color: ${colors.slate};
  /* the following just undo annoying bootstrap styles that apply to all labels */
  margin: 0px;
  font-weight: normal;
  padding: 2px 0;
  white-space: nowrap;

  .${cssMenuItem.className}-sel & {
    color: white;
  }
`);

export const cssMemberType = styled('span', `
  color: ${colors.slate};
  /* the following just undo annoying bootstrap styles that apply to all labels */
  margin: 0px;
  font-weight: normal;
  padding: 2px 0;
  white-space: nowrap;

  .${cssMenuItem.className}-sel & {
    color: white;
  }
`);

export const cssMemberTypeProblem = styled('span', `
  color: ${colors.error};
  /* the following just undo annoying bootstrap styles that apply to all labels */
  margin: 0px;
  font-weight: normal;
  padding: 2px 0;
  white-space: nowrap;

  .${cssMenuItem.className}-sel & {
    color: white;
  }
`);

export const cssMemberBtn = styled('div', `
  width: 16px;
  height: 16px;
  cursor: pointer;

  &-disabled {
    opacity: 0.3;
    cursor: default;
  }
`);

export const cssRemoveIcon = styled(icon, `
  margin: 12px 0;
`);

export const cssEmailInputContainer = styled('div', `
  position: relative;
  display: flex;
  height: 42px;
  padding: 0 3px;
  margin: 16px 63px;
  border: 1px solid ${colors.darkGrey};
  border-radius: 3px;
  font-size: ${vars.mediumFontSize};
  outline: none;

  &-green {
    border: 1px solid ${colors.lightGreen};
  }
`);

export const cssEmailInput = styled(input, `
  flex: 1 1 0;
  line-height: 42px;
  font-size: ${vars.mediumFontSize};
  font-family: ${vars.fontFamily};
  outline: none;
  border: none;
`);

export const cssMailIcon = styled(icon, `
  margin: 12px 8px 12px 13px;
  background-color: ${colors.slate};
`);
