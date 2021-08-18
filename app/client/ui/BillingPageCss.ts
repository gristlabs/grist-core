import {bigBasicButton, bigPrimaryButtonLink} from 'app/client/ui2018/buttons';
import {colors, mediaSmall, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {input, styled} from 'grainjs';

// Note that the special settings remove the zip code number spinner
export const inputStyle = `
  font-size: ${vars.mediumFontSize};
  height: 42px;
  line-height: 16px;
  width: 100%;
  padding: 13px;
  border: 1px solid #D9D9D9;
  border-radius: 3px;
  outline: none;

  &-invalid {
    color: red;
  }

  &[type=number] {
    -moz-appearance: textfield;
  }
  &[type=number]::-webkit-inner-spin-button,
  &[type=number]::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
`;

export const billingInput = styled(input, inputStyle);
export const stripeInput = styled('div', inputStyle);

export const billingWrapper = styled('div', `
  overflow-y: auto;
`);

export const plansPage = styled('div', `
  margin: 60px 10%;
`);

export const plansContainer = styled('div', `
  display: flex;
  justify-content: space-around;
  flex-wrap: wrap;
  margin: 45px -1%;
`);

export const planBox = styled('div', `
  flex: 1 1 0;
  max-width: 295px;
  border: 1px solid ${colors.mediumGrey};
  border-radius: 1px;
  padding: 40px;
  margin: 0 1% 30px 1%;

  &:last-child {
    border: 1px solid ${colors.lightGreen};
  }
`);

export const planInterval = styled('div', `
  display: inline-block;
  color: ${colors.slate};
  font-weight: ${vars.headerControlTextWeight};
  font-size: ${vars.mediumFontSize};
  margin-left: 8px;
`);

export const summaryFeature = styled('div', `
  color: ${colors.dark};
  margin: 24px 0 24px 20px;
  text-indent: -20px;
`);

export const summaryMissingFeature = styled('div', `
  color: ${colors.slate};
  margin: 12px 0 12px 20px;
`);

export const summarySpacer = styled('div', `
  height: 28px;
`);

export const upgradeBtn = styled(bigPrimaryButtonLink, `
  width: 100%;
  margin: 15px 0 0 0;
  text-align: center;
`);

export const currentBtn = styled(bigBasicButton, `
  width: 100%;
  margin: 20px 0 0 0;
  cursor: default;
`);

export const billingPage = styled('div', `
  display: flex;
  max-width: 1000px;
  margin: auto;

  @media ${mediaSmall} {
    & {
      display: block;
    }
  }
`);

export const billingHeader = styled('div', `
  height: 32px;
  line-height: 32px;
  margin: 0 0 16px 0;
  color: ${colors.dark};
  font-size: ${vars.xxxlargeFontSize};
  font-weight: ${vars.headerControlTextWeight};

  .${planBox.className}:last-child > & {
    color: ${colors.lightGreen};
  }
`);

export const billingSubHeader = styled('div', `
  margin: 16px 0 24px 0;
  color: ${colors.dark};
  font-size: ${vars.mediumFontSize};
  font-weight: bold;
`);

export const billingText = styled('div', `
  font-size: ${vars.mediumFontSize};
  color: ${colors.dark};
`);

export const billingBoldText = styled(billingText, `
  font-weight: bold;
`);

export const billingHintText = styled('div', `
  font-size: ${vars.mediumFontSize};
  color: ${colors.slate};
`);

// TODO: Adds a style for when the button is disabled.
export const billingTextBtn = styled('button', `
  font-size: ${vars.mediumFontSize};
  color: ${colors.lightGreen};
  cursor: pointer;
  margin-left: 24px;
  background-color: transparent;
  border: none;
  padding: 0;
  text-align: left;



  &:hover {
    color: ${colors.darkGreen};
  }
`);

export const billingIcon = styled(icon, `
  background-color: ${colors.lightGreen};
  margin: 0 4px 2px 0;

  .${billingTextBtn.className}:hover > & {
    background-color: ${colors.darkGreen};
  }
`);

export const billingBadIcon = styled(icon, `
  background-color: ${colors.error};
  margin: 0 4px 2px 0;
`);

export const summaryItem = styled('div', `
  padding: 12px 0 26px 0;
`);

export const summaryFeatures = styled('div', `
  margin: 40px 0;
`);

export const summaryText = styled('span', `
  font-size: ${vars.mediumFontSize};
  color: ${colors.dark};
`);

export const focusText = styled('span', `
  font-size: ${vars.mediumFontSize};
  color: ${colors.dark};
  font-weight: bold;
`);

export const cardBlock = styled('div', `
  flex: 1 1 60%;
  margin: 60px;
  @media ${mediaSmall} {
    & {
      margin: 24px;
    }
  }
`);

export const summaryRow = styled('div', `
  display: flex;
`);

export const summaryHeader = styled(summaryRow, `
  margin-bottom: 16px;
`);

export const summaryBlock = styled('div', `
  flex: 1 1 40%;
  margin: 60px;
  @media ${mediaSmall} {
    & {
      margin: 24px;
    }
  }
`);

export const flexSpace = styled('div', `
  flex: 1 1 0px;
`);

export const paymentSubHeader = styled('div', `
  font-weight: ${vars.headerControlTextWeight};
  font-size: ${vars.xxlargeFontSize};
  color: ${colors.dark};
  line-height: 60px;
`);

export const paymentField = styled('div', `
  display: block;
  flex: 1 1 0;
  margin: 4px 0;
  min-width: 120px;
`);

export const paymentFieldInfo = styled('div', `
  color: #929299;
  margin: 10px 0;
`);

export const paymentFieldDanger = styled('div', `
  color: #ffa500;
  margin: 10px 0;
`);

export const paymentSpacer = styled('div', `
  width: 38px;
`);

export const paymentLabel = styled('label', `
  font-weight: ${vars.headerControlTextWeight};
  font-size: ${vars.mediumFontSize};
  color: ${colors.dark};
  line-height: 38px;
`);

export const inputHintLabel = styled('div', `
  margin: 50px 5px 10px 5px;
`);

export const paymentBlock = styled('div', `
  margin: 0 0 20px 0;
`);

export const paymentRow = styled('div', `
  display: flex;
`);

export const paymentBtnRow = styled('div', `
  display: flex;
  margin-top: 30px;
  justify-content: flex-end;
`);

export const inputError = styled('div', `
  height: 16px;
  color: red;
`);

export const spinnerBox = styled('div', `
  margin: 60px;
  text-align: center;
`);

export const errorBox = styled('div', `
  margin: 60px 0;
`);
