import {GristLoadConfig} from 'app/common/gristUrls';
import {styled} from 'grainjs';

export type ProductFlavor = 'grist' | 'fieldlink';

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
    default:
      return {};
  }
}

const cssFieldLinkBody = styled('body', `
  --icon-GristLogo: url("icons/logo-fieldlink.png");
  --icon-GristWideLogo: url("icons/logo-fieldlink.png");
  --grist-logo-bg: white;
`);
