import {parseSubdomain} from 'app/common/gristUrls';

// This interface is used by the standalone login-connect tool for knowing where to redirect to,
// by Client.ts to construct this info, and by CognitoClient to decide what to do.

export interface LoginState {
  // Locally-running Grist uses localPort, while hosted uses subdomain. Login-connect uses this to
  // redirect back to the localhost or to the subdomain.
  localPort?: number;
  subdomain?: string;
  baseDomain?: string;  // the domain with the (left-most) subdomain removed, e.g. ".getgrist.com".
                        // undefined on localhost.

  // Standalone version sets clientId, used later to find the LoginSession. Hosted and dev
  // versions rely on the browser cookies instead, specifically on the session cookie.
  clientId?: string;

  // Hosted and dev versions set redirectUrl and redirect to it when login or logout completes.
  // Standalone version omits redirectUrl, and serves a page which closes the window.
  redirectUrl?: string;
}

/// Allowed localhost addresses.
export const localhostRegex = /^localhost(?::(\d+))?$/i;

export function getLoginState(reqHost: string): LoginState|null {
  const {org, base} = parseSubdomain(reqHost);
  const matchPort = localhostRegex.exec(reqHost);
  return org ? {subdomain: org, baseDomain: base} :
    matchPort ? {localPort: matchPort[1] ? parseInt(matchPort[1], 10) : 80} : null;
}
