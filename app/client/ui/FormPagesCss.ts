import {colors, mediaSmall} from 'app/client/ui2018/cssVars';
import {styled} from 'grainjs';

export const pageContainer = styled('div', `
  background-color: ${colors.lightGrey};
  height: 100%;
  width: 100%;
  padding: 52px 0px 52px 0px;
  overflow: auto;

  @media ${mediaSmall} {
    & {
      padding: 20px 0px 20px 0px;
    }
  }
`);

export const formContainer = styled('div', `
  padding-left: 16px;
  padding-right: 16px;
`);

export const form = styled('div', `
  display: flex;
  flex-direction: column;
  align-items: center;
  background-color: white;
  border: 1px solid ${colors.darkGrey};
  border-radius: 3px;
  max-width: 600px;
  margin: 0px auto;
`);

export const formBody = styled('div', `
  width: 100%;
  padding: 20px 48px 20px 48px;

  @media ${mediaSmall} {
    & {
      padding: 20px;
    }
  }
`);

const formMessageImageContainer = styled('div', `
  margin-top: 28px;
  display: flex;
  justify-content: center;
`);

export const formErrorMessageImageContainer = styled(formMessageImageContainer, `
  height: 281px;
`);

export const formSuccessMessageImageContainer = styled(formMessageImageContainer, `
  height: 215px;
`);

export const formMessageImage = styled('img', `
  height: 100%;
  width: 100%;
`);

export const formErrorMessageImage = styled(formMessageImage, `
  max-height: 281px;
  max-width: 250px;
`);

export const formSuccessMessageImage = styled(formMessageImage, `
  max-height: 215px;
  max-width: 250px;
`);

export const formMessageText = styled('div', `
  color: ${colors.dark};
  text-align: center;
  font-weight: 600;
  font-size: 16px;
  line-height: 24px;
  margin-top: 32px;
  margin-bottom: 24px;
`);

export const formFooter = styled('div', `
  border-top: 1px solid ${colors.darkGrey};
  padding: 8px 16px;
  width: 100%;
`);

export const poweredByGrist = styled('div', `
  color: ${colors.darkText};
  font-size: 13px;
  font-style: normal;
  font-weight: 600;
  line-height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0px 10px;
`);

export const poweredByGristLink = styled('a', `
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: ${colors.darkText};
  text-decoration: none;
`);

export const buildForm = styled('div', `
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 8px;
`);

export const buildFormLink = styled('a', `
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  line-height: 16px;
  text-decoration-line: underline;
  color: ${colors.darkGreen};
  --icon-color: ${colors.darkGreen};
`);

export const gristLogo = styled('div', `
  width: 58px;
  height: 20.416px;
  flex-shrink: 0;
  background: url(img/logo-grist.png);
  background-position: 0 0;
  background-size: contain;
  background-color: transparent;
  background-repeat: no-repeat;
  margin-top: 3px;
`);
