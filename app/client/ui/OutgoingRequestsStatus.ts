import { makeT } from "app/client/lib/localization";
import {
  cssIconWrapper as cssWellIcon,
  cssValueLabel,
  cssWell,
  cssWellContent,
  cssWellTitle,
} from "app/client/ui/AdminPanelCss";
import { theme, vars } from "app/client/ui2018/cssVars";
import { IconName } from "app/client/ui2018/IconList";
import { icon } from "app/client/ui2018/icons";
import {
  BootProbeResult,
  OutgoingRequestsFeatureCheck,
  OutgoingRequestsFeatureId,
  OutgoingRequestsFeatureState,
  OutgoingRequestsProbeDetails,
} from "app/common/BootProbe";

import { dom, DomContents, styled } from "grainjs";

const t = makeT("OutgoingRequestsStatus");

interface FeatureCopy {
  name: string;
  blurb: string;
  envVars?: string[];
  note?: string;
}

const FEATURE_COPY: Record<OutgoingRequestsFeatureId, FeatureCopy> = {
  "request-function": {
    name: "REQUEST() in formulas",
    blurb: "Lets formula authors fetch data from external URLs.",
    envVars: ["GRIST_ENABLE_REQUEST_FUNCTION"],
  },
  "webhooks": {
    name: "Webhooks",
    blurb: "Document triggers can call external URLs when rows change.",
    envVars: ["ALLOWED_WEBHOOK_DOMAINS"],
  },
  "import-from-url": {
    name: "Import from URL",
    blurb: "Users can import data from a URL into a document.",
    note: "Only active when a URL proxy is configured.",
  },
};

const PILL_BY_STATE: Record<OutgoingRequestsFeatureState, { cls: string; label: string }> = {
  "off": { cls: "-off", label: "off" },
  "on-proxied": { cls: "-ok", label: "on, proxied" },
  "on-unproxied": { cls: "-danger", label: "on, unproxied" },
  "on-direct": { cls: "-danger", label: "on, direct" },
};

function readDetails(result: BootProbeResult | undefined): OutgoingRequestsProbeDetails | undefined {
  return result?.details as OutgoingRequestsProbeDetails | undefined;
}

/**
 * One-word status badge shown next to the "Outgoing requests" item on the
 * admin panel.
 */
export function buildOutgoingRequestsSummary(result: BootProbeResult | undefined): DomContents {
  if (!result) { return cssValueLabel(t("checking")); }
  const proxy = readDetails(result)?.proxy;
  const proxyActive = Boolean(proxy?.untrustedConfigured && !proxy?.untrustedDirect);
  switch (result.status) {
    case "fault": return cssValueLabel(cssDangerText(t("unfiltered")));
    case "warning": return cssValueLabel(cssDangerText(t("review")));
    default:
      return proxyActive ?
        cssValueLabel(cssHappyText(t("filtered"))) :
        cssValueLabel(cssGrayed(t("not configured")));
  }
}

/**
 * Expanded "Outgoing requests" panel shown in the admin panel's Security
 * Settings section. Also used by Storybook with synthetic probe fixtures.
 */
export function buildOutgoingRequestsPanel(result: BootProbeResult | undefined): DomContents {
  if (!result) { return dom("p", t("Checking…")); }
  const details = readDetails(result);
  const proxy = details?.proxy;
  const checks = details?.checks || [];
  const anyEnabled = checks.some(c => c.state !== "off");

  return cssOutReqContainer(
    _buildBanner(result, anyEnabled),
    cssOutReqIntro(t("Three features can make Grist send HTTP requests on behalf of your users. \
Here's how each one is set up right now.")),
    cssOutReqList(checks.map(_buildFeatureRow)),
    _buildProxyBox(proxy),
  );
}

type BannerKind = "error" | "warning" | "success" | "muted";

interface BannerCopy {
  icon: IconName;
  title: string;
  body: string;
}

const BANNER_BY_KIND: Record<BannerKind, BannerCopy> = {
  error: {
    icon: "Warning",
    title: "User-triggered outgoing requests aren't filtered",
    body: "At least one feature below can reach any URL, \
including addresses on your internal network. Configure a filtering proxy to close this off.",
  },
  warning: {
    icon: "Warning",
    title: "Double-check your configuration",
    body: "A feature below is enabled without a URL filter. Review the rows and proxy settings.",
  },
  success: {
    icon: "Tick",
    title: "Outgoing requests are filtered",
    body: "User-triggered traffic goes through a URL proxy.",
  },
  muted: {
    icon: "Offline",
    title: "Nothing is reaching out",
    body: "None of the features that send outgoing requests are on, so no proxy is needed.",
  },
};

