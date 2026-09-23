/**
 * The "Servers" section of the admin panel. The `multi-server` probe decides the situation, and
 * this section shows its own wording for it.
 */

import { makeT } from "app/client/lib/localization";
import { AdminChecks } from "app/client/models/AdminChecks";
import {
  cssDangerText,
  cssHappyText,
  cssIconWrapper as cssWellIcon,
  cssWell,
  cssWellContent,
  cssWellTitle,
} from "app/client/ui/AdminPanelCss";
import { cssValueLabel, SectionItem } from "app/client/ui/SettingsLayout";
import { hoverTooltip } from "app/client/ui/tooltips";
import { textButton } from "app/client/ui2018/buttons";
import { theme, vars } from "app/client/ui2018/cssVars";
import { IconName } from "app/client/ui2018/IconList";
import { icon } from "app/client/ui2018/icons";
import {
  countServerHealth,
  describeServerHealth,
  isMultiServerInstallation,
  knownServerCount,
  MultiServerBootProbeDetails,
  MultiServerEntry,
  MultiServerSituation,
  ServerHealthReason,
} from "app/common/BootProbe";

import { Disposable, dom, DomContents, makeTestId, styled, UseCBOwner } from "grainjs";

const t = makeT("AdminServersSection");
const testId = makeTestId("test-admin-servers-");

type ReasonCount = (reason: ServerHealthReason) => number;

interface Pill {
  cls: string;
  label: () => string;
  // Explains the one-word label.
  tip: () => string;
}

interface SituationCopy {
  kind: "error" | "warning" | "muted";
  icon: IconName;
  // Title and body do not include a count, so they read correctly for any number of servers.
  title: () => string;
  body: () => string;
  // The health reason this situation already explains, so it is not repeated below the banner.
  explains?: ServerHealthReason;
  // What the collapsed row shows. Defaults to the number of servers.
  summary?: (count: ReasonCount, total: number) => string;
}

/**
 * What to tell an admin about each situation: what is wrong, and what to do about it. Which
 * servers are affected is shown in the list below.
 */
const SITUATION_COPY: Record<Exclude<MultiServerSituation, "single-server" | "healthy">, SituationCopy> = {
  "unlicensed": {
    kind: "muted",
    icon: "Lock",
    title: () => t("Grist Fleet is not in your activation key"),
    body: () => t("Grist Fleet is an easy and well-supported way to scale Grist horizontally, so \
a pool of servers can shard load intelligently by document. With it, this section lists each \
server, the documents it holds, and whether it is running."),
  },
  "no-workers": {
    kind: "error",
    icon: "Warning",
    summary: () => t("no servers"),
    title: () => t("No servers are registered to hold documents"),
    body: () => t("No document can be opened until a server is registered to hold it. Check that \
at least one server runs as a doc worker, and that it can reach Redis."),
  },
  "shared-addresses": {
    kind: "error",
    icon: "Warning",
    title: () => t("Some servers share an address"),
    body: () => t("Give each server an address its peers can route to, and that no other server \
uses. Until then, requests for documents on these servers may reach the wrong one and fail."),
  },
  "stale-registrations": {
    kind: "error",
    icon: "Warning",
    explains: "stale",
    // Worded so that it reads correctly for any number.
    summary: (count, total) => t("{{count}} of {{total}} not reporting",
      { count: count("stale"), total }),
    title: () => t("Servers have stopped reporting that they are running"),
    body: () => t("The Grist process may be gone, or unable to reach Redis, or simply too busy to \
say anything. Stop the server for good before doing anything about it, or a server that is merely \
busy could come back and write to documents another server now holds."),
  },
  "no-proxy": {
    kind: "warning",
    icon: "Warning",
    summary: () => t("no proxy"),
    title: () => t("This build does not support Grist Fleet"),
    body: () => t("GRIST_FLEET is set, but this build cannot proxy documents between servers, so \
documents are only reachable on the server assigned to them."),
  },
};

/**
 * Explains the states of servers that the banner does not cover, with a count for each.
 *
 * Singular and plural are separate strings, since an untranslated language falls back to the key,
 * and an i18next plural key would read "1 servers".
 */
const OTHER_STATE: Record<Exclude<ServerHealthReason, "ok" | "shared-address">, (n: number) => string> = {
  stale: n => n === 1 ?
    t("1 other server has stopped reporting that it is running.") :
    t("{{count}} other servers have stopped reporting that they are running.", { count: n }),
  unavailable: n => n === 1 ?
    t("1 other server is registered but not accepting new documents.") :
    t("{{count}} other servers are registered but not accepting new documents.", { count: n }),
};

/**
 * A one-word label for the state of a server, with a tooltip explaining it. A server that is not
 * reporting may still be running, just stuck or unable to reach Redis, so no label says "stopped".
 */
