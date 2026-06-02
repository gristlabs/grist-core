import { makeT } from "app/client/lib/localization";
import { urlState } from "app/client/models/gristUrlState";
import { SectionCard } from "app/client/ui/SettingsLayout";
import { bigPrimaryButtonLink } from "app/client/ui2018/buttons";
import { testId } from "app/client/ui2018/cssVars";

import { dom } from "grainjs";

const t = makeT("AdminAccessDeniedCard");

/**
 * Fallback card shown to visitors who land on an admin page without the
 * privileges to use it -- either no signed-in user, or a user who fails
 * the install-admin check. Points them at the boot-key recovery path.
 */
export function buildAdminAccessDeniedCard() {
  // `next` is validated against AdminPanelPage on arrival, so it can't redirect
  // off-site even if a user hand-edits the URL.
  const bootUrl = new URL(urlState().makeUrl({ boot: "boot" }), window.location.origin);
  const adminPanel = urlState().state.get().adminPanel;
  if (adminPanel && adminPanel !== "admin") {
    bootUrl.searchParams.set("next", adminPanel);
  }
  return SectionCard(t("Administrator Panel Unavailable"), [
    dom("p", t(`You do not have access to the administrator panel.
Please log in as an administrator.`)),
    dom("p", t(`If you are the server operator, you can sign in using the boot key from your server logs.`)),
    dom("p",
      bigPrimaryButtonLink(
        dom.attr("href", bootUrl.href),
        t("Sign in with boot key"),
      ),
    ),
    testId("admin-panel-error"),
  ]);
}
