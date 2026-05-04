import { buildAuthSection } from "app/client/ui/AuthenticationSection";
import { AuthProvider } from "app/common/ConfigAPI";
import { MINIMAL_PROVIDER_KEY } from "app/common/loginProviders";

import { dom, styled } from "grainjs";

/**
 * Storybook-only preview wrapper. Renders the auth section against fixture
 * providers, with no-op admin actions and a "minimal" boot probe so the
 * no-auth hero shows when nothing is active.
 */
function buildAuthSectionPreview(providers: AuthProvider[]): HTMLElement {
  return cssPreviewContainer(
    buildAuthSection(providers, {
      heroCtx: {
        adminEmail: "admin@example.com",
        onReconfigure: () => {},
        onDeactivate: () => {},
      },
      listCtx: {},
      loginSystemId: MINIMAL_PROVIDER_KEY,
    }),
  );
}

const cssPreviewContainer = styled("div", `
  max-width: 700px;
`);

export default {
  title: "Admin / Authentication Section",
};

function provider(overrides: Partial<AuthProvider> & Pick<AuthProvider, "name" | "key">): AuthProvider {
  return { ...overrides };
}

const oidc = (o: Partial<AuthProvider> = {}) => provider({ name: "OIDC", key: "oidc", ...o });
const saml = (o: Partial<AuthProvider> = {}) => provider({ name: "SAML", key: "saml", ...o });
const forward = (o: Partial<AuthProvider> = {}) => provider({ name: "Forwarded headers", key: "forward-auth", ...o });
const getgrist = (o: Partial<AuthProvider> = {}) =>
  provider({ name: "Sign in with getgrist.com", key: "getgrist.com", ...o });

/**
 * All hero card states: no auth (amber, with acknowledge checkbox),
 * active (green, with collapsed provider list), pending restart (blue),
 * active with error (red), and getgrist.com with action buttons.
 */
export const HeroCardStates = () => cssGrid(
  cssColumn(
    cssLabel("No authentication (amber)"),
    buildAuthSectionPreview([
      oidc(),
      saml(),
      forward(),
    ]),
  ),
  cssColumn(
    cssLabel("Active — OIDC (green, list collapsed)"),
    buildAuthSectionPreview([
      oidc({ isConfigured: true, isActive: true }),
      saml(),
      forward(),
    ]),
  ),
  cssColumn(
    cssLabel("Pending restart — OIDC (blue)"),
    buildAuthSectionPreview([
      oidc({ isConfigured: true, willBeActive: true }),
      saml(),
      forward(),
    ]),
  ),
  cssColumn(
    cssLabel("Active with error — OIDC (red)"),
    buildAuthSectionPreview([
      oidc({ isConfigured: true, isActive: true, activeError: "Failed to fetch OIDC discovery document" }),
      saml(),
      forward(),
    ]),
  ),
  cssColumn(
    cssLabel("Active — getgrist.com (with Reconfigure/Deactivate)"),
    buildAuthSectionPreview([
      getgrist({ isConfigured: true, isActive: true }),
      oidc(),
      saml(),
      forward(),
    ]),
  ),
);

/**
 * Provider card badge and border states: unconfigured, active,
 * error, will-be-active, will-be-disabled, env-controlled.
 */
export const ProviderCardStates = () => cssGrid(
  cssColumn(
    cssLabel("Unconfigured (with docs hint)"),
    buildAuthSectionPreview([
      oidc(),
    ]),
  ),
  cssColumn(
    cssLabel("Configured (blue border, Set as active button)"),
    buildAuthSectionPreview([
      oidc({ isConfigured: true, canBeActivated: true }),
    ]),
  ),
  cssColumn(
    cssLabel("Active (green border, configure disabled)"),
    buildAuthSectionPreview([
      oidc({ isConfigured: true, isActive: true }),
    ]),
  ),
  cssColumn(
    cssLabel("Config error (red border)"),
    buildAuthSectionPreview([
      oidc({ configError: "Missing required GRIST_OIDC_IDP_CLIENT_ID" }),
    ]),
  ),
  cssColumn(
    cssLabel("Active + active error"),
    buildAuthSectionPreview([
      oidc({ isConfigured: true, isActive: true, activeError: "OIDC issuer unreachable" }),
    ]),
  ),
  cssColumn(
    cssLabel("Will be active on restart"),
    buildAuthSectionPreview([
      oidc({ isConfigured: true, willBeActive: true }),
    ]),
  ),
  cssColumn(
    cssLabel("Will be disabled on restart"),
    buildAuthSectionPreview([
      oidc({ isConfigured: true, willBeDisabled: true }),
    ]),
  ),
  cssColumn(
    cssLabel("Selected by env var"),
    buildAuthSectionPreview([
      oidc({ isConfigured: true, isActive: true, isSelectedByEnv: true }),
    ]),
  ),
);

/**
 * Realistic multi-provider scenario: OIDC active with error, ForwardAuth
 * configured and ready to switch, SAML unconfigured.
 */
export const MultiProviderScenario = () => dom("div",
  cssLabel("OIDC active (error), ForwardAuth configured, SAML unconfigured"),
  buildAuthSectionPreview([
    oidc({
      isConfigured: true, isActive: true,
      activeError: "connect ECONNREFUSED 127.0.0.1:9090",
    }),
    forward({ isConfigured: true, canBeActivated: true }),
    saml(),
  ]),
);

/**
 * Provider switching in progress: OIDC being disabled, ForwardAuth
 * becoming active on restart.
 */
export const ProviderSwitching = () => dom("div",
  cssLabel("Switching from OIDC to ForwardAuth"),
  buildAuthSectionPreview([
    oidc({ isConfigured: true, willBeDisabled: true }),
    forward({ isConfigured: true, willBeActive: true }),
    saml(),
  ]),
);

const cssGrid = styled("div", `
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 32px;
`);

const cssColumn = styled("div", `
  min-width: 0;
`);

const cssLabel = styled("div", `
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #888;
  margin-bottom: 12px;
  padding-bottom: 4px;
  border-bottom: 1px solid #eee;
`);