const PILL_BY_REASON: Record<ServerHealthReason, Pill> = {
  "shared-address": {
    cls: "-error",
    label: () => t("shared address"),
    tip: () => t("Another server has the same address, so requests meant for one may reach the \
other."),
  },
  "stale": {
    cls: "-error",
    label: () => t("not reporting"),
    // No exact time given, since it depends on GRIST_DOC_WORKER_UPDATE_LOAD_INTERVAL_MS.
    tip: () => t("Has not said it is running for far longer than it should. A running server says \
so every few seconds, whether or not anyone asks."),
  },
  "unavailable": {
    cls: "-warning",
    label: () => t("draining"),
    tip: () => t("Registered, and keeping the documents it holds, but taking no new ones. Normal \
while a server shuts down."),
  },
  "ok": {
    cls: "-ok",
    label: () => t("running"),
    tip: () => t("Said it is running within the last few seconds."),
  },
};

/**
 * The copy for a situation, or undefined for "healthy" and "single-server", which have none.
 */
function _copyFor(situation: MultiServerSituation): SituationCopy | undefined {
  return SITUATION_COPY[situation as keyof typeof SITUATION_COPY];
}

export interface ServersSectionProps {
  checks: AdminChecks;
}

/**
 * The Servers section, and the settings warning at the top of the page, which use the same check.
 */
export class ServersSection extends Disposable {
  // The last answer, so the list stays in place while a refresh is pending. Set by _check inside
  // computeds, which is safe since it only caches what _check returns.
  private _lastDetails: MultiServerBootProbeDetails | undefined;

  constructor(private _props: ServersSectionProps) {
    super();
  }

  /**
   * With several servers, suggests configuring through the environment, since settings changed on
   * this page may apply only to the server answering. Shown whether or not the activation key
   * includes Grist Fleet.
   */
  public buildWarning(): DomContents {
    return dom.domComputed((use) => {
      const { details } = this._check(use);
      if (!details || knownServerCount(details) <= 1) { return null; }
      return cssPageWarning(
        cssWell.cls("-warning"),
        cssWellIcon(icon("Warning")),
        dom("div",
          cssWellTitle(t("Server pool found")),
          cssWellContent(dom("p", t("Set options through the environment rather than on this page, \
so that every server is configured the same way."))),
        ),
        testId("page-warning"),
      );
    });
  }

  /**
   * A row in the Server card, like the other settings on this page.
   */
  public buildItem(): DomContents {
    return dom.maybe((use) => {
      // Shown only once the check has answered, since most installations have one server and
      // should not see the row flash up and disappear.
      const { details } = this._check(use);
      return details ? isMultiServerInstallation(details) : false;
    }, () => SectionItem({
      id: "servers",
      name: t("Servers"),
      // Home servers that hold no documents do not register, so they are not listed.
      description: t("The servers registered to hold documents"),
      value: dom.domComputed(use => this._buildSummary(use)),
      expandedContent: dom.domComputed(use => this._buildDetail(use)),
    }));
  }

  /** The short summary shown in the row while it is collapsed. */
  private _buildSummary(use: UseCBOwner): DomContents {
    const { details } = this._check(use);
    if (!details) { return cssValueLabel(t("checking")); }
    const copy = _copyFor(details.situation);
    const count = details.registeredServerCount === 1 ?
      t("1 server") : t("{{count}} servers", { count: details.registeredServerCount });
    switch (details.situation) {
      case "healthy":
        return cssValueLabel(cssHappyText(count));
      case "unlicensed":
        return cssValueLabel(count);
      default:
        return cssValueLabel(cssDangerText(
          copy?.summary?.(countServerHealth(details.servers), details.servers?.length ?? 0) ?? count));
    }
  }

  private _buildDetail(use: UseCBOwner): DomContents {
    const { details, checking, failed } = this._check(use);
    if (!details) { return null; }
    const servers = details.servers;
    return cssServers(
      _buildBanner(details),
      failed ? _buildStaleNote() : null,
      servers?.length ? cssServerList(
        cssListHead(_buildIntro(details), this._buildRefresh(checking)),
        servers.map(server => this._buildRow(server, servers)),
      ) :
        // An empty list still gets Refresh. Without Grist Fleet, nothing is listed to refresh.
        servers ? cssListHead(cssListHead.cls("-bare"), this._buildRefresh(checking)) : null,
    );
  }

  /**
   * A button to fetch the list again, since it is not refreshed automatically.
   */
  private _buildRefresh(busy: boolean): DomContents {
    return cssRefresh(
      cssRefreshButton(
        // Named for undo, but the webhook log uses it for refresh too.
        icon("Revert"),
        busy ? t("Refreshing…") : t("Refresh"),
        dom.prop("disabled", busy),
        dom.on("click", () => this._recheck()),
        testId("refresh"),
      ),
    );
  }

