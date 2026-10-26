/**
 * Problems shown at the top of the Installation page of the admin panel (/admin).
 *
 * Right under the "Installation" title, above all the cards, there is one well with all problems:
 * errors (Grist is unsafe or broken) first, then warnings (may be fine, but worth a check).
 * The well is red, "N problems need attention", if there is at least one error, and amber,
 * "N warnings", otherwise. Each problem is one line: a red or amber triangle, the title, and on
 * the right a "Show" button that scrolls to the row that reported it, and a "Dismiss" link.
 *
 * On the right of the "Installation" title there is a grey "N dismissed" link. Its tooltip lists
 * the dismissed problems, and a click shows them again.
 *
 * How dismissing works: "Dismiss" saves the problem's key and version in the browser, as
 * { [key]: version }, per installation and user. A problem is
 * hidden while its key is saved with the same version. The version describes what the problem is
 * about, e.g. the ids of the servers that stopped reporting. When it changes, the saved entry no
 * longer matches and the problem shows again. Some problems (NON_DISMISSABLE_KEYS) have no
 * "Dismiss", because Grist does not work until they are fixed, or the request may simply fail.
 *
 * Where the problems come from: a row of the page describes its state as a RowStatus (see
 * AdminPanelCss). It holds the text and color of the pill on the right of the row, and the
 * problem, if there is one. AdminPanel collects the problems of all rows and passes them to the
 * wells here.
 */

import { makeT } from "app/client/lib/localization";
import { localStorageJsonObs, sessionStorageJsonObs } from "app/client/lib/localStorageObs";
import { cssWell, cssWellTitle } from "app/client/ui/AdminPanelCss";
import { focusAdminItem } from "app/client/ui/SettingsLayout";
import { hoverTooltip } from "app/client/ui/tooltips";
import { basicButton } from "app/client/ui2018/buttons";
import { theme } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { tokens } from "app/common/ThemePrefs";
import { getAdminConfig } from "app/common/urlUtils";

import { Computed, Disposable, dom, makeTestId, Observable, styled } from "grainjs";

const t = makeT("TopProblems");
const testId = makeTestId("test-top-problems-");

/**
 * The wells and the "N dismissed" link of the Installation page, for the given problems. Keeps
 * the dismissed problems in the browser.
 */
export class TopProblems extends Disposable {
  // Dismissed problems as { [key]: version }.
  private readonly _dismissed: Observable<DismissedTopProblems>;
  private readonly _visible: Computed<TopProblem[]>;
  private readonly _hidden: Computed<TopProblem[]>;

  constructor(all: Observable<TopProblem[]>, userId: number) {
    super();
    // Per installation and user. Without an installation id we can't tell servers on the same
    // address apart, so we use session storage.
    const installationId = getAdminConfig().installationId;
    const storageCtr = installationId ? localStorageJsonObs : sessionStorageJsonObs;
    this._dismissed = storageCtr<DismissedTopProblems>(
      `adminDismissedTopProblems:${installationId ?? ""}:${userId}`,
      {},
    );
    this._visible = Computed.create(this, use => use(all).filter(p => !isDismissed(use(this._dismissed), p)));
    this._hidden = Computed.create(this, use => use(all).filter(p => isDismissed(use(this._dismissed), p)));
  }

  /**
   * A well under the title of the Installation page. It lists the problems reported by the rows,
   * errors first, each with "Show" and "Dismiss". The well is red if there is at least one error,
   * and amber otherwise.
   */
  public buildDom() {
    const buildRow = (p: TopProblem) => cssRow(
      cssRowIcon(
        cssRowIcon.cls("-" + p.severity),
        icon("Warning"),
        testId("icon"),
      ),
      cssFill(
        p.title,
        testId("title"),
      ),
      cssActions(
        basicButton(
          t("Show"),
          dom.on("click", () => focusAdminItem(p.anchor)),
          testId("show"),
        ),
        canBeDismissed(p) ?
          cssDismiss(
            t("Dismiss"),
            dom.on("click", () => this._dismiss(p)),
            testId("dismiss"),
          ) :
          null,
      ),
      testId("problem"),
    );

    return dom.domComputed((use) => {
      const shown = use(this._visible);
      if (!shown.length) {
        return null;
      }
      const errors = shown.filter(p => p.severity === "error");
      const warnings = shown.filter(p => p.severity === "warning");
      const severity: TopProblem["severity"] = errors.length ? "error" : "warning";
      return cssTopProblemsWell(
        cssWell.cls("-" + severity),
        cssTopProblemsWell.cls("-" + severity),
        cssFill(
          cssWellTitle(
            severity === "error" ?
              t("{{count}} problems need attention", { count: shown.length }) :
              t("{{count}} warnings", { count: shown.length }),
            dom.style("margin-bottom", "4px"),
          ),
          dom("div", severity === "error" ?
            t("Grist may not be safe or may not work until these are fixed.") :
            t("These may be fine for your setup, but check them.")),
          cssList([...errors, ...warnings].map(buildRow)),
        ),
        testId("well"),
      );
    });
  }

