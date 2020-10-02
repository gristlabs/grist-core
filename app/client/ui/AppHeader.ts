import {urlState} from 'app/client/models/gristUrlState';
import {getTheme, ProductFlavor} from 'app/client/ui/CustomThemes';
import {cssLeftPane} from 'app/client/ui/PagePanels';
import {colors, testId, vars} from 'app/client/ui2018/cssVars';
import * as version from 'app/common/version';
import {BindableValue, dom, styled} from "grainjs";

export function appHeader(orgName: BindableValue<string>, productFlavor: ProductFlavor) {
  const theme = getTheme(productFlavor);
  return cssAppHeader(
    urlState().setLinkUrl({}),
    cssAppHeader.cls('-widelogo', theme.wideLogo || false),
    // Show version when hovering over the application icon.
    cssAppLogo({title: `Ver ${version.version} (${version.gitcommit})`}),
    cssOrgName(dom.text(orgName)),
    testId('dm-org'),
  );
}

const cssAppHeader = styled('a', `
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  &, &:hover, &:focus {
    text-decoration: none;
    outline: none;
    color: ${colors.dark};
  }
`);

const cssAppLogo = styled('div', `
  flex: none;
  height: 48px;
  width: 48px;
  background-image: var(--icon-GristLogo);
  background-size: 22px 22px;
  background-repeat: no-repeat;
  background-position: center;
  background-color: ${vars.logoBg};
  .${cssAppHeader.className}-widelogo & {
    width: 100%;
    background-size: contain;
    background-origin: content-box;
    padding: 8px;
  }
  .${cssLeftPane.className}-open .${cssAppHeader.className}-widelogo & {
    background-image: var(--icon-GristWideLogo, var(--icon-GristLogo));
  }
`);

const cssOrgName = styled('div', `
  padding: 0px 16px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  .${cssAppHeader.className}-widelogo & {
    display: none;
  }
`);
