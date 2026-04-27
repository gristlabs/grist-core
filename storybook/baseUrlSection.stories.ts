import { BaseUrlSection } from "app/client/ui/BaseUrlSection";

import { styled } from "grainjs";

export default {
  title: "Admin panel/BaseUrlSection",
  parameters: {
    docs: { codePanel: true, source: { type: "code" } },
  },
};

/**
 * Base URL section. Used in the admin panel (`buildDom()`) and in the
 * setup wizard (`buildWizardDom()`, which adds a "Leave automatic" button).
 *
 * The section fetches the current URL via the `home-url` boot probe
 * (`GET /api/probes/home-url`) and writes changes via
 * `PATCH /api/install/prefs`, so these stories will hit whatever server
 * the Storybook runner is pointed at. To preview pure visual states
 * without a server, stub the APIs or run against a fixture.
 */

export const AdminPanelMode = {
  render: (_args: any, { owner }: any) => {
    const section = BaseUrlSection.create(owner, {});
    return cssFrame(section.buildDom());
  },
};

export const WizardMode = {
  render: (_args: any, { owner }: any) => {
    const section = BaseUrlSection.create(owner, {});
    return cssFrame(section.buildWizardDom());
  },
};

export const StatusDisplay = {
  render: (_args: any, { owner }: any) => {
    const section = BaseUrlSection.create(owner, {});
    return cssFrame(section.buildStatusDisplay());
  },
};

const cssFrame = styled("div", `
  padding: 24px;
  max-width: 520px;
`);
