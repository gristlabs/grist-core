// TODO: document this all, no tests are exercising this code.

import {getGristConfig} from 'app/common/urlUtils';
import {styled} from 'grainjs';

/**
 * Is this grist installation or someone's modified installation. We allow modifying logo
 * at the right corner, and making it wider (removing site switcher in the process).
 *
 * If fieldLink, shows wide logo and hides the switcher, otherwise shows the regular logo.
 *
 * We can convert any org name to a ProductFlavor and any ProductFlavor to a CustomTheme.
 *
 * TODO: explain what is fieldlink, I think this is an user of custom Grist build.
 */
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

  // If still not set, use the org from the config.
  org ||= getGristConfig()?.org;

  // If the org is 'fieldlink', use the fieldlink flavor.
  if (org === 'fieldlink') {
    return 'fieldlink';
  }

  // For any other situation, use the grist flavor.
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
