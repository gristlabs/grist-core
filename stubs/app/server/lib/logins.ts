import { GristLoginSystem } from 'app/server/lib/GristServer';
import { getMinimalLoginSystem } from 'app/server/lib/MinimalLogin';
import { getSamlLoginSystem } from 'app/server/lib/SamlConfig';

export async function getLoginSystem(): Promise<GristLoginSystem> {
  const saml = await getSamlLoginSystem();
  if (saml) { return saml; }
  return getMinimalLoginSystem();
}

export function getLoginSubdomain(): string | null {
  return null;
}
