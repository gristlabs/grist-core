import {
  bigBasicButton as gristBigBasicButton,
  bigBasicButtonLink as gristBigBasicButtonLink,
  bigPrimaryButton as gristBigPrimaryButton,
  bigPrimaryButtonLink as gristBigPrimaryButtonLink,
  textButton as gristTextButton,
} from 'app/client/ui2018/buttons';
import {mediaXSmall, theme} from 'app/client/ui2018/cssVars';
import {textInput} from 'app/client/ui/inputs';
import {styled} from 'grainjs';

export const text = styled('div', `
  color: ${theme.text};
  font-weight: 400;
  line-height: 20px;
  font-size: 14px;
`);

export const lightText = styled(text, `
  color: ${theme.lightText};
`);

export const lightColor = styled('span', `
  color: ${theme.lightText};
`);

export const centeredText = styled(text, `
  text-align: center;
`);

export const lightlyBolded = styled('span', `
  font-weight: 500;
`);

export const input = textInput;

export const codeInput = styled(input, `
  width: 200px;
`);

export const label = styled('label', `
  color: ${theme.text};
  display: inline-block;
  line-height: 20px;
  font-size: 14px;
  font-weight: 500;
`);

export const formLabel = styled(label, `
  margin-bottom: 8px;
`);

export const googleButton = styled('button', `
  /* Resets */
  position: relative;
  border-style: none;

  /* Vars */
  display: flex;
  justify-content: center;
  align-items: center;
  height: 48px;
  gap: 12px;
  font-size: 15px;
  font-weight: 500;
  line-height: 16px;
  padding: 16px;
  color: ${theme.loginPageGoogleButtonFg};
  background-color: ${theme.loginPageGoogleButtonBg};
  border: 1px solid ${theme.loginPageGoogleButtonBorder};
  border-radius: 4px;
  cursor: pointer;
  width: 100%;

  &:hover {
    background-color: ${theme.loginPageGoogleButtonBgHover};
  }
`);

export const image = styled('div', `
  display: inline-block;
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
`);

export const gristLogo = styled(image, `
  width: 35px;
  height: 32px;
  background-image: var(--icon-GristLogo);
`);

export const googleLogo = styled(image, `
  width: 24px;
  height: 24px;
  background-image: var(--icon-GoogleLogo);
`);

export const loginMethodsSeparator = styled('div', `
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 24px 0px 24px 0px;
`);

export const horizontalLine = styled('hr', `
  border: 1px solid ${theme.loginPageLine};
  flex-grow: 1;
`);

const buttonCommonStyles = `
  /* TODO: Remove once Grist buttons have outlines. */
  outline: revert;

  font-weight: 500;
  font-size: 15px;
  line-height: 16px;
`;

const buttonStyles = buttonCommonStyles + `
  height: 48px;
`;

const buttonLinkStyles = buttonCommonStyles + `
  padding: 16px 32px 16px 32px;
`;

export const bigBasicButton = styled(gristBigBasicButton, buttonStyles);

export const bigBasicButtonLink = styled(gristBigBasicButtonLink, buttonLinkStyles);

export const bigPrimaryButton = styled(gristBigPrimaryButton, buttonStyles);

export const bigPrimaryButtonLink = styled(gristBigPrimaryButtonLink, buttonLinkStyles);

export const textButton = styled(gristTextButton, `
  outline: revert;
  font-size: 14px;
`);

export const pageContainer = styled('div', `
  height: 100%;
  overflow: auto;
  background-color: ${theme.loginPageBackdrop};

  @media ${mediaXSmall} {
    & {
      background-color: ${theme.loginPageBg};
    }
  }
`);

export const flexJustifyCenter = styled('div', `
  display: flex;
  justify-content: center;
`);

export const formContainer = styled('div', `
  background-color: ${theme.loginPageBg};
  max-width: 576px;
  width: 100%;
  margin: 60px 25px 60px 25px;
  padding: 40px 56px 40px 56px;
  border-radius: 8px;

  @media ${mediaXSmall} {
    & {
      margin: 0px;
      padding: 25px 20px 25px 20px;
    }
  }
`);

export const formHeading = styled('div', `
  font-weight: 500;
  font-size: 32px;
  line-height: 40px;
  margin-bottom: 8px;
  color: ${theme.text};

  @media ${mediaXSmall} {
    & {
      font-size: 24px;
      line-height: 32px;
    }
  }
`);

export const formInstructions = styled('div', `
  margin-bottom: 32px;
`);

export const formError = styled(text, `
  color: ${theme.errorText};
  margin-bottom: 16px;
`);

export const centeredFormError = styled(formError, `
  text-align: center;
`);

export const formButtons = styled('div', `
  margin: 32px 0px 0px 0px;
`);

export const formFooter = styled(text, `
  margin-top: 24px;
`);

export const formBody = styled('div', ``);

export const resendCode = styled(text, `
  margin-top: 16px;
`);

export const spinner = styled('div', `
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 250px;
`);