function _bannerKind(result: BootProbeResult, anyEnabled: boolean): BannerKind {
  if (result.status === "fault") { return "error"; }
  if (result.status === "warning") { return "warning"; }
  return anyEnabled ? "success" : "muted";
}

function _buildBanner(result: BootProbeResult, anyEnabled: boolean): DomContents {
  const kind = _bannerKind(result, anyEnabled);
  const copy = BANNER_BY_KIND[kind];
  return cssWell(cssWell.cls(`-${kind}`),
    cssWellIcon(icon(copy.icon)),
    dom("div",
      cssWellTitle(t(copy.title)),
      cssWellContent(dom("p", t(copy.body))),
    ),
  );
}

function _faultConcern(check: OutgoingRequestsFeatureCheck): string {
  if (check.id === "request-function") {
    return t("Any editor could trigger a request to an internal URL.");
  }
  if (check.id === "webhooks" && check.wildcardAllowed) {
    return t("Any host is allowed and no URL filter is in place.");
  }
  return t("Not filtered.");
}

function _buildFeatureRow(check: OutgoingRequestsFeatureCheck): DomContents {
  const copy = FEATURE_COPY[check.id];
  const pill = PILL_BY_STATE[check.state];
  const meta = check.wildcardAllowed ?
    t("Allowed: any host (*)") :
    (check.allowedDomains && check.allowedDomains.length > 0 ?
      t("Allowed: {{list}}", { list: check.allowedDomains.join(", ") }) :
      undefined);
  const wildcardNote = (check.state !== "off" && check.wildcardAllowed && check.status !== "fault") ?
    t("Open to any host. The URL proxy is what keeps this safe.") :
    undefined;

  return cssOutReqRow(
    cssOutReqRowMain(
      cssOutReqRowName(t(copy.name)),
      cssOutReqRowBlurb(t(copy.blurb)),
      meta ? cssOutReqRowMeta(meta) : null,
      wildcardNote ? cssOutReqRowNote(wildcardNote) : copy.note ? cssOutReqRowNote(t(copy.note)) : null,
      check.status === "fault" ? cssOutReqRowConcern(
        cssOutReqRowConcernIcon(icon("Warning")),
        dom("span", _faultConcern(check)),
      ) : null,
      copy.envVars && copy.envVars.length > 0 ? cssOutReqEnv(
        cssOutReqEnvLabel(t("Search docs for:")),
        copy.envVars.map(name => cssOutReqEnvName(name)),
      ) : null,
    ),
    cssOutReqPill(cssOutReqPill.cls(pill.cls), t(pill.label)),
  );
}

function _buildProxyBox(proxy: OutgoingRequestsProbeDetails["proxy"] | undefined): DomContents {
  const untrustedState: "-ok" | "-bad" | "-muted" = !proxy ? "-muted" :
    proxy.untrustedDirect ? "-bad" :
      proxy.untrustedConfigured ? "-ok" : "-muted";
  const untrustedIcon: IconName = untrustedState === "-ok" ? "Tick" :
    untrustedState === "-bad" ? "Warning" : "Offline";
  const untrustedDetail = !proxy ? "" :
    proxy.untrustedDirect ?
      t("Grist sends them straight out. You've opted out of URL filtering.") :
      proxy.untrustedConfigured ?
        t("Grist routes those requests through the URL filter you've set up.") :
        t("No URL filter is set up. Features that need one stay switched off.");

  const trustedConfigured = Boolean(proxy?.trustedConfigured);

  return cssOutReqProxyBox(
    cssOutReqProxyLine(
      cssOutReqProxyIcon(cssOutReqProxyIcon.cls(untrustedState), icon(untrustedIcon)),
      dom("div",
        cssOutReqProxyHeadline(t("When your users reach out…")),
        cssOutReqProxyDetail(untrustedDetail),
        cssOutReqEnv(
          cssOutReqEnvLabel(t("Search docs for:")),
          cssOutReqEnvName("GRIST_PROXY_FOR_UNTRUSTED_URLS"),
        ),
      ),
    ),
    cssOutReqProxyLine(
      cssOutReqProxyIcon(
        cssOutReqProxyIcon.cls(trustedConfigured ? "-ok" : "-muted"),
        icon(trustedConfigured ? "Tick" : "Offline"),
      ),
      dom("div",
        cssOutReqProxyHeadline(t("When Grist itself reaches out…")),
        cssOutReqProxyDetail(
          t("For example, checking for updates or talking to your single sign-on provider."),
        ),
        cssOutReqProxyDetail(
          trustedConfigured ?
            t("These requests go through your HTTPS proxy.") :
            t("Grist connects directly. No HTTPS proxy is in place."),
        ),
        cssOutReqEnv(
          cssOutReqEnvLabel(t("Search docs for:")),
          cssOutReqEnvName("HTTPS_PROXY"),
        ),
      ),
    ),
  );
}

