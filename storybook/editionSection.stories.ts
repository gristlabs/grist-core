import { EditionSection } from "app/client/ui/EditionSection";

import { styled } from "grainjs";

export default {
  title: "Admin panel/EditionSection",
  parameters: {
    docs: { codePanel: true, source: { type: "code" } },
  },
};

/**
 * Edition selector: Community vs Full Grist. The `availability` option
 * lets stories drive which buttons are shown without depending on the
 * enterprise build's `showEnterpriseToggle()` at runtime.
 *
 * Stories exercise only the wizard-mode selector; the admin-panel mode
 * embeds the full `ToggleEnterpriseWidget` lifecycle, which needs a
 * `Notifier` and live activation data to render meaningfully.
 */

export const CommunityOnly = {
  render: (_args: any, { owner }: any) => {
    const section = EditionSection.create(owner, {
      availability: { fullGristAvailable: false, communityAvailable: true },
    });
    return cssFrame(section.buildWizardDom());
  },
};

export const FullAndCommunity = {
  render: (_args: any, { owner }: any) => {
    const section = EditionSection.create(owner, {
      availability: { fullGristAvailable: true, communityAvailable: true },
    });
    return cssFrame(section.buildWizardDom());
  },
};

export const FullOnly = {
  render: (_args: any, { owner }: any) => {
    const section = EditionSection.create(owner, {
      availability: { fullGristAvailable: true, communityAvailable: false },
    });
    return cssFrame(section.buildWizardDom());
  },
};

export const StatusDisplay = {
  render: (_args: any, { owner }: any) => {
    const section = EditionSection.create(owner, {
      availability: { fullGristAvailable: true, communityAvailable: true },
    });
    return cssFrame(section.buildStatusDisplay());
  },
};

const cssFrame = styled("div", `
  padding: 24px;
  max-width: 520px;
`);
