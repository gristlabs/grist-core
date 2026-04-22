import {
  cssValueLabel,
  SectionCard,
  SectionItem,
  SettingsPage,
} from "app/client/ui/SettingsLayout";
import { toggleSwitch } from "app/client/ui2018/toggleSwitch";

import { dom, Observable, styled } from "grainjs";

// Stub for translatable strings — makes examples look realistic.
const t = (s: string) => s;

export default {
  title: "Settings Layout",
  parameters: {
    docs: {
      codePanel: true,
      source: { type: "code" },
      description: {
        component: `
Layout primitives for settings-style pages.

\`\`\`typescript
import { SettingsPage, SectionCard, SectionItem, cssValueLabel } from "app/client/ui/SettingsLayout";

SettingsPage(t("Installation"), [
  SectionCard(t("Security Settings"), [
    SectionItem({
      id: "sandboxing",
      name: t("Sandboxing"),
      description: t("Sandbox settings for data engine"),
      value: cssValueLabel("gvisor"),
    }),
  ]),
])
\`\`\`

- **SettingsPage(title, content)** — scrollable page with a title. Pass \`null\` to omit the title.
- **SectionCard(title, content)** — bordered card with a section title. Pass \`null\` to omit the title.
- **SectionItem(opts)** — label + value row, with optional expand/collapse.
`,
      },
    },
  },
};

/**
 * A typical settings page with multiple sections and items.
 */
export const FullPage = {
  render: (_args: any, { owner }: any) => {
    const telemetryOn = Observable.create(owner, true);
    return SettingsPage(t("Installation"), [
      SectionCard(t("General"), [
        SectionItem({
          id: "version",
          name: t("Current version"),
          description: t("Currently installed version of Grist"),
          value: cssValueLabel("1.4.2"),
        }),
        SectionItem({
          id: "telemetry",
          name: t("Telemetry"),
          description: t("Help us make Grist better"),
          value: toggleSwitch(telemetryOn),
          expandedContent: dom("div",
            dom("p", t("We only collect usage statistics. No personal data is sent.")),
            dom("p", t("You can change this setting at any time.")),
          ),
        }),
      ]),
      SectionCard(t("Security Settings"), [
        SectionItem({
          id: "sandboxing",
          name: t("Sandboxing"),
          description: t("Sandbox settings for data engine"),
          value: cssValueLabel("gvisor"),
          expandedContent: dom("div",
            t("Documents are isolated using gVisor. "),
            dom("a", { href: "#" }, t("Learn more.")),
          ),
        }),
        SectionItem({
          id: "auth",
          name: t("Authentication"),
          description: t("Current authentication method"),
          value: cssValueLabel("SAML"),
        }),
        SectionItem({
          id: "session",
          name: t("Session Secret"),
          description: t("Key to sign sessions with"),
          value: cssValueLabel("Set"),
        }),
      ]),
    ]);
  },
  parameters: { docs: { source: { type: "code",
    transform: () => `\
SettingsPage(t("Installation"), [
  SectionCard(t("General"), [
    SectionItem({
      id: "version",
      name: t("Current version"),
      description: t("Currently installed version of Grist"),
      value: cssValueLabel("1.4.2"),
    }),
    SectionItem({
      id: "telemetry",
      name: t("Telemetry"),
      description: t("Help us make Grist better"),
      value: toggleSwitch(telemetryOn),
      expandedContent: dom("div", ...),
    }),
  ]),
  SectionCard(t("Security Settings"), [
    SectionItem({ id: "sandboxing", name: t("Sandboxing"), ... }),
    SectionItem({ id: "auth", name: t("Authentication"), ... }),
    SectionItem({ id: "session", name: t("Session Secret"), ... }),
  ]),
])` } } },
};

/**
 * A single SectionCard in isolation.
 */
