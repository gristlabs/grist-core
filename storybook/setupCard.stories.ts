import {
  BadgeVariant,
  buildBadge,
  CardList,
  HeroCard,
  HeroVariant,
  ItemBorderVariant,
  ItemCard,
} from "app/client/ui/SetupCard";

import { action } from "@storybook/addon-actions";
import { dom, Observable, styled } from "grainjs";

export default {
  title: "Setup / SetupCard",
};

// ---------------------------------------------------------------------------
// HeroCard
// ---------------------------------------------------------------------------

export const HeroCardStory = {
  args: {
    indicator: "success",
    header: "OIDC",
    badgeLabel: "Active",
    badgeVariant: "primary",
    text: "Your server is configured to authenticate users via OpenID Connect.",
    error: "",
    showCheckbox: false,
    checkboxLabel: "I understand this server has no authentication",
    showButtons: true,
    button1Label: "Reconfigure",
    button2Label: "Deactivate",
    footerText: "Installation admin: ",
    footerBoldText: "admin@example.com",
    footerActionLabel: "Change installation admin",
  },
  argTypes: {
    indicator: {
      control: "select",
      options: ["success", "pending", "warning", "error"],
    },
    badgeVariant: {
      control: "select",
      options: ["primary", "warning", "error"],
    },
  },
  render: (args: any) => {
    const checked = Observable.create(null, false);
    return dom.create(HeroCard, {
      indicator: args.indicator as HeroVariant,
      header: args.header,
      badges: args.badgeLabel
        ? [{ label: args.badgeLabel, variant: args.badgeVariant as BadgeVariant }]
        : [],
      text: args.text || undefined,
      error: args.error || undefined,
      checkbox: args.showCheckbox
        ? { label: args.checkboxLabel, checked }
        : undefined,
      buttons: args.showButtons
        ? [
            { label: args.button1Label, action: action("Button 1") },
            ...(args.button2Label ? [{ label: args.button2Label, action: action("Button 2") }] : []),
          ]
        : undefined,
      footer: args.footerText ? {
        text: args.footerText,
        boldText: args.footerBoldText || undefined,
        actions: args.footerActionLabel
          ? [{ label: args.footerActionLabel, action: action("Footer action") }]
          : undefined,
      } : undefined,
    });
  },
};

// ---------------------------------------------------------------------------
// ItemCard
// ---------------------------------------------------------------------------

export const ItemCardStory = {
  args: {
    indicator: "",
    header: "OIDC",
    badgeLabel: "",
    badgeVariant: "primary",
    text: "Works with most identity providers (Google, Azure AD, Keycloak, etc.).",
    errorHeader: "",
    errorMessage: "",
    info: "",
    button1Label: "Configure",
    button1Disabled: false,
    button2Label: "",
  },
  argTypes: {
    indicator: {
      control: "select",
      options: ["", "active", "configured", "error"],
    },
    badgeVariant: {
      control: "select",
      options: ["primary", "warning", "error"],
    },
  },
  render: (args: any) => dom.create(ItemCard, {
    indicator: (args.indicator || undefined) as ItemBorderVariant | undefined,
    header: args.header,
    badges: args.badgeLabel
      ? [{ label: args.badgeLabel, variant: args.badgeVariant as BadgeVariant }]
      : [],
    text: args.text || undefined,
    error: args.errorHeader
      ? { header: args.errorHeader, message: args.errorMessage }
      : undefined,
    info: args.info || undefined,
    buttons: [
      {
        label: args.button1Label,
        disabled: args.button1Disabled,
        action: args.button1Disabled ? undefined : action(args.button1Label),
      },
      ...(args.button2Label
        ? [{ label: args.button2Label, action: action(args.button2Label) }]
        : []),
    ],
  }),
};

// ---------------------------------------------------------------------------
// Presets — HeroCard
// ---------------------------------------------------------------------------

export const HeroSuccess = {
  ...HeroCardStory,
  args: {
    ...HeroCardStory.args,
    indicator: "success",
    badgeLabel: "Active",
    badgeVariant: "primary",
  },
};

export const HeroPending = {
  ...HeroCardStory,
  args: {
    ...HeroCardStory.args,
    indicator: "pending",
    header: "OIDC",
    badgeLabel: "Active on restart",
    badgeVariant: "warning",
    text: "Authentication has been configured and will become active when Grist is restarted.",
    showButtons: false,
  },
};

export const HeroError = {
  ...HeroCardStory,
  args: {
    ...HeroCardStory.args,
    indicator: "error",
    badgeLabel: "Error",
    badgeVariant: "error",
    text: "Authentication is misconfigured or unreachable.",
    error: "Failed to fetch OIDC discovery document",
  },
};

export const HeroNoAuth = {
  ...HeroCardStory,
  args: {
    ...HeroCardStory.args,
    indicator: "warning",
    header: "No authentication",
    badgeLabel: "Not recommended",
    badgeVariant: "warning",
    text: "Anyone who can reach this server can access all data without signing in.",
    showButtons: false,
    showCheckbox: true,
  },
};

// ---------------------------------------------------------------------------
// Presets — ItemCard
// ---------------------------------------------------------------------------

export const ItemUnconfigured = {
  ...ItemCardStory,
  args: { ...ItemCardStory.args },
};

