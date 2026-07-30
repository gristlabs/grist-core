/**
 * Walks the NotificationsNudge storyboard fixture, which renders the real builder once per
 * state. Covers what the nbrowser test can't reach on a bare core server: viewer voice (admin
 * vs collaborator), divergent per-row next steps, mostly-ready installs, the ask-the-admin
 * states (via a fake API), and the cases where the nudge renders nothing.
 *
 * Assertions read textContent, not getText(): the per-row pointers live in collapsed
 * (max-height: 0) bodies, where rendered text is empty by design.
 */
import { server, setupTestSuite } from "test/projects/testUtils";

import { assert, driver, WebElement } from "mocha-webdriver";

describe("NotificationsNudge", function() {
  setupTestSuite();

  // Indices into ALL_PANELS (the shared storyboard panels).
  const FRESH_ADMIN = 0;
  const FRESH_COLLAB = 1;
  const FRESH_COLLAB_OTHERS_ASKED = 2;
  const FRESH_COLLAB_ASKED = 3;
  const MIXED_ADMIN = 4;
  const MIXED_COLLAB = 5;
  const ONLY_AI_ADMIN = 6;
  const FRESH_OWNER = 7;
  const FIRST_EMPTY = 8;   // From here on (fully configured, electron, anonymous, fork):
  const PANEL_COUNT = 12;  // nothing rendered.

  let panels: WebElement[];

  const text = (elem: WebElement) => elem.getAttribute("textContent");

  before(async function() {
    this.timeout(60000);
    await driver.get(`${server.getHost()}/NotificationsNudge`);
    await driver.findWait(".test-storyboard-panel", 5000);
    panels = await driver.findAll(".test-storyboard-panel");
  });

  it("renders a nudge or an explicit nothing for every state", async function() {
    assert.lengthOf(panels, PANEL_COUNT);
    assert.lengthOf(await driver.findAll(".test-notifications-intro"), FIRST_EMPTY);
    for (const [i, panel] of panels.entries()) {
      assert.equal(await panel.find(".test-storyboard-nothing").isPresent(), i >= FIRST_EMPTY,
        `unexpected emptiness for panel ${i}`);
    }
  });

  it("speaks imperatively to admins and descriptively to collaborators", async function() {
    const admin = panels[FRESH_ADMIN];
    const collaborator = panels[FRESH_COLLAB];
    assert.notMatch(await text(admin.find(".test-notifications-intro")), /whoever manages/);
    assert.match(await text(admin.find(".test-notifications-next")),
      /Next step for everything below.*Choose full Grist edition/);
    assert.match(await text(collaborator.find(".test-notifications-intro")),
      /whoever manages this Grist installation/);
    assert.match(await text(collaborator.find(".test-notifications-next")),
      /Everything below is waiting on.*Choose full Grist edition/);
  });

  it("treats a personal-org owner who is not an install admin as a collaborator", async function() {
    // isOwner() is true for one's own personal org, so it must not by itself grant "can act":
    // a self-hosted owner-not-admin still gets the descriptive voice and the ask button.
    const owner = panels[FRESH_OWNER];
    assert.match(await text(owner.find(".test-notifications-intro")),
      /whoever manages this Grist installation/);
    assert.match(await text(owner.find(".test-notifications-next")),
      /Everything below is waiting on.*Choose full Grist edition/);
    assert.isTrue(await owner.find(".test-notifications-ask").isPresent());
  });

  it("links install admins to the step's admin panel item", async function() {
    const admin = panels[FRESH_ADMIN];
    const collaborator = panels[FRESH_COLLAB];
    // The edition step has a home in the admin panel; only install admins get the link.
    assert.match(await admin.find(".test-notifications-next-link").getAttribute("href"),
      /\/admin#edition$/);
    assert.isFalse(await collaborator.find(".test-notifications-next-link").isPresent());
    // Steps without an admin panel home (Redis, AI provider) stay plain text even for
    // admins (the mixed-progress and only-AI-missing admin panels).
    assert.isFalse(await panels[MIXED_ADMIN].find(".test-notifications-next-link").isPresent());
    assert.isFalse(await panels[ONLY_AI_ADMIN].find(".test-notifications-next-link").isPresent());
  });

  it("shows per-row pointers when unfinished features diverge", async function() {
    // Full Grist + email: Automations and Invite emails are ready; Change & comment
    // notifications waits on Redis and AI Assistant waits on an AI provider, so there is
    // no shared pointer, just one per unfinished row (in the expandable body).
    for (const [panel, label] of
      [[panels[MIXED_ADMIN], "Next step"], [panels[MIXED_COLLAB], "Waiting on"]] as const) {
      assert.lengthOf(await panel.findAll(".test-notifications-feature-ready"), 2);
      const next = await panel.findAll(".test-notifications-next", text);
      assert.deepEqual(next,
        [`${label} Connect a task queue (Redis)`, `${label} Connect an AI provider`]);
    }
  });

  it("shares the pointer again when one step blocks everything", async function() {
    const panel = panels[ONLY_AI_ADMIN];
    assert.lengthOf(await panel.findAll(".test-notifications-feature-ready"), 3);
    assert.match(await text(panel.find(".test-notifications-intro")),
      /Some of these features are ready/);
    const next = await panel.findAll(".test-notifications-next", text);
    assert.deepEqual(next, ["Next step for everything below Connect an AI provider"]);
  });

  it("offers collaborators the ask-the-admin button, reflecting who already asked", async function() {
    // Viewers who can act get the deep link instead; no ask widget.
    assert.isFalse(await panels[FRESH_ADMIN].find(".test-notifications-ask").isPresent());
    // A collaborator on an unasked install gets just the button.
    const collaborator = panels[FRESH_COLLAB];
    assert.equal(await text(collaborator.find(".test-notifications-ask")),
      "Ask the admin for this");
    assert.isFalse(await collaborator.find(".test-notifications-ask-count").isPresent());
    // Once others have asked, the button gains a count.
    const others = panels[FRESH_COLLAB_OTHERS_ASKED];
    assert.isTrue(await others.find(".test-notifications-ask").isPresent());
    assert.equal(await text(others.find(".test-notifications-ask-count")),
      "2 people have asked for this.");
    // A collaborator who asked sees the acknowledgement instead of the button.
    const asked = panels[FRESH_COLLAB_ASKED];
    assert.isFalse(await asked.find(".test-notifications-ask").isPresent());
    assert.equal(await text(asked.find(".test-notifications-asked")),
      "You and 2 others have asked for this.");
    // The mixed-progress collaborator asks per step: one widget per unfinished row.
    assert.lengthOf(await panels[MIXED_COLLAB].findAll(".test-notifications-ask"), 2);
  });

  it("records an ask and acknowledges it, with an optional note", async function() {
    const collaborator = panels[FRESH_COLLAB];
    await collaborator.find(".test-notifications-ask").click();
    await collaborator.findWait(".test-notifications-asked", 2000);
    assert.equal(await text(collaborator.find(".test-notifications-asked")),
      "You've asked for this.");
    // Leave a note: the input sends on Enter and collapses to a confirmation.
    await collaborator.find(".test-notifications-ask-note").click();
    await collaborator.find(".test-notifications-ask-note-input").sendKeys("pretty please\n");
    await collaborator.findWait(".test-notifications-ask-note-sent", 2000);
  });
});