  /**
   * The result of the servers check. While a refresh is pending, `details` holds the last answer.
   * It is undefined before the first answer, or if the check failed and there is no earlier one.
   *
   * `failed` means the request itself failed, rather than the probe reporting a fault. It must not
   * count as `checking`, or Refresh would stay disabled.
   */
  private _check(use: UseCBOwner): { details?: MultiServerBootProbeDetails, checking: boolean, failed: boolean } {
    const req = this._props.checks.requestCheckById(use, "multi-server");
    const result = req ? use(req.result) : undefined;
    const raw = result?.details;
    const fresh = raw && "kind" in raw ? raw as MultiServerBootProbeDetails : undefined;
    const failed = !fresh && result?.status === "fault";
    if (fresh) { this._lastDetails = fresh; }
    return { details: fresh ?? this._lastDetails, checking: Boolean(req) && !fresh && !failed, failed };
  }

  /**
   * Re-runs just this check. Discarding it resets its result, which re-runs the computeds that
   * request it. Reloading all checks would be slower, e.g. the sandbox check starts a sandbox.
   */
  private _recheck() {
    this._props.checks.discard("multi-server");
  }

  private _buildRow(server: MultiServerEntry, servers: MultiServerEntry[]): DomContents {
    const reason = describeServerHealth(server);
    // Load is 0 for every server unless GRIST_DOC_WORKER_MAX_MEMORY_MB is set, so it is shown only
    // if some server has a load. Then an idle server shows 0% rather than nothing.
    const showLoad = servers.some(s => (s.load ?? 0) > 0);
    const pill = PILL_BY_REASON[reason];
    return cssServerRow(
      cssServerMain(
        cssServerHead(
          cssServerName(server.id),
          server.self ? cssServerTag(t("this server")) : null,
        ),
        cssServerUrl(server.internalUrl),
        cssServerMeta([
          server.documentCount === 1 ?
            t("1 document") : t("{{count}} documents", { count: server.documentCount }),
          server.group ? t("group {{group}}", { group: server.group }) : null,
          // Load only affects where new documents go if GRIST_EXPERIMENTAL_WORKER_ASSIGNMENT is set.
          showLoad && server.load !== undefined ?
            t("{{percent}}% load", { percent: Math.round(server.load * 100) }) : null,
        ].filter(Boolean).join(" · ")),
        // Other states are explained in the banner, but this one names other servers.
        server.workerIdsSharingAddress?.length ? _buildNote(t("Shares an address with \
{{list}}", { list: server.workerIdsSharingAddress.join(", ") })) : null,
      ),
      cssServerStatus(cssServerPill(
        cssServerPill.cls(pill.cls),
        pill.label(),
        hoverTooltip(pill.tip(), { key: "serverPill" }),
        testId("pill"),
      )),
      testId("row"),
      dom.cls(`test-admin-servers-row-${server.id}`),
    );
  }
}

/** Says that the last refresh failed, above the list from the previous one. */
function _buildStaleNote(): DomContents {
  return cssBanner(
    cssWell.cls("-warning"),
    cssWellIcon(icon("Warning")),
    dom("div",
      cssWellTitle(t("Could not reach the server")),
      cssWellContent(dom("p", t("The list below is from the last successful check. Press Refresh \
to try again."))),
    ),
    testId("stale"),
  );
}

function _buildBanner(details: MultiServerBootProbeDetails): DomContents {
  if (details.situation === "healthy" || details.situation === "single-server") { return null; }
  const copy = SITUATION_COPY[details.situation];
  const count = countServerHealth(details.servers);
  const content = [
    cssWellIcon(icon(copy.icon)),
    dom("div",
      cssWellTitle(copy.title()),
      cssWellContent(dom("p", copy.body())),
      _buildOtherStates(details, count),
    ),
    testId("banner"),
    dom.cls(`test-admin-servers-situation-${details.situation}`),
  ];
  // Without a list below it, the banner has no border, since the card already has one.
  return cssBanner(
    cssWell.cls(`-${copy.kind}`),
    cssBanner.cls("-bare", !details.servers?.length),
    content,
  );
}

/**
 * Explains server states that the banner does not, since the one-word pills alone do not.
 */
function _buildOtherStates(
  details: MultiServerBootProbeDetails, count: ReasonCount,
): DomContents {
  const led = _copyFor(details.situation)?.explains;
  const others = (Object.keys(OTHER_STATE) as (keyof typeof OTHER_STATE)[])
    .filter(reason => reason !== led && count(reason) > 0);
  if (!others.length) { return null; }
  return others.map(reason => cssOtherState(OTHER_STATE[reason](count(reason)), testId("other-state")));
}

