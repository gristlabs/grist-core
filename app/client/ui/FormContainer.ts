import {makeT} from 'app/client/lib/localization';
import {colors, mediaSmall} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {commonUrls} from 'app/common/gristUrls';
import {DomContents, DomElementArg, styled} from 'grainjs';

const t = makeT('FormContainer');

export function buildFormMessagePage(buildBody: () => DomContents, ...args: DomElementArg[]) {
  return cssFormMessagePage(
    cssFormMessage(
      cssFormMessageBody(
        buildBody(),
      ),
      cssFormMessageFooter(
        buildFormFooter(),
      ),
    ),
    ...args,
  );
}

export function buildFormFooter() {
  return [
    cssPoweredByGrist(
      cssPoweredByGristLink(
        {href: commonUrls.forms, target: '_blank'},
        t('Powered by'),
        cssGristLogo(),
      )
    ),
    cssBuildForm(
      cssBuildFormLink(
        {href: commonUrls.forms, target: '_blank'},
        t('Build your own form'),
        icon('Expand'),
      ),
    ),
  ];
}

export const cssFormMessageImageContainer = styled('div', `
  margin-top: 28px;
  display: flex;
  justify-content: center;
`);

export const cssFormMessageImage = styled('img', `
  height: 100%;
  width: 100%;
`);

export const cssFormMessageText = styled('div', `
  color: ${colors.dark};
  text-align: center;
  font-weight: 600;
  font-size: 16px;
  line-height: 24px;
  margin-top: 32px;
  margin-bottom: 24px;
`);

const cssFormMessagePage = styled('div', `
  padding: 16px;
`);

const cssFormMessage = styled('div', `
  display: flex;
  flex-direction: column;
  align-items: center;
  background-color: white;
  border: 1px solid ${colors.darkGrey};
  border-radius: 3px;
  max-width: 600px;
  margin: 0px auto;
`);

const cssFormMessageBody = styled('div', `
  width: 100%;
  padding: 20px 48px 20px 48px;

  @media ${mediaSmall} {
    & {
      padding: 20px;
    }
  }
`);

const cssFormMessageFooter = styled('div', `
  border-top: 1px solid ${colors.darkGrey};
  padding: 8px 16px;
  width: 100%;
`);

const cssPoweredByGrist = styled('div', `
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

const cssPoweredByGristLink = styled('a', `
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: ${colors.darkText};
  text-decoration: none;
`);

const cssGristLogo = styled('div', `
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

const cssBuildForm = styled('div', `
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 8px;
`);

const cssBuildFormLink = styled('a', `
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  line-height: 16px;
  text-decoration-line: underline;
  color: ${colors.darkGreen};
  --icon-color: ${colors.darkGreen};
`);
