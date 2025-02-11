import {bigBasicButton, bigBasicButtonLink, bigPrimaryButton} from 'app/client/ui2018/buttons';
import {theme} from 'app/client/ui2018/cssVars';
import {styled} from 'grainjs';

export const cssSection = styled('div', ``);

export const cssParagraph = styled('div', `
  color: ${theme.text};
  font-size: 14px;
  line-height: 20px;
  margin-bottom: 12px;
`);

export const cssOptInOutMessage = styled(cssParagraph, `
  line-height: 40px;
  font-weight: 600;
  margin-top: 24px;
  margin-bottom: 0px;
`);

export const cssOptInButton = styled(bigPrimaryButton, `
  display: block;
  margin-top: 24px;
`);

export const cssOptOutButton = styled(bigBasicButton, `
  margin-top: 24px;
`);

export const cssSponsorButton = styled(bigBasicButtonLink, `
  margin-top: 24px;
`);

export const cssButtonIconAndText = styled('div', `
  display: flex;
  align-items: center;
`);

export const cssButtonText = styled('span', `
  margin-left: 8px;
`);

export const cssSpinnerBox = styled('div', `
  margin-top: 24px;
  text-align: center;
`);