/** A warning line under a server. */
function _buildNote(text: string): DomContents {
  return cssServerNote(
    cssServerNoteIcon(icon("Warning")),
    dom("span", text),
    testId("note"),
  );
}

/**
 * A line above the list, naming how documents are routed.
 */
function _buildIntro(details: MultiServerBootProbeDetails): DomContents {
  return cssIntro(details.fleet.active ?
    t("Each document is held by one of these servers. Fleet-style routing.") :
    t("Each document is held by one of these servers. Worker-pool routing."));
}

const cssServers = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 720px;
`);

const cssBanner = styled(cssWell, `
  margin-top: 4px;

  /* Alone in the card, which is a box already: the well keeps its colors and loses its border. */
  &-bare {
    padding: 0;
    border: none;
  }
`);

// Aligned with the page title and cards, with the same gap below as between cards.
const cssPageWarning = styled(cssWell, `
  max-width: 750px;
  margin: 0 auto 16px auto;
`);

// The list's first line, padded like the rows. Tinted, so it doesn't look like an input.
const cssListHead = styled("div", `
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 10px 16px;
  font-size: ${vars.mediumFontSize};
  background-color: ${theme.lightHover};

  /* No list to head. Keeps room for the button's focus ring, which the panel would clip. */
  &-bare {
    padding: 0 6px;
    background-color: transparent;
  }
`);

const cssIntro = styled("p", `
  margin: 0;
  line-height: 1.5;
  /* Wraps above the button when narrow. */
  flex: 1 1 240px;
`);

const cssRefresh = styled("div", `
  display: flex;
  justify-content: flex-end;
  flex: 0 0 auto;
  margin-left: auto;
`);

const cssRefreshButton = styled(textButton, `
  display: inline-flex;
  align-items: center;
  gap: 4px;
  &:disabled {
    color: ${theme.controlFg};
    --icon-color: ${theme.controlFg};
    opacity: 0.6;
  }
`);

const cssServerList = styled("div", `
  display: flex;
  flex-direction: column;
  border-radius: 8px;
  border: 1px solid ${theme.widgetBorder};
  overflow: hidden;
  /* Rows lay themselves out against this, not the window: the panel keeps its own margins. */
  container-type: inline-size;
  container-name: servers;
`);

// Below this width, the state moves below the server's details. Measured against the list.
const NARROW_ROW = "@container servers (max-width: 560px)";

const cssServerRow = styled("div", `
  display: grid;
  /* Fixed width for the state, so it lines up across rows. */
  grid-template-columns: minmax(0, 1fr) 132px;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  /* Not under the head. */
  & + & {
    border-top: 1px solid ${theme.widgetBorder};
  }

  ${NARROW_ROW} {
    & {
      grid-template-columns: minmax(0, 1fr);
      row-gap: 12px;
    }
  }
`);

const cssServerMain = styled("div", `
  min-width: 0;

  ${NARROW_ROW} {
    & {
      /* The whole width, with the state stepping down to a line of its own. */
      grid-column: 1 / -1;
    }
  }
`);

const cssServerStatus = styled("div", `
  display: flex;
  justify-content: flex-end;

  ${NARROW_ROW} {
    & {
      justify-content: flex-start;
    }
  }
`);

const cssServerHead = styled("div", `
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
`);

const cssServerName = styled("div", `
  font-weight: 600;
  overflow-wrap: anywhere;
`);

const cssServerTag = styled("span", `
  color: ${theme.lightText};
  font-size: ${vars.smallFontSize};
`);

const cssServerUrl = styled("div", `
  margin-top: 2px;
  font-family: monospace;
  font-size: ${vars.smallFontSize};
  color: ${theme.lightText};
  overflow-wrap: anywhere;
`);

const cssServerMeta = styled("div", `
  margin-top: 4px;
  font-size: ${vars.smallFontSize};
  color: ${theme.lightText};
`);

const cssServerNote = styled("div", `
  margin-top: 6px;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: ${vars.mediumFontSize};
  color: ${theme.errorText};
  --icon-color: ${theme.errorText};
`);

const cssServerNoteIcon = styled("div", `
  flex-shrink: 0;
  margin-top: 2px;
`);

const cssServerPill = styled("div", `
  flex-shrink: 0;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: ${vars.smallFontSize};
  font-weight: 500;
  white-space: nowrap;
  border: 1px solid transparent;

  &-ok {
    color: ${theme.controlFg};
    border-color: ${theme.controlFg};
  }
  /* dangerText is orange, matching the warning wells. */
  &-warning {
    color: ${theme.dangerText};
    border-color: ${theme.dangerText};
  }
  &-error {
    color: ${theme.errorText};
    border-color: ${theme.errorText};
  }
`);

const cssOtherState = styled("div", `
  margin-top: 8px;
  font-size: ${vars.mediumFontSize};
  line-height: 1.4;
`);