export const SingleCard = {
  render: () =>
    cssStoryContainer(
      SectionCard(t("Document Settings"), [
        SectionItem({
          id: "timezone",
          name: t("Timezone"),
          description: t("Default timezone for date columns"),
          value: cssValueLabel("America/New_York"),
        }),
        SectionItem({
          id: "currency",
          name: t("Currency"),
          description: t("Default currency for new columns"),
          value: cssValueLabel("USD"),
        }),
        SectionItem({
          id: "locale",
          name: t("Locale"),
          description: t("Locale for number and date formatting"),
          value: cssValueLabel("en-US"),
        }),
      ]),
    ),
  parameters: { docs: { source: { type: "code",
    transform: () => `\
SectionCard(t("Document Settings"), [
  SectionItem({
    id: "timezone",
    name: t("Timezone"),
    description: t("Default timezone for date columns"),
    value: cssValueLabel("America/New_York"),
  }),
  SectionItem({
    id: "currency",
    name: t("Currency"),
    description: t("Default currency for new columns"),
    value: cssValueLabel("USD"),
  }),
  SectionItem({
    id: "locale",
    name: t("Locale"),
    description: t("Locale for number and date formatting"),
    value: cssValueLabel("en-US"),
  }),
])` } } },
};

/**
 * A card with no title — pass `null` as the first argument.
 */
export const CardWithoutTitle = {
  render: () =>
    cssStoryContainer(
      SectionCard(null, [
        SectionItem({
          id: "note",
          name: t("Notice"),
          value: dom("span", t("This card has no title.")),
        }),
      ]),
    ),
  parameters: { docs: { source: { type: "code",
    transform: () => `\
SectionCard(null, [
  SectionItem({
    id: "note",
    name: t("Notice"),
    value: dom("span", t("This card has no title.")),
  }),
])` } } },
};

/**
 * A page with no title — pass `null` as the first argument.
 */
export const PageWithoutTitle = {
  render: () =>
    SettingsPage(null, [
      SectionCard(t("Standalone Card"), [
        SectionItem({
          id: "example",
          name: t("Example item"),
          description: t("Description text"),
          value: cssValueLabel("value"),
        }),
      ]),
    ]),
  parameters: { docs: { source: { type: "code",
    transform: () => `
SettingsPage(null, [
  SectionCard(t("Standalone Card"), [
    SectionItem({
      id: "example",
      name: t("Example item"),
      description: t("Description text"),
      value: cssValueLabel("value"),
    }),
  ]),
])` } } },
};

/**
 * An item in the disabled state shows reduced opacity and a tooltip on hover.
 */
export const DisabledItem = {
  render: () =>
    cssStoryContainer(
      SectionCard(t("Access Control"), [
        SectionItem({
          id: "sso",
          name: t("Single sign-on"),
          description: t("Configure SSO provider"),
          value: cssValueLabel("Not configured"),
          disabled: "Requires an Enterprise license",
        }),
      ]),
    ),
  parameters: { docs: { source: { type: "code",
    transform: () => `\
SectionCard(t("Access Control"), [
  SectionItem({
    id: "sso",
    name: t("Single sign-on"),
    description: t("Configure SSO provider"),
    value: cssValueLabel("Not configured"),
    disabled: "Requires an Enterprise license",
  }),
])` } } },
};

/**
 * An expandable item — click the row to toggle expanded content.
 */
export const ExpandableItem = {
  render: () =>
    cssStoryContainer(
      SectionCard(t("Details"), [
        SectionItem({
          id: "expand-demo",
          name: t("Click to expand"),
          description: t("Additional details are hidden"),
          value: cssValueLabel("OK"),
          expandedContent: dom("div",
            dom("p", t("Here is the expanded content.")),
            dom("p", t("It can contain any DOM elements.")),
          ),
        }),
      ]),
    ),
  parameters: { docs: { source: { type: "code",
    transform: () => `\
SectionCard(t("Details"), [
  SectionItem({
    id: "expand-demo",
    name: t("Click to expand"),
    description: t("Additional details are hidden"),
    value: cssValueLabel("OK"),
    expandedContent: dom("div",
      dom("p", t("Here is the expanded content.")),
      dom("p", t("It can contain any DOM elements.")),
    ),
  }),
])` } } },
};

const cssStoryContainer = styled("div", `
  max-width: 800px;
`);
