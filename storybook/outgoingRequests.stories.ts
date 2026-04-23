import {
  buildOutgoingRequestsPanel,
  buildOutgoingRequestsSummary,
} from "app/client/ui/OutgoingRequestsStatus";
import {
  BootProbeResult,
  OutgoingRequestsFeatureCheck,
  OutgoingRequestsFeatureState,
  worstStatus,
} from "app/common/BootProbe";

import { styled } from "grainjs";

interface Fixture {
  proxyUntrustedConfigured?: boolean;
  proxyUntrustedDirect?: boolean;
  proxyTrustedConfigured?: boolean;
  requestFunctionEnabled?: boolean;
  webhookDomains?: string[];
  webhookWildcard?: boolean;
  importFromUrl?: boolean;
}

function stateFor(enabled: boolean, f: Fixture): OutgoingRequestsFeatureState {
  if (!enabled) { return "off"; }
  if (f.proxyUntrustedDirect) { return "on-direct"; }
  return f.proxyUntrustedConfigured ? "on-proxied" : "on-unproxied";
}

function makeResult(f: Fixture): BootProbeResult {
  const rfEnabled = Boolean(f.requestFunctionEnabled);
  const rfState = stateFor(rfEnabled, f);
  const rf: OutgoingRequestsFeatureCheck = {
    id: "request-function",
    state: rfState,
    status: rfState === "on-unproxied" ? "fault" : "success",
  };

  const whEnabled = (f.webhookDomains || []).length > 0;
  const whState = stateFor(whEnabled, f);
  const whStatus: BootProbeResult["status"] =
    (whEnabled && f.webhookWildcard && !f.proxyUntrustedConfigured) ? "fault" :
      (whEnabled && !f.webhookWildcard && !f.proxyUntrustedConfigured) ? "warning" :
        "success";
  const wh: OutgoingRequestsFeatureCheck = {
    id: "webhooks",
    state: whState,
    status: whStatus,
    allowedDomains: f.webhookDomains || [],
    wildcardAllowed: Boolean(f.webhookWildcard),
  };

  const iuEnabled = Boolean(f.importFromUrl);
  const iu: OutgoingRequestsFeatureCheck = {
    id: "import-from-url",
    state: iuEnabled ? (f.proxyUntrustedDirect ? "on-direct" : "on-proxied") : "off",
    status: "success",
  };

  const checks = [rf, wh, iu];
  return {
    status: worstStatus(checks.map(c => c.status)),
    details: {
      proxy: {
        untrustedConfigured: Boolean(f.proxyUntrustedConfigured),
        untrustedDirect: Boolean(f.proxyUntrustedDirect),
        trustedConfigured: Boolean(f.proxyTrustedConfigured),
      },
      checks,
    },
  };
}

function scenario(title: string, description: string, fixture: Fixture) {
  return {
    name: title,
    parameters: { docs: { description: { story: description } } },
    render: () => {
      const result = makeResult(fixture);
      return cssStage(
        cssSummaryRow(
          cssSummaryLabel("Summary pill:"),
          buildOutgoingRequestsSummary(result),
        ),
        cssPanelFrame(buildOutgoingRequestsPanel(result)),
      );
    },
  };
}

export default {
  title: "Sections/Outgoing Requests",
  parameters: {
    docs: { codePanel: true, source: { type: "code" } },
  },
};

/**
 * Nothing is enabled, the friendliest case. No proxy is configured because
 * none is needed. The summary reads "unneeded" and the banner says so.
 */
export const NothingEnabled = scenario(
  "Nothing enabled",
  "All outgoing-request features are off. No proxy is configured because none is needed.",
  {},
);

/**
 * Everything is on, and a URL filter proxy handles user-triggered traffic.
 * This is the ideal production setup.
 */
export const ProtectedAllOn = scenario(
  "Protected: all features on",
  "Every feature is enabled and gated by a URL-filtering proxy.",
  {
    proxyUntrustedConfigured: true,
    proxyTrustedConfigured: true,
    requestFunctionEnabled: true,
    webhookDomains: ["example.com", "hooks.example.com"],
    importFromUrl: true,
  },
);

/**
 * REQUEST() is on but no URL filter is in place. Expect a red "unprotected"
 * pill and an actionable error banner at the top of the panel.
 */
export const FaultRequestFunctionUngated = scenario(
  "Fault: REQUEST() without filter",
  "GRIST_ENABLE_REQUEST_FUNCTION is on but no URL proxy is configured.",
  { requestFunctionEnabled: true },
);

/**
 * Webhooks allow any host (*) and the URL proxy is in place. This is a
 * supported production setup, not an alert state. The row shows a soft note
 * that the proxy is what keeps it safe.
 */
export const OpenWebhooksWithProxy = scenario(
  "Open webhooks with proxy",
  "ALLOWED_WEBHOOK_DOMAINS is a wildcard and the URL proxy is configured.",
  {
    proxyUntrustedConfigured: true,
    webhookDomains: ["*"],
    webhookWildcard: true,
  },
);

/**
 * Webhook domains are allowlisted but no URL proxy is configured. The probe
 * returns a "warning" and the panel shows a yellow banner.
 */
export const WarningWebhooksWithoutProxy = scenario(
  "Warning: webhooks without proxy",
  "Specific webhook domains are allowed, but no URL proxy is in place.",
  { webhookDomains: ["hooks.example.com"] },
);

/**
 * Admin has opted for GRIST_PROXY_FOR_UNTRUSTED_URLS="direct", an explicit
 * bypass. The proxy card flags this clearly.
 */
export const DirectBypass = scenario(
  "Direct bypass",
  "GRIST_PROXY_FOR_UNTRUSTED_URLS is \"direct\"; admin has opted out of filtering.",
  {
    proxyUntrustedConfigured: true,
    proxyUntrustedDirect: true,
    requestFunctionEnabled: true,
    webhookDomains: ["hooks.example.com"],
  },
);

/**
 * Only HTTPS_PROXY is set (for trusted server-side traffic); user-triggered
 * features are off. The proxy card still reports both lines clearly.
 */
export const HttpsProxyOnly = scenario(
  "HTTPS proxy only",
  "HTTPS_PROXY is set for Grist's own requests; no user-triggered features are on.",
  { proxyTrustedConfigured: true },
);

/**
 * Undefined result, the probe hasn't reported yet. Both summary and panel
 * render a "checking" placeholder.
 */
export const Checking = {
  name: "Checking…",
  parameters: {
    docs: {
      description: {
        story: "The probe hasn't reported yet; both summary and panel show a placeholder.",
      },
    },
  },
  render: () => cssStage(
    cssSummaryRow(
      cssSummaryLabel("Summary pill:"),
      buildOutgoingRequestsSummary(undefined),
    ),
    cssPanelFrame(buildOutgoingRequestsPanel(undefined)),
  ),
};

const cssStage = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 24px;
  max-width: 800px;
`);

const cssSummaryRow = styled("div", `
  display: flex;
  align-items: center;
  gap: 12px;
`);

const cssSummaryLabel = styled("span", `
  font-size: 13px;
  color: #666;
`);

const cssPanelFrame = styled("div", `
  padding: 20px;
  border-radius: 10px;
  border: 1px dashed #ccc;
  background: #fff;
`);