export const ItemConfigured = {
  ...ItemCardStory,
  args: {
    ...ItemCardStory.args,
    indicator: "configured",
    badgeLabel: "Active on restart",
    badgeVariant: "warning",
    button2Label: "Set as active method",
  },
};

export const ItemActive = {
  ...ItemCardStory,
  args: {
    ...ItemCardStory.args,
    indicator: "active",
    badgeLabel: "Active",
    badgeVariant: "primary",
    button1Disabled: true,
  },
};

export const ItemError = {
  ...ItemCardStory,
  args: {
    ...ItemCardStory.args,
    indicator: "error",
    badgeLabel: "Error",
    badgeVariant: "error",
    errorHeader: "Error details",
    errorMessage: "Missing required GRIST_OIDC_IDP_CLIENT_ID",
  },
};

// ---------------------------------------------------------------------------
// ItemCard with radio selection
// ---------------------------------------------------------------------------

export const ItemCardRadioSelection = () => {
  const selected = Observable.create(null, "oidc");
  const makeRadio = (key: string) => ({
    checked: (use: any) => use(selected) === key,
    onSelect: () => { action(`Select ${key}`)(); selected.set(key); },
    name: "provider",
  });
  return cssColumn(
    dom.create(CardList, {
      header: "Choose a provider",
      items: [
        dom.create(ItemCard, {
          radio: makeRadio("oidc"),
          indicator: "configured",
          header: "OIDC",
          text: "Works with most identity providers (Google, Azure AD, Keycloak, etc.).",
        }),
        dom.create(ItemCard, {
          radio: makeRadio("saml"),
          header: "SAML",
          text: "For enterprise identity providers (Okta, OneLogin, etc.).",
        }),
        dom.create(ItemCard, {
          radio: makeRadio("forward"),
          header: "Forwarded headers",
          text: "For reverse proxy setups (Traefik, Authelia, etc.).",
        }),
      ],
    }),
  );
};

// ---------------------------------------------------------------------------
// CardList
// ---------------------------------------------------------------------------

export const CardListStory = {
  args: {
    header: "Available methods",
    collapsible: false,
    initiallyCollapsed: false,
  },
  render: (args: any) => dom.create(CardList, {
    header: args.header,
    collapsible: args.collapsible,
    initiallyCollapsed: args.initiallyCollapsed,
    items: [
      dom.create(ItemCard, {
        header: "OIDC",
        text: "Works with most identity providers.",
        buttons: [{ label: "Configure", action: action("Configure OIDC") }],
      }),
      dom.create(ItemCard, {
        header: "SAML",
        text: "For enterprise identity providers.",
        buttons: [{ label: "Configure", action: action("Configure SAML") }],
      }),
      dom.create(ItemCard, {
        header: "Forwarded headers",
        text: "For reverse proxy setups.",
        buttons: [{ label: "Configure", action: action("Configure Forwarded headers") }],
      }),
    ],
  }),
};

// ---------------------------------------------------------------------------
// Full section composition
// ---------------------------------------------------------------------------

export const FullSectionActive = () => cssColumn(
  dom.create(HeroCard, {
    indicator: "success",
    header: "OIDC",
    badges: [{ label: "Active", variant: "primary" }],
    text: "Your server is configured to authenticate users via OpenID Connect.",
    buttons: [
      { label: "Reconfigure", action: action("Reconfigure") },
      { label: "Deactivate", action: action("Deactivate") },
    ],
    footer: {
      text: "Installation admin: ",
      boldText: "admin@example.com",
      actions: [{ label: "Change installation admin", action: action("Change admin") }],
    },
  }),
  dom.create(CardList, {
    header: "Other authentication methods",
    collapsible: true,
    initiallyCollapsed: true,
    items: [
      dom.create(ItemCard, {
        header: "SAML",
        text: "For enterprise identity providers.",
        buttons: [{ label: "Configure", action: action("Configure SAML") }],
      }),
      dom.create(ItemCard, {
        indicator: "configured",
        header: "Forwarded headers",
        badges: [{ label: "Active on restart", variant: "warning" }],
        text: "For reverse proxy setups.",
        buttons: [
          { label: "Set as active method", action: action("Set active") },
          { label: "Configure", action: action("Configure Forwarded headers") },
        ],
      }),
    ],
  }),
);

export const FullSectionNoAuth = () => cssColumn(
  dom.create(HeroCard, {
    indicator: "error",
    header: "No authentication",
    badges: [{ label: "Not recommended", variant: "warning" }],
    text: "Anyone who can reach this server can access all data without signing in.",
    checkbox: {
      label: "I understand this server has no authentication",
      checked: Observable.create(null, false),
    },
    footer: {
      text: "Installation admin: ",
      boldText: "admin@example.com",
      actions: [{ label: "Change installation admin", action: action("Change admin") }],
    },
  }),
  dom.create(CardList, {
    header: "Available methods",
    items: [
      dom.create(ItemCard, {
        header: "OIDC",
        text: "Works with most identity providers.",
        buttons: [{ label: "Configure", action: action("Configure OIDC") }],
      }),
      dom.create(ItemCard, {
        header: "SAML",
        text: "For enterprise identity providers.",
        buttons: [{ label: "Configure", action: action("Configure SAML") }],
      }),
    ],
  }),
);

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const cssColumn = styled("div", `
  max-width: 520px;
`);