const cssHappyText = styled("span", `
  color: ${theme.controlFg};
`);

const cssDangerText = styled("div", `
  color: ${theme.dangerText};
`);

const cssGrayed = styled("div", `
  color: ${theme.lightText};
`);

const cssOutReqContainer = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 720px;
`);

const cssOutReqIntro = styled("p", `
  margin: 0;
  color: ${theme.lightText};
  line-height: 1.5;
`);

const cssOutReqList = styled("div", `
  display: flex;
  flex-direction: column;
  border-radius: 8px;
  border: 1px solid ${theme.widgetBorder};
  overflow: hidden;
`);

const cssOutReqRow = styled("div", `
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 14px 16px;
  &:not(:first-child) {
    border-top: 1px solid ${theme.widgetBorder};
  }
`);

const cssOutReqRowMain = styled("div", `
  flex: 1 1 auto;
  min-width: 0;
`);

const cssOutReqRowName = styled("div", `
  font-weight: 600;
  margin-bottom: 2px;
`);

const cssOutReqRowBlurb = styled("div", `
  color: ${theme.lightText};
  font-size: ${vars.mediumFontSize};
  line-height: 1.4;
`);

const cssOutReqRowMeta = styled("div", `
  margin-top: 6px;
  font-size: 0.85em;
  color: ${theme.lightText};
  font-family: monospace;
  word-break: break-all;
`);

const cssOutReqRowNote = styled("div", `
  margin-top: 6px;
  font-size: 0.9em;
  color: ${theme.lightText};
  font-style: italic;
`);

const cssOutReqRowConcern = styled("div", `
  margin-top: 8px;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: ${vars.mediumFontSize};
  color: ${theme.errorText};
  --icon-color: ${theme.errorText};
`);

const cssOutReqRowConcernIcon = styled("div", `
  flex-shrink: 0;
  margin-top: 2px;
`);

const cssOutReqPill = styled("div", `
  flex-shrink: 0;
  align-self: center;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 0.85em;
  font-weight: 500;
  white-space: nowrap;
  border: 1px solid transparent;

  &-off {
    color: ${theme.lightText};
    background-color: transparent;
    border-color: ${theme.widgetBorder};
  }
  &-ok {
    color: ${theme.controlFg};
    background-color: transparent;
    border-color: ${theme.controlFg};
  }
  &-danger {
    color: ${theme.errorText};
    background-color: transparent;
    border-color: ${theme.errorText};
  }
`);

const cssOutReqEnv = styled("div", `
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 0.85em;
  color: ${theme.lightText};
`);

const cssOutReqEnvLabel = styled("span", `
  font-style: italic;
`);

const cssOutReqEnvName = styled("code", `
  font-family: monospace;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid ${theme.widgetBorder};
  color: ${theme.text};
  font-size: 0.95em;
`);

const cssOutReqProxyBox = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border-radius: 10px;
  border: 1px solid ${theme.widgetBorder};
`);

const cssOutReqProxyLine = styled("div", `
  display: flex;
  align-items: flex-start;
  gap: 12px;
`);

const cssOutReqProxyIcon = styled("div", `
  flex-shrink: 0;
  margin-top: 2px;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;

  &-ok { --icon-color: ${theme.controlFg}; }
  &-bad { --icon-color: ${theme.errorText}; }
  &-muted { --icon-color: ${theme.lightText}; }
`);

const cssOutReqProxyHeadline = styled("div", `
  font-weight: 600;
  margin-bottom: 2px;
`);

const cssOutReqProxyDetail = styled("div", `
  color: ${theme.lightText};
  font-size: ${vars.mediumFontSize};
  line-height: 1.4;
`);
