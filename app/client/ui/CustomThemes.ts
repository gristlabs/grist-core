import {GristLoadConfig} from 'app/common/gristUrls';
import {styled} from 'grainjs';

export type ProductFlavor = 'grist' | 'efcr' | 'fieldlink';

export interface CustomTheme {
  bodyClassName?: string;
  wideLogo?: boolean;   // Stretch the logo and hide the org name.
}

export function getFlavor(org?: string): ProductFlavor {
  // Using a URL parameter e.g. __themeOrg=fieldlink allows overriding the org used for custom
  // theming, for testing.
  const themeOrg = new URLSearchParams(window.location.search).get('__themeOrg');
  if (themeOrg) { org = themeOrg; }

  if (!org) {
    const gristConfig: GristLoadConfig = (window as any).gristConfig;
    org = gristConfig && gristConfig.org;
  }
  if (org === 'fieldlink') {
    return 'fieldlink';
  } else if (org && /^nioxus(-.*)?$/.test(org)) {
    return 'efcr';
  }
  return 'grist';
}

export function getTheme(flavor: ProductFlavor): CustomTheme {
  switch (flavor) {
    case 'fieldlink':
      return {
        wideLogo: true,
        bodyClassName: cssFieldLinkBody.className,
      };
    case 'efcr':
      return {bodyClassName: cssEfcrBody.className};
    default:
      return {};
  }
}

const cssEfcrBody = styled('body', `
  --icon-GristLogo: url("icons/logo-efcr.png");
  --grist-logo-bg: #009975;
  --grist-color-light-green: #009975;
  --grist-color-dark-green: #007F61;
  --grist-primary-fg: #009975;
  --grist-primary-fg-hover: #007F61;
  --grist-control-fg: #009975;
  --grist-color-darker-green: #004C38;
  --grist-color-dark-bg: #004C38;
`);

const cssFieldLinkBody = styled('body', `
  --icon-GristLogo: url("icons/logo-fieldlink.png");
  --icon-GristWideLogo: url("icons/logo-fieldlink.png");
  --grist-logo-bg: white;
`);