  /**
   * "N dismissed" for the right of the Installation title. The tooltip lists the dismissed
   * problems, a click shows them again.
   */
  public buildDismissedLink() {
    const buildTooltip = () => [
      ...this._hidden.get().map(p => dom("div", p.title)),
      cssTooltipNote(t("Click to show them again.")),
    ];

    return dom.maybe(use => use(this._hidden).length, count => [
      cssDismissed(
        t("{{count}} dismissed", { count }),
        hoverTooltip(buildTooltip, { key: "topProblemsDismissed" }),
        dom.on("click", () => this._dismissed.set({})),
        testId("dismissed"),
      ),
    ]);
  }

  private _dismiss(p: TopProblem) {
    this._dismissed.set({ ...this._dismissed.get(), [p.key]: p.version ?? "" });
  }
}

/** A problem reported by a row of the admin panel, for the list at the top of the page. */
export interface TopProblem {
  // Which problem this is. Used to remember that it was dismissed.
  key: TopProblemKey;
  // "error" is listed in the red well, "warning" in the amber one below it.
  severity: "error" | "warning";
  // Anchor of the row that reports the problem, used by "Show".
  anchor: Parameters<typeof focusAdminItem>[0];
  // Changes when the problem changes, e.g. ids of failing servers. A dismissed problem with
  // a new version shows again.
  version?: string;
  // Short title, shown in bold.
  title: string;
  // Explains the title, shown under it.
  text?: string;
}

function canBeDismissed(p: TopProblem): boolean {
  return !NON_DISMISSABLE_KEYS.includes(p.key);
}

function isDismissed(dismissed: DismissedTopProblems, p: TopProblem): boolean {
  return canBeDismissed(p) && dismissed[p.key] === (p.version ?? "");
}

/** Keys of all problems listed at the top of the Installation page. */
type TopProblemKey =
  | "sandboxing.off" |
  "sandboxing.broken" |
  "auth.no-provider" |
  "auth.init-error" |
  "auth.none" |
  "auth.boot-key" |
  "outgoing.unfiltered" |  // REQUEST() or webhooks can call any URL, with no filtering proxy
  "outgoing.review" |      // webhooks are limited to some domains, but there is no proxy
  "persist.ephemeral" |
  "admins.error" |
  "admins.none" |
  "servers.no-workers" |
  "servers.stale" |
  "servers.shared-address" |
  "health.failed" |
  "websockets.failed" |
  "check.unreachable";

/** Dismissed problems as { [key]: version }. */
type DismissedTopProblems = Partial<Record<TopProblemKey, string>>;

/** Keys of problems without "Dismiss". */
const NON_DISMISSABLE_KEYS: readonly TopProblemKey[] = [
  "admins.error",
  "admins.none",
  "servers.no-workers",
  "check.unreachable",
];

const cssTopProblemsWell = styled(cssWell, `
  max-width: 750px;
  width: 100%;
  margin: 0 auto;
  &-error {
    background-color: color-mix(in srgb, ${theme.errorText} 5%, transparent);
  }
  &-warning {
    background-color: color-mix(in srgb, ${theme.dangerText} 5%, transparent);
  }
  & + & {
    margin-top: 16px;
  }
`);

const cssFill = styled("div", `
  flex: 1;
  min-width: 0;
`);

const cssList = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 14px;
`);

const cssRow = styled("div", `
  display: flex;
  align-items: center;
  gap: 16px;
`);

const cssRowIcon = styled("div", `
  flex: none;
  display: flex;
  &-error {
    --icon-color: ${theme.errorText};
  }
  &-warning {
    --icon-color: ${tokens.warningLight};
  }
`);

const cssActions = styled("div", `
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
`);

const cssDismiss = styled("div", `
  cursor: pointer;
  color: ${theme.lightText};
  &:hover {
    color: ${theme.text};
  }
`);

const cssDismissed = styled("div", `
  margin-left: auto;
  cursor: pointer;
  color: ${theme.lightText};
  font-size: 13px;
  font-weight: normal;
  &:hover {
    text-decoration: underline;
  }
`);

const cssTooltipNote = styled("div", `
  margin-top: 4px;
  opacity: 0.8;
`);
