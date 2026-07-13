/**
 * Fixture page rendering every storyboard panel for the "Notifications and Automations"
 * nudge, so test/projects/NotificationsNudge.ts can walk them in CI. The panel
 * definitions (and the human-browsable version) live with Storybook — see
 * test/fixtures/projects/helpers/notificationsNudgePanels.ts and
 * storybook/notificationsNudge.stories.ts.
 *
 * View this page itself with: yarn run test:projects:serve, then open
 * /NotificationsNudge. Rows are the real thing, so they expand/collapse on click.
 */
import { testId } from "app/client/ui2018/cssVars";
import { initGristStyles } from "test/fixtures/projects/helpers/gristStyles";
import {
  ALL_PANELS, buildPanel,
} from "test/fixtures/projects/helpers/notificationsNudgePanels";
import { withLocale } from "test/fixtures/projects/helpers/withLocale";

import { dom, styled } from "grainjs";

function setupTest() {
  // The Grist root styles set `html { overflow: hidden }`, so provide our own scroller.
  return cssScroll(
    ALL_PANELS.map(panel => cssPanel(
      cssCaption(panel.title),
      buildPanel(panel) ?? cssNothing("(renders nothing)", testId("storyboard-nothing")),
      testId("storyboard-panel"),
    )),
  );
}

const cssScroll = styled("div", `
  height: 100vh;
  overflow-y: auto;
`);

const cssPanel = styled("div", `
  max-width: 50rem;
  font-family: sans-serif;
  font-size: 13px;
  margin: 1rem auto;
`);

const cssCaption = styled("div", `
  font-weight: bold;
  margin-bottom: 0.5rem;
`);

const cssNothing = styled("div", `
  color: #888;
  font-style: italic;
`);

initGristStyles();
void withLocale(() => dom.update(document.body, setupTest()));
